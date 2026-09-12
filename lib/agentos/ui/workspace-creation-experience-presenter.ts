import type { WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspaceCreationRun, WorkspaceCreationStage } from "@/lib/agentos/domains/workspace-creation-run";
import { presentWorkspaceCreationDiscovery, type WorkspaceCreationDiscoveryProjection } from "@/lib/agentos/domains/workspace-creation-discovery";
import { normalizeWorkspaceCreationProfile } from "@/lib/agentos/domains/workspace-creation-policy";
import type { WorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";

export type WorkspaceCreationExperienceStage = "input" | "analyzing" | "review" | "provisioning" | "complete" | "error";
export type WorkspaceCreationExperienceActivityStatus = "pending" | "active" | "complete" | "attention";

export type WorkspaceCreationExperienceModel = {
  stage: WorkspaceCreationExperienceStage;
  title: string;
  description: string;
  phaseLabel: string;
  primaryStatus: string;
  secondaryStatus: string | null;
  activities: Array<{ id: string; label: string; status: WorkspaceCreationExperienceActivityStatus }>;
  sources: Array<{ id: string; label: string; kind: string; status: "attached" | "reading" | "ready" | "partial" | "attention"; detail: string }>;
  projectSummary: { name: string; purpose: string; projectType: string } | null;
  workforceSummary: { primaryAgent: string; specialistCount: number; workflowCount: number; automationCount: number; channelCount: number } | null;
  workspaceFileSummary: { planned: number; conflicts: number; status: string } | null;
  attentionItems: string[];
  primaryAction: "generate" | "review" | "create" | "open" | "retry";
  debug: { runState: string | null; internalStage: WorkspaceCreationStage | null; attempts: number; elapsedMs: number };
  discovery: WorkspaceCreationDiscoveryProjection;
  /** The bounded live projection used by the analysis surface. */
  discoveries: WorkspaceCreationDiscoveryProjection["signals"];
  metrics: {
    pagesRead: number;
    documentsRead: number;
    factsFound: number;
    officialResources: number;
  };
  coverage: {
    status: "none" | "partial" | "full";
    reason: string | null;
  };
  currentActivity: string;
};

type ProvisioningLike = {
  state: string;
  progress?: { label: string; detail: string } | null;
  result?: unknown;
  error?: { message: string } | null;
};

export function presentWorkspaceCreationExperience(input: {
  run?: WorkspaceCreationRun | null;
  result?: WorkspaceArchitectResult | null;
  provisioningRun?: ProvisioningLike | null;
  sources?: readonly WorkspaceKnowledgeSource[];
}): WorkspaceCreationExperienceModel {
  const run = input.run ?? null;
  const result = input.result ?? null;
  const provisioningRun = input.provisioningRun ?? null;
  const sourceProgress = new Map((run?.snapshot.context.sourceProgress ?? []).map((source) => [source.sourceId, source]));
  const sourceList = input.sources ?? (run?.input.sources ?? []).filter(isWorkspaceKnowledgeSource);
  const sources = sourceList.map((source) => {
    const progress = sourceProgress.get(source.id);
    const status: WorkspaceCreationExperienceModel["sources"][number]["status"] = progress?.state === "ready" ? "ready" : progress?.state === "partial" ? "partial" : progress?.state === "failed" ? "attention" : progress ? "reading" : "attached";
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      status,
      detail: progress?.currentActivity ?? progress?.currentLocator ?? (status === "ready" ? "Project context ready" : status === "partial" ? "Some context was staged" : "Waiting to be read")
    };
  });
  const snapshot = run?.snapshot;
  const boundedProfile = normalizeWorkspaceCreationProfile(run?.input?.profile) !== "high";
  const discovery = run ? presentWorkspaceCreationDiscovery(run) : {
    signals: [],
    aggregate: { pages: 0, documents: 0, facts: 0, resources: 0, conflicts: 0 },
    currentActivity: "Reading project context",
    currentLocator: null,
    historyTruncated: false
  } satisfies WorkspaceCreationDiscoveryProjection;
  const isProvisioned = provisioningRun?.state === "ready" || provisioningRun?.state === "partial";
  const stage: WorkspaceCreationExperienceStage = isProvisioned
    ? "complete"
    : provisioningRun && !["failed", "cancelled"].includes(provisioningRun.state)
      ? "provisioning"
      : run?.snapshot.state === "failed"
        ? "error"
        : run?.snapshot.state === "review-ready" && result
          ? "review"
          : run
            ? "analyzing"
            : "input";
  const attentionItems = [
    snapshot?.context.status === "partial" ? "Architecture generated from partial project context." : null,
    !boundedProfile && snapshot?.intelligence.status === "fallback" ? "AI project intelligence was unavailable; extracted evidence was preserved." : null,
    !boundedProfile && snapshot?.architect.status === "fallback" ? "AI architecture was unavailable; a minimal fallback draft was created." : null,
    !boundedProfile && snapshot?.composition?.status === "fallback" ? "Workspace documents use a deterministic safe fallback." : null,
    snapshot?.composition && snapshot.composition.conflictCount > 0 ? `${snapshot.composition.conflictCount} workspace document conflict${snapshot.composition.conflictCount === 1 ? "" : "s"} need attention.` : null,
    provisioningRun?.state === "partial" ? "The workspace is usable, with setup still pending." : null,
    provisioningRun?.state === "failed" || provisioningRun?.state === "cancelled" ? provisioningRun.error?.message ?? "The workspace could not be completed." : null
  ].filter((item): item is string => Boolean(item));
  const activities = buildActivities(snapshot, provisioningRun, stage);
  const phaseLabel = stage === "analyzing"
    ? friendlyCreationPhase(snapshot?.stage, snapshot?.context.status === "partial")
    : stage === "provisioning"
      ? friendlyProvisioningPhase(provisioningRun?.state)
      : stage === "complete"
        ? "Ready"
        : stage === "review"
          ? "Review your workspace"
          : "Start with a project goal";
  const projectSummary = result?.blueprint.identity ?? null;
  const workforceSummary = result ? {
    primaryAgent: result.blueprint.workforce.primaryAgent.name,
    specialistCount: result.blueprint.workforce.specialists.length,
    workflowCount: result.blueprint.operations.workflows.length,
    automationCount: result.blueprint.operations.automations.length,
    channelCount: result.blueprint.operations.channels.length
  } : null;
  const composition = snapshot?.composition;
  const coverage = presentCoverage(snapshot, discovery);
  const durableReview = snapshot?.intelligence.review;
  return {
    stage,
    title: stage === "input" ? "Create a workspace" : stage === "analyzing" ? "Understanding your project" : stage === "review" ? "Review your workspace" : stage === "provisioning" ? "Creating workspace" : stage === "complete" ? "Workspace ready" : "Workspace needs attention",
    description: stage === "input" ? "Describe the work and add only the project context you want AgentOS to use." : stage === "analyzing" ? "AgentOS is reading the available project context and shaping a first workspace draft." : stage === "review" ? "Check the project, workforce, and workspace documents before creating anything." : stage === "provisioning" ? "The approved workspace is being created through OpenClaw." : stage === "complete" ? "Your workspace is ready to open." : "Review the saved draft and retry when the underlying issue is recoverable.",
    phaseLabel,
    primaryStatus: stage === "analyzing" ? phaseLabel : stage === "provisioning" ? friendlyProvisioningPhase(provisioningRun?.state) : stage === "complete" ? "Ready to open" : stage === "error" ? "Creation stopped" : stage === "review" ? "Draft ready" : "Brief ready",
    secondaryStatus: stage === "analyzing" && sources.length ? `${sources.length} project source${sources.length === 1 ? "" : "s"}` : snapshot?.architect.partialContext ? "Partial context" : null,
    activities,
    sources,
    projectSummary,
    workforceSummary,
    workspaceFileSummary: composition ? { planned: composition.artifactCount, conflicts: composition.conflictCount, status: composition.status } : null,
    attentionItems: [...new Set(attentionItems)].slice(0, 8),
    primaryAction: stage === "input" ? "generate" : stage === "review" ? "create" : stage === "complete" ? "open" : stage === "error" ? "retry" : "review",
    debug: { runState: snapshot?.state ?? null, internalStage: snapshot?.stage ?? null, attempts: snapshot?.architect.attempts ?? 0, elapsedMs: snapshot?.elapsedMs ?? 0 },
    discovery,
    discoveries: discovery.signals,
    metrics: {
      pagesRead: discovery.aggregate.pages,
      documentsRead: discovery.aggregate.documents,
      factsFound: durableReview?.facts.length ?? 0,
      officialResources: durableReview?.resources.length ?? 0
    },
    coverage,
    currentActivity: discovery.currentActivity
  };
}

function presentCoverage(snapshot: WorkspaceCreationRun["snapshot"] | undefined, discovery: WorkspaceCreationDiscoveryProjection) {
  const partial = snapshot?.context.status === "partial"
    || snapshot?.extraction.status === "partial"
    || snapshot?.intelligence.packState === "partial"
    || snapshot?.architect.partialContext === true;
  const hasProjectMaterial = discovery.aggregate.documents > 0
    || discovery.aggregate.facts > 0
    || discovery.aggregate.resources > 0
    || (snapshot?.context.sourceProgress.length ?? 0) > 0;
  if (partial) return { status: "partial" as const, reason: "Some project context could not be fully staged within the analysis budget." };
  if (!hasProjectMaterial) return { status: "none" as const, reason: null };
  return { status: "full" as const, reason: null };
}

export function friendlyCreationPhase(stage: WorkspaceCreationStage | null | undefined, partialContext = false) {
  if (partialContext && (stage === "architect-reasoning" || stage === "architect-validation" || stage === "review-preparation")) return "Designing workspace from partial context";
  switch (stage) {
    case "context-staging":
    case "source-ingestion": return "Reading project";
    case "structured-extraction":
    case "intelligence-synthesis": return "Understanding project";
    case "architect-runtime-preparation":
    case "architect-reasoning":
    case "architect-validation": return "Designing workspace";
    case "workspace-composition": return "Preparing workspace";
    case "review-preparation": return "Almost ready";
    default: return "Understanding your project";
  }
}

export function friendlyProvisioningPhase(state: string | null | undefined) {
  switch (state) {
    case "applying-composition": return "Preparing workspace";
    case "promoting-knowledge":
    case "binding-knowledge": return "Adding project knowledge";
    case "provisioning-agents": return "Creating AI workforce";
    case "verifying": return "Finishing setup";
    case "ready":
    case "partial": return "Ready";
    default: return "Creating workspace";
  }
}

function buildActivities(snapshot: WorkspaceCreationRun["snapshot"] | undefined, provisioningRun: ProvisioningLike | null, stage: WorkspaceCreationExperienceStage) {
  if (stage === "provisioning" || stage === "complete") {
    const state = provisioningRun?.state;
    const current = state && !["pending", "ready", "partial", "failed", "cancelled"].includes(state) ? friendlyProvisioningPhase(state) : null;
    return [
      { id: "workspace", label: "Creating workspace", status: state === "materializing" ? "active" : state ? "complete" : "pending" },
      { id: "workforce", label: "Creating AI workforce", status: state === "provisioning-agents" ? "active" : state && ["binding-knowledge", "applying-capabilities", "recording-declarations", "verifying", "ready", "partial"].includes(state) ? "complete" : "pending" },
      { id: "knowledge", label: "Adding project knowledge", status: state === "promoting-knowledge" || state === "binding-knowledge" ? "active" : state && ["applying-capabilities", "recording-declarations", "verifying", "ready", "partial"].includes(state) ? "complete" : "pending" },
      { id: "finish", label: current ?? "Finishing setup", status: state === "verifying" ? "active" : state === "ready" || state === "partial" ? "complete" : "pending" }
    ] as WorkspaceCreationExperienceModel["activities"];
  }
  const current = snapshot?.stage;
  const stages: Array<[string, string]> = [
    ["reading", "Reading project"],
    ["understanding", "Understanding project"],
    ["designing", "Designing workspace"],
    ["preparing", "Preparing workspace"]
  ];
  const activeIndex = current === "context-staging" || current === "source-ingestion" ? 0
    : current === "structured-extraction" || current === "intelligence-synthesis" ? 1
      : current === "architect-runtime-preparation" || current === "architect-reasoning" || current === "architect-validation" ? 2
        : current === "workspace-composition" || current === "review-preparation" ? 3
          : -1;
  return stages.map(([id, label], index) => ({ id, label, status: current === "review-preparation" || index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending" })) as WorkspaceCreationExperienceModel["activities"];
}

function isWorkspaceKnowledgeSource(value: unknown): value is WorkspaceKnowledgeSource {
  return Boolean(value && typeof value === "object" && "id" in value && "label" in value && "kind" in value
    && typeof value.id === "string" && typeof value.label === "string" && typeof value.kind === "string");
}
