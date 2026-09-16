"use client";

import { AlertTriangle, ChevronDown, LoaderCircle, PackageX, RotateCcw, Trash2 } from "lucide-react";

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
import type { ResetPreview, ResetTarget } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type PreviewState = "idle" | "loading" | "ready" | "error";
type RunState = "idle" | "running" | "success" | "error";

export function ResetDialog({
  open,
  target,
  surfaceTheme,
  previewState,
  preview,
  previewError,
  confirmationExpiresAt,
  hasConfirmationPlan,
  runState,
  statusMessage,
  resultMessage,
  backgroundLogPath,
  log,
  confirmText,
  onConfirmTextChange,
  onRefreshPreview,
  onExecute,
  onBackToSetup,
  onOpenChange
}: {
  open: boolean;
  target: ResetTarget | null;
  surfaceTheme: SurfaceTheme;
  previewState: PreviewState;
  preview: ResetPreview | null;
  previewError: string | null;
  confirmationExpiresAt: string | null;
  hasConfirmationPlan: boolean;
  runState: RunState;
  statusMessage: string | null;
  resultMessage: string | null;
  backgroundLogPath: string | null;
  log: string;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  onRefreshPreview: () => void;
  onExecute: () => void;
  onBackToSetup: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const expectedConfirmation =
    target === "full-uninstall" ? "FULL UNINSTALL" : "RESET MISSION CONTROL";
  const isExecuting = runState === "running";
  const hasFinished = runState === "success" || runState === "error";
  const isFullUninstall = target === "full-uninstall";
  const nativePlanReady = target !== "full-uninstall" || preview?.nativeOpenClaw?.status === "ready";
  const canExecute =
    target !== null &&
    previewState === "ready" &&
    hasConfirmationPlan &&
    nativePlanReady &&
    !isExecuting &&
    !hasFinished &&
    confirmText.trim() === expectedConfirmation;
  const title =
    target === "full-uninstall" ? "Full Uninstall" : "Reset AgentOS";
  const description = isFullUninstall
    ? "Remove AgentOS from this machine. OpenClaw native teardown runs first; protected workspace folders stay preserved."
    : "Clear AgentOS-managed state while preserving OpenClaw and protected workspace data.";
  const dangerButtonClassName =
    surfaceTheme === "light"
      ? "border-rose-400/80 bg-rose-600 text-white hover:bg-rose-700"
      : "border-rose-400/35 bg-rose-500/90 text-white hover:bg-rose-500";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isExecuting) {
          return;
        }

        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[88vh] w-[min(92vw,520px)] max-w-[92vw] min-w-0 overflow-x-hidden overflow-y-auto",
          surfaceTheme === "light"
            ? "border-[#dcc8bb] bg-[rgba(252,247,241,0.98)] text-[#402f24]"
            : "border-white/12 bg-[rgba(7,12,22,0.96)] text-slate-100"
        )}
      >
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
            {target === "full-uninstall" ? <PackageX className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
            {title}
          </DialogTitle>
          <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
            {description}
          </DialogDescription>
        </DialogHeader>

        {previewState === "loading" ? (
          <div
            className={cn(
              "flex items-center gap-2 rounded-[16px] border px-4 py-4 text-sm",
              surfaceTheme === "light" ? "border-[#e6d6ca] bg-white" : "border-white/10 bg-white/[0.03]"
            )}
          >
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading the reset preview...
          </div>
        ) : null}

        {previewState === "error" ? (
          <div
            className={cn(
              "rounded-[16px] border px-4 py-4",
              surfaceTheme === "light"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-rose-400/25 bg-rose-500/10 text-rose-100"
            )}
          >
            <p className="text-sm font-medium">Preview could not be prepared.</p>
            <p className="mt-1 text-sm">{previewError || "Unknown reset preview error."}</p>
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImpactCard
                label="Will remove"
                value={`${preview.summary.deleteFolderCount} folder${preview.summary.deleteFolderCount === 1 ? "" : "s"}`}
                detail={`${preview.summary.agentCount} agent${preview.summary.agentCount === 1 ? "" : "s"} and ${preview.summary.activeRuntimeCount} active run${preview.summary.activeRuntimeCount === 1 ? "" : "s"}`}
                surfaceTheme={surfaceTheme}
                danger
              />
              <ImpactCard
                label="Will preserve"
                value={`${preview.summary.metadataOnlyCount} folder${preview.summary.metadataOnlyCount === 1 ? "" : "s"}`}
                detail={`${preview.summary.liveAgentCount} live agent${preview.summary.liveAgentCount === 1 ? "" : "s"} remain protected`}
                surfaceTheme={surfaceTheme}
              />
            </div>

            {preview.warnings.length > 0 ? (
              <div
                className={cn(
                  "mt-3 rounded-[16px] border px-4 py-4",
                  surfaceTheme === "light"
                    ? "border-amber-300/90 bg-amber-50 text-amber-950"
                    : "border-amber-300/25 bg-amber-300/10 text-amber-50"
                )}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="space-y-1 text-sm">
                    {preview.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <details className="group rounded-2xl border border-border/70 bg-background/20 px-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span>Review details</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="pb-3">
            <div
              className={cn(
                "mt-3 rounded-[16px] border px-4 py-4",
                surfaceTheme === "light" ? "border-[#e6d6ca] bg-white" : "border-white/10 bg-white/[0.03]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className={cn("text-xs uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
                    Workspace impact
                  </p>
                  <p className={cn("mt-1 text-sm", surfaceTheme === "light" ? "text-[#6d5647]" : "text-slate-400")}>
                    Delete folder is limited to a durable AgentOS ownership proof. Preserve folder keeps user and OpenClaw data and removes only the explicitly listed AgentOS integration marker, if present.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={onRefreshPreview}
                  className={
                    surfaceTheme === "light"
                      ? "border-[#dcc6b6] bg-white text-[#5d4739] hover:bg-[#f7eee7] hover:text-[#5d4739]"
                      : undefined
                  }
                >
                  Refresh preview
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                {preview.workspaces.map((workspace) => (
                  <div
                    key={workspace.workspaceId}
                    className={cn(
                      "rounded-[14px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-[#ece0d6] bg-[#fffaf6]" : "border-white/8 bg-white/[0.03]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
                          {workspace.name}
                        </p>
                        <p className={cn("mt-1 break-all font-mono text-[11px]", surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400")}>
                          {workspace.path}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                          workspace.action === "delete-folder"
                            ? surfaceTheme === "light"
                              ? "border-rose-300 bg-rose-50 text-rose-700"
                              : "border-rose-400/25 bg-rose-500/10 text-rose-200"
                            : surfaceTheme === "light"
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                        )}
                      >
                        {workspace.action === "delete-folder" ? "Delete AgentOS folder" : "Preserve folder"}
                      </span>
                    </div>
                    <p className={cn("mt-2 text-xs", surfaceTheme === "light" ? "text-[#6d5647]" : "text-slate-400")}>
                      {workspace.agentCount} agents, {workspace.runtimeCount} tracked runs, {workspace.liveAgentCount} live agents.
                    </p>
                    <p className={cn("mt-1 text-[11px] uppercase tracking-[0.14em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
                      Ownership: {workspace.ownership.replaceAll("_", " ")}
                    </p>
                    <div className="mt-2 space-y-1">
                      {workspace.reasons.map((reason) => (
                        <p
                          key={reason}
                          className={cn("text-xs", surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-500")}
                        >
                          {reason}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <PathPanel
                title="AgentOS state"
                items={preview.missionControlPaths}
                surfaceTheme={surfaceTheme}
              />
              {preview.agentOsRuntimePaths.length > 0 ? (
                <PathPanel
                  title="AgentOS runtime state"
                  items={preview.agentOsRuntimePaths}
                  surfaceTheme={surfaceTheme}
                />
              ) : null}
              <PathPanel
                title="Browser state"
                items={preview.browserStorageKeys}
                surfaceTheme={surfaceTheme}
              />
            </div>

            {target === "full-uninstall" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <PathPanel
                  title="OpenClaw native state scope"
                  items={preview.openClawPaths}
                  surfaceTheme={surfaceTheme}
                />
                {preview.nativeOpenClaw ? (
                  <div
                    className={cn(
                      "rounded-[16px] border px-4 py-4",
                      surfaceTheme === "light" ? "border-[#e6d6ca] bg-white" : "border-white/10 bg-white/[0.03]"
                    )}
                  >
                    <p className={cn("text-xs uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
                      Native OpenClaw teardown
                    </p>
                    <p className={cn("mt-2 text-sm", surfaceTheme === "light" ? "text-[#6d5647]" : "text-slate-400")}>
                      {preview.nativeOpenClaw.status === "ready"
                        ? "Ready: service, state, and macOS app scopes are planned, while configured workspace folders remain protected."
                        : preview.nativeOpenClaw.reason || "The native OpenClaw preflight is blocked."}
                    </p>
                    <p className={cn("mt-2 break-all font-mono text-[11px]", surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-500")}>
                      {preview.nativeOpenClaw.preflightCommand}
                    </p>
                  </div>
                ) : null}
                <div
                  className={cn(
                    "rounded-[16px] border px-4 py-4",
                    surfaceTheme === "light" ? "border-[#e6d6ca] bg-white" : "border-white/10 bg-white/[0.03]"
                  )}
                >
                  <p className={cn("text-xs uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
                    CLI cleanup
                  </p>
                  <div className="mt-3 space-y-2">
                    {preview.packageActions.map((action) => (
                      <div
                        key={action.packageName}
                        className={cn(
                          "min-w-0 overflow-hidden rounded-[14px] border px-3 py-3",
                          surfaceTheme === "light" ? "border-[#ece0d6] bg-[#fffaf6]" : "border-white/8 bg-white/[0.03]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("min-w-0 break-all text-sm font-medium", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
                            {action.packageName}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]",
                              isManualPackageAction(action)
                                ? surfaceTheme === "light"
                                  ? "border-amber-300 bg-amber-50 text-amber-700"
                                  : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                                : action.detected
                                ? surfaceTheme === "light"
                                  ? "border-rose-300 bg-rose-50 text-rose-700"
                                  : "border-rose-400/25 bg-rose-500/10 text-rose-200"
                                : surfaceTheme === "light"
                                  ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#876c5a]"
                                  : "border-white/10 bg-white/[0.05] text-slate-300"
                            )}
                          >
                            {isManualPackageAction(action) ? "Manual" : action.detected ? "Detected" : "Not present"}
                          </span>
                        </div>
                        <p className={cn("mt-1 break-words text-xs", surfaceTheme === "light" ? "text-[#6d5647]" : "text-slate-400")}>
                          {action.reason || "No extra detail."}
                        </p>
                        <p className={cn("mt-1 whitespace-pre-wrap break-all font-mono text-[11px]", surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-500")}>
                          {action.command || (isManualPackageAction(action) && action.detected
                            ? "Preserved; remove this source checkout manually if needed."
                            : "Automatic cleanup is not available.")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
              </div>
            </details>

            <div
              className={cn(
                "mt-3 rounded-[16px] border px-4 py-4",
                surfaceTheme === "light"
                  ? "border-rose-200 bg-rose-50/70 text-rose-950"
                  : "border-rose-400/25 bg-rose-500/10 text-rose-50"
              )}
            >
              <Label htmlFor="reset-confirm" className="text-sm font-medium text-inherit">
                Type {expectedConfirmation} to continue
              </Label>
              {confirmationExpiresAt ? (
                <p className="mt-1 text-xs text-inherit/75">
                  This preview is valid until {new Date(confirmationExpiresAt).toLocaleTimeString()}.
                </p>
              ) : null}
              <Input
                id="reset-confirm"
                value={confirmText}
                onChange={(event) => onConfirmTextChange(event.target.value)}
                placeholder={expectedConfirmation}
                disabled={isExecuting}
                className={cn(
                  "mt-2 h-10",
                  surfaceTheme === "light"
                    ? "border-rose-200 bg-white text-rose-950 placeholder:text-rose-300"
                    : "border-rose-300/20 bg-slate-950/50 text-rose-50 placeholder:text-rose-200/35"
                )}
              />
            </div>
          </>
        ) : null}

        {runState !== "idle" || resultMessage || log ? (
          <div
            className={cn(
              "min-w-0 overflow-hidden rounded-[16px] border px-4 py-4",
              runState === "error"
                ? surfaceTheme === "light"
                  ? "border-rose-200 bg-rose-50 text-rose-950"
                  : "border-rose-400/25 bg-rose-500/10 text-rose-50"
                : runState === "success"
                  ? surfaceTheme === "light"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-50"
                  : surfaceTheme === "light"
                    ? "border-[#e6d6ca] bg-white text-[#3f2f24]"
                    : "border-white/10 bg-white/[0.03] text-slate-100"
            )}
          >
            <p className="text-sm font-medium">{runState === "running" ? "Working on your request" : runState === "error" ? "Action needs attention" : resultMessage?.startsWith("Uninstall finishing") ? "Uninstall finishing" : "Action complete"}</p>
            {resultMessage ? <p className="mt-1 text-sm">{resultMessage}</p> : null}
            <ResetProgress runState={runState} statusMessage={statusMessage} target={target} surfaceTheme={surfaceTheme} />
            <details className="mt-3 rounded-xl border border-current/10 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">View details</summary>
              <div className="mt-2 space-y-2">
                {backgroundLogPath ? <p className="break-all font-mono text-[11px]">Background cleanup log: {backgroundLogPath}</p> : null}
                {statusMessage ? <p className="text-xs opacity-80">Current operation: {statusMessage}</p> : null}
                <pre
                  className={cn(
                    "max-h-56 w-full max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[14px] border px-3 py-3 text-[11px] leading-relaxed",
                    surfaceTheme === "light"
                      ? "border-[#e6d6ca] bg-[#fffaf6] text-[#5f4a3d]"
                      : "border-white/10 bg-slate-950/45 text-slate-300"
                  )}
                >
                  {log || "Waiting for command output..."}
                </pre>
              </div>
            </details>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant={hasFinished ? "default" : "secondary"}
            onClick={() => {
              if (target === "full-uninstall" && runState === "success") {
                onBackToSetup();
                return;
              }

              onOpenChange(false);
            }}
            disabled={isExecuting}
            className={
              hasFinished && surfaceTheme === "light"
                ? "bg-[#5c4437] text-white hover:bg-[#4d382d]"
                : hasFinished
                  ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                  : undefined
            }
          >
            {target === "full-uninstall" && runState === "success"
              ? "Back to setup"
              : hasFinished
                ? "Done"
                : "Close"}
          </Button>
          {!hasFinished ? (
            <Button
              type="button"
              onClick={onExecute}
              disabled={!canExecute}
              className={dangerButtonClassName}
            >
              {isExecuting ? (
                <>
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  {target === "full-uninstall" ? <PackageX className="mr-1.5 h-3.5 w-3.5" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                  {title}
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactCard({
  label,
  value,
  detail,
  surfaceTheme,
  danger = false
}: {
  label: string;
  value: string;
  detail: string;
  surfaceTheme: SurfaceTheme;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3.5 py-3",
        danger
          ? surfaceTheme === "light"
            ? "border-rose-200 bg-rose-50"
            : "border-rose-400/20 bg-rose-500/10"
          : surfaceTheme === "light"
            ? "border-[#e6d6ca] bg-white"
            : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p className={cn("text-[10px] uppercase tracking-[0.16em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
        {label}
      </p>
      <p className={cn("mt-1 font-display text-base", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
        {value}
      </p>
      <p className={cn("mt-1 text-[11px] leading-4", surfaceTheme === "light" ? "text-[#6d5647]" : "text-slate-400")}>{detail}</p>
    </div>
  );
}

function ResetProgress({
  runState,
  statusMessage,
  target,
  surfaceTheme
}: {
  runState: RunState;
  statusMessage: string | null;
  target: ResetTarget | null;
  surfaceTheme: SurfaceTheme;
}) {
  const steps = ["Preparing", "OpenClaw", "AgentOS", "Finishing"];
  const activeIndex = resolveResetProgressIndex(statusMessage, runState, target);
  return (
    <div className="mt-4" aria-label="Reset progress">
      <div className="grid grid-cols-4 gap-1.5">
        {steps.map((step, index) => {
          const complete = runState === "success" || index < activeIndex;
          const active = runState === "running" && index === activeIndex;
          return (
            <div key={step} className="min-w-0">
              <div className={cn("h-1 rounded-full", complete || active ? "bg-primary" : surfaceTheme === "light" ? "bg-black/10" : "bg-white/10")} />
              <p className={cn("mt-1 truncate text-[10px]", active || complete ? "text-foreground" : "text-muted-foreground")}>{step}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function resolveResetProgressIndex(statusMessage: string | null, runState: RunState, target: ResetTarget | null) {
  if (runState === "success") return 4;
  const message = statusMessage?.toLowerCase() ?? "";
  if (message.includes("openclaw") || message.includes("native")) return 1;
  if (message.includes("package") || message.includes("refresh") || message.includes("finish")) return 3;
  if (message.includes("agentos") || message.includes("workspace") || message.includes("runtime") || message.includes("snapshot")) return 2;
  return target === "mission-control" ? 0 : 0;
}

function PathPanel({
  title,
  items,
  surfaceTheme
}: {
  title: string;
  items: string[];
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border px-4 py-4",
        surfaceTheme === "light" ? "border-[#e6d6ca] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p className={cn("text-xs uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500")}>
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <p
            key={item}
            className={cn(
              "break-all rounded-[12px] border px-3 py-2 font-mono text-[11px]",
              surfaceTheme === "light"
                ? "border-[#ece0d6] bg-[#fffaf6] text-[#6d5647]"
                : "border-white/8 bg-white/[0.03] text-slate-400"
            )}
          >
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function isManualPackageAction(action: ResetPreview["packageActions"][number]) {
  return action.required && ((action.removalMode ?? "none") === "none" || !action.detected);
}
