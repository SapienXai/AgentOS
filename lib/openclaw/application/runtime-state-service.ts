import "server-only";

import { createHash } from "node:crypto";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawGatewayEventFrame,
  OpenClawRuntimeSnapshotPayload
} from "@/lib/openclaw/client/gateway-client";
import {
  createRuntimeId,
  mapSessionCatalogEntryToRuntime,
  type RuntimeAgentConfigInput,
  type RuntimeAgentInput
} from "@/lib/openclaw/domains/runtime-normalizer";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { RuntimeCreatedFile, RuntimeRecord } from "@/lib/openclaw/types";

export type RuntimeSnapshotMappingContext = {
  agentConfig: RuntimeAgentConfigInput;
  agentsList: RuntimeAgentInput;
  resolveWorkspaceId?: (workspacePath: string) => string;
};

export async function settleRuntimeSnapshotPayloadFromOpenClaw(
  timeoutMs = 10_000
): Promise<PromiseSettledResult<OpenClawRuntimeSnapshotPayload>> {
  try {
    const value = await getOpenClawAdapter().getRuntimeSnapshot(
      {
        includeSessions: true,
        includeTasks: true,
        includeArtifacts: true,
        limit: 500
      },
      { timeoutMs }
    );

    return {
      status: "fulfilled",
      value
    };
  } catch (reason) {
    return {
      status: "rejected",
      reason
    };
  }
}

export function mapOpenClawRuntimeSnapshotToRuntimes(
  payload: OpenClawRuntimeSnapshotPayload | null | undefined,
  context: RuntimeSnapshotMappingContext
) {
  if (!isRecord(payload)) {
    return [];
  }

  return [
    ...readRecordArray(payload.runtimes).flatMap((entry) => normalizeRuntimeEntry(entry, context)),
    ...readRecordArray(payload.sessions).flatMap((entry) => normalizeSessionRuntime(entry, context)),
    ...readRecordArray(payload.tasks).flatMap((entry) => normalizeTaskRuntime(entry, context)),
    ...readRecordArray(payload.artifacts).flatMap((entry) => normalizeArtifactRuntime(entry, context))
  ];
}

export function normalizeOpenClawGatewayEventToRuntime(frame: OpenClawGatewayEventFrame): RuntimeRecord | null {
  const payload = isRecord(frame.payload) ? frame.payload : {};
  const eventName = readString(frame.event) ?? readString(payload.type) ?? "event";
  const sessionKey = readString(payload.sessionKey) ?? readString(payload.key);
  const agentId = readString(payload.agentId) ?? readString(payload.agent) ?? parseAgentIdFromSessionKey(sessionKey);
  const sessionId = readString(payload.sessionId) ?? readString(payload.session) ?? sessionKey;
  const runId = readString(payload.runId) ?? readString(payload.run) ?? readString(payload.clientRunId);
  const taskId = readString(payload.taskId) ?? readString(readNestedRecord(payload, "task")?.id);
  const artifactId = readString(payload.artifactId) ?? readString(readNestedRecord(payload, "artifact")?.id);
  const timestamp = readTimestamp(payload.timestamp ?? payload.ts ?? payload.updatedAt);
  const status = normalizeStatus(readString(payload.status) ?? eventName);
  const text =
    readString(payload.text) ??
    readString(payload.message) ??
    readString(payload.summary) ??
    readString(payload.detail) ??
    eventName;
  const runtimeId =
    readString(payload.runtimeId) ??
    `runtime:gateway:${hashRuntimeIdentity(agentId, sessionId, runId, taskId, artifactId, eventName)}`;

  if (!agentId && !sessionId && !runId && !taskId && !artifactId) {
    return null;
  }

  const createdFiles = normalizeCreatedFiles([payload, readNestedRecord(payload, "artifact")]);

  return {
    id: runtimeId,
    source: "turn",
    key: runId || sessionId || taskId || artifactId || runtimeId,
    title: readString(payload.title) ?? (taskId ? "Gateway task event" : "Gateway runtime event"),
    subtitle: text,
    status,
    updatedAt: timestamp,
    ageMs: timestamp ? Math.max(0, Date.now() - timestamp) : null,
    agentId: agentId ?? undefined,
    workspaceId: readString(payload.workspaceId) ?? undefined,
    sessionId: sessionId ?? undefined,
    taskId: taskId ?? undefined,
    runId: runId ?? undefined,
    modelId: readString(payload.model) ?? readString(payload.modelId) ?? undefined,
    toolNames: normalizeToolNames(payload),
    metadata: {
      origin: "openclaw-gateway-event",
      event: eventName,
      channel: readString(payload.channel) ?? null,
      approvalId: readString(payload.approvalId) ?? null,
      artifactId: artifactId ?? null,
      mission: readString(payload.mission) ?? readString(payload.prompt) ?? null,
      createdFiles
    }
  };
}

function normalizeRuntimeEntry(entry: Record<string, unknown>, context: RuntimeSnapshotMappingContext) {
  const id = readString(entry.id) ?? readString(entry.runtimeId);
  const key = readString(entry.key) ?? readString(entry.sessionKey) ?? readString(entry.taskId) ?? id;
  const title = readString(entry.title);
  const subtitle = readString(entry.subtitle) ?? readString(entry.summary) ?? readString(entry.message);

  if (!id || !key || !title || !subtitle) {
    return [];
  }

  const timestamp = readTimestamp(entry.updatedAt ?? entry.timestamp ?? entry.ts);
  const agentId = readString(entry.agentId) ?? parseAgentIdFromSessionKey(key);
  const workspaceId =
    readString(entry.workspaceId) ??
    resolveWorkspaceIdFromAgent(agentId, context);

  return [{
    id,
    source: normalizeRuntimeSource(readString(entry.source)),
    key,
    title,
    subtitle,
    status: normalizeStatus(readString(entry.status) ?? ""),
    updatedAt: timestamp,
    ageMs: readNumber(entry.ageMs) ?? (timestamp ? Math.max(0, Date.now() - timestamp) : null),
    agentId: agentId ?? undefined,
    workspaceId: workspaceId ?? undefined,
    modelId: readString(entry.modelId) ?? readString(entry.model) ?? undefined,
    sessionId: readString(entry.sessionId) ?? undefined,
    taskId: readString(entry.taskId) ?? undefined,
    runId: readString(entry.runId) ?? undefined,
    toolNames: normalizeToolNames(entry),
    tokenUsage: normalizeTokenUsage(entry),
    metadata: {
      ...(isRecord(entry.metadata) ? entry.metadata : {}),
      origin: "openclaw-runtime-snapshot",
      gatewayObjectKind: "runtime"
    }
  } satisfies RuntimeRecord];
}

function normalizeSessionRuntime(entry: Record<string, unknown>, context: RuntimeSnapshotMappingContext) {
  const agentId = readString(entry.agentId) ?? parseAgentIdFromSessionKey(readString(entry.key) ?? readString(entry.sessionKey));
  const key =
    readString(entry.key) ??
    readString(entry.sessionKey) ??
    (agentId ? `agent:${agentId}:main` : readString(entry.sessionId));

  if (!key && !agentId) {
    return [];
  }

  const session = {
    agentId: agentId ?? undefined,
    key: key ?? undefined,
    sessionId: readString(entry.sessionId) ?? readString(entry.id) ?? undefined,
    updatedAt: readTimestamp(entry.updatedAt ?? entry.timestamp ?? entry.ts),
    ageMs: readNumber(entry.ageMs) ?? undefined,
    inputTokens: readNumber(entry.inputTokens),
    outputTokens: readNumber(entry.outputTokens),
    cacheRead: readNumber(entry.cacheRead),
    totalTokens: readNumber(entry.totalTokens),
    model: readString(entry.model) ?? readString(entry.modelId) ?? undefined,
    kind: readString(entry.kind) ?? "runtime",
    origin: "openclaw-runtime-snapshot",
    mission: readString(entry.mission) ?? readString(entry.prompt) ?? undefined,
    dispatchId: readString(entry.dispatchId) ?? undefined
  } satisfies SessionsPayload["sessions"][number];

  const runtime = mapSessionCatalogEntryToRuntime(
    session,
    context.agentConfig,
    context.agentsList,
    { resolveWorkspaceId: context.resolveWorkspaceId }
  );

  return [{
    ...runtime,
    id: readString(entry.runtimeId) ?? createRuntimeId(session),
    title: readString(entry.title) ?? runtime.title,
    subtitle: readString(entry.summary) ?? readString(entry.message) ?? runtime.subtitle,
    status: normalizeStatus(readString(entry.status) ?? runtime.status),
    toolNames: normalizeToolNames(entry) ?? runtime.toolNames,
    metadata: {
      ...runtime.metadata,
      origin: "openclaw-runtime-snapshot",
      gatewayObjectKind: "session",
      event: readString(entry.event) ?? null
    }
  } satisfies RuntimeRecord];
}

function normalizeTaskRuntime(entry: Record<string, unknown>, context: RuntimeSnapshotMappingContext) {
  const taskId = readString(entry.taskId) ?? readString(entry.id);
  const agentId = readString(entry.agentId) ?? readString(entry.assigneeAgentId);

  if (!taskId && !agentId) {
    return [];
  }

  const timestamp = readTimestamp(entry.updatedAt ?? entry.timestamp ?? entry.ts ?? entry.createdAt);
  const workspaceId =
    readString(entry.workspaceId) ??
    resolveWorkspaceIdFromPath(readString(entry.workspace), context) ??
    resolveWorkspaceIdFromAgent(agentId, context);
  const mission = readString(entry.mission) ?? readString(entry.prompt) ?? readString(entry.title);
  const createdFiles = normalizeCreatedFiles(readRecordArray(entry.artifacts));

  return [{
    id: readString(entry.runtimeId) ?? `runtime:gateway-task:${hashRuntimeIdentity(taskId, agentId)}`,
    source: "turn",
    key: taskId ?? `agent:${agentId}:task`,
    title: readString(entry.title) ?? "Gateway task",
    subtitle: readString(entry.summary) ?? readString(entry.message) ?? readString(entry.status) ?? "OpenClaw task update",
    status: normalizeStatus(readString(entry.status) ?? ""),
    updatedAt: timestamp,
    ageMs: readNumber(entry.ageMs) ?? (timestamp ? Math.max(0, Date.now() - timestamp) : null),
    agentId: agentId ?? undefined,
    workspaceId: workspaceId ?? undefined,
    modelId: readString(entry.model) ?? readString(entry.modelId) ?? undefined,
    sessionId: readString(entry.sessionId) ?? undefined,
    taskId: taskId ?? undefined,
    runId: readString(entry.runId) ?? undefined,
    toolNames: normalizeToolNames(entry),
    tokenUsage: normalizeTokenUsage(entry),
    metadata: {
      origin: "openclaw-runtime-snapshot",
      gatewayObjectKind: "task",
      taskId: taskId ?? null,
      mission,
      dispatchId: readString(entry.dispatchId) ?? null,
      createdFiles
    }
  } satisfies RuntimeRecord];
}

function normalizeArtifactRuntime(entry: Record<string, unknown>, context: RuntimeSnapshotMappingContext) {
  const artifactId = readString(entry.artifactId) ?? readString(entry.id);
  const taskId = readString(entry.taskId);
  const sessionId = readString(entry.sessionId);
  const agentId = readString(entry.agentId);

  if (!artifactId && !taskId && !sessionId) {
    return [];
  }

  const timestamp = readTimestamp(entry.updatedAt ?? entry.timestamp ?? entry.ts ?? entry.createdAt);
  const createdFiles = normalizeCreatedFiles([entry]);
  const displayName = readString(entry.path) ?? readString(entry.name) ?? artifactId ?? "artifact";

  return [{
    id: readString(entry.runtimeId) ?? `runtime:gateway-artifact:${hashRuntimeIdentity(artifactId, taskId, sessionId)}`,
    source: "turn",
    key: taskId ?? sessionId ?? artifactId ?? displayName,
    title: "Gateway artifact",
    subtitle: displayName,
    status: normalizeStatus(readString(entry.status) ?? "completed"),
    updatedAt: timestamp,
    ageMs: readNumber(entry.ageMs) ?? (timestamp ? Math.max(0, Date.now() - timestamp) : null),
    agentId: agentId ?? undefined,
    workspaceId:
      readString(entry.workspaceId) ??
      resolveWorkspaceIdFromPath(readString(entry.workspace), context) ??
      resolveWorkspaceIdFromAgent(agentId, context) ??
      undefined,
    sessionId: sessionId ?? undefined,
    taskId: taskId ?? undefined,
    runId: readString(entry.runId) ?? undefined,
    metadata: {
      origin: "openclaw-runtime-snapshot",
      gatewayObjectKind: "artifact",
      artifactId: artifactId ?? null,
      createdFiles
    }
  } satisfies RuntimeRecord];
}

function normalizeRuntimeSource(value: string | null): RuntimeRecord["source"] {
  return value === "session" || value === "cron" || value === "turn" ? value : "turn";
}

function normalizeStatus(value: string): RuntimeRecord["status"] {
  if (/complete|done|success|succeeded/i.test(value)) {
    return "completed";
  }

  if (/cancel|abort/i.test(value)) {
    return "cancelled";
  }

  if (/error|fail|stall/i.test(value)) {
    return "stalled";
  }

  if (/queue|pending/i.test(value)) {
    return "queued";
  }

  if (/idle/i.test(value)) {
    return "idle";
  }

  return "running";
}

function normalizeToolNames(payload: Record<string, unknown>) {
  const names = [
    readString(payload.toolName),
    readString(payload.tool),
    ...readStringArray(payload.tools),
    ...readStringArray(payload.toolNames)
  ].filter((entry): entry is string => Boolean(entry));
  return names.length > 0 ? Array.from(new Set(names)) : undefined;
}

function normalizeTokenUsage(payload: Record<string, unknown>): RuntimeRecord["tokenUsage"] {
  const direct = isRecord(payload.tokenUsage) ? payload.tokenUsage : payload;
  const input = readNumber(direct.inputTokens) ?? readNumber(direct.input);
  const output = readNumber(direct.outputTokens) ?? readNumber(direct.output);
  const total = readNumber(direct.totalTokens) ?? readNumber(direct.total);

  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    total: total ?? (input ?? 0) + (output ?? 0),
    cacheRead: readNumber(direct.cacheRead) ?? 0
  };
}

function normalizeCreatedFiles(values: Array<Record<string, unknown> | null | undefined>) {
  const createdFiles: RuntimeCreatedFile[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const pathValue = readString(value.path) ?? readString(value.filePath) ?? readString(value.uri);
    const displayPathValue = readString(value.displayPath) ?? readString(value.name) ?? pathValue;

    if (!pathValue || !displayPathValue) {
      continue;
    }

    createdFiles.push({
      path: pathValue,
      displayPath: displayPathValue
    });
  }

  return dedupeCreatedFiles(createdFiles);
}

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
  }

  return deduped;
}

function resolveWorkspaceIdFromAgent(agentId: string | null, context: RuntimeSnapshotMappingContext) {
  if (!agentId) {
    return null;
  }

  const agent = context.agentsList.find((entry) => entry.id === agentId);
  const config = context.agentConfig.find((entry) => entry.id === agentId);
  return resolveWorkspaceIdFromPath(agent?.workspace || config?.workspace, context);
}

function resolveWorkspaceIdFromPath(workspacePath: string | null | undefined, context: RuntimeSnapshotMappingContext) {
  return workspacePath ? context.resolveWorkspaceId?.(workspacePath) : null;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];
}

function readNestedRecord(value: Record<string, unknown>, key: string) {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readString).filter((entry): entry is string => Boolean(entry))
    : [];
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseAgentIdFromSessionKey(sessionKey: string | null) {
  if (!sessionKey?.startsWith("agent:")) {
    return null;
  }

  const [, agentId] = sessionKey.split(":");
  return agentId || null;
}

function hashRuntimeIdentity(...values: Array<string | null | undefined>) {
  const identity = values.filter(Boolean).join(":") || String(Date.now());
  return createHash("sha1").update(identity).digest("hex").slice(0, 12);
}
