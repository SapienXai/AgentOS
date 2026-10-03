"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import {
  parseTaskReviewState,
  resolveTaskReviewKey,
  type TaskReviewStateMap,
  type TaskReviewStatus
} from "@/components/mission-control/task-review-state";
import { resolveTaskPrompt } from "@/components/mission-control/mission-control-shell.utils";
import type { WorkItemRecord } from "@/lib/agentos/contracts";
import type { TaskReviewResolution } from "@/lib/agentos/workforce/task-review";
import { buildTaskReviewContinuationPrompt } from "@/lib/openclaw/domains/task-review-continuation";

type InspectorTabId = "overview" | "chat" | "direction" | "output" | "result" | "files" | "raw";

export type TaskReviewRequest = {
  requestId: string;
  taskId: string;
  taskKey: string;
  fallbackTask: WorkItemRecord;
};

type TaskReviewComposeIntent = {
  id: string;
  mission: string;
  agentId?: string;
  sourceKind?: "copy" | "reply";
  sourceLabel?: string;
};

type UseTaskReviewWorkflowInput = {
  selectNode: (nodeId: string | null, tab?: InspectorTabId) => void;
  setIsInspectorOpen: (open: boolean) => void;
  setComposeIntent: (intent: TaskReviewComposeIntent) => void;
  setComposerTargetAgentId: (agentId: string | null) => void;
  setIsComposerActive: (active: boolean) => void;
  refreshSnapshot: (options?: { force?: boolean }) => unknown;
};

function buildTaskReviewRetryPrompt(task: WorkItemRecord) {
  return [
    "Retry this task from the original mission. Do not assume the previous stalled runtime completed.",
    "",
    "Original mission:",
    resolveTaskPrompt(task)
  ].join("\n");
}

export function useTaskReviewWorkflow({
  selectNode,
  setIsInspectorOpen,
  setComposeIntent,
  setComposerTargetAgentId,
  setIsComposerActive,
  refreshSnapshot
}: UseTaskReviewWorkflowInput) {
  const [taskReviewRequest, setTaskReviewRequest] = useState<TaskReviewRequest | null>(null);
  const [taskReviewState, setTaskReviewState] = useState<TaskReviewStateMap>({});

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/task-reviews", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { reviews?: unknown } | null;
        if (!response.ok || !payload?.reviews) return;
        const parsed = parseTaskReviewState(JSON.stringify(payload.reviews));
        if (!cancelled) setTaskReviewState(parsed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTaskReviewState = () => {
    setTaskReviewState({});
  };

  const openTaskReview = useCallback(
    (task: WorkItemRecord) => {
      selectNode(task.id, "result");
      setTaskReviewRequest({
        requestId: `task-review:${task.id}:${Date.now()}`,
        taskId: task.id,
        taskKey: resolveTaskReviewKey(task),
        fallbackTask: task
      });
    },
    [selectNode]
  );

  const recordTaskReviewResolution = useCallback(
    async (task: WorkItemRecord, status: TaskReviewStatus, action: string) => {
      const response = await fetch("/api/task-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          dispatchId: task.dispatchId ?? null,
          status,
          action
        })
      });
      const payload = await response.json().catch(() => null) as { error?: string; review?: TaskReviewResolution } | null;
      if (!response.ok || !payload?.review) {
        throw new Error(payload?.error || "Unable to save the task review decision.");
      }

      const resolution = payload.review;
      setTaskReviewState((current) => ({ ...current, [resolution.taskKey]: resolution }));
      return resolution;
    },
    []
  );

  const closeTaskReview = useCallback(() => {
    setTaskReviewRequest(null);
  }, []);

  const acceptTaskReview = useCallback(
    async (task: WorkItemRecord) => {
      try {
        await recordTaskReviewResolution(task, "accepted", "Marked evidence accepted");
        closeTaskReview();
        toast.success("Captured evidence accepted.", {
          description: "The operator decision is saved with the task. The original warning remains in task evidence."
        });
      } catch (error) {
        toast.error("Unable to save the review decision.", {
          description: error instanceof Error ? error.message : "Review decision was not saved."
        });
      }
    },
    [closeTaskReview, recordTaskReviewResolution]
  );

  const dismissTaskReview = useCallback(
    async (task: WorkItemRecord) => {
      try {
        await recordTaskReviewResolution(task, "dismissed", "Acknowledged review");
        closeTaskReview();
        toast.message("Task review acknowledged.", {
          description: "The warning remains in task evidence."
        });
      } catch (error) {
        toast.error("Unable to save the review decision.", {
          description: error instanceof Error ? error.message : "Review decision was not saved."
        });
      }
    },
    [closeTaskReview, recordTaskReviewResolution]
  );

  const continueTaskReview = useCallback(
    async (
      task: WorkItemRecord,
      capturedOutput: string,
      operatorMessage?: string,
      capturedOutputLabel?: string
    ) => {
      const message = buildTaskReviewContinuationPrompt(task, capturedOutput, operatorMessage, capturedOutputLabel);

      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/control`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "continue",
            message,
            dispatchId: task.dispatchId ?? null
          })
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to continue this task.");
        }

        const continuationReview = (payload as { review?: TaskReviewResolution } | null)?.review;
        if (continuationReview) {
          setTaskReviewState((current) => ({ ...current, [continuationReview.taskKey]: continuationReview }));
        } else {
          const reviewResponse = await fetch("/api/task-reviews", { cache: "no-store" });
          const reviewPayload = await reviewResponse.json().catch(() => null) as { reviews?: unknown } | null;
          if (reviewResponse.ok && reviewPayload?.reviews) {
            setTaskReviewState(parseTaskReviewState(JSON.stringify(reviewPayload.reviews)));
          }
        }
      selectNode(task.id, "result");
        setIsInspectorOpen(true);
        closeTaskReview();
        void refreshSnapshot({ force: true });
        toast.success("Task continuation accepted.", {
          description: "OpenClaw accepted the continuation. AgentOS will track the follow-up until live output arrives."
        });
      } catch (error) {
        toast.error("Task continuation failed.", {
          description: error instanceof Error ? error.message : "Unable to continue this task."
        });
      }
    },
    [closeTaskReview, refreshSnapshot, selectNode, setIsInspectorOpen]
  );

  const retryTaskReview = useCallback(
    async (task: WorkItemRecord) => {
      try {
        await recordTaskReviewResolution(task, "retried", "Drafted retry");
      } catch (error) {
        toast.error("Unable to save the review decision.", {
          description: error instanceof Error ? error.message : "Review decision was not saved."
        });
        return;
      }
      setComposeIntent({
        id: `review-retry:${task.id}:${Date.now()}`,
        mission: buildTaskReviewRetryPrompt(task),
        agentId: task.primaryAgentId,
        sourceKind: "reply",
        sourceLabel: task.title.trim() || "Task review"
      });
      setComposerTargetAgentId(task.primaryAgentId ?? null);
      setIsComposerActive(true);
      closeTaskReview();
      toast.success("Retry draft prepared.", {
        description: "Review the mission input, then send it when ready."
      });
    },
    [
      closeTaskReview,
      recordTaskReviewResolution,
      setComposeIntent,
      setComposerTargetAgentId,
      setIsComposerActive
    ]
  );

  const openTaskReviewEvidence = useCallback(
    (task: WorkItemRecord, target: InspectorTabId) => {
      selectNode(task.id, target);
      setIsInspectorOpen(true);
      closeTaskReview();
    },
    [closeTaskReview, selectNode, setIsInspectorOpen]
  );

  return {
    taskReviewRequest,
    taskReviewState,
    clearTaskReviewState,
    openTaskReview,
    closeTaskReview,
    acceptTaskReview,
    dismissTaskReview,
    continueTaskReview,
    retryTaskReview,
    openTaskReviewEvidence
  };
}
