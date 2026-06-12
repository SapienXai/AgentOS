import type { Edge, Node } from "@xyflow/react";

import type {
  MissionControlSurfaceProvider,
  ModelRecord,
  AgentRecord,
  RuntimeActivityRecord,
  WorkItemRecord,
  WorkspaceRecord
} from "@/lib/agentos/contracts";

export type WorkspaceNodeData = Record<string, unknown> & {
  workspace: WorkspaceRecord;
  emphasis: boolean;
  taskCardCount: number;
  taskCardsHidden: boolean;
  onToggleTaskCards?: () => void;
  onOpenWorkspaceFiles?: (workspaceId: string) => void;
};

export type AgentDetailFocus = "skills" | "tools" | "sessions";

export type AgentSurfaceBadge = {
  provider: MissionControlSurfaceProvider;
  label: string;
  count: number;
  roleLabel: string;
  roleTone?: "primary" | "owner" | "delegate" | "mixed";
  accentColor?: string | null;
  surfaceNames?: string[];
};

export type AgentAccountBadge = {
  id: string;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
  browserProfileName: string;
  count: number;
  roleLabel: string;
  accentColor?: string | null;
  accountNames?: string[];
};

export type AgentNodeData = Record<string, unknown> & {
  agent: AgentRecord;
  modelLabel: string;
  emphasis: boolean;
  focused?: boolean;
  pendingCreation?: boolean;
  creationWarning?: string | null;
  composerFocused?: boolean;
  taskFocused?: boolean;
  creationPulse?: boolean;
  activeTaskCount?: number;
  chatOpen?: boolean;
  relativeTimeReferenceMs: number;
  surfaceBadges?: AgentSurfaceBadge[];
  accountBadges?: AgentAccountBadge[];
  onMessage?: (agentId: string) => void;
  onCreateTask?: (agentId: string) => void;
  onEdit?: (agentId: string) => void;
  onDelete?: (agentId: string) => void;
  onFocus?: (agentId: string) => void;
  onConfigureModel?: (agentId: string) => void;
  onConfigureCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onInspect?: (agentId: string, focus: AgentDetailFocus) => void;
  onOpenWorkspaceChannels?: (workspaceId?: string, agentId?: string) => void;
  onOpenAccounts?: (workspaceId?: string, agentId?: string) => void;
};

export type SurfaceTetherNodeData = Record<string, unknown> & {
  agent: AgentRecord;
  emphasis: boolean;
  provider?: MissionControlSurfaceProvider;
  label: string;
  variant?: "surface" | "account" | "add";
  anchorIndex: number;
  anchorCount: number;
  surfaceCount: number;
  surfaceNames: string[];
  roleLabel: string;
  roleTone: "primary" | "owner" | "delegate" | "mixed";
  accentColor?: string | null;
  accountId?: string;
  accountServiceId?: string;
  accountServiceName?: string;
  accountPrimaryDomain?: string;
  accountBrowserProfileName?: string;
  actionLabel?: string;
  onClick?: () => void;
};

export type RuntimeNodeData = Record<string, unknown> & {
  runtime: RuntimeActivityRecord;
  emphasis: boolean;
  pendingCreation?: boolean;
  justCreated?: boolean;
  onReply?: (runtime: RuntimeActivityRecord) => void;
  onCopyPrompt?: (runtime: RuntimeActivityRecord) => void;
  onHide?: (runtimeId: string) => void;
};

export type TaskNodeData = Record<string, unknown> & {
  task: WorkItemRecord;
  workspacePath?: string;
  emphasis: boolean;
  relativeTimeReferenceMs: number;
  pendingCreation?: boolean;
  justCreated?: boolean;
  locked?: boolean;
  onInspect?: (task: WorkItemRecord, target: "overview" | "output" | "files", activeCard?: TaskCardInspectorContext | null) => void;
  onActiveCardChange?: (task: WorkItemRecord, activeCard: TaskCardInspectorContext | null) => void;
  onReviewTask?: (task: WorkItemRecord) => void;
  onReply?: (task: WorkItemRecord) => void;
  onCopyPrompt?: (task: WorkItemRecord) => void;
  onHide?: (task: WorkItemRecord) => void;
  onToggleLock?: (task: WorkItemRecord) => void;
  onAbortTask?: (task: WorkItemRecord) => void;
};

export type TaskCardInspectorContext = {
  taskId: string;
  cardNumber: number;
  followUpIndex: number | null;
  message?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  summary?: string | null;
  createdAt?: string | null;
};

export type ModelNodeData = Record<string, unknown> & {
  model: ModelRecord;
  emphasis: boolean;
};

export type MissionEdgeData = {
  composerFocused?: boolean;
  taskFocused?: boolean;
  surfaceTether?: boolean;
  surfaceAccentColor?: string | null;
};

type WorkspaceCanvasNode = Node<WorkspaceNodeData, "workspace">;
type AgentCanvasNode = Node<AgentNodeData, "agent">;
type SurfaceTetherCanvasNode = Node<SurfaceTetherNodeData, "surface-module">;
type TaskCanvasNode = Node<TaskNodeData, "task">;

export type CanvasEdge = Edge<MissionEdgeData, "simplebezier">;
export type CanvasNode = WorkspaceCanvasNode | AgentCanvasNode | SurfaceTetherCanvasNode | TaskCanvasNode;
export type PersistedNodePosition = {
  x: number;
  y: number;
};
export type SpringVelocity = {
  x: number;
  y: number;
};
export type PersistedNodePositionMap = Record<string, PersistedNodePosition>;
export type FocusTaskAnchor = {
  taskId: string;
  agentId: string | null;
};
