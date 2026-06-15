"use client";

import { AlertTriangle, CheckCircle2, Copy, LoaderCircle, SquareTerminal } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  resolveUpdateDialogDescription,
  resolveUpdateDialogTitle,
  resolveUpdateResultIconWrapClassName,
  resolveUpdateResultPanelClassName
} from "@/components/mission-control/mission-control-shell.utils";
import type {
  MissionControlSnapshot,
  OpenClawCapabilityDiffReport,
  WorkItemRecord
} from "@/lib/agentos/contracts";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type TaskAbortState = "idle" | "running" | "error";
type UpdateRunState = "idle" | "running" | "success" | "error";
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
  updateTargetVersion: string | null;
  updateMode: UpdateMode;
  activeRuntimeCount: number;
  updateInstallSummary: OpenClawInstallSummary;
  onUpdateDialogOpenChange: (open: boolean) => void;
  onRunOpenClawUpdate: () => void;
}) {
  const isUpdateRunning = updateRunState === "running";
  const isUpdateFinished = updateRunState === "success" || updateRunState === "error";
  const updateDialogTitle = resolveUpdateDialogTitle(updateRunState, updateMode);
  const updateDialogDescription = resolveUpdateDialogDescription(updateRunState, updateMode);
  const [isOpeningUpdateTerminal, setIsOpeningUpdateTerminal] = useState(false);
  const canOpenUpdateTerminal = isOpenClawTerminalCommand(updateManualCommand);
  const selectedTargetVersion =
    updateTargetVersion ||
    snapshot.diagnostics.updateCompatibility?.recommendedVersion ||
    snapshot.diagnostics.latestVersion ||
    snapshot.diagnostics.version ||
    "unknown";
  const selectedTargetLabel = selectedTargetVersion.startsWith("v")
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

      <Dialog
        open={updateDialogOpen}
        onOpenChange={(open) => {
          if (isUpdateRunning) {
            return;
          }

          onUpdateDialogOpenChange(open);
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[calc(100vh-48px)] w-[calc(100vw-32px)] max-w-[468px] gap-5 overflow-x-hidden overflow-y-auto p-5 sm:p-6",
            surfaceTheme === "light"
              ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
              : "border-white/10 bg-slate-950/94 text-slate-100"
          )}
        >
          <DialogHeader className="min-w-0">
            <DialogTitle className={cn("max-w-full break-words", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
              {updateDialogTitle}
            </DialogTitle>
            <DialogDescription className={cn("max-w-full break-words", surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400")}>
              {updateDialogDescription}
            </DialogDescription>
          </DialogHeader>

          {isUpdateFinished ? (
            <div
              className={cn(
                "min-w-0 space-y-4",
                surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
              )}
            >
              <div
                className={cn(
                  "rounded-[24px] border px-4 py-5",
                  resolveUpdateResultPanelClassName(updateRunState, surfaceTheme)
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
                      resolveUpdateResultIconWrapClassName(updateRunState, surfaceTheme)
                    )}
                  >
                    {updateRunState === "success" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[1.05rem] leading-6">
                      {updateRunState === "success" ? "OpenClaw is up to date" : "Update needs attention"}
                    </p>
                    <p className="mt-1 text-sm leading-6">
                      {updateResultMessage ||
                        (updateRunState === "success"
                          ? "The update finished successfully."
                          : "The update did not finish cleanly.")}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-3">
                  <div
                    className={cn(
                      "min-w-0 rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Installed version
                    </p>
                    <p className="mt-2 break-words font-display text-lg text-inherit">
                      v{snapshot.diagnostics.version || snapshot.diagnostics.latestVersion || "unknown"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "min-w-0 rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Latest reported
                    </p>
                    <p className="mt-2 break-words font-display text-lg text-inherit">
                      {selectedTargetLabel}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "min-w-0 rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Detected install
                    </p>
                    <p className="mt-2 break-words text-sm font-medium text-inherit">{updateInstallSummary.label}</p>
                    <p className={surfaceTheme === "light" ? "mt-1 break-words text-xs text-[#8b7262]" : "mt-1 break-words text-xs text-slate-400"}>
                      {updateInstallSummary.detail}
                    </p>
                  </div>
                </div>
              </div>

              <CapabilityDiffPanel
                diff={updateCapabilityDiff}
                surfaceTheme={surfaceTheme}
              />

              <div
                className={cn(
                  "rounded-[20px] border",
                  surfaceTheme === "light"
                    ? "border-[#e3d4c8] bg-[#fffaf6]"
                    : "border-white/8 bg-white/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between border-b px-4 py-3",
                    surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Update log
                  </p>
                  <span className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                    {updateRunState === "success" ? "Completed" : "Failed"}
                  </span>
                </div>
                <pre
                  className={cn(
                    "max-h-[180px] max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-5 [overflow-wrap:anywhere]",
                    surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                  )}
                >
                  {updateLog || "No command output was captured."}
                </pre>
              </div>

              {updateManualCommand ? (
                <div
                  className={cn(
                    "rounded-[20px] border px-4 py-3",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    {canOpenUpdateTerminal ? "Terminal" : "Manual"}
                  </p>
                  {canOpenUpdateTerminal ? (
                    <p
                      className={cn(
                        "mt-1 text-sm leading-6",
                        surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
                      )}
                    >
                      Open Terminal and run this command to confirm the update.
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      "mt-2 break-all font-mono text-[11px] leading-5",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {updateManualCommand}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void copyUpdateCommand();
                      }}
                      className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
                    >
                      <Copy className="mr-1.5 h-3 w-3" />
                      Copy command
                    </Button>
                    {canOpenUpdateTerminal ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void openUpdateTerminal();
                        }}
                        disabled={isOpeningUpdateTerminal}
                        className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
                      >
                        {isOpeningUpdateTerminal ? (
                          <>
                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                            Opening...
                          </>
                        ) : (
                          <>
                            <SquareTerminal className="mr-1.5 h-3 w-3" />
                            Open Terminal
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "grid min-w-0 gap-3 sm:grid-cols-2",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                <div
                  className={cn(
                    "min-w-0 rounded-[20px] border px-4 py-4",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Version target
                  </p>
                  <p className="mt-2 break-words font-display text-[1.1rem] leading-6 text-inherit">
                    {selectedTargetLabel}
                  </p>
                  <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                    Current: v{snapshot.diagnostics.version || "unknown"}
                  </p>
                  <p className={surfaceTheme === "light" ? "mt-2 text-xs text-[#8b7262]" : "mt-2 text-xs text-slate-400"}>
                    {updateModeLabel}
                  </p>
                </div>

                <div
                  className={cn(
                    "min-w-0 rounded-[20px] border px-4 py-4",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Detected install
                  </p>
                  <p className="mt-2 break-words text-sm font-medium leading-6 text-inherit">
                    {updateInstallSummary.label}
                  </p>
                  <p className={surfaceTheme === "light" ? "mt-1 break-words text-xs text-[#8b7262]" : "mt-1 break-words text-xs text-slate-400"}>
                    {updateInstallSummary.detail}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "rounded-[20px] border px-4 py-3 text-sm",
                  activeRuntimeCount > 0
                    ? surfaceTheme === "light"
                      ? "border-rose-300/80 bg-rose-50 text-rose-800"
                      : "border-rose-300/25 bg-rose-300/10 text-rose-100"
                    : surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6] text-[#745e4f]"
                      : "border-white/8 bg-white/[0.03] text-slate-300"
                )}
              >
                {activeRuntimeCount > 0
                  ? `${activeRuntimeCount} running or queued runtime${activeRuntimeCount === 1 ? "" : "s"} may be interrupted during the update.`
                  : updateMode === "advanced"
                    ? "This installs an unclassified OpenClaw version, then runs post-update compatibility checks and a runtime smoke test. AgentOS will try rollback if verification fails."
                    : "No running runtimes are currently tracked, so the update risk is lower."}
              </div>

              {isUpdateRunning ? (
                <div
                  className={cn(
                    "rounded-[20px] border",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-3 border-b px-4 py-3",
                      surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-2xl border",
                        surfaceTheme === "light"
                          ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#7b6453]"
                          : "border-white/10 bg-white/[0.05] text-slate-200"
                      )}
                    >
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={surfaceTheme === "light" ? "text-sm font-medium text-[#4a382c]" : "text-sm font-medium text-white"}>
                        Update in progress
                      </p>
                      <p className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                        {updateStatusMessage || "Streaming OpenClaw output..."}
                      </p>
                    </div>
                  </div>
                  <pre
                    className={cn(
                      "max-h-[180px] min-h-[120px] max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-5 [overflow-wrap:anywhere]",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {updateLog || "Waiting for command output..."}
                  </pre>
                </div>
              ) : null}
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onUpdateDialogOpenChange(false);
              }}
              className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
            >
              {isUpdateRunning ? "Run in background" : isUpdateFinished ? "Done" : "Cancel"}
            </Button>
            {isUpdateFinished ? null : (
              <Button
                type="button"
                onClick={onRunOpenClawUpdate}
                disabled={isUpdateRunning}
                className={cn(
                  snapshot.diagnostics.updateAvailable
                    ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20 hover:bg-amber-300"
                    : "",
                  surfaceTheme === "light" && !snapshot.diagnostics.updateAvailable
                    ? "bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                    : ""
                )}
              >
                {isUpdateRunning ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  updateMode === "advanced" ? "Install and verify" : "Update now"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CapabilityDiffPanel({
  diff,
  surfaceTheme
}: {
  diff: OpenClawCapabilityDiffReport | null;
  surfaceTheme: SurfaceTheme;
}) {
  if (!diff) {
    return (
      <div
        className={cn(
          "rounded-[20px] border px-4 py-3 text-sm leading-6",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fffaf6] text-[#745e4f]"
            : "border-white/8 bg-white/[0.03] text-slate-300"
        )}
      >
        Capability diff will appear after an install-and-verify run captures target diagnostics.
      </div>
    );
  }

  const visibleRows = diff.rows
    .filter((row) => row.changeKind !== "unchanged" || isCapabilityDiffTargetBlocker(row))
    .slice(0, 8);
  const hasBlockers = diff.summary.certificationBlockerCount > 0;

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
              Capability certification diff
            </p>
            <p className={cn("mt-1 break-words text-sm font-medium", surfaceTheme === "light" ? "text-[#4a382c]" : "text-white")}>
              {formatVersionLabel(diff.certifiedVersion)} {"->"} {formatVersionLabel(diff.targetVersion)}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
              hasBlockers
                ? surfaceTheme === "light"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-rose-300/25 bg-rose-300/10 text-rose-100"
                : surfaceTheme === "light"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
            )}
          >
            {hasBlockers ? `${diff.summary.certificationBlockerCount} blockers` : "No blockers"}
          </span>
        </div>
      </div>

      <div className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-4">
        <DiffMetric label="Native +" value={String(diff.summary.nativeImprovements)} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Native -" value={String(diff.summary.nativeRegressions)} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Fallback -" value={String(diff.summary.fallbackRegressions)} surfaceTheme={surfaceTheme} />
        <DiffMetric label="Target blockers" value={String(diff.summary.certificationBlockerCount)} surfaceTheme={surfaceTheme} />
      </div>

      {visibleRows.length > 0 ? (
        <div className="grid min-w-0 gap-2 px-4 pb-4">
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
                        : "No method delta"}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={surfaceTheme === "light" ? "px-4 pb-4 text-sm text-[#8b7262]" : "px-4 pb-4 text-sm text-slate-400"}>
          {hasBlockers
            ? "No capability deltas were detected, but the target diagnostics still report certification blockers."
            : "No capability changes were detected between the certified baseline and target diagnostics."}
        </p>
      )}
    </div>
  );
}

function isCapabilityDiffTargetBlocker(row: OpenClawCapabilityDiffReport["rows"][number]) {
  return (
    row.severity === "regression" ||
    row.targetMode === "missing" ||
    row.targetMode === "disabled" ||
    row.missingRequiredMethods.length > 0
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
