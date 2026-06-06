import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readAgentChatTranscriptMessages,
  readLatestAgentChatTurn
} from "@/lib/openclaw/domains/agent-chat-transcript";

test("agent chat transcript resolves OpenClaw session catalog aliases for explicit AgentOS session ids", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agentos-chat-transcript-"));
  const sessionsDir = path.join(workspacePath, ".openclaw", "agents", "agent-1", "sessions");
  const agentOsSessionId = "agentos-session-1";
  const openClawSessionId = "openclaw-session-1";
  const sessionFile = path.join(sessionsDir, `${openClawSessionId}.jsonl`);

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, "sessions.json"),
    JSON.stringify({
      [`agent:agent-1:explicit:${agentOsSessionId}`]: {
        sessionId: openClawSessionId,
        sessionFile
      }
    }),
    "utf8"
  );
  await writeFile(
    sessionFile,
    [
      {
        type: "session",
        version: 3,
        id: openClawSessionId,
        timestamp: "2026-05-20T20:54:05.285Z",
        cwd: workspacePath
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-05-20T20:54:18.553Z",
        message: {
          role: "user",
          content: "hey how are you"
        }
      },
      {
        type: "message",
        id: "assistant-1",
        parentId: "user-1",
        timestamp: "2026-05-20T20:54:18.554Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "I am good. How are you?"
            }
          ],
          stopReason: "stop"
        }
      }
    ].map((entry) => JSON.stringify(entry)).join("\n"),
    "utf8"
  );

  const turn = await readLatestAgentChatTurn("agent-1", agentOsSessionId, workspacePath);

  assert.equal(turn?.status, "completed");
  assert.equal(turn?.finalText, "I am good. How are you?");
});

test("agent chat transcript messages rehydrate visible chat without internal prompt text", async () => {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agentos-chat-rehydrate-"));
  const sessionsDir = path.join(workspacePath, ".openclaw", "agents", "agent-1", "sessions");
  const sessionId = "agentos-session-2";
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    sessionFile,
    [
      {
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-05-20T20:54:05.285Z",
        cwd: workspacePath
      },
      {
        type: "message",
        id: "user-1",
        timestamp: "2026-05-20T20:54:18.553Z",
        message: {
          role: "user",
          content: [
            "You are chatting directly with the operator inside AgentOS. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards.",
            "",
            "Conversation so far:",
            "Operator: Old question",
            "Agent: Old answer",
            "",
            "Operator: New question"
          ].join("\n")
        }
      },
      {
        type: "message",
        id: "assistant-1",
        parentId: "user-1",
        timestamp: "2026-05-20T20:54:19.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "New answer."
            }
          ],
          stopReason: "stop"
        }
      }
    ].map((entry) => JSON.stringify(entry)).join("\n"),
    "utf8"
  );

  const messages = await readAgentChatTranscriptMessages("agent-1", sessionId, workspacePath);

  assert.deepEqual(
    messages.map((message) => ({
      role: message.role,
      text: message.text,
      status: message.status,
      runId: message.runId
    })),
    [
      { role: "user", text: "New question", status: "sent", runId: null },
      { role: "assistant", text: "New answer.", status: "sent", runId: null }
    ]
  );
});
