"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cpu,
  FileText,
  FolderKanban,
  Gauge,
  Home,
  Inbox,
  KeyRound,
  Plug,
  Plus,
  Settings2,
  TerminalSquare
} from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import type { PendingAgentProjection } from "@/components/mission-control/pending-agent-projection";
import { RailTooltip } from "@/components/mission-control/rail-tooltip";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  AGENT_PRESET_OPTIONS,
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  applyPresetHeartbeat,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft,
  type AgentHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import {
  getWorkspaceChannelIdsForAgent,
  syncWorkspaceAgentChannelBindings
} from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type {
  AgentPolicy,
  AgentPreset,
  DiscoveredModelCandidate,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type AgentDraft = {
  id: string;
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
  channelIds: string[];
};

type SidebarSection = "overview" | "operations" | "system";

type SidebarItem = {
  label: string;
  href?: string;
  hash?: string;
  icon: LucideIcon;
  badge?: number;
  section: SidebarSection;
};

type MissionSidebarProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  activeWorkspaceId: string | null;
  requestedAgentAction?: {
    requestId: string;
    kind: "edit" | "delete";
    agentId: string;
  } | null;
  connectionState: "connecting" | "live" | "retrying";
  collapsed: boolean;
  modelManager: {
    runState: "idle" | "running" | "success" | "error";
    statusMessage: string | null;
    resultMessage: string | null;
    log: string;
    manualCommand: string | null;
    docsUrl: string | null;
    discoveredModels: DiscoveredModelCandidate[];
    systemReady: boolean;
  };
  onExpandCollapsed?: () => void;
  onToggleCollapsed: () => void;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onRefresh: () => Promise<void>;
  onRunModelRefresh: () => void;
  onRunModelDiscover: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onConnectModelProvider: (provider: string) => void;
  onOpenModelSetup: () => void;
  onOpenAddModels: () => void;
  onOpenWorkspaceCreate: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreationPending?: (agent: PendingAgentProjection) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  settingsMode?: boolean;
};

const sidebarSections: Array<{ id: SidebarSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "operations", label: "Operations" },
  { id: "system", label: "System" }
];

const sidebarItems: SidebarItem[] = [
  { label: "Mission Control", href: "/", icon: Gauge, section: "overview" },
  { label: "Dashboard", href: "/dashboard", icon: Inbox, section: "overview" },
  { label: "Agents", href: "/agents", icon: Bot, section: "operations" },
  { label: "Tasks", href: "/tasks", icon: ClipboardList, section: "operations" },
  { label: "Files", href: "/files", icon: FileText, section: "operations" },
  { label: "Accounts", href: "/accounts", icon: KeyRound, section: "operations" },
  { label: "Models", href: "/models", icon: Cpu, section: "operations" },
  { label: "Integrations", href: "/integrations", icon: Plug, section: "operations" },
  { label: "Settings", href: "/settings", icon: Settings2, section: "system" },
  { label: "Diagnostics", href: "/settings#diagnostics", hash: "diagnostics", icon: TerminalSquare, section: "system" }
];

export function MissionSidebar({
  snapshot,
  surfaceTheme,
  activeWorkspaceId,
  requestedAgentAction,
  connectionState,
  collapsed,
  onExpandCollapsed,
  onToggleCollapsed,
  onSelectWorkspace,
  onRefresh,
  onOpenWorkspaceCreate,
  onSnapshotChange
}: MissionSidebarProps) {
  const pathname = usePathname();
  const [activeHash, setActiveHash] = useState("");
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [isEditAgentAdvancedOpen, setIsEditAgentAdvancedOpen] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isDeleteAgentOpen, setIsDeleteAgentOpen] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [editDraft, setEditDraft] = useState<AgentDraft | null>(null);
  const [editChannelIdsBaseline, setEditChannelIdsBaseline] = useState<string[]>([]);
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<MissionControlSnapshot["agents"][number] | null>(null);
  const [agentDeleteConfirmText, setAgentDeleteConfirmText] = useState("");
  const handledRequestedAgentActionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash.replace(/^#/, ""));

    syncHash();
    window.addEventListener("hashchange", syncHash);

    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const activeWorkspace =
    (activeWorkspaceId
      ? snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId)
      : null) ??
    snapshot.workspaces[0] ??
    null;
  const statusTone = resolveStatusTone(snapshot.diagnostics.health, connectionState);
  const statusLabel =
    connectionState === "live"
      ? "Online"
      : connectionState === "retrying"
        ? "Retrying"
        : "Connecting";
  const handleNavigate = useCallback((item: SidebarItem) => {
    setActiveHash(item.hash ?? "");
  }, []);

  const handleEditAgentOpenChange = (nextOpen: boolean) => {
    setIsEditAgentOpen(nextOpen);

    if (!nextOpen) {
      setEditDraft(null);
      setEditChannelIdsBaseline([]);
      setIsEditAgentAdvancedOpen(false);
    }
  };

  const openEditAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    const nextChannelIds = getWorkspaceChannelIdsForAgent(snapshot, agent.workspaceId, agent.id);

    setEditDraft({
      ...buildAgentDraft(agent.workspaceId, {
        id: agent.id,
        modelId: agent.modelId === "unassigned" ? "" : agent.modelId,
        name: formatAgentDisplayName(agent),
        emoji: agent.identity.emoji ?? "",
        theme: agent.identity.theme ?? "",
        avatar: agent.identity.avatar ?? "",
        policy: agent.policy,
        heartbeat: resolveHeartbeatDraft(agent.policy.preset, {
          enabled: agent.heartbeat.enabled,
          every: agent.heartbeat.every ?? undefined
        }),
        channelIds: nextChannelIds
      })
    });
    setEditChannelIdsBaseline(nextChannelIds);
    setIsEditAgentAdvancedOpen(false);
    setIsEditAgentOpen(true);
  }, [snapshot]);

  const openDeleteAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    setAgentDeleteTarget(agent);
    setAgentDeleteConfirmText("");
    setIsDeleteAgentOpen(true);
  }, []);

  useEffect(() => {
    if (!requestedAgentAction || handledRequestedAgentActionIdRef.current === requestedAgentAction.requestId) {
      return;
    }

    const agent = snapshot.agents.find((entry) => entry.id === requestedAgentAction.agentId);

    if (!agent) {
      return;
    }

    handledRequestedAgentActionIdRef.current = requestedAgentAction.requestId;

    if (requestedAgentAction.kind === "edit") {
      openEditAgent(agent);
      return;
    }

    openDeleteAgent(agent);
  }, [requestedAgentAction, snapshot.agents, openDeleteAgent, openEditAgent]);

  const submitEditAgent = async () => {
    if (!editDraft) {
      return;
    }

    const targetWorkspace = snapshot.workspaces.find((workspace) => workspace.id === editDraft.workspaceId) ?? null;
    setIsSavingAgent(true);
    let succeeded = false;

    try {
      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(editDraft)
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not update the agent.");
      }

      if (targetWorkspace) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: editDraft.workspaceId,
          workspacePath: targetWorkspace.path,
          agentId: editDraft.id,
          currentChannelIds: editChannelIdsBaseline,
          nextChannelIds: editDraft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      onSnapshotChange?.((currentSnapshot) => applyEditedAgentDraftToSnapshot(currentSnapshot, editDraft));
      handleEditAgentOpenChange(false);
      succeeded = true;
    } catch (error) {
      toast.error("Agent update failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsSavingAgent(false);
    }

    if (succeeded) {
      void onRefresh().catch(() => {});
      toast.success("Agent updated in OpenClaw.", {
        description: editDraft.id
      });
    }
  };

  const submitDeleteAgent = async () => {
    if (!agentDeleteTarget) {
      return;
    }

    setIsDeletingAgent(true);
    let succeeded = false;
    let deletedAgentId = agentDeleteTarget.id;

    try {
      const response = await fetch("/api/agents", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          agentId: agentDeleteTarget.id
        })
      });

      const result = (await response.json()) as {
        agentId?: string;
        deletedRuntimeCount?: number;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not delete the agent.");
      }

      if (editDraft?.id === agentDeleteTarget.id) {
        handleEditAgentOpenChange(false);
      }

      setIsDeleteAgentOpen(false);
      setAgentDeleteTarget(null);
      setAgentDeleteConfirmText("");
      deletedAgentId = result.agentId || agentDeleteTarget.id;
      succeeded = true;
    } catch (error) {
      toast.error("Agent deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsDeletingAgent(false);
    }

    if (succeeded) {
      void onRefresh().catch(() => {});
      toast.success("Agent deleted from OpenClaw.", {
        description: deletedAgentId
      });
    }
  };

  const showEditAgentHeartbeatControls = editDraft
    ? isEditAgentAdvancedOpen || editDraft.policy.preset === "monitoring"
    : false;

  return (
    <>
      {collapsed ? (
        <CollapsedSidebar
          activeHash={activeHash}
          pathname={pathname}
          statusTone={statusTone}
          surfaceTheme={surfaceTheme}
          workspaceLabel={activeWorkspaceId === null ? "All workspaces" : activeWorkspace?.name || "No workspace"}
          workspaceDetail={activeWorkspaceId === null ? `${snapshot.workspaces.length} workspaces` : "Workspace"}
          onItemNavigate={handleNavigate}
          onExpandCollapsed={onExpandCollapsed ?? onToggleCollapsed}
        />
      ) : (
        <aside className="relative flex h-full w-full flex-col overflow-hidden border-r border-white/[0.08] bg-[radial-gradient(circle_at_18%_0%,rgba(56,102,170,0.20),transparent_34%),linear-gradient(180deg,rgba(18,26,41,0.98)_0%,rgba(10,16,27,0.98)_48%,rgba(5,10,18,0.99)_100%)] text-slate-100 shadow-[18px_0_60px_rgba(0,0,0,0.34)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.055),transparent_38%),radial-gradient(circle_at_55%_0%,rgba(59,130,246,0.10),transparent_30%)]"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/[0.08]" />

          <div className="relative flex h-full min-h-0 flex-col px-4 py-5">
            <SidebarBrand onToggleCollapsed={onToggleCollapsed} />

            <WorkspaceSwitcher
              activeWorkspaceId={activeWorkspaceId}
              snapshot={snapshot}
              workspace={activeWorkspace}
              statusLabel={statusLabel}
              statusTone={statusTone}
              onSelectWorkspace={onSelectWorkspace}
              onOpenWorkspaceCreate={onOpenWorkspaceCreate}
            />

            <nav aria-label="Primary" className="sidebar-scroll mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="flex flex-col gap-5">
                {sidebarSections.map((section) => (
                  <SidebarSectionGroup
                    key={section.id}
                    activeHash={activeHash}
                    pathname={pathname}
                    section={section}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            </nav>

          </div>
        </aside>
      )}

      <Dialog open={isDeleteAgentOpen} onOpenChange={setIsDeleteAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete OpenClaw agent</DialogTitle>
            <DialogDescription>
              This removes the selected agent from OpenClaw and detaches its workspace binding.
            </DialogDescription>
          </DialogHeader>

          {agentDeleteTarget ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border border-rose-300/20 bg-rose-400/10 p-2 text-rose-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col gap-1.5 text-sm text-rose-50">
                    <p className="font-medium">This action cannot be undone.</p>
                    <p className="text-rose-100/80">
                      OpenClaw will delete this agent, remove its config entry, remove its manifest record, and clean
                      up agent-specific policy/state files. Shared workspace docs and files will remain.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <DeleteMetric
                  label="Status"
                  value={agentDeleteTarget.status}
                  danger={isLiveAgent(agentDeleteTarget)}
                />
                <DeleteMetric
                  label="Runs"
                  value={String(snapshot.runtimes.filter((runtime) => runtime.agentId === agentDeleteTarget.id).length)}
                />
                <DeleteMetric
                  label="Workspace"
                  value={
                    snapshot.workspaces.find((workspace) => workspace.id === agentDeleteTarget.workspaceId)?.name ??
                    "Unknown"
                  }
                />
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Agent id</p>
                <p className="mt-1.5 break-all font-mono text-xs text-slate-300">{agentDeleteTarget.id}</p>
              </div>

              <FormField
                label={`Type ${agentDeleteTarget.id} to confirm`}
                htmlFor="delete-agent-confirm"
              >
                <Input
                  id="delete-agent-confirm"
                  value={agentDeleteConfirmText}
                  onChange={(event) => setAgentDeleteConfirmText(event.target.value)}
                  placeholder={agentDeleteTarget.id}
                />
              </FormField>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeleteAgentOpen(false);
                setAgentDeleteTarget(null);
                setAgentDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitDeleteAgent}
              disabled={
                isDeletingAgent ||
                !agentDeleteTarget ||
                agentDeleteConfirmText.trim() !== agentDeleteTarget.id
              }
            >
              {isDeletingAgent ? "Deleting..." : "Delete agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditAgentOpen} onOpenChange={handleEditAgentOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit OpenClaw agent</DialogTitle>
            <DialogDescription>
              Update the selected agent identity, preset, and operating policy.
            </DialogDescription>
          </DialogHeader>

          {editDraft ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Agent preset</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {AGENT_PRESET_OPTIONS.map((option) => (
                    <AgentPresetCard
                      key={option.value}
                      label={option.label}
                      description={option.description}
                      active={editDraft.policy.preset === option.value}
                      badgeVariant={getAgentPresetMeta(option.value).badgeVariant}
                      onClick={() =>
                        setEditDraft((current) => (current ? applyAgentPreset(current, option.value) : current))
                      }
                    />
                  ))}
                </div>
              </div>

              <AgentPolicySummary policy={editDraft.policy} />

              <FormField label="Agent id" htmlFor="edit-agent-id">
                <Input id="edit-agent-id" value={editDraft.id} disabled />
              </FormField>

              <FormField label="Display name" htmlFor="edit-agent-name">
                <Input
                  id="edit-agent-name"
                  value={editDraft.name}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            name: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultName}
                />
              </FormField>

              <FormField label="Workspace" htmlFor="edit-agent-workspace">
                <Input
                  id="edit-agent-workspace"
                  value={
                    snapshot.workspaces.find((workspace) => workspace.id === editDraft.workspaceId)?.name ||
                    editDraft.workspaceId
                  }
                  disabled
                />
              </FormField>

              <FormField label="Model" htmlFor="edit-agent-model">
                <select
                  id="edit-agent-model"
                  value={editDraft.modelId}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            modelId: event.target.value
                          }
                        : current
                    )
                  }
                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                >
                  <option value="">Use OpenClaw default</option>
                  {snapshot.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Emoji" htmlFor="edit-agent-emoji">
                  <Input
                    id="edit-agent-emoji"
                    value={editDraft.emoji}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              emoji: event.target.value
                            }
                          : current
                      )
                    }
                    placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultEmoji}
                  />
                </FormField>
                <FormField label="Theme" htmlFor="edit-agent-theme">
                  <Input
                    id="edit-agent-theme"
                    value={editDraft.theme}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              theme: event.target.value
                            }
                          : current
                      )
                    }
                    placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultTheme}
                  />
                </FormField>
              </div>

              <FormField label="Avatar URL" htmlFor="edit-agent-avatar">
                <Input
                  id="edit-agent-avatar"
                  value={editDraft.avatar}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            avatar: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder="https://example.com/avatar.png"
                />
              </FormField>

              <ChannelBindingPicker
                snapshot={snapshot}
                workspaceId={editDraft.workspaceId}
                channelIds={editDraft.channelIds}
                agentId={editDraft.id}
                isSaving={isSavingAgent}
                surfaceTheme="dark"
                onChange={(channelIds) =>
                  setEditDraft((current) =>
                    current
                      ? {
                          ...current,
                          channelIds
                        }
                      : current
                  )
                }
              />

              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Advanced policy</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Override how this agent handles missing tools, installs, file scope, and network usage.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[11px]"
                    onClick={() => setIsEditAgentAdvancedOpen((current) => !current)}
                  >
                    {isEditAgentAdvancedOpen ? "Hide" : "Show"}
                  </Button>
                </div>

                {showEditAgentHeartbeatControls ? (
                  <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">Heartbeat</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Use this only for periodic watch or triage agents. Leave it off for normal task execution.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={editDraft.heartbeat.enabled ? "default" : "secondary"}
                        size="sm"
                        className="h-8 rounded-full px-3 text-[11px]"
                        onClick={() =>
                          setEditDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  heartbeat: current.heartbeat.enabled
                                    ? { ...current.heartbeat, enabled: false }
                                    : {
                                        ...current.heartbeat,
                                        enabled: true,
                                        every:
                                          current.heartbeat.every ||
                                          defaultHeartbeatForPreset(current.policy.preset).every
                                      }
                                }
                              : current
                          )
                        }
                      >
                        {editDraft.heartbeat.enabled ? "On" : "Off"}
                      </Button>
                    </div>

                    {editDraft.heartbeat.enabled ? (
                      <div className="mt-3">
                        <FormField label="Interval" htmlFor="edit-agent-heartbeat-every">
                          <select
                            id="edit-agent-heartbeat-every"
                            value={editDraft.heartbeat.every}
                            onChange={(event) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      heartbeat: {
                                        ...current.heartbeat,
                                        every: event.target.value
                                      }
                                    }
                                  : current
                              )
                            }
                            className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                          >
                            {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isEditAgentAdvancedOpen ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <AgentPolicySelect
                      label="Missing tool behavior"
                      htmlFor="edit-agent-missing-tools"
                      value={editDraft.policy.missingToolBehavior}
                      options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  missingToolBehavior: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="Install scope"
                      htmlFor="edit-agent-install-scope"
                      value={editDraft.policy.installScope}
                      options={AGENT_INSTALL_SCOPE_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  installScope: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="File access"
                      htmlFor="edit-agent-file-access"
                      value={editDraft.policy.fileAccess}
                      options={AGENT_FILE_ACCESS_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  fileAccess: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="Network access"
                      htmlFor="edit-agent-network-access"
                      value={editDraft.policy.networkAccess}
                      options={AGENT_NETWORK_ACCESS_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  networkAccess: value
                                }
                              }
                            : current
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => handleEditAgentOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submitEditAgent} disabled={isSavingAgent || !editDraft}>
              {isSavingAgent ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SidebarBrand({ onToggleCollapsed }: { onToggleCollapsed: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href="/"
        className="group flex min-w-0 items-center gap-3 rounded-[16px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-cyan-300/40"
        aria-label="AgentOS Mission Control"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-cyan-200/18 bg-white/[0.06] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
          <Image
            src="/assets/logo.webp"
            alt=""
            width={36}
            height={36}
            aria-hidden="true"
            className="h-full w-full object-cover"
            priority
          />
        </span>
        <span className="truncate py-0.5 font-display text-[1.15rem] font-semibold leading-[1.25] text-white">
          AgentOS
        </span>
      </Link>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label="Collapse sidebar"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-slate-400 transition-all hover:border-cyan-300/24 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
    </div>
  );
}

function WorkspaceSwitcher({
  activeWorkspaceId,
  snapshot,
  workspace,
  statusLabel,
  statusTone,
  onSelectWorkspace,
  onOpenWorkspaceCreate
}: {
  activeWorkspaceId: string | null;
  snapshot: MissionControlSnapshot;
  workspace: MissionControlSnapshot["workspaces"][number] | null;
  statusLabel: string;
  statusTone: string;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onOpenWorkspaceCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative mt-5" ref={menuRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="group flex w-full items-center gap-3 rounded-[16px] border border-white/[0.09] bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035))] px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_30px_rgba(0,0,0,0.20)] transition-all hover:border-cyan-200/20 hover:bg-white/[0.075] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-cyan-200/16 bg-cyan-300/[0.10] text-cyan-200">
          <FolderKanban className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.95rem] font-semibold leading-5 text-white">
            {activeWorkspaceId === null ? "All workspaces" : workspace?.name || "No workspace"}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[0.63rem] font-semibold uppercase leading-none tracking-[0.22em] text-slate-500">
            <StatusDot tone={statusTone} pulse={statusTone === "bg-emerald-400"} className="h-2 w-2" />
            {activeWorkspaceId === null ? `${snapshot.workspaces.length} workspaces` : "Workspace"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-400 transition-transform group-hover:text-slate-200",
              open && "rotate-180"
            )}
          />
          <span className="text-[0.6rem] font-medium text-slate-500">{statusLabel}</span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-[16px] border border-white/[0.10] bg-slate-950/96 p-1.5 shadow-[0_24px_56px_rgba(0,0,0,0.42)] backdrop-blur-xl"
        >
          <WorkspaceMenuButton
            label="All workspaces"
            detail={`${snapshot.workspaces.length} total`}
            selected={activeWorkspaceId === null}
            onClick={() => {
              onSelectWorkspace(null);
              setOpen(false);
            }}
          />
          {snapshot.workspaces.map((entry) => (
            <WorkspaceMenuButton
              key={entry.id}
              label={entry.name}
              detail={`${entry.agentIds.length} agents`}
              selected={entry.id === activeWorkspaceId}
              onClick={() => {
                onSelectWorkspace(entry.id);
                setOpen(false);
              }}
            />
          ))}
          <div className="mt-1 border-t border-white/[0.08] pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenWorkspaceCreate();
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-cyan-100 transition-colors hover:bg-cyan-300/[0.10] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-cyan-300/20 bg-cyan-300/[0.12] text-cyan-200">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.82rem] font-medium">Create Workspace</span>
                <span className="mt-0.5 block text-[0.67rem] text-slate-500">Start a new workspace</span>
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceMenuButton({
  label,
  detail,
  selected,
  onClick
}: {
  label: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        selected
          ? "bg-cyan-400/[0.12] text-cyan-50"
          : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-[0.82rem] font-medium">{label}</span>
        <span className="mt-0.5 block text-[0.67rem] text-slate-500">{detail}</span>
      </span>
      {selected ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> : null}
    </button>
  );
}

function SidebarSectionGroup({
  activeHash,
  onNavigate,
  pathname,
  section
}: {
  activeHash: string;
  onNavigate: (item: SidebarItem) => void;
  pathname: string;
  section: { id: SidebarSection; label: string };
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`sidebar-${section.id}`}>
      <h2
        id={`sidebar-${section.id}`}
        className="px-2 text-[0.64rem] font-semibold uppercase leading-none tracking-[0.22em] text-slate-500"
      >
        {section.label}
      </h2>
      <div className="flex flex-col gap-1">
        {sidebarItems
          .filter((item) => item.section === section.id)
          .map((item) => (
            <SidebarNavItem
              key={item.label}
              item={item}
              active={isSidebarItemActive(item, pathname, activeHash)}
              onNavigate={() => onNavigate(item)}
            />
          ))}
      </div>
    </section>
  );
}

function SidebarNavItem({
  item,
  active,
  onNavigate
}: {
  item: SidebarItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href ?? "#"}
      scroll={item.href?.startsWith("/settings#") ? false : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-[12px] border px-3 text-[0.84rem] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        active
          ? "border-blue-300/28 bg-[linear-gradient(90deg,rgba(37,99,235,0.34),rgba(14,165,233,0.16))] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_28px_rgba(37,99,235,0.16)]"
          : "border-transparent text-slate-300 hover:border-white/[0.08] hover:bg-white/[0.055] hover:text-white"
      )}
    >
      {active ? (
        <span className="absolute left-0 top-2 h-6 w-1 rounded-r-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.36)]" />
      ) : null}
      <Icon className={cn("h-[1.05rem] w-[1.05rem] shrink-0", active ? "text-cyan-200" : "text-slate-400 group-hover:text-slate-200")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {typeof item.badge === "number" ? (
        <Badge className="ml-auto flex h-5 min-w-5 justify-center border-white/[0.08] bg-white/[0.08] px-1.5 py-0 text-[0.64rem] tracking-normal text-slate-200">
          {item.badge}
        </Badge>
      ) : null}
    </Link>
  );
}

function CollapsedSidebar({
  activeHash,
  pathname,
  statusTone,
  surfaceTheme,
  workspaceLabel,
  workspaceDetail,
  onItemNavigate,
  onExpandCollapsed
}: {
  activeHash: string;
  pathname: string;
  statusTone: string;
  surfaceTheme: "dark" | "light";
  workspaceLabel: string;
  workspaceDetail: string;
  onItemNavigate: (item: SidebarItem) => void;
  onExpandCollapsed: () => void;
}) {
  return (
    <aside className="relative flex h-full w-full flex-col items-center overflow-hidden border-r border-white/[0.08] bg-[linear-gradient(180deg,rgba(15,23,38,0.98),rgba(6,10,18,0.99))] px-1 py-4 text-slate-100 shadow-[14px_0_44px_rgba(0,0,0,0.32)]">
      <button
        type="button"
        onClick={onExpandCollapsed}
        aria-label="Expand sidebar"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[13px] border border-cyan-200/18 bg-white/[0.06] shadow-[0_12px_26px_rgba(0,0,0,0.26)] transition-colors hover:border-cyan-200/28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
      >
        <Image
          src="/assets/logo.webp"
          alt=""
          width={40}
          height={40}
          aria-hidden="true"
          className="h-full w-full object-cover"
          priority
        />
      </button>

      <RailTooltip
        label={`${workspaceLabel} - ${workspaceDetail}`}
        side="right"
        surfaceTheme={surfaceTheme}
        panelCollapsed
      >
        <button
          type="button"
          onClick={onExpandCollapsed}
          aria-label={`Expand workspace selector: ${workspaceLabel}`}
          className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/[0.08] bg-cyan-300/[0.10] text-cyan-200 outline-none transition-all hover:border-cyan-200/24 hover:bg-cyan-300/[0.16] hover:text-cyan-50 focus-visible:ring-2 focus-visible:ring-cyan-300/40"
        >
          <Home className="h-4 w-4" />
        </button>
      </RailTooltip>

      <nav aria-label="Primary" className="sidebar-scroll mt-6 flex min-h-0 w-12 flex-1 flex-col items-center gap-4 overflow-y-auto overscroll-contain">
        {sidebarSections.map((section) => (
          <div key={section.id} className="flex flex-col items-center gap-1.5">
            {sidebarItems
              .filter((item) => item.section === section.id)
              .map((item) => {
                const active = isSidebarItemActive(item, pathname, activeHash);
                const Icon = item.icon;

                return (
                  <RailTooltip
                    key={item.label}
                    label={item.label}
                    side="right"
                    surfaceTheme={surfaceTheme}
                    panelCollapsed
                  >
                    <Link
                      href={item.href ?? "#"}
                      scroll={item.href?.startsWith("/settings#") ? false : undefined}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        onItemNavigate(item);
                      }}
                      className={cn(
                        "relative inline-flex h-10 w-10 items-center justify-center rounded-[12px] border outline-none transition-all focus-visible:ring-2 focus-visible:ring-cyan-300/40",
                        active
                          ? "border-blue-300/28 bg-cyan-300 text-slate-950 shadow-[0_14px_30px_rgba(56,189,248,0.24)]"
                          : "border-white/[0.08] bg-white/[0.035] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {typeof item.badge === "number" ? (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-slate-950 bg-slate-200 px-1 text-[0.58rem] font-bold leading-none text-slate-950 shadow-[0_4px_10px_rgba(0,0,0,0.24)]">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </RailTooltip>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="mt-4 flex flex-col items-center gap-3">
        <StatusDot tone={statusTone} pulse={statusTone === "bg-emerald-400"} />
        <button
          type="button"
          onClick={onExpandCollapsed}
          aria-label="Expand sidebar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[11px] border border-white/[0.08] bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function isSidebarItemActive(item: SidebarItem, pathname: string, activeHash: string) {
  if (item.label === "Mission Control") {
    return pathname === "/" && !activeHash;
  }

  if (item.label === "Dashboard") {
    return pathname === "/dashboard";
  }

  if (item.href && !item.hash && item.href !== "/" && !item.href.startsWith("/settings")) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  if (item.href?.startsWith("/settings")) {
    if (pathname !== "/settings") {
      return false;
    }

    if (item.hash) {
      return activeHash === item.hash;
    }

    return !activeHash || activeHash === "settings";
  }

  return pathname === "/" && Boolean(item.hash) && activeHash === item.hash;
}

function resolveStatusTone(
  health: MissionControlSnapshot["diagnostics"]["health"],
  connectionState: "connecting" | "live" | "retrying"
) {
  if (connectionState === "live" && health === "healthy") {
    return "bg-emerald-400";
  }

  if (connectionState === "retrying" || health === "degraded") {
    return "bg-amber-300";
  }

  return "bg-rose-300";
}

function isLiveAgent(agent: MissionControlSnapshot["agents"][number]) {
  return agent.status === "engaged" || agent.status === "monitoring" || agent.status === "ready";
}

function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

function AgentPresetCard({
  label,
  description,
  active,
  badgeVariant,
  onClick
}: {
  label: string;
  description: string;
  active: boolean;
  badgeVariant: "default" | "muted" | "success" | "warning";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[20px] border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        active ? "border-cyan-300/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <Badge variant={badgeVariant}>{active ? "selected" : "preset"}</Badge>
      </div>
    </button>
  );
}

function AgentPolicySummary({ policy }: { policy: AgentPolicy }) {
  const presetMeta = getAgentPresetMeta(policy.preset);

  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{presetMeta.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{presetMeta.description}</p>
        </div>
        <Badge variant={presetMeta.badgeVariant}>{presetMeta.label}</Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="muted">{formatAgentMissingToolBehaviorLabel(policy.missingToolBehavior)}</Badge>
        <Badge variant="muted">{formatAgentInstallScopeLabel(policy.installScope)}</Badge>
        <Badge variant="muted">{formatAgentFileAccessLabel(policy.fileAccess)}</Badge>
        <Badge variant="muted">Network {formatAgentNetworkAccessLabel(policy.networkAccess)}</Badge>
      </div>
    </div>
  );
}

function AgentPolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label} htmlFor={htmlFor}>
      <select
        id={htmlFor}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.description}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function DeleteMetric({
  label,
  value,
  danger = false
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border px-3.5 py-3",
        danger ? "border-amber-300/20 bg-amber-400/[0.08]" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={cn("mt-1.5 font-display text-lg", danger ? "text-amber-100" : "text-white")}>{value}</p>
    </div>
  );
}

function buildAgentDraft(workspaceId: string, seed: Partial<AgentDraft> = {}): AgentDraft {
  const policy = resolveAgentPolicy(seed.policy?.preset ?? "worker", seed.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const heartbeat = resolveHeartbeatDraft(policy.preset, seed.heartbeat);

  return {
    id: seed.id ?? "",
    workspaceId,
    modelId: seed.modelId ?? "",
    name: seed.name ?? presetMeta.defaultName,
    emoji: seed.emoji ?? presetMeta.defaultEmoji,
    theme: seed.theme ?? presetMeta.defaultTheme,
    avatar: seed.avatar ?? "",
    policy,
    heartbeat,
    channelIds: Array.from(
      new Set(
        (seed.channelIds ?? []).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      )
    )
  };
}

function applyEditedAgentDraftToSnapshot(snapshot: MissionControlSnapshot, draft: AgentDraft): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => {
      if (agent.id !== draft.id) {
        return agent;
      }

      const name = draft.name.trim() || formatAgentDisplayName(agent);
      const modelId = draft.modelId.trim() || agent.modelId || "unassigned";
      const emoji = draft.emoji.trim();
      const theme = draft.theme.trim();
      const avatar = draft.avatar.trim();

      return {
        ...agent,
        name,
        identityName: name,
        modelId,
        policy: draft.policy,
        heartbeat: {
          enabled: Boolean(draft.heartbeat.enabled),
          every: draft.heartbeat.enabled ? draft.heartbeat.every || null : null,
          everyMs: agent.heartbeat.everyMs ?? null
        },
        identity: {
          ...agent.identity,
          emoji: emoji || undefined,
          theme: theme || undefined,
          avatar: avatar || undefined
        }
      };
    })
  };
}

function applyAgentPreset(draft: AgentDraft, preset: AgentPreset): AgentDraft {
  const previousMeta = getAgentPresetMeta(draft.policy.preset);
  const nextMeta = getAgentPresetMeta(preset);
  const nextPolicy = resolveAgentPolicy(preset);

  return {
    ...draft,
    name: !draft.name || draft.name === previousMeta.defaultName ? nextMeta.defaultName : draft.name,
    emoji: !draft.emoji || draft.emoji === previousMeta.defaultEmoji ? nextMeta.defaultEmoji : draft.emoji,
    theme: !draft.theme || draft.theme === previousMeta.defaultTheme ? nextMeta.defaultTheme : draft.theme,
    policy: nextPolicy,
    heartbeat: applyPresetHeartbeat(draft.heartbeat, draft.policy.preset, preset)
  };
}
