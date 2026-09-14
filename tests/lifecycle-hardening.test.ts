import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createOrReadLifecycleOperation,
  cleanupLifecycleOperations,
  LifecycleOperationConflictError,
  readLifecycleOperation,
  updateLifecycleOperation,
  withLifecycleOperationLock
} from "@/lib/openclaw/application/lifecycle-operation-store";
import {
  acquireLifecycleOperationLease,
  lifecycleOperationLeasePath
} from "@/lib/openclaw/application/lifecycle-operation-lease";
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
  migrateWorkspaceFilesystemOwnership,
  readWorkspaceFilesystemOwnership,
  readWorkspaceFilesystemOwnershipAtRoot,
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

test("sidecar recovery skips confirmed steps and reruns failed steps", async () => {
  const calls: string[] = [];
  const completed: Record<string, "confirmed" | "failed"> = {
    confirmed: "confirmed",
    retry: "failed"
  };
  const result = await runLifecycleSidecarSteps([
    {
      id: "confirmed",
      label: "confirmed step",
      run: async () => calls.push("confirmed")
    },
    {
      id: "retry",
      label: "retry step",
      run: async () => calls.push("retry")
    }
  ], { completed });

  assert.deepEqual(calls, ["retry"]);
  assert.equal(result.sidecarSynchronized, true);
  assert.deepEqual(result.warnings, []);
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

test("lifecycle operation records migrate from schema v1 and reject stale revisions", async () => {
  const root = await temporaryDirectory();

  try {
    const created = await createOrReadLifecycleOperation({
      kind: "agent.delete",
      targetId: "agent-v1",
      rootPath: root
    });
    const fileName = (await (await import("node:fs/promises")).readdir(root)).find((entry) => entry.endsWith(".json"));
    assert.ok(fileName);
    const filePath = path.join(root, fileName);
    const legacy = {
      schemaVersion: 1,
      operationId: created.operation.operationId,
      idempotencyKey: created.operation.idempotencyKey,
      kind: created.operation.kind,
      targetId: created.operation.targetId,
      state: "partial",
      stage: "cleanup-partial",
      createdAt: created.operation.createdAt,
      updatedAt: created.operation.updatedAt,
      nativeAccepted: true,
      nativeConfirmed: true,
      sidecarSynchronized: false,
      warnings: ["legacy warning"],
      error: null,
      result: { outcome: "partial" },
      metadata: {},
      items: { "agent-v1": "confirmed" }
    };
    await writeFile(filePath, `${JSON.stringify(legacy)}\n`, "utf8");

    const migrated = await readLifecycleOperation("agent.delete", "agent-v1", root);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.revision, 1);
    assert.deepEqual(migrated.sidecars, {});

    const stale = await readLifecycleOperation("agent.delete", "agent-v1", root);
    const current = await updateLifecycleOperation(migrated, { warnings: ["current"] }, root);
    assert.equal(current.revision, 2);
    await assert.rejects(
      () => updateLifecycleOperation(stale, { warnings: ["stale"] }, root),
      (error: unknown) => error instanceof LifecycleOperationConflictError
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle operation retention removes old terminal records but preserves unknown and leased records", async () => {
  const root = await temporaryDirectory();
  const now = new Date("2026-09-14T12:00:00.000Z");

  try {
    const ready = await createOrReadLifecycleOperation({ kind: "agent.delete", targetId: "old-ready", rootPath: root });
    await updateLifecycleOperation(ready.operation, { state: "ready", stage: "complete" }, root);
    const failed = await createOrReadLifecycleOperation({ kind: "agent.delete", targetId: "old-failed", rootPath: root });
    await updateLifecycleOperation(failed.operation, { state: "failed", stage: "reconciling-native-state" }, root);
    const partial = await createOrReadLifecycleOperation({ kind: "agent.delete", targetId: "old-partial", rootPath: root });
    await updateLifecycleOperation(partial.operation, { state: "partial", stage: "cleanup-partial" }, root);
    const unknown = await createOrReadLifecycleOperation({ kind: "agent.delete", targetId: "old-unknown", rootPath: root });
    await updateLifecycleOperation(unknown.operation, { state: "unknown", stage: "reconciling-native-state" }, root);
    const leased = await createOrReadLifecycleOperation({ kind: "agent.delete", targetId: "old-leased", rootPath: root });
    await updateLifecycleOperation(leased.operation, { state: "ready", stage: "complete" }, root);
    const lease = await acquireLifecycleOperationLease({
      resourceKey: "operation:agent.delete:old-leased",
      rootPath: root,
      overrides: { pid: 7171, hostname: "retention-test", processStartIdentity: async () => "retention-start", isProcessAlive: () => true }
    });
    assert.ok(lease);

    const entries = await (await import("node:fs/promises")).readdir(root);
    for (const entry of entries.filter((value) => value.endsWith(".json"))) {
      const filePath = path.join(root, entry);
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      parsed.updatedAt = "2020-01-01T00:00:00.000Z";
      await writeFile(filePath, `${JSON.stringify(parsed)}\n`, "utf8");
    }

    const cleanup = await cleanupLifecycleOperations({ rootPath: root, now, force: true, maxEntries: 100 });
    assert.ok(cleanup.removed >= 3);
    await assert.rejects(() => readLifecycleOperation("agent.delete", "old-ready", root));
    await assert.rejects(() => readLifecycleOperation("agent.delete", "old-failed", root));
    await assert.rejects(() => readLifecycleOperation("agent.delete", "old-partial", root));
    assert.equal((await readLifecycleOperation("agent.delete", "old-unknown", root)).state, "unknown");
    assert.equal((await readLifecycleOperation("agent.delete", "old-leased", root)).state, "ready");
    await lease.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem lifecycle leases block live owners and reclaim stale owners", async () => {
  const root = await temporaryDirectory();
  const overrides = {
    pid: 8282,
    hostname: "lease-test",
    processStartIdentity: async () => "lease-start",
    isProcessAlive: () => true
  };

  try {
    const owner = await acquireLifecycleOperationLease({ resourceKey: "workspace:live", rootPath: root, overrides });
    assert.ok(owner);
    const blocked = await acquireLifecycleOperationLease({ resourceKey: "workspace:live", rootPath: root, waitMs: 0, overrides });
    assert.equal(blocked, null);
    await owner.release();

    await writeFile(lifecycleOperationLeasePath("workspace:stale", root), JSON.stringify({
      schemaVersion: 1,
      leaseId: "stale",
      resourceKey: "workspace:stale",
      pid: 9999,
      hostname: "lease-test",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      ownerStartIdentity: "old-start"
    }), "utf8");
    const reclaimed = await acquireLifecycleOperationLease({
      resourceKey: "workspace:stale",
      rootPath: root,
      overrides: { ...overrides, pid: 8383, processStartIdentity: async () => "new-start" }
    });
    assert.ok(reclaimed);
    await reclaimed.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace and agent lifecycle resource locks cannot overlap", async () => {
  const root = await temporaryDirectory();
  let active = 0;
  let maximumActive = 0;

  try {
    const hold = () => withLifecycleOperationLock({
      kind: "workspace.delete",
      targetId: "workspace-shared",
      resourceKeys: ["workspace:workspace-shared"],
      rootPath: root,
      run: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        active -= 1;
      }
    });
    const conflict = () => withLifecycleOperationLock({
      kind: "agent.delete",
      targetId: "agent-shared",
      resourceKeys: ["workspace:workspace-shared"],
      rootPath: root,
      run: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        active -= 1;
      }
    });
    await Promise.all([hold(), conflict()]);
    assert.equal(maximumActive, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace ownership evidence migrates with a renamed directory without changing ownership", async () => {
  const root = await temporaryDirectory();
  const ownershipRoot = path.join(root, "ownership");
  const oldPath = path.join(root, "old");
  const newPath = path.join(root, "new");
  const contentPath = path.join(oldPath, "user-data.txt");
  await (await import("node:fs/promises")).mkdir(oldPath, { recursive: true });
  await writeFile(contentPath, "preserve me", "utf8");

  try {
    const original = await writeWorkspaceFilesystemOwnership(oldPath, {
      ownership: "user-selected-existing",
      materialization: "existing"
    }, ownershipRoot);
    await (await import("node:fs/promises")).rename(oldPath, newPath);
    const migrated = await migrateWorkspaceFilesystemOwnership({
      fromPath: oldPath,
      toPath: newPath,
      record: original,
      rootPath: ownershipRoot
    });
    const reread = await readWorkspaceFilesystemOwnershipAtRoot(newPath, ownershipRoot);

    assert.equal(migrated.migrated, true);
    assert.equal(migrated.oldEvidenceRemoved, true);
    assert.equal(reread?.ownership, "user-selected-existing");
    assert.equal(reread?.materialization, "existing");
    assert.deepEqual(reread?.directoryIdentity, original.directoryIdentity);
    assert.equal(await readFile(path.join(newPath, "user-data.txt"), "utf8"), "preserve me");
    assert.equal(await readWorkspaceFilesystemOwnershipAtRoot(oldPath, ownershipRoot), null);
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
