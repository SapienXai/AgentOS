import type {
  WorkspaceArchitectResult,
  WorkspaceBlueprint,
  WorkspaceBlueprintChannel
} from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspaceCreationArtifactReviewSummary, WorkspaceCreationCompositionSnapshot, WorkspaceCreationExtractionSnapshot, WorkspaceCreationIntelligenceReviewSnapshot, WorkspaceCreationIntelligenceSnapshot } from "@/lib/agentos/domains/workspace-creation-run";

type ProjectReviewModel = {
  name: string | null;
  description: string | null;
  projectType: string | null;
  keyFacts: WorkspaceCreationIntelligenceReviewSnapshot["facts"];
  officialResources: WorkspaceCreationIntelligenceReviewSnapshot["resources"];
  understanding: string[];
  conflicts: WorkspaceCreationIntelligenceReviewSnapshot["conflicts"];
};

type ReviewCoverageModel = {
  status: "none" | "partial" | "full";
  reason: string | null;
};

export type WorkspaceBlueprintReviewModel = {
  identity: WorkspaceBlueprint["identity"];
  primaryAgent: WorkspaceBlueprint["workforce"]["primaryAgent"];
  specialists: WorkspaceBlueprint["workforce"]["specialists"];
  knowledge: WorkspaceBlueprint["knowledge"];
  capabilities: WorkspaceBlueprint["capabilities"];
  memory: WorkspaceBlueprint["memory"];
  connections: WorkspaceBlueprint["connections"];
  automations: WorkspaceBlueprint["operations"]["automations"];
  channels: WorkspaceBlueprint["operations"]["channels"];
  workflows: WorkspaceBlueprint["operations"]["workflows"];
  warnings: string[];
  recommendations: string[];
  fallback: boolean;
  partialContext: boolean;
  contextWarning: string | null;
  failureCategory: string | null;
  attempts: number;
  elapsedMs: number;
  retryAvailable: boolean;
  extraction: WorkspaceCreationExtractionSnapshot | null;
  intelligence: WorkspaceCreationIntelligenceSnapshot | null;
  composition: WorkspaceCreationCompositionSnapshot | null;
  freshness: WorkspaceArchitectResult["freshness"];
  projectIntelligence: {
    projectName: string | null;
    description: string | null;
    projectType: string | null;
    understanding: string[];
    facts: NonNullable<WorkspaceCreationIntelligenceSnapshot["review"]>["facts"];
    resources: NonNullable<WorkspaceCreationIntelligenceSnapshot["review"]>["resources"];
    conflicts: NonNullable<WorkspaceCreationIntelligenceSnapshot["review"]>["conflicts"];
    unknowns: string[];
    sourceCount: number;
    evidenceCount: number;
  } | null;
  workspaceFiles: WorkspaceCreationArtifactReviewSummary[];
  project: ProjectReviewModel;
  workforce: {
    primaryAgent: WorkspaceBlueprint["workforce"]["primaryAgent"];
    specialists: WorkspaceBlueprint["workforce"]["specialists"];
  };
  skills: WorkspaceBlueprint["capabilities"]["skills"];
  tools: WorkspaceBlueprint["capabilities"]["tools"];
  officialResources: WorkspaceCreationIntelligenceReviewSnapshot["resources"];
  sourceSummary: {
    sourceCount: number;
    evidenceCount: number;
    factCount: number;
    resourceCount: number;
    conflictCount: number;
  };
  coverage: ReviewCoverageModel;
  attention: string[];
  technicalDetails: {
    extractionStatus: WorkspaceCreationExtractionSnapshot["status"] | null;
    intelligenceStatus: WorkspaceCreationIntelligenceSnapshot["status"] | null;
    compositionStatus: WorkspaceCreationCompositionSnapshot["status"] | null;
    freshness: WorkspaceArchitectResult["freshness"]["status"];
  };
};

export function presentWorkspaceBlueprint(result: WorkspaceArchitectResult, options: {
  partialContext?: boolean;
  attempts?: number;
  elapsedMs?: number;
  retryAvailable?: boolean;
  failureCategory?: string | null;
  extraction?: WorkspaceCreationExtractionSnapshot | null;
  intelligence?: WorkspaceCreationIntelligenceSnapshot | null;
  composition?: WorkspaceCreationCompositionSnapshot | null;
} = {}): WorkspaceBlueprintReviewModel {
  const fallback = result.reasoning.status === "fallback" || result.blueprint.status === "draft";
  const partialContext = options.partialContext === true || result.blueprint.warnings.some((warning) => /partial project context/i.test(warning));
  const projectIntelligence = options.intelligence?.review ?? null;
  const project: ProjectReviewModel = {
    name: projectIntelligence?.projectName ?? result.blueprint.identity.name,
    description: projectIntelligence?.description ?? null,
    projectType: projectIntelligence?.projectType ?? result.blueprint.identity.projectType,
    keyFacts: projectIntelligence?.facts ?? [],
    officialResources: projectIntelligence?.resources ?? [],
    understanding: projectIntelligence?.understanding ?? [projectIntelligence?.description, ...(projectIntelligence?.unknowns ?? []).map((unknown) => `Unknown: ${unknown}`)].filter((value): value is string => Boolean(value)).slice(0, 8),
    conflicts: projectIntelligence?.conflicts ?? []
  };
  const sourceSummary = {
    sourceCount: projectIntelligence?.sourceCount ?? 0,
    evidenceCount: projectIntelligence?.evidenceCount ?? 0,
    factCount: projectIntelligence?.facts.length ?? 0,
    resourceCount: projectIntelligence?.resources.length ?? 0,
    conflictCount: projectIntelligence?.conflicts.length ?? 0
  };
  const coverage: ReviewCoverageModel = sourceSummary.sourceCount === 0 && sourceSummary.evidenceCount === 0 && sourceSummary.factCount === 0 && sourceSummary.resourceCount === 0
    ? { status: "none", reason: null }
    : options.extraction?.status === "partial" || options.intelligence?.partialContext === true
      ? { status: "partial", reason: "Some project context could not be fully staged within the analysis budget." }
      : { status: "full", reason: null };
  const attention = [...new Set([
    ...result.warnings,
    ...(partialContext ? ["Architecture generated from partial project context."] : []),
    ...(project.conflicts.some((conflict) => conflict.status === "open") ? ["Open project conflicts remain visible for review."] : [])
  ])].slice(0, 8);
  return {
    identity: result.blueprint.identity,
    primaryAgent: result.blueprint.workforce.primaryAgent,
    specialists: result.blueprint.workforce.specialists,
    knowledge: result.blueprint.knowledge,
    capabilities: result.blueprint.capabilities,
    memory: result.blueprint.memory,
    connections: result.blueprint.connections,
    automations: result.blueprint.operations.automations,
    channels: result.blueprint.operations.channels,
    workflows: result.blueprint.operations.workflows,
    warnings: result.warnings,
    recommendations: result.recommendations,
    fallback,
    partialContext,
    contextWarning: partialContext ? "Architecture generated from partial project context." : null,
    failureCategory: options.failureCategory ?? result.reasoning.failureCode ?? (fallback ? result.reasoning.failureKind : null),
    attempts: options.attempts ?? result.reasoning.attempts,
    elapsedMs: options.elapsedMs ?? 0,
    retryAvailable: options.retryAvailable ?? (result.reasoning.retryability === "transient" || result.reasoning.retryability === "repairable"),
    extraction: options.extraction ?? null,
    intelligence: options.intelligence ?? null,
    composition: options.composition ?? null,
    freshness: result.freshness,
    projectIntelligence,
    workspaceFiles: options.composition?.artifacts ?? [],
    project,
    workforce: { primaryAgent: result.blueprint.workforce.primaryAgent, specialists: result.blueprint.workforce.specialists },
    skills: result.blueprint.capabilities.skills,
    tools: result.blueprint.capabilities.tools,
    officialResources: project.officialResources,
    sourceSummary,
    coverage,
    attention,
    technicalDetails: {
      extractionStatus: options.extraction?.status ?? null,
      intelligenceStatus: options.intelligence?.status ?? null,
      compositionStatus: options.composition?.status ?? null,
      freshness: result.freshness.status
    }
  };
}

export function formatWorkspaceSourceKind(kind: string) {
  switch (kind) {
    case "website":
      return "Website";
    case "repository":
      return "Repository";
    case "file":
      return "File";
    case "folder":
      return "Folder";
    case "connector":
      return "Connected source";
    default:
      return "Brief";
  }
}

export function formatWorkspaceChannelSetup(channel: Pick<WorkspaceBlueprintChannel, "authenticationKind" | "requiresCredentials" | "requiresAuthentication">) {
  if (!channel.requiresAuthentication) return "Ready to use";
  if (channel.authenticationKind === "qr-session") return "Setup required · QR sign-in";
  if (channel.authenticationKind === "service-account") return "Setup required · Service account";
  if (channel.authenticationKind === "token" || channel.requiresCredentials) return "Setup required · Token";
  return "Setup required";
}

export function formatWorkspaceSchedule(scheduleKind: string, scheduleValue: string) {
  return scheduleKind === "cron" ? `Schedule · ${scheduleValue}` : `Every ${scheduleValue}`;
}
