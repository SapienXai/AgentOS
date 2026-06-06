import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeAgentChatMessagesForRehydration,
  normalizeAgentChatMessagesForDisplay,
  resolveAgentChatLatestAssistantAt,
  resolveAgentChatUnreadCount,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";

test("agent chat unread counts only completed assistant replies", () => {
  const messages: AgentChatMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "Hello",
      createdAt: 1,
      status: "sent"
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "Still thinking",
      createdAt: 2
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "Final answer",
      createdAt: 3,
      status: "sent"
    }
  ];

  assert.equal(resolveAgentChatLatestAssistantAt(messages), 3);
  assert.equal(resolveAgentChatUnreadCount(messages, null), 1);
  assert.equal(resolveAgentChatUnreadCount(messages, 1), 1);
  assert.equal(resolveAgentChatUnreadCount(messages, 3), 0);
});

test("agent chat display keeps only the active turn pending", () => {
  const messages: AgentChatMessage[] = [
    {
      id: "old-user",
      role: "user",
      text: "Earlier message",
      createdAt: 1,
      status: "sending"
    },
    {
      id: "old-assistant",
      role: "assistant",
      text: "Earlier draft",
      createdAt: 2,
      status: "sending"
    },
    {
      id: "active-user",
      role: "user",
      text: "Current message",
      createdAt: 3,
      status: "sending"
    },
    {
      id: "active-assistant",
      role: "assistant",
      text: "",
      createdAt: 4,
      status: "sending"
    }
  ];

  const visibleMessages = normalizeAgentChatMessagesForDisplay(messages, {
    isRunning: true,
    userMessageId: "active-user",
    assistantMessageId: "active-assistant"
  });

  assert.deepEqual(
    visibleMessages.map((message) => ({
      id: message.id,
      status: message.status
    })),
    [
      { id: "old-user", status: "sent" },
      { id: "old-assistant", status: "error" },
      { id: "active-user", status: "sending" },
      { id: "active-assistant", status: "sending" }
    ]
  );
});

test("agent chat rehydration merges OpenClaw history without duplicating local messages", () => {
  const currentMessages: AgentChatMessage[] = [
    {
      id: "local-user",
      role: "user",
      text: "Hello",
      createdAt: 1,
      status: "sent"
    },
    {
      id: "local-assistant",
      role: "assistant",
      text: "Local reply",
      createdAt: 2,
      status: "sent"
    }
  ];
  const rehydratedMessages: AgentChatMessage[] = [
    {
      id: "openclaw-user",
      role: "user",
      text: "Hello",
      createdAt: 10,
      status: "sent"
    },
    {
      id: "openclaw-assistant",
      role: "assistant",
      text: "OpenClaw reply",
      createdAt: 11,
      status: "sent",
      runId: "run-1"
    }
  ];

  const merged = mergeAgentChatMessagesForRehydration(currentMessages, rehydratedMessages);

  assert.deepEqual(
    merged.map((message) => ({
      role: message.role,
      text: message.text,
      status: message.status,
      runId: message.runId
    })),
    [
      { role: "user", text: "Hello", status: "sent", runId: undefined },
      { role: "assistant", text: "Local reply", status: "sent", runId: undefined },
      { role: "assistant", text: "OpenClaw reply", status: "sent", runId: "run-1" }
    ]
  );
});
