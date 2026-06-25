import "server-only";

import {
  clearMissionControlCaches,
  getMissionControlSnapshot as getOpenClawMissionControlSnapshot
} from "@/lib/openclaw/application/mission-control-service";
import { createAgent, deleteAgent, updateAgent } from "@/lib/openclaw/application/agent-service";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  readWorkspaceEditSeed,
  updateWorkspaceProject
} from "@/lib/openclaw/application/workspace-service";
import { abortMissionTask, submitMission } from "@/lib/openclaw/application/mission-service";
import { controlRunningTaskSession } from "@/lib/openclaw/application/task-control-service";
import { runTaskHealthAudit } from "@/lib/openclaw/application/task-health-service";
import {
  ensureOpenClawRuntimeSmokeTest,
  ensureOpenClawRuntimeStateAccess,
  getRuntimeOutput,
  getTaskDetail,
  touchOpenClawRuntimeStateAccess
} from "@/lib/openclaw/application/runtime-service";
import {
  approveRuntimeIssue,
  dismissRuntimeIssue,
  inspectRuntimeIssueDevices
} from "@/lib/openclaw/application/runtime-issue-service";
import {
  generateGatewayNativeAuthToken,
  getCrossAgentMessageSettings,
  getGatewayNativeAuthStatus,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential,
  updateCrossAgentMessageSettings,
  updateGatewayRemoteUrl,
  updateWorkspaceRoot
} from "@/lib/openclaw/application/settings-service";
import {
  bindWorkspaceChannelAgent,
  createManagedSurfaceAccount,
  createTelegramChannelAccount,
  deleteWorkspaceChannelEverywhere,
  disconnectWorkspaceChannel,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  reconcileWorkspaceSurfaceBindings,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
} from "@/lib/openclaw/application/channel-service";

import { normalizeControlPlaneSnapshot } from "@/lib/agentos/acl/openclaw";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

export async function getControlPlaneSnapshot(
  options: { force?: boolean; includeHidden?: boolean; loadProfile?: "interactive" | "refresh" | "system" } = {}
): Promise<ControlPlaneSnapshot> {
  const snapshot = await getOpenClawMissionControlSnapshot(options);
  return normalizeControlPlaneSnapshot(snapshot);
}

export const getMissionControlSnapshot = getControlPlaneSnapshot;

export {
  abortMissionTask,
  approveRuntimeIssue,
  bindWorkspaceChannelAgent,
  clearMissionControlCaches,
  controlRunningTaskSession,
  createAgent,
  createManagedSurfaceAccount,
  createTelegramChannelAccount,
  createWorkspaceProject,
  deleteAgent,
  deleteWorkspaceChannelEverywhere,
  deleteWorkspaceProject,
  disconnectWorkspaceChannel,
  dismissRuntimeIssue,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  ensureOpenClawRuntimeSmokeTest,
  ensureOpenClawRuntimeStateAccess,
  generateGatewayNativeAuthToken,
  getCrossAgentMessageSettings,
  getChannelRegistry,
  getGatewayNativeAuthStatus,
  getRuntimeOutput,
  getTaskDetail,
  inspectRuntimeIssueDevices,
  readWorkspaceEditSeed,
  reconcileWorkspaceSurfaceBindings,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential,
  runTaskHealthAudit,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  submitMission,
  updateAgent,
  updateCrossAgentMessageSettings,
  updateGatewayRemoteUrl,
  updateWorkspaceProject,
  updateWorkspaceRoot,
  touchOpenClawRuntimeStateAccess,
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
};

export type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
