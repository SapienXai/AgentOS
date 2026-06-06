"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import {
  createTaskReviewResolution,
  parseTaskReviewState,
  resolveTaskReviewKey,
  taskReviewStateStorageKey,
  type TaskReviewStateMap,
  type TaskReviewStatus
} from "@/components/mission-control/task-review-state";
import { resolveTaskPrompt } from "@/components/mission-control/mission-control-shell.utils";
import type { WorkItemRecord } from "@/lib/agentos/contracts";

type InspectorTabId = "overview" | "chat" | "output" | "files" | "raw";

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

function limitTaskReviewMessageSection(value: string, maxLength: number) {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}\n\n[truncated for task continuation]`;
}

function buildTaskReviewContinuationPrompt(task: WorkItemRecord, capturedOutput: string) {
  const originalPrompt = limitTaskReviewMessageSection(resolveTaskPrompt(task), 3200);
  const output = limitTaskReviewMessageSection(capturedOutput, 7600);

  return [
    "Continue this task from the last captured output. Finish the remaining work and verify the result.",
    "",
    "Original mission:",
    originalPrompt,
    output ? "" : null,
    output ? "Last captured output:" : null,
    output || null
  ]
    .filter((entry): entry is string => typeof entry === "string")
    .join("\n");
}

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
  const [hasHydratedTaskReviewState, setHasHydratedTaskReviewState] = useState(false);

  useEffect(() => {
    const storedTaskReviewState = globalThis.localStorage?.getItem(taskReviewStateStorageKey);
    setTaskReviewState(parseTaskReviewState(storedTaskReviewState ?? null));
    setHasHydratedTaskReviewState(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedTaskReviewState) {
      return;
    }

    globalThis.localStorage?.setItem(taskReviewStateStorageKey, JSON.stringify(taskReviewState));
  }, [hasHydratedTaskReviewState, taskReviewState]);

  const clearTaskReviewState = () => {
    setTaskReviewState({});
  };

  const openTaskReview = useCallback(
    (task: WorkItemRecord) => {
      selectNode(task.id, "output");
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
    (task: WorkItemRecord, status: TaskReviewStatus, action: string) => {
      const resolution = createTaskReviewResolution(task, status, action);

      setTaskReviewState((current) => ({
        ...current,
        [resolution.taskKey]: resolution
      }));

      return resolution;
    },
    []
  );

  const closeTaskReview = useCallback(() => {
    setTaskReviewRequest(null);
  }, []);

  const acceptTaskReview = useCallback(
    (task: WorkItemRecord) => {
      recordTaskReviewResolution(task, "accepted", "Accepted result");
      closeTaskReview();
      toast.success("Task result accepted.", {
        description: "The review warning is marked as handled for this workspace."
      });
    },
    [closeTaskReview, recordTaskReviewResolution]
  );

  const dismissTaskReview = useCallback(
    (task: WorkItemRecord) => {
      recordTaskReviewResolution(task, "dismissed", "Dismissed review");
      closeTaskReview();
      toast.message("Task review dismissed.", {
        description: "The warning remains available in the task evidence."
      });
    },
    [closeTaskReview, recordTaskReviewResolution]
  );

  const continueTaskReview = useCallback(
    async (task: WorkItemRecord, capturedOutput: string) => {
      const message = buildTaskReviewContinuationPrompt(task, capturedOutput);

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

        recordTaskReviewResolution(task, "continued", "Accepted continuation");
        selectNode(task.id, "output");
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
    [closeTaskReview, recordTaskReviewResolution, refreshSnapshot, selectNode, setIsInspectorOpen]
  );

  const retryTaskReview = useCallback(
    (task: WorkItemRecord) => {
      recordTaskReviewResolution(task, "retried", "Drafted retry");
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
