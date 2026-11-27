import { getTaskDetail } from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import type { AttentionItem, TaskDetailRecord, TaskDetailStreamEvent } from "@/lib/agentos/contracts";
import type { TaskStreamArtifact } from "@/lib/openclaw/types";
import {
  getOpenClawEventBridgeStreamStatus,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import type { OpenClawGatewayEventFrame, OpenClawGatewayEventSubscription } from "@/lib/openclaw/client/gateway-client";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { projectTaskAssistantFrame, projectTaskToolFrame, resolveTaskLiveTarget } from "@/lib/openclaw/domains/task-live-events";
import { parseRuntimeOutputFromSessionHistory } from "@/lib/openclaw/domains/runtime-transcript";
import { getCachedOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { getHumanControlInbox } from "@/lib/openclaw/application/human-control-inbox-service";
import { loadMissionArtifacts } from "@/lib/agentos/application/workforce-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { canAgentOsActorUseProductPermission, requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { createTaskDetailStreamRefreshController } from "@/lib/agentos/application/task-detail-stream-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const taskAttentionEvents = /^(?:(?:exec|plugin)\.approval|question)\.(?:requested|resolved)$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);
  const searchParams = new URL(request.url).searchParams;
  const dispatchId = searchParams.get("dispatchId");
  const liveConversation = searchParams.get("live") === "1";
  const taskHistoryCursor = searchParams.get("cursor") || null;
  const rawTaskHistoryLimit = searchParams.get("limit");
  const parsedTaskHistoryLimit = rawTaskHistoryLimit ? Number(rawTaskHistoryLimit) : undefined;
  const taskHistoryLimit = parsedTaskHistoryLimit !== undefined && Number.isFinite(parsedTaskHistoryLimit)
    ? parsedTaskHistoryLimit
    : undefined;
  let closed = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let refreshController: ReturnType<typeof createTaskDetailStreamRefreshController> | null = null;
  let unsubscribeGatewayEvents: (() => void) | undefined;
  let nativeSessionSubscription: OpenClawGatewayEventSubscription | undefined;
  let nativeSessionKey: string | null = null;
  let liveTarget: ReturnType<typeof resolveTaskLiveTarget> = null;
  const pendingChatSnapshots = new Map<string, OpenClawGatewayEventFrame>();
  let attention: AttentionItem[] | undefined;
  let lastAttentionSync = 0;
  let abortListener: (() => void) | undefined;
  const relatedIds = new Set([taskId, dispatchId].filter((value): value is string => Boolean(value)));

  const authorization = await requireAgentOsProductPermission(request, "runtime.inspect");
  if ("response" in authorization) return authorization.response;

  const visibleSnapshot = await getMissionControlSnapshot({ includeHidden: false });
  const visibleTask = visibleSnapshot.tasks.find((candidate) =>
    candidate.id === taskId || (dispatchId && candidate.dispatchId === dispatchId)
  );
  if (
    !visibleTask ||
    (dispatchId && visibleTask.dispatchId !== dispatchId) ||
    (!visibleTask.dispatchId && taskId !== visibleTask.id)
  ) {
    return Response.json({ error: "Task was not found." }, { status: 404 });
  }

  if (taskHistoryCursor && request.headers.get("accept") === "application/json") {
    try {
      const detail = await getTaskDetail(taskId, { dispatchId, taskHistoryCursor, taskHistoryLimit });
      return Response.json(redactSecrets(detail), { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return Response.json({ error: redactErrorMessage(error, "Unable to load task history.") }, { status: 503 });
    }
  }

  const cleanup = () => {
    refreshController?.close();
    refreshController = null;
    unsubscribeGatewayEvents?.();
    unsubscribeGatewayEvents = undefined;
    nativeSessionSubscription?.close();
    nativeSessionSubscription = undefined;
    nativeSessionKey = null;
    if (abortListener) {
      request.signal.removeEventListener("abort", abortListener);
      abortListener = undefined;
    }
  };

  const closeStream = () => {
    if (closed) {
      return;
    }
    closed = true;
    cleanup();
    try {
      streamController?.close();
    } catch {
      // The stream may already be closed by the response consumer.
    }
  };

  const sendEvent = (event: string, data: TaskDetailStreamEvent) => {
    if (closed || !streamController) {
      return false;
    }
    try {
      streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(redactSecrets(data))}\n\n`));
      return true;
    } catch {
      closeStream();
      return false;
    }
  };

  const sendHeartbeat = () => {
    if (closed || !streamController) {
      return;
    }
    try {
      streamController.enqueue(encoder.encode(": keep-alive\n\n"));
    } catch {
      closeStream();
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      streamController = controller;
      abortListener = closeStream;
      request.signal.addEventListener("abort", abortListener, { once: true });
      if (request.signal.aborted) {
        closeStream();
        return;
      }

      const canContinue = async () => {
        const current = await requireAgentOsProductPermission(request, "runtime.inspect").catch(() => null);
        if (!current || "response" in current || current.actor.actorId !== authorization.actor.actorId) {
          closeStream();
          return false;
        }
        return !closed;
      };

      const syncLiveSession = (detail: TaskDetailRecord) => {
        if (!liveConversation) return;
        liveTarget = resolveTaskLiveTarget(detail);
        const nextKey = liveTarget?.sessionKey ?? null;
        if (nextKey === nativeSessionKey) {
          for (const [runId, frame] of pendingChatSnapshots) {
            const entry = liveTarget ? projectTaskAssistantFrame(frame, liveTarget) : null;
            if (!entry) continue;
            pendingChatSnapshots.delete(runId);
            sendEvent("task-live", entry);
          }
          return;
        }
        pendingChatSnapshots.clear();
        nativeSessionSubscription?.close();
        nativeSessionSubscription = undefined;
        nativeSessionKey = nextKey;
        if (!nextKey) return;

        const subscribe = getOpenClawAdapter().subscribeNativeRuntimeEvents;
        if (!subscribe) return;
        const adapter = getOpenClawAdapter();
        const pending = subscribe.call(adapter, { sessionKeys: [nextKey] }, {
          onEvent: (frame) => {
            if (closed || nativeSessionKey !== nextKey || !liveTarget) return;
            const entry = projectTaskAssistantFrame(frame, liveTarget) ?? projectTaskToolFrame(frame, liveTarget);
            if (entry) {
              void canContinue().then((allowed) => {
                if (allowed && nativeSessionKey === nextKey) sendEvent("task-live", entry);
              });
            }
            // An acknowledgement can reach the API just after a first native text snapshot.
            // Keep only replaceable snapshots and release them after verifying the run identity.
            const payload = frame.payload as { runId?: unknown; sessionKey?: unknown; message?: unknown } | null;
            if (!entry && frame.event === "chat" && payload?.sessionKey === nextKey &&
                typeof payload.runId === "string" && payload.message) {
              if (pendingChatSnapshots.size >= 8) pendingChatSnapshots.delete(pendingChatSnapshots.keys().next().value!);
              pendingChatSnapshots.set(payload.runId, frame);
            }
            if ((entry?.type === "assistant" && entry.done) || (entry?.type === "tool" && entry.phase === "result") ||
                frame.event === "session.message" || (frame.event === "chat" && !entry)) {
              refreshController?.scheduleEventRefresh();
            }
          },
          onConnectionStateChange: (state) => {
            if (state === "connected") refreshController?.scheduleEventRefresh();
            const sessionConnection = state === "connected" || state === "reconnecting" ? state : null;
            if (sessionConnection) {
              void canContinue().then((allowed) => {
                if (allowed && nativeSessionKey === nextKey) sendEvent("ready", { type: "ready", ok: true, sessionConnection });
              });
            }
          }
        }, { allowCliFallback: false });
        void pending.then((subscription) => {
          if (closed || nativeSessionKey !== nextKey) subscription.close();
          else nativeSessionSubscription = subscription;
        }).catch(() => {
          void canContinue().then((allowed) => {
            if (allowed && nativeSessionKey === nextKey) {
              sendEvent("ready", { type: "ready", ok: false, sessionConnection: "unavailable" });
            }
          });
        });
      };

      const sendTask = async () => {
        if (closed) {
          return;
        }
        try {
          if (!(await canContinue())) return;
          const detail = await getTaskDetail(taskId, {
            dispatchId,
            taskHistoryCursor,
            taskHistoryLimit
          });
          if (!(await canContinue())) return;
          indexTaskDetailIds(detail, relatedIds);
          syncLiveSession(detail);
          const [artifacts, conversation] = liveConversation
            ? await Promise.all([readTaskArtifacts(detail), readNativeConversation(detail)])
            : [undefined, undefined];
          if (conversation) Object.assign(detail, conversation);
          if (!(await canContinue())) return;
          sendEvent("task", { type: "task", detail, attention, artifacts });
          if (liveConversation && Date.now() - lastAttentionSync >= 10_000) {
            lastAttentionSync = Date.now();
            const inbox = await getHumanControlInbox({ snapshot: visibleSnapshot, capabilities: [],
              missionId: detail.task.dispatchId ?? `task:${detail.task.id}` }).catch(() => null);
            if (inbox && await canContinue()) {
              const next = inbox.items.filter((item) => item.status === "pending" && item.source.taskId === detail.task.id);
              if (JSON.stringify(next) !== JSON.stringify(attention)) {
                attention = next;
                sendEvent("task", { type: "task", detail, attention, artifacts });
              }
            }
          }
        } catch (error) {
          if (!(await canContinue())) return;
          sendEvent("task-error", {
            type: "error",
            error: redactErrorMessage(error, "Unable to load task detail.")
          });
        }
      };

      const readNativeConversation = async (detail: TaskDetailRecord) => {
        const target = resolveTaskLiveTarget(detail);
        const runtime = detail.runs.find((run) => run.id === detail.task.primaryRuntimeId) ?? detail.runs[0];
        if (!target?.dedicated || !target.sessionId || !runtime) return;
        const workspace = visibleSnapshot.workspaces.find((entry) => entry.id === detail.task.workspaceId);
        try {
          const receiptRunIds = readMessageRunIds(detail, target);
          const inputRunIds = getCachedOpenClawCapabilityMatrix()?.supportedCapabilities?.includes("chat-input-custody-v1")
            ? receiptRunIds : undefined;
          const payload = await getOpenClawAdapter().getSessionHistory(
            { sessionKey: target.sessionKey, limit: 100, inputRunIds },
            { allowCliFallback: false, timeoutMs: 3_000 }
          );
          if (payload.sessionId !== target.sessionId || payload.sessionKey !== target.sessionKey) return;
          return {
            conversation: parseRuntimeOutputFromSessionHistory(runtime, payload, workspace?.path, { conversation: true }).items,
            messageActivity: readNativeMessageActivity(payload, receiptRunIds)
          };
        } catch {
          // Preserve the previous task output when native history is temporarily unavailable.
          return undefined;
        }
      };

      const readTaskArtifacts = async (detail: TaskDetailRecord): Promise<TaskStreamArtifact[]> => {
        const { task } = detail;
        const workspace = visibleSnapshot.workspaces.find((entry) => entry.id === task.workspaceId);
        if (!workspace) return [];
        const missionId = task.dispatchId ?? `task:${task.id}`;
        const mayDownload = canAgentOsActorUseProductPermission(authorization.actor, "workspace.manage");
        const outputDirectory = typeof task.metadata.outputDirRelative === "string" ? task.metadata.outputDirRelative : null;
        const files = await loadMissionArtifacts(workspace.path, detail, missionId, outputDirectory).catch(() => []);
        return files.filter(({ availability }) => availability === "available").map((file) => ({
          id: file.id,
          label: file.displayPath,
          href: mayDownload ? `/api/missions/${encodeURIComponent(missionId)}?artifact=${file.id}` : undefined,
          timestamp: detail.outputs.find((output) => output.runtimeId === file.runtimeId)?.finalTimestamp ??
            (task.updatedAt ? new Date(task.updatedAt < 10_000_000_000 ? task.updatedAt * 1000 : task.updatedAt).toISOString() : new Date().toISOString())
        }));
      };

      refreshController = createTaskDetailStreamRefreshController(sendTask, {
        onHeartbeat: () => { void canContinue().then((allowed) => { if (allowed) sendHeartbeat(); }); }
      });
      unsubscribeGatewayEvents = subscribeOpenClawEventBridgeEvents((frame) => {
        const attentionChanged = liveConversation && taskAttentionEvents.test(frame.event);
        if (attentionChanged) lastAttentionSync = 0;
        if (attentionChanged || gatewayEventMatchesTask(frame, relatedIds)) {
          refreshController?.scheduleEventRefresh();
        }
      });
      await refreshController.refreshNow();
      if (closed) {
        return;
      }
      refreshController.start();
      sendEvent("ready", {
        type: "ready",
        ok: true,
        eventBridge: getOpenClawEventBridgeStreamStatus()
      });
    },
    cancel() {
      closeStream();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive"
    }
  });
}

function readMessageRunIds(detail: TaskDetailRecord, target: NonNullable<ReturnType<typeof resolveTaskLiveTarget>>) {
  const history = detail.task.metadata.operatorHistory;
  if (!Array.isArray(history)) return [];
  return history.flatMap((entry) => entry?.kind === "message" && entry.sessionId === target.sessionId &&
    entry.sessionKey === target.sessionKey && typeof entry.runId === "string" ? [entry.runId] : []).slice(-50);
}

function readNativeMessageActivity(payload: Record<string, unknown>, runIds: string[]): TaskDetailRecord["messageActivity"] {
  const receipts = Array.isArray(payload.inputReceipts) ? payload.inputReceipts : [];
  const sessionInfo = payload.sessionInfo as { hasActiveRun?: boolean; activeRunIds?: string[] } | undefined;
  const active = sessionInfo?.hasActiveRun === true && Array.isArray(sessionInfo.activeRunIds)
    ? new Set(sessionInfo.activeRunIds) : new Set<string>();
  const result: NonNullable<TaskDetailRecord["messageActivity"]> = Object.create(null);
  for (const runId of runIds) {
    const receipt = receipts.find((entry) => entry?.runId === runId);
    if (receipt?.cancelled === true) result[runId] = "cancelled";
    else if (receipt?.state === "pending" && receipt.queued === true) result[runId] = "queued";
    else if (receipt?.state === "consumed") result[runId] = active.has(runId) ? "processing" : "recorded";
  }
  return result;
}

function indexTaskDetailIds(detail: TaskDetailRecord, ids: Set<string>) {
  addRelatedId(ids, detail.task.id);
  addRelatedId(ids, detail.task.key);
  addRelatedId(ids, detail.task.dispatchId);
  for (const value of detail.task.runtimeIds) {
    addRelatedId(ids, value);
  }
  for (const value of detail.task.sessionIds) {
    addRelatedId(ids, value);
  }
  for (const value of detail.task.runIds) {
    addRelatedId(ids, value);
  }
  addRelatedId(ids, detail.task.metadata.taskId);
  addRelatedId(ids, detail.task.metadata.dispatchId);
  addRelatedId(ids, detail.taskHistory?.taskId);

  for (const run of detail.runs) {
    addRelatedId(ids, run.id);
    addRelatedId(ids, run.key);
    addRelatedId(ids, run.taskId);
    addRelatedId(ids, run.sessionId);
    addRelatedId(ids, run.runId);
    addRelatedId(ids, run.metadata.taskId);
    addRelatedId(ids, run.metadata.dispatchId);
  }
}

function gatewayEventMatchesTask(frame: OpenClawGatewayEventFrame, ids: Set<string>) {
  const candidates = collectGatewayEventIds(frame);

  for (const candidate of candidates) {
    if (ids.has(candidate)) {
      return true;
    }
  }

  return false;
}

function collectGatewayEventIds(frame: OpenClawGatewayEventFrame) {
  const ids = new Set<string>();
  addRelatedId(ids, frame.event);
  collectRecordIds(frame.payload, ids, 0);
  return ids;
}

function collectRecordIds(value: unknown, ids: Set<string>, depth: number) {
  if (!value || depth > 3) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRecordIds(entry, ids, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["id", "key", "taskId", "runId", "sessionId", "sessionKey", "runtimeId", "dispatchId"]) {
    addRelatedId(ids, record[key]);
  }

  for (const key of ["task", "session", "runtime", "metadata"]) {
    collectRecordIds(record[key], ids, depth + 1);
  }
}

function addRelatedId(ids: Set<string>, value: unknown) {
  if (typeof value === "string" && value.trim()) {
    ids.add(value.trim());
  }
}
