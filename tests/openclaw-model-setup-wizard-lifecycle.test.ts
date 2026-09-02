import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ModelSetupWizardLifecycle,
  ModelSetupWizardStartTimeoutError
} from "@/lib/openclaw/domains/model-setup-wizard-lifecycle";
import type {
  ModelSetupWizardLifecycleTransport
} from "@/lib/openclaw/domains/model-setup-wizard-lifecycle";
import type { ModelSetupWizardStartResult } from "@/lib/openclaw/domains/model-setup-wizard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function interactiveStart(sessionId: string) {
  return {
    sessionId,
    done: false,
    status: "running" as const,
    step: { id: "account", type: "select" as const, options: [{ value: "personal", label: "Personal" }] }
  };
}

function transport(overrides: Partial<ModelSetupWizardLifecycleTransport> = {}) {
  return {
    start: async () => ({ sessionId: "wizard-1", done: false, status: "running" as const, step: interactiveStart("wizard-1").step }),
    next: async () => ({ done: true, status: "done" as const, modelActivation: { modelRef: "openai/gpt-5.6" } }),
    status: async () => ({ status: "running" as const }),
    cancel: async () => ({ status: "cancelled" as const }),
    ...overrides
  } satisfies ModelSetupWizardLifecycleTransport;
}

test("late start responses cancel the exact admitted session", async () => {
  const started = deferred<ModelSetupWizardStartResult>();
  const cancelIds: string[] = [];
  const setup = new ModelSetupWizardLifecycle(
    "wizard-late",
    transport({
      start: () => started.promise,
      cancel: async () => {
        cancelIds.push("wizard-late");
        return { status: "cancelled" as const };
      }
    }),
    { startWaitMs: 0 }
  );

  await assert.rejects(setup.start(), (error: unknown) => error instanceof ModelSetupWizardStartTimeoutError);
  assert.deepEqual(cancelIds, ["wizard-late"]);

  started.resolve({ ...interactiveStart("wizard-late"), done: false });
  await setup.whenCleanupSettled();
  assert.deepEqual(cancelIds, ["wizard-late", "wizard-late"]);
  assert.equal(setup.phase, "cancelled");
});

test("aborting a start keeps late cleanup attached to the original session", async () => {
  const started = deferred<ModelSetupWizardStartResult>();
  const controller = new AbortController();
  let cancels = 0;
  const setup = new ModelSetupWizardLifecycle(
    "wizard-abort",
    transport({
      start: () => started.promise,
      cancel: async () => {
        cancels += 1;
        return { status: "cancelled" as const };
      }
    }),
    { signal: controller.signal, startWaitMs: 30_000 }
  );

  const pending = setup.start();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancels, 1);

  started.resolve({ ...interactiveStart("wizard-abort"), done: false });
  await setup.whenCleanupSettled();
  assert.equal(cancels, 2);
});

test("running without a step reconciles through status before asking for another step", async () => {
  const calls: string[] = [];
  const setup = new ModelSetupWizardLifecycle(
    "wizard-reconcile",
    transport({
      start: async () => ({ sessionId: "wizard-reconcile", done: false, status: "running" as const }),
      next: async () => {
        calls.push("next");
        return calls.length === 1
          ? { done: false, status: "running" as const }
          : interactiveStart("wizard-reconcile");
      },
      status: async () => {
        calls.push("status");
        return { status: "running" as const };
      }
    }),
    { reconciliationDelayMs: 0 }
  );

  const result = await setup.start();
  assert.equal(result.step?.id, "account");
  assert.deepEqual(calls, ["next", "status", "next"]);
  assert.equal(setup.phase, "active");
});

test("running without a step can settle through status success or error", async () => {
  for (const terminalStatus of ["done", "error"] as const) {
    const calls: string[] = [];
    const setup = new ModelSetupWizardLifecycle(
      `wizard-${terminalStatus}`,
      transport({
        start: async () => ({ sessionId: `wizard-${terminalStatus}`, done: false, status: "running" as const }),
        next: async () => {
          calls.push("next");
          return { done: false, status: "running" as const };
        },
        status: async () => {
          calls.push("status");
          return { status: terminalStatus, ...(terminalStatus === "error" ? { error: "Provider refused sign-in" } : {}) };
        }
      }),
      { reconciliationDelayMs: 0 }
    );

    const result = await setup.start();
    assert.equal(result.done, true);
    assert.equal(result.status, terminalStatus);
    assert.deepEqual(calls, ["next", "status"]);
  }
});

test("reconciliation stops at its retry budget and cancels the session", async () => {
  let cancels = 0;
  const setup = new ModelSetupWizardLifecycle(
    "wizard-budget",
    transport({
      start: async () => ({ sessionId: "wizard-budget", done: false, status: "running" as const }),
      next: async () => ({ done: false, status: "running" as const }),
      status: async () => ({ status: "running" as const }),
      cancel: async () => {
        cancels += 1;
        return { status: "cancelled" as const };
      }
    }),
    { maxReconciliationAttempts: 2, reconciliationDelayMs: 0 }
  );

  await assert.rejects(setup.start(), /still working on this provider connection/);
  assert.equal(cancels, 1);
  assert.equal(setup.phase, "cancelled");
});

test("wizard advancement is single-lane and cancelled results cannot overwrite a newer generation", async () => {
  const nextResult = deferred<{ done: true; status: "done"; modelActivation: { modelRef: string } }>();
  let nextCalls = 0;
  let cancelCalls = 0;
  const setup = new ModelSetupWizardLifecycle(
    "wizard-concurrency",
    transport({
      start: async () => interactiveStart("wizard-concurrency"),
      next: async () => {
        nextCalls += 1;
        return nextResult.promise;
      },
      cancel: async () => {
        cancelCalls += 1;
        return { status: "cancelled" as const };
      }
    })
  );

  await setup.start();
  const first = setup.advance({ stepId: "account", value: "personal" });
  const duplicate = setup.advance({ stepId: "account", value: "backup" });
  await setup.cancel();
  nextResult.resolve({ done: true, status: "done", modelActivation: { modelRef: "openai/late" } });

  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(nextCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.equal(firstResult.status, "cancelled");
  assert.equal(duplicateResult.status, "cancelled");
  assert.equal(setup.phase, "cancelled");
});

test("a late terminal start result does not receive a second cancellation", async () => {
  const started = deferred<ModelSetupWizardStartResult>();
  let cancels = 0;
  const setup = new ModelSetupWizardLifecycle(
    "wizard-terminal-late",
    transport({
      start: () => started.promise,
      cancel: async () => {
        cancels += 1;
        return { status: "cancelled" as const };
      }
    }),
    { startWaitMs: 0 }
  );

  await assert.rejects(setup.start(), ModelSetupWizardStartTimeoutError);
  started.resolve({ done: true, status: "error", error: "Provider rejected the setup", sessionId: "wizard-terminal-late" });
  await setup.whenCleanupSettled();
  assert.equal(cancels, 1);
});
