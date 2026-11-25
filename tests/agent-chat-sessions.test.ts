import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectAgentChatSessionKey,
  directAgentChatSubmissionId,
  readDirectAgentChatSubmissionId,
  resolveAgentChatSessionId,
  selectReusableAgentChatSessions,
  type AgentChatSessionRecord
} from "@/lib/openclaw/domains/agent-chat-sessions";

test("direct chat keys and native submission ids isolate actors, agents, workspaces, and conversations", () => {
  const agent = { id: "worker", workspaceId: "workspace" };
  const key = buildDirectAgentChatSessionKey(agent, "actor");
  assert.match(key, /^agent:worker:agentos-direct:[0-9a-f]{64}$/);
  assert.equal(buildDirectAgentChatSessionKey({ ...agent }, "actor"), key);
  const alternatives = [
    buildDirectAgentChatSessionKey(agent, "another-actor"),
    buildDirectAgentChatSessionKey({ ...agent, id: "worker-2" }, "actor"),
    buildDirectAgentChatSessionKey({ ...agent, workspaceId: "other" }, "actor"),
    buildDirectAgentChatSessionKey(agent, "actor", "another-conversation")
  ];
  assert.equal(new Set([key, ...alternatives]).size, 5);
  const submission = directAgentChatSubmissionId(key, "request-1");
  assert.equal(readDirectAgentChatSubmissionId(key, submission), "request-1");
  for (const alternative of alternatives) {
    assert.equal(readDirectAgentChatSubmissionId(alternative, submission), undefined);
  }
});

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
