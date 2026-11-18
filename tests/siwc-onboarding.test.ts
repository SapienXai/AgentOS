import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, test } from "node:test";

import { GET, POST } from "@/app/api/onboarding/siwc/route";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  applySiwcModel, cancelSiwcFlow, classifySiwcFailure, getSiwcAuthorizationUrl, readSiwcFlow,
  readSiwcModelCatalog, retrySavedSiwcFlow, startSiwcFlow
} from "@/lib/openclaw/application/siwc-onboarding-service";
import { validateOpenClawSiwcAuthorizationUrl, type SiwcOnboardingState } from "@/lib/openclaw/siwc-onboarding";

const syntheticUrl = "https://auth.openai.com/api/accounts/authorize?" +
  "response_type=code&code_challenge_method=S256&client_id=fixture&state=unique&nonce=fresh&code_challenge=fixture-value" +
  "&redirect_uri=http%3A%2F%2Flocalhost%3A38213%2Fauth%2Fcallback";

afterEach(() => setOpenClawAdapterForTesting(null));

test("accepts the SIWC authorization endpoint and port emitted by OpenClaw, separate from Codex OAuth", () => {
  assert.equal(validateOpenClawSiwcAuthorizationUrl(syntheticUrl), syntheticUrl);
  assert.ok(validateOpenClawSiwcAuthorizationUrl(syntheticUrl.replace("38213", "8080")));
  for (const invalid of [
    syntheticUrl.replace("auth.openai.com", "auth.openai.com.evil.example"),
    syntheticUrl.replace("/api/accounts/authorize", "/oauth/authorize"),
    syntheticUrl.replace("localhost", "other-host"),
    syntheticUrl.replace("38213", "80"),
    syntheticUrl.replace("S256", "plain"),
    syntheticUrl + "&state=second"
  ]) assert.equal(validateOpenClawSiwcAuthorizationUrl(invalid), null);
});

function installGateway(
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  setConfig?: OpenClawAdapter["setConfig"]
) {
  const native = {
    canProbeNativeGateway: () => true,
    probeNativeGateway: async <T>(method: string, params: Record<string, unknown> = {}) => await invoke(method, params) as T
  };
  setOpenClawAdapterForTesting({
    getGatewaySurfacePort: () => native,
    setConfig,
    call: async (method: string, params: Record<string, unknown>, options: { allowCliFallback?: boolean }) => {
      assert.equal(options.allowCliFallback, false);
      return invoke(method, params);
    }
  } as unknown as OpenClawAdapter);
}

async function expectPhase<T extends SiwcOnboardingState["phase"]>(owner: string, phase: T) {
  for (let step = 0; step < 100; step++) {
    const state = readSiwcFlow(owner);
    if (state?.phase === phase) return state;
    await delay(5);
  }
  assert.fail(`Expected ${phase}, received ${readSiwcFlow(owner)?.phase}`);
}

test("owns the wizard by operator and requires the Gateway's verified model activation", async () => {
  let receiveApproval: ((result: unknown) => void) | undefined;
  const approval = new Promise((resolve) => { receiveApproval = resolve; });
  let receiveVerification: ((result: unknown) => void) | undefined;
  const verification = new Promise((resolve) => { receiveVerification = resolve; });
  installGateway(async (method, params) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
    if (method === "openclaw.setup.activate") return { ok: false };
    if (method === "openclaw.setup.auth.start") {
      assert.equal(params.authChoice, "openai-token-sharing");
      assert.equal(params.agentId, "main");
      return {
        sessionId: params.sessionId, done: false, status: "running",
        step: { id: "sign-in", type: "note", executor: "client", externalUrl: syntheticUrl }
      };
    }
    if (method === "wizard.next") return params.answer ? approval : verification;
    if (method === "wizard.cancel") return { status: "cancelled" };
    throw new Error(method);
  });

  startSiwcFlow("first-owner");
  const state = await expectPhase("first-owner", "authorize");
  assert.ok(state.phase === "authorize");
  assert.equal(getSiwcAuthorizationUrl("first-owner", state.flowId), syntheticUrl);
  assert.equal(getSiwcAuthorizationUrl("second-owner", state.flowId, true), null);
  assert.deepEqual(readSiwcFlow("first-owner"), state);
  assert.equal(getSiwcAuthorizationUrl("first-owner", state.flowId, true), syntheticUrl);
  assert.deepEqual(readSiwcFlow("first-owner"), { ...state, browserRedirected: true });
  assert.equal(readSiwcFlow("second-owner"), null);
  assert.deepEqual(startSiwcFlow("second-owner"), { phase: "failed", reason: "busy" });
  receiveApproval?.({
    done: false, status: "running",
    step: { id: "verify", type: "progress", executor: "gateway", message: "Testing your AI connection…" }
  });
  assert.deepEqual(await expectPhase("first-owner", "verifying"), { phase: "verifying" });
  assert.equal(getSiwcAuthorizationUrl("first-owner", state.flowId), null);
  receiveVerification?.({ done: true, status: "done" });
  assert.deepEqual(await expectPhase("first-owner", "failed"), { phase: "failed", reason: "verification" });
  assert.equal(getSiwcAuthorizationUrl("first-owner", state.flowId), null);
  await delay(5);
});

test("preserves a verified existing model and never starts provider login", async () => {
  installGateway(async (method, params) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
    assert.equal(method, "openclaw.setup.activate");
    assert.deepEqual(params, { kind: "existing-model", agentId: "main" });
    return { ok: true, modelRef: "another-provider/verified-model" };
  });
  startSiwcFlow("reuse-owner");
  assert.deepEqual(await expectPhase("reuse-owner", "ready"), {
    phase: "ready", model: "another-provider/verified-model", reused: true
  });
});

test("waits for native cancellation before allowing a fresh sign-in", async () => {
  let finishCancel: ((result: unknown) => void) | undefined;
  const nativeCancellation = new Promise((resolve) => { finishCancel = resolve; });
  installGateway(async (method, params) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
    if (method === "openclaw.setup.activate") return { ok: false };
    if (method === "openclaw.setup.auth.start") return {
      sessionId: params.sessionId, done: false, status: "running",
      step: { id: "account", type: "select", message: "Reconnect a ChatGPT account", options: [{ label: "New account", value: "new" }] }
    };
    if (method === "wizard.cancel") return nativeCancellation;
    throw new Error(method);
  });
  const owner = "cancel-owner";
  startSiwcFlow(owner);
  await expectPhase(owner, "choose-account");
  const cancelled = cancelSiwcFlow(owner);
  assert.ok(cancelled);
  assert.deepEqual(startSiwcFlow("another-owner"), { phase: "failed", reason: "busy" });
  finishCancel?.({ status: "cancelled" });
  await cancelled;
  assert.deepEqual(readSiwcFlow(owner), { phase: "cancelled" });
  startSiwcFlow(owner);
  await expectPhase(owner, "choose-account");
  await cancelSiwcFlow(owner);
});

test("retries the staged ChatGPT grant without another OAuth wizard", async () => {
  const owner = "saved-sign-in-owner";
  const oldKind = "saved-auth:openai%3Asetup-11111111-1111-4111-8111-111111111111";
  const newKind = "saved-auth:openai%3Asetup-22222222-2222-4222-8222-222222222222";
  const model = "openai/verified-model";
  const authorityError = "Auth profile credential authority is unavailable; retry after owner recovery";
  let authorized = false;
  let wizardStarts = 0;
  let verifications = 0;
  const trusted = (kind: string) => ({ kind, modelRef: model, brandId: "openai", label: "Saved Sign in with ChatGPT (Beta) sign-in" });
  installGateway(async (method, params) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
    if (method === "openclaw.setup.detect") {
      return { candidates: [trusted(oldKind), ...(authorized ? [trusted(newKind)] : [])] };
    }
    if (method === "openclaw.setup.activate") {
      if (params.kind === "existing-model") return { ok: false };
      assert.deepEqual(params, { kind: newKind, agentId: "main", modelRef: model });
      return ++verifications === 1 ? { ok: false, error: authorityError } : { ok: true, modelRef: model };
    }
    if (method === "openclaw.setup.auth.start") {
      wizardStarts += 1;
      return { sessionId: params.sessionId, done: false, status: "running", step: { id: "auth", type: "note", externalUrl: syntheticUrl } };
    }
    if (method === "wizard.next") {
      authorized = true;
      return { done: true, status: "error", error: `Credentials saved; default unchanged. ${authorityError}` };
    }
    throw new Error(method);
  });

  startSiwcFlow(owner);
  assert.deepEqual(await expectPhase(owner, "saved"), { phase: "saved", needsGatewayRestart: true });
  assert.equal(retrySavedSiwcFlow("other-owner", async () => true).phase, "failed");
  retrySavedSiwcFlow(owner, async () => true);
  assert.deepEqual(await expectPhase(owner, "ready"), { phase: "ready", model, reused: false });
  assert.equal(wizardStarts, 1);
  assert.equal(verifications, 2);
});

test("rejects unprotected and cross-origin starts before accessing Gateway credentials", async () => {
  const request = (origin?: string) => new Request("http://agentos.test/api/onboarding/siwc", {
    method: "POST", headers: { host: "localhost", ...(origin ? { origin } : {}) },
    body: '{"action":"start"}'
  });
  assert.equal((await POST(request())).status, 403);
  assert.equal((await POST(request("https://untrusted.example"))).status, 403);
  assert.equal((await GET(new Request("http://localhost/api/onboarding/siwc?models=1"))).status, 403);
});

test("projects the connected catalog and verifies choices with the saved ChatGPT grant", async () => {
  const profileId = "openai:setup-33333333-3333-4333-8333-333333333333";
  const kind = `saved-auth:${encodeURIComponent(profileId)}`;
  const sol = "openai/gpt-6.2-sol";
  const luna = "openai/gpt-6-luna";
  const level = (id: string) => ({ id });
  const calls: string[] = [];
  let allowScopedRead = true;
  installGateway(async (method, params) => {
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
    if (method === "openclaw.setup.detect") return { candidates: [
      { kind, brandId: "openai", label: "Saved Sign in with ChatGPT (Beta) sign-in", modelRef: "openai/gpt-6-astra" }
    ] };
    if (method === "models.list") {
      assert.equal(params.agentId, "main");
      assert.equal(params.provider, "openai");
      if (params.authProfileId && !allowScopedRead) throw new Error("Explicit account scope unavailable");
      return {
        providerOutcomes: [{ provider: "openai", status: "ready", profileId: params.authProfileId ?? "different-profile" }],
        models: [
          { provider: "openai", id: "gpt-6.2-sol", name: "GPT-6.2 Sol", available: true, thinkingLevels: [level("off"), level("ultra")] },
          { provider: "openai", id: "gpt-6-luna", available: true, thinkingLevels: [level("low"), level("unknown")] },
          { provider: "openai", id: "unavailable", available: false }
        ]
      };
    }
    if (method === "openclaw.setup.activate") {
      assert.deepEqual(params, { agentId: "main", kind, modelRef: luna });
      calls.push("verify");
      return { ok: true, modelRef: luna };
    }
    throw new Error(method);
  }, async (path, value, options) => {
    assert.equal(path, 'agents.defaults.models["openai/gpt-6-luna"].params.thinking');
    assert.equal(value, "low");
    assert.equal(options?.allowCliFallback, false);
    calls.push("save");
    return { stdout: "", stderr: "" };
  });

  const scan = await readSiwcModelCatalog("catalog-owner");
  assert.deepEqual(scan, {
    scope: "chatgpt",
    models: [
      { id: sol, name: "GPT-6.2 Sol", thinkingLevels: ["off", "ultra"] },
      { id: luna, name: "gpt-6-luna", thinkingLevels: ["low"] }
    ]
  });
  allowScopedRead = false;
  assert.equal((await readSiwcModelCatalog("catalog-owner"))?.scope, "gateway");
  assert.deepEqual(await applySiwcModel("catalog-owner", sol, "low", async () => true), { ok: false, reason: "level" });
  assert.deepEqual(await applySiwcModel("catalog-owner", "openai/unavailable", undefined, async () => true), { ok: false, reason: "unavailable" });
  assert.deepEqual(await applySiwcModel("catalog-owner", luna, "low", async () => false), { ok: false, reason: "unavailable" });
  assert.deepEqual(calls, []);
  assert.deepEqual(await applySiwcModel("catalog-owner", luna, "low", async () => true), { ok: true, model: luna, thinking: "low" });
  assert.deepEqual(calls, ["verify", "save"]);
});

test("distinguishes identity-only, policy, quota and timeout from verification", () => {
  assert.equal(classifySiwcFailure("Token sharing is disabled", "verification"), "sharing");
  assert.equal(classifySiwcFailure("Unavailable because of workspace policy", "verification"), "policy");
  assert.equal(classifySiwcFailure("429 rate limit", "verification"), "quota");
  assert.equal(classifySiwcFailure("Browser sign-in expired", "verification"), "timeout");
});
