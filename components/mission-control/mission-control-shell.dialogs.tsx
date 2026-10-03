"use client";

import { AlertTriangle, CheckCircle2, Copy, ExternalLink, LoaderCircle, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { Button } from "@/components/ui/button";
import {
  resolveUpdateDialogDescription,
  resolveUpdateDialogTitle,
} from "@/components/mission-control/mission-control-shell.utils";
import type {
  MissionControlSnapshot,
  OpenClawCapabilityDiffReport,
  OpenClawCertificationScorecardReport,
  WorkItemRecord
} from "@/lib/agentos/contracts";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type TaskAbortState = "idle" | "running" | "error";
type UpdateRunState = "idle" | "running" | "success" | "error" | "unknown";
type UpdateMode = "recommended" | "candidate" | "advanced";

export function MissionControlShellDialogs({
  snapshot,
  surfaceTheme,
  isInspectorOpen,
  taskAbortRequest,
  taskAbortRunState,
  taskAbortMessage,
  onTaskAbortOpenChange,
  onTaskAbortConfirm,
  updateDialogOpen,
  updateRunState,
  updateStatusMessage,
  updateResultMessage,
  updateLog,
  updateManualCommand,
  updateCapabilityDiff,
  updateCertificationScorecard,
  updateTargetVersion,
  updateMode,
  activeRuntimeCount,
  updateInstallSummary,
  onUpdateDialogOpenChange,
  onRunOpenClawUpdate
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  isInspectorOpen: boolean;
  taskAbortRequest: WorkItemRecord | null;
  taskAbortRunState: TaskAbortState;
  taskAbortMessage: string | null;
  onTaskAbortOpenChange: (open: boolean) => void;
  onTaskAbortConfirm: () => void;
  updateDialogOpen: boolean;
  updateRunState: UpdateRunState;
  updateStatusMessage: string | null;
  updateResultMessage: string | null;
  updateLog: string;
  updateManualCommand: string | null;
  updateCapabilityDiff: OpenClawCapabilityDiffReport | null;
  updateCertificationScorecard: OpenClawCertificationScorecardReport | null;
  updateTargetVersion: string | null;
  updateMode: UpdateMode;
  activeRuntimeCount: number;
  updateInstallSummary: OpenClawInstallSummary;
  onUpdateDialogOpenChange: (open: boolean) => void;
  onRunOpenClawUpdate: (action?: "update" | "rollback" | "certify-round-trip") => void;
}) {
  const isUpdateRunning = updateRunState === "running";
  const isUpdateFinished = updateRunState === "success" || updateRunState === "error" || updateRunState === "unknown";
  const updateDialogTitle = resolveUpdateDialogTitle(updateRunState, updateMode);
  const updateDialogDescription = resolveUpdateDialogDescription(updateRunState, updateMode);
  const [isOpeningUpdateTerminal, setIsOpeningUpdateTerminal] = useState(false);
  const [isOpeningControlUi, setIsOpeningControlUi] = useState(false);
  const canOpenUpdateTerminal = isOpenClawTerminalCommand(updateManualCommand);
  const selectedTargetVersion =
    updateTargetVersion ||
    snapshot.diagnostics.updateCompatibility?.recommendedVersion ||
    snapshot.diagnostics.latestVersion ||
    snapshot.diagnostics.version ||
    "unknown";
  const selectedTargetLabel = selectedTargetVersion === "unknown" ? "Not confirmed" : selectedTargetVersion.startsWith("v")
    ? selectedTargetVersion
    : `v${selectedTargetVersion}`;
  const updateModeLabel =
    updateMode === "advanced"
      ? "Advanced verification"
      : updateMode === "candidate"
        ? "Candidate verification"
        : "Certified update";

  const copyUpdateCommand = async () => {
    if (!updateManualCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(updateManualCommand);
      toast.success("Command copied.", {
        description: "Open Terminal and paste it."
      });
    } catch (error) {
      toast.error("Could not copy command.", {
        description: error instanceof Error ? error.message : "Clipboard access is unavailable."
      });
    }
  };

  const openUpdateTerminal = async () => {
    if (!updateManualCommand || !canOpenUpdateTerminal) {
      return;
    }

    setIsOpeningUpdateTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: updateManualCommand
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Confirm the update there, then return to AgentOS."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningUpdateTerminal(false);
    }
  };

  const openControlUi = async () => {
    setIsOpeningControlUi(true);

    try {
      const response = await fetch("/api/openclaw/dashboard", {
        method: "POST",
        cache: "no-store"
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Unable to open the OpenClaw Control UI.");
      }

      toast.success("OpenClaw Control UI opened.", {
        description: "Review the native update details there, then return to AgentOS."
      });
    } catch (error) {
      toast.error("Could not open the OpenClaw Control UI.", {
        description: error instanceof Error ? error.message : "Open the native OpenClaw dashboard manually."
      });
    } finally {
      setIsOpeningControlUi(false);
    }
  };

  return (
    <>
      <Dialog
        open={taskAbortRequest !== null}
        onOpenChange={(open) => {
          if (taskAbortRunState === "running") {
            return;
          }

          onTaskAbortOpenChange(open);
        }}
      >
        <DialogContent
          className={cn(
            "max-w-[480px] gap-5 p-5 sm:p-6",
            surfaceTheme === "light"
              ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
              : "border-white/10 bg-slate-950/94 text-slate-100"
          )}
        >
          <DialogHeader>
            <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
              Abort task?
            </DialogTitle>
            <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
              This stops the current OpenClaw dispatch for the selected task. It does not delete captured evidence or files.
            </DialogDescription>
          </DialogHeader>

          {taskAbortRequest ? (
            <div
              className={cn(
                "rounded-[20px] border px-4 py-4",
                surfaceTheme === "light"
                  ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4f3d31]"
                  : "border-rose-400/20 bg-rose-400/10 text-rose-50"
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Selected task</p>
              <p className="mt-2 font-display text-[1.02rem] leading-6 text-inherit">{taskAbortRequest.title}</p>
              <p className={cn("mt-1 text-sm leading-6", surfaceTheme === "light" ? "text-[#8b7262]" : "text-rose-100/80")}>
                {taskAbortRequest.subtitle}
              </p>
              {taskAbortMessage ? (
                <p className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-50">
                  {taskAbortMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={taskAbortRunState === "running"}
              className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
              onClick={() => {
                if (taskAbortRunState === "running") {
                  return;
                }

                onTaskAbortOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!taskAbortRequest || taskAbortRunState === "running"}
              onClick={() => {
                onTaskAbortConfirm();
              }}
            >
              {taskAbortRunState === "running" ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Aborting...
                </>
              ) : (
                "Abort task"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isInspectorOpen ? null : (
        <div
          className={cn(
            "pointer-events-auto absolute bottom-3 right-[74px] z-30 text-[11px] tracking-[0.04em] lg:bottom-4",
            surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
          )}
        >
          Built on{" "}
          <a
            href="https://openclaw.ai/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            OpenClaw
          </a>{" "}
          by{" "}
          <a
            href="https://sapienx.app/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            SapienX
          </a>
        </div>
      )}

      <MissionControlDialogShell
        open={updateDialogOpen}
        onOpenChange={onUpdateDialogOpenChange}
        title={updateDialogTitle}
        description={updateDialogDescription}
        surfaceTheme={surfaceTheme}
        variant="quiet"
        contentClassName={cn("sm:w-[min(92vw,600px)] sm:h-[min(calc(100dvh-72px),640px)]", surfaceTheme === "light" && "mission-shell--light")}
        bodyClassName="space-y-6 p-5 sm:p-6"
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => onUpdateDialogOpenChange(false)}>
              {isUpdateRunning ? "Continue in background" : isUpdateFinished ? "Done" : "Cancel"}
            </Button>
            {updateRunState === "unknown" ? (
              <Button asChild><a href="/updates">Check update status</a></Button>
            ) : !isUpdateFinished ? (
              <>
                {updateMode === "advanced" && !isUpdateRunning ? (
                  <Button variant="secondary" onClick={() => onRunOpenClawUpdate("certify-round-trip")}>Certify round-trip</Button>
                ) : null}
                <Button disabled={isUpdateRunning} onClick={() => onRunOpenClawUpdate("update")}>
                  {isUpdateRunning ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />Updating…</> : "Update OpenClaw"}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[hsl(var(--agentos-border-subtle))] bg-[hsl(var(--agentos-surface-inset))] p-5">
          <div><p className="text-xs text-[hsl(var(--agentos-text-muted))]">Installed</p><p className="mt-1 text-xl font-semibold">{snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Not confirmed"}</p></div>
          <span aria-hidden="true" className="text-[hsl(var(--agentos-text-muted))]">→</span>
          <div className="text-right"><p className="text-xs text-[hsl(var(--agentos-text-muted))]">Target</p><p className="mt-1 text-xl font-semibold">{selectedTargetLabel}</p></div>
        </div>
        <div role="status" aria-live="polite" className="flex items-start gap-3">
          {isUpdateRunning ? <LoaderCircle className="mt-1 h-5 w-5 shrink-0 animate-spin" /> : updateRunState === "success" ? <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-500" /> : isUpdateFinished ? <AlertTriangle className={cn("mt-1 h-5 w-5 shrink-0", updateRunState === "error" ? "text-rose-500" : "text-amber-500")} /> : null}
          <div className="min-w-0 space-y-2">
            <p className="font-medium">{isUpdateRunning ? (updateStatusMessage?.startsWith("Reconnecting") ? "Reconnecting to OpenClaw" : "Update in progress") : updateRunState === "unknown" ? "Result not yet confirmed" : updateRunState === "success" ? "Update complete" : updateRunState === "error" ? "Update needs attention" : "Ready to update"}</p>
            <p className="break-words text-sm leading-6 text-[hsl(var(--agentos-text-muted))]">
              {isUpdateFinished ? updateResultMessage : isUpdateRunning ? "OpenClaw handles installation and restart. Keep this window open while AgentOS waits for the result." : updateMode === "advanced" || updateMode === "candidate" ? "This exact release has not yet been verified by AgentOS. Continue only if you accept this and the brief interruption during restart." : "OpenClaw will install the selected version and restart if needed."}
            </p>
            {!isUpdateRunning && !isUpdateFinished && activeRuntimeCount > 0 ? <p className="text-sm text-amber-600">{activeRuntimeCount} active or queued runs may be interrupted.</p> : null}
          </div>
        </div>
        {updateCertificationScorecard && updateCertificationScorecard.hardBlockers.length > 0 ? (
          <p className="text-sm text-rose-600">Compatibility checks found {updateCertificationScorecard.hardBlockers.length} blocking issue(s). Review Technical details before continuing.</p>
        ) : null}
        {isUpdateFinished && updateRunState !== "success" ? (
          <Button variant="secondary" onClick={() => void openControlUi()} disabled={isOpeningControlUi}>
            <ExternalLink className="mr-2 h-4 w-4" />Open OpenClaw Control UI
          </Button>
        ) : null}
        <details className="border-t border-[hsl(var(--agentos-border-subtle))] pt-4">
          <summary className="cursor-pointer text-sm font-medium">Technical details</summary>
          <div className="mt-4 space-y-4 text-sm text-[hsl(var(--agentos-text-muted))]">
            <p>{updateModeLabel} · {updateInstallSummary.label}<br />{updateInstallSummary.detail}</p>
            <p>OpenClaw owns the native updater and its failure details. A disconnected stream alone does not establish failure or success.</p>
            {updateCertificationScorecard ? <CertificationScorecardPanel scorecard={updateCertificationScorecard} diff={updateCapabilityDiff} updateMode={updateMode} surfaceTheme={surfaceTheme} /> : null}
            {updateLog ? <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-xl bg-[hsl(var(--agentos-surface-inset))] p-4 text-xs leading-5">{updateLog}</pre> : <p>No update output yet.</p>}
            {updateManualCommand ? <div className="space-y-3"><code className="block break-words">{updateManualCommand}</code><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void copyUpdateCommand()}><Copy className="mr-2 h-4 w-4" />Copy command</Button>{canOpenUpdateTerminal ? <Button variant="secondary" disabled={isOpeningUpdateTerminal} onClick={() => void openUpdateTerminal()}><SquareTerminal className="mr-2 h-4 w-4" />Open Terminal</Button> : null}</div></div> : null}
          </div>
        </details>
      </MissionControlDialogShell>
    </>
  );
}

function CertificationScorecardPanel({
  scorecard,
  diff,
  updateMode,
  surfaceTheme
}: {
  scorecard: OpenClawCertificationScorecardReport | null;
  diff: OpenClawCapabilityDiffReport | null;
  updateMode: UpdateMode;
  surfaceTheme: SurfaceTheme;
}) {
  if (!scorecard) {
    return (
      <div
        className={cn(
          "rounded-[20px] border px-4 py-3 text-sm leading-6",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fffaf6] text-[#745e4f]"
            : "border-white/8 bg-white/[0.03] text-slate-300"
        )}
      >
        Certification scorecard will appear after an install-and-verify run captures target diagnostics.
      </div>
    );
  }

  const capabilityDiff = scorecard.capabilityDiff ?? diff;
  const capabilityCategory = scorecard.categories.find((category) => category.id === "capability-contract");
  const capabilityBlockerRows = scorecard.capabilityBlockerRows ?? [];
  const visibleRows = [
    ...capabilityBlockerRows,
    ...(capabilityDiff?.rows ?? []).filter((row) =>
      !capabilityBlockerRows.some((blocker) => blocker.operationId === row.operationId) &&
      row.changeKind !== "unchanged"
    )
  ].slice(0, 12);
  const canGenerateArtifact = updateMode === "advanced" && Boolean(scorecard.artifact);
  const roundTripEvidence = scorecard.roundTripEvidence ?? {
    status: "not-run" as const,
    startedAt: null,
    finishedAt: null,
    baselineVersion: scorecard.baselineVersion,
    targetVersion: scorecard.targetVersion,
    steps: [],
    failureMessage: null
  };
  const pluginConfigFindings = scorecard.pluginConfigFindings ?? [];

  const generateCertificationArtifact = () => {
    if (!scorecard.artifact) {
      return;
    }

    const target = scorecard.targetVersion ?? "unknown";
    const blob = new Blob([`${JSON.stringify(scorecard.artifact, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `openclaw-certification-${target}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Certification artifact generated.");
  };

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-[20px] border",
        surfaceTheme === "light"
          ? "border-[#e3d4c8] bg-[#fffaf6]"
          : "border-white/8 bg-white/[0.03]"
      )}
    >
      <div className={cn("border-b px-4 py-3", surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8")}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.24em] text-[#9a7f6c]" : "text-[10px] uppercase tracking-[0.24em] text-slate-500"}>
              Certification scorecard
            </p>
            <p className={cn("mt-1 break-words text-sm font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-white")}>
              {formatVersionLabel(scorecard.baselineVersion)} {"->"} {formatVersionLabel(scorecard.targetVersion)}
            </p>
          </div>
          <span
            className={scorecardStatusClassName(scorecard.status, surfaceTheme)}
          >
            {formatScorecardStatus(scorecard.status)}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-4">
        <DiffMetric label="Score" value={`${scorecard.score}/100`} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Hard blockers" value={String(scorecard.hardBlockers.length)} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Warnings" value={String(scorecard.warnings.length)} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Global cert." value={scorecard.globalCertification === "certified" ? "Certified" : "Not certified"} surfaceTheme={surfaceTheme} />
      </div>

      <div className="grid min-w-0 gap-2 px-4 pb-3 sm:grid-cols-2">
        {scorecard.categories.map((category) => (
          <div
            key={category.id}
            className={cn(
              "min-w-0 rounded-[16px] border px-3 py-2 text-xs",
              surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25"
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("break-words font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-100")}>
                  {category.label}
                </p>
                <p className={cn("mt-0.5 break-words", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                  {category.evidence}
                </p>
              </div>
              <span className={cn("shrink-0 font-mono text-[11px]", surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300")}>
                {category.score}/{category.maxScore}
              </span>
            </div>
            {category.findings.length > 0 ? (
              <p className={cn("mt-2 break-words", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                {category.findings[0]?.message}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {updateMode === "advanced" ? (
        <div className={cn("flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3", surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8")}>
          <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
            Operator artifact generation is available only when install-and-verify evidence is complete, score is at least 90, runtime smoke passed, and round-trip rollback evidence is verified.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canGenerateArtifact}
            onClick={generateCertificationArtifact}
            title={canGenerateArtifact ? "Generate certification artifact" : "Certification artifact is disabled until the scorecard is eligible."}
          >
            <Copy className="mr-2 h-4 w-4" />
            Generate artifact
          </Button>
        </div>
      ) : null}

      {pluginConfigFindings.length > 0 || roundTripEvidence.status !== "not-run" ? (
        <div className="grid min-w-0 gap-2 border-t px-4 py-4 sm:grid-cols-2">
          <div className={cn("min-w-0 rounded-[16px] border px-3 py-2 text-xs", surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25")}>
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-100")}>
              Plugin/config evidence
            </p>
            {pluginConfigFindings.length > 0 ? (
              <div className="mt-2 grid gap-2">
                {pluginConfigFindings.slice(0, 4).map((finding, index) => (
                  <p key={`${finding.kind}-${finding.pluginId ?? index}`} className={cn("break-words", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                    {finding.message}
                  </p>
                ))}
              </div>
            ) : (
              <p className={cn("mt-2", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                No plugin/config migration finding was detected.
              </p>
            )}
          </div>
          <div className={cn("min-w-0 rounded-[16px] border px-3 py-2 text-xs", surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25")}>
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-100")}>
              Round-trip evidence
            </p>
            <p className={cn("mt-2 break-words", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
              {roundTripEvidence.status === "not-run"
                ? "Round-trip certification has not run."
                : `${formatScorecardStatus(roundTripEvidence.status === "passed" ? "pre_certified_eligible" : "blocked")} across ${roundTripEvidence.steps.length} step(s).`}
            </p>
            {roundTripEvidence.failureMessage ? (
              <p className={cn("mt-1 break-words", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                {roundTripEvidence.failureMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="grid min-w-0 gap-2 border-t px-4 py-4">
          {visibleRows.map((row) => (
            <div
              key={row.operationId}
              className={cn(
                "grid min-w-0 gap-2 rounded-[16px] border px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,10rem)]",
                surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25"
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={diffSeverityClassName(row.severity, surfaceTheme)}>
                    {formatDiffSeverity(row.severity)}
                  </span>
                  <span className={surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400"}>
                    {formatDiffChange(row.changeKind)}
                  </span>
                </div>
                <p className={cn("mt-1 break-words font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-100")}>
                  {row.label}
                </p>
                <p className={surfaceTheme === "light" ? "mt-0.5 break-all text-[#8b7262]" : "mt-0.5 break-all text-slate-400"}>
                  {row.operationId}
                </p>
                <p className={surfaceTheme === "light" ? "mt-1 break-words text-[#8b7262]" : "mt-1 break-words text-slate-400"}>
                  {row.targetReason}
                </p>
                {row.targetRecovery ? (
                  <p className={surfaceTheme === "light" ? "mt-1 break-words text-[#8b7262]" : "mt-1 break-words text-slate-400"}>
                    Recovery: {row.targetRecovery}
                  </p>
                ) : null}
              </div>
              <div className={cn("min-w-0 break-words sm:text-right", surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300")}>
                <p className="break-words">{formatModeLabel(row.certifiedMode)} {"->"} {formatModeLabel(row.targetMode)}</p>
                <p className="mt-0.5 break-all [overflow-wrap:anywhere]">
                  {row.missingRequiredMethods.length > 0
                    ? `Missing: ${row.missingRequiredMethods.join(", ")}`
                    : row.addedMethods.length > 0
                      ? `Added: ${row.addedMethods.join(", ")}`
                      : row.removedMethods.length > 0
                        ? `Removed: ${row.removedMethods.join(", ")}`
                        : row.supportedMethod
                          ? `Supported: ${row.supportedMethod}`
                          : `Preferred: ${row.preferredMethod ?? "unknown"}`}
                </p>
                <p className="mt-0.5 break-all [overflow-wrap:anywhere]">
                  Source: {row.evidenceSource ?? "unknown"}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={surfaceTheme === "light" ? "border-t px-4 py-4 text-sm text-[#8b7262]" : "border-t border-white/8 px-4 py-4 text-sm text-slate-400"}>
          {capabilityCategory?.status === "blocked"
            ? "No capability method deltas were visible, but the target diagnostics still report capability blockers."
            : "Capability-equivalent: no Gateway method coverage delta was detected. This does not certify update, rollback, plugin, config, or runtime behavior."}
        </p>
      )}
    </div>
  );
}

function DiffMetric({
  label,
  value,
  surfaceTheme
}: {
  label: string;
  value: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("min-w-0 rounded-[14px] border px-3 py-2", surfaceTheme === "light" ? "border-[#eadccf] bg-white/70" : "border-white/8 bg-slate-950/25")}>
      <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.18em] text-[#9a7f6c]" : "text-[10px] uppercase tracking-[0.18em] text-slate-500"}>
        {label}
      </p>
      <p className={cn("mt-1 break-words font-display text-lg", surfaceTheme === "light" ? "text-[#4a382c]" : "text-white")}>
        {value}
      </p>
    </div>
  );
}

function formatVersionLabel(value: string | null) {
  return value ? `v${value.replace(/^v/i, "")}` : "unknown";
}

function formatModeLabel(value: string) {
  switch (value) {
    case "gateway-native":
      return "Native";
    case "cli-fallback":
      return "CLI";
    case "degraded":
      return "Degraded";
    case "disabled":
      return "Disabled";
    case "unknown":
      return "Unknown";
    case "missing":
      return "Missing";
    default:
      return value;
  }
}

function formatDiffSeverity(value: OpenClawCapabilityDiffReport["rows"][number]["severity"]) {
  switch (value) {
    case "improvement":
      return "Improved";
    case "regression":
      return "Regression";
    case "changed":
      return "Changed";
    case "unchanged":
      return "Same";
  }
}

function formatDiffChange(value: OpenClawCapabilityDiffReport["rows"][number]["changeKind"]) {
  switch (value) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "mode-changed":
      return "Mode changed";
    case "method-changed":
      return "Methods changed";
    case "fallback-changed":
      return "Fallback changed";
    case "unchanged":
      return "Unchanged";
  }
}

function formatScorecardStatus(value: OpenClawCertificationScorecardReport["status"]) {
  switch (value) {
    case "certified":
      return "Certified";
    case "pre_certified_eligible":
      return "Pre-certified eligible";
    case "compatible_with_warnings":
      return "Compatible with warnings";
    case "degraded":
      return "Degraded";
    case "blocked":
      return "Blocked";
    case "evidence_missing":
      return "Evidence missing";
  }
}

function scorecardStatusClassName(
  value: OpenClawCertificationScorecardReport["status"],
  surfaceTheme: SurfaceTheme
) {
  const base = "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]";

  if (value === "blocked") {
    return cn(base, surfaceTheme === "light"
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : "border-rose-300/25 bg-rose-300/10 text-rose-100");
  }

  if (value === "evidence_missing" || value === "degraded" || value === "compatible_with_warnings") {
    return cn(base, surfaceTheme === "light"
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-amber-300/25 bg-amber-300/10 text-amber-100");
  }

  return cn(base, surfaceTheme === "light"
    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
    : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100");
}

function diffSeverityClassName(
  value: OpenClawCapabilityDiffReport["rows"][number]["severity"],
  surfaceTheme: SurfaceTheme
) {
  const base = "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]";

  if (value === "regression") {
    return cn(base, surfaceTheme === "light" ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-300/25 bg-rose-300/10 text-rose-100");
  }

  if (value === "improvement") {
    return cn(base, surfaceTheme === "light" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100");
  }

  return cn(base, surfaceTheme === "light" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-300/25 bg-amber-300/10 text-amber-100");
}
