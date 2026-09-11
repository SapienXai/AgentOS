import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  persistWorkspaceIntelligenceBinding,
  readWorkspaceIntelligenceBinding,
  validateWorkspaceIntelligenceBinding
} from "@/lib/agentos/application/workspace-intelligence-binding-store";
import { workspaceCreationActorHash } from "@/lib/agentos/application/workspace-creation-run-store";

function input(rootPath: string, provisioningRunId: string, expectedCurrentProvisioningRunId?: string | null) {
  return {
    rootPath,
    actorId: "binding-test-actor",
    workspaceId: "workspace-binding-test",
    sourceGenerationId: "source-generation-1",
    projectIntelligencePackId: "pack-1",
    projectIntelligenceGenerationId: "generation-1",
    blueprintId: "blueprint-1",
    blueprintFingerprint: "a".repeat(64),
    compositionPlan: { planId: "composition-1", inputFingerprint: "b".repeat(64) },
    provisioningRunId,
    status: "current" as const,
    ...(expectedCurrentProvisioningRunId !== undefined ? { expectedCurrentProvisioningRunId } : {})
  };
}

test("binding writes are actor/workspace scoped and readable only with matching identity", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-intelligence-binding-"));
  try {
    const stored = await persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-1"));
    assert.equal(stored.actorHash, workspaceCreationActorHash("binding-test-actor"));
    assert.equal((await readWorkspaceIntelligenceBinding({ rootPath, actorId: "binding-test-actor", workspaceId: "workspace-binding-test" }))?.provisioningRunId, "provisioning-1");
    assert.equal(await readWorkspaceIntelligenceBinding({ rootPath, actorId: "other-actor", workspaceId: "workspace-binding-test" }), null);
    assert.equal(await readWorkspaceIntelligenceBinding({ rootPath, actorId: "binding-test-actor", workspaceId: "other-workspace" }), null);
    assert.equal(validateWorkspaceIntelligenceBinding({ ...stored, actorHash: "short" }), false);
    assert.equal(validateWorkspaceIntelligenceBinding({ ...stored, extra: "bypass" }), false);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("binding CAS prevents a stale provisioning run from overwriting a newer binding", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-intelligence-binding-cas-"));
  try {
    await persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-old", null));
    await persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-new", "provisioning-old"));
    await assert.rejects(
      persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-old", "provisioning-old")),
      /binding changed/i
    );
    assert.equal((await readWorkspaceIntelligenceBinding({ rootPath, actorId: "binding-test-actor", workspaceId: "workspace-binding-test" }))?.provisioningRunId, "provisioning-new");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("simultaneous first binding writes have one winner for a workspace", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-intelligence-binding-race-"));
  try {
    const results = await Promise.allSettled([
      persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-a", null)),
      persistWorkspaceIntelligenceBinding(input(rootPath, "provisioning-b", null))
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("tampered bindings fail closed at the read boundary", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-intelligence-binding-tamper-"));
  const actorId = "binding-tamper-actor";
  const workspaceId = "workspace-binding-tamper";
  try {
    const stored = await persistWorkspaceIntelligenceBinding({ ...input(rootPath, "provisioning-tamper"), actorId, workspaceId });
    const workspaceHash = createHash("sha256").update(workspaceId).digest("hex").slice(0, 32);
    const target = path.join(rootPath, `${workspaceCreationActorHash(actorId)}-${workspaceHash}.json`);
    await writeFile(target, JSON.stringify({ ...stored, blueprintFingerprint: "not-a-fingerprint" }), "utf8");
    assert.equal(await readWorkspaceIntelligenceBinding({ rootPath, actorId, workspaceId }), null);

    await writeFile(target, JSON.stringify({ ...stored, extra: "bypass" }), "utf8");
    assert.equal(await readWorkspaceIntelligenceBinding({ rootPath, actorId, workspaceId }), null);

    await writeFile(target, JSON.stringify({ ...stored, actorHash: workspaceCreationActorHash("other-actor") }), "utf8");
    assert.equal(await readWorkspaceIntelligenceBinding({ rootPath, actorId, workspaceId }), null);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
