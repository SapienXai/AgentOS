"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowDown, Bot, KeyRound, LoaderCircle, SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { AgentChatMessageContent } from "@/components/mission-control/agent-chat-message-content";
import {
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  markAgentChatAsSeen,
  markAgentInboxAsSeen,
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
  resolveAgentChatMessageAuthAction,
  resolveAgentChatGatewayRepairAction,
  type AgentChatGatewayRepairAction
} from "@/lib/openclaw/chat-auth-actions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AddModelsProviderId } from "@/lib/openclaw/types";
import type { MissionControlSnapshot, AgentRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChatMessage = AgentChatMessage;

function formatChatTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "now";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatChatDate(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "Today";
  }

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameCalendarDay(date, today)) {
    return "Today";
  }

  if (isSameCalendarDay(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  }).format(date);
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function shouldShowChatDateSeparator(previousTimestamp: number | undefined, timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return previousTimestamp === undefined;
  }

  if (typeof previousTimestamp !== "number" || !Number.isFinite(previousTimestamp)) {
    return true;
  }

  return !isSameCalendarDay(new Date(previousTimestamp), new Date(timestamp));
}

function AssistantThinkingActivity({
  statusMessage,
  statusHistory
}: {
  statusMessage: string | null;
  statusHistory: string[];
}) {
  const activityLines = (statusHistory.length > 0 ? statusHistory : statusMessage ? [statusMessage] : []).slice(-5);
  const recentActivityLines = activityLines.slice(-3);
  const currentActivity = recentActivityLines.at(-1) || "Waiting for OpenClaw status...";
  const previousActivity = recentActivityLines.slice(0, -1);

  return (
    <div className="mt-3 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
      <span role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 items-center gap-2">
        <span aria-hidden="true" className="agent-chat-activity-dot h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
        <span className="agent-chat-activity-label min-w-0 truncate leading-5">{currentActivity}</span>
      </span>
      {previousActivity.length > 0 ? (
        <details className="group relative ml-auto shrink-0 text-[11px] leading-5">
          <summary className="cursor-pointer list-none rounded px-1 text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Recent activity
          </summary>
          <div className="absolute right-0 top-full z-10 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
            {previousActivity.map((line, index) => (
              <p key={`${line}-${index}`} className="truncate py-1 text-[11px] leading-4 text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function AgentChatWelcome({
  agentLabel,
  agentEmoji,
  prompts,
  onPrompt
}: {
  agentLabel: string;
  agentEmoji: string | null;
  prompts: Array<{ label: string; text: string }>;
  onPrompt: (text: string) => void;
}) {
  return (
    <div className="w-full max-w-md text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground">
        {agentEmoji ? <span aria-hidden="true" className="text-xl">{agentEmoji}</span> : <Bot className="h-5 w-5" aria-hidden="true" />}
      </div>
      <p className="text-base font-semibold tracking-tight text-foreground">Talk with {agentLabel}</p>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">What would you like this worker to help with?</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onPrompt(prompt.text)}
            className={cn(
              "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {prompt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentChatDrawer({
  agent,
  snapshot,
  isVisible,
  onRefresh,
  onSnapshotChange,
  onConnectModelProvider
}: {
  agent: AgentRecord;
  snapshot: MissionControlSnapshot;
  isVisible: boolean;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConnectModelProvider?: (provider: AddModelsProviderId) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<AgentChatRunSnapshot>(() => getAgentChatRunSnapshot(agent.id));
  const [repairingGatewayMessageId, setRepairingGatewayMessageId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isVisibleRef = useRef(isVisible);
  const isNearBottomRef = useRef(true);
  const rehydratedAgentRef = useRef<string | null>(null);
  const agentLabel = formatAgentDisplayName(agent);
  const inboxItems = snapshot.agentInbox.filter((item) => item.agentId === agent.id);
  const quickPrompts = [
    { label: "Status", text: "Summarize your current work, progress, and next step." },
    { label: "Blockers", text: "What is blocking you right now, if anything?" },
    { label: "Priorities", text: "What needs my attention or decision next?" }
  ];

  const scrollToLatest = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    list.scrollTo({ top: list.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);
  };

  const handleTimelineScroll = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const nextIsNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    isNearBottomRef.current = nextIsNearBottom;
    setIsNearBottom(nextIsNearBottom);

    if (nextIsNearBottom) {
      setHasUnreadBelow(false);
    }
  };

  const applyQuickPrompt = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

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
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);

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
    if (!isVisible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isVisibleRef.current && window.matchMedia("(min-width: 1024px)").matches) {
        textareaRef.current?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [agent.id, isVisible]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 52), 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }, [draft, isVisible]);

  useEffect(() => {
    const list = listRef.current;
    if (!isVisible || !list || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) {
        list.scrollTop = list.scrollHeight;
      }
    });
    observer.observe(list);

    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    markAgentChatAsSeen(agent.id, messages);
    markAgentInboxAsSeen(agent.id, inboxItems);
  }, [agent.id, messages, inboxItems, isVisible]);

  useEffect(() => {
    if (!isVisible || !listRef.current) {
      return;
    }

    if (isNearBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      return;
    }

    if (messages.length > 0 || inboxItems.length > 0) {
      setHasUnreadBelow(true);
    }
  }, [agent.id, inboxItems.length, isVisible, messages]);

  const canSend = Boolean(draft.trim()) && !runSnapshot.isRunning;
  const streamingAssistantId = runSnapshot.assistantMessageId;

  const hasConversation = messages.length > 0 || inboxItems.length > 0;

  const send = async () => {
    const text = draft.trim();
    if (!text || runSnapshot.isRunning) return;

    setDraft("");
    scrollToLatest();

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
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleTimelineScroll}
          className="h-full min-h-0 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 py-6 sm:px-8 sm:py-7">
            {!hasConversation ? (
              <div className="flex min-h-[min(58dvh,560px)] w-full items-center justify-center py-8">
                <AgentChatWelcome
                  agentLabel={agentLabel}
                  agentEmoji={agent.identity.emoji || null}
                  prompts={quickPrompts}
                  onPrompt={applyQuickPrompt}
                />
              </div>
            ) : null}
            {inboxItems.map((item) => <AgentInboxItemBubble key={item.id} item={item} />)}
            {messages.map((entry, index) => {
              const isUser = entry.role === "user";
              const isSystem = entry.role === "system";
              const isAssistant = entry.role === "assistant";
              const isActiveAssistant = isAssistant && entry.id === streamingAssistantId && runSnapshot.isRunning;
              const isPendingAssistant = isActiveAssistant && !entry.text.trim();
              const isPendingUser = isUser && entry.id === runSnapshot.userMessageId && runSnapshot.isRunning;
              const errorMessage = entry.errorMessage?.trim();
              const gatewayRepairAction = errorMessage ? resolveAgentChatGatewayRepairAction(errorMessage) : null;
              const authAction = !gatewayRepairAction
                ? resolveAgentChatMessageAuthAction(entry.status, errorMessage, agent.modelId)
                : null;
              const showDateSeparator = shouldShowChatDateSeparator(messages[index - 1]?.createdAt, entry.createdAt);

              return (
                <div key={entry.id} className="w-full">
                  {showDateSeparator ? (
                    <div className="flex justify-center py-1" role="separator" aria-label={formatChatDate(entry.createdAt)}>
                      <time
                        dateTime={Number.isFinite(entry.createdAt) ? new Date(entry.createdAt).toISOString() : undefined}
                        className="rounded-full bg-muted/60 px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
                      >
                        {formatChatDate(entry.createdAt)}
                      </time>
                    </div>
                  ) : null}
                  <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
                    <div className={cn("min-w-0", isUser ? "max-w-[82%]" : isSystem ? "w-full max-w-xl" : "w-full")}>
                      {isPendingAssistant ? null : isUser ? (
                        <div className={cn("rounded-[20px] bg-muted px-4 py-2.5 text-[14px] leading-6 text-foreground", isPendingUser && "opacity-80")}>
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.text}</p>
                        </div>
                      ) : isSystem ? (
                        <div className="rounded-xl border-l-2 border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.text}</p>
                        </div>
                      ) : (
                        <AgentChatMessageContent text={entry.text} className="text-[15px] leading-7" />
                      )}

                      {!isPendingAssistant ? (
                        <time
                          dateTime={Number.isFinite(entry.createdAt) ? new Date(entry.createdAt).toISOString() : undefined}
                          className={cn("mt-1.5 block text-[10px] leading-4 text-muted-foreground/75", isUser && "text-right")}
                        >
                          {formatChatTime(entry.createdAt)}
                        </time>
                      ) : null}

                      {isActiveAssistant ? (
                        <AssistantThinkingActivity
                          statusMessage={runSnapshot.statusMessage}
                          statusHistory={runSnapshot.statusHistory}
                        />
                      ) : null}

                      {isPendingUser ? <p className="mt-1.5 text-xs text-muted-foreground">Sending…</p> : null}

                      {entry.status === "error" ? (
                        <div className={cn("mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs", isUser && "justify-end")}>
                          <span className="text-destructive">
                            {isUser ? "Message could not be sent." : "The reply ended early."}
                          </span>
                          {isUser && authAction && onConnectModelProvider ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onConnectModelProvider(authAction.provider)}
                              title={authAction.detail}
                              className="h-7 rounded-full px-2 text-xs font-medium text-foreground hover:bg-muted"
                            >
                              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                              Fix {authAction.label}
                            </Button>
                          ) : null}
                          {isUser && gatewayRepairAction ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => void repairGatewayAccessAndRetry(entry.id, entry.text, gatewayRepairAction)}
                              disabled={Boolean(repairingGatewayMessageId) || runSnapshot.isRunning}
                              title={gatewayRepairAction.detail}
                              className="h-7 rounded-full px-2 text-xs font-medium text-foreground hover:bg-muted"
                            >
                              {repairingGatewayMessageId === entry.id ? (
                                <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              {gatewayRepairAction.cta}
                            </Button>
                          ) : null}
                          {errorMessage ? (
                            <details className="text-muted-foreground">
                              <summary className="cursor-pointer rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                Details
                              </summary>
                              <p className="mt-1 max-w-xl whitespace-pre-wrap break-words text-[11px] leading-5 [overflow-wrap:anywhere]">
                                {errorMessage}
                              </p>
                            </details>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {hasUnreadBelow && !isNearBottom ? (
          <button
            type="button"
            aria-label="Scroll to the latest message"
            onClick={scrollToLatest}
            className="absolute bottom-3 left-1/2 z-10 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 text-xs font-medium text-foreground shadow-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            Latest message
          </button>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border/70 bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:px-6">
        <div className="mx-auto w-full max-w-2xl">
          <div
            className="relative overflow-hidden rounded-[22px] border border-border bg-card shadow-sm"
            onPointerDown={(event) => {
              const target = event.target as HTMLElement | null;
              if (!target || target.closest("textarea") || target.closest("button")) return;
              textareaRef.current?.focus();
            }}
          >
            <Textarea
              ref={textareaRef}
              rows={1}
              aria-label={`Message ${agentLabel}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  await send();
                }
              }}
              placeholder={`Message ${agentLabel}…`}
              className="min-h-[52px] max-h-[160px] w-full cursor-text resize-none border-0 bg-transparent px-4 py-3 pr-16 text-[15px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            <Button
              type="button"
              aria-label={runSnapshot.isRunning ? "Agent is responding" : "Send message"}
              disabled={!canSend}
              className="absolute bottom-1.5 right-1.5 h-10 w-10 rounded-full p-0 shadow-none"
              onClick={send}
            >
              {runSnapshot.isRunning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function readVisibleAgentChatMessages(agentId: string, runSnapshot: AgentChatRunSnapshot): ChatMessage[] {
  return normalizeAgentChatMessagesForDisplay(readAgentChatMessages(agentId), runSnapshot);
}

function AgentInboxItemBubble({ item }: { item: MissionControlSnapshot["agentInbox"][number] }) {
  const sourceLabel = item.sourceAgentName || item.sourceAgentId || "OpenClaw";
  const provenanceLabel = item.provenance === "openclaw-task" ? "OpenClaw task" : "OpenClaw runtime";
  const reference = item.taskId || item.runtimeId || item.sessionId || item.runId || null;

  return (
    <div className="w-full border-l-2 border-violet-500/40 py-1 pl-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Handoff result</span>
        <span>{sourceLabel} · {provenanceLabel}</span>
      </div>
      <p className="mt-1 text-sm font-medium text-foreground">{item.title}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
        {item.summary}
      </p>
      {reference ? <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground/75">{reference}</p> : null}
    </div>
  );
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
