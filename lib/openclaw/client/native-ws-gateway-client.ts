import "server-only";

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import {
  getOpenClawGatewayMethodCandidates,
  type OpenClawGatewayCompatibilityOperationId
} from "@/lib/openclaw/client/gateway-compatibility";
import type { CommandResult } from "@/lib/openclaw/cli";
import { isOpenClawInvalidConfigError } from "@/lib/openclaw/command-failure";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentModelStatusInput,
  OpenClawAbortTurnInput,
  OpenClawArtifactDeleteInput,
  OpenClawArtifactGetInput,
  OpenClawArtifactListInput,
  OpenClawArtifactListPayload,
  OpenClawArtifactPayload,
  OpenClawArtifactPutInput,
  OpenClawChannelStatusInput,
  OpenClawChannelStatusPayload,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawConfigSchemaPayload,
  OpenClawConfigSchemaLookupInput,
  OpenClawConfigSchemaLookupPayload,
  OpenClawCronListInput,
  OpenClawCronListPayload,
  OpenClawCronStatusPayload,
  OpenClawDescribeSessionInput,
  OpenClawExecApprovalListInput,
  OpenClawExecApprovalListPayload,
  OpenClawExecApprovalResolveInput,
  OpenClawExecApprovalResolvePayload,
  OpenClawGatewayClient,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventFrame,
  OpenClawGatewayEventSubscription,
  OpenClawGatewayRequestPolicy,
  OpenClawHealthPayload,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawLogsTailInput,
  OpenClawLogsTailPayload,
  OpenClawModelAuthOrderSetInput,
  OpenClawPluginListPayload,
  OpenClawRuntimeEventSubscriptionInput,
  OpenClawRuntimeSnapshotInput,
  OpenClawRuntimeSnapshotPayload,
  OpenClawSessionExportInput,
  OpenClawSessionExportPayload,
  OpenClawSessionHistoryInput,
  OpenClawSessionHistoryPayload,
  OpenClawSessionPayload,
  OpenClawSessionReferenceInput,
  OpenClawSessionsPayload,
  OpenClawSkillListPayload,
  OpenClawStreamCallbacks,
  OpenClawTaskAssignInput,
  OpenClawTaskCancelInput,
  OpenClawTaskGetInput,
  OpenClawTaskListInput,
  OpenClawTaskListPayload,
  OpenClawTaskPayload,
  OpenClawToolInvokeInput,
  OpenClawToolInvokePayload,
  OpenClawToolsCatalogInput,
  OpenClawToolsCatalogPayload,
  OpenClawToolsEffectiveInput,
  OpenClawToolsEffectivePayload,
  OpenClawUpdateAgentInput,
  StatusPayload,
} from "@/lib/openclaw/client/types";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";
const DEFAULT_NATIVE_TIMEOUT_MS = 4_000;
const DEFAULT_NATIVE_LIST_TIMEOUT_MS = 8_000;
const DEFAULT_NATIVE_STREAM_TIMEOUT_MS = 30_000;
const CONNECT_METHOD = "connect";
const MIN_CONTROL_PROTOCOL_VERSION = 3;
const MAX_CONTROL_PROTOCOL_VERSION = 4;
export const OPENCLAW_GATEWAY_PROTOCOL_RANGE = {
  min: MIN_CONTROL_PROTOCOL_VERSION,
  max: MAX_CONTROL_PROTOCOL_VERSION
} as const;
const SERVER_OPERATOR_CLIENT_ID = "gateway-client";
const SERVER_OPERATOR_CLIENT_MODE = "backend";
const OPENCLAW_DEVICE_AUTH_FILE_NAME = "device-auth.json";
const OPENCLAW_DEVICE_IDENTITY_FILE_NAME = "device.json";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing"
];
const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";

type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  onopen?: ((event: unknown) => void) | null;
  onmessage?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
};

export type WebSocketFactory = new (url: string) => WebSocketLike;

export type NativeWsOpenClawGatewayClientOptions = {
  url?: string | null;
  token?: string | null;
  password?: string | null;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  instanceId?: string;
  role?: string;
  scopes?: string[];
  fallback?: OpenClawGatewayClient;
  webSocketFactory?: WebSocketFactory;
  forceCli?: boolean;
  onNativeFailure?: (error: unknown, method: string) => void;
};

type GatewayResponseFrame = {
  type?: string;
  id?: string | number;
  ok?: boolean;
  payload?: unknown;
  error?: unknown;
  message?: string;
  code?: string;
};

type GatewayEventFrame = OpenClawGatewayEventFrame;

type NativeHandshakePayload = {
  type?: string;
  protocol?: number;
  server?: {
    version?: string;
    connId?: string;
  };
  features?: {
    methods?: string[];
    events?: string[];
  };
  snapshot?: unknown;
  auth?: {
    role?: string;
    scopes?: string[];
  };
  policy?: Record<string, unknown>;
};

type LocalDeviceAuth = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  token: string;
};

type ConnectParamsContext = {
  params: Record<string, unknown>;
  deviceAuth: LocalDeviceAuth | null;
};

class NativeGatewayError extends Error {
  readonly kind: OpenClawGatewayClientErrorKind;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      kind?: OpenClawGatewayClientErrorKind;
    } = {}
  ) {
    super(message);
    this.name = "NativeGatewayError";
    this.kind = options.kind ?? classifyGatewayError(message);
    this.cause = options.cause;
  }
}

class NativeGatewayRequestError extends NativeGatewayError {
  constructor(
    message: string,
    readonly method: string,
    readonly sent: boolean,
    options: {
      cause?: unknown;
      kind?: OpenClawGatewayClientErrorKind;
    } = {}
  ) {
    super(message, options);
    this.name = "NativeGatewayRequestError";
  }
}

type OpenClawGatewayClientErrorKind =
  | "auth"
  | "malformed-response"
  | "protocol-mismatch"
  | "scope-limited"
  | "timeout"
  | "unsupported"
  | "unreachable"
  | "unknown";

export class OpenClawGatewayClientError extends Error {
  constructor(
    message: string,
    readonly kind: OpenClawGatewayClientErrorKind,
    options: {
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "OpenClawGatewayClientError";
    this.cause = options.cause;
  }
}

export type OpenClawGatewayFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: OpenClawGatewayClientErrorKind;
  recovery: string;
};

const recentGatewayFallbackDiagnostics: OpenClawGatewayFallbackDiagnostic[] = [];
const maxGatewayFallbackDiagnostics = 20;

type StatusUpdateRegistry = NonNullable<NonNullable<StatusPayload["update"]>["registry"]>;

export function getRecentOpenClawGatewayFallbackDiagnostics() {
  return [...recentGatewayFallbackDiagnostics];
}

export function clearOpenClawGatewayFallbackDiagnosticsForTesting() {
  recentGatewayFallbackDiagnostics.length = 0;
  cachedStatusUpdateRegistry = null;
}

function recordGatewayFallbackDiagnostic(operation: string, error: unknown) {
  const normalized = normalizeClientError(error);
  clearGatewayFallbackDiagnostic(operation);
  recentGatewayFallbackDiagnostics.unshift({
    at: new Date().toISOString(),
    operation,
    issue: normalized.message,
    kind: normalized.kind,
    recovery: resolveGatewayRecoveryMessage(normalized)
  });

  recentGatewayFallbackDiagnostics.splice(maxGatewayFallbackDiagnostics);
}

function clearGatewayFallbackDiagnostic(operation: string) {
  for (let index = recentGatewayFallbackDiagnostics.length - 1; index >= 0; index -= 1) {
    if (recentGatewayFallbackDiagnostics[index]?.operation === operation) {
      recentGatewayFallbackDiagnostics.splice(index, 1);
    }
  }
}

function normalizeClientError(error: unknown) {
  if (error instanceof OpenClawGatewayClientError) {
    return error;
  }

  if (error instanceof NativeGatewayError) {
    return new OpenClawGatewayClientError(error.message, error.kind, { cause: error.cause ?? error });
  }

  const message = error instanceof Error ? error.message : String(error || "OpenClaw Gateway request failed.");
  return new OpenClawGatewayClientError(message, classifyGatewayError(message), { cause: error });
}

function classifyGatewayError(message: string): OpenClawGatewayClientErrorKind {
  if (/protocol|version|hello|handshake/i.test(message)) {
    return "protocol-mismatch";
  }

  if (/unknown method|method not found|unsupported method/i.test(message)) {
    return "unsupported";
  }

  if (/auth|token|password|unauthorized|forbidden/i.test(message)) {
    return "auth";
  }

  if (/scope|permission|not allowed/i.test(message)) {
    return "scope-limited";
  }

  if (/invalid json|malformed|schema|payload/i.test(message)) {
    return "malformed-response";
  }

  if (/timed out|timeout/i.test(message)) {
    return "timeout";
  }

  if (/connect|closed|unreachable|websocket/i.test(message)) {
    return "unreachable";
  }

  return "unknown";
}

function resolveGatewayRecoveryMessage(error: OpenClawGatewayClientError) {
  switch (error.kind) {
    case "auth":
      return "Check the OpenClaw Gateway token/password or repair local device access in Settings.";
    case "scope-limited":
      return "Approve AgentOS as an OpenClaw operator with the required read/write/admin scopes.";
    case "protocol-mismatch":
      return `Update OpenClaw or AgentOS so the Gateway protocol overlaps AgentOS' supported range ${MIN_CONTROL_PROTOCOL_VERSION}-${MAX_CONTROL_PROTOCOL_VERSION}.`;
    case "unsupported":
      return "OpenClaw does not advertise this Gateway method; AgentOS will use the compatibility fallback when available.";
    case "timeout":
      return "Check that the OpenClaw Gateway is responsive, then retry the action.";
    case "unreachable":
      return "Start or repair the OpenClaw Gateway, or keep using CLI fallback for recovery.";
    case "malformed-response":
      return "Update OpenClaw or report the incompatible Gateway response shape.";
    default:
      return "Inspect OpenClaw diagnostics for the underlying Gateway failure.";
  }
}

const statusPayloadSchema = z
  .object({
    runtimeVersion: z.string().optional(),
    version: z.string().optional(),
    updateChannel: z.string().optional()
  })
  .passthrough();

const agentListPayloadSchema = z
  .object({
    defaultId: z.string().optional(),
    mainKey: z.string().optional(),
    scope: z.string().optional(),
    agents: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          identity: z
            .object({
              name: z.string().optional(),
              theme: z.string().optional(),
              emoji: z.string().optional(),
              avatar: z.string().optional(),
              avatarUrl: z.string().optional()
            })
            .passthrough()
            .optional(),
          workspace: z.string().optional(),
          model: z
            .object({
              primary: z.string().optional(),
              fallbacks: z.array(z.string()).optional()
            })
            .passthrough()
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const sessionsPayloadSchema = z
  .object({
    sessions: z.array(z.object({}).passthrough())
  })
  .passthrough();

const channelStatusPayloadSchema = z
  .object({
    ts: z.number(),
    channelOrder: z.array(z.string()),
    channelLabels: z.record(z.string(), z.string()),
    channelDetailLabels: z.record(z.string(), z.string()).optional(),
    channelSystemImages: z.record(z.string(), z.string()).optional(),
    channelMeta: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          detailLabel: z.string(),
          systemImage: z.string().optional()
        })
        .passthrough()
    ).optional(),
    channels: z.record(z.string(), z.unknown()),
    channelAccounts: z.record(
      z.string(),
      z.array(
        z
          .object({
            accountId: z.string(),
            name: z.string().optional(),
            enabled: z.boolean().optional(),
            configured: z.boolean().optional(),
            linked: z.boolean().optional(),
            running: z.boolean().optional(),
            connected: z.boolean().optional(),
            lastError: z.string().optional(),
            healthState: z.string().optional()
          })
          .passthrough()
      )
    ),
    channelDefaultAccountId: z.record(z.string(), z.string())
  })
  .passthrough();

const modelsPayloadSchema = z
  .object({
    models: z.array(
      z
        .object({
          key: z.string().optional(),
          id: z.string().optional(),
          provider: z.string().optional(),
          name: z.string(),
          input: z.union([z.string(), z.array(z.string())]).optional().default("text"),
          contextWindow: z.number().nullable().optional().default(null),
          local: z.boolean().nullable().optional().default(null),
          available: z.boolean().nullable().optional().default(null),
          tags: z.array(z.string()).optional().default([]),
          missing: z.boolean().optional().default(false)
        })
        .passthrough()
    )
  })
  .passthrough();

const skillsPayloadSchema = z
  .object({
    skills: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          emoji: z.string().optional(),
          eligible: z.boolean().optional(),
          disabled: z.boolean().optional(),
          blockedByAllowlist: z.boolean().optional(),
          source: z.string().optional(),
          bundled: z.boolean().optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const pluginsPayloadSchema = z
  .object({
    plugins: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            status: z.string().optional(),
            toolNames: z.array(z.string()).optional()
          })
          .passthrough()
      )
      .optional(),
    descriptors: z.array(z.object({}).passthrough()).optional()
  })
  .passthrough();

const configSnapshotPayloadSchema = z
  .object({
    exists: z.boolean().optional(),
    valid: z.boolean().optional(),
    hash: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    resolved: z.unknown().optional()
  })
  .passthrough();

const genericObjectPayloadSchema = z.object({}).passthrough();

function parseGatewayPayload<TPayload>(operation: string, schema: z.ZodTypeAny, payload: unknown) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new OpenClawGatewayClientError(
      `${operation}: OpenClaw Gateway returned a malformed response.`,
      "malformed-response",
      { cause: parsed.error }
    );
  }

  return parsed.data as TPayload;
}

function parseObjectGatewayPayload<TPayload>(operation: string, payload: unknown) {
  return parseGatewayPayload<TPayload>(operation, genericObjectPayloadSchema, payload);
}

function hasNativeStatusUpdateRegistry(status: StatusPayload) {
  return Boolean(status.update?.registry?.latestVersion || status.update?.registry?.error);
}

function rememberStatusUpdateRegistry(registry: StatusUpdateRegistry | undefined) {
  if (!registry?.latestVersion && !registry?.error) {
    return;
  }

  cachedStatusUpdateRegistry = { ...registry };
}

function getCachedStatusUpdateRegistry(status: StatusPayload): StatusUpdateRegistry | undefined {
  const currentVersion = normalizeStatusVersion(status);
  const cachedLatestVersion = cachedStatusUpdateRegistry?.latestVersion?.trim();

  if (!cachedStatusUpdateRegistry) {
    return undefined;
  }

  if (currentVersion && cachedLatestVersion && compareVersionStrings(currentVersion, cachedLatestVersion) > 0) {
    cachedStatusUpdateRegistry = null;
    return undefined;
  }

  return cachedStatusUpdateRegistry ?? undefined;
}

function normalizeStatusVersion(status: StatusPayload) {
  return (status.runtimeVersion || status.overview?.version || status.version || "").trim().replace(/^v/i, "") || null;
}

function mergeStatusPayload(status: StatusPayload, fallbackStatus: StatusPayload | null): StatusPayload {
  const nativeUpdate = status.update ?? {};
  const fallbackUpdate = fallbackStatus?.update ?? {};
  const cachedRegistry = getCachedStatusUpdateRegistry(status);
  const registry = nativeUpdate.registry ?? fallbackUpdate.registry;
  const resolvedRegistry = registry ?? cachedRegistry ?? undefined;

  if (resolvedRegistry) {
    rememberStatusUpdateRegistry(resolvedRegistry);
  }

  if (!fallbackStatus && !resolvedRegistry) {
    return status;
  }

  const update: NonNullable<StatusPayload["update"]> = {
    ...fallbackUpdate,
    ...nativeUpdate
  };

  if (resolvedRegistry) {
    update.registry = resolvedRegistry;
  }

  return {
    ...fallbackStatus,
    ...status,
    update
  };
}

let cachedStatusUpdateRegistry: StatusUpdateRegistry | null = null;

function normalizeEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase();
}

export function isCliGatewayClientForcedByEnv() {
  const clientMode = normalizeEnvFlag(
    process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT ?? process.env.OPENCLAW_GATEWAY_CLIENT
  );
  const nativeFlag = normalizeEnvFlag(process.env.AGENTOS_OPENCLAW_NATIVE_WS);

  return clientMode === "cli" || nativeFlag === "0" || nativeFlag === "false" || nativeFlag === "off";
}

function resolveGatewayUrl(input?: string | null) {
  return (
    input?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL?.trim() ||
    process.env.OPENCLAW_GATEWAY_URL?.trim() ||
    DEFAULT_GATEWAY_URL
  );
}

function resolveNativeTimeoutMs(input?: number, method?: string) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return input;
  }

  const envTimeout = Number(process.env.AGENTOS_OPENCLAW_NATIVE_WS_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }

  if (method && /^(chat\.send|sessions\.send|sessions\.abort|chat\.abort)$/.test(method)) {
    return DEFAULT_NATIVE_STREAM_TIMEOUT_MS;
  }

  if (method && /(^|\.)(list|get|status|authStatus|schema|tail)$/.test(method)) {
    return DEFAULT_NATIVE_LIST_TIMEOUT_MS;
  }

  return DEFAULT_NATIVE_TIMEOUT_MS;
}

function resolveWebSocketFactory(input?: WebSocketFactory): WebSocketFactory {
  const factory = input ?? (globalThis.WebSocket as unknown as WebSocketFactory | undefined);

  if (!factory) {
    throw new NativeGatewayError("Native WebSocket is not available in this runtime.");
  }

  return factory;
}

function addSocketListener(
  socket: WebSocketLike,
  eventName: "open" | "message" | "error" | "close",
  listener: (event: unknown) => void
) {
  if (socket.addEventListener && socket.removeEventListener) {
    socket.addEventListener(eventName, listener);
    return () => socket.removeEventListener?.(eventName, listener);
  }

  const key = `on${eventName}` as "onopen" | "onmessage" | "onerror" | "onclose";
  const previous = socket[key];
  socket[key] = listener;

  return () => {
    if (socket[key] === listener) {
      socket[key] = previous ?? null;
    }
  };
}

function readSocketCloseReason(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as { code?: unknown; reason?: unknown };
  const code = typeof record.code === "number" ? record.code : null;
  const reason = typeof record.reason === "string" ? record.reason : "";

  return code ? `${code}${reason ? `: ${reason}` : ""}` : reason || null;
}

function normalizeGatewayError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const record = error as { message?: unknown; detail?: unknown; code?: unknown };
    const message = typeof record.message === "string" ? record.message : null;
    const detail = typeof record.detail === "string" ? record.detail : null;
    const code = typeof record.code === "string" ? record.code : null;

    return [code, message, detail].filter(Boolean).join(": ");
  }

  return "";
}

function normalizeGatewayResponseFailure(frame: GatewayResponseFrame) {
  return (
    normalizeGatewayError(frame.error) ||
    frame.message ||
    frame.code ||
    "OpenClaw Gateway request failed."
  );
}

function parseGatewayFrameData(data: unknown): GatewayResponseFrame | null {
  if (typeof data !== "string") {
    if (data instanceof ArrayBuffer) {
      data = new TextDecoder().decode(data);
    } else if (ArrayBuffer.isView(data)) {
      data = new TextDecoder().decode(data);
    } else {
      return null;
    }
  }

  try {
    return JSON.parse(data as string) as GatewayResponseFrame;
  } catch (error) {
    throw new NativeGatewayError("OpenClaw Gateway returned invalid JSON.", { cause: error });
  }
}

function createRequestId() {
  return `agentos:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function readConfigString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfigPath(source: unknown, path: string) {
  if (!path.trim()) {
    return source;
  }

  let current = source;
  for (const segment of parseConfigPath(path)) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }

    if (!isObjectRecord(current) || typeof segment !== "string") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function parseConfigPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path))) {
    if (match[1]) {
      segments.push(match[1]);
    } else if (match[2]) {
      segments.push(Number(match[2]));
    }
  }

  return segments;
}

function cloneJsonObject(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function setConfigPathValue(config: Record<string, unknown>, path: string, value: unknown) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: Record<string, unknown> = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (typeof segment !== "string") {
      throw new OpenClawGatewayClientError("Array root config paths are not supported.", "unknown");
    }

    const next = current[segment];
    if (isObjectRecord(next) || Array.isArray(next)) {
      current = next as Record<string, unknown>;
      continue;
    }

    const created = typeof nextSegment === "number" ? [] : {};
    current[segment] = created;
    current = created as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current)) {
      throw new OpenClawGatewayClientError("Config path points to an array index on a non-array parent.", "unknown");
    }
    current[last] = value;
    return;
  }

  current[last] = value;
}

function unsetConfigPathValue(config: Record<string, unknown>, path: string) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: unknown = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current = Array.isArray(current) && typeof segment === "number"
      ? current[segment]
      : isObjectRecord(current) && typeof segment === "string"
        ? current[segment]
        : undefined;

    if (current === undefined) {
      return;
    }
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(current) && typeof last === "number") {
    current.splice(last, 1);
    return;
  }

  if (isObjectRecord(current) && typeof last === "string") {
    delete current[last];
  }
}

function containsRedactedOpenClawSecret(value: unknown): boolean {
  if (typeof value === "string") {
    return isRedactedOpenClawSecret(value);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsRedactedOpenClawSecret(entry));
  }

  if (isObjectRecord(value)) {
    return Object.values(value).some((entry) => containsRedactedOpenClawSecret(entry));
  }

  return false;
}

function commandResultFromGatewayPayload(payload: unknown): CommandResult {
  return {
    stdout: JSON.stringify(payload ?? {}),
    stderr: ""
  };
}

function normalizeModelsPayload(payload: unknown): ModelsPayload {
  const parsed = parseGatewayPayload<{ models: Array<Record<string, unknown>> }>(
    "models.list",
    modelsPayloadSchema,
    payload
  );

  return {
    ...parsed,
    models: parsed.models.map((entry) => {
      const id = readNonEmptyString(entry.id);
      const provider = readNonEmptyString(entry.provider);
      const key = readNonEmptyString(entry.key) ?? (provider && id ? `${provider}/${id}` : id);
      const input = Array.isArray(entry.input)
        ? entry.input.filter((value): value is string => typeof value === "string").join(",") || "text"
        : readNonEmptyString(entry.input) ?? "text";

      return {
        key: key ?? readNonEmptyString(entry.name) ?? "unknown",
        name: readNonEmptyString(entry.name) ?? key ?? id ?? "Unknown model",
        input,
        contextWindow: typeof entry.contextWindow === "number" ? entry.contextWindow : null,
        local: typeof entry.local === "boolean" ? entry.local : null,
        available: typeof entry.available === "boolean" ? entry.available : null,
        tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [],
        missing: entry.missing === true
      };
    })
  };
}

function normalizeModelStatusPayload(authPayload: unknown, modelsPayload: unknown): ModelsStatusPayload {
  const auth = isObjectRecord(authPayload) ? authPayload : {};
  const models = modelsPayload ? normalizeModelsPayload(modelsPayload).models : [];
  const allowed = models.map((model) => model.key).filter(Boolean);
  const authProviders = Array.isArray(auth.providers)
    ? auth.providers.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    : [];

  return {
    allowed,
    auth: {
      providers: authProviders.map((entry) => {
        const usableProfileCount = countUsableAuthProfiles(entry.profiles);

        return {
          provider: readNonEmptyString(entry.provider) ?? undefined,
          effective: {
            kind: usableProfileCount > 0
              ? "ok"
              : readNonEmptyString(entry.status) ?? readNonEmptyString(entry.kind) ?? undefined,
            detail: readNonEmptyString(entry.detail) ?? undefined
          },
          profiles: {
            count: Array.isArray(entry.profiles) ? usableProfileCount : undefined
          }
        };
      }),
      missingProvidersInUse: Array.isArray(auth.missingProvidersInUse)
        ? auth.missingProvidersInUse.filter((entry): entry is string => typeof entry === "string")
        : [],
      unusableProfiles: Array.isArray(auth.unusableProfiles) ? auth.unusableProfiles : [],
      oauth: {
        providers: authProviders.map((entry) => ({
          provider: readNonEmptyString(entry.provider) ?? undefined,
          status: countUsableAuthProfiles(entry.profiles) > 0
            ? "ok"
            : readNonEmptyString(entry.status) ?? undefined,
          profiles: Array.isArray(entry.profiles) ? entry.profiles : undefined,
          effectiveProfiles: Array.isArray(entry.effectiveProfiles) ? entry.effectiveProfiles : undefined
        }))
      }
    }
  };
}

function countUsableAuthProfiles(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.filter((entry) => isUsableAuthProfile(entry)).length;
}

function isUsableAuthProfile(value: unknown) {
  if (!isObjectRecord(value)) {
    return false;
  }

  const status = readNonEmptyString(value.status)?.toLowerCase();
  if (!status) {
    return true;
  }

  return !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
}

function normalizePluginsPayload(payload: unknown): OpenClawPluginListPayload {
  const parsed = parseGatewayPayload<{ plugins?: Array<Record<string, unknown>>; descriptors?: Array<Record<string, unknown>> }>(
    "plugins.uiDescriptors",
    pluginsPayloadSchema,
    payload
  );
  const source = parsed.plugins ?? parsed.descriptors ?? [];

  return {
    plugins: source.map((entry) => ({
      ...entry,
      id: readNonEmptyString(entry.id) ?? readNonEmptyString(entry.pluginId) ?? readNonEmptyString(entry.name) ?? "unknown",
      name: readNonEmptyString(entry.name) ?? readNonEmptyString(entry.label) ?? readNonEmptyString(entry.id) ?? "Unknown plugin",
      status: readNonEmptyString(entry.status) ?? undefined,
      toolNames: Array.isArray(entry.toolNames)
        ? entry.toolNames.filter((toolName): toolName is string => typeof toolName === "string")
        : undefined
    }))
  };
}

function isRedactedOpenClawSecret(value: string) {
  return value === REDACTED_OPENCLAW_SECRET;
}

function buildAgentSessionKey(agentId?: string | null, sessionId?: string | null) {
  const trimmedSessionId = sessionId?.trim();

  if (trimmedSessionId?.startsWith("agent:")) {
    return trimmedSessionId;
  }

  const trimmedAgentId = agentId?.trim() || "main";
  return trimmedSessionId
    ? `agent:${trimmedAgentId}:explicit:${trimmedSessionId}`
    : `agent:${trimmedAgentId}:main`;
}

function buildSessionReferenceParams(input: OpenClawSessionReferenceInput = {}) {
  const key = input.key?.trim() || input.sessionKey?.trim();
  if (key) {
    return { key };
  }

  const sessionId = input.sessionId?.trim();
  const agentId = input.agentId?.trim();
  return {
    agentId: agentId || undefined,
    sessionId: sessionId || undefined,
    key: agentId || sessionId ? buildAgentSessionKey(agentId, sessionId) : undefined
  };
}

function buildMergePatchForConfigPath(path: string, value: unknown) {
  const segments = parseConfigPath(path);

  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  if (segments.some((segment) => typeof segment === "number")) {
    throw new OpenClawGatewayClientError(
      "Gateway config.patch merge updates do not support array-index paths; using CLI config fallback.",
      "unsupported"
    );
  }

  const root: Record<string, unknown> = {};
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    if (index === segments.length - 1) {
      current[segment] = value;
      break;
    }

    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  return root;
}

function resolveEventSubscriptionRequests(params: Record<string, unknown>, hello?: NativeHandshakePayload | null) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  if (params.subscribeSessions !== false && supportsGatewayMethod(hello, "sessions.subscribe")) {
    requests.push({ method: "sessions.subscribe", params: {} });
  }

  const sessionKeys = Array.isArray(params.sessionKeys)
    ? params.sessionKeys.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  for (const key of sessionKeys) {
    if (supportsGatewayMethod(hello, "sessions.messages.subscribe")) {
      requests.push({ method: "sessions.messages.subscribe", params: { key: key.trim() } });
    }
  }

  const taskIds = Array.isArray(params.taskIds)
    ? params.taskIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if ((params.subscribeTasks === true || taskIds.length > 0) && supportsGatewayMethod(hello, "tasks.subscribe")) {
    requests.push({
      method: "tasks.subscribe",
      params: taskIds.length > 0 ? { taskIds: taskIds.map((entry) => entry.trim()) } : {}
    });
  }

  return requests;
}

function readAdvertisedGatewayMethods(hello?: NativeHandshakePayload | null) {
  return Array.isArray(hello?.features?.methods)
    ? hello.features.methods.filter((method): method is string => typeof method === "string" && method.trim().length > 0)
    : [];
}

function readAdvertisedGatewayEvents(hello?: NativeHandshakePayload | null) {
  return Array.isArray(hello?.features?.events)
    ? hello.features.events.filter((event): event is string => typeof event === "string" && event.trim().length > 0)
    : [];
}

function supportsGatewayMethod(hello: NativeHandshakePayload | null | undefined, method: string) {
  if (method === CONNECT_METHOD) {
    return true;
  }

  const advertisedMethods = readAdvertisedGatewayMethods(hello);
  return advertisedMethods.length === 0 || advertisedMethods.includes(method);
}

function supportsGatewayEvent(hello: NativeHandshakePayload | null | undefined, event: string) {
  const advertisedEvents = readAdvertisedGatewayEvents(hello);
  return advertisedEvents.length === 0 || advertisedEvents.includes(event);
}

function validateGatewayHandshakePayload(hello: NativeHandshakePayload | null | undefined) {
  if (!hello || typeof hello !== "object") {
    throw new NativeGatewayError("OpenClaw Gateway connect response was malformed.", {
      kind: "malformed-response"
    });
  }

  const protocol = hello.protocol;
  if (typeof protocol !== "number" || !Number.isFinite(protocol)) {
    return;
  }

  if (protocol < MIN_CONTROL_PROTOCOL_VERSION || protocol > MAX_CONTROL_PROTOCOL_VERSION) {
    throw new NativeGatewayError(
      `OpenClaw Gateway protocol ${protocol} is outside AgentOS' supported range ${MIN_CONTROL_PROTOCOL_VERSION}-${MAX_CONTROL_PROTOCOL_VERSION}.`,
      { kind: "protocol-mismatch" }
    );
  }
}

function assertGatewayMethodSupported(hello: NativeHandshakePayload | null | undefined, method: string) {
  if (supportsGatewayMethod(hello, method)) {
    return;
  }

  throw new NativeGatewayError(`OpenClaw Gateway does not advertise method "${method}".`, {
    kind: "unsupported"
  });
}

function isGatewayMethodUnsupported(error: unknown) {
  return normalizeClientError(error).kind === "unsupported";
}

function resolveGatewayRequestPolicy(method: string, options: OpenClawCommandOptions = {}): OpenClawGatewayRequestPolicy {
  return {
    safety: isGatewayMutationMethod(method) ? "mutation" : "read",
    timeoutMs: options.timeoutMs,
    allowCliFallback: true
  };
}

function isGatewayMutationMethod(method: string) {
  return /(^|\.)(assign|cancel|create|delete|invoke|put|update|set|unset|patch|apply|send|abort|resolve|restart|start|stop|logout)$/i.test(method);
}

function shouldUseCliFallback(
  error: unknown,
  method: string,
  policy: OpenClawGatewayRequestPolicy
) {
  if (policy.allowCliFallback === false) {
    return false;
  }

  if (
    policy.safety === "mutation" &&
    error instanceof NativeGatewayRequestError &&
    error.method === method &&
    error.sent &&
    normalizeClientError(error).kind === "timeout"
  ) {
    return false;
  }

  return true;
}

function isGatewayTransportConfigPath(path: string) {
  return /^(gateway\.(remote\.(url|token|password)|auth\.(mode|token|password))|gateway\.mode)$/.test(path);
}

function resolveAgentTurnWaitMs(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions) {
  if (typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds) && input.timeoutSeconds > 0) {
    return Math.floor(input.timeoutSeconds * 1000);
  }

  if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return options.timeoutMs;
  }

  return 45_000;
}

function normalizeGatewayTurnEvent(
  frame: GatewayEventFrame,
  sessionKey: string,
  runId: string | null
): { text: string | null; done: boolean; payload: MissionCommandPayload } | null {
  const payload = isObjectRecord(frame.payload) ? frame.payload : {};
  const eventSessionKey =
    readNonEmptyString(payload.sessionKey) ??
    readNonEmptyString(payload.key) ??
    readNonEmptyString(payload.sessionId);
  const eventRunId =
    readNonEmptyString(payload.runId) ??
    readNonEmptyString(payload.run) ??
    readNonEmptyString(payload.clientRunId);
  const expectedSessionId = sessionKey.includes(":explicit:") ? sessionKey.split(":explicit:").at(1) ?? null : null;

  if (eventSessionKey && eventSessionKey !== sessionKey && eventSessionKey !== expectedSessionId) {
    return null;
  }

  if (runId && eventRunId && eventRunId !== runId) {
    return null;
  }

  if (!eventSessionKey && !eventRunId) {
    return null;
  }

  const state = readNonEmptyString(payload.state) ?? readNonEmptyString(payload.status) ?? readNonEmptyString(frame.event);
  const text =
    readGatewayMessageText(payload.message) ??
    readNonEmptyString(payload.text) ??
    readNonEmptyString(payload.summary) ??
    readNonEmptyString(payload.detail);
  const done = /final|complete|completed|aborted|abort|error|failed|stalled/i.test(state ?? "");
  const isError = /error|failed|stalled/i.test(state ?? "");

  if (done && !text && !isError) {
    return null;
  }

  return {
    text,
    done,
    payload: {
      runId: eventRunId ?? runId ?? undefined,
      status: isError ? "stalled" : done ? "completed" : "running",
      summary: text ?? "OpenClaw Gateway stream failed.",
      payloads: text ? [{ text, mediaUrl: null }] : []
    }
  };
}

function readGatewayMessageText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  return (
    readNonEmptyString(value.text) ??
    readNonEmptyString(value.content) ??
    readNonEmptyString(value.summary) ??
    readNonEmptyString(value.message)
  );
}

async function resolveConfiguredGatewaySecret(
  fallback: OpenClawGatewayClient,
  paths: string[],
  options: OpenClawCommandOptions,
  configOptions: { readLocalConfigFile: boolean }
) {
  if (configOptions.readLocalConfigFile) {
    const localResult = await resolveConfiguredGatewaySecretFromLocalConfig(paths);

    if (localResult.fromConfigFile) {
      return localResult;
    }
  }

  for (const path of paths) {
    let rawValue: unknown = null;

    try {
      rawValue = await fallback.getConfig<unknown>(path, options);
    } catch (error) {
      if (isOpenClawInvalidConfigError(error)) {
        return {
          value: "",
          invalidConfig: true
        };
      }

      continue;
    }

    const value = readConfigString(rawValue);
    if (isRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        `${path} is configured but OpenClaw returned a redacted secret. Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD to enable native Gateway WS; using CLI fallback.`,
        "auth"
      );
    }
    if (value) {
      return {
        value,
        invalidConfig: false
      };
    }
  }

  return {
    value: "",
    invalidConfig: false
  };
}

async function resolveConfiguredGatewaySecretFromLocalConfig(paths: string[]) {
  const config = await readJsonFile<Record<string, unknown>>(resolveOpenClawConfigPath());

  if (!config) {
    return {
      value: "",
      invalidConfig: false,
      fromConfigFile: false
    };
  }

  for (const path of paths) {
    const value = readConfigString(readConfigPath(config, path));

    if (isRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        `${path} is configured but OpenClaw returned a redacted secret. Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD to enable native Gateway WS; using CLI fallback.`,
        "auth"
      );
    }

    if (value) {
      return {
        value,
        invalidConfig: false,
        fromConfigFile: true
      };
    }
  }

  return {
    value: "",
    invalidConfig: false,
    fromConfigFile: true
  };
}

async function resolveGatewayAuth(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions
) {
  const configTokenPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.token", "gateway.remote.token"]
    : ["gateway.remote.token", "gateway.auth.token"];
  const configPasswordPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.password", "gateway.remote.password"]
    : ["gateway.remote.password", "gateway.auth.password"];
  const explicitToken =
    options.token?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  if (explicitToken) {
    return {
      token: explicitToken,
      password: ""
    };
  }

  const explicitPassword =
    options.password?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim() ||
    process.env.OPENCLAW_GATEWAY_PASSWORD?.trim();

  if (explicitPassword) {
    return {
      token: "",
      password: explicitPassword
    };
  }

  const tokenResult = await resolveConfiguredGatewaySecret(fallback, configTokenPaths, commandOptions, {
    readLocalConfigFile: !options.webSocketFactory
  });

  if (tokenResult.value || tokenResult.invalidConfig) {
    return {
      token: tokenResult.value,
      password: ""
    };
  }

  const passwordResult = await resolveConfiguredGatewaySecret(fallback, configPasswordPaths, commandOptions, {
    readLocalConfigFile: !options.webSocketFactory
  });
  const password = passwordResult.invalidConfig ? "" : passwordResult.value;

  return {
    token: "",
    password
  };
}

function isLocalGatewayUrl(rawUrl: string) {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function resolveLocalGatewayDeviceAuth(
  rawUrl: string,
  options: NativeWsOpenClawGatewayClientOptions
): Promise<LocalDeviceAuth | null> {
  if (!isLocalGatewayUrl(rawUrl) || options.webSocketFactory) {
    return null;
  }

  const stateDir = resolveOpenClawStateDir();
  const [identity, authStore] = await Promise.all([
    readJsonFile<{
      version?: unknown;
      deviceId?: unknown;
      publicKeyPem?: unknown;
      privateKeyPem?: unknown;
    }>(join(stateDir, "identity", OPENCLAW_DEVICE_IDENTITY_FILE_NAME)),
    readJsonFile<{
      version?: unknown;
      deviceId?: unknown;
      tokens?: {
        operator?: {
          token?: unknown;
          scopes?: unknown;
        };
      };
    }>(join(stateDir, "identity", OPENCLAW_DEVICE_AUTH_FILE_NAME))
  ]);
  const deviceId = readNonEmptyString(identity?.deviceId);
  const publicKeyPem = readNonEmptyString(identity?.publicKeyPem);
  const privateKeyPem = readNonEmptyString(identity?.privateKeyPem);
  const token = readNonEmptyString(authStore?.tokens?.operator?.token);

  if (!deviceId || !publicKeyPem || !privateKeyPem || !token || authStore?.deviceId !== deviceId) {
    return null;
  }

  return {
    deviceId,
    publicKeyPem,
    privateKeyPem,
    token
  };
}

function resolveOpenClawStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return expandHomePath(override);
  }

  return join(homedir(), ".openclaw");
}

function resolveOpenClawConfigPath() {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  return override ? expandHomePath(override) : join(resolveOpenClawStateDir(), "openclaw.json");
}

function expandHomePath(value: string) {
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

async function readJsonFile<TPayload>(path: string): Promise<TPayload | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as TPayload;
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string) {
  const spki = createPublicKeyDer(publicKeyPem);

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return base64UrlEncode(spki.subarray(ED25519_SPKI_PREFIX.length));
  }

  return base64UrlEncode(spki);
}

function createPublicKeyDer(publicKeyPem: string) {
  return Buffer.from(createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der"
  }) as Buffer);
}

function signDevicePayload(privateKeyPem: string, payload: string) {
  const key = createPrivateKey(privateKeyPem);
  return base64UrlEncode(sign(null, Buffer.from(payload, "utf8"), key));
}

function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily: string | null;
}) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily)
  ].join("|");
}

function normalizeDeviceMetadataForAuth(value: unknown) {
  return typeof value === "string" ? value.trim().replaceAll("|", "") : "";
}

async function buildConnectParams(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions,
  nonce?: string | null
): Promise<ConnectParamsContext> {
  const deviceAuth = await resolveLocalGatewayDeviceAuth(url, options);
  const { token, password } = deviceAuth?.token
    ? { token: "", password: "" }
    : await resolveGatewayAuth(fallback, options, url, commandOptions);
  const authToken = deviceAuth?.token ?? token;
  const auth = authToken
    ? { token: authToken }
    : password
      ? { password }
      : undefined;
  const scopes = options.scopes ?? DEFAULT_OPERATOR_SCOPES;
  const signedAtMs = Date.now();
  const platform = process.platform;
  const device = deviceAuth && nonce
    ? {
      id: deviceAuth.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(deviceAuth.publicKeyPem),
      signature: signDevicePayload(
        deviceAuth.privateKeyPem,
        buildDeviceAuthPayloadV3({
          deviceId: deviceAuth.deviceId,
          clientId: options.clientName ?? SERVER_OPERATOR_CLIENT_ID,
          clientMode: SERVER_OPERATOR_CLIENT_MODE,
          role: options.role ?? "operator",
          scopes,
          signedAtMs,
          token: authToken ?? null,
          nonce,
          platform,
          deviceFamily: null
        })
      ),
      signedAt: signedAtMs,
      nonce
    }
    : undefined;

  return {
    deviceAuth,
    params: {
      minProtocol: MIN_CONTROL_PROTOCOL_VERSION,
      maxProtocol: MAX_CONTROL_PROTOCOL_VERSION,
      client: {
        id: options.clientName ?? SERVER_OPERATOR_CLIENT_ID,
        version: options.clientVersion ?? "agentos",
        platform,
        mode: SERVER_OPERATOR_CLIENT_MODE,
        instanceId: options.instanceId
      },
      role: options.role ?? "operator",
      scopes,
      caps: ["tool-events"],
      ...(auth ? { auth } : {}),
      ...(device ? { device } : {}),
      userAgent: "AgentOS",
      locale: "en"
    }
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new NativeGatewayError("OpenClaw Gateway request was aborted.");
  }
}

async function waitForSocketOpen(socket: WebSocketLike, timeoutMs: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  if (socket.readyState === 1) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanupCallbacks: Array<() => void> = [];

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const timer = globalThis.setTimeout(() => {
      settle(() => reject(new NativeGatewayError("Timed out connecting to OpenClaw Gateway.")));
    }, timeoutMs);

    const onAbort = () => {
      settle(() => reject(new NativeGatewayError("OpenClaw Gateway request was aborted.")));
    };

    cleanupCallbacks.push(
      addSocketListener(socket, "open", () => settle(resolve)),
      addSocketListener(socket, "error", (event) =>
        settle(() => reject(new NativeGatewayError("Failed to connect to OpenClaw Gateway.", { cause: event })))
      ),
      addSocketListener(socket, "close", (event) =>
        settle(() =>
          reject(
            new NativeGatewayError(
              `OpenClaw Gateway closed before the connection was ready${readSocketCloseReason(event) ? ` (${readSocketCloseReason(event)})` : ""}.`
            )
          )
        )
      )
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForConnectChallenge(socket: WebSocketLike, timeoutMs: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanupCallbacks: Array<() => void> = [];

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      globalThis.clearTimeout(timer);
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const timer = globalThis.setTimeout(() => {
      settle(() => reject(new NativeGatewayError("OpenClaw Gateway connect challenge timed out.")));
    }, timeoutMs);

    const onAbort = () => {
      settle(() => reject(new NativeGatewayError("OpenClaw Gateway request was aborted.")));
    };

    cleanupCallbacks.push(
      addSocketListener(socket, "message", (event) => {
        try {
          const data = (event as { data?: unknown })?.data ?? event;
          const frame = parseGatewayFrameData(data) as GatewayEventFrame | null;

          if (frame?.type !== "event" || frame.event !== "connect.challenge") {
            return;
          }

          const nonce = (frame.payload as { nonce?: unknown } | null)?.nonce;

          if (typeof nonce !== "string" || !nonce.trim()) {
            settle(() => reject(new NativeGatewayError("OpenClaw Gateway connect challenge is missing a nonce.")));
            return;
          }

          settle(() => resolve(nonce.trim()));
        } catch (error) {
          settle(() => reject(error));
        }
      }),
      addSocketListener(socket, "close", (event) =>
        settle(() =>
          reject(
            new NativeGatewayError(
              `OpenClaw Gateway closed before the connect challenge${readSocketCloseReason(event) ? ` (${readSocketCloseReason(event)})` : ""}.`
            )
          )
        )
      )
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof globalThis.setTimeout>;
  cleanup: () => void;
  method: string;
  sent: boolean;
};

function sendGatewayRequest<TPayload>(
  socket: WebSocketLike,
  pending: Map<string, PendingRequest>,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
) {
  throwIfAborted(signal);

  const id = createRequestId();

  return new Promise<TPayload>((resolve, reject) => {
    function cleanup() {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    function rejectRequest(error: unknown) {
      pending.delete(id);
      cleanup();
      reject(error);
    }

    function onAbort() {
      rejectRequest(new NativeGatewayError("OpenClaw Gateway request was aborted."));
    }

    const timer = globalThis.setTimeout(() => {
      rejectRequest(new NativeGatewayRequestError(`Timed out waiting for OpenClaw Gateway method "${method}".`, method, true));
    }, timeoutMs);

    pending.set(id, {
      resolve: (payload) => {
        cleanup();
        resolve(payload as TPayload);
      },
      reject: rejectRequest,
      timer,
      cleanup,
      method,
      sent: false
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      socket.send(JSON.stringify({ type: "req", id, method, params }));
      const request = pending.get(id);
      if (request) {
        request.sent = true;
      }
    } catch (error) {
      rejectRequest(new NativeGatewayRequestError(`Failed to send OpenClaw Gateway method "${method}".`, method, false, { cause: error }));
    }
  });
}

type GatewayEventListener = (event: GatewayEventFrame) => void;
type GatewayCloseListener = () => void;

class PersistentOpenClawGatewayConnection {
  private socket: WebSocketLike | null = null;
  private pending = new Map<string, PendingRequest>();
  private cleanupCallbacks: Array<() => void> = [];
  private eventListeners = new Set<GatewayEventListener>();
  private closeListeners = new Set<GatewayCloseListener>();
  private connectPromise: Promise<NativeHandshakePayload> | null = null;
  private hello: NativeHandshakePayload | null = null;
  private state: OpenClawGatewayClientDiagnostics["connectionState"] = "idle";
  private lastNativeError: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;

  constructor(
    private readonly fallback: OpenClawGatewayClient,
    private readonly options: NativeWsOpenClawGatewayClientOptions
  ) {}

  getDiagnostics(): Pick<
    OpenClawGatewayClientDiagnostics,
    "connectionState" | "protocolVersion" | "lastNativeError" | "lastConnectedAt" | "lastDisconnectedAt"
  > {
    return {
      connectionState: this.state,
      protocolVersion: typeof this.hello?.protocol === "number" ? this.hello.protocol : null,
      lastNativeError: this.lastNativeError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt
    };
  }

  async request<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    timeoutMs: number
  ) {
    const hello = await this.ensureConnected(options, timeoutMs);
    assertGatewayMethodSupported(hello, method);
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) {
      throw new NativeGatewayError("OpenClaw Gateway connection is not ready.");
    }

    return sendGatewayRequest<TPayload>(socket, this.pending, method, params, timeoutMs, options.signal);
  }

  async probe(options: OpenClawCommandOptions, timeoutMs: number) {
    return this.ensureConnected(options, timeoutMs);
  }

  async subscribe(
    params: Record<string, unknown>,
    callbacks: {
      onEvent: (event: GatewayEventFrame) => void;
      onError?: (error: unknown) => void;
      onClose?: () => void;
    },
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<OpenClawGatewayEventSubscription> {
    const hello = await this.ensureConnected(options, timeoutMs);
    const subscriptionRequests = resolveEventSubscriptionRequests(params, hello);
    if (
      subscriptionRequests.length === 0 &&
      !supportsGatewayEvent(hello, "chat") &&
      !supportsGatewayEvent(hello, "agent") &&
      !supportsGatewayEvent(hello, "session.message") &&
      !supportsGatewayEvent(hello, "session.tool") &&
      !supportsGatewayEvent(hello, "sessions.changed") &&
      !supportsGatewayEvent(hello, "task") &&
      !supportsGatewayEvent(hello, "task.updated") &&
      !supportsGatewayEvent(hello, "task.completed") &&
      !supportsGatewayEvent(hello, "artifact") &&
      !supportsGatewayEvent(hello, "artifact.updated") &&
      !supportsGatewayEvent(hello, "exec.approval.requested") &&
      !supportsGatewayEvent(hello, "plugin.approval.requested")
    ) {
      throw new NativeGatewayError(
        "OpenClaw Gateway does not advertise compatible runtime event streaming.",
        { kind: "unsupported" }
      );
    }

    const listener: GatewayEventListener = (frame) => {
      try {
        callbacks.onEvent(frame);
      } catch (error) {
        callbacks.onError?.(error);
      }
    };
    const closeListener: GatewayCloseListener = () => callbacks.onClose?.();

    this.eventListeners.add(listener);
    this.closeListeners.add(closeListener);

    try {
      for (const request of subscriptionRequests) {
        await this.request(request.method, request.params, options, timeoutMs);
      }
    } catch (error) {
      this.eventListeners.delete(listener);
      this.closeListeners.delete(closeListener);
      throw error;
    }

    let closed = false;
    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        this.eventListeners.delete(listener);
        this.closeListeners.delete(closeListener);
        if (subscriptionRequests.length > 0) {
          this.close("event subscription closed");
        }
      }
    };
  }

  close(reason = "closed") {
    this.disconnect(new NativeGatewayError(`OpenClaw Gateway connection closed: ${reason}.`), {
      notify: true,
      closeSocket: true,
      state: "closed"
    });
  }

  private async ensureConnected(options: OpenClawCommandOptions, timeoutMs: number) {
    throwIfAborted(options.signal);

    if (this.socket?.readyState === 1 && this.hello) {
      return this.hello;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connect(options, timeoutMs).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async connect(options: OpenClawCommandOptions, timeoutMs: number) {
    this.disconnect(new NativeGatewayError("Replacing stale OpenClaw Gateway connection."), {
      notify: false,
      closeSocket: true,
      state: "connecting"
    });

    const url = resolveGatewayUrl(this.options.url);
    const WebSocketImpl = resolveWebSocketFactory(this.options.webSocketFactory);
    const connectContext = await buildConnectParams(this.fallback, this.options, url, options);
    const socket = new WebSocketImpl(url);
    this.socket = socket;
    this.state = "connecting";
    this.lastNativeError = null;

    this.cleanupCallbacks = [
      addSocketListener(socket, "message", (event) => this.handleMessage(event)),
      addSocketListener(socket, "error", (event) => {
        const error = new NativeGatewayError("OpenClaw Gateway WebSocket error.", { cause: event });
        this.lastNativeError = error.message;
        this.rejectPending(error);
      }),
      addSocketListener(socket, "close", (event) => {
        const detail = readSocketCloseReason(event);
        this.disconnect(
          new NativeGatewayError(`OpenClaw Gateway connection closed${detail ? ` (${detail})` : ""}.`),
          { notify: true, closeSocket: false, state: "closed" }
        );
      })
    ];

    try {
      await waitForSocketOpen(socket, timeoutMs, options.signal);
      const connectParams = connectContext.deviceAuth
        ? (await buildConnectParams(
          this.fallback,
          this.options,
          url,
          options,
          await waitForConnectChallenge(socket, timeoutMs, options.signal)
        )).params
        : connectContext.params;
      const hello = await sendGatewayRequest<NativeHandshakePayload>(
        socket,
        this.pending,
        CONNECT_METHOD,
        connectParams,
        timeoutMs,
        options.signal
      );
      validateGatewayHandshakePayload(hello);
      this.hello = hello;
      this.state = "connected";
      this.lastConnectedAt = new Date().toISOString();
      this.lastNativeError = null;
      return hello;
    } catch (error) {
      this.lastNativeError = error instanceof Error ? error.message : String(error);
      this.disconnect(error, { notify: true, closeSocket: true, state: "error" });
      throw error;
    }
  }

  private handleMessage(event: unknown) {
    try {
      const data = (event as { data?: unknown })?.data ?? event;
      const frame = parseGatewayFrameData(data);

      if (!frame) {
        return;
      }

      if (frame.type === "event") {
        for (const listener of [...this.eventListeners]) {
          listener(frame as GatewayEventFrame);
        }
        return;
      }

      if (frame.type !== "res" || frame.id === undefined) {
        return;
      }

      const requestId = String(frame.id);
      const request = this.pending.get(requestId);
      if (!request) {
        return;
      }

      this.pending.delete(requestId);
      globalThis.clearTimeout(request.timer);

      if (frame.ok === false) {
        request.reject(new NativeGatewayRequestError(
          normalizeGatewayResponseFailure(frame),
          request.method,
          request.sent,
          { cause: frame }
        ));
        return;
      }

      request.resolve(frame.payload);
    } catch (error) {
      this.lastNativeError = error instanceof Error ? error.message : String(error);
      this.rejectPending(error);
    }
  }

  private rejectPending(error: unknown) {
    for (const [id, request] of this.pending) {
      globalThis.clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(error);
    }
  }

  private disconnect(
    error: unknown,
    options: {
      notify: boolean;
      closeSocket: boolean;
      state: OpenClawGatewayClientDiagnostics["connectionState"];
    }
  ) {
    const hadSocket = Boolean(this.socket);
    const socket = this.socket;
    this.socket = null;
    this.hello = null;
    this.state = options.state;
    if (options.state !== "connecting" && hadSocket) {
      this.lastDisconnectedAt = new Date().toISOString();
    }

    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks = [];
    this.rejectPending(error);

    if (options.notify) {
      for (const listener of [...this.closeListeners]) {
        listener();
      }
    }

    if (options.closeSocket && socket && socket.readyState !== 3) {
      try {
        socket.close();
      } catch {
        // Ignore close errors during connection cleanup.
      }
    }
  }
}

export class NativeWsOpenClawGatewayClient implements OpenClawGatewayClient {
  private readonly fallback: OpenClawGatewayClient;
  private readonly connection: PersistentOpenClawGatewayConnection;
  private readonly fallbackCounts: Record<string, number> = {};

  constructor(private readonly options: NativeWsOpenClawGatewayClientOptions = {}) {
    this.fallback = options.fallback ?? new CliOpenClawGatewayClient();
    this.connection = new PersistentOpenClawGatewayConnection(this.fallback, options);
  }

  close(reason = "closed") {
    this.connection.close(reason);
  }

  getDiagnostics(): OpenClawGatewayClientDiagnostics {
    const connection = this.connection.getDiagnostics();
    return {
      mode: this.options.forceCli || isCliGatewayClientForcedByEnv() ? "cli" : "native-ws",
      connectionState: this.options.forceCli || isCliGatewayClientForcedByEnv()
        ? "cli-forced"
        : connection.connectionState,
      protocolVersion: connection.protocolVersion,
      fallbackCounts: { ...this.fallbackCounts },
      lastNativeError: connection.lastNativeError,
      lastConnectedAt: connection.lastConnectedAt,
      lastDisconnectedAt: connection.lastDisconnectedAt
    };
  }

  private recordGatewayFallback(operation: string, error: unknown) {
    this.fallbackCounts[operation] = (this.fallbackCounts[operation] ?? 0) + 1;
    recordGatewayFallbackDiagnostic(operation, error);
  }

  getHealth(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawHealthPayload>(
      "health",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawHealthPayload : {}),
      () => this.fallback.getHealth(options)
    );
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getStatus(options);
    }

    return this.callNative<unknown>("status", {}, options)
      .then(async (payload) => {
        const status = parseGatewayPayload<StatusPayload>("status", statusPayloadSchema, payload);

        clearGatewayFallbackDiagnostic("status");

        if (hasNativeStatusUpdateRegistry(status)) {
          rememberStatusUpdateRegistry(status.update?.registry);
          return status;
        }

        const cachedStatus = mergeStatusPayload(status, null);
        if (hasNativeStatusUpdateRegistry(cachedStatus)) {
          return cachedStatus;
        }

        const fallbackStatus = await this.fallback.getStatus(options).catch(() => null);
        return mergeStatusPayload(status, fallbackStatus);
      })
      .catch((error) => {
        this.options.onNativeFailure?.(error, "status");
        this.recordGatewayFallback("status", error);
        return this.fallback.getStatus(options);
      });
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "health",
      {},
      options,
      (payload) => {
        const health = isObjectRecord(payload) ? payload : {};
        return {
          service: {
            label: health.ok === false ? "Runtime degraded" : "Runtime ready",
            loaded: health.ok !== false
          },
          rpc: {
            ok: health.ok !== false
          }
        } satisfies GatewayStatusPayload;
      },
      () => this.fallback.getGatewayStatus(options)
    );
  }

  async getModelStatus(options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getModelStatus(options);
    }

    try {
      const [authResult, modelsResult] = await Promise.allSettled([
        this.callNative<unknown>("models.authStatus", {}, options),
        this.callNative<unknown>("models.list", { view: "configured" }, options)
      ]);

      if (authResult.status === "rejected" && modelsResult.status === "rejected") {
        throw authResult.reason;
      }

      clearGatewayFallbackDiagnostic("models.authStatus");
      clearGatewayFallbackDiagnostic("models.list");
      return normalizeModelStatusPayload(
        authResult.status === "fulfilled" ? authResult.value : null,
        modelsResult.status === "fulfilled" ? modelsResult.value : null
      );
    } catch (error) {
      this.options.onNativeFailure?.(error, "models.authStatus");
      this.recordGatewayFallback("models.authStatus", error);
      return this.fallback.getModelStatus(options);
    }
  }

  async getAgentModelStatus(input: OpenClawAgentModelStatusInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getAgentModelStatus(input, options);
    }

    try {
      const agentId = input.agentId;
      const [authResult, modelsResult] = await Promise.allSettled([
        this.callNative<unknown>("models.authStatus", { agentId }, options),
        this.callNative<unknown>("models.list", { view: "configured", agentId }, options)
      ]);

      if (authResult.status === "rejected" && modelsResult.status === "rejected") {
        throw authResult.reason;
      }

      clearGatewayFallbackDiagnostic("models.authStatus");
      clearGatewayFallbackDiagnostic("models.list");

      const authPayload = authResult.status === "fulfilled" ? authResult.value : null;
      const status = normalizeModelStatusPayload(
        authPayload,
        modelsResult.status === "fulfilled" ? modelsResult.value : null
      );

      if (isObjectRecord(authPayload)) {
        status.agentDir = readNonEmptyString(authPayload.agentDir) ?? status.agentDir;
      }

      return status;
    } catch (error) {
      this.options.onNativeFailure?.(error, "models.authStatus");
      this.recordGatewayFallback("models.authStatus", error);
      return this.fallback.getAgentModelStatus(input, options);
    }
  }

  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "modelAuthOrder",
      {
        provider: input.provider,
        agentId: input.agentId,
        profileIds: input.profileIds
      },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.setModelAuthOrder(input, options)
    );
  }

  listAgents(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "agents.list",
      {},
      options,
      (payload) => parseGatewayPayload<OpenClawAgentListPayload>("agents.list", agentListPayloadSchema, payload),
      () => this.fallback.listAgents(options)
    );
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "sessions.list",
      { ...input },
      options,
      (payload) => parseGatewayPayload<OpenClawSessionsPayload>("sessions.list", sessionsPayloadSchema, payload),
      () => this.fallback.listSessions(input, options)
    );
  }

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawSessionPayload>(
      "sessions.describe",
      {
        ...buildSessionReferenceParams(input),
        includeMessages: input.includeMessages,
        limit: input.limit
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawSessionPayload>("sessions.describe", payload),
      () => this.fallback.describeSession(input, options)
    );
  }

  getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawSessionHistoryPayload>(
      "sessions.history",
      {
        ...buildSessionReferenceParams(input),
        limit: input.limit,
        cursor: input.cursor ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawSessionHistoryPayload>("sessions.history", payload),
      () => this.fallback.getSessionHistory(input, options)
    );
  }

  exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawSessionExportPayload>(
      "sessions.export",
      {
        ...buildSessionReferenceParams(input),
        format: input.format
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawSessionExportPayload>("sessions.export", payload),
      () => this.fallback.exportSession(input, options)
    );
  }

  listTasks(input: OpenClawTaskListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskListPayload>(
      "tasks.list",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskListPayload>("tasks.list", payload),
      () => this.fallback.listTasks(input, options)
    );
  }

  getTask(input: OpenClawTaskGetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskPayload>(
      "tasks.get",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.get", payload),
      () => this.fallback.getTask(input, options)
    );
  }

  assignTask(input: OpenClawTaskAssignInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskPayload>(
      "tasks.assign",
      {
        ...input,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.assign", payload),
      () => this.fallback.assignTask(input, options)
    );
  }

  cancelTask(input: OpenClawTaskCancelInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskPayload>(
      "tasks.cancel",
      {
        taskId: input.taskId,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.cancel", payload),
      () => this.fallback.cancelTask(input, options)
    );
  }

  listArtifacts(input: OpenClawArtifactListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactListPayload>(
      "artifacts.list",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactListPayload>("artifacts.list", payload),
      () => this.fallback.listArtifacts(input, options)
    );
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.get",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.get", payload),
      () => this.fallback.getArtifact(input, options)
    );
  }

  putArtifact(input: OpenClawArtifactPutInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.put",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.put", payload),
      () => this.fallback.putArtifact(input, options)
    );
  }

  deleteArtifact(input: OpenClawArtifactDeleteInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.delete",
      {
        artifactId: input.artifactId,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.delete", payload),
      () => this.fallback.deleteArtifact(input, options)
    );
  }

  getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawRuntimeSnapshotPayload>(
      "runtime.snapshot",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawRuntimeSnapshotPayload>("runtime.snapshot", payload),
      () => this.fallback.getRuntimeSnapshot(input, options)
    );
  }

  getToolsCatalog(input: OpenClawToolsCatalogInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawToolsCatalogPayload>(
      "tools.catalog",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolsCatalogPayload>("tools.catalog", payload),
      () => this.fallback.getToolsCatalog(input, options)
    );
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawToolsEffectivePayload>(
      "tools.effective",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolsEffectivePayload>("tools.effective", payload),
      () => this.fallback.getEffectiveTools(input, options)
    );
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawToolInvokePayload>(
      "tools.invoke",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolInvokePayload>("tools.invoke", payload),
      () => this.fallback.invokeTool(input, options)
    );
  }

  getChannelStatus(input: OpenClawChannelStatusInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "channels.status",
      { ...input },
      options,
      (payload) => parseGatewayPayload<OpenClawChannelStatusPayload>(
        "channels.status",
        channelStatusPayloadSchema,
        payload
      ),
      () => this.fallback.getChannelStatus(input, options)
    );
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.gatewayFirst(
      "skills.status",
      {},
      options,
      (payload) => {
        const parsed = parseGatewayPayload<OpenClawSkillListPayload>("skills.status", skillsPayloadSchema, payload);
        return options.eligible
          ? { ...parsed, skills: parsed.skills.filter((skill) => skill.eligible === true) }
          : parsed;
      },
      () => this.fallback.listSkills(options)
    );
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "plugins.uiDescriptors",
      {},
      options,
      normalizePluginsPayload,
      () => this.fallback.listPlugins(options)
    );
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "models.list",
      { view: input.all ? "all" : "configured" },
      options,
      (payload) => {
        const normalized = normalizeModelsPayload(payload);
        return input.provider
          ? { ...normalized, models: normalized.models.filter((model) => model.key.split("/", 1)[0] === input.provider) }
          : normalized;
      },
      () => this.fallback.listModels(input, options)
    );
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.fallback.scanModels(options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.fallback.probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions = {}) {
    this.close(`gateway.${action}`);
    return this.fallback.controlGateway(action, options).finally(() => {
      this.close(`gateway.${action}.completed`);
    });
  }

  async call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.call<TPayload>(method, params, options);
    }

    try {
      const payload = await this.callNative<TPayload>(method, params, options);
      clearGatewayFallbackDiagnostic(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      const policy = resolveGatewayRequestPolicy(method, options);
      if (!shouldUseCliFallback(error, method, policy)) {
        throw error;
      }
      this.recordGatewayFallback(method, error);
      return this.fallback.call<TPayload>(method, params, options);
    }
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<TPayload | null>(
      "config.get",
      {},
      options,
      (payload) => {
        const snapshot = parseGatewayPayload<Record<string, unknown>>(
          "config.get",
          configSnapshotPayloadSchema,
          payload
        );
        const config = isObjectRecord(snapshot.config) ? snapshot.config : {};
        const resolved = isObjectRecord(snapshot.resolved) ? snapshot.resolved : {};
        const value = readConfigPath(config, path) ?? readConfigPath(resolved, path);
        return value === undefined ? null : value as TPayload;
      },
      () => this.fallback.getConfig<TPayload>(path, options)
    );
  }

  getConfigSchema(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawConfigSchemaPayload | null>(
      "config.schema",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawConfigSchemaPayload : null),
      () => this.fallback.getConfigSchema?.(options) ?? Promise.resolve(null)
    );
  }

  lookupConfigSchema(input: OpenClawConfigSchemaLookupInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawConfigSchemaLookupPayload | null>(
      "config.schema.lookup",
      { path: input.path },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawConfigSchemaLookupPayload : null),
      () => this.fallback.lookupConfigSchema?.(input, options) ?? Promise.resolve(null)
    );
  }

  async hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    try {
      const value = await this.getConfig(path, options);
      return value !== null && value !== undefined;
    } catch {
      return this.fallback.hasConfig(path, options);
    }
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return this.gatewayConfigMutationFirst(
      "config.set",
      path,
      value,
      options,
      (config) => setConfigPathValue(config, path, value),
      () => this.fallback.setConfig(path, value, options)
    );
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayConfigMutationFirst(
      "config.unset",
      path,
      undefined,
      options,
      (config) => unsetConfigPathValue(config, path),
      () => this.fallback.unsetConfig(path, options)
    );
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    const params: Record<string, unknown> = {
      id: input.id,
      agentId: input.id,
      name: input.name?.trim() || input.id,
      workspace: input.workspace,
      agentDir: input.agentDir
    };

    if (input.model) {
      params.model = input.model;
    }
    if (input.emoji) {
      params.emoji = input.emoji;
    }
    if (input.avatar) {
      params.avatar = input.avatar;
    }

    return this.gatewayFirst(
      "agents.create",
      params,
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.addAgent(input, options)
    );
  }

  updateAgent(input: OpenClawUpdateAgentInput, options: OpenClawCommandOptions = {}) {
    const params: Record<string, unknown> = {
      agentId: input.id
    };

    if (input.name !== undefined && input.name !== null && input.name.trim()) {
      params.name = input.name.trim();
    }
    if (input.workspace !== undefined && input.workspace !== null && input.workspace.trim()) {
      params.workspace = input.workspace.trim();
    }
    if (input.model !== undefined) {
      params.model = input.model?.trim() || null;
    }
    if (input.emoji !== undefined) {
      params.emoji = input.emoji?.trim() || "";
    }
    if (input.avatar !== undefined) {
      params.avatar = input.avatar?.trim() || "";
    }

    return this.gatewayFirst(
      "agents.update",
      params,
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.updateAgent?.(input, options) ??
        Promise.resolve({ stdout: JSON.stringify({ ok: true, fallback: "application-config" }), stderr: "" })
    );
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "agents.delete",
      { agentId },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.deleteAgent(agentId, options)
    );
  }

  async runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.runAgentTurn(input, options);
    }

    try {
      const payload = await this.runAgentTurnNative(input, options);
      clearGatewayFallbackDiagnostic("chat.send");
      clearGatewayFallbackDiagnostic("sessions.send");
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, "chat.send");
      const method = error instanceof NativeGatewayRequestError ? error.method : "chat.send";
      if (!shouldUseCliFallback(error, method, { safety: "mutation" })) {
        throw error;
      }
      this.recordGatewayFallback("chat.send", error);
      return this.fallback.runAgentTurn(input, options);
    }
  }

  abortAgentTurn(input: OpenClawAbortTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = input.sessionId || input.agentId ? buildAgentSessionKey(input.agentId, input.sessionId) : undefined;

    return this.gatewayFirst(
      "sessions.abort",
      {
        key: sessionKey,
        runId: input.runId ?? undefined
      },
      options,
      (payload) => payload as MissionCommandPayload,
      () => this.gatewayFirst(
        "chat.abort",
        {
          sessionKey,
          runId: input.runId ?? undefined
        },
        options,
        (payload) => payload as MissionCommandPayload,
        () => this.fallback.abortAgentTurn?.(input, options) ??
          this.fallback.call<MissionCommandPayload>("sessions.abort", { key: sessionKey, runId: input.runId ?? undefined }, options)
      )
    );
  }

  async streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    if (options.forceCli || this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.streamAgentTurn(input, callbacks, options);
    }

    const sessionKey = buildAgentSessionKey(input.agentId, input.sessionId);
    let subscription: OpenClawGatewayEventSubscription | null = null;
    let dispatchedRunId: string | null = null;
    let lastAssistantText = "";
    let resolveFinal: (payload: MissionCommandPayload | null) => void = () => {};
    const finalPayload = new Promise<MissionCommandPayload | null>((resolve) => {
      resolveFinal = resolve;
    });

    try {
      subscription = await this.subscribeNativeEvents(
        {
          subscribeSessions: true,
          sessionKeys: [sessionKey]
        },
        {
          onEvent: (frame) => {
            const eventPayload = normalizeGatewayTurnEvent(frame, sessionKey, dispatchedRunId);
            if (!eventPayload) {
              return;
            }

            if (eventPayload.text && eventPayload.text !== lastAssistantText) {
              lastAssistantText = eventPayload.text;
              void callbacks.onStdout?.(`${JSON.stringify({ type: "assistant", text: eventPayload.text })}\n`);
            }

            if (eventPayload.done) {
              resolveFinal?.(eventPayload.payload);
            }
          },
          onError: (error) => {
            void callbacks.onStderr?.(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`);
          }
        },
        options
      );

      const dispatchPayload = await this.runAgentTurnNative(input, options);
      dispatchedRunId = dispatchPayload.runId ?? null;
      clearGatewayFallbackDiagnostic("streamAgentTurn");

      const waitMs = resolveAgentTurnWaitMs(input, options);
      const settledPayload = await Promise.race([
        finalPayload,
        new Promise<null>((resolve) => globalThis.setTimeout(() => resolve(null), waitMs))
      ]);

      return settledPayload ?? dispatchPayload;
    } catch (error) {
      this.options.onNativeFailure?.(error, "streamAgentTurn");
      const method = error instanceof NativeGatewayRequestError ? error.method : "streamAgentTurn";
      if (!shouldUseCliFallback(error, method, { safety: "mutation" })) {
        throw error;
      }
      this.recordGatewayFallback("streamAgentTurn", error);
      return this.fallback.streamAgentTurn(input, callbacks, options);
    } finally {
      subscription?.close();
      resolveFinal(null);
    }
  }

  private async runAgentTurnNative(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = buildAgentSessionKey(input.agentId, input.sessionId);
    const timeoutMs = typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds)
      ? Math.max(0, Math.floor(input.timeoutSeconds * 1000))
      : undefined;
    const idempotencyKey = input.dispatchId ?? createRequestId();
    const chatParams = {
      sessionKey,
      sessionId: input.sessionId,
      message: input.message,
      thinking: input.thinking,
      timeoutMs,
      idempotencyKey
    };

    try {
      return await this.callNative<MissionCommandPayload>("chat.send", chatParams, options);
    } catch (error) {
      if (!isGatewayMethodUnsupported(error)) {
        throw error;
      }
    }

    return this.callNative<MissionCommandPayload>(
      "sessions.send",
      {
        key: sessionKey,
        message: input.message,
        thinking: input.thinking,
        timeoutMs,
        idempotencyKey
      },
      options
    );
  }

  tailLogs(input: OpenClawLogsTailInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawLogsTailPayload>(
      "logs.tail",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawLogsTailPayload : {}),
      () => this.fallback.tailLogs?.(input, options) ?? this.fallback.call<OpenClawLogsTailPayload>("logs.tail", { ...input }, options)
    );
  }

  listExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawExecApprovalListPayload>(
      "exec.approval.list",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawExecApprovalListPayload : {}),
      () => this.fallback.listExecApprovals?.(input, options) ??
        this.fallback.call<OpenClawExecApprovalListPayload>("exec.approval.list", { ...input }, options)
    );
  }

  resolveExecApproval(input: OpenClawExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawExecApprovalResolvePayload>(
      "exec.approval.resolve",
      {
        approvalId: input.approvalId,
        decision: input.decision,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawExecApprovalResolvePayload : {}),
      () => this.fallback.resolveExecApproval?.(input, options) ??
        this.fallback.call<OpenClawExecApprovalResolvePayload>(
          "exec.approval.resolve",
          {
            approvalId: input.approvalId,
            decision: input.decision,
            reason: input.reason ?? undefined
          },
          options
        )
    );
  }

  getCronStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronStatusPayload>(
      "cron.status",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawCronStatusPayload : {}),
      () => this.fallback.getCronStatus?.(options) ?? this.fallback.call<OpenClawCronStatusPayload>("cron.status", {}, options)
    );
  }

  listCronJobs(input: OpenClawCronListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronListPayload>(
      "cron.list",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawCronListPayload : {}),
      () => this.fallback.listCronJobs?.(input, options) ?? this.fallback.call<OpenClawCronListPayload>("cron.list", { ...input }, options)
    );
  }

  async subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ) {
    if (options.forceCli || this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.subscribeRuntimeEvents(input, callbacks, options);
    }

    const hasExplicitIncludes = [
      input.includeSessions,
      input.includeTasks,
      input.includeArtifacts,
      input.includeApprovals
    ].some((value) => value !== undefined);

    try {
      const subscription = await this.subscribeNativeEvents(
        {
          subscribeSessions: input.includeSessions ?? !hasExplicitIncludes,
          subscribeTasks: input.includeTasks ?? (input.taskIds?.length ? true : undefined),
          subscribeArtifacts: input.includeArtifacts,
          subscribeApprovals: input.includeApprovals,
          sessionKeys: input.sessionKeys,
          taskIds: input.taskIds,
          artifactIds: input.artifactIds
        },
        callbacks,
        options
      );
      clearGatewayFallbackDiagnostic("runtime.subscribe");
      return subscription;
    } catch (error) {
      this.options.onNativeFailure?.(error, "runtime.subscribe");
      if (!shouldUseCliFallback(error, "runtime.subscribe", { safety: "read", timeoutMs: options.timeoutMs })) {
        throw error;
      }

      this.recordGatewayFallback("runtime.subscribe", error);
      return this.fallback.subscribeRuntimeEvents(input, callbacks, options);
    }
  }

  async callNative<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {},
    policy: OpenClawGatewayRequestPolicy = resolveGatewayRequestPolicy(method, options)
  ) {
    const timeoutMs = resolveNativeTimeoutMs(policy.timeoutMs ?? options.timeoutMs ?? this.options.timeoutMs, method);
    return this.connection.request<TPayload>(method, params, options, timeoutMs);
  }

  async probeNativeHandshake(options: OpenClawCommandOptions = {}) {
    const timeoutMs = resolveNativeTimeoutMs(options.timeoutMs ?? this.options.timeoutMs, CONNECT_METHOD);
    return this.connection.probe(options, timeoutMs);
  }

  async subscribeNativeEvents(
    params: Record<string, unknown>,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawGatewayEventSubscription> {
    const timeoutMs = resolveNativeTimeoutMs(options.timeoutMs ?? this.options.timeoutMs, "sessions.subscribe");
    return this.connection.subscribe(params, callbacks, options, timeoutMs);
  }

  private async gatewayFirst<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    normalize: (payload: unknown) => TPayload,
    fallback: () => Promise<TPayload>,
    policy: OpenClawGatewayRequestPolicy = resolveGatewayRequestPolicy(method, options)
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return fallback();
    }

    try {
      const payload = normalize(await this.callNative<unknown>(method, params, options, policy));
      clearGatewayFallbackDiagnostic(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      if (!shouldUseCliFallback(error, method, policy)) {
        throw error;
      }
      this.recordGatewayFallback(method, error);
      return fallback();
    }
  }

  private async gatewayFirstCompatible<TPayload>(
    operationId: OpenClawGatewayCompatibilityOperationId,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    normalize: (payload: unknown) => TPayload,
    fallback: () => Promise<TPayload>
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return fallback();
    }

    const methods = getOpenClawGatewayMethodCandidates(operationId);
    let lastUnsupportedError: unknown = null;

    for (const method of methods) {
      const policy = resolveGatewayRequestPolicy(method, options);

      try {
        const payload = normalize(await this.callNative<unknown>(method, params, options, policy));
        for (const candidate of methods) {
          clearGatewayFallbackDiagnostic(candidate);
        }
        return payload;
      } catch (error) {
        this.options.onNativeFailure?.(error, method);

        if (isGatewayMethodUnsupported(error)) {
          lastUnsupportedError = error;
          continue;
        }

        if (!shouldUseCliFallback(error, method, policy)) {
          throw error;
        }

        this.recordGatewayFallback(method, error);
        return fallback();
      }
    }

    const fallbackOperation = methods[0] ?? operationId;
    this.recordGatewayFallback(
      fallbackOperation,
      lastUnsupportedError ?? new NativeGatewayError(
        `OpenClaw Gateway does not advertise a compatible method for ${operationId}.`,
        { kind: "unsupported" }
      )
    );
    return fallback();
  }

  private async gatewayConfigMutationFirst(
    operation: string,
    path: string,
    value: unknown,
    options: OpenClawCommandOptions,
    mutate: (config: Record<string, unknown>) => void,
    fallback: () => Promise<CommandResult>
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return fallback();
    }

    if (containsRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        "Refusing to write a redacted OpenClaw secret back to config.",
        "auth"
      );
    }

    const shouldCloseConnection = isGatewayTransportConfigPath(path);

    try {
      const snapshot = parseGatewayPayload<Record<string, unknown>>(
        "config.get",
        configSnapshotPayloadSchema,
        await this.callNative<unknown>("config.get", {}, options, { safety: "read" })
      );
      const config = cloneJsonObject(isObjectRecord(snapshot.config) ? snapshot.config : {});
      mutate(config);
      await this.callNative<unknown>("config.schema.lookup", { path }, options, { safety: "read" })
        .catch(() => this.callNative<unknown>("config.schema", {}, options, { safety: "read" }))
        .catch(() => null);

      const baseHash = typeof snapshot.hash === "string" && snapshot.hash.trim() ? snapshot.hash : undefined;
      const patch = buildMergePatchForConfigPath(path, operation === "config.unset" ? null : value);
      const patchParams: Record<string, unknown> = {
        raw: JSON.stringify(patch)
      };

      if (baseHash) {
        patchParams.baseHash = baseHash;
      }
      let payload: unknown;

      try {
        payload = await this.callNative<unknown>("config.patch", patchParams, options, { safety: "mutation" });
      } catch (patchError) {
        try {
          const applyParams: Record<string, unknown> = {
            raw: JSON.stringify(config)
          };

          if (baseHash) {
            applyParams.baseHash = baseHash;
          }

          payload = await this.callNative<unknown>("config.apply", applyParams, options, { safety: "mutation" });
        } catch (applyError) {
          if (containsRedactedOpenClawSecret(snapshot.config)) {
            throw new OpenClawGatewayClientError(
              "OpenClaw returned redacted secrets in the config snapshot; refusing full Gateway config overwrite and using path-level CLI fallback.",
              "auth",
              { cause: applyError }
            );
          }

          const params: Record<string, unknown> = {
            raw: JSON.stringify(config)
          };

          if (baseHash) {
            params.baseHash = baseHash;
          }

          payload = await this.callNative<unknown>("config.set", params, options, { safety: "mutation" }).catch(() => {
            throw patchError;
          });
        }
      }
      clearGatewayFallbackDiagnostic(operation);
      return commandResultFromGatewayPayload(payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, operation);
      if (!shouldUseCliFallback(error, error instanceof NativeGatewayRequestError ? error.method : operation, {
        safety: "mutation"
      })) {
        throw error;
      }
      this.recordGatewayFallback(operation, error);
      return fallback();
    } finally {
      if (shouldCloseConnection) {
        this.close(`${operation}:${path}`);
      }
    }
  }
}
