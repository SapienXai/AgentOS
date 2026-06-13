"use client";

import { useEffect, useRef, useState } from "react";

import { KeyRound, LoaderCircle, SendHorizontal } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  markAgentChatAsSeen,
  mergeAgentChatMessagesForRehydration,
  normalizeAgentChatMessagesForDisplay,
  readAgentChatMessages,
  writeAgentChatMessages,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";
import {
  getAgentChatRunSnapshot,
  sendAgentChatMessage,
  type AgentChatRunSnapshot
} from "@/components/mission-control/agent-chat-runner";
import {
  resolveAgentChatAuthAction,
  resolveAgentChatGatewayRepairAction,
  type AgentChatGatewayRepairAction
} from "@/lib/openclaw/chat-auth-actions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, AgentRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChatMessage = AgentChatMessage;

function TypingDots({ surfaceTheme }: { surfaceTheme: "dark" | "light" }) {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          animate={{ opacity: [0.35, 1, 0.35], y: [0, -1, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.14, ease: "easeInOut" }}
          className={cn("h-1.5 w-1.5 rounded-full", surfaceTheme === "light" ? "bg-[#8f7263]" : "bg-cyan-300")}
        />
      ))}
    </span>
  );
}

function AssistantBubbleHeader({
  agentLabel,
  statusLabel,
  surfaceTheme
}: {
  agentLabel: string;
  statusLabel: string | null;
  surfaceTheme: "dark" | "light";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 text-[9px] uppercase tracking-[0.24em]",
        surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400"
      )}
    >
      <span className="min-w-0 truncate">{agentLabel}</span>
      {statusLabel ? (
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <span>{statusLabel}</span>
          <TypingDots surfaceTheme={surfaceTheme} />
        </span>
      ) : null}
    </div>
  );
}

function AssistantThinkingActivity({
  statusMessage,
  expanded,
  onToggle,
  surfaceTheme
}: {
  statusMessage: string | null;
  expanded: boolean;
  onToggle: () => void;
  surfaceTheme: "dark" | "light";
}) {
  const previewLines = resolveAssistantThinkingPreview(statusMessage);
  const detailLines = resolveAssistantThinkingDetails(statusMessage);

  return (
    <div
      className={cn(
        "mt-2 overflow-hidden rounded-[14px] border px-3 py-2",
        surfaceTheme === "light"
          ? "border-[#e7d8cc] bg-[#fff7f1]/70"
          : "border-cyan-300/10 bg-slate-950/24"
      )}
    >
      <div className="space-y-1.5">
        {previewLines.map((line, index) => (
          <motion.div
            key={line}
            animate={{ opacity: [0.48, 0.92, 0.48] }}
            transition={{ duration: 1.8, repeat: Infinity, delay: index * 0.18, ease: "easeInOut" }}
            className={cn(
              "h-3.5 rounded-full",
              surfaceTheme === "light"
                ? "bg-[linear-gradient(90deg,rgba(139,114,98,0.16),rgba(139,114,98,0.34),rgba(139,114,98,0.14))]"
                : "bg-[linear-gradient(90deg,rgba(125,211,252,0.10),rgba(125,211,252,0.27),rgba(125,211,252,0.08))]",
              index === 0 ? "w-[72%]" : "w-[54%]"
            )}
          >
            <span
              className={cn(
                "block truncate px-2 text-[10px] leading-3.5",
                surfaceTheme === "light" ? "text-[#7d6556]/78" : "text-slate-300/72"
              )}
            >
              {line}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "text-[8px] uppercase tracking-[0.18em] transition hover:opacity-80",
            surfaceTheme === "light" ? "text-[#8b7262]" : "text-cyan-200/70"
          )}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {expanded ? (
        <motion.ul
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mt-2 space-y-1 border-t pt-2 text-[11px] leading-4",
            surfaceTheme === "light" ? "border-[#e7d8cc] text-[#7d6556]" : "border-white/[0.07] text-slate-400"
          )}
        >
          {detailLines.map((line) => (
            <li key={line} className="flex gap-2">
              <span
                className={cn(
                  "mt-[7px] h-1 w-1 shrink-0 rounded-full",
                  surfaceTheme === "light" ? "bg-[#b28f78]" : "bg-cyan-300/70"
                )}
              />
              <span>{line}</span>
            </li>
          ))}
        </motion.ul>
      ) : null}
    </div>
  );
}

export function AgentChatDrawer({
  agent,
  surfaceTheme,
  isVisible,
  onRefresh,
  onSnapshotChange,
  onConnectModelProvider
}: {
  agent: AgentRecord;
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  isVisible: boolean;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConnectModelProvider?: (provider: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<AgentChatRunSnapshot>(() => getAgentChatRunSnapshot(agent.id));
  const [revealingAssistantId, setRevealingAssistantId] = useState<string | null>(null);
  const [revealedAssistantTextById, setRevealedAssistantTextById] = useState<Record<string, string>>({});
  const [expandedThinkingById, setExpandedThinkingById] = useState<Record<string, boolean>>({});
  const [repairingGatewayMessageId, setRepairingGatewayMessageId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isVisibleRef = useRef(isVisible);
  const rehydratedAgentRef = useRef<string | null>(null);
  const agentLabel = formatAgentDisplayName(agent);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    const syncAgentChatState = () => {
      const nextRunSnapshot = getAgentChatRunSnapshot(agent.id);

      setRunSnapshot(nextRunSnapshot);
      setMessages(readVisibleAgentChatMessages(agent.id, nextRunSnapshot));
    };

    syncAgentChatState();
    setDraft("");
    setRevealingAssistantId(null);
    setRevealedAssistantTextById({});
    setExpandedThinkingById({});

    const handleChatStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;

      if (!detail || detail.agentId === agent.id) {
        syncAgentChatState();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith(agentChatMessageStoragePrefix)) {
        return;
      }

      syncAgentChatState();
    };

    window.addEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, [agent.id]);

  useEffect(() => {
    if (runSnapshot.assistantMessageId) {
      setRevealingAssistantId(runSnapshot.assistantMessageId);
    }
  }, [runSnapshot.assistantMessageId]);

  useEffect(() => {
    if (!isVisible || runSnapshot.isRunning || rehydratedAgentRef.current === agent.id) {
      return;
    }

    rehydratedAgentRef.current = agent.id;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, {
          method: "GET",
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          messages?: AgentChatMessage[];
        } | null;

        if (cancelled || !Array.isArray(payload?.messages) || payload.messages.length === 0) {
          return;
        }

        const currentMessages = readAgentChatMessages(agent.id);
        const mergedMessages = mergeAgentChatMessagesForRehydration(currentMessages, payload.messages);

        if (agentChatMessagesEqual(currentMessages, mergedMessages)) {
          return;
        }

        writeAgentChatMessages(agent.id, mergedMessages);
      } catch {
        // Rehydration is best-effort; local chat cache remains usable when OpenClaw history is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent.id, isVisible, runSnapshot.isRunning]);

  useEffect(() => {
    const assistantId = runSnapshot.assistantMessageId ?? revealingAssistantId;
    if (!assistantId) {
      return;
    }

    const assistantMessage = messages.find((entry) => entry.id === assistantId && entry.role === "assistant");
    const targetText = assistantMessage?.text ?? "";
    if (!targetText.trim()) {
      return;
    }

    const revealedText = revealedAssistantTextById[assistantId] ?? "";
    if (revealedText === targetText) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRevealedAssistantTextById((current) => {
        const currentText = current[assistantId] ?? "";
        const nextText = revealNextAssistantText(targetText, currentText);

        if (nextText === currentText) {
          return current;
        }

        return {
          ...current,
          [assistantId]: nextText
        };
      });
    }, 42);

    return () => window.clearTimeout(timer);
  }, [messages, revealedAssistantTextById, revealingAssistantId, runSnapshot.assistantMessageId]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isVisibleRef.current) {
        textareaRef.current?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [agent.id, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    markAgentChatAsSeen(agent.id, messages);
  }, [agent.id, messages, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    if (!listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, agent.id, runSnapshot, isVisible]);

  const canSend = Boolean(draft.trim()) && !runSnapshot.isRunning;
  const streamingAssistantId = runSnapshot.assistantMessageId;

  const uiMessages = messages.length > 0
    ? messages
    : [
        {
          id: "system:empty",
          role: "system" as const,
          text: "Start a direct chat with this agent. Messages stay in this drawer and are stored locally in your browser.",
          createdAt: Date.now()
        }
      ];

  const send = async () => {
    const text = draft.trim();
    if (!text || runSnapshot.isRunning) return;

    setDraft("");

    try {
      await sendAgentChatMessage({
        agentId: agent.id,
        agentName: agentLabel,
        text,
        onRefresh,
        onSnapshotChange,
        onError: (message) => {
          toast.error("Chat message failed.", { description: message });
        }
      });
    } finally {
      if (isVisibleRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const repairGatewayAccessAndRetry = async (
    messageId: string,
    text: string,
    action: AgentChatGatewayRepairAction
  ) => {
    const retryText = text.trim();
    if (!retryText || repairingGatewayMessageId || runSnapshot.isRunning) {
      return;
    }

    setRepairingGatewayMessageId(messageId);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: action.apiAction })
      });
      const result = (await response.json().catch(() => null)) as {
        authStatus?: {
          native?: {
            ok?: boolean;
            issue?: string | null;
          };
        };
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Gateway access could not be repaired.");
      }

      if (result?.authStatus?.native && result.authStatus.native.ok === false) {
        throw new Error(result.authStatus.native.issue || "Gateway access still needs attention.");
      }

      toast.success(`${action.label} repaired.`, {
        description: "Retrying the chat message."
      });
      await onRefresh?.().catch(() => undefined);
      setRepairingGatewayMessageId(null);
      await sendAgentChatMessage({
        agentId: agent.id,
        agentName: agentLabel,
        text: retryText,
        onRefresh,
        onSnapshotChange,
        onError: (message) => {
          toast.error("Chat message failed.", { description: message });
        }
      });
    } catch (error) {
      toast.error("Gateway repair failed.", {
        description: error instanceof Error ? error.message : "Unable to repair Gateway access."
      });
    } finally {
      setRepairingGatewayMessageId(null);
      if (isVisibleRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
      )}
    >
      <div
        ref={listRef}
        className={cn(
          "mission-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1",
          surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
        )}
      >
        <div className="space-y-2.5">
          {uiMessages.map((entry) => {
            const isUser = entry.role === "user";
            const isSystem = entry.role === "system";
            const isAssistant = entry.role === "assistant";
            const isActiveAssistant =
              isAssistant && entry.id === streamingAssistantId && runSnapshot.isRunning;
            const isPendingAssistant = isActiveAssistant && !entry.text.trim();
            const revealedAssistantText = isAssistant ? revealedAssistantTextById[entry.id] : undefined;
            const visibleAssistantText = revealedAssistantText ?? entry.text;
            const isRevealingAssistant =
              isAssistant && Boolean(revealedAssistantText) && visibleAssistantText !== entry.text;
            const showAssistantActivity = isActiveAssistant || isRevealingAssistant;
            const assistantActivityLabel = isPendingAssistant ? "Thinking" : showAssistantActivity ? "Replying" : null;
            const isPendingUser = entry.role === "user" && entry.id === runSnapshot.userMessageId && runSnapshot.isRunning;
            const showInlineStatus = entry.status === "sending" && isPendingUser;
            const errorMessage = entry.errorMessage?.trim();
            const gatewayRepairAction = errorMessage ? resolveAgentChatGatewayRepairAction(errorMessage) : null;
            const authAction =
              errorMessage && !gatewayRepairAction ? resolveAgentChatAuthAction(errorMessage, agent.modelId) : null;

            return (
              <div key={entry.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "min-w-0 max-w-[92%] rounded-[18px] border px-3 py-2 text-[13px] leading-5 shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
                    isPendingUser && "opacity-85",
                    isSystem
                      ? surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6] text-[#6c5647]"
                        : "border-white/[0.08] bg-white/[0.03] text-slate-400"
                      : isUser
                        ? surfaceTheme === "light"
                          ? "border-[#e3d4c8] bg-[#fff3f6] text-[#4a382c]"
                          : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] text-slate-100"
                        : surfaceTheme === "light"
                          ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4a382c]"
                          : "border-cyan-300/12 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(59,130,246,0.06))] text-slate-100"
                  )}
                >
                  {isPendingAssistant ? (
                    <>
                      <AssistantBubbleHeader
                        agentLabel={agentLabel}
                        statusLabel={assistantActivityLabel}
                        surfaceTheme={surfaceTheme}
                      />
                      <AssistantThinkingActivity
                        statusMessage={runSnapshot.statusMessage}
                        expanded={Boolean(expandedThinkingById[entry.id])}
                        onToggle={() =>
                          setExpandedThinkingById((current) => ({
                            ...current,
                            [entry.id]: !current[entry.id]
                          }))
                        }
                        surfaceTheme={surfaceTheme}
                      />
                    </>
                  ) : (
                    <>
                      {isAssistant ? (
                        <AssistantBubbleHeader
                          agentLabel={agentLabel}
                          statusLabel={assistantActivityLabel}
                          surfaceTheme={surfaceTheme}
                        />
                      ) : null}
                      <p className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", isAssistant && "mt-1.5")}>
                        {isAssistant ? visibleAssistantText : entry.text}
                      </p>
                      {showAssistantActivity ? (
                        <motion.span
                          aria-hidden="true"
                          animate={{ opacity: [0.2, 1, 0.2] }}
                          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                          className="ml-0.5 inline-block h-[1em] w-[1px] translate-y-[2px] bg-current"
                        />
                      ) : null}
                    </>
                  )}
                  {!isPendingAssistant && showInlineStatus ? (
                    <p
                      className={cn(
                        "mt-1.5 text-[10px] uppercase tracking-[0.18em]",
                        surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500"
                      )}
                    >
                      {isUser ? "Sending…" : "Drafting…"}
                    </p>
                  ) : !isPendingAssistant && entry.status === "error" ? (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-rose-300">
                        Failed to send
                      </p>
                      {errorMessage ? (
                        <p
                          className={cn(
                            "text-[11px] leading-4 [overflow-wrap:anywhere]",
                            surfaceTheme === "light" ? "text-rose-700" : "text-rose-200"
                          )}
                        >
                          {errorMessage}
                        </p>
                      ) : null}
                      {authAction && onConnectModelProvider ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => onConnectModelProvider(authAction.provider)}
                          className={cn(
                            "mt-1 h-8 rounded-full px-3 text-[11px]",
                            surfaceTheme === "light"
                              ? "border-rose-200 bg-white text-rose-800 hover:bg-rose-50"
                              : "border-rose-300/20 bg-rose-300/10 text-rose-100 hover:bg-rose-300/16"
                          )}
                        >
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                          Connect {authAction.label}
                        </Button>
                      ) : null}
                      {gatewayRepairAction ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void repairGatewayAccessAndRetry(entry.id, entry.text, gatewayRepairAction)}
                          disabled={Boolean(repairingGatewayMessageId) || runSnapshot.isRunning}
                          title={gatewayRepairAction.detail}
                          className={cn(
                            "mt-1 h-8 rounded-full px-3 text-[11px]",
                            surfaceTheme === "light"
                              ? "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                              : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/16"
                          )}
                        >
                          {repairingGatewayMessageId === entry.id ? (
                            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {gatewayRepairAction.cta}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "mt-2 shrink-0 rounded-[18px] border p-3",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fffaf6]"
            : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))]"
        )}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (!target || target.closest("textarea") || target.closest("button")) return;
          textareaRef.current?.focus();
        }}
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              await send();
            }
          }}
          placeholder={`Message to ${agentLabel}...`}
          className={cn(
            "min-h-[60px] cursor-text resize-none border-0 bg-transparent px-3.5 py-2.5 text-[13px] leading-[1.5] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            surfaceTheme === "light"
              ? "text-[#3f2f24] placeholder:text-[#8f7664]"
              : "text-white placeholder:text-slate-500"
          )}
        />

        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <Button
            disabled={!canSend}
            className={cn(
              "h-8 rounded-full px-3 shadow-none",
              surfaceTheme === "light"
                ? "bg-[#4a382c] text-[#fffaf6] hover:bg-[#3f2f24]"
                : "bg-white text-slate-950 hover:bg-white/92"
            )}
            onClick={send}
          >
            {runSnapshot.isRunning ? (
              <LoaderCircle className="mr-[5px] h-[13px] w-[13px] animate-spin" />
            ) : (
              <SendHorizontal className="mr-[5px] h-[13px] w-[13px]" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function readVisibleAgentChatMessages(agentId: string, runSnapshot: AgentChatRunSnapshot): ChatMessage[] {
  return normalizeAgentChatMessagesForDisplay(readAgentChatMessages(agentId), runSnapshot);
}

function agentChatMessagesEqual(left: readonly AgentChatMessage[], right: readonly AgentChatMessage[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => {
    const other = right[index];

    return Boolean(
      other &&
        message.id === other.id &&
        message.role === other.role &&
        message.text === other.text &&
        message.createdAt === other.createdAt &&
        message.status === other.status &&
        message.errorMessage === other.errorMessage &&
        message.runId === other.runId
    );
  });
}

function resolveAssistantThinkingHint(statusMessage: string | null) {
  const normalizedStatus = statusMessage?.toLowerCase() ?? "";

  if (normalizedStatus.includes("final confirmation")) {
    return "Waiting for OpenClaw to confirm the turn is complete.";
  }

  if (normalizedStatus.includes("still working") || normalizedStatus.includes("start the reply")) {
    return "OpenClaw is still running the direct chat turn.";
  }

  if (normalizedStatus.includes("finalizing") || normalizedStatus.includes("drafting")) {
    return "Shaping the reply before it appears here.";
  }

  if (normalizedStatus.includes("thinking")) {
    return "Checking recent context before answering.";
  }

  return "Reading your message and preparing a reply.";
}

function resolveAssistantThinkingPreview(statusMessage: string | null) {
  const hint = resolveAssistantThinkingHint(statusMessage);

  if (hint.includes("Shaping")) {
    return ["Shaping the reply", "Preparing the final wording"];
  }

  if (hint.includes("confirm")) {
    return ["Reply signal received", "Waiting for final confirmation"];
  }

  if (hint.includes("still running")) {
    return ["OpenClaw is still working", "Waiting for reply text"];
  }

  if (hint.includes("Checking")) {
    return ["Reading your message", "Checking recent context"];
  }

  return ["Reading your message", "Preparing a reply"];
}

function resolveAssistantThinkingDetails(statusMessage: string | null) {
  const normalizedStatus = statusMessage?.toLowerCase() ?? "";

  if (normalizedStatus.includes("final confirmation")) {
    return [
      "AgentOS has not received the final turn-complete confirmation from OpenClaw yet.",
      "If reply text already arrived, AgentOS is waiting to verify that the turn was saved.",
      "If this later fails, refresh state or ask the agent for a summary of any completed work."
    ];
  }

  if (normalizedStatus.includes("still working") || normalizedStatus.includes("start the reply")) {
    return [
      "OpenClaw accepted the direct chat turn and is still working.",
      "AgentOS has not received assistant reply text yet.",
      "Long waits usually mean the runtime is busy, the model is slow, or the Gateway has not exposed the reply."
    ];
  }

  if (normalizedStatus.includes("finalizing") || normalizedStatus.includes("drafting")) {
    return [
      "The agent has enough context to answer.",
      "It is tightening the response before showing it here.",
      "Raw reasoning stays hidden; only the final reply is saved."
    ];
  }

  if (normalizedStatus.includes("thinking")) {
    return [
      "The agent is reading the direct message.",
      "It is checking recent chat and workspace context.",
      "It will replace this activity card with the final reply."
    ];
  }

  return [
    "The message was sent to the selected agent.",
    "AgentOS is waiting for the first response signal.",
    "This activity is temporary and is not saved to chat history."
  ];
}

function revealNextAssistantText(targetText: string, currentText: string) {
  const safeCurrent = targetText.startsWith(currentText) ? currentText : "";
  const remainingText = targetText.slice(safeCurrent.length);
  const nextWord = remainingText.match(/^\s*\S+\s*/)?.[0];

  if (!nextWord) {
    return targetText;
  }

  return targetText.slice(0, safeCurrent.length + nextWord.length);
}
