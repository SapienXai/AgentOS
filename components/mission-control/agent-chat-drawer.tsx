"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ArrowDown, Bot, KeyRound, LoaderCircle, SendHorizontal, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { AgentChatSoundSettings, reportAgentChatVisibility, requestAgentChatSound } from "@/components/mission-control/agent-chat-sounds";
import { AgentChatMessageContent } from "@/components/mission-control/agent-chat-message-content";
import {
  agentChatStateEventName,
  markAgentChatAsSeen,
  markAgentInboxAsSeen,
  reconcileAgentChatMessages,
  normalizeAgentChatMessagesForDisplay,
  readAgentChatMessages,
  writeAgentChatMessages,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";
import {
  agentChatConversationKey,
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

type NativeChatQueue = {
  total: number;
  items: Array<{
    id: string;
    runId?: string;
    text: string;
    state: "queued" | "cancelled" | "interrupted";
    steerNow?: { status: "available" | "blocked"; tools: string[] };
  }>;
};

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
  surface = "default",
  onRefresh,
  onSnapshotChange,
  onConnectModelProvider
}: {
  agent: AgentRecord;
  snapshot: MissionControlSnapshot;
  isVisible: boolean;
  surface?: "default" | "transparent";
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConnectModelProvider?: (provider: AddModelsProviderId) => void;
}) {
  const [selection, setSelection] = useState<{ agentId: string; id?: string }>();
  const conversationId = selection?.agentId === agent.id ? selection.id : undefined;
  const chatKey = agentChatConversationKey(agent.id, conversationId);
  const endpoint = `/api/agents/${encodeURIComponent(agent.id)}/chat`;
  const conversationLabelId = useId();
  const composerId = useId();
  const [catalog, setCatalog] = useState<{
    agentId: string;
    conversations: Array<{ id: string; updatedAt: number | null }>;
  }>();
  const conversations = catalog?.agentId === agent.id ? catalog.conversations : [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[chatKey] ?? "";
  const submittedDraft = useRef<{ chatKey: string; text: string } | null>(null);
  const setDraft = (text: string) => {
    submittedDraft.current = null;
    setDrafts((current) => ({ ...current, [chatKey]: text }));
  };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<AgentChatRunSnapshot>(() => getAgentChatRunSnapshot(agent.id));
  const [repairingGatewayMessageId, setRepairingGatewayMessageId] = useState<string | null>(null);
  const [stoppingReply, setStoppingReply] = useState(false);
  const [historyUnavailableFor, setHistoryUnavailableFor] = useState<string>();
  const [chatAccessDeniedFor, setChatAccessDeniedFor] = useState<string>();
  const [queueSnapshot, setQueueSnapshot] = useState<{
    chatKey: string;
    sessionId: string | null;
    pendingInputs: NativeChatQueue | null;
    before: string | null;
  }>();
  const queue = queueSnapshot?.chatKey === chatKey ? queueSnapshot : undefined;
  const [olderHistory, setOlderHistory] = useState<{
    chatKey: string;
    sessionId: string;
    before: string | null;
    messages: ChatMessage[];
  }>();
  const olderPage = olderHistory?.chatKey === chatKey && olderHistory.sessionId === queue?.sessionId ? olderHistory : undefined;
  const olderCursor = olderPage ? olderPage.before : queue?.before;
  const pageLoad = useRef<AbortController | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [queueAction, setQueueAction] = useState<{ chatKey: string; inputId: string }>();
  const refreshConversation = useRef<() => void>(() => {});
  const chatAccessDenied = chatAccessDeniedFor === chatKey;
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isVisibleRef = useRef(isVisible);
  const isNearBottomRef = useRef(true);
  const agentLabel = formatAgentDisplayName(agent);
  const inboxItems = useMemo(() => conversationId ? [] : snapshot.agentInbox.filter((item) => item.agentId === agent.id),
    [agent.id, conversationId, snapshot.agentInbox]);
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
    reportAgentChatVisibility(agent.id, isVisible);

    return () => reportAgentChatVisibility(agent.id, false);
  }, [agent.id, isVisible]);

  useEffect(() => {
    if (!isVisible || runSnapshot.isRunning) return;
    const controller = new AbortController();
    void fetch(`${endpoint}?conversations=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { conversations: NonNullable<typeof catalog>["conversations"] };
        if (!controller.signal.aborted) setCatalog({ agentId: agent.id, conversations: result.conversations });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [agent.id, endpoint, isVisible, runSnapshot.isRunning]);

  useEffect(() => {
    const syncAgentChatState = () => {
      const nextRunSnapshot = getAgentChatRunSnapshot(chatKey);

      setRunSnapshot(nextRunSnapshot);
      setMessages(readVisibleAgentChatMessages(chatKey, nextRunSnapshot));
    };

    syncAgentChatState();
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);

    const handleChatStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;

      if (!detail || detail.agentId === chatKey) {
        syncAgentChatState();
      }
    };

    window.addEventListener(agentChatStateEventName, handleChatStateChange as EventListener);

    return () => {
      window.removeEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
    };
  }, [chatKey]);

  useEffect(() => {
    if (!isVisible) return;

    const controller = new AbortController();
    const params = new URLSearchParams();
    if (conversationId) params.set("conversation", conversationId);
    const historyUrl = conversationId ? `${endpoint}?${params}` : endpoint;
    params.set("queue", "1");
    const queueUrl = `${endpoint}?${params}`;
    params.delete("queue");
    params.set("watch", "1");
    let syncing = false;
    let needsSync = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const syncHistory = async () => {
      if (document.visibilityState !== "visible") return;
      if (syncing) {
        needsSync = true;
        return;
      }
      syncing = true;
      const queueOnly = getAgentChatRunSnapshot(chatKey).isRunning;
      try {
        const response = await fetch(queueOnly ? queueUrl : historyUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          if (!controller.signal.aborted) {
            setQueueSnapshot((current) => current?.chatKey === chatKey ? undefined : current);
            if (response.status === 401 || response.status === 403) {
              setChatAccessDeniedFor(chatKey);
              setOlderHistory((current) => current?.chatKey === chatKey ? undefined : current);
              writeAgentChatMessages(chatKey, []);
            } else {
              setHistoryUnavailableFor(chatKey);
            }
          }
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          messages?: AgentChatMessage[];
          sessionId?: string | null;
          pendingInputs?: NativeChatQueue | null;
          before?: string | null;
        } | null;

        if (controller.signal.aborted || !payload) return;
        setQueueSnapshot((current) => ({
          chatKey,
          sessionId: payload.sessionId ?? null,
          pendingInputs: payload.pendingInputs ?? null,
          before: queueOnly && current?.chatKey === chatKey && current.sessionId === payload.sessionId
            ? current.before : payload.before ?? null
        }));
        setHistoryUnavailableFor((current) => current === chatKey ? undefined : current);
        setChatAccessDeniedFor((current) => current === chatKey ? undefined : current);
        if (queueOnly || getAgentChatRunSnapshot(chatKey).isRunning || !Array.isArray(payload.messages)) return;

        const currentMessages = readAgentChatMessages(chatKey);
        const mergedMessages = reconcileAgentChatMessages(currentMessages, payload.messages);

        if (agentChatMessagesEqual(currentMessages, mergedMessages)) {
          return;
        }

        writeAgentChatMessages(chatKey, mergedMessages);
      } catch {
        if (!controller.signal.aborted) {
          setQueueSnapshot((current) => current?.chatKey === chatKey ? undefined : current);
          setHistoryUnavailableFor(chatKey);
        }
      } finally {
        syncing = false;
        if (needsSync && !controller.signal.aborted) {
          needsSync = false;
          scheduleSync();
        }
      }
    };
    const scheduleSync = () => {
      if (timer !== undefined || controller.signal.aborted) return;
      timer = setTimeout(() => {
        timer = undefined;
        void syncHistory();
      }, 150);
    };
    const events = new EventSource(`${endpoint}?${params}`);
    events.addEventListener("history", scheduleSync);
    events.addEventListener("open", scheduleSync);
    refreshConversation.current = scheduleSync;
    let wasRunning = getAgentChatRunSnapshot(chatKey).isRunning;
    const reconcileAfterSend = (event: Event) => {
      if ((event as CustomEvent<{ agentId: string }>).detail?.agentId !== chatKey) return;
      const isRunning = getAgentChatRunSnapshot(chatKey).isRunning;
      if (wasRunning !== isRunning) scheduleSync();
      wasRunning = isRunning;
    };
    window.addEventListener(agentChatStateEventName, reconcileAfterSend);
    void syncHistory();
    document.addEventListener("visibilitychange", scheduleSync);
    window.addEventListener("focus", scheduleSync);

    return () => {
      controller.abort();
      pageLoad.current?.abort();
      events.close();
      refreshConversation.current = () => {};
      window.removeEventListener(agentChatStateEventName, reconcileAfterSend);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", scheduleSync);
      window.removeEventListener("focus", scheduleSync);
    };
  }, [chatKey, conversationId, endpoint, isVisible]);

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

    if (!conversationId) {
      markAgentChatAsSeen(agent.id, messages);
      markAgentInboxAsSeen(agent.id, inboxItems);
    }
  }, [agent.id, conversationId, messages, inboxItems, isVisible]);

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

  const canSend = !chatAccessDenied && Boolean(draft.trim());
  const stopRunId = runSnapshot.runs[0]?.runId;

  const displayedMessages = useMemo(() => {
    if (chatAccessDenied) return [];
    if (!olderPage) return messages;
    const currentIds = new Set(messages.map(({ id }) => id));
    return [...olderPage.messages.filter(({ id }) => !currentIds.has(id)), ...messages];
  }, [chatAccessDenied, messages, olderPage]);
  const hasConversation = displayedMessages.length > 0 || inboxItems.length > 0;

  const loadOlder = async () => {
    if (!olderCursor || !queue?.sessionId || (pageLoad.current && !pageLoad.current.signal.aborted)) return;
    const controller = new AbortController();
    pageLoad.current = controller;
    setLoadingOlder(true);
    const params = new URLSearchParams({ before: olderCursor });
    if (conversationId) params.set("conversation", conversationId);
    try {
      const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        setChatAccessDeniedFor(chatKey);
        setOlderHistory((current) => current?.chatKey === chatKey ? undefined : current);
        writeAgentChatMessages(chatKey, []);
        return;
      }
      if (!response.ok) throw new Error("OpenClaw could not load older messages.");
      const page = await response.json() as { sessionId: string; before: string | null; messages: ChatMessage[] };
      if (controller.signal.aborted || page.sessionId !== queue.sessionId) return;
      setOlderHistory({
        chatKey,
        sessionId: page.sessionId,
        before: page.before === olderCursor ? null : page.before,
        messages: [...page.messages, ...(olderPage?.messages ?? [])]
      });
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "OpenClaw could not load older messages.");
    } finally {
      if (pageLoad.current === controller) {
        pageLoad.current = null;
        setLoadingOlder(false);
      }
    }
  };

  const stopReply = async () => {
    if (!stopRunId || stoppingReply) return;
    setStoppingReply(true);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, runId: stopRunId })
      });
      const result = await response.json().catch(() => null) as { aborted?: boolean; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "OpenClaw could not stop this reply.");
      if (result?.aborted === true) toast.info("Reply stopped.");
      if (result?.aborted === false) toast.info("This reply is no longer active.");
    } catch (error) {
      toast.error("Could not stop reply.", {
        description: error instanceof Error ? error.message : undefined
      });
    } finally {
      setStoppingReply(false);
    }
  };

  const updateQueue = async (item: NativeChatQueue["items"][number], action: "steer" | "dismiss") => {
    const resultInput = action === "steer" ? { runId: item.runId } : { inputId: item.id };
    if (!queue?.sessionId || queueAction?.chatKey === chatKey || (action === "steer" && !item.runId)) return;
    const operation = { chatKey, inputId: item.id };
    setQueueAction(operation);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, conversationId, sessionId: queue.sessionId, ...resultInput })
      });
      const result = await response.json().catch(() => null) as
        { status?: string; dismissedIds?: string[]; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "OpenClaw could not update the queue.");
      if (action === "dismiss") {
        toast.info(result?.dismissedIds?.includes(item.id) ? "Input dismissed." : "This input is no longer pending.");
      } else {
        toast.info(result?.status === "interrupted" ? "OpenClaw interrupted the delaying tools." :
          result?.status === "blocked" ? "The running tools cannot be interrupted." :
            "This input no longer has tools that OpenClaw can interrupt.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OpenClaw could not update the queue.");
    } finally {
      refreshConversation.current();
      setQueueAction((current) => current === operation ? undefined : current);
    }
  };

  const send = async (queueMode?: "steer") => {
    const text = draft.trim();
    if (chatAccessDenied || !text || (submittedDraft.current?.chatKey === chatKey && submittedDraft.current.text === text)) return;

    requestAgentChatSound("send");
    setDraft("");
    submittedDraft.current = { chatKey, text };
    scrollToLatest();

    try {
      await sendAgentChatMessage({
        queueMode,
        agentId: agent.id,
        conversationId,
        text,
        onRefresh,
        onSnapshotChange,
        onError: (message, confirmed) => {
          if (confirmed) toast.error("Chat message failed.", { description: message });
          else toast.info(message);
        }
      });
    } finally {
      if (isVisibleRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const repairGatewayAccess = async (messageId: string, action: AgentChatGatewayRepairAction) => {
    if (repairingGatewayMessageId || runSnapshot.isRunning) {
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
        description: "Check the conversation before resending the message."
      });
      await onRefresh?.().catch(() => undefined);
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
        "flex h-full min-h-0 flex-col text-foreground",
        surface === "transparent" ? "bg-transparent" : "bg-background"
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-1.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={conversationLabelId} className="sr-only">Conversation</label>
          <select
            id={conversationLabelId}
            value={conversationId ?? ""}
            onChange={(event) => setSelection({ agentId: agent.id, id: event.target.value || undefined })}
            className="min-h-12 min-w-0 rounded-md border border-input bg-background px-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:text-sm"
          >
            <option value="">Default conversation</option>
            {conversationId && !conversations.some(({ id }) => id === conversationId) ? (
              <option value={conversationId}>New conversation</option>
            ) : null}
            {conversations.map(({ id, updatedAt }) => (
              <option key={id} value={id}>
                {updatedAt ? `${formatChatDate(updatedAt)} · ${formatChatTime(updatedAt)}` : id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-12 shrink-0 sm:min-h-9"
          onClick={() => {
            const id = globalThis.crypto?.randomUUID?.();
            if (id) setSelection({ agentId: agent.id, id });
            else toast.error("Starting a new conversation requires a secure connection.");
          }}
        >
          New chat
        </Button>
      </div>
      {chatAccessDenied ? (
        <p role="status" className="shrink-0 border-b border-border/70 px-4 py-2 text-sm text-muted-foreground sm:px-6">
          Direct chat requires an authorized operator and a native OpenClaw Gateway connection.
        </p>
      ) : historyUnavailableFor === chatKey ? (
        <p role="status" className="shrink-0 border-b border-border/70 px-4 py-2 text-sm text-muted-foreground sm:px-6">
          OpenClaw chat history is unavailable. Reopen this chat after the Gateway reconnects.
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleTimelineScroll}
          className="h-full min-h-0 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 py-6 sm:px-8 sm:py-7">
            {!chatAccessDenied && olderCursor ? (
              <Button type="button" size="sm" variant="ghost" className="self-center" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? "Loading older messages…" : "Load older messages"}
              </Button>
            ) : null}
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
            {displayedMessages.map((entry, index) => {
              const isUser = entry.role === "user";
              const isSystem = entry.role === "system";
              const activeRun = runSnapshot.runs.find((run) => run.assistantMessageId === entry.id);
              const isPendingAssistant = Boolean(activeRun && !entry.text.trim());
              const isPendingUser = isUser && runSnapshot.runs.some((run) => run.userMessageId === entry.id);
              const errorMessage = entry.errorMessage?.trim();
              const gatewayRepairAction = errorMessage ? resolveAgentChatGatewayRepairAction(errorMessage) : null;
              const authAction = !gatewayRepairAction
                ? resolveAgentChatMessageAuthAction(entry.status, errorMessage, agent.modelId)
                : null;
              const showDateSeparator = shouldShowChatDateSeparator(displayedMessages[index - 1]?.createdAt, entry.createdAt);

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

                      {activeRun ? (
                        <AssistantThinkingActivity
                          statusMessage={activeRun.statusMessage}
                          statusHistory={activeRun.statusHistory}
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
                              onClick={() => void repairGatewayAccess(entry.id, gatewayRepairAction)}
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

      <div
        className={cn(
          "shrink-0 border-t border-border/70 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6",
          surface === "transparent" ? "bg-transparent" : "bg-background/95 backdrop-blur-sm"
        )}
      >
        <div className="mx-auto w-full max-w-2xl">
          {!chatAccessDenied && queue?.pendingInputs && queue.pendingInputs.total > 0 ? (
            <details className="mb-2 rounded-lg border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">
                Pending inputs ({queue.pendingInputs.total})
              </summary>
              <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto">
                {queue.pendingInputs.items.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {item.text ? <p className="truncate" title={item.text}>{item.text}</p> : null}
                      <p className="text-xs capitalize text-muted-foreground">
                        {item.state}{item.steerNow?.status === "blocked" ? " · Running tools cannot be interrupted" : ""}
                      </p>
                    </div>
                    {item.state !== "queued" || (item.steerNow?.status === "available" && item.runId) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!queue.sessionId || queueAction?.chatKey === chatKey}
                        onClick={() => void updateQueue(item, item.state === "queued" ? "steer" : "dismiss")}
                      >
                        {item.state === "queued" ? "Steer now" : "Dismiss"}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <form
            aria-label="Send an agent message"
            className="relative rounded-[22px] border border-border bg-card shadow-sm"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement | null;
              if (!target || target.closest("textarea") || target.closest("button")) return;
              textareaRef.current?.focus();
            }}
          >
            <label htmlFor={composerId} className="sr-only">Message {agentLabel}</label>
            <Textarea
              id={composerId}
              name="message"
              disabled={chatAccessDenied}
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder={`Message ${agentLabel}…`}
              className="min-h-[52px] max-h-[160px] w-full cursor-text resize-none border-0 bg-transparent py-3 pl-14 pr-28 text-[15px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            <div className="absolute bottom-1.5 left-1.5 z-10">
              <AgentChatSoundSettings />
            </div>

            <div className="absolute bottom-1.5 right-1.5 flex gap-1">
              {stopRunId ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Stop reply"
                  disabled={stoppingReply}
                  className="h-10 w-10 rounded-full p-0"
                  onClick={stopReply}
                >
                  {stoppingReply ? <LoaderCircle className="h-4 w-4 animate-spin" /> :
                    <Square className="h-4 w-4 fill-current" />}
                </Button>
              ) : null}
              <Button
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
                className="h-10 w-10 rounded-full p-0 shadow-none"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </form>
          {runSnapshot.isRunning || queue?.pendingInputs?.items.some(({ state }) => state === "queued") ? (
            <Button type="button" size="sm" variant="ghost" disabled={!canSend} onClick={() => void send("steer")}>
              Send as steering input
            </Button>
          ) : null}
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
