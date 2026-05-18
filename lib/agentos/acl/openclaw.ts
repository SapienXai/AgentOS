import type {
  ChannelAccountRecord,
  ChannelRegistry,
  ControlPlaneSnapshot,
  RuntimeEventFrame,
  RuntimeEventKind,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary
} from "@/lib/agentos/contracts";

type OpenClawGatewayEventFrameInput = {
  type?: string;
  event?: string;
  payload?: unknown;
};

export function normalizeControlPlaneSnapshot(snapshot: ControlPlaneSnapshot): ControlPlaneSnapshot {
  const cloned = structuredClone(snapshot);

  return {
    ...cloned,
    missionPresets: uniqueStrings(cloned.missionPresets),
    channelAccounts: normalizeChannelAccounts(cloned.channelAccounts),
    channelRegistry: normalizeChannelRegistry(cloned.channelRegistry)
  };
}

export function normalizeOpenClawGatewayEventFrame(frame: OpenClawGatewayEventFrameInput): RuntimeEventFrame {
  const payload = isRecord(frame.payload) ? frame.payload : {};
  const event = normalizeString(frame.event) || normalizeString(payload.type) || "event";

  return {
    kind: resolveRuntimeEventKind(event, payload),
    source: "gateway",
    event,
    payload: frame.payload,
    receivedAt: normalizeEventTimestamp(payload.timestamp ?? payload.ts ?? payload.updatedAt),
    agentId: normalizeOptionalString(payload.agentId) ?? normalizeOptionalString(payload.agent) ?? undefined,
    sessionId:
      normalizeOptionalString(payload.sessionId) ??
      normalizeOptionalString(payload.session) ??
      normalizeOptionalString(payload.sessionKey) ??
      normalizeOptionalString(payload.key) ??
      undefined,
    taskId: normalizeOptionalString(payload.taskId) ?? undefined,
    runId:
      normalizeOptionalString(payload.runId) ??
      normalizeOptionalString(payload.run) ??
      normalizeOptionalString(payload.clientRunId) ??
      undefined
  };
}

function resolveRuntimeEventKind(event: string, payload: Record<string, unknown>): RuntimeEventKind {
  const explicit = normalizeOptionalString(payload.kind);
  const value = `${event} ${explicit ?? ""}`.toLowerCase();

  if (value.includes("approval")) {
    return "approval";
  }

  if (value.includes("artifact")) {
    return "artifact";
  }

  if (value.includes("task")) {
    return "task";
  }

  if (value.includes("tool")) {
    return "tool";
  }

  if (value.includes("session") || value.includes("chat") || value.includes("agent")) {
    return "session";
  }

  if (value.includes("status") || value.includes("runtime")) {
    return "status";
  }

  return "unknown";
}

function normalizeChannelAccounts(accounts: ChannelAccountRecord[]) {
  const merged = new Map<string, ChannelAccountRecord>();

  for (const account of accounts) {
    const id = normalizeString(account.id);
    const type = normalizeString(account.type);

    if (!id || !type) {
      continue;
    }

    const next: ChannelAccountRecord = {
      ...account,
      id,
      type,
      name: normalizeString(account.name) || id,
      enabled: account.enabled !== false,
      metadata: account.metadata ? { ...account.metadata } : undefined,
      capabilities: uniqueStrings(account.capabilities ?? [])
    };
    const key = `${type}:${id}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, next);
      continue;
    }

    merged.set(key, {
      ...existing,
      name: existing.name || next.name,
      enabled: existing.enabled !== false,
      kind: existing.kind ?? next.kind,
      capabilities: uniqueStrings([...(existing.capabilities ?? []), ...(next.capabilities ?? [])]),
      metadata: {
        ...(next.metadata ?? {}),
        ...(existing.metadata ?? {})
      }
    });
  }

  return Array.from(merged.values());
}

function normalizeChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  const channels = registry.channels
    .map((channel) => normalizeChannel(channel))
    .filter((channel): channel is WorkspaceChannelSummary => Boolean(channel));

  const deduped = new Map<string, WorkspaceChannelSummary>();

  for (const channel of channels) {
    const existing = deduped.get(channel.id);

    if (!existing) {
      deduped.set(channel.id, channel);
      continue;
    }

    const workspaceMap = new Map<string, WorkspaceChannelSummary["workspaces"][number]>();

    for (const workspace of existing.workspaces) {
      workspaceMap.set(workspace.workspaceId, workspace);
    }

    for (const workspace of channel.workspaces) {
      const current = workspaceMap.get(workspace.workspaceId);

      if (!current) {
        workspaceMap.set(workspace.workspaceId, workspace);
        continue;
      }

      workspaceMap.set(workspace.workspaceId, {
        ...current,
        agentIds: uniqueStrings([...current.agentIds, ...workspace.agentIds]),
        groupAssignments: uniqueByChatId([...current.groupAssignments, ...workspace.groupAssignments])
      });
    }

    deduped.set(channel.id, {
      ...existing,
      name: existing.name || channel.name,
      primaryAgentId: existing.primaryAgentId || channel.primaryAgentId,
      workspaces: Array.from(workspaceMap.values())
    });
  }

  return {
    version: 1 as const,
    channels: Array.from(deduped.values())
  };
}

function normalizeChannel(channel: WorkspaceChannelSummary): WorkspaceChannelSummary | null {
  const id = normalizeString(channel.id);
  const type = normalizeString(channel.type);

  if (!id || !type) {
    return null;
  }

  return {
    ...channel,
    id,
    type,
    name: normalizeString(channel.name) || id,
    primaryAgentId: normalizeOptionalString(channel.primaryAgentId),
    workspaces: channel.workspaces
      .map((workspace) => ({
        ...workspace,
        workspaceId: normalizeString(workspace.workspaceId),
        workspacePath: normalizeString(workspace.workspacePath),
        agentIds: uniqueStrings(workspace.agentIds),
        groupAssignments: workspace.groupAssignments
          .map((assignment) => ({
            ...assignment,
            chatId: normalizeString(assignment.chatId),
            agentId: normalizeOptionalString(assignment.agentId),
            title: normalizeOptionalString(assignment.title),
            enabled: assignment.enabled !== false
          }))
          .filter((assignment) => Boolean(assignment.chatId))
      }))
      .filter((workspace) => Boolean(workspace.workspaceId) && Boolean(workspace.workspacePath))
  };
}

function uniqueByChatId(assignments: WorkspaceChannelGroupAssignment[]): WorkspaceChannelGroupAssignment[] {
  const seen = new Map<string, WorkspaceChannelGroupAssignment>();

  for (const assignment of assignments) {
    if (!assignment.chatId) {
      continue;
    }

    seen.set(assignment.chatId, assignment);
  }

  return Array.from(seen.values());
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeOptionalString(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEventTimestamp(value: unknown) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(timestamp).toISOString();
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
