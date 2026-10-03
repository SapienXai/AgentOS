import { useEffect, useState } from "react";
import type { TaskDetailRecord, TaskFeedEvent, TaskDetailStreamEvent } from "@/lib/agentos/contracts";
import { subscribeTaskFeedStream } from "@/hooks/task-feed-stream";

const EMPTY_TASK_FEED: TaskFeedEvent[] = [];

export function useTaskFeed(
  taskId: string,
  enabled: boolean,
  options: {
    dispatchId?: string | null;
    optimisticFeed?: TaskFeedEvent[];
  } = {}
) {
  const [feedState, setFeedState] = useState<{
    taskId: string | null;
    feed: TaskFeedEvent[];
    detail: TaskDetailRecord | null;
  }>({
    taskId: null,
    feed: [],
    detail: null
  });
  const [connectedTaskId, setConnectedTaskId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });
  const [streamNoticeState, setStreamNoticeState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });
  const dispatchId = typeof options.dispatchId === "string" && options.dispatchId.trim() ? options.dispatchId.trim() : null;
  const isOptimisticTask = taskId.startsWith("optimistic-task:");
  const optimisticFeed = enabled && isOptimisticTask && !dispatchId ? options.optimisticFeed ?? EMPTY_TASK_FEED : null;

  useEffect(() => {
    if (!enabled || optimisticFeed) {
      return;
    }

    const searchParams = new URLSearchParams();
    if (dispatchId) {
      searchParams.set("dispatchId", dispatchId);
    }
    const streamUrl = `/api/tasks/${encodeURIComponent(taskId)}/stream${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;

    const handleTask = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type === "task") {
          setFeedState({ taskId, feed: data.detail.liveFeed || [], detail: data.detail });
          setConnectedTaskId(taskId);
          setErrorState({ taskId, message: null });
        }
      } catch (err) {
        console.error("Failed to parse task stream event", err);
        setErrorState({ taskId, message: "Unable to parse task feed." });
      }
    };

    const handleError = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data);
        setErrorState({ taskId, message: data.error || "Unknown error" });
      } catch {
        setErrorState({ taskId, message: "Stream error" });
      }
    };

    const handleReady = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type !== "ready") {
          return;
        }

        const eventBridge = data.eventBridge;
        const message = eventBridge && eventBridge.mode !== "live"
          ? [eventBridge.message, eventBridge.recovery].filter(Boolean).join(" ")
          : null;

        setStreamNoticeState({ taskId, message });
      } catch {
        setStreamNoticeState({ taskId, message: null });
      }
    };

    return subscribeTaskFeedStream(streamUrl, {
      onTask: handleTask,
      onError: handleError,
      onReady: handleReady,
      onDisconnect: () => {
        setErrorState((current) =>
          current.taskId === taskId && current.message
            ? current
            : { taskId, message: "Task feed disconnected. Reconnecting…" }
        );
      }
    });
  }, [taskId, enabled, dispatchId, optimisticFeed]);

  const feed = optimisticFeed ?? (feedState.taskId === taskId ? feedState.feed : []);
  const detail = optimisticFeed ? null : feedState.taskId === taskId ? feedState.detail : null;
  const error = optimisticFeed ? null : errorState.taskId === taskId ? errorState.message : null;
  const streamNotice = optimisticFeed ? null : streamNoticeState.taskId === taskId ? streamNoticeState.message : null;
  const loading = optimisticFeed ? false : enabled && connectedTaskId !== taskId && error === null;

  return { feed, detail, loading, error, streamNotice };
}
