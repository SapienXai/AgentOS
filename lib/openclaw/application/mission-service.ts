import "server-only";

import {
  clearMissionControlCaches,
  getMissionControlSnapshot
} from "@/lib/openclaw/application/mission-control-service";
import {
  abortMissionDispatchTask as abortMissionDispatchTaskFromWorkflow,
  submitMissionDispatch as submitMissionDispatchFromWorkflow
} from "@/lib/openclaw/domains/mission-dispatch-workflow";
import type {
  MissionAbortResponse,
  MissionControlSnapshot,
  MissionResponse,
  MissionSubmission
} from "@/lib/openclaw/types";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";

function resolveAgentForMission(snapshot: MissionControlSnapshot, workspaceId?: string) {
  if (!workspaceId) {
    return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id;
  }

  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
  return (
    workspaceAgents.find((agent) => agent.isDefault)?.id ||
    workspaceAgents.find((agent) => agent.status === "engaged")?.id ||
    workspaceAgents[0]?.id
  );
}

export async function submitMission(
  input: MissionSubmission,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<MissionResponse> {
  return submitMissionDispatchFromWorkflow(input, {
    getMissionControlSnapshot,
    resolveAgentForMission,
    invalidateMissionControlCaches: clearMissionControlCaches
  }, gatewayOptions);
}

export async function abortMissionTask(
  taskId: string,
  reason?: string | null,
  dispatchId?: string | null,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<MissionAbortResponse> {
  return abortMissionDispatchTaskFromWorkflow(taskId, reason, dispatchId, {
    getMissionControlSnapshot,
    resolveAgentForMission,
    invalidateMissionControlCaches: clearMissionControlCaches
  }, gatewayOptions);
}
