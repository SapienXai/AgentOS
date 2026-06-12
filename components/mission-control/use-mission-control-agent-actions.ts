"use client";

import { useCallback, useState } from "react";

import type { AgentDetailFocus } from "@/components/mission-control/canvas-types";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export type AgentActionRequest = {
  requestId: string;
  kind: "edit" | "delete";
  agentId: string;
};

export type CapabilityEditorRequest = {
  requestId: string;
  agentId: string;
  focus: "skills" | "tools";
};

export type AgentModelRequest = {
  requestId: string;
  agentId: string;
};

type SelectNode = (nodeId: string | null, tab?: "overview" | "chat" | "output" | "files" | "raw", agentDetailFocus?: AgentDetailFocus | null) => void;

export function useMissionControlAgentActions({
  agents,
  selectNode,
  setActiveWorkspaceId,
  setIsInspectorOpen,
  onClearComposerTarget
}: {
  agents: MissionControlSnapshot["agents"];
  selectNode: SelectNode;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  setIsInspectorOpen: (open: boolean) => void;
  onClearComposerTarget?: () => void;
}) {
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [agentActionRequest, setAgentActionRequest] = useState<AgentActionRequest | null>(null);
  const [capabilityEditorRequest, setCapabilityEditorRequest] = useState<CapabilityEditorRequest | null>(null);
  const [agentModelRequest, setAgentModelRequest] = useState<AgentModelRequest | null>(null);
  const [contextEngineAgentId, setContextEngineAgentId] = useState<string | null>(null);

  const handleFocusAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setFocusedAgentId((current) => (current === agentId ? null : agentId));
      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agentId);
    },
    [agents, selectNode, setActiveWorkspaceId]
  );

  const handleInspectAgentDetail = useCallback(
    (agentId: string, focus: AgentDetailFocus) => {
      const agent = agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      setIsInspectorOpen(true);
      selectNode(agent.id, "overview", focus);
    },
    [agents, selectNode, setActiveWorkspaceId, setIsInspectorOpen]
  );

  const handleConfigureAgentCapabilities = useCallback(
    (agentId: string, focus: "skills" | "tools") => {
      const agent = agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agent.id);
      setCapabilityEditorRequest({
        requestId: `capabilities:${agentId}:${focus}:${Date.now()}`,
        agentId,
        focus
      });
    },
    [agents, selectNode, setActiveWorkspaceId]
  );

  const handleConfigureAgentModel = useCallback(
    (agentId: string) => {
      const agent = agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      setActiveWorkspaceId(agent.workspaceId);
      selectNode(agent.id);
      setAgentModelRequest({
        requestId: `model:${agentId}:${Date.now()}`,
        agentId
      });
    },
    [agents, selectNode, setActiveWorkspaceId]
  );

  const openAgentContextEngine = useCallback(
    (agentId: string) => {
      const agent = agents.find((entry) => entry.id === agentId);

      if (agent) {
        setFocusedAgentId(null);
        onClearComposerTarget?.();
        setActiveWorkspaceId(agent.workspaceId);
      }

      selectNode(agentId);
      setContextEngineAgentId(agentId);
    },
    [agents, onClearComposerTarget, selectNode, setActiveWorkspaceId]
  );

  const handleContextEngineOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setContextEngineAgentId(null);
    }
  }, []);

  return {
    focusedAgentId,
    setFocusedAgentId,
    agentActionRequest,
    setAgentActionRequest,
    capabilityEditorRequest,
    setCapabilityEditorRequest,
    agentModelRequest,
    setAgentModelRequest,
    contextEngineAgentId,
    setContextEngineAgentId,
    handleFocusAgent,
    handleInspectAgentDetail,
    handleConfigureAgentCapabilities,
    handleConfigureAgentModel,
    openAgentContextEngine,
    handleContextEngineOpenChange
  };
}
