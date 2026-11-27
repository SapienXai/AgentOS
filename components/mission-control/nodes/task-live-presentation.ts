import type { TaskAssistantUpdate, TaskToolUpdate } from "@/hooks/use-task-feed";
import type { AttentionItem, TaskDetailRecord, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";
import type { TaskStreamArtifact } from "@/lib/openclaw/types";
import { compactMissionText, stripMissionRouting } from "@/lib/openclaw/presenters";
import { readTaskThinkingRejection } from "@/lib/openclaw/task-reasoning";
import { resolveTaskFollowUpDisplayMessage } from "@/lib/openclaw/domains/task-follow-up-records";
import { isWaitingForOutputCopy, resolveTaskDispatchIssueDetail } from "@/components/mission-control/task-node-status";

export type TaskConversationEntry = {
  id: string;
  kind: "assistant" | "user" | "tool" | "artifact" | "warning";
  timestamp: string;
  title: string;
  text: string;
  agentId?: string;
  href?: string;
  toolPhase?: "start" | "result";
  toolCallId?: string;
  durationMs?: number;
  failed?: boolean;
  streaming?: boolean;
  delivery?: string;
};

export type TaskMessageReceipt = {
  id: string;
  message: string;
  timestamp: string;
  status: "sending" | "queued" | "accepted" | "rejected" | "unconfirmed";
  runId?: string;
};

export function attachTaskMessageReceipts(
  entries: TaskConversationEntry[],
  task: WorkItemRecord,
  local: TaskMessageReceipt[],
  updates: TaskAssistantUpdate[],
  detail: TaskDetailRecord | null
) {
  const receipts = new Map(local.map((receipt) => [receipt.id, receipt]));
  const history = task.metadata.operatorHistory;
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (entry?.kind !== "message" || typeof entry.idempotencyKey !== "string" ||
          typeof entry.message !== "string" || typeof entry.requestedAt !== "string") continue;
      receipts.set(entry.idempotencyKey, { id: entry.idempotencyKey, message: entry.message,
        timestamp: receipts.get(entry.idempotencyKey)?.timestamp ?? entry.requestedAt,
        status: entry.status === "queued" ? "queued" : "accepted",
        runId: typeof entry.runId === "string" ? entry.runId : undefined });
    }
  }
  if (!receipts.size) return entries;
  const next = [...entries];
  const matched = new Set<number>();
  for (const receipt of receipts.values()) {
    const update = receipt.runId ? updates.find((entry) => entry.runId === receipt.runId) : null;
    const run = receipt.runId ? detail?.runs.find((entry) => entry.runId === receipt.runId) : null;
    const activity = receipt.runId ? detail?.messageActivity?.[receipt.runId] : null;
    const index = next.findIndex((entry, position) => entry.kind === "user" && !matched.has(position) &&
      isSameTaskMessage(entry.text, entry.timestamp, receipt.message, receipt.timestamp));
    const delivery = update?.outcome === "error" || run?.status === "stalled" ? "Reply failed"
      : update?.outcome === "aborted" || run?.status === "cancelled" || activity === "cancelled" ? "Reply cancelled"
      : update?.text ? (update.done ? "Responded" : "Responding…")
      : activity === "processing" || run?.status === "running" ? "Processing"
      : activity === "recorded" ? "Recorded by OpenClaw"
      : activity === "queued" ? "Queued"
      : index !== -1 ? "Recorded by OpenClaw"
      : receipt.status === "sending" ? "Sending…" : receipt.status === "queued" ? "Queued"
      : receipt.status === "unconfirmed" ? "Delivery unconfirmed" : receipt.status === "rejected" ? "Failed to send" : "Accepted by OpenClaw";
    if (index === -1) {
      matched.add(next.length);
      next.push({ id: `receipt:${receipt.id}`, kind: "user", title: "You", text: receipt.message,
        timestamp: receipt.timestamp, delivery });
    } else {
      matched.add(index);
      next[index] = { ...next[index], id: `receipt:${receipt.id}`, delivery };
    }
  }
  return next.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export type LiveTaskState = "Queued" | "Running" | "Waiting" | "Needs approval" | "Blocked" | "Completed" | "Failed" | "Cancelled" | "Scheduled" | "Paused" | "Needs review" | "Status unknown";

export function resolveLiveTaskState(task: WorkItemRecord, detail: TaskDetailRecord | null, attention: AttentionItem[]): LiveTaskState {
  const error = readTaskFailure(task, detail);
  if (task.status === "cancelled") return "Cancelled";
  if (error || task.status === "stalled") return "Failed";
  if (task.metadata.operationStatus === "paused") return "Paused";
  if (task.metadata.operationStatus === "scheduled") return "Scheduled";
  if (task.status === "completed") {
    if (detail?.integrity.status === "error" && !detail.integrity.finalResponseText) return "Needs review";
    return "Completed";
  }
  if (attention.some((item) => item.type === "approval")) return "Needs approval";
  if (attention.some((item) => item.type === "question")) return "Waiting";
  if (attention.some((item) => item.type === "blocked" || item.type === "needs-setup")) return "Blocked";
  if (task.status === "queued") return "Queued";
  if (task.status === "running" && task.metadata.nativeSessionActive !== false) return "Running";
  return "Status unknown";
}

export function readTaskFailure(task: WorkItemRecord, detail: TaskDetailRecord | null) {
  const primary = detail?.outputs.find((output) => output.runtimeId === task.primaryRuntimeId);
  if (task.status === "completed" && primary?.stopReason === "stop" && primary.finalText &&
      !primary.errorMessage && !readTaskThinkingRejection(primary.finalText)) return null;
  const dispatchIssue = resolveTaskDispatchIssueDetail(task, detail?.integrity);
  const reasoning = readTaskThinkingRejection(dispatchIssue, stringValue(task.metadata.resultPreview), task.subtitle,
    detail?.integrity.finalResponseText);
  if (reasoning) return { summary: "The model rejected the reasoning setting.", technical: reasoning, reasoning: true };
  if (task.status === "running" || task.status === "queued" || task.status === "cancelled") return null;
  const output = primary ?? (detail?.outputs.length === 1 ? detail.outputs[0] : null);
  const terminalError = output?.stopReason === "error" || output?.stopReason === "aborted" ? output.errorMessage || output.finalText : null;
  const issue = dispatchIssue || terminalError || (task.status === "completed" && !detail?.integrity.finalResponseText
    ? stringValue(task.metadata.dispatchError) : null);
  if (!issue) {
    if (task.status === "stalled") return { summary: "The task ended before a successful result arrived.", technical: null, reasoning: false };
    return null;
  }
  return {
    summary: /model|credential|auth(?:entication)?|api key/i.test(issue)
      ? "OpenClaw could not start or finish with this model. Check the model connection before retrying."
      : /timed out|unconfirmed/i.test(issue)
        ? "OpenClaw could not confirm the result. Check the available activity before retrying."
        : "OpenClaw reported a task failure. Review the details before retrying.",
    technical: issue,
    reasoning: false
  };
}

export function buildTaskConversation(task: WorkItemRecord, detail: TaskDetailRecord | null, feed: TaskFeedEvent[], updates: TaskAssistantUpdate[], liveTools: TaskToolUpdate[] = [], artifacts: TaskStreamArtifact[] = []) {
  const entries: TaskConversationEntry[] = [];
  const seen = new Set<string>();
  const runtimeById = new Map(detail?.runs.map((run) => [run.id, run]));
  const append = (entry: TaskConversationEntry) => {
    if (!entry.text && entry.kind !== "tool") return;
    const signature = JSON.stringify([entry.kind, entry.timestamp, entry.title, entry.text, entry.toolPhase, entry.toolCallId]);
    if (seen.has(signature)) return;
    seen.add(signature);
    entries.push(entry);
  };

  const conversation = detail?.conversation;
  const outputs = conversation?.length
    ? [{ runtimeId: task.primaryRuntimeId ?? "", items: conversation }]
    : detail?.outputs ?? [];
  for (const output of outputs) {
    for (const item of output.items) {
      if (item.role === "user") {
        const text = readTaskOperatorMessage(item.text);
        const initialPrompt = [task.mission, task.title].some((input) => input?.trim() &&
          (normalize(text) === normalize(input) || text.startsWith(`${input.trim()}\n`)));
        if (text && !initialPrompt) {
          append({ id: item.id, kind: "user", title: "You", text, timestamp: item.timestamp });
        }
        continue;
      }
      const runtime = runtimeById.get(output.runtimeId);
      if (item.role === "assistant") {
        if (!item.isError && !readTaskThinkingRejection(item.text)) append({
          id: item.id, kind: "assistant", title: "Agent", text: item.text, timestamp: item.timestamp, agentId: runtime?.agentId
        });
        continue;
      }
      append({
        id: item.id, kind: "tool", title: formatTaskToolName(item.toolName), timestamp: item.timestamp,
        text: item.role === "toolResult" ? readDisplayToolText(item.text) : "",
        toolPhase: item.role === "toolResult" ? "result" : "start", failed: item.isError,
        toolCallId: item.toolCallId
      });
    }
  }

  for (const item of feed) {
    if (item.kind === "user" && item.title !== "Mission" && item.title !== "Task message sent") {
      const text = readTaskOperatorMessage(item.detail);
      if (text && !entries.some((entry) => entry.kind === "user" && isSameTaskMessage(entry.text, entry.timestamp, text, item.timestamp))) {
        append({ id: item.id, kind: "user", title: "You", text, timestamp: item.timestamp });
      }
    }
    if (item.kind === "assistant" && !item.isError && !readTaskThinkingRejection(item.detail) && !entries.some((entry) =>
      entry.kind === "assistant" && normalize(entry.text).startsWith(normalize(item.detail).replace(/…$/, "")))) {
      append({ id: item.id, kind: "assistant", title: item.title, text: item.detail, timestamp: item.timestamp, agentId: item.agentId });
    }
  }

  for (const tool of liveTools) {
    if (entries.some((entry) => entry.toolCallId === tool.toolCallId && entry.toolPhase === tool.phase)) continue;
    append({ id: `tool:${tool.runId}:${tool.toolCallId}:${tool.phase}`, kind: "tool", title: formatTaskToolName(tool.name),
      timestamp: tool.timestamp, text: "", toolCallId: tool.toolCallId, toolPhase: tool.phase, failed: tool.failed,
      streaming: tool.phase === "start" });
  }

  for (const file of artifacts) append({ kind: "artifact", title: "File created", id: file.id, href: file.href, text: file.label, timestamp: file.timestamp });

  for (const update of updates) {
    if (!update.text.trim() || readTaskThinkingRejection(update.text)) continue;
    if (entries.some((entry) => entry.kind === "assistant" && normalize(entry.text) === normalize(update.text))) continue;
    append({ id: "stream:" + update.runId, kind: "assistant", title: "Agent", text: update.text,
      timestamp: update.timestamp, streaming: !update.done });
  }
  const originalResult = stringValue(task.metadata.dispatchResultText);
  const finalText = originalResult || detail?.integrity.finalResponseText || stringValue(task.metadata.finalResponseText);
  const timestamp = validTimestamp(originalResult ? stringValue(task.metadata.dispatchRunnerFinishedAt) : task.updatedAt)
    ?? validTimestamp(task.updatedAt);
  if (task.status === "completed" && finalText && timestamp && !isWaitingForOutputCopy(finalText) &&
      !readTaskThinkingRejection(finalText) && !entries.some((entry) => entry.kind === "assistant" &&
        (normalize(entry.text).startsWith(normalize(finalText).replace(/…$/, "")) || normalize(finalText).startsWith(normalize(entry.text))))) {
    append({ id: `${task.id}:result`, kind: "assistant", title: "Agent", text: finalText, timestamp });
  }
  const ordered = entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const starts = new Map(ordered.flatMap((entry) => entry.toolPhase === "start" && entry.toolCallId ? [[entry.toolCallId, entry]] : []));
  const results = new Set(ordered.flatMap((entry) => entry.toolPhase === "result" && entry.toolCallId ? [entry.toolCallId] : []));
  const displayed = new Set<string>();
  return ordered.flatMap((entry) => {
    const callId = entry.toolCallId;
    if (!callId) return [entry];
    if (entry.toolPhase === "start" && results.has(callId)) return [];
    if (displayed.has(callId)) return [];
    displayed.add(callId);
    const start = starts.get(callId);
    return [{ ...entry, id: `tool:${callId}`, ...(start && entry.toolPhase === "result"
      ? { durationMs: Math.max(0, Date.parse(entry.timestamp) - Date.parse(start.timestamp)) } : {}) }];
  });
}

function readTaskOperatorMessage(message: string) {
  if (/^Continue this task in the existing task context\./i.test(message)) {
    return resolveTaskFollowUpDisplayMessage({ prompt: message, message: "", summary: null }) ?? "";
  }
  return stripMissionRouting(message);
}

export function isSameTaskMessage(left: string, leftTime: string, right: string, rightTime: string) {
  if (Math.abs(Date.parse(leftTime) - Date.parse(rightTime)) > 30_000) return false;
  const a = normalize(left);
  const b = normalize(right);
  return a === b || (a.endsWith("…") && b.startsWith(a.slice(0, -1))) || (b.endsWith("…") && a.startsWith(b.slice(0, -1)));
}

export function readTaskCardUpdate(task: WorkItemRecord, state: LiveTaskState, entries: TaskConversationEntry[], attention: AttentionItem[], failure: ReturnType<typeof readTaskFailure>) {
  if (failure && state === "Failed") return failure.summary;
  if (attention.length && state !== "Cancelled") return attention[0].title;
  const latest = entries.findLast((entry) => entry.kind !== "user");
  if (latest?.kind === "tool" && state === "Running") return latest.toolPhase === "start" ? latest.title : `${latest.title} ${latest.failed ? "reported an issue" : "returned"}`;
  const text = state === "Completed"
    ? stringValue(task.metadata.dispatchResultText) ?? stringValue(task.metadata.finalResponseText) ?? stringValue(task.metadata.resultPreview)
    : entries.findLast((entry) => entry.kind === "assistant")?.text ?? stringValue(task.metadata.resultPreview);
  if (text && (state === "Running" || state === "Completed" || state === "Needs review") &&
      !isWaitingForOutputCopy(text) && !/^(dispatch runner finished\b|(?:agent|chat|session\.message|sessions\.changed)$)/i.test(text.trim())) {
    return compactMissionText(text.replace(/\[([^\]]+)\]\(https?:[^\s)]+\)/g, "$1").replace(/\*\*|__|`/g, ""), 125);
  }
  if (task.artifactCount && state === "Completed") return `${task.artifactCount} ${task.artifactCount === 1 ? "file" : "files"} created`;
  if (state === "Running") return "The agent is working in this task session.";
  if (state === "Queued") return "Waiting for the agent to start.";
  if (state === "Cancelled") return "Execution stopped.";
  if (state === "Scheduled" || state === "Paused") return stringValue(task.metadata.scheduleLabel) ?? "OpenClaw schedule";
  if (state === "Completed") return "No result has been captured.";
  if (state === "Needs review") return "No verified final answer was captured.";
  if (state === "Status unknown") return "OpenClaw has not confirmed the execution state.";
  return "Waiting for an OpenClaw update.";
}

export function formatTaskToolName(name?: string) {
  if (!name) return "Tool";
  const normalized = name.toLowerCase();
  if (normalized === "exec") return "Run command";
  if (normalized === "web_search") return "Web search";
  if (normalized === "web_fetch") return "Read web page";
  if (normalized === "read") return "Read file";
  if (normalized === "write") return "Write file";
  if (normalized === "edit") return "Edit file";
  return name.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function readDisplayToolText(text: string) {
  const value = text.trim();
  if (!value || /^[{[]/.test(value)) return "";
  return value.slice(0, 1800);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function validTimestamp(value: number | string | null | undefined) {
  const ms = typeof value === "string" ? Date.parse(value) : value && value < 10_000_000_000 ? value * 1000 : value;
  return typeof ms === "number" && Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}
