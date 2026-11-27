import { useEffect, useState } from "react";
import type { AttentionItem, TaskDetailRecord, TaskFeedEvent, TaskDetailStreamEvent } from "@/lib/agentos/contracts";
import type { TaskStreamArtifact } from "@/lib/openclaw/types";
import { subscribeTaskFeedStream } from "@/hooks/task-feed-stream";

const EMPTY_TASK_FEED: TaskFeedEvent[] = [];
export type TaskAssistantUpdate = Extract<TaskDetailStreamEvent, { type: "assistant" }>;
export type TaskToolUpdate = Extract<TaskDetailStreamEvent, { type: "tool" }>;
const EMPTY_ASSISTANT_UPDATES: TaskAssistantUpdate[] = [];
const EMPTY_TOOL_UPDATES: TaskToolUpdate[] = [];
const EMPTY_ATTENTION_ITEMS: AttentionItem[] = [];
const EMPTY_ARTIFACTS: TaskStreamArtifact[] = [];

export function useTaskFeed(
  taskId: string,
  enabled: boolean,
  options: {
    dispatchId?: string | null;
    optimisticFeed?: TaskFeedEvent[];
    liveConversation?: boolean;
  } = {}
) {
  const [feedState, setFeedState] = useState<{
    taskId: string | null;
    feed: TaskFeedEvent[];
    detail: TaskDetailRecord | null;
    attention?: AttentionItem[];
    artifacts?: TaskStreamArtifact[];
  }>({
    taskId: null,
    feed: [],
    detail: null
  });
  const [connectedTaskId, setConnectedTaskId] = useState<string | null>(null);
  const [assistantState, setAssistantState] = useState<{ scope: string; turns: TaskAssistantUpdate[] }>({ scope: "", turns: [] });
  const [toolState, setToolState] = useState<{ scope: string; updates: TaskToolUpdate[] }>({ scope: "", updates: [] });
  const [errorState, setErrorState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });
  const [streamNoticeState, setStreamNoticeState] = useState<{ taskId: string | null; message: string | null }>({
    taskId: null,
    message: null
  });
  const dispatchId = typeof options.dispatchId === "string" && options.dispatchId.trim() ? options.dispatchId.trim() : null;
  const liveConversation = options.liveConversation === true;
  const scope = JSON.stringify([taskId, dispatchId]);
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
    if (liveConversation) searchParams.set("live", "1");
    const streamUrl = `/api/tasks/${encodeURIComponent(taskId)}/stream${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;

    const handleTask = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as TaskDetailStreamEvent;
        if (data.type === "task") {
          setFeedState({ taskId, feed: data.detail.liveFeed || [], detail: data.detail, attention: data.attention, artifacts: data.artifacts });
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
      onLive: (event) => {
        try {
          const update = JSON.parse(event.data) as TaskDetailStreamEvent;
          if (update.type === "assistant") {
            setAssistantState((current) => ({
              scope,
              turns: mergeTaskAssistantUpdate(current.scope === scope ? current.turns : EMPTY_ASSISTANT_UPDATES, update)
            }));
          }
          if (update.type === "tool") {
            setToolState((current) => {
              const scoped = current.scope === scope ? current.updates : EMPTY_TOOL_UPDATES;
              const same = (entry: TaskToolUpdate) => entry.runId === update.runId && entry.toolCallId === update.toolCallId;
              const previous = scoped.find(same);
              if (previous && (previous.phase === "result" || previous.phase === update.phase)) return current;
              return { scope, updates: [...scoped.filter((entry) => !same(entry)), update].slice(-40) };
            });
          }
        } catch {
          // Task snapshots still provide the persisted conversation.
        }
      },
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
  }, [taskId, enabled, dispatchId, optimisticFeed, liveConversation, scope]);

  const feed = optimisticFeed ?? (feedState.taskId === taskId ? feedState.feed : []);
  const detail = optimisticFeed ? null : feedState.taskId === taskId ? feedState.detail : null;
  const error = optimisticFeed ? null : errorState.taskId === taskId ? errorState.message : null;
  const streamNotice = optimisticFeed ? null : streamNoticeState.taskId === taskId ? streamNoticeState.message : null;
  const loading = optimisticFeed ? false : enabled && connectedTaskId !== taskId && error === null;

  const assistantUpdates = assistantState.scope === scope ? assistantState.turns : EMPTY_ASSISTANT_UPDATES;
  const attention = feedState.taskId === taskId ? feedState.attention ?? EMPTY_ATTENTION_ITEMS : EMPTY_ATTENTION_ITEMS;
  const toolUpdates = toolState.scope === scope ? toolState.updates : EMPTY_TOOL_UPDATES;
  const artifacts = feedState.taskId === taskId ? feedState.artifacts ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS;
  return { feed, detail, loading, error, streamNotice, assistantUpdates, toolUpdates, attention, artifacts };
}

export function mergeTaskAssistantUpdate(turns: TaskAssistantUpdate[], update: TaskAssistantUpdate) {
  const previous = turns.find((turn) => turn.runId === update.runId);
  if (previous?.done || (previous?.sequence != null && update.sequence != null && update.sequence <= previous.sequence)) return turns;
  const next = {
    ...update,
    timestamp: previous?.timestamp ?? update.timestamp,
    text: (update.done && !update.text ? previous?.text ?? "" : update.replace ? update.text : (previous?.text ?? "") + update.text).slice(0, 32_000)
  };
  return [...turns.filter((turn) => turn.runId !== update.runId), next].slice(-16);
}
