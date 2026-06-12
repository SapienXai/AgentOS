"use client";

import { useCallback, useState } from "react";

import type { AgentDetailFocus, TaskCardInspectorContext } from "@/components/mission-control/canvas-types";

export type InspectorTabId = "overview" | "chat" | "output" | "files" | "raw";

export function useMissionControlSelection(initialWorkspaceId: string | null) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(initialWorkspaceId);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialWorkspaceId);
  const [selectedAgentDetailFocus, setSelectedAgentDetailFocus] = useState<AgentDetailFocus | null>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<InspectorTabId>("overview");
  const [activeTaskCardContext, setActiveTaskCardContext] = useState<TaskCardInspectorContext | null>(null);

  const selectNode = useCallback(
    (nodeId: string | null, tab: InspectorTabId = "overview", agentDetailFocus: AgentDetailFocus | null = null) => {
      setSelectedNodeId(nodeId);
      setActiveInspectorTab(tab);
      setSelectedAgentDetailFocus(agentDetailFocus);
      setActiveTaskCardContext((current) => (current?.taskId === nodeId ? current : null));
    },
    []
  );

  return {
    activeWorkspaceId,
    setActiveWorkspaceId,
    selectedNodeId,
    setSelectedNodeId,
    selectedAgentDetailFocus,
    setSelectedAgentDetailFocus,
    activeInspectorTab,
    setActiveInspectorTab,
    activeTaskCardContext,
    setActiveTaskCardContext,
    selectNode
  };
}
