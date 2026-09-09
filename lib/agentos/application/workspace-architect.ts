import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import {
  filterKnownOpenClawSkillIds,
  filterKnownOpenClawToolIds,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { searchWorkerMemory } from "@/lib/openclaw/application/native-memory-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  normalizeWorkspaceKnowledgeSources,
  workspaceKnowledgeSourceIdentity,
  type WorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import {
  normalizeWorkspaceMaterializationInput,
  type WorkspaceMaterialization
} from "@/lib/agentos/domains/workspace-materialization";
import { redactSecretText } from "@/lib/security/redaction";
import type {
  WorkspaceArchitectCorpusDocument,
  WorkspaceArchitectInput,
  WorkspaceArchitectKnowledgeInput,
  WorkspaceArchitectNativeSearchResult,
  WorkspaceArchitectResult,
  WorkspaceArchitectRunOptions,
  WorkspaceBlueprint,
  WorkspaceBlueprintAgent,
  WorkspaceBlueprintAutomation,
  WorkspaceBlueprintChannel,
  WorkspaceBlueprintEvidence,
  WorkspaceBlueprintFreshnessResult,
  WorkspaceBlueprintRevisionInput,
  WorkspaceBlueprintValidation,
  WorkspaceBlueprintValidationIssue
} from "@/lib/agentos/domains/workspace-blueprint";
import {
  WORKSPACE_BLUEPRINT_POLICY_VERSION,
  WORKSPACE_BLUEPRINT_SCHEMA_VERSION
} from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspacePlan } from "@/lib/openclaw/types";

const MAX_BRIEF_LENGTH = 12_000;
const MAX_EVIDENCE_ITEMS = 24;
const MAX_EVIDENCE_TEXT_LENGTH = 500;
const MAX_DOCUMENTS = 12;
const MAX_DOCUMENT_TEXT_LENGTH = 1_200;
const MAX_SOURCE_TEXT_LENGTH = 600;
const DEFAULT_GENERATION_ID = null;

const blueprintEnvelopeSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_BLUEPRINT_SCHEMA_VERSION),
  status: z.enum(["draft", "ready", "blocked"]),
  id: z.string().min(1),
  identity: z.object({
    name: z.string().min(1),
    purpose: z.string().min(1),
    projectType: z.string().min(1)
  }),
  brief: z.string().min(1),
  materialization: z.object({ mode: z.enum(["empty", "clone", "existing"]) }),
  knowledge: z.object({
    sources: z.array(z.object({ id: z.string().min(1) })),
    sourceIds: z.array(z.string().min(1)),
    retrieval: z.object({
      mode: z.enum(["native-memory-search", "bounded-corpus-assembly", "none"]),
      queries: z.array(z.string()),
      evidenceRefs: z.array(z.string())
    })
  }),
  workforce: z.object({
    primaryAgent: z.object({ id: z.string().min(1), enabled: z.literal(true), isPrimary: z.literal(true) }),
    specialists: z.array(z.object({ id: z.string().min(1), enabled: z.literal(true), isPrimary: z.literal(false) }))
  }),
  operations: z.object({
    workflows: z.array(z.object({ id: z.string().min(1) })),
    automations: z.array(z.object({ id: z.string().min(1) })),
    channels: z.array(z.object({ id: z.string().min(1), requiresCredentials: z.boolean() }))
  }),
  safety: z.object({
    workspaceOnly: z.literal(true),
    generationSideEffectFree: z.literal(true),
    importedKnowledgeUntrusted: z.literal(true)
  }),
  provenance: z.object({
    architectRunId: z.string().min(1),
    inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    knowledgeGenerationId: z.string().nullable(),
    sourceIds: z.array(z.string()),
    createdAt: z.string().min(1)
  })
});

type KnowledgeContext = {
  sources: WorkspaceKnowledgeSource[];
  generationId: string | null;
  documents: WorkspaceArchitectCorpusDocument[];
};

type KnowledgeEvidenceResult = {
  evidence: WorkspaceBlueprintEvidence[];
  retrieval: WorkspaceBlueprint["knowledge"]["retrieval"];
  warning?: string;
};

export async function generateWorkspaceBlueprint(
  input: WorkspaceArchitectInput,
  options: WorkspaceArchitectRunOptions & {
    adapter?: OpenClawAdapter;
    nativeAgentId?: string;
    currentKnowledgeGenerationId?: string | null;
  } = {}
): Promise<WorkspaceArchitectResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const brief = redactSecretText(input.brief.trim()).slice(0, MAX_BRIEF_LENGTH);
  if (!brief) throw new Error("Workspace architect brief is required.");

  const materialization = normalizeWorkspaceMaterializationInput({
    materialization: input.materialization ?? { mode: "empty" }
  });
  const knowledge = normalizeKnowledgeContext(input.knowledge);
  const architectRunId = options.runId?.trim() || randomUUID();
  const sourceIds = knowledge.sources.map((source) => source.id);
  const nativeSearch = options.nativeSearch ?? buildNativeSearch(options.adapter, options.nativeAgentId);
  const knowledgeEvidence = await buildKnowledgeEvidence(brief, knowledge, {
    nativeSearch,
    now
  });
  const evidence = [
    createEvidence("brief", null, brief, 100, false),
    ...knowledgeEvidence.evidence
  ].slice(0, MAX_EVIDENCE_ITEMS);
  const evidenceByKind = (kind: WorkspaceBlueprintEvidence["kind"]) => evidence.filter((entry) => entry.kind === kind);
  const explicit = inferExplicitBrief(brief);
  const identity = inferIdentity(brief, knowledge.sources);
  const primaryAgent = createPrimaryAgent(identity.name, identity.purpose, evidenceByKind("brief"));
  const specialists = explicit.singleAgentRequested ? [] : buildExplicitSpecialists(brief, evidenceByKind("brief"));
  const operations = buildExplicitOperations(brief, primaryAgent.id, evidenceByKind("brief"));
  const capabilities = buildCapabilities(evidenceByKind("brief"));
  const connections = buildConnections(operations.channels, knowledge.sources);
  const assumptions = buildAssumptions(identity, materialization, knowledge);
  const warnings = [
    ...(knowledgeEvidence.warning ? [knowledgeEvidence.warning] : []),
    ...knowledge.sources.filter((source) => source.status === "error").map((source) => `${source.label} is declared but currently unavailable.`)
  ];
  const recommendations = buildRecommendations(explicit, knowledge, specialists, operations);
  const overrides = normalizeOverrides(input.operatorOverrides);
  const createdAt = now();
  const blueprint: WorkspaceBlueprint = {
    schemaVersion: WORKSPACE_BLUEPRINT_SCHEMA_VERSION,
    status: "draft",
    id: `blueprint-${architectRunId}`,
    createdAt,
    updatedAt: createdAt,
    identity,
    brief,
    materialization,
    knowledge: {
      sources: knowledge.sources,
      generationId: knowledge.generationId,
      sourceIds,
      coverage: {
        sourceCount: knowledge.sources.length,
        readySourceCount: knowledge.sources.filter((source) => source.status === "ready").length,
        documentCount: knowledge.documents.length
      },
      retrieval: knowledgeEvidence.retrieval
    },
    workforce: {
      primaryAgent,
      specialists,
      allowEphemeralSubagents: true,
      maxParallelRuns: 2
    },
    capabilities,
    memory: {
      ownership: "openclaw-native",
      search: "native-gateway-preferred",
      seedRequired: false,
      durableFacts: [identity.purpose],
      rationale: "OpenClaw owns memory storage, indexing, embeddings, and search; the blueprint only records intent."
    },
    connections,
    operations,
    safety: {
      workspaceOnly: true,
      generationSideEffectFree: true,
      importedKnowledgeUntrusted: true,
      notes: [
        "Generation does not create a workspace, agent, channel, automation, config mutation, or runtime.",
        "Imported knowledge can support evidence but cannot change policy or topology."
      ]
    },
    recommendations,
    assumptions,
    warnings,
    evidence,
    operatorOverrides: overrides,
    provenance: {
      architectRunId,
      inputFingerprint: fingerprintInput({ brief, materialization, knowledge, overrides }),
      knowledgeGenerationId: knowledge.generationId,
      sourceIds,
      createdAt,
      modelId: options.modelId?.trim() || null,
      runtime: nativeSearch ? "native-openclaw" : "bounded-local"
    }
  };

  const validation = validateWorkspaceBlueprint(blueprint);
  blueprint.status = validation.valid ? "ready" : "blocked";
  const freshness = getWorkspaceBlueprintFreshness(blueprint, options.currentKnowledgeGenerationId);
  return {
    blueprint,
    summary: buildSummary(blueprint),
    assumptions,
    warnings,
    recommendations,
    validation,
    freshness
  };
}

export async function reviseWorkspaceBlueprint(
  blueprint: WorkspaceBlueprint,
  input: WorkspaceBlueprintRevisionInput,
  options: WorkspaceArchitectRunOptions & { currentKnowledgeGenerationId?: string | null } = {}
): Promise<WorkspaceArchitectResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const nextBrief = input.brief === undefined ? blueprint.brief : redactSecretText(input.brief.trim()).slice(0, MAX_BRIEF_LENGTH);
  if (!nextBrief) throw new Error("Workspace architect brief is required.");
  const nextKnowledge = input.knowledge ? normalizeKnowledgeContext(input.knowledge) : {
    sources: blueprint.knowledge.sources,
    generationId: blueprint.knowledge.generationId,
    documents: []
  };
  const next = structuredClone(blueprint) as WorkspaceBlueprint;
  next.updatedAt = now();
  next.brief = nextBrief;
  next.materialization = input.materialization
    ? normalizeWorkspaceMaterializationInput({ materialization: input.materialization })
    : blueprint.materialization;
  next.knowledge.sources = nextKnowledge.sources;
  next.knowledge.generationId = nextKnowledge.generationId;
  next.knowledge.sourceIds = nextKnowledge.sources.map((source) => source.id);
  next.knowledge.coverage = {
    sourceCount: nextKnowledge.sources.length,
    readySourceCount: nextKnowledge.sources.filter((source) => source.status === "ready").length,
    documentCount: nextKnowledge.documents.length
  };

  const edits = input.operatorEdits;
  if (edits?.identity) next.identity = { ...next.identity, ...cleanRecord(edits.identity) };
  if (edits?.workforce?.primaryAgent) {
    next.workforce.primaryAgent = {
      ...next.workforce.primaryAgent,
      ...cleanRecord(edits.workforce.primaryAgent),
      enabled: true,
      isPrimary: true,
      persistence: "primary"
    };
    lockPath(next, "workforce.primaryAgent");
  }
  if (edits?.workforce?.specialists) {
    next.workforce.specialists = edits.workforce.specialists.map((agent) => ({
      ...agent,
      enabled: true,
      isPrimary: false,
      persistence: "specialist"
    }));
    lockPath(next, "workforce.specialists");
  }
  if (edits?.operations?.workflows) {
    next.operations.workflows = edits.operations.workflows;
    lockPath(next, "operations.workflows");
  }
  if (edits?.operations?.automations) {
    next.operations.automations = edits.operations.automations;
    lockPath(next, "operations.automations");
  }
  if (edits?.operations?.channels) {
    next.operations.channels = edits.operations.channels;
    lockPath(next, "operations.channels");
  }
  if (edits?.recommendations) next.recommendations = edits.recommendations.map(redactSecretText).slice(0, 12);

  const knowledgeEvidence = input.knowledge
    ? await buildKnowledgeEvidence(nextBrief, nextKnowledge, {
        nativeSearch: options.nativeSearch,
        now
      })
    : null;
  if (knowledgeEvidence) {
    next.knowledge.retrieval = knowledgeEvidence.retrieval;
    next.evidence = [
      ...next.evidence.filter((entry) => entry.kind === "brief"),
      ...knowledgeEvidence.evidence
    ].slice(0, MAX_EVIDENCE_ITEMS);
    next.warnings = [
      ...(knowledgeEvidence.warning ? [knowledgeEvidence.warning] : []),
      ...nextKnowledge.sources.filter((source) => source.status === "error").map((source) => `${source.label} is declared but currently unavailable.`)
    ];
  }
  next.provenance = {
    ...next.provenance,
    architectRunId: options.runId?.trim() || randomUUID(),
    inputFingerprint: fingerprintInput({
      brief: nextBrief,
      materialization: next.materialization,
      knowledge: nextKnowledge,
      overrides: next.operatorOverrides
    }),
    knowledgeGenerationId: nextKnowledge.generationId,
    sourceIds: nextKnowledge.sources.map((source) => source.id),
    createdAt: next.updatedAt,
    modelId: options.modelId?.trim() || next.provenance.modelId,
    runtime: options.nativeSearch ? "native-openclaw" : next.provenance.runtime
  };
  next.status = "draft";
  const validation = validateWorkspaceBlueprint(next);
  next.status = validation.valid ? "ready" : "blocked";
  const freshness = getWorkspaceBlueprintFreshness(next, options.currentKnowledgeGenerationId);
  const summary = buildSummary(next);
  return {
    blueprint: next,
    summary,
    assumptions: next.assumptions,
    warnings: next.warnings,
    recommendations: next.recommendations,
    validation,
    freshness
  };
}

/**
 * Compatibility boundary for the existing wizard. The legacy plan's deploy and
 * runtime fields are deliberately not copied into the Phase 4 blueprint.
 */
export async function projectLegacyWorkspacePlanToBlueprint(
  plan: WorkspacePlan,
  options: WorkspaceArchitectRunOptions & { currentKnowledgeGenerationId?: string | null } = {}
): Promise<WorkspaceArchitectResult> {
  const base = await generateWorkspaceBlueprint({
    brief: buildLegacyPlanBrief(plan),
    materialization: plan.workspace.materialization,
    knowledge: { sources: plan.knowledge.sources }
  }, options);
  const primary = plan.team.persistentAgents.find((agent) => agent.enabled && agent.isPrimary);
  const specialists = plan.team.persistentAgents
    .filter((agent) => agent.enabled && !agent.isPrimary)
    .map((agent) => projectLegacyAgent(agent));
  const operations = {
    workflows: plan.operations.workflows.filter((item) => item.enabled).map((item) => ({
      id: item.id,
      name: item.name,
      goal: item.goal,
      trigger: item.trigger,
      ownerAgentId: item.ownerAgentId || base.blueprint.workforce.primaryAgent.id,
      collaboratorAgentIds: item.collaboratorAgentIds,
      successDefinition: item.successDefinition,
      outputs: item.outputs,
      enabled: true,
      evidenceRefs: base.blueprint.evidence.filter((entry) => entry.kind === "brief").map((entry) => entry.id)
    })),
    automations: plan.operations.automations.filter((item) => item.enabled).map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      enabled: true,
      scheduleKind: item.scheduleKind,
      scheduleValue: item.scheduleValue,
      agentId: item.agentId || base.blueprint.workforce.primaryAgent.id,
      mission: item.mission,
      thinking: item.thinking,
      announce: item.announce,
      selection: "explicit" as const,
      evidenceRefs: base.blueprint.evidence.filter((entry) => entry.kind === "brief").map((entry) => entry.id)
    })),
    channels: plan.operations.channels
      .filter((item) => item.enabled && item.type !== "internal")
      .map((item) => ({
        id: item.id,
        type: item.type as WorkspaceBlueprintChannel["type"],
        name: item.name,
        purpose: item.purpose,
        ...(item.target ? { target: item.target } : {}),
        enabled: true,
        announce: item.announce,
        requiresCredentials: item.type !== "whatsapp" && item.type !== "internal",
        primaryAgentId: item.primaryAgentId || base.blueprint.workforce.primaryAgent.id,
        selection: "explicit" as const,
        evidenceRefs: base.blueprint.evidence.filter((entry) => entry.kind === "brief").map((entry) => entry.id)
      }))
  };
  return reviseWorkspaceBlueprint(base.blueprint, {
    operatorEdits: {
      identity: {
        name: plan.workspace.name || plan.company.name || base.blueprint.identity.name,
        purpose: plan.company.mission || base.blueprint.identity.purpose
      },
      ...(primary ? { workforce: { primaryAgent: projectLegacyAgent(primary), specialists } } : specialists.length ? { workforce: { specialists } } : {}),
      operations,
      recommendations: base.recommendations
    }
  }, options);
}

export function validateWorkspaceBlueprint(value: unknown): WorkspaceBlueprintValidation {
  const issues: WorkspaceBlueprintValidationIssue[] = [];
  const parsed = blueprintEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "schema_invalid",
        path: issue.path.join(".") || "blueprint",
        message: issue.message,
        severity: "error"
      });
    }
    return { valid: false, issues };
  }

  const blueprint = value as WorkspaceBlueprint;
  const allAgents = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists];
  addDuplicateIssues(issues, allAgents.map((agent) => agent.id), "workforce", "agent_id_duplicate");
  addDuplicateIssues(issues, blueprint.operations.workflows.map((item) => item.id), "operations.workflows", "workflow_id_duplicate");
  addDuplicateIssues(issues, blueprint.operations.automations.map((item) => item.id), "operations.automations", "automation_id_duplicate");
  addDuplicateIssues(issues, blueprint.operations.channels.map((item) => item.id), "operations.channels", "channel_id_duplicate");

  const sourceIds = new Set(blueprint.knowledge.sources.map((source) => source.id));
  for (const sourceId of blueprint.knowledge.sourceIds) {
    if (!sourceIds.has(sourceId)) {
      issues.push({ code: "source_reference_invalid", path: "knowledge.sourceIds", message: `Unknown knowledge source ${sourceId}.`, severity: "error" });
    }
  }
  const evidenceIds = new Set(blueprint.evidence.map((entry) => entry.id));
  for (const entry of allAgents) {
    checkEvidenceRefs(issues, entry.evidenceRefs, evidenceIds, `workforce.${entry.id}.evidenceRefs`);
  }
  for (const evidence of blueprint.evidence) {
    if (evidence.sourceId && !sourceIds.has(evidence.sourceId)) {
      issues.push({ code: "source_reference_invalid", path: `evidence.${evidence.id}.sourceId`, message: `Evidence points to unknown knowledge source ${evidence.sourceId}.`, severity: "error" });
    }
  }
  for (const workflow of blueprint.operations.workflows) {
    if (!allAgents.some((agent) => agent.id === workflow.ownerAgentId)) {
      issues.push({ code: "agent_reference_invalid", path: `operations.workflows.${workflow.id}.ownerAgentId`, message: `Workflow points to unknown agent ${workflow.ownerAgentId}.`, severity: "error" });
    }
    for (const collaboratorId of workflow.collaboratorAgentIds) {
      if (!allAgents.some((agent) => agent.id === collaboratorId)) {
        issues.push({ code: "agent_reference_invalid", path: `operations.workflows.${workflow.id}.collaboratorAgentIds`, message: `Workflow points to unknown collaborator ${collaboratorId}.`, severity: "error" });
      }
    }
    checkEvidenceRefs(issues, workflow.evidenceRefs, evidenceIds, `operations.workflows.${workflow.id}.evidenceRefs`);
  }
  for (const item of blueprint.operations.automations) {
    if (!allAgents.some((agent) => agent.id === item.agentId)) {
      issues.push({ code: "agent_reference_invalid", path: `operations.automations.${item.id}.agentId`, message: `Automation points to unknown agent ${item.agentId}.`, severity: "error" });
    }
    checkEvidenceRefs(issues, item.evidenceRefs, evidenceIds, `operations.automations.${item.id}.evidenceRefs`);
  }
  for (const item of blueprint.operations.channels) {
    if (!allAgents.some((agent) => agent.id === item.primaryAgentId)) {
      issues.push({ code: "agent_reference_invalid", path: `operations.channels.${item.id}.primaryAgentId`, message: `Channel points to unknown agent ${item.primaryAgentId}.`, severity: "error" });
    }
  }
  if (blueprint.memory.ownership !== "openclaw-native" || blueprint.memory.search !== "native-gateway-preferred") {
    issues.push({ code: "memory_ownership_invalid", path: "memory", message: "Workspace Architect cannot claim ownership of OpenClaw memory storage or indexing.", severity: "error" });
  }
  if (blueprint.safety.workspaceOnly !== true || blueprint.safety.generationSideEffectFree !== true || blueprint.safety.importedKnowledgeUntrusted !== true) {
    issues.push({ code: "safety_policy_invalid", path: "safety", message: "Blueprint safety invariants must remain enabled.", severity: "error" });
  }
  if (blueprint.knowledge.retrieval.mode === "native-memory-search" && blueprint.knowledge.retrieval.evidenceRefs.length === 0) {
    issues.push({ code: "retrieval_evidence_missing", path: "knowledge.retrieval.evidenceRefs", message: "Native retrieval must produce bounded evidence or be reported unavailable.", severity: "warning" });
  }
  for (const secretField of findSecretFieldPaths(blueprint)) {
    issues.push({ code: "secret_field", path: secretField, message: "Credentials and secret material are not allowed in a workspace blueprint.", severity: "error" });
  }
  for (const globalPath of findGlobalMemoryPaths(blueprint)) {
    issues.push({ code: "global_memory_path", path: globalPath, message: "Blueprint memory intent must not introduce global or cross-workspace paths.", severity: "error" });
  }
  for (const deploymentPath of findDeploymentStatePaths(blueprint)) {
    issues.push({ code: "deployment_state", path: deploymentPath, message: "A blueprint is architecture intent, not deployment or runtime state.", severity: "error" });
  }

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function getWorkspaceBlueprintFreshness(
  blueprint: Pick<WorkspaceBlueprint, "provenance">,
  currentKnowledgeGenerationId?: string | null
): WorkspaceBlueprintFreshnessResult {
  const blueprintGenerationId = blueprint.provenance.knowledgeGenerationId ?? null;
  const currentGenerationId = currentKnowledgeGenerationId ?? null;
  if (!blueprintGenerationId || !currentGenerationId) {
    return {
      status: "unknown",
      blueprintGenerationId,
      currentGenerationId,
      reason: "Knowledge generation identity is unavailable, so freshness cannot be proven."
    };
  }
  if (blueprintGenerationId !== currentGenerationId) {
    return {
      status: "stale",
      blueprintGenerationId,
      currentGenerationId,
      reason: "The knowledge generation changed after this blueprint was produced."
    };
  }
  return {
    status: "fresh",
    blueprintGenerationId,
    currentGenerationId,
    reason: "The blueprint and current knowledge corpus share the same generation identity."
  };
}

function projectLegacyAgent(agent: WorkspacePlan["team"]["persistentAgents"][number]): WorkspaceBlueprintAgent {
  return {
    id: agent.id,
    role: agent.role,
    name: agent.name,
    enabled: true,
    persistence: agent.isPrimary ? "primary" : "specialist",
    isPrimary: Boolean(agent.isPrimary),
    purpose: agent.purpose,
    responsibilities: agent.responsibilities,
    outputs: agent.outputs,
    skillIds: agent.skillId ? [agent.skillId] : [],
    toolIds: [],
    policy: agent.policy,
    justification: "Projected from an explicit legacy planner decision; deploy/runtime state is not copied.",
    evidenceRefs: []
  };
}

function buildLegacyPlanBrief(plan: WorkspacePlan) {
  return [
    plan.company.mission,
    plan.product.offer,
    plan.workspace.name,
    plan.company.targetCustomer
  ].filter(Boolean).join(". ") || "Create a workspace from the legacy planner draft.";
}

function normalizeKnowledgeContext(input?: WorkspaceArchitectKnowledgeInput): KnowledgeContext {
  const snapshotGenerationId = input?.snapshot?.state?.generationId ?? input?.snapshot?.generationId;
  const documents = input?.documents ?? input?.snapshot?.documents ?? [];
  return {
    sources: normalizeWorkspaceKnowledgeSources(input?.sources ?? []).map(sanitizeKnowledgeSource),
    generationId: input?.generationId?.trim() || snapshotGenerationId?.trim() || DEFAULT_GENERATION_ID,
    documents: documents.slice(0, MAX_DOCUMENTS).map((document) => ({
      sourceId: document.sourceId.trim(),
      title: document.title ? redactSecretText(document.title).slice(0, 160) : undefined,
      summary: document.summary ? redactSecretText(document.summary).slice(0, MAX_SOURCE_TEXT_LENGTH) : undefined,
      content: document.content ? redactSecretText(document.content).slice(0, MAX_DOCUMENT_TEXT_LENGTH) : undefined,
      contentLength: typeof document.contentLength === "number" ? Math.max(0, Math.floor(document.contentLength)) : undefined
    }))
  };
}

function sanitizeKnowledgeSource(source: WorkspaceKnowledgeSource): WorkspaceKnowledgeSource {
  const locator = source.locator;
  return {
    ...source,
    label: redactSecretText(source.label).slice(0, 160),
    summary: redactSecretText(source.summary).slice(0, MAX_SOURCE_TEXT_LENGTH),
    details: source.details.map((detail) => redactSecretText(detail).slice(0, MAX_SOURCE_TEXT_LENGTH)),
    ...(source.error ? { error: redactSecretText(source.error).slice(0, MAX_SOURCE_TEXT_LENGTH) } : {}),
    locator:
      locator.kind === "prompt"
        ? { kind: locator.kind, text: redactSecretText(locator.text).slice(0, MAX_DOCUMENT_TEXT_LENGTH) }
        : locator.kind === "website"
          ? { kind: locator.kind, url: redactSecretText(locator.url).slice(0, MAX_DOCUMENT_TEXT_LENGTH) }
          : locator.kind === "repository"
            ? {
                kind: locator.kind,
                ...(locator.remoteUrl ? { remoteUrl: redactSecretText(locator.remoteUrl).slice(0, MAX_DOCUMENT_TEXT_LENGTH) } : {}),
                ...(locator.localPath ? { localPath: redactSecretText(locator.localPath).slice(0, MAX_DOCUMENT_TEXT_LENGTH) } : {})
              }
            : locator.kind === "file" || locator.kind === "folder"
              ? { kind: locator.kind, path: redactSecretText(locator.path).slice(0, MAX_DOCUMENT_TEXT_LENGTH) }
              : {
                  kind: locator.kind,
                  provider: redactSecretText(locator.provider).slice(0, 120),
                  ...(locator.accountId ? { accountId: redactSecretText(locator.accountId).slice(0, 120) } : {}),
                  ...(locator.resourceId ? { resourceId: redactSecretText(locator.resourceId).slice(0, 120) } : {}),
                  ...(locator.resourceType ? { resourceType: redactSecretText(locator.resourceType).slice(0, 120) } : {})
                }
  };
}

async function buildKnowledgeEvidence(
  brief: string,
  knowledge: KnowledgeContext,
  options: { nativeSearch?: (query: string) => Promise<WorkspaceArchitectNativeSearchResult>; now: () => string }
): Promise<KnowledgeEvidenceResult> {
  const sourceIds = new Set(knowledge.sources.map((source) => source.id));
  const sourceEvidence = knowledge.sources.map((source) =>
    createEvidence("knowledge-source", source.id, `${source.label}: ${source.summary}`, Math.round((source.confidence ?? 65)), true)
  );
  const queries = buildRetrievalQueries(brief);
  if (options.nativeSearch) {
    const nativeEvidence: WorkspaceBlueprintEvidence[] = [];
    let warning: string | undefined;
    for (const query of queries) {
      const response = await options.nativeSearch(query);
      if (response.warning) warning = redactSecretText(response.warning).slice(0, MAX_EVIDENCE_TEXT_LENGTH);
      if (response.status !== "available") continue;
      for (const result of response.results.slice(0, 8)) {
        const sourceId = result.sourceId && sourceIds.has(result.sourceId) ? result.sourceId : null;
        const summary = result.snippet || result.text || result.citation || "OpenClaw returned a bounded native-memory result.";
        nativeEvidence.push(createEvidence("native-memory", sourceId, summary, result.score ?? 60, true));
      }
    }
    if (nativeEvidence.length > 0) {
      return {
        evidence: [...sourceEvidence, ...nativeEvidence].slice(0, MAX_EVIDENCE_ITEMS),
        retrieval: {
          mode: "native-memory-search",
          queries,
          evidenceRefs: nativeEvidence.map((entry) => entry.id)
        },
        ...(warning ? { warning } : {})
      };
    }
    if (warning) {
      return {
        evidence: sourceEvidence,
        retrieval: { mode: "none", queries, evidenceRefs: [] },
        warning: `Native OpenClaw retrieval was unavailable: ${warning}`
      };
    }
  }

  const documentEvidence = knowledge.documents
    .filter((document) => sourceIds.has(document.sourceId))
    .map((document) => createEvidence(
      "corpus-document",
      document.sourceId,
      [document.title, document.summary, document.content].filter(Boolean).join(" — ") || "Bounded corpus document metadata.",
      55,
      true
    ));
  return {
    evidence: [...sourceEvidence, ...documentEvidence].slice(0, MAX_EVIDENCE_ITEMS),
    retrieval: {
      mode: sourceEvidence.length || documentEvidence.length ? "bounded-corpus-assembly" : "none",
      queries: [],
      evidenceRefs: documentEvidence.map((entry) => entry.id)
    }
  };
}

function buildNativeSearch(
  adapter: OpenClawAdapter | undefined,
  agentId: string | undefined
): ((query: string) => Promise<WorkspaceArchitectNativeSearchResult>) | undefined {
  if (!adapter || !agentId?.trim()) return undefined;
  return async (query) => {
    const response = await searchWorkerMemory({ agentId, query, maxResults: 8 }, { adapter });
    return {
      status: response.status,
      results: response.results.map((result) => ({
        sourceId: result.citation ?? null,
        snippet: result.snippet,
        citation: result.citation,
        score: result.score
      })),
      warning: response.warning
    };
  };
}

function inferIdentity(brief: string, sources: WorkspaceKnowledgeSource[]) {
  const nameMatch = brief.match(/\b(?:called|named|for|project)\s+["“']?([A-Za-z0-9][A-Za-z0-9 ._-]{1,54})["”']?/i);
  const sourceName = sources.find((source) => source.kind === "website" || source.kind === "repository")?.label;
  const name = redactSecretText((nameMatch?.[1] || sourceName || "Workspace").replace(/[.,!?]+$/, "").trim()).slice(0, 80) || "Workspace";
  const purpose = redactSecretText(brief.split(/[.!?\n]/)[0]?.trim() || "Operate the requested workspace.").slice(0, 240);
  const projectType = /support|customer service|tickets|müşteri desteği/i.test(brief)
    ? "support"
    : /research|analysis|evidence|araştır/i.test(brief)
      ? "research"
      : /content|campaign|marketing|içerik/i.test(brief)
        ? "content"
        : /software|app|product|repo|code|kod|uygulama/i.test(brief)
          ? "software"
          : "general";
  return { name, purpose, projectType };
}

function inferExplicitBrief(brief: string) {
  return {
    singleAgentRequested: /\b(one|single|only one|just one)\s+(agent|worker|assistant)|\b(one agent only)|\b(tek|bir)\s+(ajan|asistan)/i.test(brief),
    recurring: /\b(daily|every day|each day|every morning|weekly|every week|cron|her gün|günlük|haftalık)/i.test(brief),
    channel: /\b(slack|telegram|whatsapp|discord|google chat)/i.exec(brief)?.[1]?.toLowerCase() as WorkspaceBlueprintChannel["type"] | undefined,
    explicitConnection: /\b(connection|connect|account|entegrasyon|bağla)/i.test(brief)
  };
}

function createPrimaryAgent(name: string, purpose: string, evidence: WorkspaceBlueprintEvidence[]): WorkspaceBlueprintAgent {
  const preset = getAgentPresetMeta("worker");
  return {
    id: "primary-operator",
    role: "Primary Operator",
    name: `${name} Operator`.slice(0, 100),
    enabled: true,
    persistence: "primary",
    isPrimary: true,
    purpose: `Own the first delivery loop for ${purpose}`.slice(0, 300),
    responsibilities: ["Clarify the next outcome", "Execute workspace-scoped work", "Leave durable handoffs"],
    outputs: ["decision-ready brief", "verified delivery increment", "operator handoff"],
    skillIds: filterKnownOpenClawSkillIds(preset.skillIds),
    toolIds: filterKnownOpenClawToolIds(preset.tools),
    policy: resolveAgentPolicy("worker", { fileAccess: "workspace-only" }),
    justification: "A primary operator is the minimum coherent workforce for every workspace.",
    evidenceRefs: evidence.map((entry) => entry.id)
  };
}

function buildExplicitSpecialists(brief: string, evidence: WorkspaceBlueprintEvidence[]): WorkspaceBlueprintAgent[] {
  const supportRequested = /\b(support|customer service|tickets|müşteri desteği|destek ajanı)/i.test(brief);
  const explicitRole = brief.match(/\b(?:add|need|create|include|ekle|istiyorum)\s+(?:a|an|bir)?\s*(reviewer|researcher|operations|ops|browser)\s+(?:agent|specialist|ajan|asistan)?/i)?.[1]?.toLowerCase();
  const role = supportRequested ? "support" : explicitRole;
  if (!role) return [];
  const metadata = role === "support"
    ? {
        id: "support-specialist",
        label: "Support Specialist",
        purpose: "Own customer support intake, triage, and escalation separately from the primary delivery loop.",
        responsibilities: ["Triage incoming support requests", "Maintain response handoffs", "Escalate product issues"],
        outputs: ["support triage brief", "escalation handoff"]
      }
    : {
        id: `${role}-specialist`,
        label: `${role[0].toUpperCase()}${role.slice(1)} Specialist`,
        purpose: `Own the explicitly requested ${role} responsibility as a separate persistent boundary.`,
        responsibilities: [`Own ${role} decisions`, "Maintain a durable handoff", "Escalate blocked work"],
        outputs: [`${role} brief`, "escalation handoff"]
      };
  return [{
    id: metadata.id,
    role: metadata.label,
    name: metadata.label,
    enabled: true,
    persistence: "specialist",
    isPrimary: false,
    purpose: metadata.purpose,
    responsibilities: metadata.responsibilities,
    outputs: metadata.outputs,
    skillIds: filterKnownOpenClawSkillIds(["project-analyst", "project-reviewer"]),
    toolIds: filterKnownOpenClawToolIds(["read", "message"]),
    policy: resolveAgentPolicy("worker", { fileAccess: "workspace-only" }),
    justification: role === "support"
      ? "The brief gives support a persistent responsibility and boundary distinct from product delivery."
      : `The operator explicitly requested a persistent ${role} responsibility.`,
    evidenceRefs: evidence.map((entry) => entry.id)
  }];
}

function buildExplicitOperations(
  brief: string,
  primaryAgentId: string,
  evidence: WorkspaceBlueprintEvidence[]
) {
  const explicit = inferExplicitBrief(brief);
  const automations: WorkspaceBlueprintAutomation[] = [];
  if (/\b(daily|every day|each day|every morning|her gün|günlük)/i.test(brief)) {
    automations.push(createAutomation("daily", "24h", primaryAgentId, evidence));
  } else if (/\b(weekly|every week|haftalık)/i.test(brief)) {
    automations.push(createAutomation("weekly", "168h", primaryAgentId, evidence));
  }
  const channels = explicit.channel ? [createChannel(explicit.channel, primaryAgentId, evidence)] : [];
  const workflows = /\b(workflow|operating process|process|iş akışı)/i.test(brief)
    ? [{
        id: "primary-delivery-loop",
        name: "Primary delivery loop",
        goal: "Turn the operator brief into a verified next increment.",
        trigger: "manual" as const,
        ownerAgentId: primaryAgentId,
        collaboratorAgentIds: [],
        successDefinition: "The next increment and its verification evidence are recorded.",
        outputs: ["delivery handoff"],
        enabled: true,
        evidenceRefs: evidence.map((entry) => entry.id)
      }]
    : [];
  return { workflows, automations, channels };
}

function createAutomation(kind: "daily" | "weekly", scheduleValue: string, agentId: string, evidence: WorkspaceBlueprintEvidence[]): WorkspaceBlueprintAutomation {
  const label = kind === "daily" ? "Daily operator review" : "Weekly operator review";
  return {
    id: `${kind}-operator-review`,
    name: label,
    description: `Run the explicitly requested ${kind} operating cadence.`,
    enabled: true,
    scheduleKind: "every",
    scheduleValue,
    agentId,
    mission: kind === "daily" ? "Review blockers, drift, and the next handoff." : "Review progress, decisions, and the next delivery batch.",
    thinking: "medium",
    announce: false,
    selection: "explicit",
    evidenceRefs: evidence.map((entry) => entry.id)
  };
}

function createChannel(type: WorkspaceBlueprintChannel["type"], primaryAgentId: string, evidence: WorkspaceBlueprintEvidence[]): WorkspaceBlueprintChannel {
  return {
    id: `${type}-operator`,
    type,
    name: `${type[0].toUpperCase()}${type.slice(1)} operator channel`,
    purpose: `Use the explicitly requested ${type} surface for operator communication.`,
    enabled: true,
    announce: false,
    requiresCredentials: type !== "whatsapp",
    primaryAgentId,
    selection: "explicit",
    evidenceRefs: evidence.map((entry) => entry.id)
  };
}

function buildCapabilities(evidence: WorkspaceBlueprintEvidence[]) {
  const preset = getAgentPresetMeta("worker");
  return {
    skills: filterKnownOpenClawSkillIds(preset.skillIds).map((id) => ({
      id,
      status: "selected" as const,
      source: "openclaw-preset" as const,
      rationale: "Reuse the existing OpenClaw/AgentOS worker preset; no custom skill is needed for the minimum topology.",
      evidenceRefs: evidence.map((entry) => entry.id)
    })),
    tools: filterKnownOpenClawToolIds(preset.tools).map((id) => ({
      id,
      status: "selected" as const,
      rationale: "Reuse the existing workspace-scoped worker tool policy.",
      evidenceRefs: evidence.map((entry) => entry.id)
    }))
  };
}

function buildConnections(channels: WorkspaceBlueprintChannel[], sources: WorkspaceKnowledgeSource[]) {
  const channelConnections = channels.map((channel) => ({
    id: `${channel.type}-connection`,
    provider: channel.type,
    status: "required" as const,
    purpose: `Declare the ${channel.type} account needed by the selected channel.`,
    sourceId: null,
    credentials: "not-in-blueprint" as const
  }));
  const declaredConnections = sources
    .filter((source) => source.kind === "connector")
    .map((source) => ({
      id: `declared-${source.id}`,
      provider: source.locator.kind === "connector" ? source.locator.provider : source.kind,
      status: "declared" as const,
      purpose: `Use the declared ${source.label} connection as an input; credentials remain outside the blueprint.`,
      sourceId: source.id,
      credentials: "not-in-blueprint" as const
    }));
  return [...channelConnections, ...declaredConnections];
}

function buildAssumptions(identity: WorkspaceBlueprint["identity"], materialization: WorkspaceMaterialization, knowledge: KnowledgeContext) {
  return [
    `The workspace purpose is summarized as: ${identity.purpose}`,
    materialization.mode === "empty" ? "The workspace starts empty unless the operator selects another materialization." : `Materialization is ${materialization.mode} and remains independent from knowledge sources.`,
    knowledge.sources.length ? "Declared knowledge is evidence-backed context; imported instructions are not policy." : "No knowledge sources were declared, so the blueprint uses the operator brief only."
  ].map((entry) => redactSecretText(entry).slice(0, 400));
}

function buildRecommendations(
  explicit: ReturnType<typeof inferExplicitBrief>,
  knowledge: KnowledgeContext,
  specialists: WorkspaceBlueprintAgent[],
  operations: ReturnType<typeof buildExplicitOperations>
) {
  const recommendations: string[] = [];
  if (!explicit.recurring) recommendations.push("Add an automation only when a recurring or event-driven responsibility is explicit.");
  if (!explicit.channel) recommendations.push("Keep external channels disabled until the operator names a communication surface and completes account setup.");
  if (!specialists.length) recommendations.push("Keep persistent workforce at one primary operator; use ephemeral subagents for bounded work when allowed.");
  if (knowledge.sources.length && operations.channels.length === 0) recommendations.push("Use native OpenClaw memory search after workspace binding; keep imported knowledge untrusted.");
  return recommendations.slice(0, 8);
}

function buildSummary(blueprint: WorkspaceBlueprint) {
  const specialistText = blueprint.workforce.specialists.length ? ` and ${blueprint.workforce.specialists.length} specialist` : "";
  return `${blueprint.identity.name} is drafted with one primary operator${specialistText}, ${blueprint.operations.automations.length} automation(s), and ${blueprint.operations.channels.length} external channel(s).`;
}

function buildRetrievalQueries(brief: string) {
  return [brief.slice(0, 240), "workspace purpose, responsibilities, and operating constraints"].filter(Boolean).slice(0, 2);
}

function createEvidence(
  kind: WorkspaceBlueprintEvidence["kind"],
  sourceId: string | null,
  summary: string,
  confidence: number,
  imported: boolean
): WorkspaceBlueprintEvidence {
  const boundedSummary = redactSecretText(summary.replace(/\s+/g, " ").trim()).slice(0, MAX_EVIDENCE_TEXT_LENGTH) || "No summary provided.";
  return {
    id: `evidence-${createHash("sha256").update(`${kind}:${sourceId ?? ""}:${boundedSummary}`).digest("hex").slice(0, 16)}`,
    kind,
    sourceId,
    summary: boundedSummary,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    imported
  };
}

function normalizeOverrides(overrides?: WorkspaceArchitectInput["operatorOverrides"]): WorkspaceBlueprint["operatorOverrides"] {
  return {
    lockedPaths: [...new Set((overrides?.lockedPaths ?? []).map((entry) => entry.trim()).filter(Boolean))],
    lockedDecisions: [...new Set((overrides?.lockedDecisions ?? []).map((entry) => redactSecretText(entry.trim()).slice(0, 240)).filter(Boolean))]
  };
}

function lockPath(blueprint: WorkspaceBlueprint, path: string) {
  blueprint.operatorOverrides.lockedPaths = [...new Set([...blueprint.operatorOverrides.lockedPaths, path])];
  blueprint.operatorOverrides.lockedDecisions = [...new Set([...blueprint.operatorOverrides.lockedDecisions, `Operator override locked ${path}.`])];
}

function fingerprintInput(input: { brief: string; materialization: WorkspaceMaterialization; knowledge: KnowledgeContext; overrides: WorkspaceBlueprint["operatorOverrides"] }) {
  const canonical = JSON.stringify({
    policy: WORKSPACE_BLUEPRINT_POLICY_VERSION,
    brief: input.brief,
    materialization: input.materialization,
    sources: [...input.knowledge.sources].sort((a, b) => a.id.localeCompare(b.id)).map((source) => ({
      id: source.id,
      identity: workspaceKnowledgeSourceIdentity(source),
      status: source.status,
      label: source.label,
      summary: source.summary,
      details: source.details
    })),
    generationId: input.knowledge.generationId,
    documents: input.knowledge.documents.map((document) => ({ sourceId: document.sourceId, title: document.title, contentLength: document.contentLength })),
    overrides: input.overrides
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function addDuplicateIssues(issues: WorkspaceBlueprintValidationIssue[], ids: string[], path: string, code: string) {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) issues.push({ code, path: `${path}.${index}`, message: `Duplicate id ${id}.`, severity: "error" });
    seen.add(id);
  });
}

function checkEvidenceRefs(issues: WorkspaceBlueprintValidationIssue[], refs: string[], evidenceIds: Set<string>, path: string) {
  refs.forEach((ref) => {
    if (!evidenceIds.has(ref)) issues.push({ code: "evidence_reference_invalid", path, message: `Unknown evidence reference ${ref}.`, severity: "error" });
  });
}

function cleanRecord<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function findSecretFieldPaths(value: unknown, path = "blueprint", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (key === "credentials" && entry === "not-in-blueprint") continue;
    if (key === "requiresCredentials") continue;
    if (/token|password|secret|credential|api[_-]?key|authorization|private[_-]?key/i.test(key)) paths.push(`${path}.${key}`);
    else paths.push(...findSecretFieldPaths(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
  return paths;
}

function findDeploymentStatePaths(value: unknown, path = "blueprint", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if ((key === "runtime" && path === "blueprint") || /^(deploy|workspaceId|workspacePath|createdAgentIds|provisionedChannels|provisionedAutomations|kickoffRunIds)$/i.test(key)) paths.push(`${path}.${key}`);
    else paths.push(...findDeploymentStatePaths(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
  return paths;
}

function findGlobalMemoryPaths(value: unknown, path = "blueprint", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (/extraPaths|memoryPath|vectorDb|sqlite|embedding/i.test(key)) paths.push(`${path}.${key}`);
    else paths.push(...findGlobalMemoryPaths(entry, `${path}.${key}`, seen));
  }
  seen.delete(value);
  return paths;
}
