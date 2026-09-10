import type {
  WorkspaceArchitectResult,
  WorkspaceBlueprint,
  WorkspaceBlueprintChannel
} from "@/lib/agentos/domains/workspace-blueprint";

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
  freshness: WorkspaceArchitectResult["freshness"];
};

export function presentWorkspaceBlueprint(result: WorkspaceArchitectResult, options: {
  partialContext?: boolean;
  attempts?: number;
  elapsedMs?: number;
  retryAvailable?: boolean;
  failureCategory?: string | null;
} = {}): WorkspaceBlueprintReviewModel {
  const fallback = result.reasoning.status === "fallback" || result.blueprint.status === "draft";
  const partialContext = options.partialContext === true;
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
    freshness: result.freshness
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
