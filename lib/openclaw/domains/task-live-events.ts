import { buildAgentSessionKey } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import type { OpenClawGatewayEventFrame } from "@/lib/openclaw/client/gateway-client";
import type { TaskDetailRecord, TaskDetailStreamEvent } from "@/lib/openclaw/types";
import { hasScopedTaskSession, resolveTaskFollowUpContext } from "@/lib/openclaw/domains/task-follow-up";

export function resolveTaskLiveTarget(detail: TaskDetailRecord) {
  const { task } = detail;
  const context = resolveTaskFollowUpContext(task);
  if (!context.sessionKey || !context.agentId || !hasScopedTaskSession(context)) return null;

  return {
    sessionKey: context.sessionKey,
    sessionId: context.sessionId,
    runIds: new Set([...task.runIds, ...detail.runs.map((run) => run.runId).filter(Boolean)]),
    dedicated: Boolean(task.dispatchId && context.sessionKey === buildAgentSessionKey(context.agentId, task.dispatchId))
  };
}

export function projectTaskAssistantFrame(
  frame: OpenClawGatewayEventFrame,
  target: NonNullable<ReturnType<typeof resolveTaskLiveTarget>>
): Extract<TaskDetailStreamEvent, { type: "assistant" }> | null {
  if (frame.event !== "chat") return null;
  const payload = readScopedPayload(frame, target);
  if (!payload) return null;

  const state = payload.state;
  if (state !== "delta" && state !== "final" && state !== "aborted" && state !== "error") return null;
  const message = asRecord(payload.message);
  if (message && message.role !== "assistant") return null;

  const content = message?.content;
  const snapshot = Array.isArray(content) ? content.flatMap((item) => {
    const block = asRecord(item);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("\n\n") : null;
  // The native snapshot already contains the accompanying delta.
  const text = snapshot ?? (typeof payload.deltaText === "string" ? payload.deltaText : "");
  if (state === "delta" && !text && payload.replace !== true && snapshot === null) return null;

  return {
    type: "assistant",
    runId: payload.runId,
    sequence: typeof payload.seq === "number" && Number.isSafeInteger(payload.seq) ? payload.seq : null,
    text: text.slice(0, 32_000),
    replace: snapshot !== null || payload.replace === true || state !== "delta",
    timestamp: new Date().toISOString(),
    done: state !== "delta"
  };
}

export function projectTaskToolFrame(frame: OpenClawGatewayEventFrame, target: NonNullable<ReturnType<typeof resolveTaskLiveTarget>>):
  Extract<TaskDetailStreamEvent, { type: "tool" }> | null {
  if (frame.event !== "session.tool" && frame.event !== "agent") return null;
  const payload = readScopedPayload(frame, target);
  if (payload?.stream !== "tool") return null;
  const data = asRecord(payload.data);
  if (!data || typeof data.name !== "string" || typeof data.toolCallId !== "string") return null;
  if (data.phase !== "start" && data.phase !== "result" && data.phase !== "end") return null;
  return { type: "tool", runId: payload.runId, toolCallId: data.toolCallId.slice(0, 220), name: data.name.slice(0, 100),
    phase: data.phase === "start" ? "start" : "result", failed: data.isError === true,
    timestamp: new Date().toISOString() };
}

function readScopedPayload(frame: OpenClawGatewayEventFrame, target: NonNullable<ReturnType<typeof resolveTaskLiveTarget>>) {
  const payload = asRecord(frame.payload);
  if (!payload || payload.sessionKey !== target.sessionKey || typeof payload.runId !== "string" || !payload.runId) return null;
  if (target.sessionId && payload.sessionId && payload.sessionId !== target.sessionId) return null;
  if (!target.runIds.has(payload.runId) && !(target.dedicated && target.sessionId && payload.sessionId === target.sessionId)) return null;
  return { ...payload, runId: payload.runId } as Record<string, unknown> & { runId: string };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
