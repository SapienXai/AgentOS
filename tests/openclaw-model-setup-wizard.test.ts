import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceModelSetupWizard,
  answerForModelSetupWizardStep,
  initialModelSetupWizardValue,
  isSuccessfulModelSetupWizardResult,
  modelSetupWizardResultPhase,
  parseModelSetupWizardResult,
  sanitizeModelSetupWizardResult,
  toggleModelSetupWizardSelection,
  wizardStateFromResult
} from "@/lib/openclaw/domains/model-setup-wizard";

test("wizard terminal success requires done status, not done alone", () => {
  assert.equal(isSuccessfulModelSetupWizardResult({ done: true, status: "done" }), true);
  assert.equal(modelSetupWizardResultPhase({ done: true, status: "error", error: "invalid key" }), "error");
  assert.equal(modelSetupWizardResultPhase({ done: true, status: "cancelled" }), "cancelled");
  assert.equal(modelSetupWizardResultPhase({ done: true, status: "running" }), "error");
  assert.equal(isSuccessfulModelSetupWizardResult({ done: true }), false);

  assert.deepEqual(
    wizardStateFromResult("provider-auth", { done: true, status: "error", error: "The key was rejected." }),
    { phase: "error", message: "The key was rejected." }
  );
  assert.deepEqual(
    wizardStateFromResult("provider-auth", { done: true, status: "cancelled" }),
    { phase: "cancelled", message: "Provider setup was cancelled." }
  );
});

test("wizard start result is settled without blindly advancing a client step", async () => {
  const calls: Array<{ stepId?: string; value?: unknown }> = [];
  const result = await advanceModelSetupWizard(
    {
      done: false,
      status: "running",
      step: { id: "choose-account", type: "select", options: [{ value: "personal", label: "Personal" }] }
    },
    async (answer) => {
      calls.push(answer ?? {});
      return { done: true, status: "done", modelActivation: { modelRef: "openai/gpt-5.6" } };
    }
  );

  assert.equal(result.step?.id, "choose-account");
  assert.deepEqual(calls, []);
});

test("gateway-owned wizard steps auto-advance until input or terminal state", async () => {
  const calls: Array<{ stepId?: string; value?: unknown }> = [];
  const responses = [
    { done: false, status: "running" as const, step: { id: "progress-1", type: "progress" as const, executor: "gateway" as const, message: "Checking provider" } },
    { done: false, status: "running" as const, step: { id: "progress-2", type: "progress" as const, executor: "gateway" as const, message: "Preparing model" } },
    { done: false, status: "running" as const, step: { id: "confirm", type: "confirm" as const, initialValue: true } }
  ];
  const result = await advanceModelSetupWizard(
    { done: false, status: "running" },
    async (answer) => {
      calls.push(answer ?? {});
      return responses.shift() ?? { done: true, status: "done", modelActivation: { modelRef: "ollama/qwen3" } };
    }
  );

  assert.equal(result.step?.id, "confirm");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls, [{}, {}, {}]);
});

test("a running result without a step is primed once, then waits for the Gateway", async () => {
  let calls = 0;
  const result = await advanceModelSetupWizard(
    { done: false, status: "running" },
    async () => {
      calls += 1;
      return { done: false, status: "running" };
    }
  );

  assert.equal(calls, 1);
  assert.deepEqual(result, { done: false, status: "running" });
});

test("gateway-owned progress loop is bounded and cancellable", async () => {
  await assert.rejects(
    () => advanceModelSetupWizard(
      { done: false, status: "running", step: { id: "progress", type: "progress", executor: "gateway" } },
      async () => ({ done: false, status: "running", step: { id: "progress", type: "progress", executor: "gateway" } }),
      { maxGatewaySteps: 2 }
    ),
    /taking longer than expected/
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => advanceModelSetupWizard(
      { done: false, status: "running" },
      async () => ({ done: true, status: "done" }),
      { signal: controller.signal }
    ),
    { name: "AbortError" }
  );
});

test("select and multiselect preserve exact OpenClaw values", () => {
  const multiselect = { id: "scopes", type: "multiselect" as const, initialValue: ["read", 2] };
  const initial = initialModelSetupWizardValue(multiselect);
  assert.deepEqual(initial, ["read", 2]);
  assert.deepEqual(toggleModelSetupWizardSelection(initial, "write"), ["read", 2, "write"]);
  assert.deepEqual(toggleModelSetupWizardSelection(["read", 2, "write"], 2), ["read", "write"]);
  assert.deepEqual(answerForModelSetupWizardStep(multiselect, ["read", 2]), ["read", 2]);

  const select = { id: "region", type: "select" as const, initialValue: "eu", options: [{ value: "eu", label: "Europe" }] };
  assert.equal(initialModelSetupWizardValue(select), "eu");
  assert.equal(answerForModelSetupWizardStep(select, "eu"), "eu");
});

test("confirm steps use booleans and retain their initial choice", () => {
  const step = { id: "consent", type: "confirm" as const, initialValue: true };
  assert.equal(initialModelSetupWizardValue(step), true);
  assert.equal(answerForModelSetupWizardStep(step, true), true);
  assert.equal(answerForModelSetupWizardStep(step, "true"), false);
});

test("sensitive initial values are removed before they reach the UI", () => {
  const result = parseModelSetupWizardResult({
    done: false,
    status: "running",
    step: { id: "api-key", type: "text", sensitive: true, initialValue: "secret-fixture" }
  });

  assert.equal(Object.prototype.hasOwnProperty.call(result.step, "initialValue"), false);
  assert.deepEqual(
    sanitizeModelSetupWizardResult({ done: false, step: { id: "note", type: "note", initialValue: "safe" } }),
    { done: false, step: { id: "note", type: "note", initialValue: "safe" } }
  );
});

test("prepared models are not ready until activation metadata is returned", () => {
  const prepared = wizardStateFromResult("ollama", { done: true, status: "done", preparedModelRef: "ollama/qwen3" });
  assert.equal(prepared.phase, "done");
  assert.equal(prepared.ready, false);
  if (prepared.phase === "done") assert.equal(prepared.preparedModelRef, "ollama/qwen3");

  const activated = wizardStateFromResult("ollama", {
    done: true,
    status: "done",
    modelActivation: { modelRef: "ollama/qwen3", gatewayRestartRequired: true }
  });
  assert.deepEqual(activated, {
    phase: "done",
    authChoice: "ollama",
    modelActivation: { modelRef: "ollama/qwen3", gatewayRestartRequired: true },
    ready: true,
    gatewayRestartRequired: true
  });
});

test("wizard wire validation rejects malformed terminal payloads", () => {
  assert.throws(() => parseModelSetupWizardResult({ status: "done" }), /done/);
  assert.throws(() => parseModelSetupWizardResult({ done: true, status: "done", modelActivation: { modelRef: "" } }), /modelRef/);
});
