import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOrReadLifecycleOperation,
  readLifecycleOperation,
  updateLifecycleOperation,
  withLifecycleOperationLock
} from "@/lib/openclaw/application/lifecycle-operation-store";
import {
  executeNativeMutationWithVerification
} from "@/lib/openclaw/application/native-mutation-service";
import { runLifecycleSidecarSteps } from "@/lib/openclaw/application/lifecycle-sidecar-service";
import {
  reconcileLifecycleState
} from "@/lib/openclaw/application/lifecycle-reconciliation";
import {
  decideWorkspaceFilesystemCleanup,
  isAgentOsOwnedWorkspaceFilesystem,
  readWorkspaceFilesystemOwnership,
  resolveWorkspaceFilesystemOwnership,
  workspaceFilesystemOwnershipPath,
  writeWorkspaceFilesystemOwnership
} from "@/lib/openclaw/domains/workspace-filesystem-ownership";
import { NativeGatewayRequestError } from "@/lib/openclaw/client/native-ws-gateway-errors";

async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "agentos-lifecycle-hardening-"));
}

test("workspace deletion requires explicit AgentOS ownership evidence", async () => {
  const root = await temporaryDirectory();
  const existing = path.join(root, "existing");
  await writeFile(path.join(root, "keep.txt"), "user data", "utf8");
  await (await import("node:fs/promises")).mkdir(existing, { recursive: true });

  try {
    assert.equal(isAgentOsOwnedWorkspaceFilesystem("agentos-created-empty"), true);
    assert.equal(isAgentOsOwnedWorkspaceFilesystem("agentos-created-clone"), true);
    assert.equal(isAgentOsOwnedWorkspaceFilesystem("user-selected-existing"), false);
    assert.equal(isAgentOsOwnedWorkspaceFilesystem("unknown"), false);
    assert.equal(resolveWorkspaceFilesystemOwnership(await readWorkspaceFilesystemOwnership(existing)), "unknown");

    await writeWorkspaceFilesystemOwnership(existing, {
      ownership: "user-selected-existing",
      materialization: "existing"
    });
    assert.equal(resolveWorkspaceFilesystemOwnership(await readWorkspaceFilesystemOwnership(existing)), "user-selected-existing");
    assert.equal(isAgentOsOwnedWorkspaceFilesystem(resolveWorkspaceFilesystemOwnership(await readWorkspaceFilesystemOwnership(existing))), false);

    assert.deepEqual(decideWorkspaceFilesystemCleanup({ nativeConfirmed: true, ownership: "agentos-created-empty" }), {
      action: "delete",
      reason: "agentos-owned"
    });
    assert.deepEqual(decideWorkspaceFilesystemCleanup({ nativeConfirmed: true, ownership: "user-selected-existing" }), {
      action: "preserve",
      reason: "ownership-not-proven"
    });
    assert.deepEqual(decideWorkspaceFilesystemCleanup({ nativeConfirmed: false, ownership: "agentos-created-clone" }), {
      action: "preserve",
      reason: "native-state-not-confirmed"
    });

    await writeFile(workspaceFilesystemOwnershipPath(existing), "{}", "utf8");
    assert.equal(resolveWorkspaceFilesystemOwnership(await readWorkspaceFilesystemOwnership(existing)), "unknown");
    assert.equal((await readFile(path.join(root, "keep.txt"), "utf8")), "user data");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle reconciliation is bounded and read-only", async () => {
  let reads = 0;
  const result = await reconcileLifecycleState({
    attempts: 3,
    delayMs: 0,
    read: async () => {
      reads += 1;
      return { present: true };
    },
    isConfirmed: (value) => !value.present
  });

  assert.equal(result.outcome, "not-confirmed");
  assert.equal(result.attempts, 3);
  assert.equal(reads, 3);
});

test("lifecycle reconciliation can confirm eventual native state without repeating a mutation", async () => {
  let reads = 0;
  const result = await reconcileLifecycleState({
    attempts: 3,
    delayMs: 0,
    read: async () => {
      reads += 1;
      return { present: reads < 3 };
    },
    isConfirmed: (value) => !value.present
  });

  assert.equal(result.outcome, "confirmed");
  assert.equal(result.attempts, 3);
  assert.equal(reads, 3);
});

test("ambiguous native lifecycle delivery never repeats the mutation", async () => {
  let mutationCalls = 0;
  let verificationCalls = 0;
  const result = await executeNativeMutationWithVerification({
    operation: "agent.delete",
    mutate: async () => {
      mutationCalls += 1;
      throw new NativeGatewayRequestError("timed out after dispatch", "agents.delete", true, { kind: "timeout" });
    },
    verify: async () => {
      verificationCalls += 1;
      return false;
    }
  });

  assert.equal(result.outcome, "unknown");
  assert.equal(result.retryable, false);
  assert.equal(mutationCalls, 1);
  assert.equal(verificationCalls, 1);
});

test("native deletion failure or failed verification cannot enter filesystem cleanup", async () => {
  const rejected = await executeNativeMutationWithVerification({
    operation: "workspace.delete.agent",
    mutate: async () => {
      throw new NativeGatewayRequestError("request was not sent", "agents.delete", false, { kind: "timeout" });
    },
    verify: async () => false
  });
  assert.equal(rejected.outcome, "failed");
  assert.deepEqual(decideWorkspaceFilesystemCleanup({ nativeConfirmed: false, ownership: "agentos-created-empty" }), {
    action: "preserve",
    reason: "native-state-not-confirmed"
  });

  const unverified = await executeNativeMutationWithVerification({
    operation: "workspace.delete.agent",
    mutate: async () => undefined,
    verify: async () => false
  });
  assert.equal(unverified.outcome, "unknown");
  assert.deepEqual(decideWorkspaceFilesystemCleanup({ nativeConfirmed: false, ownership: "agentos-created-clone" }), {
    action: "preserve",
    reason: "native-state-not-confirmed"
  });
});

test("successful native lifecycle response still requires final-state proof", async () => {
  let mutationCalls = 0;
  const result = await executeNativeMutationWithVerification({
    operation: "agent.create",
    mutate: async () => {
      mutationCalls += 1;
      return { accepted: true };
    },
    verify: async () => true
  });

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.result?.accepted, true);
  assert.equal(mutationCalls, 1);
});

test("post-native sidecar failures are partial and independent cleanup continues", async () => {
  const completed: string[] = [];
  const result = await runLifecycleSidecarSteps([
    {
      label: "disconnect channel channel-a",
      run: async () => {
        throw new Error("channel cleanup failed");
      }
    },
    {
      label: "finish config cleanup",
      run: async () => {
        throw new Error("config cleanup failed with token=secret-value");
      }
    },
    {
      label: "sync workspace metadata",
      run: async () => {
        completed.push("metadata");
      }
    }
  ]);

  assert.equal(result.sidecarSynchronized, false);
  assert.equal(completed[0], "metadata");
  assert.equal(result.warnings.length, 2);
  assert.equal(result.warnings.some((warning) => warning.includes("secret-value")), false);
});

test("lifecycle operation records are durable and idempotent", async () => {
  const root = await temporaryDirectory();

  try {
    const first = await createOrReadLifecycleOperation({
      kind: "workspace.delete",
      targetId: "workspace-a",
      rootPath: root,
      metadata: { workspaceId: "workspace-a", workspacePath: "/tmp/workspace-a" }
    });
    const second = await createOrReadLifecycleOperation({
      kind: "workspace.delete",
      targetId: "workspace-a",
      rootPath: root
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.operation.operationId, first.operation.operationId);

    const updated = await updateLifecycleOperation(first.operation, {
      state: "partial",
      stage: "complete",
      warnings: ["Channel cleanup needs attention."],
      result: { outcome: "partial", workspaceId: "workspace-a" }
    }, root);
    const reread = await readLifecycleOperation("workspace.delete", "workspace-a", root);
    assert.equal(reread.operationId, updated.operationId);
    assert.equal(reread.state, "partial");
    assert.deepEqual(reread.result, { outcome: "partial", workspaceId: "workspace-a" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-target lifecycle requests serialize native work in one process", async () => {
  const root = await temporaryDirectory();
  let active = 0;
  let maximumActive = 0;

  try {
    const run = (label: string) => withLifecycleOperationLock({
      kind: "agent.delete",
      targetId: "agent-a",
      rootPath: root,
      run: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return label;
      }
    });

    const results = await Promise.all([run("first"), run("second")]);
    assert.deepEqual(results, ["first", "second"]);
    assert.equal(maximumActive, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
