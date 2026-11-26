"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Info, LoaderCircle, LockKeyhole, MoonStar, SquareTerminal, SunMedium, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { OnboardingOwnerForm } from "@/components/auth/instance-protection-dialog";
import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { isTauriDesktopRuntime } from "@/lib/desktop/open-external-auth-url";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import {
  isOpenClawMissionReady,
  isOpenClawOnboardingModelReady,
  isOpenClawOnboardingSystemReady
} from "@/lib/openclaw/readiness";
import type {
  DiscoveredModelCandidate,
  AddModelsProviderId,
  ChatGptBrowserAuthSnapshot,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase,
  OpenClawThinkingLevel,
  OperationProgressSnapshot
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import {
  buildSystemSteps,
  ghostActionClassName,
  secondaryActionClassName,
  resolveModelPhaseLabel,
  resolvePrimaryAction,
  resolveStageDescription,
  resolveSystemStepActionLabel,
  resolveSystemPhaseLabel,
  isChatGptConnectionReady,
  isOnboardingModelStepComplete,
  type StageRunDetails,
  type SurfaceTheme,
  type StepState,
  type WizardStage
} from "@/components/mission-control/openclaw-onboarding.utils";
import { hasAgentOSWorkspaceSetup } from "@/components/mission-control/mission-control-shell.utils";
import {
  OPENCLAW_INSTALL_TARGET_VERSION
} from "@/lib/openclaw/versions";
import {
  LaunchpadStage,
  ModelStage,
  type ModelSwitchFeedback
} from "@/components/mission-control/openclaw-onboarding.stages";

import { OnboardingProgress } from "@/components/workforce/onboarding-progress";
import { SiwcWelcome } from "@/components/mission-control/siwc-welcome";

type OnboardingVisualStage = WizardStage | "finish";

export function OpenClawOnboarding({
  snapshot,
  surfaceTheme,
  onToggleTheme,
  stage,
  systemReady,
  modelReady,
  systemSetupRequired,
  systemStatusChecking,
  gatewayReachable,
  gatewayRegistered,
  gatewayReady,
  runtimeWritable,
  localModelStatus,
  cliInstalled,
  showReadyState,
  systemActionLabel,
  systemActionDescription,
  systemPhase,
  modelPhase,
  systemRun,
  modelRun,
  modelSwitchFeedback,
  selectedAgentId,
  selectedModelId,
  selectedThinking,
  discoveredModels,
  onSelectedModelIdChange,
  onSelectedThinkingChange,
  onClearModelSwitchFeedback,
  onSnapshotChange,
  onRunSystemSetup,
  onStartSiwc,
  onLeaveSiwc,
  resumeSiwc,
  onEnterAfterSiwc,
  onCreateFirstWorkspace,
  onRunModelSetDefault,
  onOpenAddModels,
  onOpenGatewayAuthSettings,
  onCreateWorkspace,
  onEnterAgentOS,
  onSkipSetup,
  onContinueToModels,
  onBackToSystem,
  onConnectChatGPT,
  chatGptBrowserAuth,
  onSubmitChatGptRedirect,
  onContinueFromAi,
  launchpadCreateProgress,
  launchpadCreateRunState
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  onToggleTheme: () => void;
  stage: WizardStage;
  systemReady?: boolean;
  modelReady?: boolean;
  systemSetupRequired?: boolean;
  systemStatusChecking?: boolean;
  gatewayReachable?: boolean | null;
  gatewayRegistered?: boolean | null;
  gatewayReady?: boolean | null;
  runtimeWritable?: boolean | null;
  localModelStatus?: { checked: boolean; defaultModelId: string | null; modelIds: string[] };
  cliInstalled?: boolean | null;
  showReadyState: boolean;
  systemActionLabel: string;
  systemActionDescription: string;
  systemPhase: OpenClawOnboardingPhase | null;
  modelPhase: OpenClawModelOnboardingPhase | null;
  systemRun: StageRunDetails;
  modelRun: StageRunDetails;
  modelSwitchFeedback: ModelSwitchFeedback;
  selectedAgentId?: string | null;
  selectedModelId: string;
  selectedThinking: OpenClawThinkingLevel;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onSelectedThinkingChange: (value: OpenClawThinkingLevel) => void;
  onClearModelSwitchFeedback: () => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRunSystemSetup: () => void | Promise<void>;
  onStartSiwc?: () => void;
  onLeaveSiwc?: () => void;
  resumeSiwc?: boolean;
  onEnterAfterSiwc?: () => void;
  onCreateFirstWorkspace?: () => void;
  onRunModelSetDefault: (modelId?: string, thinking?: OpenClawThinkingLevel) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onOpenGatewayAuthSettings: () => void;
  onCreateWorkspace: () => void;
  onEnterAgentOS: () => void;
  onSkipSetup: () => void;
  onContinueToModels: () => void;
  onBackToSystem: () => void;
  onConnectChatGPT: (force?: boolean) => void;
  chatGptBrowserAuth: ChatGptBrowserAuthSnapshot | null;
  onSubmitChatGptRedirect: (redirectUrl: string) => void;
  onContinueFromAi: (thinking?: OpenClawThinkingLevel) => void;
  launchpadCreateProgress: OperationProgressSnapshot | null;
  launchpadCreateRunState: "idle" | "running" | "success" | "error";
}) {
  const onboardingSystemReady = systemRun.runState === "running" || systemStatusChecking
    ? false
    : systemReady ?? (systemRun.runState === "success" || isOpenClawOnboardingSystemReady(snapshot));
  const hasWorkspaceSetup = hasAgentOSWorkspaceSetup(snapshot);
  const operationalReady = isOpenClawMissionReady(snapshot);
  const onboardingModelReady =
    modelReady ??
    (
      modelSwitchFeedback.phase === "success" ||
      showReadyState ||
      isOpenClawOnboardingModelReady(snapshot)
    );
  const onboardingAiReady = isOnboardingModelStepComplete({
    chatGptConnectionReady: isChatGptConnectionReady(snapshot),
    explicitSetupComplete: showReadyState || modelSwitchFeedback.phase === "success"
  });
  const modelSetupConfirmed = showReadyState || modelSwitchFeedback.phase === "success";
  const canEnterAgentOS = hasWorkspaceSetup && onboardingSystemReady && modelSetupConfirmed;
  const showLaunchpad = modelSetupConfirmed && (
    showReadyState ||
    launchpadCreateRunState === "running" ||
    launchpadCreateRunState === "success" ||
    launchpadCreateRunState === "error"
  );
  const canShowFinish = onboardingSystemReady && modelSetupConfirmed && (hasWorkspaceSetup || showReadyState);
  const isLaunchpadBuilding = launchpadCreateRunState === "running";
  const workspaceCount = snapshot.workspaces.length;
  const agentCount = snapshot.agents.length;
  const hasWorkspaces = workspaceCount > 0;
  const defaultModelLabel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "Ready";
  const defaultModelId =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;
  const gatewayAuthNeedsSetup = snapshot.diagnostics.issues.some((issue) =>
    /gateway\..*auth|redacted secret|AGENTOS_OPENCLAW_GATEWAY_TOKEN|OPENCLAW_GATEWAY_TOKEN/i.test(issue)
  );
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [selectedVisualStage, setSelectedVisualStage] = useState<OnboardingVisualStage | null>(null);
  const [showLegacySetup, setShowLegacySetup] = useState(false);
  const [advancedProviderFlowOpen, setAdvancedProviderFlowOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const { status: instanceStatus } = useInstanceProtection();
  const stepContent = useRef<HTMLDivElement>(null);
  const systemPhaseForSteps = onboardingSystemReady ? "ready" : systemPhase;
  const systemSteps = buildSystemSteps(snapshot, systemPhaseForSteps, {
    forcePending: systemSetupRequired,
    suppressGatewaySnapshot: systemStatusChecking,
    gatewayReachable,
    gatewayRegistered,
    gatewayReady,
    runtimeWritable,
    cliInstalled
  });
  const availableModels = snapshot.models.filter((model) => model.available !== false && !model.missing);
  const selectedModelLabel =
    availableModels.find((model) => model.id === selectedModelId)?.name || selectedModelId || null;
  const defaultVisualStage: OnboardingVisualStage = canShowFinish ? "finish" : showLaunchpad ? "finish" : stage;
  const effectiveSelectedVisualStage =
    selectedVisualStage === "finish" && !canShowFinish && !showLaunchpad ? null : selectedVisualStage;
  const visualStage = effectiveSelectedVisualStage ?? defaultVisualStage;
  const renderLaunchpad = visualStage === "finish";
  const isModelSwitchActive = visualStage === "models" && modelSwitchFeedback.phase !== "idle";
  const isChatGptAuthSurface = visualStage === "models" && Boolean(chatGptBrowserAuth);
  const activeWizardStage: WizardStage = visualStage === "finish" ? stage : visualStage;
  const stageRun = activeWizardStage === "system" ? systemRun : modelRun;
  const stageStatusCopy =
    stageRun.statusMessage ||
    stageRun.resultMessage ||
    resolveStageDescription(activeWizardStage, systemActionDescription, selectedModelLabel);
  const phaseLabel =
    activeWizardStage === "system"
      ? onboardingSystemReady
        ? "ready"
        : systemSetupRequired
          ? "waiting"
          : resolveSystemPhaseLabel(systemPhase, snapshot)
      : resolveModelPhaseLabel(modelPhase, snapshot);
  const showDetails =
    stageRun.runState !== "idle" ||
    Boolean(stageRun.manualCommand) ||
    stageRun.log.trim().length > 0 ||
    (activeWizardStage === "models" && discoveredModels.length > 0);

  const effectiveSystemActionLabel = !onboardingSystemReady
    ? resolveSystemStepActionLabel(systemSteps, systemActionLabel)
    : systemActionLabel;
  const primaryAction = resolvePrimaryAction({
    stage: activeWizardStage,
    systemReady: onboardingSystemReady,
    modelReady: activeWizardStage === "system" ? onboardingAiReady : onboardingModelReady,
    systemActionLabel: effectiveSystemActionLabel,
    selectedModelId,
    defaultModelId
  });
  const isPrimaryActionResolving =
    visualStage === "system" &&
    !onboardingSystemReady &&
    (cliInstalled == null || (gatewayReachable == null && gatewayRegistered == null));
  const resumeModelSetup = resumeSiwc && selectedVisualStage !== "system" && snapshot.diagnostics.installed &&
    !systemSetupRequired && (systemRun.runState === "idle" || systemRun.runState === "success");
  const showSiwc = !showLegacySetup && Boolean(onStartSiwc && onEnterAfterSiwc) && (
    resumeModelSetup || (onboardingSystemReady && visualStage === "models" && !isChatGptAuthSurface && !isModelSwitchActive)
  );
  const needsOwnerAccount = instanceStatus?.protectionEnabled === false &&
    portalRoot !== null && !isTauriDesktopRuntime() &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const showOwner = showSiwc && needsOwnerAccount;
  const activeStepNumber = showOwner ? 2 : visualStage === "finish" ? 4 : visualStage === "models" ? 3 : 1;

  const goBackToSystem = () => {
    setSelectedVisualStage("system");
    onBackToSystem();
  };

  useEffect(() => {
    stepContent.current?.focus({ preventScroll: true });
  }, [activeStepNumber, portalRoot]);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setPortalRoot(document.body);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  if (!portalRoot) {
    return null;
  }

  return createPortal(
    <OnboardingDialog
      data-theme={surfaceTheme}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      className={cn(
        "workforce-setup openclaw-onboarding-backdrop fixed inset-0 z-[1000] pointer-events-auto isolate flex h-dvh w-screen max-w-full items-center justify-center overflow-hidden p-0 sm:px-6 sm:py-4",
        surfaceTheme === "light"
          ? "openclaw-onboarding-backdrop--light bg-[radial-gradient(circle_at_50%_4%,rgba(255,255,255,0.98),rgba(255,250,247,0.94)_34%,rgba(250,243,239,0.96)_72%)]"
          : "openclaw-onboarding-backdrop--dark bg-[radial-gradient(circle_at_50%_0%,rgba(38,10,18,0.46),rgba(6,8,13,0.96)_42%,rgba(2,4,8,0.98))]"
      )}
    >
      <div
        aria-hidden="true"
        data-tauri-drag-region="deep"
        className="pointer-events-auto absolute inset-x-0 top-0 z-[1] h-16"
      />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className={cn(
          "workforce-setup-card relative z-10 flex h-dvh w-full min-h-0 max-h-dvh max-w-none flex-col overflow-hidden rounded-none border-0 sm:h-auto sm:max-h-[calc(100dvh-32px)] sm:rounded-[18px] sm:border sm:backdrop-blur-2xl",
          "sm:max-w-[720px]",
          surfaceTheme === "light"
            ? "bg-card text-foreground shadow-none sm:border-border/80 sm:bg-card/92 sm:shadow-[0_24px_70px_rgba(15,23,42,0.14)]"
            : "bg-background text-foreground shadow-none sm:border-primary/18 sm:bg-[hsl(var(--card)/0.88)] sm:shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_28px_90px_rgba(0,0,0,0.48)]"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            data-tauri-drag-region="deep"
            className="agentos-titlebar-surface relative px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6 lg:px-10"
          >
            <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 sm:right-8 sm:top-6 lg:right-10">
              <OnboardingThemeSwitch surfaceTheme={surfaceTheme} onToggleTheme={onToggleTheme} />
            </div>
            <div className="flex justify-center">
              <div className="flex min-w-0 flex-col items-center text-center">
                <div className="flex items-center justify-center gap-2.5 sm:gap-3">
                  <AgentOSMark still={Boolean(reduceMotion)} />
                  <div className="min-w-0">
                    <span className="block text-[19px] font-bold tracking-[-0.02em] sm:text-[21px]">
                      Agent<span className="text-primary">OS</span>
                    </span>
                  </div>
                </div>
                <p className={cn("mt-1.5 min-h-4 text-[12px] leading-4 text-muted-foreground max-sm:invisible sm:mt-2 sm:min-h-5 sm:text-[13px] sm:leading-5", (isModelSwitchActive || isChatGptAuthSurface) && "hidden")}>
                  Set up AgentOS
                </p>
              </div>
            </div>

            <div className="px-4 pt-4 sm:px-8">
              <OnboardingProgress current={renderLaunchpad && !hasWorkspaceSetup ? 2 : 1} />
            </div>
          </div>

          <div
            ref={stepContent}
            tabIndex={-1}
            role="region"
            aria-label={["OpenClaw setup", "AgentOS security", "Connect AI", "Finish setup"][activeStepNumber - 1]}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-5 pt-4 outline-none sm:px-8 sm:pt-6 lg:px-12 [-webkit-overflow-scrolling:touch]",
              showSiwc ? "pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-9"
                : isChatGptAuthSurface ? "sm:pb-8" : "sm:pb-24",
              !showSiwc && isModelSwitchActive && "!overflow-y-hidden"
            )}
          >
            {showOwner ? (
              <div className="mx-auto w-full max-w-[560px]">
                <div className="mb-6">
                  <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                    <LockKeyhole aria-hidden className="size-6" />
                  </div>
                  <h2 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">Secure your AgentOS</h2>
                  <p className="mt-2 max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
                    Create the owner account you’ll use to sign in and manage this AgentOS installation.
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-background/50 p-4 sm:p-6">
                  <OnboardingOwnerForm onBack={goBackToSystem} />
                </div>
              </div>
            ) : showSiwc && onStartSiwc && onEnterAfterSiwc ? (
              <SiwcWelcome
                systemReady={onboardingSystemReady}
                onPrepare={onRunSystemSetup}
                onStart={onStartSiwc}
                onAlternative={() => {
                  onLeaveSiwc?.();
                  setShowLegacySetup(true);
                  setSelectedVisualStage("models");
                  setAdvancedProviderFlowOpen(true);
                }}
                onEnter={onEnterAfterSiwc}
                onCreateWorkspace={onCreateFirstWorkspace}
                onBack={goBackToSystem}
              />
            ) : renderLaunchpad ? (
              <LaunchpadStage
                surfaceTheme={surfaceTheme}
                workspaceCount={workspaceCount}
                agentCount={agentCount}
                workspaceSetupReady={hasWorkspaceSetup}
                operationalReady={operationalReady}
                canEnterAgentOS={canEnterAgentOS}
                runtimeSmokeStatus={snapshot.diagnostics.runtime.smokeTest.status}
                runtimeSmokeDetail={snapshot.diagnostics.runtime.smokeTest.error || snapshot.diagnostics.runtime.smokeTest.summary}
                defaultModelLabel={defaultModelLabel}
                createProgress={launchpadCreateProgress}
                createRunState={launchpadCreateRunState}
              />
            ) : visualStage === "system" ? (
              <SetupSystemStage
                steps={systemSteps}
                surfaceTheme={surfaceTheme}
                run={stageRun}
                checking={Boolean(systemStatusChecking)}
                ready={onboardingSystemReady}
                gatewayAuthNeedsSetup={gatewayAuthNeedsSetup}
                statusCopy={stageStatusCopy}
                phaseLabel={phaseLabel}
                onOpenGatewayAuthSettings={onOpenGatewayAuthSettings}
              />
            ) : (
              <ModelStage
                snapshot={snapshot}
                surfaceTheme={surfaceTheme}
                statusCopy={stageStatusCopy}
                showDetails={showDetails}
                phaseLabel={phaseLabel}
                run={stageRun}
                modelPhase={modelPhase}
                selectedAgentId={selectedAgentId}
                selectedModelId={selectedModelId}
                selectedThinking={selectedThinking}
                modelSwitchFeedback={modelSwitchFeedback}
                localModelStatus={localModelStatus}
                onSelectedModelIdChange={onSelectedModelIdChange}
                onSelectedThinkingChange={onSelectedThinkingChange}
                onClearModelSwitchFeedback={onClearModelSwitchFeedback}
                onOpenAddModels={onOpenAddModels}
                onSnapshotChange={onSnapshotChange}
                advancedProviderFlowOpen={advancedProviderFlowOpen}
                onAdvancedProviderFlowOpenChange={setAdvancedProviderFlowOpen}
                onConnectChatGPT={onConnectChatGPT}
                chatGptBrowserAuth={chatGptBrowserAuth}
                onSubmitChatGptRedirect={onSubmitChatGptRedirect}
                onContinueFromAi={(thinking) => {
                  setSelectedVisualStage("finish");
                  onContinueFromAi(thinking);
                }}
                onRunModelSetDefault={onRunModelSetDefault}
              />
            )}
          </div>

          <div
            className={cn(
              "mt-auto shrink-0 flex flex-col gap-3 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-8 sm:py-4 lg:px-10",
              surfaceTheme === "light" ? "border-border/70 bg-white/36" : "border-white/8 bg-black/10",
              isModelSwitchActive && "!hidden",
              (showSiwc || isChatGptAuthSurface) && "!hidden"
            )}
          >
            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:justify-end sm:gap-3">
              {renderLaunchpad ? (
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.12em]",
                    surfaceTheme === "light"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                  )}
                >
                  {hasWorkspaces
                    ? hasWorkspaceSetup
                      ? "Setup complete"
                      : launchpadCreateRunState === "error"
                        ? "Needs attention"
                        : "Syncing agent"
                    : launchpadCreateRunState === "running"
                      ? "Building workspace"
                      : launchpadCreateRunState === "error"
                        ? "Needs attention"
                        : "Ready"}
                </span>
              ) : visualStage === "models" && advancedProviderFlowOpen ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedVisualStage("system");
                    onBackToSystem();
                  }}
                  disabled={stageRun.runState === "running"}
                  className={cn("h-10 rounded-full px-4 text-[13px]", ghostActionClassName(surfaceTheme))}
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back
                </Button>
              ) : null}
              {renderLaunchpad ? (
                <>
                  {hasWorkspaceSetup ? (
                    <Button
                      type="button"
                      onClick={onEnterAgentOS}
                      disabled={!canEnterAgentOS}
                      title={canEnterAgentOS ? "Open AgentOS." : "Finish system, model, and workspace setup before entering AgentOS."}
                      className={cn(
                        "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98] max-sm:min-w-0 max-sm:flex-1",
                        surfaceTheme === "light"
                          ? "bg-primary text-primary-foreground shadow-[0_14px_30px_hsl(var(--primary)/0.24)] hover:bg-primary/90"
                          : "bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)/0.28)] hover:bg-primary/90"
                      )}
                    >
                      Enter AgentOS
                      <ArrowRight className="ml-1.5 h-3 w-3" />
                    </Button>
                  ) : isLaunchpadBuilding ? (
                    <span
                      className={cn(
                        "inline-flex h-11 items-center gap-2 rounded-full border px-5 text-[11px] uppercase tracking-[0.12em]",
                        surfaceTheme === "light"
                          ? "border-[#d8c0b0] bg-white/85 text-[#8d725f]"
                          : "border-white/10 bg-white/[0.06] text-slate-300"
                      )}
                    >
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                      Building workspace
                    </span>
                  ) : (
                    <Button
                      type="button"
                      onClick={launchpadCreateRunState === "error" ? onCreateWorkspace : onCreateFirstWorkspace ?? onCreateWorkspace}
                      className={cn(
                        "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98] max-sm:min-w-0 max-sm:flex-1",
                        surfaceTheme === "light"
                          ? "bg-primary text-primary-foreground shadow-[0_14px_30px_hsl(var(--primary)/0.24)] hover:bg-primary/90"
                          : "bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)/0.28)] hover:bg-primary/90"
                      )}
                    >
                      {launchpadCreateRunState === "error" ? "Retry setup" : "Create Workspace"}
                      <ArrowRight className="ml-1.5 h-3 w-3" />
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {visualStage === "models" && advancedProviderFlowOpen && !onboardingModelReady ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onSkipSetup}
                      className={cn("h-10 rounded-full px-4 text-[13px]", secondaryActionClassName(surfaceTheme))}
                    >
                      Skip for now
                    </Button>
                  ) : null}

                  {visualStage === "system" && !onboardingSystemReady ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onSkipSetup}
                      disabled={stageRun.runState === "running"}
                      title="Skip setup and enter AgentOS with degraded OpenClaw readiness."
                      className={cn("h-10 rounded-full px-4 text-[13px]", ghostActionClassName(surfaceTheme))}
                    >
                      Skip for now
                    </Button>
                  ) : null}

                  {visualStage === "models" && !advancedProviderFlowOpen ? null : <Button
                    type="button"
                    onClick={() => {
                      if (visualStage === "system") {
                        if (primaryAction.kind === "dismiss") {
                          onEnterAgentOS();
                          return;
                        }

                        if (onboardingSystemReady) {
                          setSelectedVisualStage("models");
                          onContinueToModels();
                          return;
                        }

                        onRunSystemSetup();
                        return;
                      }

                      if (primaryAction.kind === "dismiss") {
                        onEnterAgentOS();
                        return;
                      }

                      if (primaryAction.kind === "set-default") {
                        onRunModelSetDefault(selectedModelId || undefined);
                        return;
                      }

                      return;
                    }}
                    disabled={
                      stageRun.runState === "running" ||
                      isPrimaryActionResolving ||
                      primaryAction.kind === "select-model"
                    }
                    className={cn(
                      "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98] max-sm:min-w-0 max-sm:flex-1",
                      surfaceTheme === "light"
                        ? "bg-primary text-primary-foreground shadow-[0_14px_30px_hsl(var(--primary)/0.24)] hover:bg-primary/90"
                        : "bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)/0.28)] hover:bg-primary/90"
                    )}
                  >
                    {stageRun.runState === "running" || isPrimaryActionResolving ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                        {stageRun.runState === "running" ? "Working..." : "Checking..."}
                      </>
                    ) : (
                      <>
                        {visualStage === "system" && primaryAction.kind === "continue" && needsOwnerAccount && !showLegacySetup
                          ? "Continue to security" : primaryAction.label}
                        <ArrowRight className="ml-1.5 h-3 w-3" />
                      </>
                    )}
                  </Button>}
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </OnboardingDialog>,
    portalRoot
  );
}

function OnboardingDialog({ children, ...surface }: Omit<ComponentProps<typeof motion.div>, "children"> & { children: ReactNode }) {
  return (
    <Dialog open>
      <DialogPrimitive.Content
        asChild
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <motion.div {...surface}>
          <DialogTitle className="sr-only">Set up AgentOS</DialogTitle>
          {children}
        </motion.div>
      </DialogPrimitive.Content>
    </Dialog>
  );
}

function AgentOSMark({ still }: { still: boolean }) {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[9px]" aria-hidden="true">
      {still
        ? <Image src="/assets/logo.webp" alt="" width={32} height={32} />
        : (
          <video autoPlay loop muted playsInline preload="auto" poster="/assets/logo.webp" className="h-full w-full scale-[1.12] object-cover">
            <source src="/assets/logo.webm" type="video/webm" />
          </video>
        )}
    </span>
  );
}

function OnboardingThemeSwitch({
  surfaceTheme,
  onToggleTheme
}: {
  surfaceTheme: SurfaceTheme;
  onToggleTheme: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      aria-checked={surfaceTheme === "light"}
      onClick={onToggleTheme}
      className={cn(
        "relative inline-flex h-7 w-14 items-center rounded-full border transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
        surfaceTheme === "light"
          ? "border-[#d0bcae] bg-[#eaded3] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e3d5c8] hover:border-[#c8b09f] active:bg-[#d9c8ba]"
          : "border-white/12 bg-white/[0.08] hover:bg-white/[0.12] hover:border-white/16 active:bg-white/[0.16]"
      )}
    >
      <span
        className={cn(
          "absolute left-1 inline-flex h-5 w-5 items-center justify-center rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.18)] transition-[transform,background-color,color] duration-150",
          surfaceTheme === "light" ? "translate-x-7 bg-[#c8946f] text-white" : "translate-x-0 bg-cyan-300 text-slate-950"
        )}
      >
        {surfaceTheme === "light" ? <SunMedium className="h-3 w-3" /> : <MoonStar className="h-3 w-3" />}
      </span>
    </button>
  );
}

function SetupSystemStage({
  steps,
  surfaceTheme,
  run,
  checking,
  ready,
  gatewayAuthNeedsSetup,
  statusCopy,
  phaseLabel,
  onOpenGatewayAuthSettings
}: {
  steps: Array<{ id: string; label: string; description: string; state: StepState }>;
  surfaceTheme: SurfaceTheme;
  run: StageRunDetails;
  checking: boolean;
  ready: boolean;
  gatewayAuthNeedsSetup: boolean;
  statusCopy: string;
  phaseLabel: string;
  onOpenGatewayAuthSettings: () => void;
}) {
  const activeStep = steps.find((step) => step.state === "current");
  const isRuntimeVerification = activeStep?.id === "runtime";
  const isSetupRunning = run.runState === "running";

  return (
    <div className="mx-auto max-w-[720px]">
      <PikoLoader
        open={isSetupRunning}
        title={isRuntimeVerification ? "Verifying OpenClaw runtime" : "Setting up OpenClaw"}
        description={
          isRuntimeVerification
            ? "Checking that AgentOS can connect to OpenClaw."
            : "AgentOS is preparing OpenClaw on this computer."
        }
      />
      <h2 className="text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
        {checking ? "Checking your setup" : ready ? "OpenClaw is ready" : "Set up OpenClaw"}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
        {checking ? "AgentOS is checking for OpenClaw on this computer."
          : ready ? "Continue to connect the AI that will power your agents."
            : "AgentOS uses OpenClaw to run agents. Continue to prepare it on this computer."}
      </p>

      {run.runState === "error" || gatewayAuthNeedsSetup ? (
        <div
          className={cn(
            "mt-3 rounded-[12px] border px-3 py-2.5",
            surfaceTheme === "light"
              ? "border-destructive/25 bg-destructive/5 text-destructive"
              : "border-destructive/30 bg-destructive/10 text-red-100"
          )}
        >
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-[12px] font-semibold">
                {gatewayAuthNeedsSetup ? "AgentOS needs permission to connect" : "System setup needs attention"}
              </p>
              <p role="alert" className="mt-1 text-[11px] leading-4 text-current/80">
                {gatewayAuthNeedsSetup
                  ? "Open connection settings to authorize AgentOS with your local OpenClaw installation."
                  : statusCopy}
              </p>
              {gatewayAuthNeedsSetup ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onOpenGatewayAuthSettings}
                  className="mt-2 h-7 rounded-full px-2.5 text-[11px]"
                >
                  Configure Gateway auth
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <details open={run.runState === "error" || Boolean(run.manualCommand) || undefined} className="mt-5 rounded-xl border border-border/70 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          Setup details
        </summary>
        <div className="mt-3 space-y-2">
          {steps.map((step, index) => (
            <SetupTaskRow key={step.id} index={index} step={step} runState={run.runState} surfaceTheme={surfaceTheme} />
          ))}
          <SetupRunDetailsPanel surfaceTheme={surfaceTheme} statusCopy={statusCopy} phaseLabel={phaseLabel} run={run} />
          <SetupStatusPanel surfaceTheme={surfaceTheme} />
        </div>
      </details>
    </div>
  );
}

function SetupRunDetailsPanel({
  surfaceTheme,
  statusCopy,
  phaseLabel,
  run
}: {
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  phaseLabel: string;
  run: StageRunDetails;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const canOpenTerminal = isOpenClawTerminalCommand(run.manualCommand);
  const displayStatus = run.statusMessage || run.resultMessage || statusCopy;

  const copyCommand = async () => {
    if (!run.manualCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(run.manualCommand);
      toast.success("Command copied.", {
        description: "Open Terminal and paste it."
      });
    } catch (error) {
      toast.error("Could not copy command.", {
        description: error instanceof Error ? error.message : "Clipboard access is unavailable."
      });
    }
  };

  const openTerminal = async () => {
    if (!run.manualCommand || !canOpenTerminal) {
      return;
    }

    setIsOpeningTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: run.manualCommand
        })
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Finish auth there, then refresh."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  };

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-[12px] border shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
        surfaceTheme === "light"
          ? "border-slate-200 bg-white"
          : "border-slate-700/80 bg-slate-950 shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
      )}
    >
      <button
        type="button"
        onClick={() => setDetailsOpen((value) => !value)}
        aria-expanded={detailsOpen}
        aria-controls="onboarding-setup-log-details"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <p className="shrink-0 text-[12px] font-semibold">Setup log</p>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]",
              run.runState === "running"
                ? "bg-primary/10 text-primary"
                : run.runState === "error"
                  ? "bg-destructive/10 text-destructive"
                  : run.runState === "success"
                    ? surfaceTheme === "light"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-emerald-300/10 text-emerald-200"
                    : "bg-muted text-muted-foreground"
            )}
          >
            {run.runState === "running" ? <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" /> : null}
            {phaseLabel}
          </span>
          <p className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground">{displayStatus}</p>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            detailsOpen && "rotate-180"
          )}
        />
      </button>

      {detailsOpen ? (
        <div
          id="onboarding-setup-log-details"
          className={cn("border-t px-3 py-2.5", surfaceTheme === "light" ? "border-border/70" : "border-white/8")}
        >
          <pre
            className={cn(
              "max-h-[92px] min-h-[46px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border px-2.5 py-1.5 font-mono text-[9px] leading-3",
              surfaceTheme === "light"
                ? "border-slate-200 bg-slate-50 text-foreground"
                : "border-slate-700/80 bg-black text-slate-200"
            )}
          >
            {run.log || "No output yet.\n\nStart setup to stream OpenClaw logs here."}
          </pre>

          {run.manualCommand ? (
            <div
              className={cn(
                "mt-2 rounded-[8px] border px-2.5 py-2",
                surfaceTheme === "light"
                  ? "border-border/70 bg-muted/25"
                  : "border-white/8 bg-black/15"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {canOpenTerminal ? "Terminal command" : "Manual command"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={copyCommand}
                    className="h-6 rounded-full px-2 text-[10px]"
                  >
                    <Copy className="mr-1.5 h-3 w-3" />
                    Copy
                  </Button>
                  {canOpenTerminal ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={openTerminal}
                      disabled={isOpeningTerminal}
                    className="h-6 rounded-full px-2 text-[10px]"
                    >
                      {isOpeningTerminal ? (
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <SquareTerminal className="mr-1.5 h-3 w-3" />
                      )}
                      {isOpeningTerminal ? "Opening" : "Open"}
                    </Button>
                  ) : null}
                </div>
              </div>
              <code className="mt-1.5 block max-h-[56px] overflow-auto break-all font-mono text-[9px] leading-3 text-muted-foreground">
                {run.manualCommand}
              </code>
            </div>
          ) : null}

          {run.docsUrl ? (
            <a
              href={run.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Setup docs
              <ArrowRight className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SetupTaskRow({
  index,
  step,
  runState,
  surfaceTheme
}: {
  index: number;
  step: { id: string; label: string; description: string; state: StepState };
  runState: StageRunDetails["runState"];
  surfaceTheme: SurfaceTheme;
}) {
  const isActive = step.state === "current";
  const isRunning = isActive && runState === "running";
  const isError = isActive && runState === "error";
  const label = resolveTaskStatusLabel(step.state, runState);

  return (
    <motion.div
      layout
      className={cn(
        "relative flex min-h-[58px] items-center gap-3 overflow-hidden rounded-[12px] border px-4 py-3",
        surfaceTheme === "light"
          ? "border-slate-200 bg-white shadow-[0_8px_20px_rgba(15,23,42,0.05)]"
          : "border-slate-700/80 bg-slate-950 shadow-[0_10px_24px_rgba(0,0,0,0.2)]",
        isActive && "border-primary/24"
      )}
    >
      {isRunning ? (
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          animate={{ x: ["-100%", "330%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />
      ) : null}
      <span
        className={cn(
          "relative z-[1] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
          step.state === "complete"
            ? surfaceTheme === "light"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
            : isError
              ? "border-destructive/35 bg-destructive/10 text-destructive"
              : isActive
                ? "border-primary/35 bg-primary/8 text-primary"
                : "border-border bg-card text-muted-foreground"
        )}
      >
        {step.state === "complete" ? (
          <Check className="h-3.5 w-3.5" />
        ) : isRunning ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          index + 1
        )}
      </span>
      <div className="relative z-[1] min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold leading-5 tracking-[-0.01em]">{step.label}</p>
      </div>
      <span
        className={cn(
          "relative z-[1] inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
          isRunning
            ? "bg-primary/10 text-primary"
            : step.state === "complete"
              ? surfaceTheme === "light"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-emerald-300/10 text-emerald-200"
              : isError
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
        )}
      >
        {isRunning ? <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" /> : null}
        {label}
      </span>
    </motion.div>
  );
}

function resolveTaskStatusLabel(state: StepState, runState: StageRunDetails["runState"]) {
  if (runState === "error" && state === "current") {
    return "Error";
  }

  if (state === "complete") {
    return "Ready";
  }

  if (state === "current") {
    return runState === "running" ? "Checking" : "Pending";
  }

  return "Pending";
}

function SetupStatusPanel({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  return (
    <div
      className={cn(
        "mt-3 rounded-[12px] border px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.06)]",
        surfaceTheme === "light"
          ? "border-primary/20 bg-[#f8f5ff]"
          : "border-primary/25 bg-slate-900 shadow-[0_12px_28px_rgba(0,0,0,0.24)]"
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">
            OpenClaw setup target: <span className="font-semibold text-primary">v{OPENCLAW_INSTALL_TARGET_VERSION}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
