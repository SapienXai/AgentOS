import { createHash } from "node:crypto";

import type { ProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
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
    if (fingerprint({ facts: previous.facts }) !== fingerprint({ facts: current.facts })) { categories.push("facts"); changes.push("Project facts changed"); }
    if (fingerprint({ resources: previous.officialResources }) !== fingerprint({ resources: current.officialResources })) { categories.push("resources"); changes.push("Official resources changed"); }
    if (fingerprint({ conflicts: previous.conflicts }) !== fingerprint({ conflicts: current.conflicts })) { categories.push("conflicts"); changes.push("Project conflicts changed"); }
  };
  comparePack(input.previousPack, input.currentPack);
  if (input.previousBlueprint || input.currentBlueprint) {
    if (!input.previousBlueprint || !input.currentBlueprint) unknown.push("Workspace blueprint comparison unavailable");
    else if (fingerprint(blueprintDriftView(input.previousBlueprint)) !== fingerprint(blueprintDriftView(input.currentBlueprint))) {
      categories.push("blueprint");
      changes.push("Workspace blueprint decisions changed");
    }
  }
  if (input.previousComposition || input.currentComposition) {
    if (!input.previousComposition || !input.currentComposition) unknown.push("Workspace composition comparison unavailable");
    else if (fingerprint(compositionDriftView(input.previousComposition)) !== fingerprint(compositionDriftView(input.currentComposition))) {
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

function blueprintDriftView(blueprint: WorkspaceBlueprint) {
  return {
    identity: blueprint.identity,
    knowledge: blueprint.knowledge,
    workforce: blueprint.workforce,
    operations: blueprint.operations,
    capabilities: blueprint.capabilities,
    connections: blueprint.connections,
    memory: blueprint.memory,
    warnings: blueprint.warnings
  };
}

function compositionDriftView(plan: WorkspaceCompositionPlan) {
  return {
    artifacts: plan.artifacts.map((artifact) => ({ artifactId: artifact.artifactId, path: artifact.path, operation: artifact.operation, content: artifact.content, warnings: artifact.warnings })),
    existingFileHashes: normalizeFiles(plan.existingFileHashes),
    conflicts: plan.conflicts,
    warnings: plan.warnings
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
