import { readFile } from "node:fs/promises";

import {
  extractVisibleAgentChatOperatorText,
  sanitizeAgentChatVisibleText
} from "@/lib/openclaw/agent-chat-response";
import {
  extractTranscriptTurns,
  filterTranscriptTurnsForRuntime,
  resolveRuntimeTranscriptPath,
  type TranscriptTurn
} from "@/lib/openclaw/domains/runtime-transcript";
import type { RuntimeRecord } from "@/lib/openclaw/types";

function createTranscriptRuntime(agentId: string, sessionId: string): RuntimeRecord {
  return {
    id: `agent-chat:${sessionId}`,
    source: "session",
    key: `${agentId}:${sessionId}`,
    title: "Agent chat session",
    subtitle: "",
    status: "running",
    updatedAt: Date.now(),
    ageMs: 0,
    agentId,
    sessionId,
    metadata: {},
    toolNames: [],
    runId: sessionId
  };
}

export async function readLatestAgentChatTurn(
  agentId: string,
  sessionId: string,
  workspacePath?: string
): Promise<TranscriptTurn | null> {
  const transcriptPath = await resolveRuntimeTranscriptPath(agentId, sessionId, workspacePath);

  if (!transcriptPath) {
    return null;
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const runtime = createTranscriptRuntime(agentId, sessionId);
    const turns = filterTranscriptTurnsForRuntime(runtime, extractTranscriptTurns(raw, runtime, workspacePath));
    return turns.at(-1) ?? null;
  } catch {
    return null;
  }
}

export type AgentChatTranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  status: "sent";
  runId?: string | null;
};

export async function readAgentChatTranscriptMessages(
  agentId: string,
  sessionId: string,
  workspacePath?: string
): Promise<AgentChatTranscriptMessage[]> {
  const transcriptPath = await resolveRuntimeTranscriptPath(agentId, sessionId, workspacePath);

  if (!transcriptPath) {
    return [];
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const runtime = createTranscriptRuntime(agentId, sessionId);
    const turns = filterTranscriptTurnsForRuntime(runtime, extractTranscriptTurns(raw, runtime, workspacePath));

    return turns.flatMap((turn) => createAgentChatMessagesFromTurn(sessionId, turn));
  } catch {
    return [];
  }
}

function createAgentChatMessagesFromTurn(sessionId: string, turn: TranscriptTurn): AgentChatTranscriptMessage[] {
  const messages: AgentChatTranscriptMessage[] = [];
  const userText = extractVisibleAgentChatOperatorText(turn.prompt);
  const userCreatedAt = Date.parse(turn.timestamp);

  if (userText) {
    messages.push({
      id: `openclaw:${sessionId}:${turn.id}:user`,
      role: "user",
      text: userText,
      createdAt: Number.isNaN(userCreatedAt) ? Date.now() : userCreatedAt,
      status: "sent",
      runId: turn.runId ?? null
    });
  }

  const assistantText = sanitizeAgentChatVisibleText(turn.finalText ?? "");
  const assistantCreatedAt = Date.parse(turn.finalTimestamp ?? turn.updatedAt);

  if (assistantText) {
    messages.push({
      id: `openclaw:${sessionId}:${turn.id}:assistant`,
      role: "assistant",
      text: assistantText,
      createdAt: Number.isNaN(assistantCreatedAt) ? Date.now() : assistantCreatedAt,
      status: "sent",
      runId: turn.runId ?? null
    });
  }

  return messages;
}
