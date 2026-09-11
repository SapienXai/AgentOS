import { createHash } from "node:crypto";

import { normalizeDiscoveryHttpUrl } from "@/lib/agentos/domains/project-discovery";
import type { OfficialResource, ProjectConflict, ProjectFact, ProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";

export type WorkspaceArtifactFreshnessStatus = "fresh" | "stale" | "unknown" | "partial";

export type WorkspaceFreshnessResult = {
  status: WorkspaceArtifactFreshnessStatus;
  reason: string;
  checkedAt: string;
  knowledgeGenerationId: string | null;
  blueprintFingerprint: string | null;
  compositionPlanFingerprint: string | null;
};

export type WorkspaceFileInventoryEntry = { path: string; hash: string };

export type WorkspaceFreshnessInput = {
  blueprint: Pick<WorkspaceBlueprint, "knowledge" | "provenance">;
  currentKnowledgeGenerationId?: string | null;
  expectedBlueprintFingerprint?: string | null;
  compositionPlan?: WorkspaceCompositionPlan | null;
  currentCompositionPlanFingerprint?: string | null;
  declaredSourceFingerprint?: string | null;
  currentSourceFingerprint?: string | null;
  partialContext?: boolean;
  checkedAt?: string;
};

export type WorkspaceDriftCategory = "facts" | "resources" | "conflicts" | "blueprint" | "composition" | "files";

export type WorkspaceDriftSummary = {
  status: "none" | "detected" | "unknown" | "partial";
  categories: readonly WorkspaceDriftCategory[];
  changes: readonly string[];
  warning: string | null;
};

export function assessWorkspaceFreshness(input: WorkspaceFreshnessInput): WorkspaceFreshnessResult {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const knowledgeGenerationId = input.currentKnowledgeGenerationId ?? null;
  const blueprintFingerprint = input.expectedBlueprintFingerprint ?? null;
  const compositionPlanFingerprint = input.compositionPlan?.inputFingerprint ?? input.currentCompositionPlanFingerprint ?? null;
  if (input.partialContext) {
    return {
      status: "partial",
      reason: "The artifact depends on usable but incomplete project context.",
      checkedAt,
      knowledgeGenerationId,
      blueprintFingerprint,
      compositionPlanFingerprint
    };
  }
  if (input.declaredSourceFingerprint !== undefined && input.currentSourceFingerprint !== undefined
    && input.declaredSourceFingerprint !== input.currentSourceFingerprint) {
    return { status: "stale", reason: "The declared project sources changed after this artifact was generated.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  const blueprintGenerationId = input.blueprint.provenance.knowledgeGenerationId ?? input.blueprint.knowledge.generationId ?? null;
  if (input.blueprint.knowledge.sourceIds.length > 0 && !knowledgeGenerationId) {
    return { status: "unknown", reason: "The current project knowledge generation could not be proven.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  if (blueprintGenerationId && knowledgeGenerationId && blueprintGenerationId !== knowledgeGenerationId) {
    return { status: "stale", reason: "The project knowledge generation changed after this artifact was generated.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  if (input.compositionPlan && input.expectedBlueprintFingerprint
    && input.compositionPlan.workspaceBlueprintFingerprint !== input.expectedBlueprintFingerprint) {
    return { status: "stale", reason: "The composition plan is bound to an older workspace blueprint.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  if (input.currentCompositionPlanFingerprint !== undefined && input.compositionPlan
    && input.compositionPlan.inputFingerprint !== input.currentCompositionPlanFingerprint) {
    return { status: "stale", reason: "The reviewed composition plan changed after this artifact was generated.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  if (input.blueprint.knowledge.sourceIds.length > 0 && !blueprintGenerationId) {
    return { status: "unknown", reason: "The blueprint does not identify the knowledge generation used to create it.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
  }
  return { status: "fresh", reason: "The reviewed artifacts agree on their current source and generation identities.", checkedAt, knowledgeGenerationId, blueprintFingerprint, compositionPlanFingerprint };
}

export function summarizeWorkspaceDrift(input: {
  previousPack?: ProjectIntelligencePack | null;
  currentPack?: ProjectIntelligencePack | null;
  previousBlueprint?: WorkspaceBlueprint | null;
  currentBlueprint?: WorkspaceBlueprint | null;
  previousComposition?: WorkspaceCompositionPlan | null;
  currentComposition?: WorkspaceCompositionPlan | null;
  previousFiles?: readonly WorkspaceFileInventoryEntry[];
  currentFiles?: readonly WorkspaceFileInventoryEntry[];
  partial?: boolean;
}): WorkspaceDriftSummary {
  if (input.partial) return { status: "partial", categories: [], changes: [], warning: "Drift comparison is partial because one or more upstream artifacts are incomplete." };
  const categories: WorkspaceDriftCategory[] = [];
  const changes: string[] = [];
  const unknown: string[] = [];
  const comparePack = (previous: ProjectIntelligencePack | null | undefined, current: ProjectIntelligencePack | null | undefined) => {
    if (!previous || !current) {
      if (previous || current) unknown.push("Project Intelligence pack comparison unavailable");
      return;
    }
    if (fingerprint({ facts: projectFactsDriftView(previous.facts) }) !== fingerprint({ facts: projectFactsDriftView(current.facts) })) { categories.push("facts"); changes.push("Project facts changed"); }
    if (fingerprint({ resources: officialResourcesDriftView(previous.officialResources) }) !== fingerprint({ resources: officialResourcesDriftView(current.officialResources) })) { categories.push("resources"); changes.push("Official resources changed"); }
    if (fingerprint({ conflicts: projectConflictsDriftView(previous.conflicts, previous.facts, previous.officialResources) }) !== fingerprint({ conflicts: projectConflictsDriftView(current.conflicts, current.facts, current.officialResources) })) { categories.push("conflicts"); changes.push("Project conflicts changed"); }
  };
  comparePack(input.previousPack, input.currentPack);
  if (input.previousBlueprint || input.currentBlueprint) {
    if (!input.previousBlueprint || !input.currentBlueprint) unknown.push("Workspace blueprint comparison unavailable");
    else if (fingerprint(workspaceBlueprintDriftView(input.previousBlueprint)) !== fingerprint(workspaceBlueprintDriftView(input.currentBlueprint))) {
      categories.push("blueprint");
      changes.push("Workspace blueprint decisions changed");
    }
  }
  if (input.previousComposition || input.currentComposition) {
    if (!input.previousComposition || !input.currentComposition) unknown.push("Workspace composition comparison unavailable");
    else if (fingerprint(workspaceCompositionDriftView(input.previousComposition)) !== fingerprint(workspaceCompositionDriftView(input.currentComposition))) {
      categories.push("composition");
      changes.push("Workspace composition plan changed");
    }
  }
  if (input.previousFiles || input.currentFiles) {
    if (!input.previousFiles || !input.currentFiles) unknown.push("Workspace file inventory comparison unavailable");
    else if (fingerprint(normalizeFiles(input.previousFiles)) !== fingerprint(normalizeFiles(input.currentFiles))) {
      categories.push("files");
      changes.push("Managed workspace files changed");
    }
  }
  const boundedCategories = [...new Set(categories)].slice(0, 6);
  const boundedChanges = [...new Set([...changes, ...unknown])].slice(0, 24);
  return {
    status: unknown.length > 0 && boundedCategories.length === 0 ? "unknown" : boundedCategories.length > 0 ? "detected" : "none",
    categories: boundedCategories,
    changes: boundedChanges,
    warning: unknown.length > 0 ? "Some upstream artifacts could not be compared deterministically." : null
  };
}

export function stableWorkspaceFingerprint(value: unknown) {
  return fingerprint(value);
}

export function projectFactDriftView(fact: ProjectFact) {
  return {
    category: fact.category,
    key: fact.key,
    normalizedValue: fact.normalizedValue,
    verification: fact.verification
  };
}

export function officialResourceDriftView(resource: OfficialResource) {
  return {
    category: resource.category,
    locator: {
      kind: resource.locator.kind,
      value: canonicalResourceLocatorForComparison(resource.locator)
    },
    verification: resource.verification
  };
}

/**
 * Canonicalizes resource identity for comparison without changing the stored
 * domain value. URL hosts and schemes are case-insensitive, while URL paths,
 * queries, and public identifiers retain their meaningful case.
 */
export function canonicalResourceLocatorForComparison(locator: OfficialResource["locator"]): string {
  const value = locator.value.trim();
  if (locator.kind === "url") {
    try { return normalizeDiscoveryHttpUrl(value).toString(); } catch { return value; }
  }
  if (locator.kind === "email") {
    const separator = value.lastIndexOf("@");
    return separator > 0 ? `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}` : value;
  }
  return value;
}

export function projectFactsDriftView(facts: readonly ProjectFact[]) {
  return [...facts].map(projectFactDriftView).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)));
}

export function officialResourcesDriftView(resources: readonly OfficialResource[]) {
  return [...resources].map(officialResourceDriftView).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)));
}

export function projectConflictsDriftView(
  conflicts: readonly ProjectConflict[],
  facts: readonly ProjectFact[] = [],
  resources: readonly OfficialResource[] = []
) {
  const factsById = new Map(facts.map((fact) => [fact.id, projectFactDriftView(fact)]));
  const resourcesById = new Map(resources.map((resource) => [resource.id, officialResourceDriftView(resource)]));
  return [...conflicts].map((conflict) => ({
    status: conflict.status,
    subjects: conflict.subjects.map((subject) => subject.kind === "fact"
      ? { kind: subject.kind, claim: factsById.get(subject.id) ?? { kind: subject.kind, unresolved: true } }
      : { kind: subject.kind, resource: resourcesById.get(subject.id) ?? { kind: subject.kind, unresolved: true } }
    ).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
  })).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)));
}

export function workspaceBlueprintDriftView(blueprint: WorkspaceBlueprint) {
  const agent = (value: WorkspaceBlueprint["workforce"]["primaryAgent"]) => ({
    role: value.role,
    name: value.name,
    persistence: value.persistence,
    isPrimary: value.isPrimary,
    purpose: value.purpose,
    responsibilities: value.responsibilities,
    outputs: value.outputs,
    skillIds: value.skillIds,
    toolIds: value.toolIds,
    policy: value.policy
  });
  const workflow = (value: WorkspaceBlueprint["operations"]["workflows"][number]) => ({
    id: value.id,
    name: value.name,
    goal: value.goal,
    trigger: value.trigger,
    ownerAgentId: value.ownerAgentId,
    collaboratorAgentIds: value.collaboratorAgentIds,
    successDefinition: value.successDefinition,
    outputs: value.outputs,
    enabled: value.enabled
  });
  const automation = (value: WorkspaceBlueprint["operations"]["automations"][number]) => ({
    id: value.id,
    name: value.name,
    description: value.description,
    enabled: value.enabled,
    scheduleKind: value.scheduleKind,
    scheduleValue: value.scheduleValue,
    agentId: value.agentId,
    mission: value.mission,
    thinking: value.thinking,
    announce: value.announce,
    selection: value.selection
  });
  const channel = (value: WorkspaceBlueprint["operations"]["channels"][number]) => ({
    id: value.id,
    type: value.type,
    name: value.name,
    purpose: value.purpose,
    target: value.target ?? null,
    enabled: value.enabled,
    announce: value.announce,
    authenticationKind: value.authenticationKind,
    requiresCredentials: value.requiresCredentials,
    requiresAuthentication: value.requiresAuthentication,
    primaryAgentId: value.primaryAgentId,
    selection: value.selection
  });
  return {
    identity: blueprint.identity,
    brief: blueprint.brief,
    operatorConstraints: blueprint.operatorConstraints,
    materialization: blueprint.materialization,
    knowledge: {
      // Retrieval queries and evidence ids are generation metadata. The
      // selected retrieval mode remains part of the architecture decision.
      retrieval: { mode: blueprint.knowledge.retrieval.mode }
    },
    workforce: {
      primaryAgent: agent(blueprint.workforce.primaryAgent),
      specialists: blueprint.workforce.specialists.map(agent).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
      allowEphemeralSubagents: blueprint.workforce.allowEphemeralSubagents,
      maxParallelRuns: blueprint.workforce.maxParallelRuns
    },
    capabilities: {
      skills: blueprint.capabilities.skills.map((skill) => ({ id: skill.id, status: skill.status, source: skill.source })).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
      tools: blueprint.capabilities.tools.map((tool) => ({ id: tool.id, status: tool.status })).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
    },
    connections: blueprint.connections.map((connection) => ({ id: connection.id, provider: connection.provider, status: connection.status, purpose: connection.purpose })).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
    operations: {
      workflows: blueprint.operations.workflows.map(workflow).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
      automations: blueprint.operations.automations.map(automation).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right))),
      channels: blueprint.operations.channels.map(channel).sort((left, right) => fingerprint(left).localeCompare(fingerprint(right)))
    },
    memory: {
      ownership: blueprint.memory.ownership,
      search: blueprint.memory.search,
      seedRequired: blueprint.memory.seedRequired,
      durableFacts: blueprint.memory.durableFacts
    },
    safety: {
      workspaceOnly: blueprint.safety.workspaceOnly,
      generationSideEffectFree: blueprint.safety.generationSideEffectFree,
      importedKnowledgeUntrusted: blueprint.safety.importedKnowledgeUntrusted
    }
  };
}

export function workspaceCompositionDriftView(plan: WorkspaceCompositionPlan) {
  return {
    artifacts: plan.artifacts.map((artifact) => ({
      path: artifact.path,
      operation: artifact.operation,
      ownership: artifact.ownership,
      sections: artifact.sections,
      content: artifact.content
    })).sort((left, right) => left.path.localeCompare(right.path)),
    conflicts: [...plan.conflicts].sort()
  };
}

function normalizeFiles(files: readonly WorkspaceFileInventoryEntry[]) {
  return files.map((file) => ({ path: file.path.replace(/\\/g, "/"), hash: file.hash })).sort((left, right) => left.path.localeCompare(right.path));
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
