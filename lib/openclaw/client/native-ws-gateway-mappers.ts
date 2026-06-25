import "server-only";

import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { type GatewayEventFrame } from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  isObjectRecord,
  readNonEmptyString
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type {
  MissionCommandPayload,
  OpenClawAgentIdentityInput,
  OpenClawAgentTurnInput,
  OpenClawArtifactListInput,
  OpenClawAutomationProvisionInput,
  OpenClawChannelAccountProvisionInput,
  OpenClawChatInjectInput,
  OpenClawCommandOptions,
  OpenClawRuntimeSnapshotInput,
  OpenClawSessionHistoryInput,
  OpenClawSessionReferenceInput,
  OpenClawSessionSteerInput
} from "@/lib/openclaw/client/types";

export function buildChannelAccountProvisionParams(input: OpenClawChannelAccountProvisionInput) {
  return {
    channel: input.channel,
    account: input.account?.trim() || undefined,
    accountId: input.account?.trim() || undefined,
    name: input.name?.trim() || undefined,
    token: input.token?.trim() || undefined,
    botToken: input.botToken?.trim() || undefined,
    webhookUrl: input.webhookUrl?.trim() || undefined
  };
}

export function buildAgentIdentityParams(input: OpenClawAgentIdentityInput) {
  return {
    agentId: input.agentId,
    agent: input.agentId,
    workspace: input.workspace,
    identityFile: input.identityFile,
    name: input.name?.trim() || undefined,
    emoji: input.emoji?.trim() || undefined,
    theme: input.theme?.trim() || undefined,
    avatar: input.avatar?.trim() || undefined
  };
}

export function buildAutomationProvisionParams(input: OpenClawAutomationProvisionInput) {
  return {
    name: input.name,
    description: input.description || input.name,
    agentId: input.agentId,
    agent: input.agentId,
    message: input.message,
    thinking: input.thinking || "medium",
    timeoutSeconds: input.timeoutSeconds ?? 120,
    schedule: input.schedule,
    announce: input.announce ?? undefined
  };
}

export function buildAgentSessionKey(agentId?: string | null, sessionId?: string | null) {
  const trimmedSessionId = sessionId?.trim();

  if (trimmedSessionId?.startsWith("agent:")) {
    return trimmedSessionId;
  }

  const trimmedAgentId = agentId?.trim() || "main";
  return trimmedSessionId
    ? `agent:${trimmedAgentId}:explicit:${trimmedSessionId}`
    : `agent:${trimmedAgentId}:main`;
}

export function buildSessionReferenceParams(input: OpenClawSessionReferenceInput = {}) {
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

export function buildSessionHistoryParams(input: OpenClawSessionHistoryInput = {}) {
  return {
    ...buildSessionReferenceParams(input),
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

export function buildChatHistoryParams(input: OpenClawSessionHistoryInput = {}) {
  const reference = buildSessionReferenceParams(input);
  return {
    sessionKey: reference.key,
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

export function buildSessionPreviewParams(input: OpenClawSessionHistoryInput = {}) {
  const reference = buildSessionReferenceParams(input);
  const key = reference.key;
  return {
    key,
    sessionKey: key,
    sessionKeys: key ? [key] : undefined,
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

export function buildArtifactListParams(input: OpenClawArtifactListInput = {}) {
  const taskId = input.taskId?.trim();
  const runId = input.runId?.trim();
  const sessionKey = input.sessionKey?.trim() || input.sessionId?.trim();

  return {
    taskId: taskId || undefined,
    runId: runId || undefined,
    sessionKey: sessionKey || undefined
  };
}

export function hasArtifactListScope(input: OpenClawArtifactListInput | OpenClawRuntimeSnapshotInput = {}) {
  return Boolean(input.taskId?.trim() || input.runId?.trim() || input.sessionKey?.trim() || input.sessionId?.trim());
}

export function buildRuntimeSnapshotArtifactListInput(input: OpenClawRuntimeSnapshotInput): OpenClawArtifactListInput {
  return {
    taskId: input.taskId,
    runId: input.runId,
    sessionKey: input.sessionKey,
    sessionId: input.sessionId
  };
}

export function buildSessionSteerParams(input: OpenClawSessionSteerInput) {
  const key = input.key?.trim();
  const sessionId = input.sessionId?.trim();

  return {
    key: key || undefined,
    sessionId: key ? undefined : sessionId || undefined,
    message: input.message
  };
}

export function buildChatInjectParams(input: OpenClawChatInjectInput) {
  const sessionKey = input.sessionKey?.trim();
  const sessionId = input.sessionId?.trim();

  return {
    sessionKey: sessionKey || undefined,
    sessionId: sessionKey ? undefined : sessionId || undefined,
    message: input.message
  };
}

export function resolveAgentTurnWaitMs(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions) {
  if (typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds) && input.timeoutSeconds > 0) {
    return Math.floor(input.timeoutSeconds * 1000);
  }

  if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return options.timeoutMs;
  }

  return 45_000;
}

export function shouldIgnoreNativeSessionPreparationError(error: unknown) {
  const kind = normalizeClientError(error).kind;
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    kind === "unsupported" ||
    kind === "conflict" ||
    kind === "malformed-response" ||
    /invalid .*sessions\.(create|patch) params|unexpected property/i.test(message)
  );
}

export function shouldIgnoreNativeAgentWaitError(error: unknown) {
  const kind = normalizeClientError(error).kind;
  return kind === "unsupported" || kind === "timeout" || kind === "malformed-response";
}

export function buildNativeSessionCreateParams(input: OpenClawAgentTurnInput, sessionKey: string) {
  return {
    key: sessionKey,
    agentId: input.agentId
  };
}

export function normalizeGatewayTurnEvent(
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

  const messageRole = readGatewayMessageRole(payload.message) ??
    readNonEmptyString(payload.role) ??
    readNonEmptyString(payload.authorRole) ??
    readNonEmptyString(payload.speaker);

  if (messageRole && /^(user|operator|system)$/i.test(messageRole)) {
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
  const summary = text ?? resolveGatewayTurnFailureSummary(payload, state);

  if (done && !text && !isError) {
    return null;
  }

  return {
    text,
    done,
    payload: {
      runId: eventRunId ?? runId ?? undefined,
      status: isError ? "stalled" : done ? "completed" : "running",
      summary,
      payloads: text ? [{ text, mediaUrl: null }] : []
    }
  };
}

function resolveGatewayTurnFailureSummary(payload: Record<string, unknown>, state: string | null) {
  const explicitReason =
    readGatewayMessageText(payload.error) ??
    readGatewayMessageText(payload.failure) ??
    readGatewayMessageText(payload.reason) ??
    readGatewayMessageText(payload.cause) ??
    readGatewayMessageText(payload.diagnostic) ??
    readGatewayMessageText(payload.diagnostics) ??
    readNonEmptyString(payload.errorMessage) ??
    readNonEmptyString(payload.message) ??
    readNonEmptyString(payload.stopReason);

  if (explicitReason && isMeaningfulGatewayTurnFailureReason(explicitReason)) {
    return `OpenClaw Gateway ended the chat stream without assistant text: ${explicitReason}`;
  }

  if (state && /aborted|abort/i.test(state)) {
    return "OpenClaw Gateway ended the chat stream before assistant text was available. Status: aborted.";
  }

  if (state && /stalled/i.test(state)) {
    return "OpenClaw Gateway reported the chat stream stalled before assistant text was available.";
  }

  if (state && /error|failed/i.test(state)) {
    return "OpenClaw Gateway reported the chat stream failed before assistant text was available.";
  }

  return "OpenClaw Gateway ended the chat stream before assistant text was available.";
}

function isMeaningfulGatewayTurnFailureReason(reason: string) {
  const normalized = reason.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return !/^(create|created|stop|stopped|complete|completed|done|end|ended|finish|finished|success|ok)$/i.test(normalized);
}

function readGatewayMessageRole(value: unknown): string | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const author = isObjectRecord(value.author) ? value.author : null;

  return readNonEmptyString(value.role) ??
    readNonEmptyString(value.type) ??
    readNonEmptyString(value.speaker) ??
    readNonEmptyString(author?.role) ??
    readNonEmptyString(author?.type) ??
    readNonEmptyString(author?.name);
}

export function readGatewayMessageText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const text = value
      .flatMap((item) => {
        if (!isObjectRecord(item)) {
          return [];
        }

        if (
          (item.type === "text" || item.type === "output_text") &&
          typeof item.text === "string" &&
          item.text.trim()
        ) {
          return [item.text.trim()];
        }

        if (item.type === "toolResult") {
          const toolResultText = readGatewayMessageText(item.content) ?? readNonEmptyString(item.text);
          return toolResultText ? [toolResultText] : [];
        }

        return [];
      })
      .join("\n\n")
      .trim();

    return text || null;
  }

  if (!isObjectRecord(value)) {
    return null;
  }

  return (
    readNonEmptyString(value.text) ??
    readNonEmptyString(value.content) ??
    readGatewayMessageText(value.content) ??
    readNonEmptyString(value.summary) ??
    readNonEmptyString(value.message)
  );
}
