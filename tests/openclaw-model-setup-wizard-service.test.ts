import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  advanceModelSetupWizardSession,
  cancelModelSetupWizardSession,
  resetModelSetupWizardSessionsForTesting,
  startModelSetupWizard
} from "@/lib/openclaw/application/model-setup-wizard-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

afterEach(async () => {
  await resetModelSetupWizardSessionsForTesting();
  setOpenClawAdapterForTesting(null);
});

function createAdapter(options: {
  getConnectionIdentity?: () => { client: object; connectionId: string | null };
  onCall?: (method: string, params: Record<string, unknown>) => unknown;
}) {
  return {
    getConnectionIdentity: options.getConnectionIdentity,
    call: async <T>(method: string, params: Record<string, unknown>) => options.onCall?.(method, params) as T
  } as OpenClawAdapter;
}

test("server-owned setup sessions reject arbitrary follow-up session ids", async () => {
  const adapter = createAdapter({
    onCall: (method, params) => {
      if (method.endsWith(".start")) {
        return {
          sessionId: params.sessionId,
          done: false,
          status: "running",
          step: { id: "account", type: "select", options: [{ value: "personal", label: "Personal" }] }
        };
      }
      if (method === "wizard.cancel") return { status: "cancelled" };
      throw new Error(`Unexpected method ${method}`);
    }
  });
  setOpenClawAdapterForTesting(adapter);

  const started = await startModelSetupWizard({ method: "openclaw.setup.auth.start", authChoice: "provider-oauth" });
  assert.match(started.sessionId, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    () => advanceModelSetupWizardSession("not-created-by-agentos", { stepId: "account", value: "personal" }),
    /no longer active/
  );
  await cancelModelSetupWizardSession(started.sessionId);
});

test("setup sessions are bound to the AgentOS actor that started them", async () => {
  const adapter = createAdapter({
    onCall: (method, params) => {
      if (method === "openclaw.setup.auth.start") {
        return {
          sessionId: params.sessionId,
          done: false,
          status: "running",
          step: { id: "account", type: "select", options: [{ value: "personal", label: "Personal" }] }
        };
      }
      if (method === "wizard.cancel") return { status: "cancelled" };
      throw new Error(`Unexpected method ${method}`);
    }
  });
  setOpenClawAdapterForTesting(adapter);

  const started = await startModelSetupWizard({
    actorId: "actor-a",
    method: "openclaw.setup.auth.start",
    authChoice: "provider-oauth"
  });
  await assert.rejects(
    () => advanceModelSetupWizardSession(started.sessionId, undefined, undefined, "actor-b"),
    /not owned by this AgentOS actor/
  );
  await cancelModelSetupWizardSession(started.sessionId, "actor-a");
});

test("connection changes stop the old wizard before an answer crosses Gateway identities", async () => {
  let client: object = {};
  let nextCalls = 0;
  const adapter = createAdapter({
    getConnectionIdentity: () => ({ client, connectionId: "gateway-a" }),
    onCall: (method, params) => {
      if (method === "openclaw.setup.auth.start") {
        return {
          sessionId: params.sessionId,
          done: false,
          status: "running",
          step: { id: "account", type: "select", options: [{ value: "personal", label: "Personal" }] }
        };
      }
      if (method === "wizard.next") {
        nextCalls += 1;
        return { done: true, status: "done", modelActivation: { modelRef: "provider/model" } };
      }
      if (method === "wizard.cancel") return { status: "cancelled" };
      throw new Error(`Unexpected method ${method}`);
    }
  });
  setOpenClawAdapterForTesting(adapter);

  const started = await startModelSetupWizard({ method: "openclaw.setup.auth.start", authChoice: "provider-oauth" });
  client = {};
  await assert.rejects(
    () => advanceModelSetupWizardSession(started.sessionId, { stepId: "account", value: "personal" }),
    /reconnected while provider setup was in progress/
  );
  assert.equal(nextCalls, 0);
});
