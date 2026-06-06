import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractAgentChatMessagesFromSessionHistory,
  extractAssistantTextFromAgentChatStreamLine,
  extractVisibleAgentChatOperatorText,
  extractLatestAssistantTextFromSessionHistory,
  isCompletedEmptyAgentChatResponse,
  sanitizeAgentChatReplyText,
  sanitizeAgentChatVisibleText
} from "@/lib/openclaw/agent-chat-response";

test("agent chat response helper reads assistant stream events", () => {
  assert.equal(
    extractAssistantTextFromAgentChatStreamLine(JSON.stringify({
      type: "assistant",
      text: "Done from Gateway stream."
    })),
    "Done from Gateway stream."
  );
  assert.equal(
    extractAssistantTextFromAgentChatStreamLine(JSON.stringify({
      type: "status",
      message: "thinking"
    })),
    null
  );
});

test("agent chat response helper reads latest assistant history without echoing user text", () => {
  const history = {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Previous answer."
          }
        ]
      },
      {
        role: "user",
        text: "What happened?"
      },
      {
        role: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Latest answer."
            }
          ]
        }
      }
    ]
  };

  assert.equal(extractLatestAssistantTextFromSessionHistory(history), "Latest answer.");
});

test("agent chat response helper extracts user and assistant messages from Gateway history", () => {
  const messages = extractAgentChatMessagesFromSessionHistory({
    messages: [
      {
        id: "user-1",
        role: "user",
        content: [
          "You are chatting directly with the operator inside AgentOS. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards.",
          "",
          "Conversation so far:",
          "Operator: Earlier message",
          "Agent: Earlier reply",
          "",
          "Operator: What is the latest status?"
        ].join("\n"),
        timestamp: "2026-06-06T10:00:00.000Z"
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "The latest status is ready."
          }
        ],
        timestamp: "2026-06-06T10:00:01.000Z"
      }
    ]
  });

  assert.deepEqual(messages, [
    {
      id: "user-1",
      role: "user",
      text: "What is the latest status?",
      timestamp: "2026-06-06T10:00:00.000Z"
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "The latest status is ready.",
      timestamp: "2026-06-06T10:00:01.000Z"
    }
  ]);
});

test("agent chat response helper extracts the visible operator text from composed prompts", () => {
  assert.equal(
    extractVisibleAgentChatOperatorText(
      [
        "You are chatting directly with the operator inside AgentOS. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards.",
        "",
        "Conversation so far:",
        "Operator: Old question",
        "Agent: Old answer",
        "",
        "Operator: New question"
      ].join("\n")
    ),
    "New question"
  );
});

test("agent chat response helper ignores histories without assistant text", () => {
  assert.equal(
    extractLatestAssistantTextFromSessionHistory({
      messages: [
        {
          role: "user",
          text: "Echo me"
        }
      ]
    }),
    null
  );
});

test("agent chat response helper suppresses internal direct chat prompt leaks", () => {
  const leakedPrompt = [
    "You are chatting directly with the operator inside AgentOS. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards.",
    "Answer the operator's latest message directly.",
    "Use the workspace root `AGENTS.md` file as the source of truth for agent-specific roles.",
    "Direct chat mode takes priority over workspace operating docs for this turn: respond to the latest operator message as a chat message unless the operator explicitly asks you to inspect files, continue a task, or modify the workspace.",
    "",
    "Operator: hello"
  ].join("\n");

  assert.equal(sanitizeAgentChatReplyText(leakedPrompt), "");
  assert.equal(
    sanitizeAgentChatReplyText(`${leakedPrompt}\nAgent: Hello. How can I help?`),
    "Hello. How can I help?"
  );
});

test("agent chat visible text suppresses mission control actions", () => {
  assert.equal(
    sanitizeAgentChatVisibleText(
      [
        "I will use Suleyman from now on.",
        "",
        '<mission-control-action>{"type":"rename_agent","name":"Suleyman"}</mission-control-action>'
      ].join("\n")
    ),
    "I will use Suleyman from now on."
  );
  assert.equal(
    sanitizeAgentChatVisibleText(
      [
        "I will use Suleyman from now on.",
        "",
        '<mission-control-action>{"type":"rename_agent"'
      ].join("\n")
    ),
    "I will use Suleyman from now on."
  );
});

test("agent chat response helper detects completed turns without assistant text", () => {
  assert.equal(
    isCompletedEmptyAgentChatResponse({
      meta: {
        emptyAgentChatResponse: true,
        emptyAgentChatStatus: "completed"
      }
    }),
    true
  );
  assert.equal(
    isCompletedEmptyAgentChatResponse({
      meta: {
        emptyAgentChatResponse: true,
        emptyAgentChatStatus: "stalled"
      }
    }),
    false
  );
});
