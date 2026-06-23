import { NextResponse } from "next/server";
import { z } from "zod";

import { clearMissionControlCaches, getMissionControlSnapshot, updateAgent } from "@/lib/agentos/control-plane";
import {
  buildAgentChatPrompt,
  buildWorkspaceTeamPrompt,
  normalizeAgentChatHistory
} from "@/lib/openclaw/agent-chat-prompt";
import {
  buildDirectAgentIdentityReply,
  isDirectAgentIdentityQuestion,
  isStaleAgentChatContextRecoveryText
} from "@/lib/openclaw/agent-chat-guards";
import {
  completedEmptyAgentChatResponseMessage,
  emptyAgentChatResponseMessage,
  extractAgentChatEmptyResponseDiagnosticText,
  extractAssistantTextFromAgentChatStreamLine,
  extractAgentChatMessagesFromSessionHistory,
  extractLatestAssistantTextFromSessionHistory,
  isCompletedEmptyAgentChatResponse,
  resolveAgentChatRuntimeFailureMessage,
  sanitizeAgentChatReplyText,
  sanitizeAgentChatVisibleText
} from "@/lib/openclaw/agent-chat-response";
import {
  readAgentChatTranscriptMessages,
  readLatestAgentChatTurn
} from "@/lib/openclaw/domains/agent-chat-transcript";
import { extractMissionControlAction, type MissionControlAction } from "@/lib/openclaw/chat-actions";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { ensureOpenAiCodexAuthOrderForAgent } from "@/lib/openclaw/application/model-auth-service";
import {
  readAgentChatSessionsForAgent,
  recordAgentChatSession,
  resolveAgentChatSessionId
} from "@/lib/openclaw/domains/agent-chat-sessions";
import { persistRuntimeSmokeTest } from "@/lib/openclaw/domains/control-plane-settings";
import { openClawStateRootPath } from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { isOpenAiCodexAuthFailure } from "@/lib/openclaw/model-auth-errors";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  resolveOpenClawRuntimeFailureMessage,
  resolveOpenClawRuntimePreflightError
} from "@/lib/openclaw/runtime-compatibility";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";
import type { ControlPlaneSnapshot, MissionDispatchStatus, MissionResponse } from "@/lib/agentos/contracts";
import type { TranscriptTurn } from "@/lib/openclaw/domains/runtime-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatHistoryEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1)
});

const chatSchema = z.object({
  message: z.string().min(1),
  rawMessage: z.string().min(1).optional(),
  history: z.array(chatHistoryEntrySchema).optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

type AgentChatPayloadEntry = {
  text?: string;
  content?: string;
  mediaUrl?: string | null;
};

type AgentChatPayloadResult = {
  payloads?: AgentChatPayloadEntry[];
  meta?: Record<string, unknown>;
  summary?: string;
  stopReason?: string | null;
};

type AgentChatCommandPayload = {
  runId?: string | null;
  status?: string;
  summary?: string;
  payloads?: AgentChatPayloadEntry[];
  meta?: Record<string, unknown>;
  stopReason?: string | null;
  result?: AgentChatPayloadResult;
};

type AgentChatStreamEvent =
  | {
      type: "status";
      message: string;
    }
  | {
      type: "assistant";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      message: string;
      response?: MissionResponse;
    };

type RehydratedAgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  status: "sent";
  runId?: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const snapshot = await getMissionControlSnapshot({ includeHidden: true });
    const agent = snapshot.agents.find((entry) => entry.id === agentId) ?? null;

    if (!agent) {
      return NextResponse.json({ error: "Agent could not be found." }, { status: 404 });
    }

    const sessions = await readAgentChatSessionsForAgent({
      agentId,
      workspacePath: agent.workspacePath,
      limit: 5
    });
    const messages: RehydratedAgentChatMessage[] = [];

    for (const session of [...sessions].reverse()) {
      const transcriptMessages = await readAgentChatTranscriptMessages(
        agentId,
        session.sessionId,
        session.workspacePath ?? agent.workspacePath
      );

      if (transcriptMessages.length > 0) {
        messages.push(...transcriptMessages);
        continue;
      }

      const historyMessages = await readAgentChatHistoryMessages(agentId, session.sessionId);
      messages.push(...historyMessages);
    }

    return NextResponse.json({
      agentId,
      sessionId: sessions[0]?.sessionId ?? null,
      source: messages.length > 0 ? "openclaw-session" : "unavailable",
      messages: dedupeRehydratedAgentChatMessages(messages).slice(-60)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "OpenClaw chat history is unavailable.")
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const input = chatSchema.parse(await request.json());

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let closed = false;

    const send = (event: AgentChatStreamEvent) => {
      const safeEvent = redactSecrets(event);
      if (closed) {
        return Promise.resolve();
      }

      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
        .catch(() => {});

      return writeChain;
    };

    const closeWriter = async () => {
      if (closed) {
        return;
      }

      closed = true;
      await writeChain;

      try {
        await writer.close();
      } catch {
        // The reader may already be gone.
      }
    };

    void (async () => {
      let latestAssistantText = "";
      let latestStreamAction: MissionControlAction | null = null;
      let latestStatusMessage = "";
      let latestTurnStatus: TranscriptTurn["status"] | null = null;
      let keepPolling = true;
      let streamStdoutBuffer = "";
      let activeAgentModelId: string | null = null;

      const stopPolling = () => {
        keepPolling = false;
      };

      const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

      const emitAssistantText = async (value: string | null | undefined) => {
        const sanitizedText = sanitizeAgentChatReplyText(value);
        const extracted = extractMissionControlAction(sanitizedText);
        const currentText = sanitizeAgentChatVisibleText(sanitizedText);

        if (!latestStreamAction && extracted.action) {
          latestStreamAction = extracted.action;
        }

        if (!currentText || currentText === latestAssistantText) {
          return;
        }

        latestAssistantText = currentText;
        await send({
          type: "assistant",
          text: currentText
        });
      };

      const pollTranscript = async (agentId: string, sessionId: string, workspacePath?: string) => {
        const turn = await readLatestAgentChatTurn(agentId, sessionId, workspacePath);

        if (!turn) {
          return;
        }

        const statusMessage = resolveChatStatusMessage(turn);
        if (turn.status !== latestTurnStatus || statusMessage !== latestStatusMessage) {
          latestTurnStatus = turn.status;
          latestStatusMessage = statusMessage;
          await send({
            type: "status",
            message: statusMessage
          });
        }

        const currentText = typeof turn.finalText === "string" ? sanitizePolledAssistantText(turn.finalText) : "";
        await emitAssistantText(currentText);
      };

      const pollGatewayHistory = async (agentId: string, sessionId: string) => {
        const history = await getOpenClawAdapter().getSessionHistory(
          {
            agentId,
            sessionId,
            limit: 40
          },
          { timeoutMs: 1000 }
        );
        await emitAssistantText(extractLatestAssistantTextFromSessionHistory(history));
      };

      const handleCommandStdout = async (chunk: string) => {
        streamStdoutBuffer += chunk;
        const lines = streamStdoutBuffer.split(/\r?\n/);
        streamStdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(line));
        }
      };

      const waitForLateAssistantText = async (agentId: string, sessionId: string, workspacePath?: string) => {
        const startedAt = Date.now();

        while (!latestAssistantText && Date.now() - startedAt < 6000 && !request.signal.aborted) {
          await wait(300);

          try {
            await pollTranscript(agentId, sessionId, workspacePath);
          } catch {
            // Transcript files can appear slightly after the Gateway marks a turn complete.
          }

          if (latestAssistantText) {
            return;
          }

          try {
            await pollGatewayHistory(agentId, sessionId);
          } catch {
            // Older Gateways may not expose chat history for explicit sessions.
          }
        }
      };

      const handleAbort = () => {
        stopPolling();
      };

      request.signal.addEventListener("abort", handleAbort);

      try {
        await send({
          type: "status",
          message: "Starting agent turn..."
        });

        const snapshot = await getMissionControlSnapshot({ includeHidden: true });
        const agent = snapshot.agents.find((entry) => entry.id === agentId) ?? null;

        if (!agent) {
          await send({
            type: "done",
            ok: false,
            message: "Agent could not be found."
          });
          return;
        }
        activeAgentModelId = agent.modelId;

        const resolvedDefaultModelId = resolveReadyDefaultAgentModelId(snapshot);
        if (agent.modelId === "unassigned" && resolvedDefaultModelId) {
          await updateAgent({
            id: agentId,
            modelId: resolvedDefaultModelId
          });
          agent.modelId = resolvedDefaultModelId;
          activeAgentModelId = agent.modelId;
        }

        const runtimePreflightError = resolveOpenClawRuntimePreflightError(snapshot);
        if (runtimePreflightError) {
          await send({
            type: "done",
            ok: false,
            message: runtimePreflightError
          });
          return;
        }

        const runtimeState = await inspectOpenClawRuntimeState(openClawStateRootPath, [agentId], {
          agentDirs: {
            [agentId]: agent.agentDir
          },
          touch: true
        });
        if (runtimeState.issues.length > 0) {
          await send({
            type: "done",
            ok: false,
            message:
              "AgentOS cannot write the OpenClaw session store for this agent. Start AgentOS outside the sandbox or grant write access to ~/.openclaw, then retry the chat."
          });
          clearMissionControlCaches();
          return;
        }

        await ensureOpenAiCodexAuthOrderForAgent({
          agentId,
          modelId: agent.modelId,
          agentDir: agent.agentDir
        });

        const submittedMessage = input.message.trim();
        const rawMessage = input.rawMessage?.trim();
        const operatorMessage = rawMessage || submittedMessage;
        let message = submittedMessage;

        if (rawMessage || !isComposedAgentChatPrompt(submittedMessage)) {
          const workspaceTeamPrompt = buildWorkspaceTeamPrompt(snapshot, agent);
          const workspaceSurfacePrompt = renderWorkspaceSurfaceCoordinationMarkdownForAgent(agentId, snapshot);
          const history = normalizeAgentChatHistory(input.history ?? []).slice(-16);

          message = buildAgentChatPrompt(history, operatorMessage, {
            agentId,
            agentName: formatAgentDisplayName(agent),
            agentDir: agent.agentDir,
            workspacePath: agent.workspacePath,
            workspaceTeamPrompt,
            workspaceSurfacePrompt
          });
        }

        const sessionId = await resolveAgentChatSessionId({
          agentId,
          workspacePath: agent.workspacePath
        });
        await recordAgentChatSession({
          agentId,
          sessionId,
          workspacePath: agent.workspacePath
        });
        const commandPromise = getOpenClawAdapter().streamAgentTurn(
          {
            agentId,
            sessionId,
            message,
            thinking: input.thinking ?? "low",
            timeoutSeconds: 90,
            workspace: agent.workspacePath,
            local: !snapshot.diagnostics.rpcOk
          },
          {
            onStdout: handleCommandStdout
          },
          {
            timeoutMs: 120000,
            signal: request.signal
          }
        ) as Promise<AgentChatCommandPayload>;

        void (async () => {
          while (keepPolling && !request.signal.aborted) {
            try {
              await pollTranscript(agentId, sessionId, agent.workspacePath);
            } catch {
              // Ignore transient transcript reads while the session is still booting.
            }

            await wait(250);
          }
        })();

        const result = await commandPromise;
        if (streamStdoutBuffer.trim()) {
          await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(streamStdoutBuffer));
          streamStdoutBuffer = "";
        }
        stopPolling();

        try {
          await pollTranscript(agentId, sessionId, agent.workspacePath);
        } catch {
          // Ignore a last transient read failure.
        }

        let response = toAgentChatResponse(agentId, result);
        if (isEmptyAgentChatResponse(response) && !latestAssistantText) {
          await waitForLateAssistantText(agentId, sessionId, agent.workspacePath);
        }

        if (latestAssistantText && response.payloads.length === 0) {
          response = {
            ...response,
            summary: latestAssistantText,
            payloads: [
              {
                text: latestAssistantText,
                mediaUrl: null
              }
            ]
          };
        }
        const emptyResponseDiagnosticMessage = resolveEmptyAgentChatDiagnosticMessage(result, {
          modelId: activeAgentModelId
        });
        response = recoverDirectIdentityResponse(response, formatAgentDisplayName(agent), operatorMessage);
        response = attachStreamMissionControlAction(response, latestStreamAction);
        response = recoverCompletedEmptyAgentChatResponse(response, emptyResponseDiagnosticMessage);
        if (isEmptyAgentChatResponse(response)) {
          await send({
            type: "done",
            ok: false,
            message: emptyResponseDiagnosticMessage ?? emptyAgentChatResponseMessage
          });
          return;
        }

        const action = readMissionControlAction(response.meta);

        if (action?.type === "rename_agent") {
          await updateAgent({
            id: agentId,
            name: action.name
          });
        }

        clearMissionControlCaches();

        await send({
          type: "done",
          ok: true,
          message: response.summary,
          response: applyMissionControlActionMetadata(response, action)
        });
      } catch (error) {
        stopPolling();

        if (request.signal.aborted) {
          return;
        }

        const rawFailure = redactSecretText(stringifyCommandFailure(error) || redactErrorMessage(error, ""));
        const agentRegistryFailureMessage = resolveGatewayAgentRegistryFailureMessage(rawFailure, agentId);
        const failureMessage =
          resolveOpenClawRuntimeFailureMessage(rawFailure, { modelId: activeAgentModelId }) ||
          agentRegistryFailureMessage ||
          resolveAgentChatRuntimeFailureMessage(rawFailure) ||
          (error instanceof Error
            ? redactSecretText(error.message)
            : "OpenClaw could not send the message right now. Please try again.");

        if (agentRegistryFailureMessage) {
          clearMissionControlCaches();
        }

        if (isOpenAiCodexAuthFailure(rawFailure) || isOpenAiCodexAuthFailure(failureMessage)) {
          await persistRuntimeSmokeTest({
            status: "failed",
            checkedAt: new Date().toISOString(),
            agentId,
            runId: null,
            summary: null,
            error: failureMessage
          }).catch(() => {});
          clearMissionControlCaches();
        }

        await send({
          type: "done",
          ok: false,
          message: failureMessage
        });
      } finally {
        stopPolling();
        request.signal.removeEventListener("abort", handleAbort);
        await closeWriter();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          redactErrorMessage(error, "OpenClaw could not send the message right now. Please try again.")
      },
      { status: 400 }
    );
  }
}

function isComposedAgentChatPrompt(value: string) {
  return (
    value.includes("Workspace team roster:") ||
    value.includes("## Telegram coordination") ||
    value.includes("## Discord coordination") ||
    value.includes("You are chatting directly with the operator inside AgentOS.")
  );
}

async function readAgentChatHistoryMessages(agentId: string, sessionId: string): Promise<RehydratedAgentChatMessage[]> {
  try {
    const history = await getOpenClawAdapter().getSessionHistory(
      {
        agentId,
        sessionId,
        limit: 60
      },
      { timeoutMs: 1500 }
    );

    return extractAgentChatMessagesFromSessionHistory(history).map((message, index) => ({
      id: message.id ? `openclaw-history:${sessionId}:${message.id}` : `openclaw-history:${sessionId}:${index}`,
      role: message.role,
      text: message.text,
      createdAt: normalizeAgentChatMessageTimestamp(message.timestamp, index),
      status: "sent" as const,
      runId: null
    }));
  } catch {
    return [];
  }
}

function dedupeRehydratedAgentChatMessages(messages: RehydratedAgentChatMessage[]) {
  const byKey = new Map<string, RehydratedAgentChatMessage>();

  for (const message of messages) {
    const text = message.text.replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }

    const key = `${message.role}:${text.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || message.createdAt > existing.createdAt) {
      byKey.set(key, {
        ...message,
        text
      });
    }
  }

  return [...byKey.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function normalizeAgentChatMessageTimestamp(value: string | number | null, index: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now() + index;
}

function resolveReadyDefaultAgentModelId(snapshot: ControlPlaneSnapshot) {
  if (!snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return null;
  }

  return (
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel?.trim() ||
    snapshot.diagnostics.modelReadiness.defaultModel?.trim() ||
    null
  );
}

function resolveChatStatusMessage(turn: TranscriptTurn) {
  if (turn.status === "completed") {
    return "Agent composed a reply.";
  }

  if (turn.status === "stalled") {
    return "Agent hit a snag while composing the reply.";
  }

  if (turn.status === "cancelled") {
    return "Agent reply was cancelled.";
  }

  if (turn.finalText && turn.finalText.trim().length > 0) {
    return "Agent is finalizing the reply...";
  }

  return "Agent is thinking...";
}

function sanitizePolledAssistantText(value: string) {
  return sanitizeAgentChatVisibleText(value);
}

function toAgentChatResponse(agentId: string, payload: AgentChatCommandPayload): MissionResponse {
  const resultPayload = resolveAgentChatResultPayload(payload);
  let action: MissionControlAction | null = null;
  const payloads = Array.isArray(resultPayload.payloads)
    ? resultPayload.payloads
        .map((entry) => {
          const extracted = extractMissionControlAction(sanitizeAgentChatReplyText(resolveAgentChatEntryText(entry)));

          if (!action && extracted.action) {
            action = extracted.action;
          }

          return {
            text: extracted.cleanText,
            mediaUrl: typeof entry.mediaUrl === "string" || entry.mediaUrl === null ? entry.mediaUrl : null
          };
        })
        .filter((entry) => entry.text.length > 0)
    : [];
  const extractedSummary = extractMissionControlAction(
    sanitizeAgentChatReplyText(typeof payload.summary === "string" ? payload.summary : resultPayload.summary)
  );

  if (!action && extractedSummary.action) {
    action = extractedSummary.action;
  }

  const hasResponseText = Boolean(
    extractedSummary.cleanText ||
      payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
      (action?.type === "rename_agent" ? action.name : "")
  );
  const summary =
    extractedSummary.cleanText ||
    payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
    (action?.type === "rename_agent" ? `Renamed agent to ${action.name}.` : "") ||
    emptyAgentChatResponseMessage;
  const status = normalizeStatus(resolveAgentChatStatus(payload, resultPayload));
  const meta = action
    ? {
        ...resultPayload.meta,
        missionControlAction: action
      }
    : resultPayload.meta;

  return {
    runId: typeof payload.runId === "string" && payload.runId.trim() ? payload.runId : null,
    agentId,
    status: hasResponseText ? status : "stalled",
    summary,
    payloads,
    meta: hasResponseText ? meta : { ...meta, emptyAgentChatResponse: true, emptyAgentChatStatus: status }
  };
}

function isEmptyAgentChatResponse(response: MissionResponse) {
  return response.meta?.emptyAgentChatResponse === true;
}

function recoverCompletedEmptyAgentChatResponse(
  response: MissionResponse,
  diagnosticMessage?: string | null
): MissionResponse {
  if (!isCompletedEmptyAgentChatResponse(response)) {
    return response;
  }

  const message = diagnosticMessage ?? completedEmptyAgentChatResponseMessage;

  return {
    ...response,
    status: "completed",
    summary: message,
    payloads: [
      {
        text: message,
        mediaUrl: null
      }
    ],
    meta: {
      ...response.meta,
      emptyAgentChatResponse: false,
      emptyAgentChatCompletedWithoutText: true
    }
  };
}

function resolveEmptyAgentChatDiagnosticMessage(
  payload: AgentChatCommandPayload,
  options: {
    modelId?: string | null;
  } = {}
) {
  const diagnosticText = extractAgentChatEmptyResponseDiagnosticText(payload);

  if (!diagnosticText) {
    return null;
  }

  return (
    resolveOpenClawRuntimeFailureMessage(diagnosticText, options) ||
    resolveAgentChatRuntimeFailureMessage(diagnosticText) ||
    `OpenClaw completed the chat turn without assistant text, but exposed this diagnostic: ${diagnosticText}`
  );
}

function recoverDirectIdentityResponse(response: MissionResponse, agentName: string, operatorMessage: string): MissionResponse {
  if (!isDirectAgentIdentityQuestion(operatorMessage)) {
    return response;
  }

  const responseText = [response.summary, ...response.payloads.map((entry) => entry.text)].join("\n\n");
  if (!isStaleAgentChatContextRecoveryText(responseText)) {
    return response;
  }

  const text = buildDirectAgentIdentityReply(agentName);

  return {
    ...response,
    summary: text,
    payloads: [
      {
        text,
        mediaUrl: null
      }
    ]
  };
}

function normalizeStatus(value: string): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" || value === "cancelled"
    ? value
    : "completed";
}

function resolveAgentChatResultPayload(payload: AgentChatCommandPayload): AgentChatPayloadResult {
  return isRecord(payload.result) ? payload.result : payload;
}

function resolveAgentChatEntryText(entry: AgentChatPayloadEntry) {
  if (typeof entry.text === "string") {
    return entry.text;
  }

  if (typeof entry.content === "string") {
    return entry.content;
  }

  return "";
}

function resolveAgentChatStatus(payload: AgentChatCommandPayload, resultPayload: AgentChatPayloadResult) {
  if (typeof payload.status === "string") {
    return payload.status;
  }

  if (resultPayload.stopReason === "aborted") {
    return "cancelled";
  }

  if (resultPayload.stopReason === "error") {
    return "stalled";
  }

  return "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMissionControlAction(meta: MissionResponse["meta"]): MissionControlAction | null {
  const candidate = meta?.missionControlAction;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const action = candidate as Record<string, unknown>;

  if (action.type !== "rename_agent" || typeof action.name !== "string" || action.name.trim().length === 0) {
    return null;
  }

  return {
    type: "rename_agent",
    name: action.name.trim()
  };
}

function applyMissionControlActionMetadata(response: MissionResponse, action: MissionControlAction | null): MissionResponse {
  if (!action) {
    return response;
  }

  return {
    ...response,
    summary: response.summary.trim() || `Renamed agent to ${action.name}.`,
    meta: {
      ...response.meta,
      missionControlAction: {
        ...action,
        applied: true
      }
    }
  };
}

function attachStreamMissionControlAction(
  response: MissionResponse,
  action: MissionControlAction | null
): MissionResponse {
  if (!action || readMissionControlAction(response.meta)) {
    return response;
  }

  return {
    ...response,
    meta: {
      ...response.meta,
      missionControlAction: action
    }
  };
}

function resolveGatewayAgentRegistryFailureMessage(output: string, agentId: string) {
  if (!isGatewayAgentRegistryMissingFailure(output, agentId)) {
    return null;
  }

  return `OpenClaw Gateway has not loaded agent "${agentId}" yet. AgentOS refreshed local state; restart the OpenClaw Gateway from System Setup or Settings, then retry chat.`;
}

function isGatewayAgentRegistryMissingFailure(output: string, agentId: string) {
  const normalized = output.replace(/\s+/g, " ").trim();

  if (!normalized || !/\bagent\b/i.test(normalized) || !/\bnot found\b/i.test(normalized)) {
    return false;
  }

  const escapedAgentId = escapeRegExp(agentId);
  return new RegExp(`\\bagent\\s+["'\`]?${escapedAgentId}["'\`]?\\s+not\\s+found\\b`, "i").test(normalized);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
