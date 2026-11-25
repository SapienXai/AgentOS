import { NextResponse } from "next/server";
import { z } from "zod";

import { clearMissionControlCaches, getMissionControlSnapshot, updateAgent } from "@/lib/agentos/control-plane";
import {
  emptyAgentChatResponseMessage,
  extractAgentChatEmptyResponseDiagnosticText,
  extractAssistantTextFromAgentChatStreamLine,
  extractAgentChatMessagesFromSessionHistory,
  recoverStreamedAgentChatResponse,
  resolveAgentChatContextFailureMessage,
  resolveAgentChatRuntimeFailureMessage,
  sanitizeAgentChatReplyText,
  sanitizeAgentChatVisibleText
} from "@/lib/openclaw/agent-chat-response";
import { extractMissionControlAction, type MissionControlAction } from "@/lib/openclaw/chat-actions";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { isOpenClawAgentModelReady, readKnownAgentChatModelIssue } from "@/lib/openclaw/application/model-provider-state-service";
import { isOpenAiBackedModel } from "@/lib/openclaw/domains/model-provider-connection";
import {
  buildDirectAgentChatSessionKey,
  directAgentChatSubmissionId,
  readDirectAgentChatSubmissionId
} from "@/lib/openclaw/domains/agent-chat-sessions";
import { persistRuntimeSmokeTest } from "@/lib/openclaw/domains/control-plane-settings";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { isOpenAiAuthFailure } from "@/lib/openclaw/model-auth-errors";
import { resolveOpenClawRuntimeFailureMessage } from "@/lib/openclaw/runtime-compatibility";
import { resolveOpenClawModelReadinessIssue } from "@/lib/openclaw/readiness";
import type { StatusPayload } from "@/lib/openclaw/client/types";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { canAgentOsActorUseProductPermission, requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import type { MissionDispatchStatus, MissionResponse } from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const conversationSchema = z.string().uuid().transform((value) => value.toLowerCase()).optional();

const chatSchema = z.object({
  conversationId: conversationSchema,
  message: z.string().trim().min(1),
  rawMessage: z.string().trim().min(1).optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional(),
  idempotencyKey: z.string().trim().min(1).max(180).optional()
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
  sessionKey?: string | null;
  sessionId?: string | null;
  runStarted?: boolean;
  messageSeq?: number | null;
  idempotencyKey?: string | null;
  status?: string;
  summary?: string;
  payloads?: AgentChatPayloadEntry[];
  meta?: Record<string, unknown>;
  stopReason?: string | null;
  result?: AgentChatPayloadResult;
};

type AgentChatStreamEvent =
  | {
      type: "admitted";
      runId: string;
    }
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
  submissionId?: string | null;
  messageSeq?: number | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const agent = await readDirectChatAgent(agentId, request.signal);

    if (!agent) {
      return NextResponse.json({ error: "Agent could not be found." }, { status: 404 });
    }

    const url = new URL(request.url);
    const headers = { "Cache-Control": "private, no-store" };
    if (url.searchParams.get("conversations") === "1") {
      const prefix = `${buildDirectAgentChatSessionKey(agent, permission.actor.actorId)}:`;
      const { sessions } = await getOpenClawAdapter().listSessions(
        { search: prefix, agentId, limit: 50 },
        { timeoutMs: 5_000, signal: request.signal, allowCliFallback: false }
      );
      const conversations = sessions.flatMap(({ key, updatedAt }) => {
        if (!key?.startsWith(prefix)) return [];
        const id = conversationSchema.safeParse(key.slice(prefix.length));
        return id.success && id.data ? [{ id: id.data, updatedAt: updatedAt ?? null }] : [];
      });
      return NextResponse.json({ conversations }, { headers });
    }
    const conversation = conversationSchema.safeParse(url.searchParams.get("conversation") ?? undefined);
    if (!conversation.success) {
      return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
    }
    const sessionKey = buildDirectAgentChatSessionKey(agent, permission.actor.actorId, conversation.data);
    if (url.searchParams.get("watch") === "1") {
      return streamAgentChatInvalidations(request, sessionKey);
    }
    const history = await getOpenClawAdapter().getSessionHistory(
      { sessionKey, limit: 120 },
      { timeoutMs: 5_000, signal: request.signal, allowCliFallback: false }
    );
    const sessionId = history.sessionId ?? null;
    const messages: RehydratedAgentChatMessage[] = extractAgentChatMessagesFromSessionHistory(history)
      .map((message, index) => ({
        id: `openclaw-history:${sessionId ?? sessionKey}:${message.id}`,
        role: message.role,
        text: message.text,
        createdAt: normalizeAgentChatMessageTimestamp(message.timestamp, index),
        status: "sent",
        submissionId: readDirectAgentChatSubmissionId(sessionKey, message.idempotencyKey),
        messageSeq: message.messageSeq
      }));
    return NextResponse.json(redactSecrets({
      agentId,
      sessionId,
      source: "openclaw-session",
      messages
    }), { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "OpenClaw chat history is unavailable.")
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const routeParams = await Promise.resolve(context.params);
  const agentId = routeParams.agentId.trim();

  if (!agentId) {
    return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
  }

  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const input = chatSchema.parse(await request.json());
    const agent = await readDirectChatAgent(agentId, request.signal);
    if (!agent) {
      return NextResponse.json({ error: "Agent could not be found." }, { status: 404 });
    }

    const sessionKey = buildDirectAgentChatSessionKey(agent, permission.actor.actorId, input.conversationId);
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "agent.chat",
      method: "chat.send",
      params: { sessionKey },
      targetKind: "agent-session",
      targetId: agentId,
      securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "runtime.use"
    });
    if ("response" in authorization) return authorization.response;
    if (authorization.actor.actorId !== permission.actor.actorId) {
      return NextResponse.json({ error: "The active operator changed. Reopen the conversation." }, { status: 403 });
    }

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
      let streamStdoutBuffer = "";
      const activeAgentModelId = agent.modelId;

      const emitAssistantText = async (value: string | null | undefined) => {
        const sanitizedText = sanitizeAgentChatReplyText(value);
        const currentText = sanitizeAgentChatVisibleText(sanitizedText);

        if (!currentText || currentText === latestAssistantText) {
          return;
        }

        latestAssistantText = currentText;
        await send({
          type: "assistant",
          text: currentText
        });
      };

      const handleCommandStdout = async (chunk: string) => {
        streamStdoutBuffer += chunk;
        const lines = streamStdoutBuffer.split(/\r?\n/);
        streamStdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(line));
        }
      };

      try {
        await send({
          type: "status",
          message: "Starting agent turn..."
        });

        const operatorMessage = input.rawMessage ?? input.message;
        const directRename = extractDirectAgentRenameName(operatorMessage);
        const canManageAgents = canAgentOsActorUseProductPermission(authorization.actor, "agents.manage");
        if (directRename && canManageAgents) {
          const renameAuthorization = await requireAgentOsOpenClawPreflight(request, {
            operation: "agent.rename-from-chat",
            method: "agents.update",
            params: { agentId },
            targetKind: "agent",
            targetId: agentId,
            securityClass: "privileged-mutation",
            executionPath: "gateway-native",
            productPermission: "agents.manage"
          });
          if ("response" in renameAuthorization || renameAuthorization.actor.actorId !== authorization.actor.actorId) {
            await send({ type: "done", ok: false, message: "OpenClaw authorization is required to rename this agent." });
            return;
          }
          await updateAgent({
            id: agentId,
            name: directRename
          }, { ...renameAuthorization.commandOptions, allowCliFallback: false });
          clearMissionControlCaches();

          const response = applyMissionControlActionMetadata(
            {
              runId: null,
              agentId,
              status: "completed",
              summary: `Renamed agent to ${directRename}.`,
              payloads: [
                {
                  text: `Renamed agent to ${directRename}.`,
                  mediaUrl: null
                }
              ],
              meta: {
                missionControlAction: {
                  type: "rename_agent",
                  name: directRename
                }
              }
            },
            {
              type: "rename_agent",
              name: directRename
            }
          );

          await send({
            type: "done",
            ok: true,
            message: response.summary,
            response
          });
          return;
        }

        if (!activeAgentModelId || isOpenAiBackedModel(activeAgentModelId)) {
          const readiness = await getMissionControlSnapshot({ includeHidden: true });
          const modelReadinessError = resolveOpenClawModelReadinessIssue(readiness, activeAgentModelId);
          const agentModelReady = modelReadinessError && activeAgentModelId
            ? await isOpenClawAgentModelReady({ agentId, modelId: activeAgentModelId })
            : false;
          if (modelReadinessError && !agentModelReady) {
            await send({
              type: "done",
              ok: false,
              message: `${modelReadinessError} Connect a provider and choose a default model before starting a chat.`
            });
            return;
          }
        }
        if (activeAgentModelId?.includes("gpt-6.2-sol")) {
          const gatewayInfo = await getOpenClawAdapter().getGatewaySurfacePort?.()
            .probeNativeGateway<StatusPayload>("status", {}, { timeoutMs: 5_000, signal: request.signal });
          const compatibilityIssue = await readKnownAgentChatModelIssue({
            agentId,
            modelId: activeAgentModelId,
            gatewayVersion: gatewayInfo?.runtimeVersion ?? gatewayInfo?.version
          });
          if (compatibilityIssue) {
            await send({ type: "done", ok: false, message: compatibilityIssue });
            return;
          }
        }

        request.signal.throwIfAborted();
        const result: AgentChatCommandPayload = await getOpenClawAdapter().streamAgentTurn(
          {
            agentId,
            sessionKey,
            message: operatorMessage,
            thinking: input.thinking,
            timeoutSeconds: 90,
            idempotencyKey: input.idempotencyKey
              ? directAgentChatSubmissionId(sessionKey, input.idempotencyKey)
              : undefined
          },
          {
            onStdout: handleCommandStdout,
            onAdmission: (runId) => { void send({ type: "admitted", runId }); },
            onToolStart: (name) => {
              const tool = name.trim().replace(/[_-]+/g, " ").slice(0, 80);
              void send({ type: "status", message: tool ? `Agent is using ${tool}…` : "Agent is using a tool…" });
            }
          },
          {
            timeoutMs: 120_000,
            ...authorization.commandOptions,
            allowCliFallback: false
          }
        );
        if (streamStdoutBuffer.trim()) {
          await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(streamStdoutBuffer));
        }
        if (result.status === "cancelled" || result.stopReason === "aborted") {
          await send({ type: "done", ok: false, message: "OpenClaw stopped this reply." });
          return;
        }

        let response = toAgentChatResponse(agentId, result);
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
        response = recoverStreamedAgentChatResponse(response, latestAssistantText);
        const emptyResponseDiagnosticMessage = resolveEmptyAgentChatDiagnosticMessage(result, {
          modelId: activeAgentModelId
        });
        const contextFailure = [
          response.summary,
          ...response.payloads.map(({ text }) => text),
          emptyResponseDiagnosticMessage ?? ""
        ]
          .map(resolveAgentChatContextFailureMessage)
          .find(Boolean);
        if (contextFailure) {
          await send({ type: "done", ok: false, message: contextFailure });
          return;
        }

        response = recoverSilentOpenAiChatFailure(response, activeAgentModelId);
        if (isEmptyAgentChatResponse(response) || response.status !== "completed") {
          await send({
            type: "done",
            ok: false,
            message: emptyResponseDiagnosticMessage || response.summary || emptyAgentChatResponseMessage
          });
          return;
        }

        await send({
          type: "done",
          ok: true,
          message: response.summary,
          response
        });
      } catch (error) {
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

        if (isOpenAiAuthFailure(rawFailure) || isOpenAiAuthFailure(failureMessage)) {
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
    const invalidInput = error instanceof z.ZodError || error instanceof SyntaxError;
    return NextResponse.json(
      {
        error:
          redactErrorMessage(error, "OpenClaw could not send the message right now. Please try again.")
      },
      { status: invalidInput ? 400 : 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  const input = z.object({
    conversationId: conversationSchema,
    runId: z.string().trim().min(1).max(240)
  }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "A valid chat run is required." }, { status: 400 });

  const { agentId } = await context.params;
  try {
    const agent = await readDirectChatAgent(agentId, request.signal);
    if (!agent) return NextResponse.json({ error: "Agent could not be found." }, { status: 404 });
    const sessionKey = buildDirectAgentChatSessionKey(agent, permission.actor.actorId, input.data.conversationId);
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "agent.chat.stop",
      method: "sessions.abort",
      params: { key: sessionKey, runId: input.data.runId },
      targetKind: "agent-session",
      targetId: agentId,
      securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "runtime.use"
    });
    if ("response" in authorization) return authorization.response;
    if (authorization.actor.actorId !== permission.actor.actorId) {
      return NextResponse.json({ error: "The active operator changed. Reopen the conversation." }, { status: 403 });
    }
    const result = await getOpenClawAdapter().abortAgentTurn(
      { sessionKey, agentId, runId: input.data.runId },
      { ...authorization.commandOptions, allowCliFallback: false }
    );
    return NextResponse.json({ aborted: result.status === "aborted" }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "OpenClaw could not stop this reply.")
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

async function readDirectChatAgent(agentId: string, signal: AbortSignal) {
  const adapter = getOpenClawAdapter();
  if (!adapter.getGatewaySurfacePort?.().canProbeNativeGateway()) {
    throw new Error("Direct chat requires a native OpenClaw Gateway.");
  }
  const { agents } = await adapter.listAgents({
    signal,
    timeoutMs: 5_000,
    allowCliFallback: false
  });
  const agent = agents.find(({ id }) => id === agentId);
  if (!agent) return null;
  const workspace = agent.workspace?.trim();
  if (!workspace) throw new Error("OpenClaw did not expose the agent's workspace for direct chat.");
  return { id: agent.id, workspaceId: workspace, modelId: agent.model?.primary ?? null };
}

function streamAgentChatInvalidations(request: Request, sessionKey: string) {
  const encoder = new TextEncoder();
  const lifetime = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]);
  let close: ((cancelled?: boolean) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let subscription: { close: () => void } | undefined;
      let closed = false;
      const invalidate = () => {
        if (!closed && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode("event: history\ndata: {}\n\n"));
        }
      };
      close = (cancelled = false) => {
        if (closed) return;
        closed = true;
        lifetime.removeEventListener("abort", onAbort);
        subscription?.close();
        if (!cancelled) controller.close();
      };
      const onAbort = () => close?.();
      if (lifetime.aborted) {
        close();
        return;
      }
      lifetime.addEventListener("abort", onAbort, { once: true });
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      try {
        subscription = await getOpenClawAdapter().subscribeNativeRuntimeEvents?.(
          { includeSessions: false, sessionKeys: [sessionKey] },
          {
            onEvent: ({ event, payload }) => {
              if ((event === "session.message" || event === "sessions.changed" || event === "chat") &&
                isRecord(payload) && (payload.sessionKey === sessionKey || payload.key === sessionKey)) {
                invalidate();
              }
            },
            onGap: invalidate,
            onReconnected: invalidate
          },
          { signal: lifetime, timeoutMs: 5_000, allowCliFallback: false }
        );
        if (!subscription) {
          close();
        } else if (closed) {
          subscription.close();
        } else {
          invalidate();
        }
      } catch {
        close();
      }
    },
    cancel() {
      close?.(true);
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
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

  return index;
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

function extractDirectAgentRenameName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:rename (?:yourself|you|this agent|agent) to|set (?:your )?(?:display )?name to|call yourself)\s+(.{1,80})$/i,
    /(?:ad(?:ı|i)n|ism(?:i|ı)n)\s+(.{1,80}?)(?:\s+olsun)?[.!?]*$/i,
    /(?:ad(?:ı|i)n(?:ı|i)|ism(?:i|ı)n(?:i|ı))\s+(.{1,80}?)\s+(?:yap|koy|de(?:g|ğ)i(?:s|ş)tir)[.!?]*$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const name = normalizeDirectAgentRenameName(match?.[1]);

    if (name) {
      return name;
    }
  }

  return null;
}

function normalizeDirectAgentRenameName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const stripped = value
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_#"“”‘’'.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped || stripped.length > 48 || /\b(?:ne|what|who|kim|neden|why)\b/i.test(stripped)) {
    return null;
  }

  return stripped;
}

function recoverSilentOpenAiChatFailure(response: MissionResponse, modelId?: string | null): MissionResponse {
  if (!modelId || !isOpenAiBackedModel(modelId) || response.status !== "stalled") {
    return response;
  }

  const responseText = [response.summary, ...response.payloads.map((entry) => entry.text)].join("\n\n");
  if (!/OpenClaw Gateway reported the chat stream failed before assistant text was available\./i.test(responseText)) {
    return response;
  }

  const message = [
    "OpenClaw reported the OpenAI chat stream failed before assistant text was available, but did not expose the provider error.",
    "Reconnect the OpenAI provider, then retry this message.",
    "If it repeats after reconnecting, inspect `openclaw logs --follow`."
  ].join(" ");

  return {
    ...response,
    summary: message,
    payloads: [
      {
        text: message,
        mediaUrl: null
      }
    ]
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
