import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, test } from "node:test";

import { POST } from "@/app/api/onboarding/siwc/route";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  classifySiwcFailure, getSiwcAuthorizationUrl, readSiwcFlow, startSiwcFlow
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

function installGateway(invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const native = {
    canProbeNativeGateway: () => true,
    probeNativeGateway: async <T>(method: string, params: Record<string, unknown> = {}) => await invoke(method, params) as T
  };
  setOpenClawAdapterForTesting({
    getGatewaySurfacePort: () => native,
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
    if (method === "wizard.next") return verification;
    if (method === "wizard.cancel") return { status: "cancelled" };
    throw new Error(method);
  });

  startSiwcFlow("first-owner");
  const state = await expectPhase("first-owner", "authorize");
  assert.ok(state.phase === "authorize");
  assert.equal(getSiwcAuthorizationUrl("first-owner", state.flowId), syntheticUrl);
  assert.equal(getSiwcAuthorizationUrl("second-owner", state.flowId), null);
  assert.equal(readSiwcFlow("second-owner"), null);
  assert.deepEqual(startSiwcFlow("second-owner"), { phase: "failed", reason: "busy" });
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

test("rejects unprotected and cross-origin starts before accessing Gateway credentials", async () => {
  const request = (origin?: string) => new Request("http://agentos.test/api/onboarding/siwc", {
    method: "POST", headers: { host: "localhost", ...(origin ? { origin } : {}) },
    body: '{"action":"start"}'
  });
  assert.equal((await POST(request())).status, 403);
  assert.equal((await POST(request("https://untrusted.example"))).status, 403);
});

test("distinguishes identity-only, policy, quota and timeout from verification", () => {
  assert.equal(classifySiwcFailure("Token sharing is disabled", "verification"), "sharing");
  assert.equal(classifySiwcFailure("Unavailable because of workspace policy", "verification"), "policy");
  assert.equal(classifySiwcFailure("429 rate limit", "verification"), "quota");
  assert.equal(classifySiwcFailure("Browser sign-in expired", "verification"), "timeout");
});
