import { getTaskDetail } from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import type { TaskDetailRecord, TaskDetailStreamEvent } from "@/lib/agentos/contracts";
import {
  getOpenClawEventBridgeStreamStatus,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import type { OpenClawGatewayEventFrame } from "@/lib/openclaw/client/gateway-client";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { createTaskDetailStreamRefreshController } from "@/lib/agentos/application/task-detail-stream-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);
  const searchParams = new URL(request.url).searchParams;
  const dispatchId = searchParams.get("dispatchId");
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
  let abortListener: (() => void) | undefined;
  const relatedIds = new Set([taskId, dispatchId].filter((value): value is string => Boolean(value)));

  const authorization = await requireAgentOsProductPermission(request, "tasks.use");
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

  const cleanup = () => {
    refreshController?.close();
    refreshController = null;
    unsubscribeGatewayEvents?.();
    unsubscribeGatewayEvents = undefined;
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

      const sendTask = async () => {
        if (closed) {
          return;
        }
        try {
          const detail = await getTaskDetail(taskId, {
            dispatchId,
            taskHistoryCursor,
            taskHistoryLimit
          });
          indexTaskDetailIds(detail, relatedIds);
          sendEvent("task", { type: "task", detail });
        } catch (error) {
          sendEvent("task-error", {
            type: "error",
            error: redactErrorMessage(error, "Unable to load task detail.")
          });
        }
      };

      refreshController = createTaskDetailStreamRefreshController(sendTask, { onHeartbeat: sendHeartbeat });
      unsubscribeGatewayEvents = subscribeOpenClawEventBridgeEvents((frame) => {
        if (gatewayEventMatchesTask(frame, relatedIds)) {
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
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
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
  for (const key of ["id", "key", "taskId", "runId", "sessionId", "runtimeId", "dispatchId"]) {
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
