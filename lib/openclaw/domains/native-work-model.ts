import type {
  ManagedWorktreeProjection,
  NativeWorkCapabilityState,
  NativeWorkExecutionProjection,
  NativeWorkSnapshot,
  OpenClawAgent,
  SessionOwnershipProjection,
  SessionMembershipDetailState,
  SuggestedWorkProjection,
  RuntimeStatus
} from "@/lib/openclaw/types";
import type { OpenClawCapabilityMatrix } from "@/lib/openclaw/types";

export type NativeWorkExecutionMode = "standard" | "isolated-worktree";

const ACCEPT_MODES = ["worktree", "local", "cloud", "session"] as const;

export function createEmptyNativeWorkSnapshot(reason = "OpenClaw native work data is unavailable."): NativeWorkSnapshot {
  return {
    availability: {
      worktrees: "unknown",
      suggestions: "unknown",
      ownership: "unknown",
      assignment: "unknown"
    },
    worktrees: [],
    suggestions: [],
    executions: [],
    issues: [reason]
  };
}

export function capabilityState(
  matrix: OpenClawCapabilityMatrix | null | undefined,
  operationId: string
): NativeWorkCapabilityState {
  const operation = matrix?.operations?.[operationId];
  if (!operation) return "unknown";
  if (operation.mode === "gateway-native") return "supported";
  if (operation.mode === "disabled" || operation.mode === "cli-fallback") return "unsupported";
  return operation.mode;
}

export function normalizeManagedWorktree(value: unknown): ManagedWorktreeProjection | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  const repoRoot = readString(value.repoRoot);
  const path = readString(value.path);
  const branch = readString(value.branch);
  const baseRef = readString(value.baseRef);
  const ownerKind = value.ownerKind;
  const createdAt = readNumber(value.createdAt);
  const lastActiveAt = readNumber(value.lastActiveAt);
  if (!id || !name || !repoRoot || !path || !branch || !baseRef ||
      (ownerKind !== "manual" && ownerKind !== "workboard" && ownerKind !== "session") ||
      createdAt === null || lastActiveAt === null) {
    return null;
  }

  const cleanup = isRecord(value.runEndCleanup) ? value.runEndCleanup : null;
  return {
    id,
    name,
    repoRoot,
    path,
    branch,
    baseRef,
    ownerKind,
    ownerId: readString(value.ownerId),
    createdAt,
    lastActiveAt,
    lifecycle: readNumber(value.removedAt) !== null ? "removed" : cleanup?.outcome === "failed" ? "cleanup-failed" : "active",
    cleanupOutcome: readString(cleanup?.outcome),
    sourceOfTruth: "openclaw"
  };
}

export function normalizeSuggestedWork(value: unknown, availableAcceptModes = ["worktree"] as Array<typeof ACCEPT_MODES[number]>): SuggestedWorkProjection | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const title = readString(value.title);
  const prompt = readString(value.prompt);
  const summary = readString(value.tldr);
  const cwd = readString(value.cwd);
  const sourceSessionKey = readString(value.sessionKey);
  const createdAt = readNumber(value.createdAt);
  if (!id || !title || !prompt || !summary || !cwd || !sourceSessionKey || createdAt === null) return null;
  return {
    id,
    title,
    summary,
    prompt,
    cwd,
    sourceSessionKey,
    sourceAgentId: readString(value.agentId),
    createdAt,
    availableAcceptModes: ACCEPT_MODES.filter((mode) => availableAcceptModes.includes(mode)),
    status: "suggested",
    sourceOfTruth: "openclaw"
  };
}

export function normalizeSessionOwnership(
  value: unknown,
  members?: unknown,
  evidence?: unknown,
  membershipDetailState: SessionMembershipDetailState = members === undefined && evidence === undefined ? "not-loaded" : "available"
): SessionOwnershipProjection {
  const row = isRecord(value) ? value : {};
  const sharing = isRecord(members) ? members : null;
  const rowOwner = isRecord(row.owner) ? row.owner : null;
  const owner = rowOwner ?? (isRecord(sharing?.owner) ? sharing.owner : null);
  const ownerActor = rowOwner && isRecord(rowOwner.actor)
    ? rowOwner.actor
    : isRecord(sharing?.owner)
      ? sharing.owner
      : null;
  const createdActor = isRecord(row.createdActor) ? row.createdActor : null;
  const participantRows = Array.isArray(row.participants)
    ? row.participants
    : sharing && Array.isArray(sharing.identities)
      ? sharing.identities.map((identity) => ({ identity }))
      : [];
  const memberRows = sharing && Array.isArray(sharing.members) ? sharing.members : [];
  const participantCount = readNumber(row.participantCount) ?? Math.max(participantRows.length, memberRows.length);
  const evidenceRows = isRecord(evidence) && Array.isArray(evidence.members) ? evidence.members : memberRows;
  const allowedVisibilities = sharing && Array.isArray(sharing.allowedVisibilities)
    ? sharing.allowedVisibilities.filter(isVisibility)
    : [];

  return {
    createdActor: createdActor ? {
      type: readActorType(createdActor.type),
      id: readString(createdActor.id),
      label: readString(createdActor.label)
    } : null,
    owner: ownerActor ? {
      type: readActorType(ownerActor.type),
      id: readString(ownerActor.id),
      label: readString(ownerActor.label),
      assignedAt: readNumber(owner?.assignedAt)
    } : null,
    participants: participantRows
      .map((entry) => {
        const participant = isRecord(entry) ? entry : {};
        const identity = isRecord(participant.identity) ? participant.identity : participant;
        const identityId = readString(identity.id) ?? readString(identity.identityId);
        if (!identityId) return null;
        return { identityId, label: readString(participant.label) ?? readString(identity.label) };
      })
      .filter((entry): entry is { identityId: string; label: string | null } => Boolean(entry))
      .slice(0, 4),
    participantCount,
    visibility: readVisibility(row.visibility),
    allowedVisibilities,
    sharingRole: readSharingRole(row.sharingRole) ?? readSharingRole(sharing?.role),
    memberEvidence: evidenceRows
      .map((entry) => {
        const member = isRecord(entry) ? entry : {};
        const identityId = readString(member.identityId);
        const addedAt = readNumber(member.addedAt);
        if (!identityId || addedAt === null) return null;
        return {
          identityId,
          addedBy: readString(member.addedBy),
          addedByState: readString(member.addedBy) ? "known" as const : "unknown" as const,
          addedAt
        };
      })
      .filter((entry): entry is SessionOwnershipProjection["memberEvidence"][number] => Boolean(entry)),
    membershipDetailState,
    sourceOfTruth: "openclaw"
  };
}

function isVisibility(value: unknown): value is NonNullable<SessionOwnershipProjection["visibility"]> {
  return value === "shared" || value === "read-only" || value === "suggest" || value === "draft";
}

export function normalizeNativeWorkExecution(
  value: unknown,
  agent: OpenClawAgent | null,
  worktree: ManagedWorktreeProjection | null,
  members?: unknown,
  evidence?: unknown,
  taskIds: string[] = [],
  membershipDetailState?: SessionMembershipDetailState
): NativeWorkExecutionProjection | null {
  if (!isRecord(value)) return null;
  const sessionKey = readString(value.key) ?? readString(value.sessionKey);
  if (!sessionKey) return null;
  const status = normalizeRuntimeStatus(value.status);
  const rowWorktree = isRecord(value.worktree) ? value.worktree : null;
  const linkedWorktree = worktree ?? (rowWorktree ? {
    id: readString(rowWorktree.id) ?? "",
    name: readString(rowWorktree.id) ?? "worktree",
    repoRoot: readString(rowWorktree.repoRoot) ?? "",
    path: readString(rowWorktree.path) ?? "",
    branch: readString(rowWorktree.branch) ?? "",
    baseRef: "",
    ownerKind: "session" as const,
    ownerId: null,
    createdAt: 0,
    lastActiveAt: 0,
    lifecycle: "active" as const,
    cleanupOutcome: null,
    sourceOfTruth: "openclaw" as const
  } : null);
  if (linkedWorktree && (!linkedWorktree.id || !linkedWorktree.repoRoot || !linkedWorktree.branch)) return null;
  return {
    sessionKey,
    sessionId: readString(value.sessionId) ?? readString(value.id),
    agentId: readString(value.agentId) ?? agent?.id ?? null,
    status,
    updatedAt: readNumber(value.updatedAt),
    execCwd: readString(value.execCwd) ?? readString(value.spawnedCwd) ?? readString(value.cwd),
    worktree: linkedWorktree ? {
      id: linkedWorktree.id,
      branch: linkedWorktree.branch,
      repoRoot: linkedWorktree.repoRoot,
      path: linkedWorktree.path || null
    } : null,
    ownership: normalizeSessionOwnership(value, members, evidence, membershipDetailState),
    taskIds,
    sourceOfTruth: "openclaw"
  };
}

export function resolveIsolatedWorktreeEligibility(input: {
  requestedMode: NativeWorkExecutionMode;
  workspacePath: string | null;
  worktreesCapability: NativeWorkCapabilityState;
  repositoryStatus: "git" | "not_git" | "unavailable" | null;
}) {
  if (input.requestedMode === "standard") return { eligible: true as const, reason: null };
  if (input.worktreesCapability !== "supported") {
    return { eligible: false as const, reason: "OpenClaw does not advertise managed worktree support for this Gateway." };
  }
  if (!input.workspacePath) {
    return { eligible: false as const, reason: "Isolated work requires a workspace repository path." };
  }
  if (input.repositoryStatus !== "git") {
    return { eligible: false as const, reason: input.repositoryStatus === "not_git"
      ? "Isolated work requires a Git repository at the selected workspace."
      : "OpenClaw could not verify the selected workspace repository." };
  }
  return { eligible: true as const, reason: null };
}

export function getSuggestedWorkAcceptModes(matrix: OpenClawCapabilityMatrix | null | undefined): Array<typeof ACCEPT_MODES[number]> {
  const operation = matrix?.operations?.taskSuggestions;
  if (operation?.mode !== "gateway-native") return [];
  return matrix?.supportedCapabilities?.includes("taskSuggestions.acceptModes")
    ? ["worktree", "local", "session"]
    : ["worktree"] as Array<typeof ACCEPT_MODES[number]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readActorType(value: unknown): "human" | "agent" | "system" {
  return value === "human" || value === "agent" ? value : "system";
}

function readVisibility(value: unknown): SessionOwnershipProjection["visibility"] {
  return value === "shared" || value === "read-only" || value === "suggest" || value === "draft" ? value : null;
}

function readSharingRole(value: unknown): SessionOwnershipProjection["sharingRole"] {
  return value === "admin" || value === "owner" || value === "member" || value === "viewer" ? value : null;
}

function normalizeRuntimeStatus(value: unknown): RuntimeStatus {
  return value === "running" || value === "queued" || value === "completed" || value === "stalled" || value === "cancelled" ? value : "idle";
}
