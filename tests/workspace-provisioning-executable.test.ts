import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  getWorkspaceProvisioningRun,
  provisionWorkspaceFromBlueprint,
  resumeWorkspaceProvisioningRun,
  waitForWorkspaceProvisioning,
  WorkspaceProvisioningError,
  type WorkspaceProvisioningDependencies
} from "@/lib/agentos/application/workspace-provisioning-service";
import { composeWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";
import {
  acquireProvisioningLease,
  resolveLeasePath,
  type ProvisioningLeaseRecord
} from "@/lib/agentos/application/workspace-provisioning-lease";
import {
  buildProvisioningStorageKey,
  createRunAtomically,
  findRunById,
  updateStoredRun,
  writeAtomicJson
} from "@/lib/agentos/application/workspace-provisioning-store";
import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { createWorkspaceAgentId } from "@/lib/openclaw/domains/agent-provisioning";
import { buildWorkspaceScaffoldDocumentPaths } from "@/lib/openclaw/workspace-docs";
import type { MissionControlSnapshot, WorkspaceCreateResult } from "@/lib/openclaw/types";

function blueprint(overrides: Partial<WorkspaceBlueprint> = {}): WorkspaceBlueprint {
  const base: WorkspaceBlueprint = {
    schemaVersion: 1,
    status: "ready",
    id: "blueprint-executable",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    identity: { name: "Acme", purpose: "Operate Acme", projectType: "general" },
    brief: "Build an Acme workspace.",
    operatorConstraints: [],
    materialization: { mode: "empty" },
    knowledge: {
      sources: [],
      generationId: null,
      sourceIds: [],
      coverage: { sourceCount: 0, readySourceCount: 0, documentCount: 0 },
      retrieval: { mode: "none", queries: [], evidenceRefs: [] }
    },
    workforce: {
      primaryAgent: {
        id: "primary-operator",
        role: "Operator",
        name: "Acme Operator",
        enabled: true,
        persistence: "primary",
        isPrimary: true,
        purpose: "Operate the workspace.",
        responsibilities: ["Operate the workspace."],
        outputs: ["Verified handoff"],
        skillIds: [],
        toolIds: [],
        policy: {
          preset: "worker",
          missingToolBehavior: "fallback",
          installScope: "none",
          fileAccess: "workspace-only",
          networkAccess: "restricted"
        },
        justification: "Primary operator.",
        evidenceRefs: []
      },
      specialists: [],
      allowEphemeralSubagents: true,
      maxParallelRuns: 2
    },
    capabilities: { skills: [], tools: [] },
    memory: {
      ownership: "openclaw-native",
      search: "native-gateway-preferred",
      seedRequired: false,
      durableFacts: [],
      rationale: "OpenClaw owns memory."
    },
    connections: [],
    operations: { workflows: [], automations: [], channels: [] },
    safety: {
      workspaceOnly: true,
      generationSideEffectFree: true,
      importedKnowledgeUntrusted: true,
      notes: []
    },
    recommendations: [],
    assumptions: [],
    warnings: [],
    evidence: [],
    operatorOverrides: { lockedPaths: [], lockedDecisions: [] },
    provenance: {
      architectRunId: "architect-executable",
      inputFingerprint: "a".repeat(64),
      knowledgeGenerationId: null,
      sourceIds: [],
      createdAt: "2026-09-10T00:00:00.000Z",
      modelId: null,
      runtime: "native-openclaw",
      reasoningMode: "openclaw-agent",
      failureKind: "none",
      policyVersion: "phase6-intelligence-aware-architect-v1"
    }
  };
  return { ...base, ...overrides };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function blueprintFingerprint(value: WorkspaceBlueprint) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function operationSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    mode: "live" as const,
    diagnostics: {},
    presence: [],
    channelAccounts: [],
    workspaces: [],
    agents: [],
    models: [],
    runtimes: [],
    tasks: [],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {},
    surfaceRuntime: {},
    surfaceDrift: {}
  } as unknown as MissionControlSnapshot;
}

function createAtomicCreateBarrier(expectedCalls = 2) {
  let arrivals = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === expectedCalls) release?.();
    await gate;
  };
}

function createHarness(rootPath: string, options: {
  delayMs?: number;
  failCreate?: boolean;
  failAfterCreate?: boolean;
  failCapabilityOnce?: boolean;
  hideAgents?: boolean;
  hideWorkspaces?: boolean;
} = {}) {
  const workspaceRoot = path.join(rootPath, "workspaces");
  const workspaces = new Map<string, { result: WorkspaceCreateResult; agents: Array<Record<string, unknown>> }>();
  let createCount = 0;
  let updateCount = 0;
  let snapshotCount = 0;

  const createWorkspaceProject: NonNullable<WorkspaceProvisioningDependencies["createWorkspaceProject"]> = async (input) => {
    createCount += 1;
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    if (options.failCreate) throw new Error("Gateway bootstrap failed in harness.");
    const workspacePath = path.join(workspaceRoot, slugify(input.name));
    const workspaceId = `workspace-${slugify(input.name)}`;
    const agents = (input.agents ?? []).map((agent) => ({
      id: createWorkspaceAgentId(slugify(input.name), agent.id),
      name: agent.name,
      role: agent.role,
      enabled: agent.enabled,
      isPrimary: agent.isPrimary === true,
      skillIds: agent.skillIds ?? [],
      toolIds: agent.toolIds ?? [],
      policy: agent.policy
    }));
    await mkdir(workspacePath, { recursive: true });
    await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
    await writeFile(path.join(workspacePath, ".openclaw", "project.json"), JSON.stringify({
      version: 2,
      name: input.name,
      directory: workspacePath,
      template: input.template,
      materialization: input.materialization,
      agents,
      channels: []
    }));
    for (const relativePath of buildWorkspaceScaffoldDocumentPaths(input.template ?? "software", {
      workspaceOnly: true,
      generateStarterDocs: true,
      generateMemory: true,
      kickoffMission: false
    })) {
      const target = path.join(workspacePath, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `# ${relativePath}\n`);
    }
    if (options.failAfterCreate) throw new Error("Harness crashed after workspace creation.");
    const result: WorkspaceCreateResult = {
      workspaceId,
      workspaceName: input.name,
      workspacePath,
      agentIds: agents.map((agent) => String(agent.id)),
      primaryAgentId: String(agents.find((agent) => agent.isPrimary)?.id ?? agents[0]?.id)
    };
    workspaces.set(workspaceId, { result, agents });
    return result;
  };

  const getMissionControlSnapshot: NonNullable<WorkspaceProvisioningDependencies["getMissionControlSnapshot"]> = async () => {
    snapshotCount += 1;
    if (options.failCapabilityOnce && snapshotCount === 2) throw new Error("Harness crashed after agent verification.");
    const snapshot = operationSnapshot() as MissionControlSnapshot;
    snapshot.workspaces = options.hideWorkspaces ? [] : [...workspaces.values()].map(({ result }) => ({
      id: result.workspaceId,
      name: result.workspaceName ?? result.workspaceId,
      path: result.workspacePath
    } as never));
    snapshot.agents = options.hideAgents ? [] : [...workspaces.values()].flatMap(({ result, agents }) => agents.map((agent) => ({
      ...agent,
      workspaceId: result.workspaceId,
      workspacePath: result.workspacePath,
      modelId: "test/model",
      isDefault: agent.isPrimary === true,
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: "",
      activeRuntimeIds: [],
      heartbeat: { enabled: false, every: null, everyMs: null },
      identity: {},
      profile: { purpose: null, operatingInstructions: [], responseStyle: [], outputPreference: null, sourceFiles: [] },
      skills: agent.skillIds,
      tools: agent.toolIds,
      policy: agent.policy
    } as never)));
    return snapshot;
  };

  const dependencies: WorkspaceProvisioningDependencies = {
    rootPath,
    createWorkspaceProject,
    getMissionControlSnapshot,
    readWorkspaceCreationContext: async () => {
      throw new Error("No staged context is expected for this harness.");
    },
    readKnowledgeSnapshot: async () => null,
    ensureWorkspaceNativeKnowledge: async () => {
      throw new Error("Native binding should not be called without knowledge sources.");
    },
    updateAgent: async (input) => {
      updateCount += 1;
      return { agentId: input.id, workspaceId: input.workspaceId ?? "test-workspace" };
    }
  };
  return {
    dependencies,
    counts: () => ({ createCount, updateCount }),
    workspaces
  };
}

async function eventually<T>(read: () => Promise<T>, predicate: (value: T) => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return read();
}

test("fresh provisioning executes through the injected canonical OpenClaw workspace boundary", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const input = { actorId: "actor-fresh", blueprint: blueprint(), idempotencyKey: "fresh-run", acceptDraft: true };
    const started = await provisionWorkspaceFromBlueprint(input, harness.dependencies);
    const finished = await waitForWorkspaceProvisioning(input, harness.dependencies);

    assert.equal(started.state, "pending");
    assert.equal(finished.state, "ready");
    assert.equal(harness.counts().createCount, 1);
    assert.ok(finished.completedSteps["workspace-materialized"]);
    assert.ok(finished.completedSteps["final-verification-complete"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("provisioning applies the reviewed composition plan in its own durable step", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-composition-"));
  try {
    const harness = createHarness(rootPath);
    const value = blueprint();
    const composition = await composeWorkspaceComposition({
      blueprint: value,
      operatorIntent: { brief: value.brief, constraints: [] }
    }, {
      runId: "provisioned-composition",
      modelExecutor: async () => ({
        text: JSON.stringify({
          schemaVersion: 1,
          policyVersion: "phase7-safe-workspace-composition-v1",
          artifacts: [{
            artifactId: "project-profile",
            title: "Project profile",
            sections: ["Overview"],
            body: "# Project Profile\n\nProvisioned from a reviewed plan.",
            sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] },
            blueprintRefs: []
          }],
          warnings: []
        }),
        runtime: "model-runtime" as const,
        runId: null,
        sessionKey: null
      })
    });
    const input = {
      actorId: "actor-composition",
      blueprint: value,
      idempotencyKey: "composition-run",
      acceptDraft: true,
      draftContextId: "11111111-1111-4111-8111-111111111111",
      compositionPlanId: composition.plan.planId,
      compositionPlanFingerprint: composition.plan.inputFingerprint
    };
    const finished = await waitForWorkspaceProvisioning(input, {
      ...harness.dependencies,
      readWorkspaceCreationContext: async () => ({
        runStatus: "ready",
        reused: false,
        generationId: null,
        sources: [],
        documents: [],
        warnings: [],
        knowledge: { generationId: null, sources: [], documents: [], warnings: [] }
      } as never),
      readWorkspaceCreationCompositionPlan: async () => composition.plan
    });
    assert.equal(finished.state, "ready");
    assert.equal(finished.composition?.status, "ready");
    assert.equal(finished.composition?.artifactCount, 1);
    assert.ok(finished.completedSteps["composition-applied"]);
    const workspacePath = finished.result?.workspacePath;
    assert.ok(workspacePath);
    assert.match(await readFile(path.join(workspacePath, "docs", "project-profile.md"), "utf8"), /Provisioned from a reviewed plan/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("knowledge promotion is durable, idempotent, and followed by native binding", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const source = createWorkspaceKnowledgeSource({
      id: "project-source",
      kind: "website",
      label: "Acme website",
      summary: "Acme project context.",
      locator: { kind: "website", url: "https://example.com" },
      provenance: "wizard"
    });
    let targetKnowledge: unknown = null;
    let promotionCount = 0;
    let bindingCount = 0;
    const stagedContext = {
      draftContextId: "11111111-1111-4111-8111-111111111111",
      generationId: "staged-generation",
      runStatus: "ready" as const,
      reused: false,
      sources: [source],
      sourceReports: [],
      warnings: [],
      knowledge: {
        generationId: "staged-generation",
        sources: [source],
        documents: [{ sourceId: source.id, title: "README", contentLength: 40 }],
        warnings: []
      }
    };
    const dependencies: WorkspaceProvisioningDependencies = {
      ...harness.dependencies,
      readWorkspaceCreationContext: async () => stagedContext,
      readKnowledgeSnapshot: async () => targetKnowledge as never,
      promoteWorkspaceCreationKnowledge: async () => {
        promotionCount += 1;
        targetKnowledge = {
          state: { generationId: "promoted-generation", sourceReports: [{ sourceId: source.id }] },
          documents: [{ sourceId: source.id, outputPath: "sources/project-source/readme.md" }]
        };
        if (promotionCount === 1) throw new Error("Harness crashed after knowledge promotion.");
        return {
          stagedGenerationId: "staged-generation",
          generationId: "promoted-generation",
          sourceIds: [source.id],
          documentCount: 1
        };
      },
      ensureWorkspaceNativeKnowledge: async () => {
        bindingCount += 1;
        return {
          status: "applied",
          indexRefresh: [],
          warnings: [],
          errors: [],
          restartRequired: false
        } as never;
      }
    };
    const input = {
      actorId: "actor-knowledge",
      blueprint: blueprint({
        knowledge: {
          sources: [source],
          generationId: "staged-generation",
          sourceIds: [source.id],
          coverage: { sourceCount: 1, readySourceCount: 1, documentCount: 1 },
          retrieval: { mode: "bounded-corpus-assembly", queries: [], evidenceRefs: [] }
        },
        provenance: {
          ...blueprint().provenance,
          knowledgeGenerationId: "staged-generation",
          sourceIds: [source.id]
        }
      }),
      draftContextId: stagedContext.draftContextId,
      expectedKnowledgeGenerationId: "staged-generation",
      idempotencyKey: "knowledge-key",
      acceptDraft: true
    };
    const failed = await waitForWorkspaceProvisioning(input, dependencies);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error?.code, "knowledge-promotion");
    const finished = await waitForWorkspaceProvisioning(input, dependencies);
    assert.equal(finished.state, "ready");
    assert.equal(promotionCount, 1);
    assert.equal(bindingCount, 1);
    assert.equal(finished.knowledge?.promotedGenerationId, "promoted-generation");
    assert.equal(finished.nativeKnowledge?.status, "configured");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("same idempotency key is convergent and changed blueprint is rejected", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const input = { actorId: "actor-idempotent", blueprint: blueprint(), idempotencyKey: "same-key", acceptDraft: true };
    const first = await waitForWorkspaceProvisioning(input, harness.dependencies);
    const second = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(first.runId, second.runId);
    assert.equal(harness.counts().createCount, 1);
    await assert.rejects(
      () => provisionWorkspaceFromBlueprint({ ...input, blueprint: blueprint({ brief: "A changed brief." }) }, harness.dependencies),
      (error: unknown) => error instanceof WorkspaceProvisioningError && error.code === "idempotency-conflict"
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("idempotency records are scoped to the authenticated actor", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const first = await waitForWorkspaceProvisioning({
      actorId: "actor-a",
      blueprint: blueprint(),
      idempotencyKey: "shared-key",
      acceptDraft: true
    }, harness.dependencies);
    const second = await waitForWorkspaceProvisioning({
      actorId: "actor-b",
      blueprint: blueprint(),
      idempotencyKey: "shared-key",
      acceptDraft: true
    }, harness.dependencies);
    assert.notEqual(first.runId, second.runId);
    assert.equal(harness.counts().createCount, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("concurrent submissions create one durable run and one workspace", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath, { delayMs: 25 });
    const beforeAtomicRunCreate = createAtomicCreateBarrier();
    const input = { actorId: "actor-concurrent", blueprint: blueprint(), idempotencyKey: "concurrent-key", acceptDraft: true };
    const started = await Promise.all([
      provisionWorkspaceFromBlueprint(input, { ...harness.dependencies, beforeAtomicRunCreate }),
      provisionWorkspaceFromBlueprint(input, { ...harness.dependencies, beforeAtomicRunCreate })
    ]);
    const finished = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(started[0].runId, started[1].runId);
    assert.equal(finished.state, "ready");
    assert.equal(harness.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("atomic store creation reports one winner and one reused run", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-store-"));
  try {
    const storageKey = buildProvisioningStorageKey("actor-store-race", "store-race-key");
    const firstBlueprint = blueprint({ brief: "First immutable intent." });
    const secondBlueprint = blueprint({ brief: "Second immutable intent." });
    const results = await Promise.all([
      createRunAtomically(rootPath, storageKey, {
        actorId: "actor-store-race",
        blueprint: firstBlueprint,
        blueprintFingerprint: blueprintFingerprint(firstBlueprint),
        draftContextId: null,
        expectedKnowledgeGenerationId: null
      }),
      createRunAtomically(rootPath, storageKey, {
        actorId: "actor-store-race",
        blueprint: secondBlueprint,
        blueprintFingerprint: blueprintFingerprint(secondBlueprint),
        draftContextId: null,
        expectedKnowledgeGenerationId: null
      })
    ]);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(results.filter((result) => !result.created).length, 1);
    assert.equal(results[0].run.runId, results[1].run.runId);
    const stored = await findRunById(rootPath, "actor-store-race", results[0].run.runId);
    assert.ok(stored);
    await assert.rejects(
      () => updateStoredRun(stored.filePath, stored.run, { blueprintId: "mutated-blueprint" }),
      /immutable/
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("different blueprints racing on one idempotency key conflict before execution", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const beforeAtomicRunCreate = createAtomicCreateBarrier();
    const inputA = {
      actorId: "actor-blueprint-race",
      blueprint: blueprint({ identity: { ...blueprint().identity, name: "Acme" }, brief: "Build Acme." }),
      idempotencyKey: "blueprint-race-key",
      acceptDraft: true
    };
    const inputB = {
      ...inputA,
      blueprint: blueprint({ identity: { ...blueprint().identity, name: "Beta" }, brief: "Build Beta." })
    };
    const results = await Promise.allSettled([
      provisionWorkspaceFromBlueprint(inputA, { ...harness.dependencies, beforeAtomicRunCreate }),
      provisionWorkspaceFromBlueprint(inputB, { ...harness.dependencies, beforeAtomicRunCreate })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof WorkspaceProvisioningError);
    assert.equal((rejected[0].reason as WorkspaceProvisioningError).code, "idempotency-conflict");
    const winnerInput = results[0].status === "fulfilled" ? inputA : inputB;
    const finished = await waitForWorkspaceProvisioning(winnerInput, harness.dependencies);
    assert.equal(finished.state, "ready");
    assert.equal(harness.counts().createCount, 1);
    assert.equal(finished.result?.workspaceName, winnerInput.blueprint.identity.name);
    const stored = await findRunById(rootPath, winnerInput.actorId, finished.runId);
    assert.ok(stored);
    assert.equal(stored.run.blueprintId, winnerInput.blueprint.id);
    assert.equal(stored.run.blueprintFingerprint, blueprintFingerprint(winnerInput.blueprint));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("different draft contexts and generations racing on one key conflict before execution", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const beforeAtomicRunCreate = createAtomicCreateBarrier();
    const inputBase = {
      actorId: "actor-context-race",
      blueprint: blueprint(),
      idempotencyKey: "context-race-key",
      acceptDraft: true
    };
    const contextA = {
      draftContextId: "33333333-3333-4333-8333-333333333333",
      generationId: "generation-a",
      runStatus: "ready" as const,
      reused: false,
      sources: [],
      sourceReports: [],
      warnings: [],
      knowledge: { generationId: "generation-a", sources: [], documents: [], warnings: [] }
    };
    const contextB = { ...contextA, draftContextId: "44444444-4444-4444-8444-444444444444", generationId: "generation-b", knowledge: { ...contextA.knowledge, generationId: "generation-b" } };
    const inputA = { ...inputBase, draftContextId: contextA.draftContextId, expectedKnowledgeGenerationId: contextA.generationId };
    const inputB = { ...inputBase, draftContextId: contextB.draftContextId, expectedKnowledgeGenerationId: contextB.generationId };
    const dependenciesA = { ...harness.dependencies, beforeAtomicRunCreate, readWorkspaceCreationContext: async () => contextA };
    const dependenciesB = { ...harness.dependencies, beforeAtomicRunCreate, readWorkspaceCreationContext: async () => contextB };
    const results = await Promise.allSettled([
      provisionWorkspaceFromBlueprint(inputA, dependenciesA),
      provisionWorkspaceFromBlueprint(inputB, dependenciesB)
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const loser = results.find((result) => result.status === "rejected");
    assert.ok(loser && loser.status === "rejected");
    assert.ok(loser.reason instanceof WorkspaceProvisioningError);
    assert.equal((loser.reason as WorkspaceProvisioningError).code, "idempotency-conflict");
    const winnerInput = results[0].status === "fulfilled" ? inputA : inputB;
    const winnerDependencies = results[0].status === "fulfilled" ? dependenciesA : dependenciesB;
    const finished = await waitForWorkspaceProvisioning(winnerInput, winnerDependencies);
    assert.equal(finished.state, "ready");
    assert.equal(harness.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a persisted non-terminal run resumes after the in-memory executor is absent", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const inputBlueprint = blueprint();
    const storageKey = buildProvisioningStorageKey("actor-restart", "restart-key");
    const created = await createRunAtomically(rootPath, storageKey, {
      actorId: "actor-restart",
      blueprint: inputBlueprint,
      blueprintFingerprint: blueprintFingerprint(inputBlueprint),
      draftContextId: null,
      expectedKnowledgeGenerationId: null
    });
    assert.equal(created.created, true);
    const result = await resumeWorkspaceProvisioningRun({ actorId: "actor-restart", runId: created.run.runId }, harness.dependencies);
    assert.equal(result?.runId, created.run.runId);
    const finished = await eventually(
      () => getWorkspaceProvisioningRun({ actorId: "actor-restart", runId: created.run.runId }, harness.dependencies),
      (value): value is NonNullable<typeof value> => Boolean(value && (value.state === "ready" || value.state === "failed"))
    );
    assert.equal(finished?.state, "ready");
    assert.equal(harness.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("partial workspace state is repaired through the canonical OpenClaw create boundary", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const input = { actorId: "actor-repair", blueprint: blueprint(), idempotencyKey: "repair-key", acceptDraft: true };
    const first = await waitForWorkspaceProvisioning(input, harness.dependencies);
    const locator = await findRunById(rootPath, input.actorId, first.runId);
    assert.ok(locator);
    const manifestPath = path.join(first.result?.workspacePath ?? "", ".openclaw", "project.json");
    await writeFile(manifestPath, JSON.stringify({ version: 2, name: "Acme", directory: first.result?.workspacePath, agents: [], channels: [] }));
    await updateStoredRun(locator.filePath, locator.run, {
      state: "failed",
      error: { code: "agent-provisioning", message: "Synthetic interrupted agent repair." }
    });
    const repaired = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(repaired.state, "ready");
    assert.equal(repaired.attempt, 2);
    assert.equal(harness.counts().createCount, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a conflicting existing workspace identity is never overwritten on retry", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const input = { actorId: "actor-conflict", blueprint: blueprint(), idempotencyKey: "conflict-key", acceptDraft: true };
    const first = await waitForWorkspaceProvisioning(input, harness.dependencies);
    const locator = await findRunById(rootPath, input.actorId, first.runId);
    assert.ok(locator);
    const manifestPath = path.join(first.result?.workspacePath ?? "", ".openclaw", "project.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, name: "Another Workspace" }));
    await updateStoredRun(locator.filePath, locator.run, {
      state: "failed",
      error: { code: "verification-failed", message: "Synthetic interrupted verification." }
    });
    const retried = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(retried.state, "failed");
    assert.equal(retried.error?.code, "workspace-conflict");
    assert.equal(harness.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("runtime bootstrap failure is durable and retryable without a final workspace claim", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const failing = createHarness(rootPath, { failCreate: true });
    const input = { actorId: "actor-failure", blueprint: blueprint(), idempotencyKey: "failure-key", acceptDraft: true };
    const failed = await waitForWorkspaceProvisioning(input, failing.dependencies);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error?.code, "bootstrap");
    assert.equal(failed.workspaceId, null);

    const succeeding = createHarness(rootPath);
    const retried = await waitForWorkspaceProvisioning(input, succeeding.dependencies);
    assert.equal(retried.state, "ready");
    assert.equal(retried.attempt, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("concurrent retries converge on one durable provisioning attempt", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-retry-race-"));
  try {
    const failing = createHarness(rootPath, { failCreate: true });
    const input = { actorId: "actor-retry-race", blueprint: blueprint(), idempotencyKey: "retry-race-key", acceptDraft: true };
    const failed = await waitForWorkspaceProvisioning(input, failing.dependencies);
    assert.equal(failed.state, "failed");

    const succeeding = createHarness(rootPath, { delayMs: 20 });
    const retries = await Promise.all([
      waitForWorkspaceProvisioning(input, succeeding.dependencies),
      waitForWorkspaceProvisioning(input, succeeding.dependencies)
    ]);

    assert.ok(retries.every((retry) => retry.state === "ready"));
    assert.equal(new Set(retries.map((retry) => retry.runId)).size, 1);
    assert.equal(new Set(retries.map((retry) => retry.attempt)).size, 1);
    assert.equal(retries[0]?.attempt, 2);
    assert.equal(succeeding.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("stale staged context is rejected before any workspace side effect", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const source = createWorkspaceKnowledgeSource({
      id: "stale-source",
      kind: "website",
      label: "Stale source",
      summary: "Stale project context.",
      locator: { kind: "website", url: "https://example.com" },
      provenance: "wizard"
    });
    const context = {
      draftContextId: "22222222-2222-4222-8222-222222222222",
      generationId: "current-generation",
      runStatus: "ready" as const,
      reused: false,
      sources: [source],
      sourceReports: [],
      warnings: [],
      knowledge: {
        generationId: "current-generation",
        sources: [source],
        documents: [],
        warnings: []
      }
    };
    const input = {
      actorId: "actor-stale-context",
      blueprint: blueprint({
        knowledge: {
          sources: [source],
          generationId: "old-generation",
          sourceIds: [source.id],
          coverage: { sourceCount: 1, readySourceCount: 1, documentCount: 0 },
          retrieval: { mode: "bounded-corpus-assembly", queries: [], evidenceRefs: [] }
        },
        provenance: {
          ...blueprint().provenance,
          knowledgeGenerationId: "old-generation",
          sourceIds: [source.id]
        }
      }),
      draftContextId: context.draftContextId,
      expectedKnowledgeGenerationId: "old-generation",
      idempotencyKey: "stale-context-key",
      acceptDraft: true
    };
    await assert.rejects(
      () => provisionWorkspaceFromBlueprint(input, {
        ...harness.dependencies,
        readWorkspaceCreationContext: async () => context
      }),
      (error: unknown) => error instanceof WorkspaceProvisioningError && error.code === "knowledge-generation-mismatch"
    );
    assert.equal(harness.counts().createCount, 0);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a crash after canonical workspace creation resumes without losing the physical workspace", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const failing = createHarness(rootPath, { failAfterCreate: true });
    const input = { actorId: "actor-create-crash", blueprint: blueprint(), idempotencyKey: "create-crash-key", acceptDraft: true };
    const failed = await waitForWorkspaceProvisioning(input, failing.dependencies);
    assert.equal(failed.state, "failed");
    assert.equal(failed.workspaceId, null);
    assert.equal(failing.counts().createCount, 1);
    await readFile(path.join(rootPath, "workspaces", "acme", ".openclaw", "project.json"), "utf8");

    const succeeding = createHarness(rootPath);
    const resumed = await waitForWorkspaceProvisioning(input, succeeding.dependencies);
    assert.equal(resumed.state, "ready");
    assert.equal(resumed.attempt, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a crash after agent verification resumes from the durable workspace result", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath, { failCapabilityOnce: true });
    const input = { actorId: "actor-agent-crash", blueprint: blueprint(), idempotencyKey: "agent-crash-key", acceptDraft: true };
    const failed = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(failed.state, "failed");
    assert.ok(failed.completedSteps["agents-verified"]);
    assert.equal(failed.workspaceId, "workspace-acme");
    const resumed = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(resumed.state, "ready");
    assert.equal(resumed.attempt, 2);
    assert.equal(harness.counts().createCount, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("verification failure is not reported as a ready workspace and can be resumed", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const failing = createHarness(rootPath, { hideWorkspaces: true });
    const input = { actorId: "actor-verify", blueprint: blueprint(), idempotencyKey: "verify-key", acceptDraft: true };
    const failed = await waitForWorkspaceProvisioning(input, failing.dependencies);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error?.code, "verification-failed");
    const succeeding = createHarness(rootPath);
    const resumed = await waitForWorkspaceProvisioning(input, succeeding.dependencies);
    assert.equal(resumed.state, "ready");
    assert.equal(resumed.attempt, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("cancellation is durable and does not claim a completed workspace", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const controller = new AbortController();
    controller.abort();
    const input = {
      actorId: "actor-cancelled",
      blueprint: blueprint(),
      idempotencyKey: "cancel-key",
      acceptDraft: true,
      signal: controller.signal
    };
    const cancelled = await waitForWorkspaceProvisioning(input, harness.dependencies);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.workspaceId, null);
    assert.match(cancelled.error?.message ?? "", /incomplete|resumed/i);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("core bootstrap remains ready while external setup stays pending", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-provisioning-"));
  try {
    const harness = createHarness(rootPath);
    const channel = {
      id: "whatsapp-support",
      type: "whatsapp" as const,
      name: "WhatsApp Support",
      purpose: "Answer customers.",
      enabled: true,
      announce: false,
      authenticationKind: "qr-session" as const,
      requiresCredentials: false,
      requiresAuthentication: true,
      primaryAgentId: "primary-operator",
      selection: "explicit" as const,
      evidenceRefs: ["brief-channel"]
    };
    const channelBlueprint = blueprint({
      evidence: [{
        id: "brief-channel",
        kind: "brief",
        sourceId: null,
        summary: "Have the support agent answer customers over WhatsApp.",
        confidence: 100,
        imported: false
      }],
      operations: { workflows: [], automations: [], channels: [channel] }
    });
    const finished = await waitForWorkspaceProvisioning({
      actorId: "actor-pending-setup",
      blueprint: channelBlueprint,
      idempotencyKey: "pending-setup-key",
      acceptDraft: true
    }, harness.dependencies);
    assert.equal(finished.state, "ready");
    assert.deepEqual(finished.pendingSetup.channels, ["whatsapp:whatsapp-support"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("lease ownership is live-aware and ABA-safe", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-lease-"));
  try {
    const runFilePath = path.join(rootPath, "run.json");
    const first = await acquireProvisioningLease({
      runFilePath,
      runId: "run-lease",
      attempt: 1,
      overrides: {
        hostname: "test-host",
        pid: 100,
        processStartIdentity: async () => "start-a",
        isProcessAlive: () => true
      }
    });
    assert.ok(first);
    const second = await acquireProvisioningLease({
      runFilePath,
      runId: "run-lease",
      attempt: 1,
      overrides: {
        hostname: "test-host",
        pid: 100,
        processStartIdentity: async () => "start-a",
        isProcessAlive: () => true
      }
    });
    assert.equal(second, null);

    const replacement: ProvisioningLeaseRecord = {
      ...first.record,
      leaseId: "replacement-lease",
      ownerStartIdentity: "start-b"
    };
    await writeAtomicJson(resolveLeasePath(runFilePath), replacement);
    await first.release();
    const afterRelease = JSON.parse(await readFile(resolveLeasePath(runFilePath), "utf8")) as ProvisioningLeaseRecord;
    assert.equal(afterRelease.leaseId, "replacement-lease");
    await rm(resolveLeasePath(runFilePath), { force: true });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a dead provisioning lease is reclaimed for a new executor", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-lease-stale-"));
  try {
    const runFilePath = path.join(rootPath, "run.json");
    const leasePath = resolveLeasePath(runFilePath);
    await writeAtomicJson(leasePath, {
      schemaVersion: 1,
      leaseId: "dead-lease",
      runId: "run-stale",
      pid: 999_999,
      hostname: "stale-host",
      startedAt: "2026-09-10T00:00:00.000Z",
      heartbeatAt: "2026-09-10T00:00:00.000Z",
      ownerStartIdentity: "dead-start",
      attempt: 1
    } satisfies ProvisioningLeaseRecord);
    const replacement = await acquireProvisioningLease({
      runFilePath,
      runId: "run-stale",
      attempt: 2,
      overrides: {
        hostname: "stale-host",
        isProcessAlive: () => false
      }
    });
    assert.ok(replacement);
    assert.equal(replacement.record.attempt, 2);
    await replacement.release();
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("a second Node process cannot claim a live provisioning lease", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-lease-process-"));
  try {
    const runFilePath = path.join(rootPath, "run.json");
    const leaseModulePath = path.join(process.cwd(), "lib/agentos/application/workspace-provisioning-lease.ts");
    const childScript = `
      const { acquireProvisioningLease } = require(${JSON.stringify(leaseModulePath)});
      (async () => {
        const lease = await acquireProvisioningLease({
          runFilePath: process.argv[1],
          runId: "run-process",
          attempt: 1,
          overrides: {
            hostname: "child-host",
            processStartIdentity: async () => "child-start",
            isProcessAlive: () => true,
            heartbeatMs: 20
          }
        });
        process.stdout.write(JSON.stringify({ acquired: Boolean(lease) }) + "\\n");
        if (!lease) process.exitCode = 2;
        else {
          process.stdin.on("end", async () => { await lease.release(); process.exit(0); });
          process.stdin.resume();
        }
      })().catch((error) => { process.stderr.write(String(error)); process.exit(1); });
    `;
    const child = spawn(process.execPath, [
      "-r", path.join(process.cwd(), "tests/register-paths.cjs"),
      "-r", path.join(process.cwd(), "node_modules/jiti/register.js"),
      "-e", childScript,
      runFilePath
    ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    const output = await new Promise<string>((resolve, reject) => {
      let value = "";
      child.stdout.on("data", (chunk: Buffer) => {
        value += chunk.toString();
        if (value.includes("\n")) resolve(value.trim());
      });
      child.once("error", reject);
      child.stderr.on("data", (chunk: Buffer) => {
        if (chunk.toString()) reject(new Error(chunk.toString()));
      });
    });
    assert.deepEqual(JSON.parse(output), { acquired: true });
    const contender = await acquireProvisioningLease({
      runFilePath,
      runId: "run-process",
      attempt: 1,
      overrides: { hostname: "parent-host", staleAfterMs: 30_000 }
    });
    assert.equal(contender, null);
    child.stdin.end();
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const afterExit = await acquireProvisioningLease({ runFilePath, runId: "run-process", attempt: 1 });
    assert.ok(afterExit);
    await afterExit.release();
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
