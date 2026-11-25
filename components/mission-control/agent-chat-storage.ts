export type AgentChatRole = "user" | "assistant" | "system";
export type AgentChatStatus = "sending" | "sent" | "error";

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  createdAt: number;
  status?: AgentChatStatus;
  errorMessage?: string | null;
  runId?: string | null;
  submissionId?: string | null;
  messageSeq?: number | null;
  localAction?: boolean;
};

export const agentChatMessageStoragePrefix = "mission-control-agent-chat:v1";
export const agentChatLastSeenStoragePrefix = "mission-control-agent-chat-seen:v1";
export const agentInboxLastSeenStoragePrefix = "mission-control-agent-inbox-seen:v1";
export const agentChatStateEventName = "mission-control-agent-chat-state-change";
export const maxAgentChatMessages = 120;
const agentChatMessages = new Map<string, AgentChatMessage[]>();
let clearedLegacyChat = false;

export type AgentChatVisibleRunSnapshot = {
  runs: readonly { userMessageId: string; assistantMessageId: string }[];
};

function getLastSeenStorageKey(agentId: string) {
  return `${agentChatLastSeenStoragePrefix}:${agentId}`;
}

function getInboxLastSeenStorageKey(agentId: string) {
  return `${agentInboxLastSeenStoragePrefix}:${agentId}`;
}

function isAgentChatMessage(candidate: unknown): candidate is AgentChatMessage {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const entry = candidate as Partial<AgentChatMessage> & Record<string, unknown>;

  return (
    (entry.role === "user" || entry.role === "assistant" || entry.role === "system") &&
    typeof entry.id === "string" &&
    typeof entry.text === "string" &&
    typeof entry.createdAt === "number" &&
    (entry.errorMessage === undefined ||
      entry.errorMessage === null ||
      typeof entry.errorMessage === "string") &&
    (entry.status === undefined ||
      entry.status === "sending" ||
      entry.status === "sent" ||
      entry.status === "error")
    && (entry.submissionId === undefined || entry.submissionId === null || typeof entry.submissionId === "string")
    && (entry.messageSeq === undefined || entry.messageSeq === null ||
      (typeof entry.messageSeq === "number" && Number.isSafeInteger(entry.messageSeq) && entry.messageSeq >= 0))
  );
}

export function readAgentChatMessages(agentId: string): AgentChatMessage[] {
  if (!clearedLegacyChat && typeof window !== "undefined") {
    try {
      const storage = window.localStorage;
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index);
        if (key?.startsWith(`${agentChatMessageStoragePrefix}:`)) storage.removeItem(key);
      }
      clearedLegacyChat = true;
    } catch {
      // The current chat works even if browser storage is unavailable.
    }
  }
  return agentChatMessages.get(agentId) ?? [];
}

export function normalizeAgentChatMessagesForDisplay(
  messages: readonly AgentChatMessage[],
  runSnapshot: AgentChatVisibleRunSnapshot
) {
  const activeMessageIds = new Set(runSnapshot.runs.flatMap(({ userMessageId, assistantMessageId }) =>
    [userMessageId, assistantMessageId]
  ));

  return messages
    .map((entry) => {
      if (entry.status !== "sending") {
        return entry;
      }

      if (activeMessageIds.has(entry.id)) {
        return entry;
      }

      return entry.role === "assistant" ? { ...entry, status: "error" as const } : { ...entry, status: "sent" as const };
    })
    .filter(
      (entry) =>
        entry.role !== "assistant" ||
        entry.text.trim().length > 0 ||
        activeMessageIds.has(entry.id)
    );
}

export function writeAgentChatMessages(agentId: string, messages: AgentChatMessage[]) {
  agentChatMessages.set(agentId, messages.slice(-maxAgentChatMessages));
  dispatchAgentChatStateChange(agentId);
}

export function clearAgentChatMessages() {
  agentChatMessages.clear();
}

export function reconcileAgentChatMessages(
  currentMessages: readonly AgentChatMessage[],
  serverMessages: readonly AgentChatMessage[]
) {
  const pendingMessages = currentMessages.filter((message) =>
    message.status === "sending" || message.status === "error" || message.localAction
  );
  return mergeAgentChatMessagesForRehydration(pendingMessages, serverMessages);
}

export function mergeAgentChatMessagesForRehydration(
  currentMessages: readonly AgentChatMessage[],
  rehydratedMessages: readonly AgentChatMessage[]
) {
  const byId = new Map<string, AgentChatMessage>();
  const byIdentity = new Map<string, AgentChatMessage>();

  for (const message of [...currentMessages, ...rehydratedMessages]) {
    if (!isAgentChatMessage(message)) {
      continue;
    }

    const identityKey = message.submissionId?.trim()
      ? `submission:${message.role}:${message.submissionId.trim()}`
      : `message:${message.id}`;
    const existing = byIdentity.get(identityKey);
    const next = existing ? chooseRehydratedAgentChatMessage(existing, message) : message;
    byIdentity.set(identityKey, next);
    if (existing && existing.id !== next.id) {
      byId.delete(existing.id);
    }
    byId.set(next.id, next);
  }

  return [...byId.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-maxAgentChatMessages);
}

export function readAgentChatLastSeenAt(agentId: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(getLastSeenStorageKey(agentId));
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readAgentInboxLastSeenAt(agentId: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(getInboxLastSeenStorageKey(agentId));
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function chooseRehydratedAgentChatMessage(left: AgentChatMessage, right: AgentChatMessage) {
  const createdAt = Math.min(left.createdAt, right.createdAt);
  const statusDelta = scoreAgentChatStatus(right.status) - scoreAgentChatStatus(left.status);
  if (statusDelta > 0) {
    return { ...right, createdAt };
  }

  if (statusDelta < 0) {
    return { ...left, createdAt };
  }

  return right.createdAt > left.createdAt ? { ...right, createdAt } : { ...left, createdAt };
}

function scoreAgentChatStatus(status: AgentChatStatus | undefined) {
  if (status === "sent") {
    return 3;
  }

  if (status === "sending") {
    return 2;
  }

  if (status === "error") {
    return 1;
  }

  return 0;
}

export function writeAgentChatLastSeenAt(agentId: string, lastSeenAt: number | null) {
  try {
    const key = getLastSeenStorageKey(agentId);
    const nextValue = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? String(lastSeenAt) : null;
    const currentValue = globalThis.localStorage?.getItem(key) ?? null;

    if (currentValue === nextValue) {
      return;
    }

    if (nextValue !== null) {
      globalThis.localStorage?.setItem(key, nextValue);
    } else {
      globalThis.localStorage?.removeItem(key);
    }

    dispatchAgentChatStateChange(agentId);
  } catch {
    // Ignore storage failures.
  }
}

export function resolveAgentChatLatestAssistantAt(messages: AgentChatMessage[]) {
  let latest = null as number | null;

  for (const message of messages) {
    if (message.role !== "assistant" || message.status !== "sent") {
      continue;
    }

    if (latest === null || message.createdAt > latest) {
      latest = message.createdAt;
    }
  }

  return latest;
}

export function resolveAgentChatUnreadCount(messages: AgentChatMessage[], lastSeenAt: number | null) {
  if (messages.length === 0) {
    return 0;
  }

  const seenAt = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? lastSeenAt : null;

  return messages.reduce((count, message) => {
    if (message.role !== "assistant" || message.status !== "sent") {
      return count;
    }

    if (seenAt !== null && message.createdAt <= seenAt) {
      return count;
    }

    return count + 1;
  }, 0);
}

export function resolveAgentInboxUnreadCount(
  inboxItems: readonly { updatedAt: number | null }[],
  lastSeenAt: number | null
) {
  if (inboxItems.length === 0) {
    return 0;
  }

  const seenAt = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? lastSeenAt : null;

  return inboxItems.reduce((count, item) => {
    if (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) {
      return count;
    }

    if (seenAt !== null && item.updatedAt <= seenAt) {
      return count;
    }

    return count + 1;
  }, 0);
}

export function markAgentChatAsSeen(agentId: string, messages?: AgentChatMessage[]) {
  const latestAssistantAt = resolveAgentChatLatestAssistantAt(messages ?? readAgentChatMessages(agentId));
  writeAgentChatLastSeenAt(agentId, latestAssistantAt);
}

export function markAgentInboxAsSeen(agentId: string, inboxItems: readonly { updatedAt: number | null }[]) {
  const latestInboxAt = inboxItems.reduce((latest, item) => {
    if (typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) {
      return latest;
    }

    return latest === null || item.updatedAt > latest ? item.updatedAt : latest;
  }, null as number | null);
  writeAgentInboxLastSeenAt(agentId, latestInboxAt);
}

function writeAgentInboxLastSeenAt(agentId: string, lastSeenAt: number | null) {
  try {
    const key = getInboxLastSeenStorageKey(agentId);
    const nextValue = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? String(lastSeenAt) : null;
    const currentValue = globalThis.localStorage?.getItem(key) ?? null;

    if (currentValue === nextValue) {
      return;
    }

    if (nextValue !== null) {
      globalThis.localStorage?.setItem(key, nextValue);
    } else {
      globalThis.localStorage?.removeItem(key);
    }

    dispatchAgentChatStateChange(agentId);
  } catch {
    // Ignore storage failures.
  }
}

export function dispatchAgentChatStateChange(agentId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(agentChatStateEventName, {
      detail: { agentId }
    })
  );
}
