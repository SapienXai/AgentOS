import type {
  WorkspaceArchitectResult,
  WorkspaceBlueprint,
  WorkspaceBlueprintChannel
} from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspaceCreationArtifactReviewSummary, WorkspaceCreationCompositionSnapshot, WorkspaceCreationExtractionSnapshot, WorkspaceCreationIntelligenceReviewSnapshot, WorkspaceCreationIntelligenceSnapshot } from "@/lib/agentos/domains/workspace-creation-run";
import type { WorkspaceCreationReviewReadiness } from "@/lib/agentos/domains/workspace-creation-review";

type ProjectReviewModel = {
  name: string | null;
  description: string | null;
  projectType: string | null;
  summary: string | null;
  highlights: Array<{
    id: string;
    label: string;
    statement: string;
    verification: WorkspaceCreationIntelligenceReviewSnapshot["facts"][number]["verification"];
    conflicted: boolean;
  }>;
  keyFacts: WorkspaceCreationIntelligenceReviewSnapshot["facts"];
  officialResources: WorkspaceCreationIntelligenceReviewSnapshot["resources"];
  understanding: string[];
  conflicts: WorkspaceCreationIntelligenceReviewSnapshot["conflicts"];
  groupedConflicts: Array<{
    label: string;
    summary: string;
    count: number;
    status: WorkspaceCreationIntelligenceReviewSnapshot["conflicts"][number]["status"];
  }>;
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
  readiness: WorkspaceCreationReviewReadiness | null;
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
    agentCount: number;
    workflowCount: number;
    automationCount: number;
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
    reasoningMode: WorkspaceArchitectResult["reasoning"]["mode"];
    packState: WorkspaceCreationIntelligenceSnapshot["packState"];
  };
};

export type WorkspaceReviewRecoveryAction =
  | "retry-design"
  | "accept-draft"
  | "rebuild-plan"
  | "refresh-context"
  | "retry-provisioning"
  | "open-model-setup"
  | null;

export type WorkspaceReviewRecovery = {
  tone: "danger" | "warning" | "success" | "muted";
  badge: string;
  title: string;
  description: string;
  action: WorkspaceReviewRecoveryAction;
  actionLabel: string | null;
  technicalDetail: string | null;
};

type WorkspaceReviewRecoveryInput = {
  readiness: WorkspaceCreationReviewReadiness | null;
  provisioningRun?: {
    state?: string | null;
    error?: { code?: string | null; message?: string | null } | null;
  } | null;
  provisioningError?: string | null;
  partialContext?: boolean;
  fallback?: boolean;
  retryAvailable?: boolean;
  freshnessStatus?: string | null;
};

/**
 * Keep review recovery honest and singular: one observed problem gets one
 * operator-facing explanation and one meaningful next action.
 */
export function presentWorkspaceReviewRecovery(input: WorkspaceReviewRecoveryInput): WorkspaceReviewRecovery {
  const provisioningMessage = input.provisioningError?.trim() || input.provisioningRun?.error?.message?.trim() || null;
  const provisioningCode = input.provisioningRun?.error?.code?.trim().toLowerCase() || "";
  const provisioningFailed = Boolean(provisioningMessage)
    || input.provisioningRun?.state === "failed"
    || input.provisioningRun?.state === "cancelled";

  if (provisioningFailed) {
    const detail = provisioningMessage;
    const modelBlocked = /model setup|model .*not ready|provider|default model|usable model|choose a model/i.test(detail ?? "")
      || /model|provider/.test(provisioningCode);
    if (modelBlocked) {
      return {
        tone: "danger",
        badge: "Model setup required",
        title: "OpenClaw has not verified a ready model",
        description: "This workspace needs a model that OpenClaw reports as ready for its new agent. An existing chat may still work with a different agent or model assignment; connect the provider or choose a ready model, then return here.",
        action: "open-model-setup",
        actionLabel: "Open model setup",
        technicalDetail: detail
      };
    }

    const agentSyncBlocked = provisioningCode === "agent-provisioning"
      || /agent.*(?:not verified|not visible)|(?:not verified|not visible).*agent/i.test(detail ?? "");
    if (agentSyncBlocked) {
      return {
        tone: "warning",
        badge: "OpenClaw sync pending",
        title: "OpenClaw has not confirmed the workspace agent yet",
        description: "The workspace may already exist, but its new agent was not visible in the live OpenClaw registry when verification ran. Refresh live OpenClaw state and retry verification; the existing provisioning run will be reused.",
        action: "retry-provisioning",
        actionLabel: "Refresh OpenClaw and retry",
        technicalDetail: detail
      };
    }

    const contextBlocked = /knowledge|project context|blueprint.*stale|staged.*context/i.test(detail ?? "")
      || /knowledge|context|stale/.test(provisioningCode);
    if (contextBlocked) {
      return {
        tone: "warning",
        badge: "Project context changed",
        title: "This review no longer matches the project context",
        description: "Refresh the project context so AgentOS can rebuild this review against the current evidence. Existing OpenClaw state is not replaced by this action.",
        action: "refresh-context",
        actionLabel: "Refresh project context",
        technicalDetail: detail
      };
    }

    const gatewayBlocked = /gateway|rpc|openclaw.*(?:unreachable|not running|not ready)/i.test(detail ?? "")
      || /gateway|rpc/.test(provisioningCode);
    return {
      tone: "danger",
      badge: gatewayBlocked ? "OpenClaw unavailable" : "Creation stopped",
      title: gatewayBlocked ? "OpenClaw Gateway is not ready" : "Workspace creation did not finish",
      description: gatewayBlocked
        ? "AgentOS cannot verify or continue this workspace while the OpenClaw Gateway is unavailable. Refresh the live state and retry after the Gateway is ready."
        : "AgentOS stopped before it could verify a complete workspace. The action below reuses the existing provisioning run instead of creating a second workspace.",
      action: "retry-provisioning",
      actionLabel: gatewayBlocked ? "Refresh Gateway and retry" : "Refresh OpenClaw and retry",
      technicalDetail: detail
    };
  }

  if (input.readiness && !input.readiness.provisionable) {
    switch (input.readiness.requiredAction) {
      case "retry-design":
        return {
          tone: "danger",
          badge: "Design incomplete",
          title: "The workspace design is not complete",
          description: input.readiness.message,
          action: "retry-design",
          actionLabel: "Retry design",
          technicalDetail: null
        };
      case "accept-draft":
        return {
          tone: "warning",
          badge: "Decision required",
          title: "A safe basic draft needs your approval",
          description: input.readiness.message,
          action: "accept-draft",
          actionLabel: "Use basic draft",
          technicalDetail: null
        };
      case "rebuild-plan":
        return {
          tone: "warning",
          badge: "Plan out of date",
          title: "The workspace plan no longer matches this review",
          description: input.readiness.message,
          action: "rebuild-plan",
          actionLabel: "Rebuild workspace plan",
          technicalDetail: null
        };
      case "refresh-context":
        return {
          tone: "warning",
          badge: "Context needs refresh",
          title: "The project context must be refreshed",
          description: input.readiness.message,
          action: "refresh-context",
          actionLabel: "Refresh project context",
          technicalDetail: null
        };
      default:
        return {
          tone: "danger",
          badge: "Review blocked",
          title: "This workspace review needs attention",
          description: input.readiness.message,
          action: null,
          actionLabel: null,
          technicalDetail: null
        };
    }
  }

  if (input.fallback) {
    return {
      tone: "warning",
      badge: "Safe draft",
      title: "AI design was unavailable, so a safe draft is shown",
      description: "The basic workspace can still be created, or you can retry the design before continuing.",
      action: input.retryAvailable === false ? null : "retry-design",
      actionLabel: input.retryAvailable === false ? null : "Retry design",
      technicalDetail: null
    };
  }

  if (input.partialContext || input.freshnessStatus === "stale" || input.freshnessStatus === "unknown") {
    return {
      tone: "warning",
      badge: "Limited context",
      title: "This review uses limited or unverified project context",
      description: "The current draft is visible, but refreshing project context can improve the plan before creation.",
      action: "refresh-context",
      actionLabel: "Refresh project context",
      technicalDetail: null
    };
  }

  return {
    tone: "success",
    badge: "Ready to create",
    title: "Workspace draft is ready",
    description: "Review the compact summary below, then create the workspace when you are ready.",
    action: null,
    actionLabel: null,
    technicalDetail: null
  };
}

export function presentWorkspaceBlueprint(result: WorkspaceArchitectResult, options: {
  profile?: import("@/lib/agentos/domains/workspace-creation-policy").WorkspaceCreationProfile;
  partialContext?: boolean;
  attempts?: number;
  elapsedMs?: number;
  retryAvailable?: boolean;
  failureCategory?: string | null;
  extraction?: WorkspaceCreationExtractionSnapshot | null;
  intelligence?: WorkspaceCreationIntelligenceSnapshot | null;
  composition?: WorkspaceCreationCompositionSnapshot | null;
  readiness?: WorkspaceCreationReviewReadiness | null;
} = {}): WorkspaceBlueprintReviewModel {
  const fallback = result.reasoning.status === "fallback" || result.blueprint.status === "draft";
  const intentionalQuickFallback = ["fast", "medium", "quick"].includes(options.profile ?? "");
  const partialContext = options.partialContext === true || result.blueprint.warnings.some((warning) => /partial project context/i.test(warning));
  const projectIntelligence = options.intelligence?.review ?? null;
  const facts = rankProjectFacts(projectIntelligence?.facts ?? []);
  const resources = dedupeProjectResources(projectIntelligence?.resources ?? []);
  const conflicts = projectIntelligence?.conflicts ?? [];
  const project: ProjectReviewModel = {
    name: projectIntelligence?.projectName ?? result.blueprint.identity.name,
    description: projectIntelligence?.description ?? null,
    projectType: projectIntelligence?.projectType ?? result.blueprint.identity.projectType,
    summary: projectIntelligence?.description ?? result.blueprint.identity.purpose,
    highlights: facts.slice(0, 8).map((fact) => ({ id: fact.id, label: humanProjectFactLabel(fact.key), statement: fact.statement, verification: fact.verification, conflicted: fact.conflicted })),
    keyFacts: facts,
    officialResources: resources,
    understanding: projectIntelligence?.understanding ?? [projectIntelligence?.description, ...(projectIntelligence?.unknowns ?? []).map((unknown) => `Unknown: ${unknown}`)].filter((value): value is string => Boolean(value)).slice(0, 8),
    conflicts,
    groupedConflicts: groupProjectConflicts(conflicts)
  };
  const sourceSummary = {
    sourceCount: projectIntelligence?.sourceCount ?? 0,
    evidenceCount: projectIntelligence?.evidenceCount ?? 0,
    factCount: facts.length,
    resourceCount: resources.length,
    conflictCount: conflicts.length
  };
  const coverage: ReviewCoverageModel = sourceSummary.sourceCount === 0 && sourceSummary.evidenceCount === 0 && sourceSummary.factCount === 0 && sourceSummary.resourceCount === 0
    ? { status: "none", reason: null }
    : options.extraction?.status === "partial" || options.intelligence?.partialContext === true
      ? { status: "partial", reason: "Some project context could not be fully staged within the analysis budget." }
      : { status: "full", reason: null };
  const attention = [...new Set([
    ...(fallback && !intentionalQuickFallback ? ["AI architecture was unavailable; a basic draft is available."] : []),
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
    readiness: options.readiness ?? null,
    freshness: result.freshness,
    projectIntelligence,
    workspaceFiles: options.composition?.artifacts ?? [],
    project,
    workforce: { primaryAgent: result.blueprint.workforce.primaryAgent, specialists: result.blueprint.workforce.specialists, agentCount: 1 + result.blueprint.workforce.specialists.length, workflowCount: result.blueprint.operations.workflows.length, automationCount: result.blueprint.operations.automations.length },
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
      freshness: result.freshness.status,
      reasoningMode: result.reasoning.mode,
      packState: options.intelligence?.packState ?? null
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

function rankProjectFacts(facts: WorkspaceCreationIntelligenceReviewSnapshot["facts"]) {
  const priority = (key: string) => {
    const normalized = key.toLowerCase();
    if (/^(projectname|name|identity)/.test(normalized)) return 0;
    if (/(description|overview|purpose|whatitdoes)/.test(normalized)) return 1;
    if (/(audience|goal|business|mission)/.test(normalized)) return 2;
    if (/(repository|documentation|website|url|contract|application|package|network)/.test(normalized)) return 3;
    return 4;
  };
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) => priority(left.fact.key) - priority(right.fact.key) || left.index - right.index)
    .map(({ fact }) => fact);
}

function dedupeProjectResources(resources: WorkspaceCreationIntelligenceReviewSnapshot["resources"]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = resource.locator.trim().toLowerCase().replace(/\/+$/, "") || `${resource.category}:${resource.label.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupProjectConflicts(conflicts: WorkspaceCreationIntelligenceReviewSnapshot["conflicts"]) {
  const groups = new Map<string, { label: string; summary: string; count: number; status: WorkspaceCreationIntelligenceReviewSnapshot["conflicts"][number]["status"] }>();
  for (const conflict of conflicts) {
    const key = conflict.summary.toLowerCase().replace(/\b(the|a|an|two|multiple|conflicting|conflict|were|was|found|remain|published|publishes)\b/g, "").replace(/\s+/g, " ").trim();
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.status !== "open" && conflict.status === "open") existing.status = "open";
    } else {
      groups.set(key, {
        label: "Project conflict",
        summary: conflict.summary,
        count: 1,
        status: conflict.status
      });
    }
  }
  return [...groups.values()];
}

export function humanProjectFactLabel(key: string) {
  const labels: Record<string, string> = {
    projectName: "Project name",
    description: "Project description",
    projectType: "Project type",
    whatItDoes: "What it does",
    businessContext: "Business context",
    targetAudience: "Target audience",
    audience: "Target audience",
    goal: "Project goal",
    contractAddress: "Public contract address",
    repository: "Repository",
    documentation: "Documentation"
  };
  if (labels[key]) return labels[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
