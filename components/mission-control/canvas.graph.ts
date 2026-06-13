import type {
  AgentAccountBadge,
  AgentDetailFocus,
  AgentSurfaceBadge,
  CanvasEdge,
  CanvasNode,
  PersistedNodePositionMap,
  TaskNodeData
} from "@/components/mission-control/canvas-types";
import {
  resolveSurfaceModuleAnchorPosition,
  toAccountTetherNodeId,
  toSurfaceTetherNodeId
} from "@/components/mission-control/canvas.motion";
import {
  resolvePersistedPosition,
  toLegacyPersistedAgentPositionKey,
  toLegacyPersistedTaskPositionKey,
  toPersistedAgentPositionKey,
  toPersistedTaskPositionKey
} from "@/components/mission-control/canvas.persistence";
import {
  buildPendingAgentRecord,
  type PendingAgentProjection
} from "@/components/mission-control/pending-agent-projection";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";
import { resolveAgentModelLabel } from "@/lib/openclaw/presenters";
import type {
  MissionControlSnapshot,
  AgentRecord,
  WorkItemRecord
} from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";

const workspaceGroupWidth = 1060;
const workspaceColumnGap = 1160;
const workspaceMinHeight = 700;
const workspaceHeaderOffsetY = 118;
const workspaceContentBottomPadding = 112;
const agentGridStartX = 52;
const agentGridColumnGap = 318;
const idleAgentGridColumns = 3;
const idleAgentGridRowHeight = 340;
const taskLaneStartX = 390;
const taskCardLaneHeight = 420;
const taskLaneBottomPadding = 44;

export function buildCanvasGraph(
  snapshot: MissionControlSnapshot,
  accountTargets: AccountLoginTargetView[],
  accountAccessRules: AccountAccessRuleView[],
  relativeTimeReferenceMs: number,
  activeWorkspaceId: string | null,
  focusedAgentId: string | null,
  recentCreatedAgentId: string | null,
  selectedNodeId: string | null,
  activeChatAgentId: string | null,
  composerTargetAgentId: string | null,
  isComposerActive: boolean,
  justCreatedTaskIds: string[],
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[],
  onToggleWorkspaceTaskCards: (workspaceId: string) => void,
  onMessageAgent: ((agentId: string) => void) | undefined,
  onCreateTaskAgent: ((agentId: string) => void) | undefined,
  onEditAgent: (agentId: string) => void,
  onDeleteAgent: (agentId: string) => void,
  onFocusAgent: (agentId: string) => void,
  onConfigureAgentModel: ((agentId: string) => void) | undefined,
  onConfigureAgentCapabilities: ((agentId: string, focus: "skills" | "tools") => void) | undefined,
  onOpenAgentContextEngine: ((agentId: string) => void) | undefined,
  onRefresh: (() => Promise<void> | void) | undefined,
  onAgentConnectionMenuOpenChange: ((agentId: string, open: boolean) => void) | undefined,
  onInspectAgentDetail: ((agentId: string, focus: AgentDetailFocus) => void) | undefined,
  onOpenWorkspaceChannels: ((workspaceId?: string, agentId?: string) => void) | undefined,
  onOpenAccounts: ((workspaceId?: string, agentId?: string) => void) | undefined,
  onOpenWorkspaceFiles: ((workspaceId: string) => void) | undefined,
  onReplyTask: (task: WorkItemRecord) => void,
  onCopyTaskPrompt: (task: WorkItemRecord) => void,
  onHideTask: (task: WorkItemRecord) => void,
  onToggleTaskLock: (task: WorkItemRecord) => void,
  onAbortTask: (task: WorkItemRecord) => void,
  onInspectTask: TaskNodeData["onInspect"],
  onActiveTaskCardChange: TaskNodeData["onActiveCardChange"],
  onReviewTask: (task: WorkItemRecord) => void,
  pendingCreatedAgents: PendingAgentProjection[],
  agentCreationWarnings: Record<string, string>,
  persistedNodePositions: PersistedNodePositionMap
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];
  const focusedAgent = focusedAgentId
    ? snapshot.agents.find((agent) => agent.id === focusedAgentId)
    : null;
  const selectedTask = selectedNodeId
    ? snapshot.tasks.find((task) => task.id === selectedNodeId) ?? null
    : null;
  const selectedTaskAgentId = selectedTask ? resolveTaskOwnerId(selectedTask) : null;
  const isFocusMode = focusedAgent !== null;
  const focusWorkspaceId = focusedAgent?.workspaceId ?? null;
  const visibleWorkspaces = isFocusMode
    ? snapshot.workspaces.filter((workspace) => workspace.id === focusWorkspaceId)
    : activeWorkspaceId
      ? snapshot.workspaces.filter((workspace) => workspace.id === activeWorkspaceId)
      : [...snapshot.workspaces].sort(
          (left, right) => right.activeRuntimeIds.length - left.activeRuntimeIds.length
        );

  const workspaceNodes: CanvasNode[] = [];
  const contentNodes: CanvasNode[] = [];
  const surfaceModuleNodes: CanvasNode[] = [];
  const graphTasks: WorkItemRecord[] = [];
  let rowTopY = 42;
  let rowMaxHeight = 0;
  const liveAgentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const crossAgentTargetIds = snapshot.agents.map((agent) => agent.id);

  visibleWorkspaces.forEach((workspace, workspaceIndex) => {
    const liveWorkspaceAgents = isFocusMode
      ? snapshot.agents.filter(
          (agent) => agent.workspaceId === workspace.id && agent.id === focusedAgentId
        )
      : snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
    const pendingWorkspaceAgents = isFocusMode
      ? []
      : pendingCreatedAgents
          .filter((agent) => agent.workspaceId === workspace.id && !liveAgentIds.has(agent.id))
          .sort((left, right) => left.createdAt - right.createdAt)
          .map(buildPendingAgentRecord);
    const pendingWorkspaceAgentIds = new Set(pendingWorkspaceAgents.map((agent) => agent.id));
    const pendingWorkspaceAgentWarnings = new Map(
      pendingCreatedAgents
        .filter((agent) => agent.workspaceId === workspace.id && agent.warning)
        .map((agent) => [agent.id, agent.warning ?? ""])
    );
    const workspaceAgents = [...liveWorkspaceAgents, ...pendingWorkspaceAgents];
    const workspaceTaskRecords = isFocusMode
      ? snapshot.tasks.filter(
          (task) =>
            resolveTaskWorkspaceId(task, snapshot.agents) === workspace.id &&
            task.primaryAgentId === focusedAgentId
        )
      : snapshot.tasks.filter((task) => resolveTaskWorkspaceId(task, snapshot.agents) === workspace.id);
    const workspaceToggleTasks = isFocusMode
      ? []
      : workspaceTaskRecords.filter((task) => !safeLockedTaskKeys.includes(task.key));
    const workspaceTasks = isFocusMode
      ? workspaceTaskRecords
      : workspaceTaskRecords.filter(
          (task) => !isTaskHidden(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
        );
    const workspaceTaskCardsHidden =
      !isFocusMode &&
      workspaceToggleTasks.length > 0 &&
      workspaceToggleTasks.every((task) =>
        isTaskHidden(task, safeHiddenRuntimeIds, safeHiddenTaskKeys, safeLockedTaskKeys)
      );
    const workspaceColumn = workspaceIndex % 2;
    const groupX = workspaceColumn * workspaceColumnGap + 44;
    const groupY = rowTopY;
    let laneY = groupY + workspaceHeaderOffsetY;
    let idleAgentGridColumn = 0;

    const flushIdleAgentGridRow = () => {
      if (idleAgentGridColumn === 0) {
        return;
      }

      laneY += idleAgentGridRowHeight;
      idleAgentGridColumn = 0;
    };

    workspaceAgents.forEach((agent, agentIndex) => {
      const agentTasks = workspaceTasks
        .filter((task) => resolveTaskOwnerId(task) === agent.id)
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      const hasVisibleTaskLane = agentTasks.length > 0;

      if (hasVisibleTaskLane) {
        flushIdleAgentGridRow();
      }

      const agentX = hasVisibleTaskLane
        ? groupX + agentGridStartX
        : groupX + agentGridStartX + idleAgentGridColumn * agentGridColumnGap;
      const agentY = laneY + (hasVisibleTaskLane ? agentIndex * 4 : 0);
      const taskX = groupX + taskLaneStartX;
      const isComposerHighlightedAgent = isComposerActive && composerTargetAgentId === agent.id;
      const hasJustCreatedTask = agentTasks.some((task) => justCreatedTaskIds.includes(task.id));
      const isTaskFocusedAgent = selectedTaskAgentId === agent.id || hasJustCreatedTask;
      const activeTaskCount = agentTasks.filter((task) => isLiveTask(task)).length;
      const isAgentChatOpen = activeChatAgentId === agent.id;
      const agentInboxItems = (snapshot.agentInbox ?? []).filter((item) => item.agentId === agent.id);
      const isPendingCreation = pendingWorkspaceAgentIds.has(agent.id);
      const creationWarning = agentCreationWarnings[agent.id] ?? pendingWorkspaceAgentWarnings.get(agent.id) ?? null;
      const surfaceBadges = buildAgentSurfaceBadges(snapshot, workspace, agent);
      const accountBadges = buildAgentAccountBadges(accountTargets, accountAccessRules, workspace, agent);
      const connectedBadgeCount = surfaceBadges.length + accountBadges.length;
      const modelLabel = resolveAgentModelLabel(agent.modelId, snapshot.models);
      const agentPosition = resolvePersistedPosition(
        toPersistedAgentPositionKey(agent),
        { x: agentX, y: agentY },
        persistedNodePositions,
        toLegacyPersistedAgentPositionKey(agent.id)
      );

      contentNodes.push({
        id: agent.id,
        type: "agent",
        draggable: true,
        position: agentPosition,
        zIndex:
          recentCreatedAgentId === agent.id
            ? 58
            : isComposerHighlightedAgent
              ? 55
              : isTaskFocusedAgent
                ? 48
                : activeTaskCount > 0
                  ? 24
                  : 10,
        selected: false,
        data: {
          agent,
          emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
          focused: focusedAgentId === agent.id,
          pendingCreation: isPendingCreation,
          creationWarning,
          composerFocused: isComposerHighlightedAgent,
          taskFocused: isTaskFocusedAgent,
          creationPulse: recentCreatedAgentId === agent.id,
          activeTaskCount,
          chatOpen: isAgentChatOpen,
          agentInboxItems,
          crossAgentTargetIds,
          relativeTimeReferenceMs,
          modelLabel,
          surfaceBadges,
          accountBadges,
          onMessage: isPendingCreation ? undefined : onMessageAgent,
          onCreateTask: isPendingCreation ? undefined : onCreateTaskAgent,
          onEdit: isPendingCreation ? undefined : onEditAgent,
          onDelete: isPendingCreation ? undefined : onDeleteAgent,
          onFocus: isPendingCreation ? undefined : onFocusAgent,
          onConfigureModel: isPendingCreation ? undefined : onConfigureAgentModel,
          onConfigureCapabilities: isPendingCreation ? undefined : onConfigureAgentCapabilities,
          onOpenContextEngine: isPendingCreation ? undefined : onOpenAgentContextEngine,
          onRefresh: isPendingCreation ? undefined : onRefresh,
          onConnectionMenuOpenChange: isPendingCreation ? undefined : onAgentConnectionMenuOpenChange,
          onInspect: isPendingCreation ? undefined : onInspectAgentDetail,
          onOpenWorkspaceChannels: isPendingCreation ? undefined : onOpenWorkspaceChannels,
          onOpenAccounts: isPendingCreation ? undefined : onOpenAccounts
        }
      });

      surfaceBadges.forEach((surfaceBadge, surfaceIndex) => {
        surfaceModuleNodes.push({
          id: toSurfaceTetherNodeId(agent, surfaceBadge.provider),
          type: "surface-module",
          draggable: false,
          selectable: false,
          width: 64,
          height: 64,
          position: resolveSurfaceModuleAnchorPosition(agentPosition, surfaceIndex, connectedBadgeCount),
          zIndex: isComposerHighlightedAgent ? 55 : isTaskFocusedAgent ? 48 : 18,
          selected: false,
          data: {
            agent,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            provider: surfaceBadge.provider,
            variant: "surface",
            label: surfaceBadge.label,
            anchorIndex: surfaceIndex + 1,
            anchorCount: connectedBadgeCount + 1,
            surfaceCount: surfaceBadge.count,
            surfaceNames: surfaceBadge.surfaceNames ?? [],
            roleLabel: surfaceBadge.roleLabel,
            roleTone: surfaceBadge.roleTone ?? "primary",
            accentColor: surfaceBadge.accentColor ?? null
          }
        });
      });

      accountBadges.forEach((accountBadge, accountIndex) => {
        const anchorIndex = surfaceBadges.length + accountIndex;

        surfaceModuleNodes.push({
          id: toAccountTetherNodeId(agent, accountBadge.id),
          type: "surface-module",
          draggable: false,
          selectable: false,
          width: 64,
          height: 64,
          position: resolveSurfaceModuleAnchorPosition(agentPosition, anchorIndex, connectedBadgeCount),
          zIndex: isComposerHighlightedAgent ? 55 : isTaskFocusedAgent ? 48 : 18,
          selected: false,
          data: {
            agent,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            variant: "account",
            label: accountBadge.serviceName,
            anchorIndex: anchorIndex + 1,
            anchorCount: connectedBadgeCount + 1,
            surfaceCount: accountBadge.count,
            surfaceNames: accountBadge.accountNames ?? [],
            roleLabel: accountBadge.roleLabel,
            roleTone: "delegate",
            accentColor: accountBadge.accentColor ?? null,
            accountId: accountBadge.id,
            accountServiceId: accountBadge.serviceId,
            accountServiceName: accountBadge.serviceName,
            accountPrimaryDomain: accountBadge.primaryDomain,
            accountBrowserProfileName: accountBadge.browserProfileName
          }
        });
      });

      graphTasks.push(...agentTasks);

      agentTasks.forEach((task, taskIndex) => {
        const bootstrapStage = typeof task.metadata.bootstrapStage === "string" ? task.metadata.bootstrapStage : null;
        const isBootstrapTask =
          bootstrapStage === "submitting" ||
          bootstrapStage === "accepted" ||
          bootstrapStage === "waiting-for-heartbeat" ||
          bootstrapStage === "waiting-for-runtime" ||
          bootstrapStage === "runtime-observed";
        const isJustCreatedTask = justCreatedTaskIds.includes(task.id);

        contentNodes.push({
          id: task.id,
          type: "task",
          draggable: true,
          selectable: true,
          position: resolvePersistedPosition(
            toPersistedTaskPositionKey(task),
            { x: taskX, y: agentY + taskIndex * 420 + 10 },
            persistedNodePositions,
            toLegacyPersistedTaskPositionKey(task.id)
          ),
          zIndex: isBootstrapTask ? 40 : isJustCreatedTask ? 28 : 10,
          selected: false,
          data: {
            task,
            workspacePath: workspace.path,
            emphasis: isFocusMode ? true : !activeWorkspaceId || activeWorkspaceId === workspace.id,
            relativeTimeReferenceMs,
            pendingCreation: isBootstrapTask,
            justCreated: isJustCreatedTask,
            locked: safeLockedTaskKeys.includes(task.key),
            onReply: onReplyTask,
            onCopyPrompt: onCopyTaskPrompt,
            onHide: onHideTask,
            onToggleLock: onToggleTaskLock,
            onAbortTask,
            onInspect: onInspectTask,
            onActiveCardChange: onActiveTaskCardChange,
            onReviewTask
          }
        });
      });

      if (hasVisibleTaskLane) {
        laneY += Math.max(taskCardLaneHeight, agentTasks.length * taskCardLaneHeight + taskLaneBottomPadding);
        return;
      }

      idleAgentGridColumn += 1;

      if (idleAgentGridColumn >= idleAgentGridColumns) {
        flushIdleAgentGridRow();
      }
    });

    flushIdleAgentGridRow();

    if (!isFocusMode) {
      const workspaceHeight = Math.max(laneY - groupY + workspaceContentBottomPadding, workspaceMinHeight);

      workspaceNodes.push({
        id: workspace.id,
        type: "workspace",
        draggable: false,
        position: { x: groupX, y: groupY },
        zIndex: 0,
        style: {
          width: workspaceGroupWidth,
          height: workspaceHeight
        },
        selectable: true,
        selected: false,
        data: {
          workspace,
          emphasis: !activeWorkspaceId || activeWorkspaceId === workspace.id,
          taskCardCount: workspaceToggleTasks.length,
          taskCardsHidden: workspaceTaskCardsHidden,
          onOpenWorkspaceFiles,
          onToggleTaskCards:
            workspaceToggleTasks.length > 0 ? () => onToggleWorkspaceTaskCards(workspace.id) : undefined
        }
      });

      rowMaxHeight = Math.max(rowMaxHeight, workspaceHeight);

      if (workspaceColumn === 1 || workspaceIndex === visibleWorkspaces.length - 1) {
        rowTopY += rowMaxHeight + 80;
        rowMaxHeight = 0;
      }
    }
  });

  const nodes: CanvasNode[] = [...workspaceNodes, ...contentNodes, ...surfaceModuleNodes];
  return {
    nodes,
    edges: [
      ...buildEdgesForNodes(
        graphTasks,
        nodes,
        selectedNodeId,
        justCreatedTaskIds,
        composerTargetAgentId,
        isComposerActive
      ),
      ...buildSurfaceTetherEdges(nodes, composerTargetAgentId, isComposerActive)
    ]
  };
}

export function buildEdgesForNodes(
  tasks: WorkItemRecord[],
  nodes: CanvasNode[],
  selectedNodeId: string | null,
  justCreatedTaskIds: string[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const task of tasks) {
    const ownerAgentId = resolveTaskOwnerId(task);

    if (!ownerAgentId) {
      continue;
    }

    const source = nodesById.get(ownerAgentId);
    const target = nodesById.get(task.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${ownerAgentId}:${task.id}`,
      source: ownerAgentId,
      target: task.id,
      sourceHandle: "source-right",
      targetHandle: "target-left",
      type: "simplebezier",
      zIndex: 4,
      animated:
        isLiveTask(task) ||
        task.id === selectedNodeId ||
        justCreatedTaskIds.includes(task.id) ||
        (isComposerActive && ownerAgentId === composerTargetAgentId),
      data: {
        composerFocused: isComposerActive && ownerAgentId === composerTargetAgentId,
        taskFocused: task.id === selectedNodeId || justCreatedTaskIds.includes(task.id)
      },
      style: {
        strokeWidth:
          isLiveTask(task) && isComposerActive && ownerAgentId === composerTargetAgentId
            ? 3.05
            : isLiveTask(task)
              ? 2.95
              : task.id === selectedNodeId || justCreatedTaskIds.includes(task.id)
                ? 2.82
                : isComposerActive && ownerAgentId === composerTargetAgentId
                  ? 2.8
                  : 2.25
      }
    });
  }

  return edges;
}

export function buildSurfaceTetherEdges(
  nodes: CanvasNode[],
  composerTargetAgentId: string | null,
  isComposerActive: boolean
) {
  const edges: CanvasEdge[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (node.type !== "surface-module") {
      continue;
    }

    const sourceAgentId = node.data.agent.id;
    const source = nodesById.get(sourceAgentId);
    const target = nodesById.get(node.id);

    if (!source || !target) {
      continue;
    }

    edges.push({
      id: `edge:${sourceAgentId}:${node.id}`,
      source: sourceAgentId,
      target: node.id,
      sourceHandle: "source-surface",
      targetHandle: node.data.variant === "add" ? "target-surface-action" : "target-surface",
      type: "simplebezier",
      zIndex: 8,
      animated: true,
      data: {
        surfaceTether: true,
        surfaceAccentColor: node.data.accentColor ?? null,
        composerFocused: isComposerActive && composerTargetAgentId === sourceAgentId
      },
      style: {
        strokeWidth: isComposerActive && composerTargetAgentId === sourceAgentId ? 2.2 : 1.95
      }
    });
  }

  return edges;
}

export function isTaskHidden(
  task: WorkItemRecord,
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[]
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];

  if (safeLockedTaskKeys.includes(task.key)) {
    return false;
  }

  if (safeHiddenTaskKeys.includes(task.key)) {
    return true;
  }

  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => safeHiddenRuntimeIds.includes(runtimeId));
}

export function resolveTaskOwnerId(task: WorkItemRecord) {
  return task.primaryAgentId || task.agentIds[0] || null;
}

export function resolveTaskWorkspaceId(task: WorkItemRecord, agents: AgentRecord[]) {
  if (task.workspaceId?.trim()) {
    return task.workspaceId;
  }

  const taskAgentIds = [task.primaryAgentId, ...task.agentIds].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  for (const agentId of taskAgentIds) {
    const workspaceId = agents.find((agent) => agent.id === agentId)?.workspaceId;

    if (workspaceId) {
      return workspaceId;
    }
  }

  return null;
}

export function isLiveTask(task: WorkItemRecord) {
  return task.status === "queued" || task.status === "running";
}

export function buildAgentSurfaceBadges(
  snapshot: MissionControlSnapshot,
  workspace: MissionControlSnapshot["workspaces"][number],
  agent: AgentRecord
) {
  const summaries = new Map<
    string,
    {
      surfaceIds: Set<string>;
      surfaceNames: Set<string>;
      primaryCount: number;
      assistantCount: number;
      routeCount: number;
    }
  >();

  for (const channel of snapshot.channelRegistry.channels) {
    const workspaceBinding = channel.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;
    if (!workspaceBinding) {
      continue;
    }

    const enabledAssignments = workspaceBinding.groupAssignments.filter((assignment) => assignment.enabled !== false);
    const ownedAssignments = enabledAssignments.filter((assignment) => assignment.agentId === agent.id);
    const isPrimary = channel.primaryAgentId === agent.id;
    const isAssistant = !isPrimary && workspaceBinding.agentIds.includes(agent.id);

    if (!isPrimary && !isAssistant && ownedAssignments.length === 0) {
      continue;
    }

    const current =
      summaries.get(channel.type) ?? {
        surfaceIds: new Set<string>(),
        surfaceNames: new Set<string>(),
        primaryCount: 0,
        assistantCount: 0,
        routeCount: 0
      };
    current.surfaceIds.add(channel.id);
    current.surfaceNames.add(channel.name);
    current.primaryCount += isPrimary ? 1 : 0;
    current.assistantCount += isAssistant ? 1 : 0;
    current.routeCount += ownedAssignments.length;
    summaries.set(channel.type, current);
  }

  return Array.from(summaries.entries())
    .map(([provider, summary]) => {
      const catalogEntry = getSurfaceCatalogEntry(provider);
      const roleParts: string[] = [];

      if (summary.primaryCount > 0) {
        roleParts.push(
          `Primary on ${summary.primaryCount} ${summary.primaryCount === 1 ? "integration" : "integrations"}`
        );
      }

      if (summary.routeCount > 0) {
        roleParts.push(`Owns ${summary.routeCount} ${summary.routeCount === 1 ? "route" : "routes"}`);
      }

      if (summary.assistantCount > 0) {
        roleParts.push(
          `Assistant on ${summary.assistantCount} ${summary.assistantCount === 1 ? "integration" : "integrations"}`
        );
      }

      const roleTone =
        summary.primaryCount > 0 && (summary.routeCount > 0 || summary.assistantCount > 0)
          ? "mixed"
          : summary.primaryCount > 0
            ? "primary"
            : summary.routeCount > 0
              ? "owner"
              : "delegate";

      return {
        provider,
        label: catalogEntry.label,
        count: summary.surfaceIds.size,
        roleLabel: roleParts.join(" · "),
        roleTone,
        accentColor: catalogEntry.accentColor ?? null,
        surfaceNames: Array.from(summary.surfaceNames).sort((left, right) => left.localeCompare(right))
      } satisfies AgentSurfaceBadge;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function buildAgentAccountBadges(
  accountTargets: AccountLoginTargetView[],
  accessRules: AccountAccessRuleView[],
  workspace: MissionControlSnapshot["workspaces"][number],
  agent: AgentRecord
) {
  const targetsById = new Map(
    accountTargets
      .filter((target) => target.workspaceId === workspace.id)
      .map((target) => [target.id, target])
  );
  const summaries = new Map<
    string,
    {
      targetIds: Set<string>;
      accountNames: Set<string>;
      serviceId: string;
      serviceName: string;
      primaryDomain: string;
      browserProfileName: string;
    }
  >();

  for (const rule of accessRules) {
    if (
      rule.workspaceId !== workspace.id ||
      rule.agentId !== agent.id ||
      rule.permission !== "use_browser_profile"
    ) {
      continue;
    }

    const target = targetsById.get(rule.targetId);
    if (!target) {
      continue;
    }

    const key = target.serviceId || target.primaryDomain || target.id;
    const current =
      summaries.get(key) ?? {
        targetIds: new Set<string>(),
        accountNames: new Set<string>(),
        serviceId: target.serviceId,
        serviceName: target.serviceName,
        primaryDomain: target.primaryDomain,
        browserProfileName: target.browserProfileName
      };

    current.targetIds.add(target.id);
    current.accountNames.add(`${target.serviceName} · ${target.browserProfileName}`);
    summaries.set(key, current);
  }

  return Array.from(summaries.entries())
    .map(([id, summary]) => ({
      id,
      serviceId: summary.serviceId,
      serviceName: summary.serviceName,
      primaryDomain: summary.primaryDomain,
      browserProfileName: summary.browserProfileName,
      count: summary.targetIds.size,
      roleLabel: `Can use ${summary.serviceName} via ${summary.browserProfileName}`,
      accentColor: resolveAccountBadgeAccentColor(summary.serviceId, summary.primaryDomain),
      accountNames: Array.from(summary.accountNames).sort((left, right) => left.localeCompare(right))
    }) satisfies AgentAccountBadge)
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

function resolveAccountBadgeAccentColor(serviceId: string, primaryDomain: string) {
  const key = `${serviceId} ${primaryDomain}`.toLowerCase();

  if (key.includes("product-hunt") || key.includes("producthunt")) {
    return "#da552f";
  }

  if (key.includes("gmail") || key.includes("google")) {
    return "#ea4335";
  }

  if (key.includes("x-twitter") || key.includes("x.com") || key.includes("twitter")) {
    return "#ffffff";
  }

  if (key.includes("github")) {
    return "#f5f5f5";
  }

  if (key.includes("discord")) {
    return "#5865f2";
  }

  if (key.includes("telegram")) {
    return "#26a5e4";
  }

  return "#facc15";
}
