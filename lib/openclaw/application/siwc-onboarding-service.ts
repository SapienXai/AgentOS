import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getOpenClawAdapter, type OpenClawAdapter, type OpenClawGatewaySurfacePort } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  advanceModelSetupWizardSession,
  cancelModelSetupWizardSession,
  startModelSetupWizard
} from "@/lib/openclaw/application/model-setup-wizard-service";
import type { ModelSetupWizardStep } from "@/lib/openclaw/domains/model-setup-wizard";
import {
  SIWC_THINKING_LEVELS, type SiwcFailure, type SiwcModelApplyResult, type SiwcModelCatalog,
  type SiwcModelThinking, type SiwcOnboardingState, validateOpenClawSiwcAuthorizationUrl
} from "@/lib/openclaw/siwc-onboarding";

const siwcChoice = "openai-token-sharing";
const defaultSiwcModel = "openai/gpt-6-luna";
const defaultSiwcThinking = "low";
const lifetimeMs = 6 * 60_000;
const rosterSchema = z.object({
  defaultId: z.string().min(1),
  agents: z.array(z.object({ id: z.string().min(1) }))
});
const activationSchema = z.object({
  ok: z.boolean(), modelRef: z.string().min(1).optional(),
  error: z.string().optional(),
  gatewayRestartRequired: z.literal(true).optional()
});
const savedCandidateSchema = z.object({
  kind: z.string(),
  brandId: z.literal("openai"),
  label: z.string(),
  modelRef: z.string().startsWith("openai/")
});
type SavedCandidate = z.infer<typeof savedCandidateSchema>;
type SavedSignIn = { agentId: string; candidate: SavedCandidate };
const modelCatalogSchema = z.object({
  models: z.array(z.object({
    provider: z.string(), id: z.string(), name: z.string().optional(),
    available: z.boolean().optional(),
    thinkingLevels: z.array(z.object({ id: z.string() })).optional()
  })),
  providerOutcomes: z.array(z.object({
    provider: z.string(), profileId: z.string().optional(), status: z.string()
  })).optional()
});

type Flow = {
  id: string;
  owner: string;
  state: SiwcOnboardingState;
  signal: AbortController;
  wizardId?: string;
  url?: string;
  answer?: (index: number) => void;
  sharingDenied?: boolean;
  saved?: SavedSignIn;
  settled?: Promise<void>;
  completedAt?: number;
};

let flow: Flow | null = null;
let modelApplyInProgress = false;

export function readSiwcFlow(owner: string) {
  return flow?.owner === owner ? flow.state : null;
}

export function getSiwcAuthorizationUrl(owner: string, flowId: string, redirectBrowser = false) {
  if (flow?.owner !== owner || flow.id !== flowId || flow.state.phase !== "authorize" ||
      flow.signal.signal.aborted || !flow.url) return null;
  if (redirectBrowser) flow.state = { ...flow.state, browserRedirected: true };
  return flow.url;
}

export function startSiwcFlow(owner: string, ownerActive: () => Promise<boolean> = async () => true) {
  return runSiwcFlow(owner, ownerActive);
}

export function retrySavedSiwcFlow(owner: string, ownerActive: () => Promise<boolean>) {
  if (flow?.owner !== owner || !flow.saved || flow.state.phase !== "saved") return failed("verification");
  return runSiwcFlow(owner, ownerActive, flow.saved);
}

function runSiwcFlow(owner: string, ownerActive: () => Promise<boolean>, saved?: SavedSignIn) {
  if (modelApplyInProgress) return failed("busy");
  if (flow && !flow.completedAt) {
    return flow.owner === owner ? flow.state : failed("busy");
  }
  const started: Flow = { id: randomUUID(), owner, state: { phase: "checking" }, signal: new AbortController(), saved };
  flow = started;
  const deadline = setTimeout(() => started.signal.abort("timeout"), lifetimeMs);
  deadline.unref();
  const ownerCheck = setInterval(() => {
    void ownerActive().then((active) => {
      if (!active) started.signal.abort("owner");
    }, () => started.signal.abort("owner"));
  }, 2_000);
  ownerCheck.unref();
  started.settled = execute(started).finally(() => {
    clearTimeout(deadline);
    clearInterval(ownerCheck);
    started.url = undefined;
    started.answer = undefined;
    started.completedAt = Date.now();
    const expiry = setTimeout(() => {
      if (flow === started) flow = null;
    }, 10 * 60_000);
    expiry.unref();
  });
  return started.state;
}

export async function readSiwcModelCatalog(owner: string): Promise<SiwcModelCatalog | null> {
  try {
    return (await prepareSiwcModelSelection(owner, AbortSignal.timeout(20_000)))?.catalog ?? null;
  } catch {
    return null;
  }
}

async function prepareSiwcModelSelection(owner: string, signal: AbortSignal) {
  const root = getOpenClawAdapter();
  const adapter = root.capture?.() ?? root;
  const native = adapter.getGatewaySurfacePort?.();
  if (!native?.canProbeNativeGateway()) return null;
  const roster = rosterSchema.parse(await native.probeNativeGateway("agents.list", {}, { signal, timeoutMs: 5_000 }));
  const agentId = roster.defaultId;
  if (!roster.agents.some(({ id }) => id === agentId)) return null;
  const candidates = await readOpenAiSetupCandidates(native, agentId, signal);
  const previous = flow?.owner === owner && flow.saved?.agentId === agentId
    ? candidates.find(({ kind }) => kind === flow?.saved?.candidate.kind) : undefined;
  const readCatalog = async (authProfileId?: string) => modelCatalogSchema.parse(await native.probeNativeGateway(
    "models.list", {
      view: "configured", agentId, provider: "openai",
      ...(authProfileId ? { authProfileId } : {})
    }, { signal, timeoutMs: 7_000 }
  ));
  const profileId = (candidate: SavedCandidate) => decodeURIComponent(candidate.kind.slice("saved-auth:".length));
  const staged = candidates.filter(isStagedSiwcSignIn);
  const scopedCandidate = previous ?? (staged.length === 1 ? staged[0] : undefined);
  const scoped = scopedCandidate ? await readCatalog(profileId(scopedCandidate)).catch(() => null) : null;
  signal.throwIfAborted();
  const scopedOutcome = scoped?.providerOutcomes?.find(({ provider, profileId: id, status }) =>
    provider === "openai" && scopedCandidate && id === profileId(scopedCandidate) && status === "ready");
  // Some managed Gateways restrict explicit account catalog reads. Their
  // automatic catalog still supplies candidates, which must pass a model
  // activation using the exact saved ChatGPT sign-in before becoming default.
  const result = scopedOutcome ? scoped : await readCatalog();
  if (!result) return null;
  const outcome = scopedOutcome ?? result.providerOutcomes?.find(({ provider }) => provider === "openai");
  if (outcome?.status !== "ready") return null;
  const automaticCandidate = candidates.find((candidate) => profileId(candidate) === outcome.profileId);
  const candidate = scopedCandidate ?? automaticCandidate;
  if (!candidate) return null;
  const scope = automaticCandidate?.kind === candidate.kind && (candidate === previous || isStagedSiwcSignIn(candidate)) ? "chatgpt" : "gateway";
  const models = new Map<string, SiwcModelCatalog["models"][number]>();
  for (const entry of result.models) {
    if (entry.provider !== "openai" || entry.available !== true || !/^[\w.-]{1,120}$/.test(entry.id)) continue;
    const id = `openai/${entry.id}`;
    const levels = new Set(entry.thinkingLevels?.map((level) => level.id));
    models.set(id, { id, name: entry.name?.slice(0, 100) || entry.id, thinkingLevels: SIWC_THINKING_LEVELS.filter((level) => levels.has(level)) });
  }
  const catalog: SiwcModelCatalog = { scope, models: [...models.values()] };
  return { adapter, native, agentId, candidate, catalog };
}

export async function applySiwcModel(
  owner: string,
  model: string,
  thinking: SiwcModelThinking | undefined,
  ownerActive: () => Promise<boolean>
): Promise<SiwcModelApplyResult> {
  if (modelApplyInProgress || (flow && !flow.completedAt)) return { ok: false, reason: "busy" };
  modelApplyInProgress = true;
  try {
    const target = await prepareSiwcModelSelection(owner, AbortSignal.timeout(20_000));
    const selected = target?.catalog.models.find(({ id }) => id === model);
    if (!target || !selected) return { ok: false, reason: "unavailable" };
    if (thinking && !selected.thinkingLevels.includes(thinking)) return { ok: false, reason: "level" };
    if (!await ownerActive()) return { ok: false, reason: "unavailable" };
    const { adapter, native, agentId, candidate } = target;
    const result = activationSchema.parse(await native.probeNativeGateway("openclaw.setup.activate", {
      kind: candidate.kind, modelRef: selected.id, agentId
    }, { timeoutMs: 115_000 }));
    if (result.gatewayRestartRequired) return { ok: false, reason: "restart" };
    if (!result.ok || result.modelRef !== selected.id) return { ok: false, reason: "verification" };

    const confirmed: SiwcOnboardingState = { phase: "ready", model, reused: false };
    if (flow?.owner === owner) flow.state = confirmed;
    if (thinking) {
      try {
        if (!await ownerActive()) return { ok: false, reason: "thinking-save", model };
        if (await saveModelThinking(adapter, model, thinking)) return { ok: false, reason: "restart", model };
      } catch {
        return { ok: false, reason: "thinking-save", model };
      }
      if (flow?.owner === owner) flow.state = { ...confirmed, thinking };
    }
    return { ok: true, model, thinking };
  } catch {
    return { ok: false, reason: "verification" };
  } finally {
    modelApplyInProgress = false;
  }
}

export function cancelSiwcFlow(owner: string) {
  if (flow?.owner !== owner || flow.completedAt) return;
  flow.signal.abort("cancelled");
  return flow.settled;
}

export function selectSiwcAccount(owner: string, index: number) {
  if (flow?.owner !== owner || flow.state.phase !== "choose-account" ||
      !flow.answer || !flow.state.options[index] || flow.signal.signal.aborted) return false;
  const answer = flow.answer;
  flow.answer = undefined;
  answer(index);
  return true;
}

async function execute(current: Flow) {
  const signal = current.signal.signal;
  let failure: SiwcFailure = "gateway";
  try {
    const root = getOpenClawAdapter();
    const adapter = root.capture?.() ?? root;
    const native = adapter.getGatewaySurfacePort?.();
    if (!native?.canProbeNativeGateway()) {
      current.state = failed("unsupported");
      return;
    }

    const roster = rosterSchema.parse(await native.probeNativeGateway("agents.list", {}, { signal, timeoutMs: 8_000 }));
    const agentId = roster.defaultId;
    if (!roster.agents.some((agent) => agent.id === agentId)) {
      current.state = failed("gateway");
      return;
    }
    if (current.saved) {
      if (agentId !== current.saved.agentId) {
        current.state = failed("verification");
        return;
      }
      await verifySavedSignIn(current, adapter, native, current.saved);
      return;
    }

    // A working configured route is reusable regardless of provider. The
    // upstream existing-model activation tests it without writing a new model.
    const existing = activationSchema.safeParse(await native.probeNativeGateway(
      "openclaw.setup.activate", { kind: "existing-model", agentId }, { signal, timeoutMs: 35_000 }
    ).catch(() => null));
    signal.throwIfAborted();
    if (existing.success && existing.data.ok && existing.data.modelRef && !existing.data.gatewayRestartRequired) {
      current.state = { phase: "ready", model: existing.data.modelRef, reused: true };
      return;
    }

    // Resolve this exact manifest choice in OpenClaw's wizard. Discovery is
    // advisory; it can omit unfeatured choices or fail independently.
    failure = "unsupported";
    current.state = { phase: "preparing" };
    const before = await readSavedSignIns(native, agentId, signal).catch(() => null);
    signal.throwIfAborted();
    const started = await startModelSetupWizard({
      method: "openclaw.setup.prepare.start", authChoice: siwcChoice, agentId,
      actorId: current.owner, signal, nativeOnly: true,
      onGatewayStep(step) {
        if (current.state.phase === "authorize" && step.type === "progress" &&
            /^Testing your AI connection/i.test(step.message ?? "")) {
          current.url = undefined;
          current.state = { phase: "verifying" };
        }
      }
    });
    current.wizardId = started.sessionId;
    let result = started.wizard;
    failure = "verification";
    while (!result.done) {
      signal.throwIfAborted();
      const answer = result.step ? await resolveStep(current, result.step) : undefined;
      result = await advanceModelSetupWizardSession(started.sessionId, answer, signal, current.owner);
    }
    signal.throwIfAborted();

    if (result.status === "cancelled") {
      current.state = { phase: "cancelled" };
    } else if (result.status !== "done" || current.sharingDenied) {
      current.state = failed(current.sharingDenied
        ? "sharing" : classifySiwcFailure(result.error ?? "", "verification"));
    } else {
      // Preparing the grant leaves the default alone. Resolve the saved
      // sign-in before asking OpenClaw to verify and select the requested model.
      current.url = undefined;
      current.state = { phase: "verifying" };
      const after = await readSavedSignIns(native, agentId, signal).catch(() => null);
      signal.throwIfAborted();
      const added = before && after?.filter((candidate) => !before.some(({ kind }) => kind === candidate.kind));
      const candidate = added?.length === 1 ? added[0] : added?.length === 0 && after?.length === 1 ? after[0] : undefined;
      if (candidate) {
        await verifySavedSignIn(current, adapter, native, { agentId, candidate });
      } else {
        current.state = failed("verification");
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      current.state = failed(classifySiwcFailure(error instanceof Error ? error.message : "", failure));
    } else if (signal.reason === "owner" || signal.reason === "timeout") {
      current.state = failed(signal.reason);
    } else {
      current.state = { phase: "cancelled" };
    }
  } finally {
    current.url = undefined;
    if (current.wizardId && current.state.phase !== "ready") {
      await cancelModelSetupWizardSession(current.wizardId, current.owner).catch(() => {});
    }
  }
}

async function readSavedSignIns(native: OpenClawGatewaySurfacePort, agentId: string, signal: AbortSignal) {
  return (await readOpenAiSetupCandidates(native, agentId, signal)).filter(isStagedSiwcSignIn);
}

function isStagedSiwcSignIn(candidate: SavedCandidate) {
  return /^saved-auth:openai%3Atoken-sharing%3A/i.test(candidate.kind) ||
    /^Saved Sign in with ChatGPT(?: \(Beta\))? sign-in$/i.test(candidate.label);
}

async function readOpenAiSetupCandidates(native: OpenClawGatewaySurfacePort, agentId: string, signal: AbortSignal) {
  const { candidates } = z.object({ candidates: z.array(z.unknown()) }).parse(
    await native.probeNativeGateway("openclaw.setup.detect", { agentId }, { signal, timeoutMs: 12_000 })
  );
  return candidates.flatMap((payload) => {
    const parsed = savedCandidateSchema.safeParse(payload);
    if (!parsed.success) return [];
    const candidate = parsed.data;
    return /^saved-auth:openai%3A(?:setup-[\da-f-]{36}|token-sharing%3A[\w.-]{1,120})$/i.test(candidate.kind) ? [candidate] : [];
  });
}

async function verifySavedSignIn(current: Flow, adapter: OpenClawAdapter, native: OpenClawGatewaySurfacePort, saved: SavedSignIn) {
  current.saved = saved;
  current.state = { phase: "verifying" };
  const signal = current.signal.signal;
  let activation: z.infer<typeof activationSchema> | null = null;
  try {
    activation = activationSchema.parse(await native.probeNativeGateway("openclaw.setup.activate", {
      kind: saved.candidate.kind, modelRef: defaultSiwcModel, agentId: saved.agentId
    }, { signal, timeoutMs: 115_000 }));
  } catch (error) {
    signal.throwIfAborted();
    current.state = { phase: "saved", needsGatewayRestart: isCredentialAuthorityError(error instanceof Error ? error.message : "") };
    return;
  }
  signal.throwIfAborted();
  if (activation.ok && activation.modelRef === defaultSiwcModel && !activation.gatewayRestartRequired) {
    await finishSiwcDefault(current, adapter);
  } else {
    current.state = {
      phase: "saved",
      needsGatewayRestart: Boolean(activation.gatewayRestartRequired || isCredentialAuthorityError(activation.error ?? ""))
    };
  }
}

async function finishSiwcDefault(current: Flow, adapter: OpenClawAdapter) {
  current.signal.signal.throwIfAborted();
  const needsRestart = await saveModelThinking(adapter, defaultSiwcModel, defaultSiwcThinking);
  current.state = needsRestart
    ? failed("restart")
    : { phase: "ready", model: defaultSiwcModel, thinking: defaultSiwcThinking, reused: false };
}

async function saveModelThinking(adapter: OpenClawAdapter, model: string, thinking: SiwcModelThinking) {
  const saved = await adapter.setConfig(`agents.defaults.models[${JSON.stringify(model)}].params.thinking`, thinking, {
    allowCliFallback: false, timeoutMs: 8_000
  });
  const applied = z.object({ restartRequired: z.boolean() }).safeParse(saved.metadata?.openClawConfig);
  return applied.success && applied.data.restartRequired;
}

function isCredentialAuthorityError(message: string) {
  return /auth profile credential authority is unavailable|shared-state worker/i.test(message);
}

async function resolveStep(current: Flow, step: ModelSetupWizardStep) {
  if (/token sharing is disabled|identity permissions only/i.test(step.message ?? "")) {
    current.sharingDenied = true;
  }
  if (step.externalUrl) {
    const url = validateOpenClawSiwcAuthorizationUrl(step.externalUrl);
    if (!url || step.type !== "note") throw new Error("Invalid SIWC callback destination.");
    current.url = url;
    current.state = { phase: "authorize", flowId: current.id };
  } else if (step.type === "progress" && step.executor === "gateway") {
    current.url = undefined;
    current.state = { phase: "verifying" };
    return undefined;
  } else if (step.type === "select") {
    if (step.options?.some(({ value }) => value === "keep") &&
        step.options.every(({ value }) => value === "keep" || value === "all")) {
      return { stepId: step.id, value: "keep" };
    }
    const options = step.options;
    if (!options?.length || !step.message?.startsWith("Reconnect a ChatGPT account")) {
      throw new Error("SIWC requires an unsupported interactive setup decision.");
    }
    current.state = {
      phase: "choose-account",
      options: options.map(({ label }) => label.slice(0, 150))
    };
    const index = await new Promise<number>((resolve, reject) => {
      const signal = current.signal.signal;
      const abort = () => reject(signal.reason);
      signal.throwIfAborted();
      signal.addEventListener("abort", abort, { once: true });
      current.answer = (index) => {
        signal.removeEventListener("abort", abort);
        resolve(index);
      };
    });
    current.state = { phase: "preparing" };
    return { stepId: step.id, value: options[index].value };
  } else if (step.type !== "note") {
    throw new Error("SIWC requires an unsupported interactive setup decision.");
  } else if (current.state.phase === "authorize") {
    current.url = undefined;
    current.state = { phase: "verifying" };
  }
  return { stepId: step.id };
}

export function classifySiwcFailure(message: string, fallback: SiwcFailure): SiwcFailure {
  if (/declined|access.denied/i.test(message)) return "declined";
  if (/sharing.*(?:disabled|denied)|identity.only/i.test(message)) return "sharing";
  if (/quota|rate.limit|\b429\b|usage.limit|billing/i.test(message)) return "quota";
  if (/not.allowed|policy|restriction|administrator connection|missing scope/i.test(message)) return "policy";
  if (/address already in use|eaddrinuse|callback|redirect/i.test(message)) return "callback";
  if (/timed? out|timeout|expired/i.test(message)) return "timeout";
  if (/no (?:eligible|compatible|available) model|no models|no default model/i.test(message)) return "no-models";
  if (/unknown method|not available on this Gateway|provider login is no longer available/i.test(message)) return "version";
  if (/provider.{0,30}unavailable|temporarily unavailable|\b503\b/i.test(message)) return "unavailable";
  if (/shared-state worker|retiring while its actor/i.test(message)) return "gateway";
  if (/busy|another.*(setup|wizard)/i.test(message)) return "busy";
  return fallback;
}

function failed(reason: SiwcFailure): SiwcOnboardingState {
  return { phase: "failed", reason };
}
