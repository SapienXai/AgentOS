import { createHash } from "node:crypto";

import { resolveRuntimeStatus } from "@/lib/openclaw/domains/control-plane-normalization";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import { workspaceIdFromPath } from "@/lib/openclaw/domains/workspace-id";
import type { RuntimeRecord } from "@/lib/openclaw/types";

export type RuntimeAgentConfigInput = Array<{
  id: string;
  workspace?: string;
  model?: string;
}>;

export type RuntimeAgentInput = Array<{
  id: string;
  workspace?: string;
  model?: string;
}>;

export function mapSessionCatalogEntryToRuntime(
  session: SessionsPayload["sessions"][number],
  agentConfig: RuntimeAgentConfigInput,
  agentsList: RuntimeAgentInput,
  options: {
    resolveWorkspaceId?: (workspacePath: string) => string;
  } = {}
): RuntimeRecord {
  const agentId = session.agentId ?? extractAgentIdFromSessionKey(session.key);
  const agent = agentsList.find((entry) => entry.id === agentId);
  const config = agentConfig.find((entry) => entry.id === agentId);
  const workspacePath = agent?.workspace || config?.workspace;
  const workspaceId = workspacePath
    ? (options.resolveWorkspaceId ?? workspaceIdFromPath)(workspacePath)
    : undefined;
  const taskId = extractRuntimeKeyToken(session.key, "task");
  const stage = extractRuntimeKeyToken(session.key, "stage");
  const modelId = resolveSessionModelId(session, config?.model || agent?.model);
  const parentKey = typeof session.parentSessionKey === "string" ? session.parentSessionKey.trim() : "";
  const spawnedBy = typeof session.spawnedBy === "string" ? session.spawnedBy.trim() : "";
  const requesterSessionKey = extractRuntimeKeyToken(session.key, "subagent") &&
    (!parentKey || !spawnedBy || parentKey === spawnedBy) && (parentKey || spawnedBy) !== session.key
    ? parentKey || spawnedBy
    : "";
  const delegatedStatus = requesterSessionKey ? resolveDelegatedSessionStatus(session) : null;
  const status = delegatedStatus ?? resolveRuntimeStatus(stage, session.key, session.ageMs);
  const runtimeId = createRuntimeId(session);
  const taskLabel = taskId ? taskId.slice(0, 8) : null;
  const isAgentChatSession = session.origin === "agent-chat";
  const delegatedTitle = requesterSessionKey && typeof session.label === "string" ? session.label.trim() : "";

  return {
    id: runtimeId,
    source: "session",
    key: session.key || "unknown-session",
    title: delegatedTitle || (isAgentChatSession
      ? "Agent chat session"
      : taskLabel
      ? `${prettifyAgentName(agentId)} · ${taskLabel}`
      : `${prettifyAgentName(agentId)} session`),
    subtitle: requesterSessionKey ? "Delegated work" : isAgentChatSession ? "direct chat" : taskLabel ? `task ${taskLabel} · ${stage || "running"}` : "main session",
    status,
    updatedAt: session.updatedAt ?? null,
    ageMs: session.ageMs ?? null,
    agentId,
    workspaceId,
    workspacePath,
    modelId,
    modelOverrideSource: session.modelOverrideSource,
    sessionId: session.sessionId,
    taskId,
    runId: requesterSessionKey && typeof session.lastRunId === "string" ? session.lastRunId : undefined,
    tokenUsage:
      typeof session.totalTokens === "number" || typeof session.inputTokens === "number"
        ? {
            input: session.inputTokens ?? 0,
            output: session.outputTokens ?? 0,
            total: session.totalTokens ?? (session.inputTokens ?? 0) + (session.outputTokens ?? 0),
            cacheRead: session.cacheRead ?? 0
          }
        : undefined,
    metadata: {
      kind: session.kind ?? "direct",
      chatType: session.kind ?? "direct",
      origin: session.origin ?? null,
      dispatchId: session.dispatchId ?? null,
      mission: session.mission ?? null,
      routedMission: session.routedMission ?? null,
      dispatchSubmittedAt: session.dispatchSubmittedAt ?? null,
      nativeSessionActive: typeof session.hasActiveRun === "boolean" ? session.hasActiveRun : null,
      nativeSessionKey: session.key ?? null,
      stage: stage ?? null,
      historical: false,
      ...(requesterSessionKey ? {
        requesterSessionKey,
        openClawSessionKey: session.key,
        nativeDelegatedSession: true,
        nativeDelegatedSessionStatus: delegatedStatus,
        startedAt: typeof session.startedAt === "number" && Number.isFinite(session.startedAt) ? session.startedAt : null
      } : {})
    }
  };
}

function resolveDelegatedSessionStatus(session: SessionsPayload["sessions"][number]): RuntimeRecord["status"] | null {
  if (session.subagentRunState === "paused") return "idle";
  if (session.subagentRunState === "interrupted") return "stalled";
  if (session.hasActiveSubagentRun === true || session.subagentRunState === "active") return "running";

  switch (session.status) {
    case "queued": return "queued";
    case "running": return "running";
    case "done": return "completed";
    case "failed":
    case "interrupted":
    case "timed_out": return "stalled";
    case "killed": return "cancelled";
    default: return null;
  }
}

function resolveSessionModelId(
  session: SessionsPayload["sessions"][number],
  inheritedModelId?: string
) {
  const model = session.model?.trim();
  const provider = session.modelProvider?.trim();

  if (model && provider) {
    return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
  }

  return model && model.includes("/") ? model : inheritedModelId || "unassigned";
}

export function createRuntimeId(session: SessionsPayload["sessions"][number]) {
  const taskId = extractRuntimeKeyToken(session.key, "task");
  const runtimeKey = taskId || session.key || session.sessionId || String(Math.random());
  const sessionToken =
    session.sessionId ||
    hashValue(session.agentId || extractAgentIdFromSessionKey(session.key) || "sessionless");
  return `runtime:${sessionToken}:${hashValue(runtimeKey)}`;
}

export function extractRuntimeKeyToken(key: string | undefined, prefix: string) {
  if (!key) {
    return undefined;
  }

  const marker = `:${prefix}:`;
  const index = key.indexOf(marker);

  if (index === -1) {
    return undefined;
  }

  const tail = key.slice(index + marker.length);
  return tail.split(":")[0];
}

function extractAgentIdFromSessionKey(key: string | undefined) {
  if (!key) {
    return undefined;
  }

  const match = /^agent:([^:]+)/.exec(key);
  return match?.[1];
}

function prettifyAgentName(agentId: string | undefined) {
  if (!agentId) {
    return "OpenClaw";
  }

  return agentId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function hashValue(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}
