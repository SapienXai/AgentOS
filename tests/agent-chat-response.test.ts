import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractAssistantTextFromAgentChatStreamLine,
  extractLatestAssistantTextFromSessionHistory,
  sanitizeAgentChatReplyText
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
