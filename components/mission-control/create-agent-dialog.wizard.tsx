"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, LoaderCircle } from "lucide-react";

import { AgentThemePicker } from "@/components/mission-control/agent-theme-picker";
import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import {
  AgentSetupSummary,
  CloneAgentPicker,
  FormField,
  QUICK_ROLE_OPTIONS,
  QuickRoleSelector
} from "@/components/mission-control/create-agent-dialog.parts";
import {
  MissionControlDialogShell,
  missionControlDialogButtonClassName,
  missionControlDialogControlClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import type { PendingAgentProjection } from "@/components/mission-control/pending-agent-projection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  getAgentPresetMeta
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  defaultHeartbeatForPreset
} from "@/lib/openclaw/agent-heartbeat";
import {
  getWorkspaceChannelIdsForAgent,
  syncWorkspaceAgentChannelBindings
} from "@/lib/openclaw/channel-bindings";
import { resolveOpenClawModelReadinessIssue } from "@/lib/openclaw/readiness";
import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  applyAgentPreset,
  buildAgentDraft,
  buildImportedAgentDraft,
  buildUniqueAgentId,
  isSnapshotModelUsable,
  resolveSuggestedAgentModelId,
  type AgentDraft
} from "@/components/mission-control/create-agent-dialog.utils";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

type SurfaceTheme = "dark" | "light";
type CreateAgentProgress = "idle" | "creating" | "syncing";
type QuickRolePreset = Exclude<AgentPreset, "custom">;

type CreateAgentDialogProps = {
  snapshot: MissionControlSnapshot;
  defaultWorkspaceId?: string | null;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreationPending?: (agent: PendingAgentProjection) => void;
  onAgentCreated?: (agentId: string) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  trigger?: ReactNode;
  surfaceTheme?: SurfaceTheme;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CreateAgentDialog({
  snapshot,
  defaultWorkspaceId,
  onRefresh,
  onSnapshotChange,
  onAgentCreationPending,
  onAgentCreated,
  onAgentCreatedVisible,
  trigger,
  surfaceTheme = "dark",
  open: controlledOpen,
  onOpenChange: onControlledOpenChange
}: CreateAgentDialogProps) {
  const isLight = surfaceTheme === "light";
  const initialWorkspaceId = resolveInitialWorkspaceId(snapshot, defaultWorkspaceId);
  const [isMounted, setIsMounted] = useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [clonePickerOpen, setClonePickerOpen] = useState(false);
  const [cloneSearch, setCloneSearch] = useState("");
  const [selectedCloneAgentId, setSelectedCloneAgentId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [createProgress, setCreateProgress] = useState<CreateAgentProgress>("idle");
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdAgentWarning, setCreatedAgentWarning] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(() => buildAgentDraft(initialWorkspaceId));
  const isSubmittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const createSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = controlledOpen ?? uncontrolledOpen;

  const setDialogOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }

    onControlledOpenChange?.(nextOpen);
  }, [controlledOpen, onControlledOpenChange]);

  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === draft.workspaceId) ?? null;
  const suggestedModelId = resolveSuggestedAgentModelId(snapshot, draft.workspaceId || initialWorkspaceId);
  const effectiveModelId = draft.modelId.trim() || suggestedModelId;
  const currentPresetMeta = getAgentPresetMeta(draft.policy.preset);
  const quickRolePreset = isQuickRolePreset(draft.policy.preset) ? draft.policy.preset : null;
  const generatedAgentId = buildUniqueAgentId(
    snapshot.agents,
    selectedWorkspace?.slug,
    draft.name || currentPresetMeta.defaultName
  );
  const selectedModelReadinessMessage = draft.modelId.trim() && !isSnapshotModelUsable(snapshot, draft.modelId.trim())
    ? resolveOpenClawModelReadinessIssue(snapshot, draft.modelId.trim()) ?? `Model ${draft.modelId.trim()} is not ready.`
    : null;
  const automaticModelReadinessMessage = !draft.modelId.trim() && !effectiveModelId
    ? resolveOpenClawModelReadinessIssue(snapshot) ?? "No usable model is available. Configure a model in OpenClaw before creating an agent."
    : null;
  const creationBlockedReason = !selectedWorkspace
    ? snapshot.workspaces.length > 0
      ? "Select a workspace under Advanced settings before creating the agent."
      : "Create a workspace before adding an agent."
    : automaticModelReadinessMessage;
  const canCreate = !isSaving && !creationBlockedReason && Boolean(generatedAgentId && effectiveModelId);
  const createdAgentVisible = Boolean(createdAgentId && snapshot.agents.some((agent) => agent.id === createdAgentId));
  const modelSummaryLabel = draft.modelId.trim() || "Automatic model";
  const headerDescription = selectedWorkspace
    ? `Add a specialist to ${selectedWorkspace.name}.`
    : "Add a specialist to your AI workforce.";

  const cloneCandidates = useMemo(() => {
    const query = cloneSearch.trim().toLowerCase();

    return [...snapshot.agents]
      .filter((agent) => {
        const workspaceName = snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? agent.workspaceId;
        const presetMeta = getAgentPresetMeta(agent.policy.preset);
        const role = agent.workerProfile?.employment.role ?? presetMeta.label;
        const haystack = [formatAgentDisplayName(agent), workspaceName, role, presetMeta.label].join(" ").toLowerCase();
        return !query || haystack.includes(query);
      })
      .sort((left, right) => formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right)));
  }, [cloneSearch, snapshot.agents, snapshot.workspaces]);
  const workspaceNames = useMemo(
    () => new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace.name])),
    [snapshot.workspaces]
  );

  const resetDialogState = useCallback((workspaceId: string) => {
    setAdvancedOpen(false);
    setClonePickerOpen(false);
    setCloneSearch("");
    setSelectedCloneAgentId(null);
    setDraft(buildAgentDraft(workspaceId));
    setIsSaving(false);
    setCreateProgress("idle");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);
    setInlineError(null);
    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
      createSyncTimeoutRef.current = null;
    }
    isSubmittingRef.current = false;
  }, []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      resetDialogState(initialWorkspaceId);
    }
  }, [initialWorkspaceId, open, resetDialogState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    return () => {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (createProgress !== "syncing" || !createdAgentId || !createdAgentVisible) {
      return;
    }

    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
      createSyncTimeoutRef.current = null;
    }

    onAgentCreatedVisible?.(createdAgentId);
    onAgentCreated?.(createdAgentId);
    toast.success("Agent created", {
      description: selectedWorkspace ? `Added to ${selectedWorkspace.name}.` : "Added to your AI workforce."
    });
    setCreateProgress("idle");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);
    setIsSaving(false);
    setDialogOpen(false);
  }, [createdAgentId, createdAgentVisible, createProgress, onAgentCreated, onAgentCreatedVisible, selectedWorkspace, setDialogOpen]);

  useEffect(() => {
    if (createProgress !== "syncing" || !createdAgentId || createdAgentVisible) {
      return;
    }

    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
    }

    createSyncTimeoutRef.current = setTimeout(() => {
      createSyncTimeoutRef.current = null;
      onAgentCreated?.(createdAgentId);
      toast.message("Agent created", {
        description: createdAgentWarning
          ? "It may take a moment to appear in the workspace."
          : "It may take a moment to appear in the workspace."
      });
      setCreateProgress("idle");
      setCreatedAgentId(null);
      setCreatedAgentWarning(null);
      setIsSaving(false);
      setDialogOpen(false);
    }, 12000);

    return () => {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }
    };
  }, [createdAgentId, createdAgentVisible, createdAgentWarning, createProgress, onAgentCreated, setDialogOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (isSaving || createProgress !== "idle")) {
      return;
    }

    setDialogOpen(nextOpen);
    if (!nextOpen) {
      resetDialogState(initialWorkspaceId);
    }
  };

  const handleRoleChange = (preset: QuickRolePreset) => {
    setDraft((current) => applyAgentPreset(current, preset));
    setInlineError(null);
  };

  const handleCloneAgentSelect = (agentId: string) => {
    const sourceAgent = snapshot.agents.find((agent) => agent.id === agentId);

    if (!sourceAgent) {
      return;
    }

    const workspaceId = draft.workspaceId || initialWorkspaceId;
    const channelIds = workspaceId === sourceAgent.workspaceId
      ? getWorkspaceChannelIdsForAgent(snapshot, sourceAgent.workspaceId, sourceAgent.id)
      : [];

    setDraft(buildImportedAgentDraft(workspaceId, sourceAgent, channelIds));
    setSelectedCloneAgentId(agentId);
    setClonePickerOpen(false);
    setCloneSearch("");
    setInlineError(null);
  };

  const handleWorkspaceChange = (workspaceId: string) => {
    setDraft((current) => ({
      ...current,
      workspaceId,
      modelId: current.modelId.trim() ? current.modelId : "",
      channelIds: []
    }));
  };

  const submitCreateAgent = async () => {
    if (isSubmittingRef.current || !canCreate || !selectedWorkspace) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    setCreateProgress("creating");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);
    setInlineError(null);

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...draft,
          modelId: effectiveModelId,
          id: generatedAgentId,
          workerProfile: {
            schemaVersion: 1,
            identity: {
              displayName: draft.name || currentPresetMeta.defaultName,
              emoji: draft.emoji || currentPresetMeta.defaultEmoji,
              theme: draft.theme || currentPresetMeta.defaultTheme,
              avatar: draft.avatar || null
            },
            employment: {
              role: draft.role || currentPresetMeta.label,
              mission: draft.mission || null,
              behaviorInstructions: draft.behaviorInstructions || null
            },
            operator: {
              labels: draft.labels
            }
          }
        })
      });

      const result = (await response.json()) as {
        agentId?: string;
        error?: string;
        warning?: string;
        warnings?: string[];
      };

      if (!response.ok || result.error || !result.agentId) {
        throw new Error(result.error || "OpenClaw could not create the agent.");
      }

      if (draft.channelIds.length > 0) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: draft.workspaceId,
          workspacePath: selectedWorkspace.path,
          agentId: result.agentId,
          currentChannelIds: [],
          nextChannelIds: draft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      const presetMeta = getAgentPresetMeta(draft.policy.preset);
      const warning = result.warning ?? result.warnings?.[0] ?? null;
      onAgentCreationPending?.({
        id: result.agentId,
        workspaceId: draft.workspaceId,
        workspacePath: selectedWorkspace.path,
        name: draft.name.trim() || result.agentId,
        modelId: effectiveModelId,
        emoji: draft.emoji.trim() || presetMeta.defaultEmoji,
        theme: draft.theme.trim() || presetMeta.defaultTheme,
        policy: draft.policy,
        heartbeat: {
          enabled: draft.heartbeat.enabled,
          every: draft.heartbeat.every
        },
        skills: draft.skills,
        tools: draft.tools,
        createdAt: Date.now(),
        warning
      });

      setCreateProgress("syncing");
      setCreatedAgentId(result.agentId);
      setCreatedAgentWarning(warning);
      void onRefresh().catch(() => {});
    } catch (error) {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }

      const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : "Please try again.";
      setCreateProgress("idle");
      setCreatedAgentId(null);
      setCreatedAgentWarning(null);
      setIsSaving(false);
      setInlineError(detail ? `Agent couldn't be created. ${detail}` : "Agent couldn't be created. Please try again.");
      toast.error("Agent couldn't be created.", { description: detail || "Please try again." });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  if (!isMounted) {
    return <>{trigger}</>;
  }

  const progressMessage = createProgress === "creating"
    ? "Creating agent…"
    : createProgress === "syncing"
      ? "Agent created. Waiting for it to appear…"
      : null;

  return (
    <MissionControlDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      surfaceTheme={surfaceTheme}
      variant="quiet"
      trigger={trigger}
      title="Create agent"
      description={headerDescription}
      contentClassName="sm:h-[min(calc(100dvh-48px),760px)] sm:max-h-[calc(100dvh-48px)] sm:w-[min(92vw,720px)] sm:rounded-xl"
      headerClassName="px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-7"
      bodyClassName="px-5 py-5 sm:px-7 sm:py-6"
      footerClassName="px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-7 sm:py-3"
      disableOutsideDismiss
      footer={
        <div className="w-full space-y-3">
          {progressMessage ? (
            <div className={cn("flex items-center gap-2 text-xs", isLight ? "text-[#806f63]" : "text-slate-300")} role="status" aria-live="polite">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{progressMessage}</span>
            </div>
          ) : null}

          {inlineError ? (
            <div className={cn("rounded-md border px-3 py-2 text-xs leading-4", isLight ? "border-red-200 bg-red-50 text-red-800" : "border-red-300/25 bg-red-400/[0.08] text-red-100")} role="alert">
              {inlineError}
            </div>
          ) : null}

          {creationBlockedReason && !isSaving ? (
            <p className={cn("text-xs leading-4", isLight ? "text-[#8b5c35]" : "text-amber-200/90")} role="status">
              {creationBlockedReason}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
              className={cn(missionControlDialogButtonClassName("secondary", surfaceTheme), "h-10 rounded-md px-4")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void submitCreateAgent()}
              disabled={!canCreate}
              className={cn(
                isLight
                  ? "h-10 rounded-md border border-[hsl(var(--agentos-operational-accent))] bg-[hsl(var(--agentos-operational-accent))] px-4 text-[rgb(255,255,255)] shadow-[0_8px_18px_hsl(var(--agentos-operational-accent)/0.22)] hover:brightness-95"
                  : missionControlDialogButtonClassName("primary", surfaceTheme),
                "rounded-md"
              )}
            >
              {createProgress === "creating" ? "Creating agent…" : createProgress === "syncing" ? "Agent created…" : "Create agent"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-[620px] space-y-6">
        <section className="space-y-3" aria-labelledby="create-agent-role-baseline-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="create-agent-role-baseline-heading" className={cn("text-sm font-semibold", isLight ? "text-[#2d241f]" : "text-white")}>
                Role baseline
              </h2>
              <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>
                Optional starting point. AgentOS fills in the safe defaults.
              </p>
            </div>
            <button
              type="button"
              aria-expanded={clonePickerOpen}
              aria-controls="create-agent-clone-picker"
              onClick={() => setClonePickerOpen((current) => !current)}
              className={cn("inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2", isLight ? "text-violet-700 hover:bg-violet-50 focus-visible:ring-violet-400/30" : "text-violet-200 hover:bg-violet-400/[0.1] focus-visible:ring-violet-300/35")}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Clone existing agent
            </button>
          </div>

          <QuickRoleSelector value={quickRolePreset} onChange={handleRoleChange} surfaceTheme={surfaceTheme} />

          {clonePickerOpen ? (
            <div id="create-agent-clone-picker">
              <CloneAgentPicker
                candidates={cloneCandidates}
                workspaceNames={workspaceNames}
                search={cloneSearch}
                selectedAgentId={selectedCloneAgentId}
                onSearchChange={setCloneSearch}
                onSelect={handleCloneAgentSelect}
                surfaceTheme={surfaceTheme}
              />
            </div>
          ) : null}
        </section>

        <section className="space-y-4" aria-labelledby="create-agent-general-heading">
          <div>
            <h2 id="create-agent-general-heading" className={cn("text-sm font-semibold", isLight ? "text-[#2d241f]" : "text-white")}>
              General
            </h2>
          </div>

          <FormField label="Name" htmlFor="create-agent-name" surfaceTheme={surfaceTheme}>
            <Input
              id="create-agent-name"
              ref={nameInputRef}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Research Analyst"
              className={controlClassName(surfaceTheme)}
            />
          </FormField>

          <FormField
            label="What should this agent own?"
            htmlFor="create-agent-mission"
            helper="A short responsibility or mission for this agent."
            surfaceTheme={surfaceTheme}
          >
            <Textarea
              id="create-agent-mission"
              value={draft.mission}
              onChange={(event) => setDraft((current) => ({ ...current, mission: event.target.value }))}
              placeholder="Monitor protocol operations, review deployments, and surface anything that needs attention."
              className={cn(controlClassName(surfaceTheme), "min-h-[112px] resize-y")}
            />
          </FormField>
        </section>

        <AgentSetupSummary
          workspaceName={selectedWorkspace?.name ?? null}
          modelLabel={modelSummaryLabel}
          heartbeatEnabled={draft.heartbeat.enabled}
          surfaceTheme={surfaceTheme}
        />

        <section className="space-y-4">
          <button
            type="button"
            aria-expanded={advancedOpen}
            aria-controls="create-agent-advanced-settings"
            onClick={() => setAdvancedOpen((current) => !current)}
            className={cn("flex min-h-11 w-full items-center justify-between border-t pt-4 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2", isLight ? "border-[#e6ddd5] text-[#3f332b] focus-visible:ring-violet-400/30" : "border-white/10 text-slate-100 focus-visible:ring-violet-300/35")}
          >
            <span>Advanced settings</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} aria-hidden="true" />
          </button>

          {advancedOpen ? (
            <div id="create-agent-advanced-settings" className="space-y-6">
              <AdvancedSection title="Agent" description="Optional identity and working guidance." surfaceTheme={surfaceTheme}>
                <div className="space-y-4">
                  <FormField label="Role" htmlFor="create-agent-role" surfaceTheme={surfaceTheme}>
                    <Input
                      id="create-agent-role"
                      value={draft.role}
                      onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
                      placeholder={currentPresetMeta.label}
                      className={controlClassName(surfaceTheme)}
                    />
                  </FormField>
                  <FormField label="Instructions" htmlFor="create-agent-behavior" helper="Optional working guidance for this agent." surfaceTheme={surfaceTheme}>
                    <Textarea
                      id="create-agent-behavior"
                      value={draft.behaviorInstructions}
                      onChange={(event) => setDraft((current) => ({ ...current, behaviorInstructions: event.target.value }))}
                      placeholder="Add concise working guidance for this agent."
                      className={cn(controlClassName(surfaceTheme), "min-h-[88px] resize-y")}
                    />
                  </FormField>
                </div>
              </AdvancedSection>

              <AdvancedSection title="Runtime" description="Choose the workspace and model only when you need to override the automatic setup." surfaceTheme={surfaceTheme}>
                <div className="space-y-4">
                  <FormField label="Workspace" htmlFor="create-agent-workspace" surfaceTheme={surfaceTheme}>
                    <select
                      id="create-agent-workspace"
                      value={draft.workspaceId}
                      onChange={(event) => handleWorkspaceChange(event.target.value)}
                      className={selectClassName(surfaceTheme)}
                    >
                      {snapshot.workspaces.length > 0 ? snapshot.workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                      )) : <option value="">No workspaces available</option>}
                    </select>
                  </FormField>

                  <FormField
                    label="Model"
                    htmlFor="create-agent-model"
                    helper={suggestedModelId ? `Automatic currently resolves to ${suggestedModelId}.` : "Automatic uses the first usable model reported by OpenClaw."}
                    surfaceTheme={surfaceTheme}
                  >
                    <select
                      id="create-agent-model"
                      value={draft.modelId}
                      onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
                      className={selectClassName(surfaceTheme)}
                    >
                      <option value="">Automatic</option>
                      {snapshot.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}{isSnapshotModelUsable(snapshot, model.id) ? "" : " (not ready)"}
                        </option>
                      ))}
                    </select>
                    {selectedModelReadinessMessage ? (
                      <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-[#8b5c35]" : "text-amber-200/90")} role="status">
                        {selectedModelReadinessMessage} A ready fallback will be used when available.
                      </p>
                    ) : null}
                  </FormField>

                  <div className={cn("rounded-md border px-3 py-2 text-[11px] leading-4", isLight ? "border-[#e1d7ce] bg-[#faf7f3] text-[#806f63]" : "border-white/10 bg-white/[0.025] text-slate-400")}>
                    {draft.skills.length} skills and {draft.tools.length} tools are configured by this role baseline. Detailed capability management remains available after creation.
                  </div>
                </div>
              </AdvancedSection>

              <AdvancedSection title="Autonomy" description="Decide whether this agent should check in on a schedule." surfaceTheme={surfaceTheme}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className={cn("text-xs font-medium", isLight ? "text-[#3f332b]" : "text-slate-100")}>Scheduled check-ins</p>
                      <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>Useful for monitoring, triage, and periodic reporting.</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.heartbeat.enabled}
                      aria-label="Toggle scheduled check-ins"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        heartbeat: current.heartbeat.enabled
                          ? { ...current.heartbeat, enabled: false }
                          : { ...current.heartbeat, enabled: true, every: current.heartbeat.every || defaultHeartbeatForPreset(current.policy.preset).every }
                      }))}
                      className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/35"
                    >
                      <span className={cn("flex h-6 w-11 items-center rounded-full p-0.5 transition-colors", draft.heartbeat.enabled ? "bg-violet-500" : isLight ? "bg-[#d9d0c8]" : "bg-white/20")}>
                        <span className={cn("h-5 w-5 rounded-full bg-white shadow-sm transition-transform", draft.heartbeat.enabled ? "translate-x-5" : "translate-x-0")} />
                      </span>
                    </button>
                  </div>

                  {draft.heartbeat.enabled ? (
                    <FormField label="Interval" htmlFor="create-agent-heartbeat-every" surfaceTheme={surfaceTheme}>
                      <select
                        id="create-agent-heartbeat-every"
                        value={draft.heartbeat.every}
                        onChange={(event) => setDraft((current) => ({ ...current, heartbeat: { ...current.heartbeat, every: event.target.value } }))}
                        className={selectClassName(surfaceTheme)}
                      >
                        {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </FormField>
                  ) : null}
                </div>
              </AdvancedSection>

              <AdvancedSection title="Access" description="Keep the current policy values, expressed in plain language." surfaceTheme={surfaceTheme}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <PolicySelect label="Files" htmlFor="create-agent-file-access" value={draft.policy.fileAccess} options={AGENT_FILE_ACCESS_OPTIONS} surfaceTheme={surfaceTheme} onChange={(value) => setDraft((current) => ({ ...current, policy: { ...current.policy, fileAccess: value } }))} />
                  <PolicySelect label="When a tool is missing" htmlFor="create-agent-missing-tools" value={draft.policy.missingToolBehavior} options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS} surfaceTheme={surfaceTheme} onChange={(value) => setDraft((current) => ({ ...current, policy: { ...current.policy, missingToolBehavior: value } }))} />
                  <PolicySelect label="Install permissions" htmlFor="create-agent-install-scope" value={draft.policy.installScope} options={AGENT_INSTALL_SCOPE_OPTIONS} surfaceTheme={surfaceTheme} onChange={(value) => setDraft((current) => ({ ...current, policy: { ...current.policy, installScope: value } }))} />
                  <PolicySelect label="Network" htmlFor="create-agent-network-access" value={draft.policy.networkAccess} options={AGENT_NETWORK_ACCESS_OPTIONS} surfaceTheme={surfaceTheme} onChange={(value) => setDraft((current) => ({ ...current, policy: { ...current.policy, networkAccess: value } }))} />
                </div>
              </AdvancedSection>

              <AdvancedSection title="Channels" description="Select configured workspace bindings for this agent. Credentials remain owned by OpenClaw." surfaceTheme={surfaceTheme}>
                {draft.workspaceId ? (
                  <ChannelBindingPicker
                    snapshot={snapshot}
                    workspaceId={draft.workspaceId}
                    channelIds={draft.channelIds}
                    isSaving={isSaving}
                    surfaceTheme={surfaceTheme}
                    onChange={(channelIds) => setDraft((current) => ({ ...current, channelIds }))}
                  />
                ) : (
                  <p className={cn("text-xs leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>Select a workspace before configuring channels.</p>
                )}
              </AdvancedSection>

              <AdvancedSection title="Appearance" description="Optional visual identity for the agent." surfaceTheme={surfaceTheme}>
                <div className="space-y-4">
                  <FormField label="Theme" htmlFor="create-agent-theme" surfaceTheme={surfaceTheme}>
                    <AgentThemePicker
                      value={draft.theme}
                      surfaceTheme={surfaceTheme}
                      onChange={(theme) => setDraft((current) => ({ ...current, theme }))}
                    />
                  </FormField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Emoji" htmlFor="create-agent-emoji" surfaceTheme={surfaceTheme}>
                      <Input id="create-agent-emoji" value={draft.emoji} onChange={(event) => setDraft((current) => ({ ...current, emoji: event.target.value }))} placeholder={currentPresetMeta.defaultEmoji} className={controlClassName(surfaceTheme)} />
                    </FormField>
                    <FormField label="Avatar URL" htmlFor="create-agent-avatar" surfaceTheme={surfaceTheme}>
                      <Input id="create-agent-avatar" value={draft.avatar} onChange={(event) => setDraft((current) => ({ ...current, avatar: event.target.value }))} placeholder="https://example.com/avatar.png" className={controlClassName(surfaceTheme)} />
                    </FormField>
                  </div>
                </div>
              </AdvancedSection>
            </div>
          ) : null}
        </section>
      </div>
    </MissionControlDialogShell>
  );
}

function AdvancedSection({
  title,
  description,
  children,
  surfaceTheme
}: {
  title: string;
  description: string;
  children: ReactNode;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <section className="space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className={cn("text-xs font-semibold", isLight ? "text-[#3f332b]" : "text-slate-100")}>{title}</h3>
        <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>{description}</p>
      </div>
      {children}
    </section>
  );
}

function PolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange,
  surfaceTheme
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  surfaceTheme: SurfaceTheme;
}) {
  const option = options.find((entry) => entry.value === value);

  return (
    <FormField label={label} htmlFor={htmlFor} helper={option?.description} surfaceTheme={surfaceTheme}>
      <select id={htmlFor} value={value} onChange={(event) => onChange(event.target.value as T)} className={selectClassName(surfaceTheme)}>
        {options.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
      </select>
    </FormField>
  );
}

function controlClassName(surfaceTheme: SurfaceTheme) {
  const isLight = surfaceTheme === "light";

  return cn(
    missionControlDialogControlClassName(),
    "h-10 rounded-md text-sm",
    isLight
      ? "border-[#ded5cc] bg-white text-[#3f332b] placeholder:text-[#9b887a] focus:border-violet-400/70 focus:ring-violet-400/20"
      : "border-white/10 bg-white/[0.04] text-white placeholder:text-slate-500"
  );
}

function selectClassName(surfaceTheme: SurfaceTheme) {
  return cn(controlClassName(surfaceTheme), "pr-8");
}

function resolveInitialWorkspaceId(snapshot: MissionControlSnapshot, defaultWorkspaceId?: string | null) {
  return snapshot.workspaces.find((workspace) => workspace.id === defaultWorkspaceId)?.id ?? snapshot.workspaces[0]?.id ?? "";
}

function isQuickRolePreset(value: AgentPreset): value is QuickRolePreset {
  return QUICK_ROLE_OPTIONS.some((option) => option.value === value);
}
