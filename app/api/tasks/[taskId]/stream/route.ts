import { getTaskDetail } from "@/lib/agentos/control-plane";
import type { TaskDetailRecord, TaskDetailStreamEvent } from "@/lib/agentos/contracts";
import {
  getOpenClawEventBridgeStreamStatus,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import type { OpenClawGatewayEventFrame } from "@/lib/openclaw/client/gateway-client";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);
  const dispatchId = new URL(request.url).searchParams.get("dispatchId");
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeGatewayEvents: (() => void) | undefined;
  let closed = false;
  let taskRequest: Promise<void> | null = null;
  const relatedIds = new Set([taskId, dispatchId].filter((value): value is string => Boolean(value)));

  const stream = new ReadableStream({
    async start(controller) {
      const handleAbort = () => {
        close();
      };

      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        unsubscribeGatewayEvents?.();
        unsubscribeGatewayEvents = undefined;

        request.signal.removeEventListener("abort", handleAbort);
      };

      const sendEvent = (event: string, data: TaskDetailStreamEvent) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(redactSecrets(data))}\n\n`));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      request.signal.addEventListener("abort", handleAbort);

      const sendTask = async () => {
        if (closed) {
          return;
        }

        if (taskRequest) {
          return taskRequest;
        }

        taskRequest = (async () => {
          try {
            const detail = await getTaskDetail(taskId, { dispatchId });
            indexTaskDetailIds(detail, relatedIds);
            sendEvent("task", { type: "task", detail });
          } catch (error) {
            sendEvent("task-error", {
              type: "error",
              error: redactErrorMessage(error, "Unable to load task detail.")
            });
          } finally {
            taskRequest = null;
          }
        })();

        return taskRequest;
      };

      const scheduleTaskRefresh = (delayMs: number) => {
        if (closed) {
          return;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void sendTask();
        }, delayMs);
      };

      await sendTask();
      unsubscribeGatewayEvents = subscribeOpenClawEventBridgeEvents((frame) => {
        if (gatewayEventMatchesTask(frame, relatedIds)) {
          scheduleTaskRefresh(150);
        }
      });
      interval = setInterval(() => {
        void sendTask();
      }, 3000);
      sendEvent("ready", {
        type: "ready",
        ok: true,
        eventBridge: getOpenClawEventBridgeStreamStatus()
      });
    },
    cancel() {
      closed = true;

      if (interval) {
        clearInterval(interval);
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      unsubscribeGatewayEvents?.();
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
