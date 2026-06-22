"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Info, LoaderCircle, SquareTerminal, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  isOpenClawMissionReady,
  isOpenClawOnboardingModelReady,
  isOpenClawOnboardingSystemReady
} from "@/lib/openclaw/readiness";
import type {
  DiscoveredModelCandidate,
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase,
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
  resolveSystemPhaseLabel,
  type StageRunDetails,
  type SurfaceTheme,
  type StepState,
  type WizardStage
} from "@/components/mission-control/openclaw-onboarding.utils";
import { hasAgentOSWorkspaceSetup } from "@/components/mission-control/mission-control-shell.utils";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import {
  LaunchpadStage,
  ModelStage,
  type ModelSwitchFeedback
} from "@/components/mission-control/openclaw-onboarding.stages";

export function OpenClawOnboarding({
  snapshot,
  surfaceTheme,
  stage,
  systemReady,
  modelReady,
  systemSetupRequired,
  showReadyState,
  systemActionLabel,
  systemActionDescription,
  systemPhase,
  modelPhase,
  systemRun,
  modelRun,
  modelSwitchFeedback,
  selectedModelId,
  discoveredModels,
  onSelectedModelIdChange,
  onClearModelSwitchFeedback,
  onSnapshotChange,
  onRunSystemSetup,
  onRunModelSetDefault,
  onOpenAddModels,
  onOpenGatewayAuthSettings,
  onCreateWorkspace,
  onEnterAgentOS,
  onContinueToModels,
  onBackToSystem,
  onSelectStage,
  launchpadCreateProgress,
  launchpadCreateRunState
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  stage: WizardStage;
  systemReady?: boolean;
  modelReady?: boolean;
  systemSetupRequired?: boolean;
  showReadyState: boolean;
  systemActionLabel: string;
  systemActionDescription: string;
  systemPhase: OpenClawOnboardingPhase | null;
  modelPhase: OpenClawModelOnboardingPhase | null;
  systemRun: StageRunDetails;
  modelRun: StageRunDetails;
  modelSwitchFeedback: ModelSwitchFeedback;
  selectedModelId: string;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onClearModelSwitchFeedback: () => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRunSystemSetup: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onOpenGatewayAuthSettings: () => void;
  onCreateWorkspace: () => void;
  onEnterAgentOS: () => void;
  onContinueToModels: () => void;
  onBackToSystem: () => void;
  onSelectStage: (stage: WizardStage) => void;
  launchpadCreateProgress: OperationProgressSnapshot | null;
  launchpadCreateRunState: "idle" | "running" | "success" | "error";
}) {
  const onboardingSystemReady =
    systemReady ?? (systemRun.runState === "success" || isOpenClawOnboardingSystemReady(snapshot));
  const hasWorkspaceSetup = hasAgentOSWorkspaceSetup(snapshot);
  const operationalReady = isOpenClawMissionReady(snapshot);
  const onboardingModelReady =
    modelReady ??
    (
      modelSwitchFeedback.phase === "success" ||
      showReadyState ||
      isOpenClawOnboardingModelReady(snapshot)
    );
  const canEnterAgentOS = hasWorkspaceSetup && onboardingSystemReady && onboardingModelReady;
  const showLaunchpad = onboardingModelReady && (
    showReadyState ||
    !hasWorkspaceSetup ||
    launchpadCreateRunState === "running" ||
    launchpadCreateRunState === "success" ||
    launchpadCreateRunState === "error"
  );
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
  const systemPhaseForSteps = onboardingSystemReady ? "ready" : systemPhase;
  const systemSteps = buildSystemSteps(snapshot, systemPhaseForSteps, {
    forcePending: systemSetupRequired
  });
  const availableModels = snapshot.models.filter((model) => model.available !== false && !model.missing);
  const selectedModelLabel =
    availableModels.find((model) => model.id === selectedModelId)?.name || selectedModelId || null;
  const stageRun = stage === "system" ? systemRun : modelRun;
  const stageStatusCopy =
    stageRun.statusMessage ||
    stageRun.resultMessage ||
    resolveStageDescription(stage, systemActionDescription, selectedModelLabel);
  const phaseLabel =
    stage === "system"
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
    (stage === "models" && discoveredModels.length > 0);
  const gatewayAuthNeedsSetup = snapshot.diagnostics.issues.some((issue) =>
    /gateway\..*auth|redacted secret|AGENTOS_OPENCLAW_GATEWAY_TOKEN|OPENCLAW_GATEWAY_TOKEN/i.test(issue)
  );
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  const primaryAction = resolvePrimaryAction({
    stage,
    systemReady: onboardingSystemReady,
    modelReady: onboardingModelReady,
    systemActionLabel,
    selectedModelId,
    defaultModelId
  });
  const completedProgressUnits =
    systemSteps.filter((step) => step.state === "complete").length +
    (onboardingModelReady ? 1 : 0) +
    (hasWorkspaceSetup || showReadyState ? 1 : 0);
  const progressPercent = Math.max(0, Math.min(100, Math.round((completedProgressUnits / 5) * 100)));
  const visualStep = showLaunchpad ? "finish" : stage;
  const activeStepNumber = visualStep === "finish" ? 3 : visualStep === "models" ? 2 : 1;

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
    <motion.div
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      className={cn(
        "openclaw-onboarding-backdrop fixed inset-0 z-[1000] pointer-events-auto isolate flex h-dvh w-screen max-w-full items-center justify-center overflow-hidden px-4 py-3 sm:px-6 sm:py-4",
        surfaceTheme === "light"
          ? "openclaw-onboarding-backdrop--light bg-[radial-gradient(circle_at_50%_4%,rgba(255,255,255,0.98),rgba(255,250,247,0.94)_34%,rgba(250,243,239,0.96)_72%)]"
          : "openclaw-onboarding-backdrop--dark bg-[radial-gradient(circle_at_50%_0%,rgba(38,10,18,0.46),rgba(6,8,13,0.96)_42%,rgba(2,4,8,0.98))]"
      )}
    >
      <SetupBackground surfaceTheme={surfaceTheme} />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.885 }}
        animate={{ opacity: 1, y: 0, scale: 0.9 }}
        className={cn(
          "relative z-10 flex w-full min-h-0 max-h-[calc(100dvh-24px)] max-w-[980px] flex-col overflow-hidden rounded-[18px] border backdrop-blur-2xl sm:max-h-[calc(100dvh-32px)]",
          surfaceTheme === "light"
            ? "border-border/80 bg-card/92 text-foreground shadow-[0_24px_70px_rgba(15,23,42,0.14)]"
            : "border-primary/18 bg-[hsl(var(--card)/0.88)] text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_28px_90px_rgba(0,0,0,0.48)]"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-5 sm:px-8 sm:pt-6 lg:px-10">
            <div className="flex justify-center">
              <div className="flex min-w-0 flex-col items-center text-center">
                <div className="flex items-center justify-center gap-4">
                  <AgentOSMark />
                  <div className="min-w-0">
                    <span className="block text-[23px] font-bold tracking-[-0.02em]">
                      Agent<span className="text-primary">OS</span>
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                  Connect your local OpenClaw and prepare your environment.
                </p>
              </div>
            </div>

            <SetupStepper
              activeStep={activeStepNumber}
              systemReady={onboardingSystemReady}
              modelReady={onboardingModelReady}
              finishReady={hasWorkspaceSetup || showReadyState}
              surfaceTheme={surfaceTheme}
              onSelectStage={onSelectStage}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-24 pt-6 sm:px-8 lg:px-12 [-webkit-overflow-scrolling:touch]">
            {showLaunchpad ? (
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
            ) : stage === "system" ? (
              <SetupSystemStage
                steps={systemSteps}
                surfaceTheme={surfaceTheme}
                run={stageRun}
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
                selectedModelId={selectedModelId}
                modelSwitchFeedback={modelSwitchFeedback}
                onSelectedModelIdChange={onSelectedModelIdChange}
                onClearModelSwitchFeedback={onClearModelSwitchFeedback}
                onOpenAddModels={onOpenAddModels}
                onSnapshotChange={onSnapshotChange}
              />
            )}
          </div>

          <div
            className={cn(
              "mt-auto shrink-0 flex flex-col gap-4 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10",
              surfaceTheme === "light" ? "border-border/70 bg-white/36" : "border-white/8 bg-black/10"
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span className="shrink-0 text-[13px] text-muted-foreground">Overall progress</span>
              <div className="h-1.5 w-full max-w-[190px] overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={false}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
              </div>
              <span className="text-[13px] font-semibold text-primary">{progressPercent}%</span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {showLaunchpad ? (
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
              ) : stage === "models" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onBackToSystem}
                  disabled={stageRun.runState === "running"}
                  className={cn("h-10 rounded-full px-4 text-[13px]", ghostActionClassName(surfaceTheme))}
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Back
                </Button>
              ) : null}
              {showLaunchpad ? (
                <>
                  {hasWorkspaceSetup ? (
                    <Button
                      type="button"
                      onClick={onEnterAgentOS}
                      disabled={!canEnterAgentOS}
                      title={canEnterAgentOS ? "Open AgentOS." : "Finish system, model, and workspace setup before entering AgentOS."}
                      className={cn(
                        "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98]",
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
                      onClick={onCreateWorkspace}
                      className={cn(
                        "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98]",
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
                  {stage === "models" && !onboardingModelReady ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenAddModels()}
                      className={cn("h-10 rounded-full px-4 text-[13px]", secondaryActionClassName(surfaceTheme))}
                    >
                      Open full Add Models
                    </Button>
                  ) : null}

                  {stage === "system" && !onboardingSystemReady ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onEnterAgentOS}
                      disabled={stageRun.runState === "running"}
                      title="Skip setup and enter AgentOS with degraded OpenClaw readiness."
                      className={cn("h-10 rounded-full px-4 text-[13px]", ghostActionClassName(surfaceTheme))}
                    >
                      Skip for now
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    onClick={() => {
                      if (stage === "system") {
                        if (primaryAction.kind === "dismiss") {
                          onEnterAgentOS();
                          return;
                        }

                        if (onboardingSystemReady) {
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
                    disabled={stageRun.runState === "running" || primaryAction.kind === "select-model"}
                    className={cn(
                      "h-11 min-w-[190px] rounded-full px-5 text-[14px] transition-transform active:scale-[0.98]",
                      surfaceTheme === "light"
                        ? "bg-primary text-primary-foreground shadow-[0_14px_30px_hsl(var(--primary)/0.24)] hover:bg-primary/90"
                        : "bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)/0.28)] hover:bg-primary/90"
                    )}
                  >
                    {stageRun.runState === "running" ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                        Working...
                      </>
                    ) : (
                      <>
                        {primaryAction.label}
                        <ArrowRight className="ml-1.5 h-3 w-3" />
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    portalRoot
  );
}

function SetupBackground({ surfaceTheme }: { surfaceTheme: SurfaceTheme }) {
  const reduceMotion = useReducedMotion();
  const lineTransition = { duration: 9, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const };
  const pulseTransition = { duration: 2.8, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const };

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        surfaceTheme === "light" ? "opacity-95" : "opacity-100"
      )}
    >
      <motion.div
        className={cn(
          "absolute -left-[18%] top-[42%] h-[430px] w-[132%] rounded-[50%] border-t blur-[0.2px]",
          surfaceTheme === "light"
            ? "border-primary/18 shadow-[0_-10px_34px_hsl(var(--primary)/0.10)]"
            : "border-primary/30 shadow-[0_-12px_50px_hsl(var(--primary)/0.24)]"
        )}
        animate={reduceMotion ? undefined : { x: [-28, 34, -28], y: [0, -16, 0], rotate: [-5, -2, -5] }}
        transition={lineTransition}
      />
      <motion.div
        className={cn(
          "absolute -right-[20%] top-[30%] h-[520px] w-[88%] rounded-[50%] border-t blur-[0.2px]",
          surfaceTheme === "light"
            ? "border-primary/16 shadow-[0_-8px_30px_hsl(var(--primary)/0.10)]"
            : "border-primary/28 shadow-[0_-12px_54px_hsl(var(--primary)/0.22)]"
        )}
        animate={reduceMotion ? undefined : { x: [24, -34, 24], y: [-10, 14, -10], rotate: [-19, -14, -19] }}
        transition={{ ...lineTransition, duration: 11 }}
      />
      <motion.div
        className={cn(
          "absolute left-[2%] top-[60%] h-px w-[46%] origin-left rotate-[18deg]",
          "bg-gradient-to-r from-transparent via-primary/70 to-transparent",
          surfaceTheme === "light"
            ? "shadow-[0_0_22px_hsl(var(--primary)/0.22)]"
            : "shadow-[0_0_34px_hsl(var(--primary)/0.48),0_0_80px_hsl(var(--primary)/0.16)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.18, 0.85, 0.18], x: [-70, 90, -70] }}
        transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute right-[4%] top-[72%] h-px w-[38%] origin-right rotate-[-22deg]",
          "bg-gradient-to-r from-transparent via-primary/75 to-transparent",
          surfaceTheme === "light"
            ? "shadow-[0_0_18px_hsl(var(--primary)/0.20)]"
            : "shadow-[0_0_30px_hsl(var(--primary)/0.50),0_0_86px_hsl(var(--primary)/0.18)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.22, 0.92, 0.22], x: [58, -82, 58] }}
        transition={{ duration: 5.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute right-[-6%] top-[48%] h-[2px] w-[60%] origin-right rotate-[-36deg]",
          "bg-gradient-to-r from-transparent via-primary/85 to-primary/10",
          surfaceTheme === "light"
            ? "shadow-[0_0_24px_hsl(var(--primary)/0.26),0_0_70px_hsl(var(--primary)/0.10)]"
            : "shadow-[0_0_38px_hsl(var(--primary)/0.68),0_0_110px_hsl(var(--primary)/0.28)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.24, 0.9, 0.24], x: [90, -70, 90], y: [12, -8, 12] }}
        transition={{ duration: 6.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute left-[-10%] bottom-[18%] h-[2px] w-[58%] origin-left rotate-[32deg]",
          "bg-gradient-to-r from-transparent via-primary/80 to-transparent",
          surfaceTheme === "light"
            ? "shadow-[0_0_22px_hsl(var(--primary)/0.24),0_0_62px_hsl(var(--primary)/0.10)]"
            : "shadow-[0_0_36px_hsl(var(--primary)/0.64),0_0_100px_hsl(var(--primary)/0.26)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.2, 0.82, 0.2], x: [-80, 86, -80], y: [-10, 10, -10] }}
        transition={{ duration: 5.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute right-[3%] top-[38%] h-[48%] w-[32%] rotate-[-22deg] rounded-[40%] blur-3xl",
          surfaceTheme === "light" ? "bg-primary/[0.06]" : "bg-primary/[0.13]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.22, 0.55, 0.22], x: [20, -18, 20], scale: [0.96, 1.06, 0.96] }}
        transition={{ duration: 7.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className={cn(
          "absolute bottom-[14%] left-[16%] h-2 w-2 rounded-full bg-primary",
          surfaceTheme === "light"
            ? "shadow-[0_0_24px_hsl(var(--primary)/0.42),0_0_58px_hsl(var(--primary)/0.12)]"
            : "shadow-[0_0_28px_hsl(var(--primary)/0.75),0_0_90px_hsl(var(--primary)/0.30)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.42, 1, 0.42], scale: [0.82, 1.28, 0.82] }}
        transition={pulseTransition}
      />
      <motion.div
        className={cn(
          "absolute right-[5%] top-[72%] h-2 w-2 rounded-full bg-primary",
          surfaceTheme === "light"
            ? "shadow-[0_0_22px_hsl(var(--primary)/0.36),0_0_54px_hsl(var(--primary)/0.10)]"
            : "shadow-[0_0_30px_hsl(var(--primary)/0.78),0_0_92px_hsl(var(--primary)/0.32)]"
        )}
        animate={reduceMotion ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.75, 1.22, 0.75] }}
        transition={{ ...pulseTransition, duration: 3.4 }}
      />
      <motion.div
        className="absolute inset-x-[12%] top-[28%] h-[220px] rounded-[50%] bg-primary/10 blur-[90px]"
        animate={reduceMotion ? undefined : { opacity: [0.08, 0.22, 0.08], scale: [0.96, 1.05, 0.96] }}
        transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function AgentOSMark() {
  return (
    <span className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px]" aria-hidden="true">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="/assets/logo.webp"
        className="h-full w-full scale-[1.12] object-cover"
      >
        <source src="/assets/logo.webm" type="video/webm" />
      </video>
    </span>
  );
}

function SetupStepper({
  activeStep,
  systemReady,
  modelReady,
  finishReady,
  surfaceTheme,
  onSelectStage
}: {
  activeStep: number;
  systemReady: boolean;
  modelReady: boolean;
  finishReady: boolean;
  surfaceTheme: SurfaceTheme;
  onSelectStage: (stage: WizardStage) => void;
}) {
  const steps = [
    { order: 1, id: "system", label: "System Setup", description: "Configure core services", complete: systemReady },
    { order: 2, id: "models", label: "Model Setup", description: "Choose model & auth", complete: modelReady },
    { order: 3, id: "finish", label: "Finish", description: "You're all set", complete: finishReady }
  ] as const;

  return (
    <div className="mx-auto mt-6 grid max-w-[760px] grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3 max-md:w-full max-md:grid-cols-[1fr_auto_1fr_auto_1fr] max-md:gap-1.5">
      {steps.map((step, index) => {
        const isActive = activeStep === step.order;
        const isComplete = step.complete;
        const content = (
          <div className="flex items-center gap-3 text-left max-md:flex-col max-md:items-center max-md:gap-1 max-md:text-center">
            <span
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[14px] font-semibold transition-colors max-md:h-7 max-md:w-7 max-md:text-[11px]",
                isActive
                  ? "border-primary bg-primary text-primary-foreground shadow-[0_10px_26px_hsl(var(--primary)/0.22)]"
                  : isComplete
                    ? surfaceTheme === "light"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                    : "border-border bg-card text-muted-foreground"
              )}
            >
              {isComplete && !isActive ? <Check className="h-4 w-4 max-md:h-3 max-md:w-3" /> : step.order}
            </span>
            <span className="min-w-0">
              <span className={cn("block text-[13px] font-semibold max-md:text-[10px] max-md:leading-3", isActive ? "text-primary" : "text-foreground")}>
                {step.label}
              </span>
              <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground max-md:text-[8px] max-md:leading-[0.65rem]">{step.description}</span>
            </span>
          </div>
        );

        return (
          <div key={step.id} className="contents">
            {step.id === "finish" ? (
              <div title={modelReady ? "Finish opens after model setup." : "Complete model setup before finishing."}>
                {content}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelectStage(step.id)}
                className="rounded-[12px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-current={isActive ? "step" : undefined}
              >
                {content}
              </button>
            )}
            {index < steps.length - 1 ? (
              <div className="h-px w-[112px] bg-border max-md:w-full max-md:min-w-3">
                <motion.div
                  className="h-full bg-primary max-md:w-full"
                  initial={false}
                  animate={{
                    width: index + 1 < activeStep ? "100%" : index + 1 === activeStep ? "48%" : "0%"
                  }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SetupSystemStage({
  steps,
  surfaceTheme,
  run,
  gatewayAuthNeedsSetup,
  statusCopy,
  phaseLabel,
  onOpenGatewayAuthSettings
}: {
  steps: Array<{ id: string; label: string; description: string; state: StepState }>;
  surfaceTheme: SurfaceTheme;
  run: StageRunDetails;
  gatewayAuthNeedsSetup: boolean;
  statusCopy: string;
  phaseLabel: string;
  onOpenGatewayAuthSettings: () => void;
}) {
  return (
    <div className="mx-auto max-w-[860px]">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em]">System Setup</h2>
      <div className="mt-1 flex items-baseline justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-1">
        <p className="text-[12px] leading-5 text-muted-foreground">
          Install the CLI, start the gateway, and verify RPC.
        </p>
        <p className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-primary max-sm:text-left">
          Step 1 of 3
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {steps.map((step, index) => (
          <SetupTaskRow
            key={step.id}
            index={index}
            step={step}
            runState={run.runState}
            surfaceTheme={surfaceTheme}
          />
        ))}
      </div>

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
                {gatewayAuthNeedsSetup ? "Native Gateway auth needs attention" : "System setup needs attention"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-current/80">
                {gatewayAuthNeedsSetup
                  ? "OpenClaw reports a redacted Gateway secret. Generate a local token in Settings so AgentOS can use native WS instead of CLI fallback."
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

      <SetupRunDetailsPanel
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        phaseLabel={phaseLabel}
        run={run}
      />

      <SetupStatusPanel surfaceTheme={surfaceTheme} />
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
  const hasDetails =
    run.log.trim().length > 0 ||
    Boolean(run.manualCommand) ||
    Boolean(run.statusMessage) ||
    Boolean(run.resultMessage) ||
    run.runState === "running" ||
    run.runState === "error";
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const canOpenTerminal = isOpenClawTerminalCommand(run.manualCommand);
  const displayStatus = run.statusMessage || run.resultMessage || statusCopy;

  useEffect(() => {
    if (hasDetails) {
      setDetailsOpen(true);
    }
  }, [hasDetails]);

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
        "mt-3 overflow-hidden rounded-[12px] border",
        surfaceTheme === "light"
          ? "border-border/80 bg-white/66"
          : "border-white/10 bg-white/[0.035]"
      )}
    >
      <button
        type="button"
        onClick={() => setDetailsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] font-semibold">Setup log</p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em]",
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
          </div>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground max-sm:whitespace-normal">
            {displayStatus}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            detailsOpen && "rotate-180"
          )}
        />
      </button>

      {detailsOpen ? (
        <div className={cn("border-t px-3 py-2.5", surfaceTheme === "light" ? "border-border/70" : "border-white/8")}>
          <pre
            className={cn(
              "max-h-[92px] min-h-[46px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border px-2.5 py-1.5 font-mono text-[9px] leading-3",
              surfaceTheme === "light"
                ? "border-border/70 bg-muted/35 text-foreground"
                : "border-white/8 bg-black/20 text-slate-200"
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
        "relative flex min-h-[50px] items-center gap-3 overflow-hidden rounded-[12px] border px-3 py-2 max-sm:grid max-sm:grid-cols-[30px_minmax(0,1fr)] max-sm:items-start max-sm:gap-x-2.5 max-sm:gap-y-1.5",
        surfaceTheme === "light" ? "border-border/80 bg-white/72" : "border-white/10 bg-white/[0.035]",
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
          "relative z-[1] inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold max-sm:row-span-2",
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
        <p className="text-[13px] font-semibold tracking-[-0.01em]">{step.label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{step.description}</p>
      </div>
      <span
        className={cn(
          "relative z-[1] inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] max-sm:col-start-2 max-sm:w-fit",
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
        "mt-3 rounded-[12px] border px-3 py-2.5",
        surfaceTheme === "light"
          ? "border-primary/18 bg-primary/[0.035]"
          : "border-primary/20 bg-primary/[0.075]"
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-[12px] font-semibold">What happens next?</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            We&apos;ll install the CLI if needed, start the gateway, and verify connectivity.
          </p>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Recommended setup target: <span className="font-semibold text-primary">v{OPENCLAW_RECOMMENDED_VERSION}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
