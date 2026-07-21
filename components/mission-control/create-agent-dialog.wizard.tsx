"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronRight,
  Copy,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon
} from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { AgentThemePicker } from "@/components/mission-control/agent-theme-picker";
import { AgentPolicySelect, AgentPresetCard, FormField } from "@/components/mission-control/create-agent-dialog.parts";
import {
  MissionControlDialogChip,
  MissionControlDialogShell,
  missionControlDialogButtonClassName,
  missionControlDialogControlClassName,
  missionControlDialogPanelClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import type { PendingAgentProjection } from "@/components/mission-control/pending-agent-projection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PikoLoader } from "@/components/ui/piko-loader";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  AGENT_PRESET_OPTIONS,
  getAgentPresetMeta
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import {
  getWorkspaceChannelIdsForAgent,
  syncWorkspaceAgentChannelBindings
} from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import {
  applyAgentPreset,
  buildAgentDraft,
  buildUniqueAgentId,
  isSnapshotModelUsable,
  normalizeAgentDraftCapabilities,
  resolveSuggestedAgentModelId,
  type AgentDraft
} from "@/components/mission-control/create-agent-dialog.utils";

type StartPoint = "empty" | "preset" | "import";
type WizardStage = "start" | "preset" | "import" | "details";
type MobileDetailsStep = "identity" | "work" | "safety";
type SurfaceTheme = "dark" | "light";
type CreateAgentProgress = "idle" | "creating" | "syncing";

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
  const effectiveSurfaceTheme = surfaceTheme;
  const isLight = surfaceTheme === "light";
  const initialWorkspaceId = defaultWorkspaceId ?? snapshot.workspaces[0]?.id ?? "";
  const [isMounted, setIsMounted] = useState(false);
  const [showAdvancedIdentity, setShowAdvancedIdentity] = useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setDialogOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }

    onControlledOpenChange?.(nextOpen);
  }, [controlledOpen, onControlledOpenChange]);
  const [stage, setStage] = useState<WizardStage>("start");
  const [mobileDetailsStep, setMobileDetailsStep] = useState<MobileDetailsStep>("identity");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [startPoint, setStartPoint] = useState<StartPoint | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<AgentPreset>("worker");
  const [selectedImportAgentId, setSelectedImportAgentId] = useState<string | null>(null);
  const [importSearch, setImportSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [createProgress, setCreateProgress] = useState<CreateAgentProgress>("idle");
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const [createdAgentWarning, setCreatedAgentWarning] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(() => createCustomAgentDraft(initialWorkspaceId, snapshot));
  const createSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === draft.workspaceId) ?? null;
  const suggestedModelId = resolveSuggestedAgentModelId(snapshot, draft.workspaceId || initialWorkspaceId);
  const effectiveModelId = draft.modelId.trim() || suggestedModelId;
  const selectedModelReadinessMessage =
    draft.modelId.trim() && !isSnapshotModelUsable(snapshot, draft.modelId.trim())
      ? `Model ${draft.modelId.trim()} is not ready. AgentOS will create the agent with a ready fallback when available and show a warning on the card.`
      : null;
  const currentPresetMeta = getAgentPresetMeta(draft.policy.preset);
  const generatedAgentId = buildUniqueAgentId(
    snapshot.agents,
    selectedWorkspace?.slug,
    draft.name || currentPresetMeta.defaultName
  );
  const selectedImportAgent =
    selectedImportAgentId ? snapshot.agents.find((entry) => entry.id === selectedImportAgentId) ?? null : null;
  const selectedImportWorkspace = selectedImportAgent
    ? snapshot.workspaces.find((workspace) => workspace.id === selectedImportAgent.workspaceId) ?? null
    : null;

  const importCandidates = useMemo(() => {
    const query = importSearch.trim().toLowerCase();

    return [...snapshot.agents]
      .filter((agent) => {
        if (!query) {
          return true;
        }

        const workspaceName =
          snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? agent.workspaceId;
        const presetLabel = getAgentPresetMeta(agent.policy.preset).label;
        const haystack = [
          formatAgentDisplayName(agent),
          agent.id,
          agent.workspaceId,
          workspaceName,
          presetLabel,
          agent.modelId
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .sort((left, right) => {
        if (selectedImportAgentId) {
          if (left.id === selectedImportAgentId) {
            return -1;
          }

          if (right.id === selectedImportAgentId) {
            return 1;
          }
        }

        return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
      });
  }, [importSearch, selectedImportAgentId, snapshot.agents, snapshot.workspaces]);

  const stepLabels = getWizardStepLabels(startPoint);
  const activeStepIndex = getWizardActiveStepIndex(startPoint, stage);
  const canCreate = Boolean(generatedAgentId && selectedWorkspace && effectiveModelId) && !isSaving;
  const canAdvanceFromCurrentStage = stage === "details"
    ? isCompactViewport && mobileDetailsStep !== "safety"
      ? !isSaving
      : canCreate
    : getCanAdvanceFromStage(stage, startPoint, selectedImportAgentId);
  const mobileStepIndex = stage === "details"
    ? mobileDetailsStep === "identity"
      ? 1
      : mobileDetailsStep === "work"
        ? 2
        : 3
    : 0;
  const mobileStepLabel = stage === "details"
    ? mobileDetailsStep === "identity"
      ? "Identity"
      : mobileDetailsStep === "work"
        ? "Work setup"
        : "Safety & review"
    : stage === "preset"
      ? "Choose template"
      : stage === "import"
        ? "Choose profile"
        : "Start";
  const createdAgentVisible = Boolean(
    createdAgentId && snapshot.agents.some((agent) => agent.id === createdAgentId)
  );
  const createProgressMessage =
    createProgress === "creating"
      ? "Creating the worker, saving its profile, and applying OpenClaw settings."
      : createProgress === "syncing"
        ? "Worker created. Waiting for the profile card to appear."
        : null;
  const resetWizardState = useCallback((workspaceId: string) => {
    const nextDraft = createCustomAgentDraft(workspaceId, snapshot);
    setStage("start");
    setMobileDetailsStep("identity");
    setStartPoint(null);
    setSelectedPreset("worker");
    setSelectedImportAgentId(null);
    setImportSearch("");
    setDraft(nextDraft);
    setIsSaving(false);
    setCreateProgress("idle");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);
    if (createSyncTimeoutRef.current) {
      clearTimeout(createSyncTimeoutRef.current);
      createSyncTimeoutRef.current = null;
    }
    isSubmittingRef.current = false;
  }, [snapshot]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 639px)");
    const updateViewport = () => setIsCompactViewport(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    resetWizardState(initialWorkspaceId);
  }, [initialWorkspaceId, open, resetWizardState]);

  useEffect(() => {
    if (!open || stage !== "details") {
      return;
    }

    if (window.matchMedia("(min-width: 640px)").matches) {
      nameInputRef.current?.focus();
    }
  }, [open, stage, startPoint]);

  useEffect(() => {
    if (!open || draft.modelId.trim() || !suggestedModelId) {
      return;
    }

    setDraft((current) => current.modelId.trim()
      ? current
      : {
          ...current,
          modelId: suggestedModelId
        });
  }, [draft.modelId, open, suggestedModelId]);

  useEffect(() => {
    return () => {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
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
    if (createdAgentWarning) {
      toast.message("Agent created with a sync warning.", {
        description: createdAgentWarning
      });
    } else {
      toast.success("Agent created in OpenClaw.", {
        description: createdAgentId
      });
    }
    setCreateProgress("idle");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);
    setIsSaving(false);
    setDialogOpen(false);
  }, [createProgress, createdAgentId, createdAgentVisible, createdAgentWarning, onAgentCreated, onAgentCreatedVisible, setDialogOpen]);

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
      toast.message(createdAgentWarning ? "Agent created with a sync warning." : "Agent created.", {
        description: createdAgentWarning ?? "The canvas is taking longer than usual to refresh."
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
  }, [createProgress, createdAgentId, createdAgentVisible, createdAgentWarning, onAgentCreated, setDialogOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (isSaving || createProgress !== "idle")) {
      return;
    }

    setDialogOpen(nextOpen);

    if (!nextOpen) {
      resetWizardState(initialWorkspaceId);
    }
  };

  const handleStartPointSelect = (nextStartPoint: StartPoint) => {
    const workspaceId = draft.workspaceId || initialWorkspaceId;
    const nextDraft = createCustomAgentDraft(workspaceId, snapshot);
    nextDraft.modelId = draft.modelId || resolveSuggestedAgentModelId(snapshot, workspaceId);

    setStartPoint(nextStartPoint);
    setSelectedPreset("worker");
    setSelectedImportAgentId(null);
    setImportSearch("");
    setMobileDetailsStep("identity");

    if (nextStartPoint === "empty") {
      setDraft(nextDraft);
      setStage("details");
    } else if (nextStartPoint === "preset") {
      setDraft(applyAgentPreset(nextDraft, "worker"));
      setStage("preset");
    } else {
      setDraft(nextDraft);
      setStage("import");
    }
  };

  const handlePresetSelect = (preset: AgentPreset) => {
    setSelectedPreset(preset);
    setDraft((current) => applyAgentPreset(current, preset));
  };

  const handleImportAgentSelect = (agentId: string) => {
    const sourceAgent = snapshot.agents.find((entry) => entry.id === agentId);

    if (!sourceAgent) {
      return;
    }

    const workspaceId = draft.workspaceId || initialWorkspaceId;
    const channelIds =
      workspaceId === sourceAgent.workspaceId
        ? getWorkspaceChannelIdsForAgent(snapshot, sourceAgent.workspaceId, sourceAgent.id)
        : [];

    setSelectedImportAgentId(agentId);
    const nextDraft = buildImportedAgentDraft(workspaceId, sourceAgent, channelIds);
    setDraft(nextDraft);
  };

  const handleNext = () => {
    if (stage === "start") {
      if (!startPoint) {
        return;
      }

      if (startPoint === "empty") {
        setStage("details");
        return;
      }

      if (startPoint === "preset") {
        setDraft((current) => applyAgentPreset(current, selectedPreset));
        setStage("preset");
        return;
      }

      setStage(startPoint);
      return;
    }

    if (stage === "preset") {
      setStage("details");
      return;
    }

    if (stage === "import") {
      if (!selectedImportAgentId) {
        return;
      }

      setStage("details");
    }
  };

  const handleBack = () => {
    if (stage === "details") {
      if (isCompactViewport && mobileDetailsStep !== "identity") {
        setMobileDetailsStep(mobileDetailsStep === "safety" ? "work" : "identity");
        return;
      }

      setStage(startPoint === "empty" ? "start" : startPoint ?? "start");
      return;
    }

    if (stage === "preset" || stage === "import") {
      setStage("start");
    }
  };

  const handleStepClick = (index: number) => {
    const activeIndex = getWizardActiveStepIndex(startPoint, stage);

    if (index >= activeIndex) {
      return;
    }

    const labels = getWizardStepLabels(startPoint);
    const label = labels[index];

    if (label === "Start") {
      setStage("start");
    } else if (label === "Template") {
      setStage("preset");
    } else if (label === "Clone") {
      setStage("import");
    }
  };

  const submitCreateAgent = async () => {
    if (isSubmittingRef.current || !generatedAgentId || !selectedWorkspace) {
      return;
    }

    isSubmittingRef.current = true;
    setIsSaving(true);
    setCreateProgress("creating");
    setCreatedAgentId(null);
    setCreatedAgentWarning(null);

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
        warning: result.warning ?? result.warnings?.[0] ?? null
      });

      setCreateProgress("syncing");
      setCreatedAgentId(result.agentId);
      setCreatedAgentWarning(result.warning ?? result.warnings?.[0] ?? null);

      void onRefresh().catch(() => {});
    } catch (error) {
      if (createSyncTimeoutRef.current) {
        clearTimeout(createSyncTimeoutRef.current);
        createSyncTimeoutRef.current = null;
      }

      setCreateProgress("idle");
      setCreatedAgentId(null);
      setCreatedAgentWarning(null);
      setIsSaving(false);
      toast.error("Agent creation failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handlePrimaryAction = () => {
    if (stage === "details") {
      if (isCompactViewport && mobileDetailsStep !== "safety") {
        setMobileDetailsStep(mobileDetailsStep === "identity" ? "work" : "safety");
        return;
      }

      void submitCreateAgent();
      return;
    }

    handleNext();
  };

  if (!isMounted) {
    return <>{trigger}</>;
  }

  return (
    <>
      <PikoLoader
        open={isSaving}
        title={createProgress === "syncing" ? "Agent is taking its place" : "Creating your agent"}
        description={
          createProgress === "syncing"
            ? "Saving is complete. We are waiting for the new agent to appear in your workspace."
            : "Setting up the profile and applying its OpenClaw configuration."
        }
      />
      <MissionControlDialogShell
      open={open}
      onOpenChange={handleOpenChange}
      surfaceTheme={surfaceTheme}
      variant="worker-profile"
      trigger={trigger}
      title={
        <>
          <span className="sm:hidden">Create Agent</span>
          <span className="hidden sm:inline">Create Worker Profile</span>
        </>
      }
      description={stage === "start" ? "Choose how to shape this digital employee." : getWizardStageHint(startPoint, stage)}
      icon={Bot}
      chips={
        <MissionControlDialogChip tone={stage === "details" ? "violet" : "muted"} surfaceTheme={surfaceTheme}>
          <span className="sm:hidden">Step {mobileStepIndex + 1} / 4 · {mobileStepLabel}</span>
          <span className="hidden sm:inline">Step {activeStepIndex + 1} / {stepLabels.length} · {stepLabels[activeStepIndex] ?? "Start"}</span>
        </MissionControlDialogChip>
      }
      headerActions={
        stage !== "start" ? (
          <div className="hidden sm:block">
            <WizardStepper labels={stepLabels} activeIndex={activeStepIndex} surfaceTheme={effectiveSurfaceTheme} onStepClick={handleStepClick} />
          </div>
        ) : null
      }
      contentClassName="left-0 top-0 h-[100dvh] max-h-none w-full max-w-none transform-none rounded-none border-0 sm:left-1/2 sm:top-1/2 sm:h-[min(calc(100vh-56px),780px)] sm:max-h-[calc(100vh-56px)] sm:w-[min(94vw,1120px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:border"
      headerClassName="px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-7 sm:pb-3.5 sm:pt-4"
      bodyClassName="px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-5 sm:py-4"
      footerClassName="px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-7 sm:py-2"
      disableOutsideDismiss
      footer={
        <div className="flex w-full flex-col gap-2">
          {createProgressMessage ? (
            <div className="inline-flex items-start gap-2 rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] leading-4 text-slate-300">
              <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{createProgressMessage}</span>
            </div>
          ) : null}

          <div className="flex w-full items-center gap-2 sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={isSaving}
              className={cn(missionControlDialogButtonClassName("secondary", surfaceTheme), "hidden h-9 rounded-xl px-4 sm:inline-flex")}
            >
              Cancel
            </Button>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              {stage !== "start" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleBack}
                  disabled={isSaving}
                  className={cn(missionControlDialogButtonClassName("secondary", surfaceTheme), "h-10 flex-1 rounded-xl px-4 sm:h-9 sm:flex-none")}
                >
                  Back
                </Button>
              ) : null}

              <Button
                type="button"
                size="sm"
                onClick={handlePrimaryAction}
                disabled={!canAdvanceFromCurrentStage}
                className={cn(missionControlDialogButtonClassName("primary", surfaceTheme), "h-10 flex-1 rounded-xl px-4 sm:h-9 sm:flex-none")}
              >
                {stage === "details" ? (
                  isSaving ? (
                    <>
                      <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
                      {createProgress === "syncing" ? "Syncing canvas..." : "Creating..."}
                    </>
                  ) : (
                    isCompactViewport && mobileDetailsStep !== "safety" ? "Continue" : "Create profile"
                  )
                ) : stage === "start" ? (
                  startPoint === "empty" ? (
                    "Continue"
                  ) : (
                    "Next"
                  )
                ) : (
                  "Next"
                )}
              </Button>
            </div>
          </div>
        </div>
      }
    >
            {stage === "start" ? (
              <div className="mx-auto flex w-full max-w-[980px] flex-col gap-3 py-1 md:py-2">
                <div className={cn(
                  "relative overflow-hidden rounded-[18px] border px-4 py-3 sm:rounded-[22px] sm:px-6 sm:py-5",
                  isLight
                    ? "border-[#e4d7cb] bg-[radial-gradient(circle_at_88%_8%,rgba(200,158,115,0.20),transparent_29%),linear-gradient(135deg,#fffdf9,#f8f0e8)] shadow-[0_20px_54px_rgba(140,102,72,0.10)]"
                    : "border-violet-300/18 bg-[radial-gradient(circle_at_88%_8%,rgba(168,85,247,0.22),transparent_29%),radial-gradient(circle_at_8%_100%,rgba(34,211,238,0.10),transparent_27%),linear-gradient(135deg,rgba(25,18,48,0.76),rgba(9,13,25,0.84))] shadow-[0_18px_54px_rgba(0,0,0,0.22)]"
                )}>
                  <div className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full border border-violet-300/20" />
                  <div className="relative max-w-2xl">
                    <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]", isLight ? "border-[#d8c1ac] bg-white/75 text-[#765640]" : "border-violet-300/25 bg-violet-400/10 text-violet-100")}>
                      <Sparkles className="h-3 w-3" />
                      Build a digital employee
                    </div>
                    <h2 className={cn("mt-2 font-display text-[19px] font-semibold tracking-[-0.035em] sm:mt-3 sm:text-[26px]", isLight ? "text-[#302219]" : "text-white")}>
                      Start with the right foundation.
                    </h2>
                    <p className={cn("mt-1.5 max-w-xl text-[11px] leading-4 sm:mt-2 sm:text-xs sm:leading-5", isLight ? "text-[#765f4f]" : "text-slate-300")}>
                      Choose how this worker begins. You will review every meaningful setting before AgentOS creates it in OpenClaw.
                    </p>
                  </div>
                </div>

                <div className="grid w-full gap-3 md:grid-cols-3">
                  <StartPointCard
                    icon={Plus}
                    title="Custom profile"
                    description="Shape a worker from the safe baseline."
                    helper="Best when the role is unique."
                    selected={startPoint === "empty"}
                    surfaceTheme={effectiveSurfaceTheme}
                    onSelect={() => handleStartPointSelect("empty")}
                  />
                  <StartPointCard
                    icon={Sparkles}
                    title="Role templates"
                    description="Start with a proven worker profile."
                    helper="Best for common roles."
                    selected={startPoint === "preset"}
                    surfaceTheme={effectiveSurfaceTheme}
                    onSelect={() => handleStartPointSelect("preset")}
                  />
                  <StartPointCard
                    icon={Copy}
                    title="Clone profile"
                    description="Copy an existing worker profile."
                    helper="Best when a baseline exists."
                    selected={startPoint === "import"}
                    surfaceTheme={effectiveSurfaceTheme}
                    onSelect={() => handleStartPointSelect("import")}
                  />
                </div>

                <div className={cn("hidden flex-col gap-1.5 rounded-xl border px-3 py-2 text-[11px] leading-4 sm:flex sm:flex-row sm:items-center sm:justify-between", isLight ? "border-[#e5d9ce] bg-white/70 text-[#7c6554]" : "border-white/[0.08] bg-white/[0.025] text-slate-400")}>
                  <span>Templates and cloning only prefill supported Worker Profile settings.</span>
                  <span className={cn("shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]", isLight ? "text-[#8a6b53]" : "text-violet-200")}>Safe baseline first</span>
                </div>
              </div>
            ) : stage === "preset" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <PanelCard
                  title="Choose a role template"
                  description="Pick the closest operating profile. You can review every setting before creation."
                  surfaceTheme={effectiveSurfaceTheme}
                  className="min-w-0"
                >
                  <div className="mt-3.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                    {AGENT_PRESET_OPTIONS.map((option) => (
                      <AgentPresetCard
                        key={option.value}
                        preset={option.value}
                        active={selectedPreset === option.value}
                        surfaceTheme={effectiveSurfaceTheme}
                        onClick={() => handlePresetSelect(option.value)}
                      />
                    ))}
                  </div>
                </PanelCard>

                <PanelCard
                  title="Template preview"
                  description="Role, capabilities, and check-in rhythm included in this profile."
                  surfaceTheme={effectiveSurfaceTheme}
                  className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {getAgentPresetMeta(selectedPreset).defaultEmoji}
                      </span>
                      <div className="min-w-0">
                        <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                          {getAgentPresetMeta(selectedPreset).label}
                        </p>
                        <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                          {getAgentPresetMeta(selectedPreset).description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        {getAgentPresetMeta(selectedPreset).tools.length} tools
                      </Badge>
                      <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        {getAgentPresetMeta(selectedPreset).skillIds.length} skills
                      </Badge>
                      <Badge variant={defaultHeartbeatForPreset(selectedPreset).enabled ? "success" : "muted"} className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                        Heartbeat {defaultHeartbeatForPreset(selectedPreset).enabled ? defaultHeartbeatForPreset(selectedPreset).every : "off"}
                      </Badge>
                    </div>

                    <CapabilityPreview
                      skills={getAgentPresetMeta(selectedPreset).skillIds}
                      tools={getAgentPresetMeta(selectedPreset).tools}
                      description="Declared capabilities included with this role template."
                      surfaceTheme={effectiveSurfaceTheme}
                    />

                    <AgentRootContextNotice surfaceTheme={effectiveSurfaceTheme} />

                    <div
                      className={cn(
                        "rounded-[18px] border p-2.5 text-[11px] leading-5",
                        isLight
                          ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                          : "border-white/10 bg-white/[0.03] text-slate-400"
                      )}
                    >
                      The template provides a role baseline and declared capabilities. Access still depends on the connected OpenClaw runtime and its effective policy.
                    </div>
                  </div>
                </PanelCard>
              </div>
            ) : stage === "import" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <PanelCard
                  title="Clone a Worker Profile"
                  description="Select a worker whose supported profile fields should seed the new draft."
                  surfaceTheme={effectiveSurfaceTheme}
                  className="min-w-0"
                >
                  <div className="mt-3.5 space-y-3">
                    <div className="relative">
                      <Input
                        value={importSearch}
                        onChange={(event) => setImportSearch(event.target.value)}
                        placeholder="Search by name, id, workspace, preset, or model"
                        className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                      />
                    </div>

                    <div className="space-y-2.5">
                      {importCandidates.length > 0 ? (
                        importCandidates.map((agent) => (
                          <ImportAgentCard
                            key={agent.id}
                            agent={agent}
                            workspaceName={
                              snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
                              agent.workspaceId
                            }
                            selected={selectedImportAgentId === agent.id}
                            surfaceTheme={effectiveSurfaceTheme}
                            onSelect={() => handleImportAgentSelect(agent.id)}
                          />
                        ))
                      ) : (
                        <div
                          className={cn(
                            "rounded-[20px] border border-dashed p-4 text-sm leading-6",
                            isLight ? "border-[#e1d5c8] bg-white text-[#7f6958]" : "border-white/10 bg-white/[0.02] text-slate-400"
                          )}
                        >
                          No agents match this search. Clear the search or go back to choose another start.
                        </div>
                      )}
                    </div>
                  </div>
                </PanelCard>

                <PanelCard
                  title="Clone preview"
                  description="Review what will seed the new Worker Profile."
                  surfaceTheme={effectiveSurfaceTheme}
                  className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                >
                  {selectedImportAgent ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {selectedImportAgent.identity.emoji ?? "🤖"}
                      </span>
                        <div className="min-w-0">
                          <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                            {formatAgentDisplayName(selectedImportAgent)}
                          </p>
                          <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            {selectedImportAgent.id}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {selectedImportWorkspace?.name ?? selectedImportAgent.workspaceId}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {getAgentPresetMeta(selectedImportAgent.policy.preset).label}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {selectedImportAgent.modelId === "unassigned" ? "default model" : selectedImportAgent.modelId}
                        </Badge>
                      </div>

                      <CapabilityPreview
                        skills={draft.skills}
                        tools={draft.tools}
                        description="Declared capabilities that will seed the cloned profile."
                        surfaceTheme={effectiveSurfaceTheme}
                      />

                      <AgentRootContextNotice surfaceTheme={effectiveSurfaceTheme} />

                      <div
                        className={cn(
                          "rounded-[18px] border p-2.5 text-[11px] leading-5",
                          isLight
                            ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                            : "border-white/10 bg-white/[0.03] text-slate-400"
                        )}
                      >
                        Identity, model, heartbeat, operating guidance, and declared skills/tools seed the draft. Channel participation is copied only inside the same workspace.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div
                        className={cn(
                          "rounded-[18px] border border-dashed p-4 text-sm leading-6",
                          isLight ? "border-[#e1d5c8] bg-white text-[#7f6958]" : "border-white/10 bg-white/[0.02] text-slate-400"
                        )}
                      >
                        Choose an existing worker on the left. Credentials, connected accounts, and browser sessions are never copied.
                      </div>

                      <AgentRootContextNotice surfaceTheme={effectiveSurfaceTheme} />
                    </div>
                  )}
                </PanelCard>
              </div>
            ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-3.5">
                  <PanelCard
                    title="Role & identity"
                    description="Define who this worker is and how it appears to operators."
                    surfaceTheme={effectiveSurfaceTheme}
                    className={cn(mobileDetailsStep !== "identity" && "hidden sm:block")}
                  >
                    <div className="space-y-4">
                      <WorkerRoleBaseline
                        emoji={draft.emoji || currentPresetMeta.defaultEmoji}
                        label={currentPresetMeta.label}
                        description={currentPresetMeta.description}
                        surfaceTheme={effectiveSurfaceTheme}
                      />

                      <FormField label="Display name" htmlFor="create-agent-name" surfaceTheme={effectiveSurfaceTheme}>
                        <Input
                          id="create-agent-name"
                          ref={nameInputRef}
                          value={draft.name}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              name: event.target.value
                            }))
                          }
                          placeholder={currentPresetMeta.defaultName}
                          className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                        />
                      </FormField>

                      <FormField label="Role" htmlFor="create-agent-role" surfaceTheme={effectiveSurfaceTheme}>
                        <Input
                          id="create-agent-role"
                          value={draft.role}
                          onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
                          placeholder={currentPresetMeta.label}
                          className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                        />
                      </FormField>

                      <FormField label="Mission" htmlFor="create-agent-mission" surfaceTheme={effectiveSurfaceTheme}>
                        <Textarea
                          id="create-agent-mission"
                          value={draft.mission}
                          onChange={(event) => setDraft((current) => ({ ...current, mission: event.target.value }))}
                          placeholder="What outcome does this worker own?"
                          className={cn(getCreateAgentControlClassName(effectiveSurfaceTheme), "min-h-[82px] resize-y")}
                        />
                      </FormField>

                      <FormField label="Working guidance" htmlFor="create-agent-behavior" surfaceTheme={effectiveSurfaceTheme}>
                        <Textarea
                          id="create-agent-behavior"
                          value={draft.behaviorInstructions}
                          onChange={(event) => setDraft((current) => ({ ...current, behaviorInstructions: event.target.value }))}
                          placeholder="Concise instructions specific to this worker."
                          className={cn(getCreateAgentControlClassName(effectiveSurfaceTheme), "min-h-[82px] resize-y")}
                        />
                      </FormField>

                      <FormField label="Profile theme" htmlFor="create-agent-theme" surfaceTheme={effectiveSurfaceTheme}>
                        <AgentThemePicker
                          value={draft.theme}
                          surfaceTheme={effectiveSurfaceTheme}
                          onChange={(theme) =>
                            setDraft((current) => ({
                              ...current,
                              theme
                            }))
                          }
                        />
                      </FormField>

                      <button
                        type="button"
                        onClick={() => setShowAdvancedIdentity((value) => !value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] transition-colors",
                          isLight ? "text-[#8b7462] hover:text-[#5d4331]" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        <ChevronRight
                          className={cn("h-3 w-3 transition-transform duration-200", showAdvancedIdentity && "rotate-90")}
                        />
                        {showAdvancedIdentity ? "Hide" : "Show"} emoji &amp; avatar
                      </button>

                      {showAdvancedIdentity ? (
                        <div className="grid gap-3.5 sm:grid-cols-2">
                          <FormField label="Emoji" htmlFor="create-agent-emoji" surfaceTheme={effectiveSurfaceTheme}>
                            <div className="relative">
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none text-base leading-none"
                              >
                                {draft.emoji || currentPresetMeta.defaultEmoji}
                              </span>
                              <Input
                                id="create-agent-emoji"
                                value={draft.emoji}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    emoji: event.target.value
                                  }))
                                }
                                placeholder={currentPresetMeta.defaultEmoji}
                                className={cn(getCreateAgentControlClassName(effectiveSurfaceTheme), "pl-9")}
                              />
                            </div>
                          </FormField>

                          <FormField label="Avatar URL" htmlFor="create-agent-avatar" surfaceTheme={effectiveSurfaceTheme}>
                            <Input
                              id="create-agent-avatar"
                              value={draft.avatar}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  avatar: event.target.value
                                }))
                              }
                              placeholder="https://example.com/avatar.png"
                              className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                            />
                          </FormField>
                        </div>
                      ) : null}
                    </div>
                  </PanelCard>

                  <PanelCard
                    title="Work setup"
                    description="Choose where the worker operates and which capabilities it starts with."
                    surfaceTheme={effectiveSurfaceTheme}
                    className={cn(mobileDetailsStep !== "work" && "hidden sm:block")}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <FormField label="Workspace" htmlFor="create-agent-workspace" surfaceTheme={effectiveSurfaceTheme}>
                          <select
                            id="create-agent-workspace"
                            value={draft.workspaceId}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                workspaceId: event.target.value,
                                modelId: current.modelId.trim()
                                  ? current.modelId
                                  : resolveSuggestedAgentModelId(snapshot, event.target.value),
                                channelIds: []
                              }))
                            }
                            style={isLight ? { colorScheme: "light" } : undefined}
                            className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                          >
                            {snapshot.workspaces.map((workspace) => (
                              <option key={workspace.id} value={workspace.id}>
                                {workspace.name}
                              </option>
                            ))}
                          </select>
                        </FormField>

                        <FormField label="Model" htmlFor="create-agent-model" surfaceTheme={effectiveSurfaceTheme}>
                          <select
                            id="create-agent-model"
                            value={draft.modelId}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                modelId: event.target.value
                              }))
                            }
                            style={isLight ? { colorScheme: "light" } : undefined}
                            className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                          >
                            <option value="">
                              {snapshot.diagnostics.modelReadiness.defaultModelReady
                                ? "Use OpenClaw default"
                                : suggestedModelId
                                  ? `Use suggested model (${suggestedModelId})`
                                  : "Choose a model"}
                            </option>
                            {snapshot.models.map((model) => {
                              const modelReady = isSnapshotModelUsable(snapshot, model.id);

                              return (
                                <option key={model.id} value={model.id}>
                                  {model.id}
                                  {modelReady ? "" : " (not ready)"}
                                </option>
                              );
                            })}
                          </select>
                          {selectedModelReadinessMessage ? (
                            <p className={cn("mt-2 text-[11px] leading-4", isLight ? "text-[#9b5f34]" : "text-amber-200/85")}>
                              {selectedModelReadinessMessage}
                            </p>
                          ) : null}
                        </FormField>
                      </div>

                      <div className={cn("h-px", isLight ? "bg-[#eadfd4]" : "bg-white/10")} />

                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={cn("text-[12px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>Scheduled check-ins</p>
                          <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            Enable heartbeat only for workers that should watch, triage, or report periodically.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draft.heartbeat.enabled}
                          aria-label="Toggle scheduled check-ins"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              heartbeat: current.heartbeat.enabled
                                ? { ...current.heartbeat, enabled: false }
                                : {
                                    ...current.heartbeat,
                                    enabled: true,
                                    every: current.heartbeat.every || defaultHeartbeatForPreset(current.policy.preset).every
                                  }
                            }))
                          }
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2",
                            isLight
                              ? draft.heartbeat.enabled
                                ? "bg-[#c89e73] focus-visible:ring-[#c89e73]/40"
                                : "bg-[#ddd0c6] focus-visible:ring-[#c89e73]/40"
                              : draft.heartbeat.enabled
                                ? "bg-cyan-400 focus-visible:ring-cyan-300/40"
                                : "bg-white/20 focus-visible:ring-cyan-300/40"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200",
                              draft.heartbeat.enabled ? "translate-x-5" : "translate-x-0"
                            )}
                          />
                        </button>
                      </div>

                      {draft.heartbeat.enabled ? (
                        <FormField label="Check-in interval" htmlFor="create-agent-heartbeat-every" surfaceTheme={effectiveSurfaceTheme}>
                          <select
                            id="create-agent-heartbeat-every"
                            value={draft.heartbeat.every}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                heartbeat: {
                                  ...current.heartbeat,
                                  every: event.target.value
                                }
                              }))
                            }
                            style={isLight ? { colorScheme: "light" } : undefined}
                            className={getCreateAgentControlClassName(effectiveSurfaceTheme)}
                          >
                            {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      ) : null}

                      <CapabilityPreview
                        skills={draft.skills}
                        tools={draft.tools}
                        surfaceTheme={effectiveSurfaceTheme}
                        description={startPoint === "import"
                          ? "Declared capabilities copied from the source profile."
                          : "Declared capabilities included by this role baseline."}
                      />
                    </div>
                  </PanelCard>

                  <PanelCard
                    title="Access & safety"
                    description="Separate runtime-enforced boundaries from operating guidance."
                    surfaceTheme={effectiveSurfaceTheme}
                    className={cn(mobileDetailsStep !== "safety" && "hidden sm:block")}
                  >
                    <div className="space-y-4">
                      <PolicyBoundaryNotice surfaceTheme={effectiveSurfaceTheme} />

                      <div className="grid gap-3.5 sm:grid-cols-2">
                        <AgentPolicySelect
                          label="File boundary (enforced)"
                          htmlFor="create-agent-file-access"
                          value={draft.policy.fileAccess}
                          options={AGENT_FILE_ACCESS_OPTIONS}
                          surfaceTheme={effectiveSurfaceTheme}
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              policy: {
                                ...current.policy,
                                fileAccess: value
                              }
                            }))
                          }
                        />
                      </div>

                      <div className={cn("rounded-[18px] border p-3", isLight ? "border-[#e2d5c9] bg-[#faf6f1]" : "border-white/10 bg-white/[0.025]")}>
                        <div className="mb-3 flex items-start gap-2">
                          <BriefcaseBusiness className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isLight ? "text-[#8b6d56]" : "text-violet-200")} />
                          <div>
                            <p className={cn("text-[11px] font-medium", isLight ? "text-[#3f2f24]" : "text-slate-100")}>Operating guidance</p>
                            <p className={cn("mt-1 text-[10px] leading-4", isLight ? "text-[#7b6657]" : "text-slate-400")}>
                              These choices become agent instructions. They do not grant OS installs, network access, credentials, or tools beyond effective OpenClaw policy.
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3.5 sm:grid-cols-2">
                          <AgentPolicySelect
                            label="Missing tool response"
                            htmlFor="create-agent-missing-tools"
                            value={draft.policy.missingToolBehavior}
                            options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS}
                            surfaceTheme={effectiveSurfaceTheme}
                            onChange={(value) =>
                              setDraft((current) => ({
                                ...current,
                                policy: {
                                  ...current.policy,
                                  missingToolBehavior: value
                                }
                              }))
                            }
                          />
                          <AgentPolicySelect
                            label="Install guidance"
                            htmlFor="create-agent-install-scope"
                            value={draft.policy.installScope}
                            options={AGENT_INSTALL_SCOPE_OPTIONS}
                            surfaceTheme={effectiveSurfaceTheme}
                            onChange={(value) =>
                              setDraft((current) => ({
                                ...current,
                                policy: {
                                  ...current.policy,
                                  installScope: value
                                }
                              }))
                            }
                          />
                          <AgentPolicySelect
                            label="Network guidance"
                            htmlFor="create-agent-network-access"
                            value={draft.policy.networkAccess}
                            options={AGENT_NETWORK_ACCESS_OPTIONS}
                            surfaceTheme={effectiveSurfaceTheme}
                            onChange={(value) =>
                              setDraft((current) => ({
                                ...current,
                                policy: {
                                  ...current.policy,
                                  networkAccess: value
                                }
                              }))
                            }
                          />
                        </div>
                      </div>

                      <BrowserAccountLimitNotice surfaceTheme={effectiveSurfaceTheme} />

                      <ChannelBindingPicker
                        snapshot={snapshot}
                        workspaceId={draft.workspaceId}
                        channelIds={draft.channelIds}
                        isSaving={isSaving}
                        surfaceTheme={effectiveSurfaceTheme}
                        onChange={(channelIds) =>
                          setDraft((current) => ({
                            ...current,
                            channelIds
                          }))
                        }
                      />
                    </div>
                  </PanelCard>
                </div>

                <div className={cn("space-y-4", mobileDetailsStep !== "safety" && "hidden sm:block")}>
                  <PanelCard
                    title="Profile review"
                    description="What AgentOS will create for this worker."
                    surfaceTheme={effectiveSurfaceTheme}
                    className="xl:sticky xl:top-4 xl:self-start xl:h-fit"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border text-[14px]",
                          isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-base"
                        )}
                      >
                        {draft.emoji || currentPresetMeta.defaultEmoji}
                      </span>
                        <div className="min-w-0">
                          <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                            {draft.name || currentPresetMeta.defaultName}
                          </p>
                          <p className={cn("mt-0.5 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                            {selectedWorkspace?.name ?? "No workspace selected"}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="default" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {currentPresetMeta.label} role
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {startPoint === "empty"
                            ? "Custom profile"
                            : startPoint === "preset"
                              ? "Role template"
                              : startPoint === "import"
                                ? "Cloned profile"
                                : "Start a flow"}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {draft.modelId || suggestedModelId || "OpenClaw default"}
                        </Badge>
                        <Badge variant={draft.heartbeat.enabled ? "success" : "muted"} className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          Heartbeat {draft.heartbeat.enabled ? draft.heartbeat.every : "off"}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          {draft.skills.length} skills · {draft.tools.length} tools
                        </Badge>
                        <Badge variant={draft.policy.fileAccess === "workspace-only" ? "success" : "warning"} className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
                          Files: {draft.policy.fileAccess === "workspace-only" ? "workspace only" : "extended"}
                        </Badge>
                      </div>

                      <AgentRootContextNotice surfaceTheme={effectiveSurfaceTheme} />

                      <div
                        className={cn(
                          "rounded-[18px] border p-2.5 text-[11px] leading-5",
                          isLight
                            ? "border-[#e2d5c9] bg-[#faf6f1] text-[#7b6657]"
                            : "border-white/10 bg-white/[0.03] text-slate-400"
                        )}
                      >
                        <p className={cn("text-[10px] uppercase tracking-[0.18em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
                          Generated id
                        </p>
                        <code
                          className={cn(
                            "mt-1.5 block break-all rounded-2xl border px-3 py-1.5 text-[11px]",
                            isLight ? "border-[#dccfc3] bg-white text-[#4d392e]" : "border-white/10 bg-white/5 text-slate-200"
                          )}
                        >
                          {generatedAgentId || "unavailable"}
                        </code>
                      </div>
                    </div>
                  </PanelCard>
                </div>
              </div>
      )}
      </MissionControlDialogShell>
    </>
  );
}

function createCustomAgentDraft(workspaceId: string, snapshot: MissionControlSnapshot): AgentDraft {
  return applyAgentPreset(buildAgentDraft(workspaceId, {
    modelId: resolveSuggestedAgentModelId(snapshot, workspaceId)
  }), "custom");
}

function buildImportedAgentDraft(
  workspaceId: string,
  sourceAgent: MissionControlSnapshot["agents"][number],
  channelIds: string[]
): AgentDraft {
  const capabilities = normalizeAgentDraftCapabilities(sourceAgent.skills, sourceAgent.tools);

  return buildAgentDraft(workspaceId, {
    modelId: sourceAgent.modelId === "unassigned" ? "" : sourceAgent.modelId,
    name: formatAgentDisplayName(sourceAgent),
    emoji: sourceAgent.identity.emoji ?? "",
    theme: sourceAgent.identity.theme ?? "",
    avatar: sourceAgent.identity.avatar ?? "",
    role: sourceAgent.workerProfile?.employment.role ?? sourceAgent.policy.preset,
    mission: sourceAgent.workerProfile?.employment.mission ?? sourceAgent.profile.purpose ?? "",
    behaviorInstructions: sourceAgent.workerProfile?.employment.behaviorInstructions ?? "",
    labels: sourceAgent.workerProfile?.operator.labels ?? [],
    policy: sourceAgent.policy,
    heartbeat: resolveHeartbeatDraft(sourceAgent.policy.preset, {
      enabled: sourceAgent.heartbeat.enabled,
      every: sourceAgent.heartbeat.every ?? undefined
    }),
    channelIds,
    skills: capabilities.skills,
    tools: capabilities.tools
  });
}

function getWizardStepLabels(startPoint: StartPoint | null) {
  if (!startPoint) {
    return ["Start"];
  }

  if (startPoint === "empty") {
    return ["Start", "Profile"];
  }

  if (startPoint === "preset") {
    return ["Start", "Template", "Profile"];
  }

  return ["Start", "Clone", "Profile"];
}

function getWizardActiveStepIndex(startPoint: StartPoint | null, stage: WizardStage) {
  if (!startPoint || stage === "start") {
    return 0;
  }

  if (stage === "details") {
    return startPoint === "empty" ? 1 : 2;
  }

  return 1;
}

function getCanAdvanceFromStage(
  stage: WizardStage,
  startPoint: StartPoint | null,
  selectedImportAgentId: string | null
) {
  if (stage === "start") {
    return Boolean(startPoint);
  }

  if (stage === "preset") {
    return true;
  }

  if (stage === "import") {
    return Boolean(selectedImportAgentId);
  }

  return true;
}

function getWizardStageHint(startPoint: StartPoint | null, stage: WizardStage) {
  if (stage === "start") {
    if (startPoint === "empty") {
      return "Custom profile selected. Continue to shape the worker.";
    }

    if (startPoint === "preset") {
      return "Role templates selected. Continue to choose a baseline.";
    }

    if (startPoint === "import") {
      return "Clone profile selected. Continue to choose a source worker.";
    }

    return "Choose how to shape this digital employee.";
  }

  if (stage === "preset") {
    return "Choose a role baseline, then review the full Worker Profile.";
  }

  if (stage === "import") {
    return "Select an existing Worker Profile to clone.";
  }

  if (startPoint === "empty") {
    return "Define the role, work setup, and access posture.";
  }

  if (startPoint === "preset") {
    return "Template loaded. Review the role, work setup, and access posture.";
  }

  if (startPoint === "import") {
    return "Cloned baseline loaded. Review every field before creation.";
  }

  return "";
}

function getCreateAgentControlClassName(surfaceTheme: SurfaceTheme) {
  void surfaceTheme;
  return missionControlDialogControlClassName();
}

function WizardStepper({
  labels,
  activeIndex,
  surfaceTheme = "dark",
  onStepClick
}: {
  labels: string[];
  activeIndex: number;
  surfaceTheme?: SurfaceTheme;
  onStepClick?: (index: number) => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;
        const isClickable = isComplete && Boolean(onStepClick);

        const inner = (
          <>
            <span
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-medium",
                isActive
                  ? isLight
                    ? "bg-[#c89e73]/15 text-[#5d4331]"
                    : "bg-cyan-300/20 text-cyan-50"
                  : isComplete
                    ? isLight
                      ? "bg-[#f0e7de] text-[#7a6556]"
                      : "bg-emerald-300/20 text-emerald-50"
                    : isLight
                      ? "bg-[#f2ece6] text-[#917866]"
                      : "bg-white/10 text-slate-400"
              )}
            >
              {index + 1}
            </span>
            <span>{label}</span>
          </>
        );

        const sharedClassName = cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors",
          isActive
            ? isLight
              ? "border-[#c89e73]/35 bg-[#f8efe4] text-[#5d4331]"
              : "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
            : isComplete
              ? isLight
                ? "border-[#dccfc3] bg-white text-[#7e6757]"
                : "border-emerald-300/20 bg-emerald-400/10 text-emerald-50"
              : isLight
                ? "border-[#e6dbd0] bg-white/80 text-[#8b7563]"
                : "border-white/10 bg-white/[0.04] text-slate-400",
          isClickable && (isLight ? "cursor-pointer hover:border-[#c89e73]/50 hover:bg-[#faf3ea]" : "cursor-pointer hover:border-emerald-300/30 hover:bg-emerald-400/15")
        );

        return isClickable ? (
          <button
            key={`${label}-${index}`}
            type="button"
            onClick={() => onStepClick?.(index)}
            className={sharedClassName}
          >
            {inner}
          </button>
        ) : (
          <div key={`${label}-${index}`} className={sharedClassName}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function PanelCard({
  title,
  description,
  children,
  className,
  surfaceTheme = "dark"
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <section className={missionControlDialogPanelClassName(cn("rounded-[18px] p-4", className))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[13px] font-semibold tracking-[-0.01em]", isLight ? "text-[#3f2f24]" : "text-white")}>{title}</p>
          {description ? (
            <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-400")}>{description}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3.5 min-w-0">{children}</div>
    </section>
  );
}

function StartPointCard({
  icon: Icon,
  title,
  description,
  helper,
  selected,
  surfaceTheme = "dark",
  onSelect
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  helper: string;
  selected: boolean;
  surfaceTheme?: SurfaceTheme;
  onSelect: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group relative flex min-h-[104px] w-full flex-col overflow-hidden rounded-[16px] border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 sm:min-h-[185px] sm:rounded-[18px] sm:p-4",
        isLight
          ? "focus-visible:ring-[#c89e73]/30"
          : "focus-visible:ring-cyan-300/40",
        selected
          ? isLight
            ? "border-[#cda781] bg-[#fff8ef] shadow-[0_18px_44px_rgba(161,125,101,0.15)]"
            : "border-violet-300/35 bg-violet-400/10 shadow-[0_0_0_1px_rgba(167,139,250,0.12),0_18px_44px_rgba(0,0,0,0.18)]"
          : isLight
            ? "border-[#e7dbcf] bg-[rgba(255,252,247,0.9)] shadow-[0_10px_24px_rgba(161,125,101,0.05)] hover:-translate-y-0.5 hover:border-[#d1b69e] hover:bg-[#fffdf9]"
            : "border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-violet-300/28 hover:bg-violet-400/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            isLight ? "border-[#e0d3c6] bg-[#faf6f0] text-[#7a5f4c]" : "border-violet-300/18 bg-violet-400/10 text-violet-100"
          )}
        >
          <Icon className="h-[17px] w-[17px]" />
        </div>
        <Badge
          variant={selected ? "default" : "muted"}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? selected
                ? "border-[#d7c1ae] bg-[#f3e5d8] text-[#6a4b38]"
                : "border-[#e3d6c8] bg-[rgba(255,255,255,0.82)] text-[#8a6f5d]"
              : ""
          )}
        >
          {selected ? "Selected" : "Available"}
        </Badge>
      </div>

      <div className="mt-3 space-y-1 sm:mt-5 sm:space-y-1.5">
        <p className={cn("text-sm font-semibold tracking-[-0.015em]", isLight ? "text-[#413126]" : "text-white")}>{title}</p>
        <p className={cn("text-[11px] leading-4", isLight ? "text-[#8a7463]" : "text-slate-400")}>{description}</p>
      </div>

      <div className="mt-2 border-t border-current/10 pt-2 sm:mt-auto sm:pt-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className={cn("hidden max-w-[116px] text-[9px] uppercase leading-[1.35] tracking-[0.2em] sm:inline", isLight ? "text-[#9a8572]" : "text-slate-500")}>
            {helper}
          </span>
          <span className={cn("inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.18em]", isLight ? "text-[#7f6958]" : "text-slate-400")}>
            Select
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

function ImportAgentCard({
  agent,
  workspaceName,
  selected,
  surfaceTheme = "dark",
  onSelect
}: {
  agent: MissionControlSnapshot["agents"][number];
  workspaceName: string;
  selected: boolean;
  surfaceTheme?: SurfaceTheme;
  onSelect: () => void;
}) {
  const presetMeta = getAgentPresetMeta(agent.policy.preset);
  const modelLabel = agent.modelId === "unassigned" ? "default model" : agent.modelId;
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full flex-col rounded-[22px] border p-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2",
        isLight ? "focus-visible:ring-[#c89e73]/30" : "focus-visible:ring-cyan-300/40",
        selected
          ? isLight
            ? "border-[#c89e73]/45 bg-[#fff8f0] shadow-[0_16px_40px_rgba(161,125,101,0.12)]"
            : "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.1)]"
          : isLight
            ? "border-[#e3d7cc] bg-white/92 shadow-[0_14px_34px_rgba(161,125,101,0.08)] hover:border-[#d4c2b4] hover:bg-white"
            : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-[15px]",
              isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5"
            )}
          >
            {agent.identity.emoji ?? "🤖"}
          </span>
          <div className="min-w-0">
            <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
              {formatAgentDisplayName(agent)}
            </p>
            <p className={cn("mt-0.5 truncate text-[11px] leading-4", isLight ? "text-[#7f6958]" : "text-slate-500")}>
              {agent.id}
            </p>
          </div>
        </div>

        <Badge
          variant={selected ? "default" : "muted"}
          className={cn(
            "shrink-0 px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? selected
                ? "border-[#c89e73]/35 bg-[#f5e7d8] text-[#6a4a34]"
                : "border-[#e1d5c8] bg-white text-[#846a58]"
              : ""
          )}
        >
          {selected ? "Selected" : presetMeta.label}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge
          variant="muted"
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
          )}
        >
          {workspaceName}
        </Badge>
        <Badge
          variant="muted"
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
          )}
        >
          {modelLabel}
        </Badge>
        <Badge
          variant={agent.status === "ready" ? "success" : "muted"}
          className={cn(
            "px-2 py-0.5 text-[9px] normal-case tracking-normal",
            isLight
              ? agent.status === "ready"
                ? "border-emerald-300/40 bg-emerald-100 text-emerald-800"
                : "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]"
            : ""
          )}
        >
          {agent.status}
        </Badge>
      </div>

      <p className={cn("mt-3 text-[12px] leading-5", isLight ? "text-[#7f6958]" : "text-slate-400")}>{presetMeta.description}</p>

      <div className="mt-3.5 flex items-center justify-between gap-3">
        <span className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
          Clone as a new Worker Profile
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#7f6958]" : "text-slate-400")}>
          Select
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function WorkerRoleBaseline({
  emoji,
  label,
  description,
  surfaceTheme
}: {
  emoji: string;
  label: string;
  description: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border p-3",
        isLight
          ? "border-[#e2d5c9] bg-[#faf6f1]"
          : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-[15px]",
            isLight ? "border-[#ded0c2] bg-white text-[#7b604c]" : "border-white/10 bg-white/5"
          )}
        >
          {emoji}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("text-[12px] font-medium", isLight ? "text-[#3f2f24]" : "text-slate-100")}>
              {label} role baseline
            </p>
            <Badge variant="muted" className="px-2 py-0.5 text-[9px] normal-case tracking-normal">
              Worker Profile
            </Badge>
          </div>
          <p className={cn("mt-1 text-[10px] leading-4", isLight ? "text-[#7b6657]" : "text-slate-400")}>
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

function CapabilityPreview({
  skills,
  tools,
  description,
  surfaceTheme
}: {
  skills: string[];
  tools: string[];
  description?: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border p-3",
        isLight
          ? "border-[#e2d5c9] bg-[#fffdf9]"
          : "border-white/10 bg-white/[0.025]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-[11px] font-medium", isLight ? "text-[#3f2f24]" : "text-slate-100")}>
            Skills &amp; tools preview
          </p>
          {description ? (
            <p className={cn("mt-1 text-[10px] leading-4", isLight ? "text-[#7b6657]" : "text-slate-400")}>
              {description}
            </p>
          ) : null}
        </div>
        <Badge variant="muted" className="shrink-0 px-2 py-0.5 text-[9px] normal-case tracking-normal">
          {skills.length + tools.length} declared
        </Badge>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CapabilityGroup
          icon={BrainCircuit}
          label="Skills"
          values={skills}
          emptyLabel="No preset skills"
          surfaceTheme={surfaceTheme}
        />
        <CapabilityGroup
          icon={Wrench}
          label="Tools"
          values={tools}
          emptyLabel="No declared tools"
          surfaceTheme={surfaceTheme}
        />
      </div>

      <p className={cn("mt-3 text-[9px] leading-4", isLight ? "text-[#9a8070]" : "text-slate-500")}>
        Skills are configured for this agent. Tool names describe the profile; actual availability comes from effective OpenClaw policy and the running environment.
      </p>
    </div>
  );
}

function CapabilityGroup({
  icon: Icon,
  label,
  values,
  emptyLabel,
  surfaceTheme
}: {
  icon: LucideIcon;
  label: string;
  values: string[];
  emptyLabel: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="min-w-0">
      <div className={cn("flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em]", isLight ? "text-[#8b7462]" : "text-slate-500")}>
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <span
              key={value}
              className={cn(
                "max-w-full break-all rounded-full border px-2 py-1 font-mono text-[9px] leading-3",
                isLight
                  ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]"
                  : "border-white/10 bg-white/5 text-slate-300"
              )}
            >
              {value}
            </span>
          ))
        ) : (
          <span className={cn("text-[10px]", isLight ? "text-[#9a8070]" : "text-slate-500")}>{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}

function PolicyBoundaryNotice({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border p-3",
        isLight
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
          : "border-emerald-300/15 bg-emerald-400/[0.06] text-emerald-50"
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isLight ? "text-emerald-700" : "text-emerald-200")} />
        <div>
          <p className="text-[11px] font-medium">OpenClaw-enforced boundary</p>
          <p className={cn("mt-1 text-[10px] leading-4", isLight ? "text-emerald-900/75" : "text-emerald-100/70")}>
            Workspace-only file access is compiled to OpenClaw&apos;s filesystem restriction. Extended access only removes that profile restriction; host and sandbox controls still apply.
          </p>
        </div>
      </div>
    </div>
  );
}

function BrowserAccountLimitNotice({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border p-3",
        isLight
          ? "border-[#e2d5c9] bg-[#faf6f1] text-[#6f5849]"
          : "border-white/10 bg-white/[0.03] text-slate-400"
      )}
    >
      <div className="flex items-start gap-2">
        <LockKeyhole className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isLight ? "text-[#8b6d56]" : "text-amber-200")} />
        <div>
          <p className={cn("text-[11px] font-medium", isLight ? "text-[#3f2f24]" : "text-slate-100")}>
            Accounts &amp; browser sessions stay separate
          </p>
          <p className="mt-1 text-[10px] leading-4">
            Creating or cloning this profile never copies credentials, signs the worker into a browser, or assigns a browser profile. Eligible accounts are selected separately for supported tasks.
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentRootContextNotice({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "rounded-[18px] border p-3 text-[11px] leading-5",
        isLight
          ? "border-[#e2d5c9] bg-[#faf6f1] text-[#6f5849]"
          : "border-white/10 bg-white/[0.03] text-slate-400"
      )}
    >
      <div className="flex items-start gap-2">
        <FileText className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isLight ? "text-[#8b6d56]" : "text-cyan-200")} />
        <div className="min-w-0">
          <p className={cn("text-[12px] font-medium", isLight ? "text-[#3f2f24]" : "text-slate-100")}>
            Profile &amp; runtime context
          </p>
          <p className="mt-1">
            AgentOS saves profile metadata and compiles operating behavior into agent-specific instructions. Workspace <code>AGENTS.md</code> remains shared context and may include a concise role summary.
          </p>
        </div>
      </div>
    </div>
  );
}
