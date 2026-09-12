import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  getWorkspaceCreationRun,
  startWorkspaceCreationRun,
  refreshWorkspaceCreationRun,
  attachWorkspaceProvisioningRun,
  type WorkspaceCreationRunDependencies
} from "@/lib/agentos/application/workspace-creation-run-service";
import {
  extractProjectIntelligence,
  summarizeProjectIntelligenceExtraction,
  type ProjectIntelligenceExtraction
} from "@/lib/agentos/application/project-intelligence-extraction-service";
import {
  createFallbackProjectIntelligenceSynthesisProposal,
  createProjectIntelligenceSynthesisInputFingerprint,
  type ProjectIntelligenceSynthesisResult
} from "@/lib/agentos/application/project-intelligence-synthesis-service";
import {
  getWorkspaceIntelligenceStatus
} from "@/lib/agentos/application/workspace-intelligence-status-service";
import {
  waitForWorkspaceProvisioning,
  type WorkspaceProvisioningDependencies
} from "@/lib/agentos/application/workspace-provisioning-service";
import { composeWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";
import {
  createWorkspaceKnowledgeSource,
  type WorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import type { WorkspaceCreationContextResult } from "@/lib/agentos/application/workspace-creation-context-service";
import { normalizeProjectFactValue, type ProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import type { WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import type { WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import type { MissionControlSnapshot, WorkspaceCreateResult } from "@/lib/openclaw/types";
import { createWorkspaceAgentId } from "@/lib/openclaw/domains/agent-provisioning";
import { buildWorkspaceScaffoldDocumentPaths } from "@/lib/openclaw/workspace-docs";
import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";

const fixture = goldenProjectFixtures[0];
assert.ok(fixture);

const sources: WorkspaceKnowledgeSource[] = fixture.pack.provenance.sourceIds.map((sourceId) => createWorkspaceKnowledgeSource({
  id: sourceId,
  kind: "website",
  label: sourceId === "coincollect-site" ? "CoinCollect website" : `CoinCollect ${sourceId}`,
  summary: "CoinCollect project source.",
  locator: { kind: "website", url: `https://${sourceId}.coincollect.test/` },
  provenance: "wizard",
  createdAt: "2026-09-11T00:00:00.000Z"
}));
const source = sources[0]!;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function operationSnapshot(): MissionControlSnapshot {
  return {
    generatedAt: "2026-09-11T00:00:00.000Z",
    mode: "live",
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

function makeExtraction(generationId: string, network: "Ethereum" | "Base") {
  const document = {
    sourceId: source.id,
    sourceKind: source.kind,
    documentId: `coincollect-${generationId}`,
    canonicalLocator: "https://coincollect.test/",
    title: "CoinCollect project context",
    content: `CoinCollect is a Web3 asset dashboard. The supported network is ${network}. The public contract address is 0xAbCdEf0123456789AbCdEf0123456789AbCdEf01.`
  };
  return extractProjectIntelligence({
    generationId,
    inputFingerprint: sha256(`${generationId}:${network}`),
    sourceIds: sources.map((entry) => entry.id),
    sources,
    documents: [document],
    now: "2026-09-11T00:00:00.000Z"
  });
}

function packForGeneration(generationId: string, network: "Ethereum" | "Base"): ProjectIntelligencePack {
  const pack = structuredClone(fixture.pack);
  pack.id = `coincollect-${generationId}`;
  pack.provenance = { ...pack.provenance, generationId, sourceIds: sources.map((entry) => entry.id) };
  pack.generation = { id: generationId, createdAt: "2026-09-11T00:00:00.000Z", method: "discovery" };
  pack.createdAt = "2026-09-11T00:00:00.000Z";
  pack.updatedAt = "2026-09-11T00:00:00.000Z";
  if (network === "Base") {
    pack.facts = pack.facts.map((fact) => {
      if (fact.id === "fact-network-name") return { ...fact, value: network, normalizedValue: network.toLowerCase() };
      if (fact.id === "fact-network") return {
        ...fact,
        value: { kind: "network", value: network, label: "Supported network" },
        normalizedValue: { kind: "network", value: network.toLowerCase(), label: "supported network" }
      };
      return fact;
    });
    pack.technicalLandscape = {
      ...pack.technicalLandscape,
      networks: { value: [network], factIds: ["fact-network-name"] }
    };
    pack.identifiers = {
      ...pack.identifiers,
      value: pack.identifiers.value.map((identifier) => identifier.kind === "network" ? { ...identifier, value: network } : identifier)
    };
    pack.evidence = pack.evidence.map((evidence) => ({
      ...evidence,
      claimScopes: [
        ...pack.facts
          .filter((fact) => fact.evidence.some((reference) => reference.evidenceRefId === evidence.id && reference.relation === "supports"))
          .map((fact) => ({ key: fact.key, normalizedValue: normalizeProjectFactValue(fact.normalizedValue) })),
        ...pack.officialResources
          .filter((resource) => resource.evidence.some((reference) => reference.evidenceRefId === evidence.id && reference.relation === "supports"))
          .map((resource) => ({ key: `resource:${resource.category}`, normalizedValue: normalizeProjectFactValue(resource.locator) }))
      ]
    }));
  }
  return pack;
}

async function waitForReview(actorId: string, runId: string, dependencies: WorkspaceCreationRunDependencies) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await getWorkspaceCreationRun({ actorId, runId }, dependencies);
    if (run?.snapshot.state === "review-ready" || run?.snapshot.state === "failed" || run?.snapshot.state === "cancelled") {
      if (run.snapshot.state === "review-ready" && run.lineage?.parentRunId && !run.snapshot.drift) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      await new Promise((resolve) => setImmediate(resolve));
      const stable = await getWorkspaceCreationRun({ actorId, runId }, dependencies);
      if (stable?.updatedAt === run.updatedAt && stable.events.length === run.events.length) return stable;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Creation run did not reach a terminal review state.");
}

function createCertificationHarness(rootPath: string) {
  const creationRootPath = path.join(rootPath, "creation-runs");
  const provisioningRootPath = path.join(rootPath, "provisioning-runs");
  const bindingRootPath = path.join(rootPath, "bindings");
  const workspaceRootPath = path.join(rootPath, "workspaces");
  const initialContextId = "11111111-1111-4111-8111-111111111111";
  const contexts = new Map<string, { generationId: string; network: "Ethereum" | "Base"; extraction: ProjectIntelligenceExtraction; result: WorkspaceCreationContextResult }>();
  const packs = new Map<string, ProjectIntelligencePack>();
  const plans = new Map<string, WorkspaceCompositionPlan>();
  let generationNumber = 0;
  let nextNetwork: "Ethereum" | "Base" = "Ethereum";
  let workspaceCreateCount = 0;
  const workspaces = new Map<string, WorkspaceCreateResult>();

  const contextFor = (draftContextId: string) => {
    const existing = contexts.get(draftContextId);
    if (existing) return existing;
    generationNumber += 1;
    const generationId = `coincollect-context-${generationNumber}`;
    const network = nextNetwork;
    const extraction = makeExtraction(generationId, network);
    const result: WorkspaceCreationContextResult = {
      draftContextId,
      generationId,
      runStatus: "ready",
      reused: false,
      sources,
      sourceReports: sources.map((entry) => ({ sourceId: entry.id, sourceKind: entry.kind, status: "ready" as const, support: "supported" as const, discoveredItems: 1, fetchedItems: 1, storedDocuments: 1, warningCount: 0, warnings: [], error: null })),
      warnings: [],
      extractionSummary: summarizeProjectIntelligenceExtraction(extraction),
      knowledge: {
        generationId,
        sources,
        documents: [{ sourceId: source.id, documentId: extraction.extractionId, title: "CoinCollect project context", contentLength: 180 }],
        warnings: []
      },
      extraction
    };
    const value = { generationId, network, extraction, result };
    contexts.set(draftContextId, value);
    return value;
  };

  const persistIntake: NonNullable<WorkspaceCreationRunDependencies["persistIntake"]> = async ({ draftContextId }) => {
    const id = draftContextId ?? initialContextId;
    const current = contextFor(id);
    return { draftContextId: id, sources: current.result.sources, fingerprint: sha256(`${id}:${current.generationId}`) };
  };

  const stageContext: NonNullable<WorkspaceCreationRunDependencies["stageContext"]> = async ({ draftContextId }) => contextFor(draftContextId ?? initialContextId).result;
  const readContext: NonNullable<WorkspaceCreationRunDependencies["readContext"]> = async ({ draftContextId }) => contextFor(draftContextId).result;
  const readContextMetadata: NonNullable<WorkspaceCreationRunDependencies["readContextMetadata"]> = async ({ draftContextId }) => contextFor(draftContextId).result;
  const readContextDocuments: NonNullable<WorkspaceCreationRunDependencies["readContextDocuments"]> = async () => [];
  const persistIntelligencePack: NonNullable<WorkspaceCreationRunDependencies["persistIntelligencePack"]> = async ({ draftContextId, inputFingerprint, pack }) => {
    packs.set(draftContextId, pack);
    return { packId: pack.id, inputFingerprint, synthesisStatus: "model" as const, state: pack.state, factCount: pack.facts.length, evidenceCount: pack.evidence.length, resourceCount: pack.officialResources.length, conflictCount: pack.conflicts.length, unknownCount: pack.unknowns.length };
  };
  const readIntelligencePack: NonNullable<WorkspaceCreationRunDependencies["readIntelligencePack"]> = async ({ draftContextId }) => packs.get(draftContextId) ?? null;
  const readIntelligenceSummary: NonNullable<WorkspaceCreationRunDependencies["readIntelligenceSummary"]> = async ({ draftContextId }) => {
    const pack = packs.get(draftContextId);
    if (!pack) return null;
    return { packId: pack.id, inputFingerprint: pack.provenance.generationId ?? "", synthesisStatus: "model", state: pack.state, factCount: pack.facts.length, evidenceCount: pack.evidence.length, resourceCount: pack.officialResources.length, conflictCount: pack.conflicts.length, unknownCount: pack.unknowns.length };
  };
  const persistCompositionPlan: NonNullable<WorkspaceCreationRunDependencies["persistCompositionPlan"]> = async ({ draftContextId, plan }) => {
    plans.set(draftContextId, plan);
    return { planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status };
  };
  const readCompositionPlan: NonNullable<WorkspaceCreationRunDependencies["readCompositionPlan"]> = async ({ draftContextId }) => plans.get(draftContextId) ?? null;

  const generateArchitect: NonNullable<WorkspaceCreationRunDependencies["generateArchitect"]> = async (input, options) => {
    const network = input.projectIntelligence?.pack.facts.find((fact) => fact.id === "fact-network-name")?.value;
    return (await import("@/lib/agentos/application/workspace-architect")).generateWorkspaceBlueprint(input, {
      ...options,
      modelExecutor: async () => ({
        text: JSON.stringify({
          identity: { name: "CoinCollect Workspace", purpose: `Manage CoinCollect on ${String(network ?? "Ethereum")}.`, projectType: "web3" },
          workforce: { specialists: [] },
          operations: { workflows: [], automations: [], channels: [] },
          capabilities: { skills: [], tools: [] },
          memory: { durableFacts: [] },
          connections: [],
          recommendations: [],
          assumptions: [],
          warnings: [],
          confidence: "high"
        }),
        runtime: "model-runtime" as const,
        runId: `architect-remote-${options?.runId ?? "certification-architect"}`,
        modelId: "certification-model"
      })
    });
  };

  const creationDependencies: WorkspaceCreationRunDependencies = {
    rootPath: creationRootPath,
    provisioningRootPath,
    workspaceIntelligenceBindingRootPath: bindingRootPath,
    persistIntake,
    cloneContext: async ({ sourceDraftContextId, targetDraftContextId }) => {
      assert.ok(contexts.has(sourceDraftContextId));
      return { draftContextId: targetDraftContextId, sources, fingerprint: sha256(targetDraftContextId) };
    },
    stageContext,
    readContext,
    readContextMetadata,
    readContextDocuments,
    readIntelligencePack,
    readIntelligenceSummary,
    persistIntelligencePack,
    persistCompositionPlan,
    readCompositionPlan,
    generateArchitect,
    synthesizeIntelligence: async ({ brief, extraction }) => {
      const inputFingerprint = createProjectIntelligenceSynthesisInputFingerprint({ brief, extraction });
      const context = [...contexts.values()].find((entry) => entry.extraction.extractionId === extraction.extractionId);
      const network = context?.network ?? "Ethereum";
      const pack = packForGeneration(inputFingerprint, network);
      return {
        proposal: createFallbackProjectIntelligenceSynthesisProposal(inputFingerprint),
        pack,
        execution: { status: "model", attempts: 1, modelExecutionOccurred: true, remoteRunId: `intelligence-remote-${inputFingerprint.slice(0, 8)}`, remoteSessionKey: null, failureCode: null }
      } satisfies ProjectIntelligenceSynthesisResult;
    },
    composeWorkspace: async (input, options) => composeWorkspaceComposition(input, {
      ...options,
      modelExecutor: async () => ({
        text: JSON.stringify({
          schemaVersion: 1,
          policyVersion: "phase7-safe-workspace-composition-v1",
          artifacts: [{
            artifactId: "project-profile",
            title: "Project profile",
            sections: ["Overview"],
            body: `# Project Profile\n\n## Overview\n${input.blueprint.identity.purpose}\n`,
            sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] },
            blueprintRefs: [input.blueprint.workforce.primaryAgent.id]
          }],
          warnings: []
        }),
        runtime: "model-runtime" as const,
        runId: `composer-remote-${options?.runId ?? "certification-composer"}`,
        sessionKey: null
      })
    })
  };

  const createWorkspaceProject: NonNullable<WorkspaceProvisioningDependencies["createWorkspaceProject"]> = async (input) => {
    workspaceCreateCount += 1;
    const slug = slugify(input.name);
    const workspaceId = `workspace-${slug}`;
    const workspacePath = path.join(workspaceRootPath, slug);
    const agents = (input.agents ?? []).map((agent) => ({
      id: createWorkspaceAgentId(slug, agent.id),
      name: agent.name,
      role: agent.role,
      enabled: agent.enabled,
      isPrimary: agent.isPrimary === true,
      skillIds: agent.skillIds ?? [],
      toolIds: agent.toolIds ?? [],
      policy: agent.policy
    }));
    await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
    await writeFile(path.join(workspacePath, ".openclaw", "project.json"), JSON.stringify({ version: 2, name: input.name, directory: workspacePath, template: input.template, materialization: input.materialization, agents, channels: [] }));
    for (const relativePath of buildWorkspaceScaffoldDocumentPaths(input.template ?? "software", { workspaceOnly: true, generateStarterDocs: true, generateMemory: true, kickoffMission: false })) {
      const target = path.join(workspacePath, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `# ${relativePath}\n`);
    }
    const result: WorkspaceCreateResult = { workspaceId, workspaceName: input.name, workspacePath, agentIds: agents.map((agent) => String(agent.id)), primaryAgentId: String(agents.find((agent) => agent.isPrimary)?.id ?? agents[0]?.id) };
    workspaces.set(workspaceId, result);
    return result;
  };

  const getMissionControlSnapshot: NonNullable<WorkspaceProvisioningDependencies["getMissionControlSnapshot"]> = async () => {
    const snapshot = operationSnapshot();
    snapshot.workspaces = [...workspaces.values()].map((workspace) => ({ id: workspace.workspaceId, name: workspace.workspaceName ?? workspace.workspaceId, path: workspace.workspacePath } as never));
    snapshot.agents = [...workspaces.values()].flatMap((workspace) => {
      const workspaceSlug = slugify(workspace.workspaceName ?? workspace.workspaceId);
      return [createWorkspaceAgentId(workspaceSlug, "primary-operator")].map((id) => ({ id, workspaceId: workspace.workspaceId, workspacePath: workspace.workspacePath, name: "CoinCollect Operator", role: "Operator", enabled: true, isPrimary: true, modelId: "certification-model", isDefault: true, status: "ready", sessionCount: 0, lastActiveAt: null, currentAction: "", activeRuntimeIds: [], heartbeat: { enabled: false, every: null, everyMs: null }, identity: {}, profile: { purpose: null, operatingInstructions: [], responseStyle: [], outputPreference: null, sourceFiles: [] }, skills: [], tools: [], policy: {} } as never));
    });
    return snapshot;
  };

  const provisioningDependencies: WorkspaceProvisioningDependencies = {
    rootPath: provisioningRootPath,
    workspaceIntelligenceBindingRootPath: bindingRootPath,
    createWorkspaceProject,
    getMissionControlSnapshot,
    readWorkspaceCreationContext: async ({ draftContextId }) => contextFor(draftContextId).result,
    readWorkspaceCreationCompositionPlan: async ({ draftContextId }) => plans.get(draftContextId) ?? null,
    readWorkspaceCreationIntelligencePack: async ({ draftContextId }) => packs.get(draftContextId) ?? null,
    readKnowledgeSnapshot: async () => null,
    promoteWorkspaceCreationKnowledge: async ({ expectedGenerationId }) => ({ stagedGenerationId: expectedGenerationId, generationId: expectedGenerationId, sourceIds: sources.map((entry) => entry.id), documentCount: 1 }),
    ensureWorkspaceNativeKnowledge: async () => ({ status: "applied", indexRefresh: [], warnings: [], errors: [], restartRequired: false } as never),
    updateAgent: async () => ({ agentId: "updated", workspaceId: "workspace-coincollect-workspace" })
  };

  return {
    creationRootPath,
    provisioningRootPath,
    bindingRootPath,
    initialContextId,
    contexts,
    packs,
    plans,
    creationDependencies,
    provisioningDependencies,
    setNextNetwork(network: "Ethereum" | "Base") { nextNetwork = network; },
    counts: () => ({ workspaceCreateCount })
  };
}

test("production certification covers creation, immutable refresh, live binding drift, and approved update", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-phase-9-1-certification-"));
  const actorId = "coincollect-certification-actor";
  const harness = createCertificationHarness(rootPath);
  try {
    const initial = await startWorkspaceCreationRun({ actorId, idempotencyKey: "coincollect-create", profile: "high", brief: "Manage CoinCollect and operate the project as autonomously as possible.", sources: [source] }, harness.creationDependencies);
    const initialReview = await waitForReview(actorId, initial.runId, harness.creationDependencies);
    assert.equal(initialReview.snapshot.state, "review-ready");
    assert.equal(initialReview.snapshot.architect.status, "model");
    assert.ok(initialReview.result);
    assert.ok(initialReview.draftContextId);
    const initialResult = initialReview.result as WorkspaceArchitectResult;
    const initialBlueprint = initialResult.blueprint;
    const initialPack = harness.packs.get(initialReview.draftContextId!);
    const initialPlan = harness.plans.get(initialReview.draftContextId!);
    assert.ok(initialPack);
    assert.ok(initialPlan);
    assert.equal(initialPack.officialResources.some((resource) => resource.category === "social"), true);
    assert.equal(initialBlueprint.operations.channels.length, 0, "public social resources must not become active channels");

    const firstProvision = await waitForWorkspaceProvisioning({ actorId, blueprint: initialBlueprint, draftContextId: initialReview.draftContextId, expectedKnowledgeGenerationId: initialBlueprint.knowledge.generationId, idempotencyKey: "coincollect-provision-1", acceptDraft: true, compositionPlan: initialPlan, compositionPlanId: initialPlan.planId, compositionPlanFingerprint: initialPlan.inputFingerprint }, harness.provisioningDependencies);
    assert.equal(firstProvision.state, "ready", JSON.stringify({ warnings: firstProvision.warnings, error: firstProvision.error }));
    assert.ok(firstProvision.result?.workspacePath);
    await attachWorkspaceProvisioningRun({ actorId, runId: initialReview.runId, provisioningRunId: firstProvision.runId }, harness.creationDependencies);
    const workspacePath = firstProvision.result!.workspacePath;
    const profilePath = path.join(workspacePath, "context", "PROJECT.md");
    const beforeRefresh = await readFile(profilePath, "utf8");
    await writeFile(profilePath, `${beforeRefresh}\nOperator note: preserve this line.\n`);
    const acceptedParent = await getWorkspaceCreationRun({ actorId, runId: initialReview.runId }, harness.creationDependencies);
    assert.equal(acceptedParent?.snapshot.provisioningRunId, firstProvision.runId);

    harness.setNextNetwork("Ethereum");
    const noChange = await refreshWorkspaceCreationRun({ actorId, runId: initialReview.runId, refreshIntent: "same-source-reanalysis" }, harness.creationDependencies);
    assert.ok(noChange);
    const noChangeReview = await waitForReview(actorId, noChange!.runId, harness.creationDependencies);
    assert.equal(noChangeReview.snapshot.state, "review-ready", JSON.stringify(noChangeReview.snapshot));
    assert.equal(noChangeReview.snapshot.drift?.status, "none");
    assert.notEqual(noChangeReview.draftContextId, initialReview.draftContextId);
    assert.equal((await getWorkspaceCreationRun({ actorId, runId: initialReview.runId }, harness.creationDependencies))?.draftContextId, initialReview.draftContextId);
    assert.equal((await readFile(profilePath, "utf8")).includes("Operator note: preserve this line."), true);
    const noChangePlan = harness.plans.get(noChangeReview.draftContextId!);
    assert.ok(noChangePlan);

    harness.setNextNetwork("Base");
    const changed = await refreshWorkspaceCreationRun({ actorId, runId: initialReview.runId, refreshIntent: "network-change-reanalysis" }, harness.creationDependencies);
    assert.ok(changed);
    const changedReview = await waitForReview(actorId, changed!.runId, harness.creationDependencies);
    assert.equal(changedReview.snapshot.state, "review-ready", JSON.stringify(changedReview.snapshot));
    assert.equal(changedReview.snapshot.drift?.status, "detected");
    assert.ok(changedReview.snapshot.drift?.categories.includes("facts"));
    assert.ok(changedReview.snapshot.drift?.categories.includes("blueprint"));
    assert.ok(changedReview.snapshot.drift?.categories.includes("composition"));
    const profileAfterChangedRefresh = await readFile(profilePath, "utf8");
    assert.equal(profileAfterChangedRefresh.includes("Manage CoinCollect on Ethereum"), true, profileAfterChangedRefresh);
    assert.equal((await readFile(profilePath, "utf8")).includes("Operator note: preserve this line."), true);

    const candidatePack = harness.packs.get(changedReview.draftContextId!);
    const candidatePlan = harness.plans.get(changedReview.draftContextId!);
    assert.ok(candidatePack);
    assert.ok(candidatePlan);
    const liveStatus = await getWorkspaceIntelligenceStatus({ actorId, workspaceId: firstProvision.result!.workspaceId, candidateCreationRunId: changedReview.runId }, { creationRootPath: harness.creationRootPath, provisioningRootPath: harness.provisioningRootPath, bindingRootPath: harness.bindingRootPath, readPack: async ({ draftContextId }) => harness.packs.get(draftContextId) ?? null, readComposition: async ({ draftContextId }) => harness.plans.get(draftContextId) ?? null });
    assert.equal(liveStatus.status, "update-available");
    assert.equal(liveStatus.live?.provisioningRunId, firstProvision.runId);
    assert.equal(liveStatus.candidate?.creationRunId, changedReview.runId);

    const changedResult = changedReview.result as WorkspaceArchitectResult;
    const secondProvision = await waitForWorkspaceProvisioning({ actorId, blueprint: changedResult.blueprint, draftContextId: changedReview.draftContextId, expectedKnowledgeGenerationId: changedResult.blueprint.knowledge.generationId, idempotencyKey: "coincollect-provision-2", acceptDraft: true, compositionPlan: candidatePlan, compositionPlanId: candidatePlan.planId, compositionPlanFingerprint: candidatePlan.inputFingerprint }, harness.provisioningDependencies);
    assert.equal(secondProvision.state, "ready");
    assert.notEqual(secondProvision.runId, firstProvision.runId);
    assert.equal((await readFile(profilePath, "utf8")).includes("Manage CoinCollect on Base"), true);
    assert.equal((await readFile(profilePath, "utf8")).includes("Operator note: preserve this line."), true);
    const finalStatus = await getWorkspaceIntelligenceStatus({ actorId, workspaceId: firstProvision.result!.workspaceId }, { creationRootPath: harness.creationRootPath, provisioningRootPath: harness.provisioningRootPath, bindingRootPath: harness.bindingRootPath, readPack: async ({ draftContextId }) => harness.packs.get(draftContextId) ?? null, readComposition: async ({ draftContextId }) => harness.plans.get(draftContextId) ?? null });
    assert.equal(finalStatus.status, "current");
    assert.equal(finalStatus.binding?.provisioningRunId, secondProvision.runId);
    assert.equal(harness.counts().workspaceCreateCount, 2);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("refresh concurrency collapses duplicate intent while a stale binding write fails closed", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-phase-9-1-concurrency-"));
  const harness = createCertificationHarness(rootPath);
  const actorId = "coincollect-concurrency-actor";
  try {
    const initial = await startWorkspaceCreationRun({ actorId, idempotencyKey: "concurrency-create", brief: "Manage CoinCollect.", sources: [source] }, harness.creationDependencies);
    const review = await waitForReview(actorId, initial.runId, harness.creationDependencies);
    const results = await Promise.all(Array.from({ length: 24 }, () => refreshWorkspaceCreationRun({ actorId, runId: review.runId, refreshIntent: "same-click" }, harness.creationDependencies)));
    assert.equal(new Set(results.map((run) => run?.runId)).size, 1);
    assert.equal(new Set(results.map((run) => run?.draftContextId)).size, 1);
    const refreshed = results[0];
    assert.ok(refreshed);
    await waitForReview(actorId, refreshed!.runId, harness.creationDependencies);
    const { persistWorkspaceIntelligenceBinding } = await import("@/lib/agentos/application/workspace-intelligence-binding-store");
    await persistWorkspaceIntelligenceBinding({ rootPath: harness.bindingRootPath, actorId, workspaceId: "workspace-coincollect-workspace", sourceGenerationId: null, projectIntelligencePackId: null, projectIntelligenceGenerationId: null, blueprintId: "blueprint", blueprintFingerprint: "a".repeat(64), provisioningRunId: "newer-provisioning-run", status: "current", expectedCurrentProvisioningRunId: null });
    await assert.rejects(() => persistWorkspaceIntelligenceBinding({ rootPath: harness.bindingRootPath, actorId, workspaceId: "workspace-coincollect-workspace", sourceGenerationId: null, projectIntelligencePackId: null, projectIntelligenceGenerationId: null, blueprintId: "blueprint", blueprintFingerprint: "a".repeat(64), provisioningRunId: "older-provisioning-run", status: "current", expectedCurrentProvisioningRunId: null }), /binding changed/i);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
