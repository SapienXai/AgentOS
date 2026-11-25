"use client";

import {
  dispatchAgentChatStateChange,
  maxAgentChatMessages,
  readAgentChatMessages,
  type AgentChatMessage,
  writeAgentChatMessages
} from "@/components/mission-control/agent-chat-storage";
import { consumeNdjsonStream } from "@/lib/ndjson";
import { sanitizeAgentChatVisibleText } from "@/lib/openclaw/agent-chat-response";
import type { DirectChatAttachment } from "@/lib/openclaw/chat-attachments";
import type { MissionControlSnapshot, MissionResponse } from "@/lib/agentos/contracts";

type AgentChatStreamEvent =
  | { type: "cancelled" }
  | { type: "settled" }
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

type ActiveAgentChatRun = {
  userMessageId: string;
  assistantMessageId: string;
  runId: string | null;
  statusMessage: string | null;
  statusHistory: string[];
  stopReceipt?: Promise<boolean>;
};

export type AgentChatRunSnapshot = {
  isRunning: boolean;
  runs: ActiveAgentChatRun[];
};

export type SendAgentChatMessageOptions = {
  agentId: string;
  conversationId?: string;
  queueMode?: "steer";
  attachments?: DirectChatAttachment[];
  text: string;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onError?: (message: string, confirmed: boolean) => void;
};

const activeAgentChatRuns = new Map<string, Set<ActiveAgentChatRun>>();
const agentChatWaitHeartbeatMs = [15_000, 45_000, 90_000];

export function getAgentChatRunSnapshot(chatKey: string): AgentChatRunSnapshot {
  const runs = Array.from(activeAgentChatRuns.get(chatKey) ?? [], (run) => ({ ...run }));
  return { isRunning: runs.length > 0, runs };
}

export function agentChatConversationKey(agentId: string, conversationId?: string) {
  return conversationId ? `${agentId}:${conversationId}` : agentId;
}

export function observeAgentChatStop(chatKey: string, runId: string, request: () => Promise<boolean>) {
  const run = Array.from(activeAgentChatRuns.get(chatKey) ?? []).find((entry) => entry.runId === runId);
  const receipt = request();
  if (run) run.stopReceipt = receipt.catch(() => false);
  return receipt;
}

export function sendAgentChatMessage({
  agentId,
  conversationId,
  queueMode,
  attachments,
  text,
  onRefresh,
  onSnapshotChange,
  onError
}: SendAgentChatMessageOptions) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return Promise.resolve();
  }

  const chatKey = agentChatConversationKey(agentId, conversationId);
  const createdAt = Date.now();
  const userMessageId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const assistantMessageId = `${userMessageId}:reply`;
  const existingMessages = readAgentChatMessages(chatKey);

  const userMessage: AgentChatMessage = {
    id: userMessageId,
    role: "user",
    text: trimmedText,
    createdAt,
    status: "sending",
    submissionId: userMessageId
  };

  const assistantMessage: AgentChatMessage = {
    id: assistantMessageId,
    role: "assistant",
    text: "",
    createdAt: createdAt + 1,
    status: "sending",
    submissionId: userMessageId
  };

  const run: ActiveAgentChatRun = {
    userMessageId,
    assistantMessageId,
    runId: null,
    statusMessage: "Starting agent turn...",
    statusHistory: ["Starting agent turn..."]
  };

  const runs = activeAgentChatRuns.get(chatKey) ?? new Set<ActiveAgentChatRun>();
  runs.add(run);
  activeAgentChatRuns.set(chatKey, runs);
  writeAgentChatMessages(chatKey, [...existingMessages, userMessage, assistantMessage].slice(-maxAgentChatMessages));

  const payload = {
    conversationId,
    queueMode,
    attachments,
    message: trimmedText,
    rawMessage: trimmedText,
    idempotencyKey: userMessageId
  };

  return runAgentChatTurn({
    agentId,
    chatKey,
    payload,
    userMessageId,
    assistantMessageId,
    run,
    onRefresh,
    onSnapshotChange,
    onError
  });
}

async function runAgentChatTurn({
  agentId,
  chatKey,
  payload,
  userMessageId,
  assistantMessageId,
  run,
  onRefresh,
  onSnapshotChange,
  onError
}: {
  agentId: string;
  chatKey: string;
  payload: {
    conversationId?: string;
    queueMode?: "steer";
    attachments?: DirectChatAttachment[];
    message: string;
    rawMessage: string;
    idempotencyKey: string;
    thinking?: "off" | "minimal" | "low" | "medium" | "high";
  };
  userMessageId: string;
  assistantMessageId: string;
  run: ActiveAgentChatRun;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onError?: SendAgentChatMessageOptions["onError"];
}) {
  let latestAssistantText = "";
  let assistantTextReceived = false;
  let rejectionConfirmed = false;
  const settle = () => {
    updateAgentChatMessages(chatKey, (current) => current.flatMap((entry) => {
      if (entry.id === userMessageId) return [{ ...entry, status: "sent", runId: run.runId }];
      if (entry.id !== assistantMessageId) return [entry];
      return entry.text.trim() ? [{ ...entry, status: "sent" }] : [];
    }));
  };
  const startedAt = Date.now();
  let heartbeatIndex = 0;
  const heartbeatTimer = globalThis.setInterval(() => {
    const threshold = agentChatWaitHeartbeatMs[heartbeatIndex];

    if (!threshold || Date.now() - startedAt < threshold) {
      return;
    }

    heartbeatIndex += 1;
    updateAgentChatStatus(chatKey, run, resolveAgentChatWaitStatusMessage(threshold, assistantTextReceived));
  }, 1000);

  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/x-ndjson")) {
      rejectionConfirmed = response.status >= 400 && response.status < 500 && response.status !== 408;
      const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errorPayload?.error || "OpenClaw rejected the message.");
    }

    let finalResponse: MissionResponse | null = null;
    let settled = false;

    await consumeNdjsonStream<AgentChatStreamEvent>(response, async (event) => {
      if (event.type === "cancelled" || event.type === "settled") {
        settled = true;
        settle();
        return;
      }
      if (event.type === "admitted") {
        run.runId = event.runId;
        updateAgentChatStatus(chatKey, run, "Accepted by OpenClaw…");
        return;
      }
      if (event.type === "status") {
        updateAgentChatStatus(chatKey, run, event.message);
        return;
      }

      if (event.type === "assistant") {
        const eventText = sanitizeAgentChatVisibleText(event.text);
        if (!eventText) {
          updateAgentChatStatus(chatKey, run, "Agent is thinking...");
          return;
        }

        assistantTextReceived = true;
        latestAssistantText = eventText;
        updateAgentChatStatus(chatKey, run, "Agent is drafting a reply...");

        updateAgentChatMessages(chatKey, (current) =>
          current.map((entry) => {
            if (entry.id === userMessageId) {
              return entry;
            }

            if (entry.id === assistantMessageId) {
              return { ...entry, text: eventText, status: "sending" as const };
            }

            return entry;
          })
        );

        return;
      }

      if (!event.ok) {
        rejectionConfirmed = true;
        throw new Error(event.message);
      }

      finalResponse = event.response ?? null;
      const finalText = finalResponse ? renderAgentReplyText(finalResponse) : latestAssistantText;

      if (finalResponse) {
        latestAssistantText = finalText;
      }
      const renamedTo = finalResponse ? readRenamedAgent(finalResponse.meta) : null;
      const localAction = Boolean(renamedTo && !finalResponse?.runId);

      updateAgentChatMessages(chatKey, (current) =>
        current.map((entry) => {
          if (entry.id === userMessageId) {
            const admission = readOpenClawAdmission(finalResponse?.meta);
            return {
              ...entry,
              localAction,
              status: "sent" as const,
              messageSeq: admission?.messageSeq ?? entry.messageSeq
            };
          }

          if (entry.id === assistantMessageId) {
            return {
              ...entry,
              localAction,
              text: finalText,
              status: "sent" as const,
              runId: finalResponse?.runId ?? entry.runId
            };
          }

          return entry;
        })
      );

      if (renamedTo && onSnapshotChange) {
        onSnapshotChange((current) => applyAgentRename(current, agentId, renamedTo));
      }

      if (renamedTo) void onRefresh?.().catch(() => null);
    });

    if (!finalResponse && !settled) {
      throw new Error("OpenClaw completed without returning a response.");
    }
  } catch (error) {
    // The Gateway can emit an error while the exact run's stop is in flight.
    if (run.stopReceipt && await run.stopReceipt) {
      settle();
      return;
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown send error.";
    const message = rejectionConfirmed ? errorMessage : run.runId
      ? "OpenClaw accepted this message. Its reply could not be confirmed. Check the conversation history."
      : "Delivery could not be confirmed. Check the conversation history before sending again.";
    const partialText = assistantTextReceived ? latestAssistantText.trim() : "";

    updateAgentChatMessages(chatKey, (current) =>
      current
        .map((entry) => {
          if (entry.id === userMessageId) {
            return run.runId
              ? { ...entry, status: "sent" as const, runId: run.runId }
              : { ...entry, status: "error" as const, errorMessage: message };
          }

          if (entry.id === assistantMessageId) {
            if (partialText.length > 0) {
              return { ...entry, text: partialText, status: "error" as const, errorMessage: message };
            }

            return entry;
          }

          return entry;
        })
        .filter((entry) => entry.id !== assistantMessageId || partialText.length > 0)
    );

    onError?.(message, rejectionConfirmed);
  } finally {
    globalThis.clearInterval(heartbeatTimer);
    const runs = activeAgentChatRuns.get(chatKey);
    runs?.delete(run);
    if (!runs?.size) activeAgentChatRuns.delete(chatKey);
    dispatchAgentChatStateChange(chatKey);
  }
}

function updateAgentChatMessages(
  agentId: string,
  updater: (current: AgentChatMessage[]) => AgentChatMessage[]
) {
  writeAgentChatMessages(agentId, updater(readAgentChatMessages(agentId)).slice(-maxAgentChatMessages));
}

const maxAgentChatStatusHistory = 5;

function updateAgentChatStatus(agentId: string, run: ActiveAgentChatRun, message: string) {
  const nextMessage = typeof message === "string" ? message.trim() : "";

  if (!nextMessage || nextMessage === run.statusMessage) {
    return;
  }

  run.statusMessage = nextMessage;
  run.statusHistory = [...run.statusHistory.filter((entry) => entry !== nextMessage), nextMessage].slice(
    -maxAgentChatStatusHistory
  );
  dispatchAgentChatStateChange(agentId);
}

function renderAgentReplyText(result: MissionResponse) {
  const payloadText = result.payloads
    .map((entry) => sanitizeAgentChatVisibleText(entry.text))
    .filter(Boolean)
    .join("\n\n");
  return payloadText || sanitizeAgentChatVisibleText(result.summary);
}

function resolveAgentChatWaitStatusMessage(thresholdMs: number, assistantTextReceived: boolean) {
  if (assistantTextReceived) {
    return "Reply text arrived; waiting for OpenClaw final confirmation...";
  }

  if (thresholdMs >= 90_000) {
    return "Still waiting for OpenClaw final confirmation. The agent may be doing work before a reply is available.";
  }

  if (thresholdMs >= 45_000) {
    return "OpenClaw is still working. AgentOS has not received reply text yet.";
  }

  return "Still waiting for OpenClaw to start the reply...";
}

function readRenamedAgent(meta: MissionResponse["meta"]) {
  const candidate = meta?.missionControlAction;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const action = candidate as Record<string, unknown>;

  if (action.type !== "rename_agent" || action.applied !== true || typeof action.name !== "string") {
    return null;
  }

  const normalized = action.name.trim();
  return normalized.length > 0 ? normalized : null;
}

function readOpenClawAdmission(meta: MissionResponse["meta"]) {
  const candidate = meta?.openClawAdmission;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  return {
    messageSeq: typeof record.messageSeq === "number" ? record.messageSeq : null
  };
}

function applyAgentRename(snapshot: MissionControlSnapshot, agentId: string, name: string): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((entry) =>
      entry.id === agentId
        ? {
            ...entry,
            name,
            identityName: name
          }
        : entry
    ),
    tasks: snapshot.tasks.map((task) =>
      task.primaryAgentId === agentId
        ? {
            ...task,
            primaryAgentName: name
          }
        : task
    )
  };
}
