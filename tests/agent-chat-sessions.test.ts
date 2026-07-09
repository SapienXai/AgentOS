import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAgentChatSessionId,
  selectReusableAgentChatSessions,
  type AgentChatSessionRecord
} from "@/lib/openclaw/domains/agent-chat-sessions";

test("agent chat session reuse prefers the latest session for the same agent and workspace", () => {
  const sessions: AgentChatSessionRecord[] = [
    createSession({
      agentId: "agent-1",
      sessionId: "old-session",
      workspacePath: "/workspace",
      updatedAt: "2026-06-06T09:00:00.000Z"
    }),
    createSession({
      agentId: "agent-2",
      sessionId: "other-agent-session",
      workspacePath: "/workspace",
      updatedAt: "2026-06-06T11:00:00.000Z"
    }),
    createSession({
      agentId: "agent-1",
      sessionId: "other-workspace-session",
      workspacePath: "/other-workspace",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }),
    createSession({
      agentId: "agent-1",
      sessionId: "latest-session",
      workspacePath: "/workspace",
      updatedAt: "2026-06-06T10:00:00.000Z"
    })
  ];

  assert.deepEqual(
    selectReusableAgentChatSessions(sessions, {
      agentId: "agent-1",
      workspacePath: "/workspace"
    }).map((session) => session.sessionId),
    ["latest-session", "old-session"]
  );
});

test("agent chat session resolver can force a fresh explicit session id", async () => {
  const first = await resolveAgentChatSessionId({
    agentId: "agent-1",
    workspacePath: "/workspace",
    reuse: false
  });
  const second = await resolveAgentChatSessionId({
    agentId: "agent-1",
    workspacePath: "/workspace",
    reuse: false
  });

  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.match(second, /^[0-9a-f-]{36}$/i);
  assert.notEqual(first, second);
});

function createSession(overrides: Partial<AgentChatSessionRecord>): AgentChatSessionRecord {
  return {
    agentId: "agent-1",
    sessionId: "session-1",
    workspacePath: "/workspace",
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    origin: "agent-chat",
    ...overrides
  };
}
