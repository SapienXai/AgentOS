import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  advanceModelSetupWizardSession,
  cancelModelSetupWizardSession,
  startModelSetupWizard
} from "@/lib/openclaw/application/model-setup-wizard-service";
import type { ModelSetupWizardStep } from "@/lib/openclaw/domains/model-setup-wizard";
import { type SiwcFailure, type SiwcOnboardingState, validateOpenClawSiwcAuthorizationUrl } from "@/lib/openclaw/siwc-onboarding";

const siwcChoice = "openai-token-sharing";
const lifetimeMs = 6 * 60_000;
const rosterSchema = z.object({
  defaultId: z.string().min(1),
  agents: z.array(z.object({ id: z.string().min(1) }))
});
const activationSchema = z.object({
  ok: z.boolean(), modelRef: z.string().min(1).optional(),
  gatewayRestartRequired: z.literal(true).optional()
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
  completedAt?: number;
};

let flow: Flow | null = null;

export function readSiwcFlow(owner: string) {
  return flow?.owner === owner ? flow.state : null;
}

export function getSiwcAuthorizationUrl(owner: string, flowId: string) {
  return flow?.owner === owner && flow.id === flowId && flow.state.phase === "authorize" &&
    !flow.signal.signal.aborted ? flow.url ?? null : null;
}

export function startSiwcFlow(owner: string, ownerActive: () => Promise<boolean> = async () => true) {
  if (flow && !flow.completedAt) {
    return flow.owner === owner ? flow.state : failed("busy");
  }
  const started: Flow = { id: randomUUID(), owner, state: { phase: "checking" }, signal: new AbortController() };
  flow = started;
  const deadline = setTimeout(() => started.signal.abort("timeout"), lifetimeMs);
  deadline.unref();
  const ownerCheck = setInterval(() => {
    void ownerActive().then((active) => {
      if (!active) started.signal.abort("owner");
    }, () => started.signal.abort("owner"));
  }, 2_000);
  ownerCheck.unref();
  void execute(started).finally(() => {
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

export function cancelSiwcFlow(owner: string) {
  if (flow?.owner === owner && !flow.completedAt) flow.signal.abort("cancelled");
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
    const started = await startModelSetupWizard({
      method: "openclaw.setup.auth.start", authChoice: siwcChoice, agentId,
      actorId: current.owner, signal, nativeOnly: true
    });
    current.wizardId = started.sessionId;
    let result = started.wizard;
    failure = "verification";
    while (!result.done) {
      signal.throwIfAborted();
      const answer = result.step ? await resolveStep(current, result.step) : undefined;
      result = await advanceModelSetupWizardSession(started.sessionId, answer, signal, current.owner);
    }

    if (result.status === "cancelled") {
      current.state = { phase: "cancelled" };
    } else if (result.status !== "done" || !result.modelActivation?.modelRef) {
      current.state = failed(current.sharingDenied
        ? "sharing" : classifySiwcFailure(result.error ?? "", "verification"));
    } else if (result.modelActivation.gatewayRestartRequired) {
      current.state = failed("restart");
    } else if (!result.modelActivation.modelRef.startsWith("openai/")) {
      current.state = failed("verification");
    } else {
      current.state = { phase: "ready", model: result.modelActivation.modelRef, reused: false };
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
    if (current.state.phase !== "authorize") current.state = { phase: "verifying" };
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
