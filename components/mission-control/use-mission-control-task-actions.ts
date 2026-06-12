"use client";

import { useCallback, useState } from "react";

import type { TaskCardInspectorContext, TaskNodeData } from "@/components/mission-control/canvas-types";
import type { OptimisticMissionTask } from "@/components/mission-control/mission-control-shell.utils";
import { isTaskAbortable } from "@/components/mission-control/mission-control-shell.utils";
import type { WorkItemRecord } from "@/lib/agentos/contracts";

export type TaskAbortState = "idle" | "running" | "error";

export function useMissionControlTaskActions({
  selectedNodeId,
  setActiveTaskCardContext,
  selectNode,
  setIsInspectorOpen
}: {
  selectedNodeId: string | null;
  setActiveTaskCardContext: (context: TaskCardInspectorContext | null) => void;
  selectNode: (nodeId: string | null, tab?: "overview" | "chat" | "output" | "files" | "raw") => void;
  setIsInspectorOpen: (open: boolean) => void;
}) {
  const [recentDispatchId, setRecentDispatchId] = useState<string | null>(null);
  const [optimisticMissionTasks, setOptimisticMissionTasks] = useState<OptimisticMissionTask[]>([]);
  const [taskAbortRequest, setTaskAbortRequest] = useState<WorkItemRecord | null>(null);
  const [taskAbortRunState, setTaskAbortRunState] = useState<TaskAbortState>("idle");
  const [taskAbortMessage, setTaskAbortMessage] = useState<string | null>(null);

  const requestTaskAbort = useCallback((task: WorkItemRecord) => {
    if (!isTaskAbortable(task)) {
      return;
    }

    setTaskAbortRequest(task);
    setTaskAbortRunState("idle");
    setTaskAbortMessage(null);
  }, []);

  const inspectTask: NonNullable<TaskNodeData["onInspect"]> = useCallback((task, target, activeCard) => {
    setActiveTaskCardContext(activeCard ?? null);
    selectNode(task.id, target);
    setIsInspectorOpen(true);
  }, [selectNode, setActiveTaskCardContext, setIsInspectorOpen]);

  const updateActiveTaskCard = useCallback((task: WorkItemRecord, activeCard: TaskCardInspectorContext | null) => {
    if (selectedNodeId === task.id) {
      setActiveTaskCardContext(activeCard);
    }
  }, [selectedNodeId, setActiveTaskCardContext]);

  return {
    recentDispatchId,
    setRecentDispatchId,
    optimisticMissionTasks,
    setOptimisticMissionTasks,
    taskAbortRequest,
    setTaskAbortRequest,
    taskAbortRunState,
    setTaskAbortRunState,
    taskAbortMessage,
    setTaskAbortMessage,
    requestTaskAbort,
    inspectTask,
    updateActiveTaskCard
  };
}
