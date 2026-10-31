"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, CheckCircle2, Circle, Clock3, LoaderCircle, Radio, RefreshCw, ShieldCheck, Unplug, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpenClawUpdateProgress } from "@/lib/openclaw/application/update-progress-service";
import type { OpenClawUpdateAttempt } from "@/lib/openclaw/update-progress";

const stages = ["Preparing", "Installing", "Restarting", "Reconnecting", "Verifying", "Complete"];
const phases: Record<string, number> = { requested: 0, staging: 0, validating: 1, activating: 1, restarting: 2, verifying: 4, finished: 4 };

export function formatUpdateDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function OpenClawUpdateProgressPanel({ progress, attempt, streamConnected, lastContactAt, onCheck, onReview, accessDenied }: {
  progress: OpenClawUpdateProgress | null;
  attempt: OpenClawUpdateAttempt | null;
  streamConnected: boolean;
  lastContactAt: number | null;
  onCheck: () => void;
  onReview: () => void;
  accessDenied: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = progress?.run;
  const failed = run?.status === "failed" || run?.status === "rolled-back" || run?.status === "skipped";
  const complete = run?.status === "succeeded" && progress?.verification.status === "verified";
  const disconnected = progress !== null && (!streamConnected || progress.connected === false);
  const delayed = !complete && !failed && now - (run?.updatedAtMs ?? attempt?.startedAtMs ?? now) > 90_000;
  const failedPhase = failed ? run?.steps.find((step) => step.status === "failed")?.step : null;
  const stage = complete ? 5 : phases[failed ? failedPhase ?? "requested" : run?.phase ?? "requested"] ?? 0;
  const started = run?.createdAtMs ?? attempt?.startedAtMs ?? now;
  const elapsed = formatUpdateDuration((run?.finishedAtMs && (complete || failed) ? run.finishedAtMs : now) - started);
  const before = run?.beforeVersion ?? attempt?.beforeVersion;
  const target = run?.targetVersion ?? attempt?.targetVersion;
  const title = accessDenied ? "Sign in to resume tracking" : complete ? "Updated. Connected. Ready."
    : failed ? run?.status === "rolled-back" ? "OpenClaw restored the previous version" : run?.status === "skipped" ? "Update was not applied" : "The update needs attention"
    : disconnected ? "Waiting for the Gateway"
    : run?.status === "succeeded" ? "Confirming everything is ready"
    : ["Preparing your update", "Installing the new release", "Restarting the Gateway", "Reconnecting to the Gateway", "Checking the updated runtime"][stage];
  const description = accessDenied ? "Your session no longer has access to update progress. Sign in again to read the native update record; no update will be started again." : complete ? `OpenClaw ${progress?.currentVersion ? `v${progress.currentVersion}` : ""} is running. The Gateway, configuration and required native access have been verified.`
    : failed ? run?.reason || "OpenClaw recorded this outcome. Review the details before starting another update."
    : disconnected ? "The connection is temporarily unavailable. Your update stays on this screen, and tracking resumes automatically when the Gateway returns."
    : run?.status === "succeeded" ? progress?.verification.message
    : "OpenClaw is handling the update. You can leave this page and return; AgentOS will pick up the recorded progress.";
  const Icon = complete ? ShieldCheck : failed ? AlertTriangle : disconnected ? Unplug : LoaderCircle;
  return (
    <section aria-label="OpenClaw update progress" className={cn("relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm", complete ? "border-[hsl(var(--status-success)/0.3)]" : failed ? "border-[hsl(var(--status-danger)/0.3)]" : "border-[hsl(var(--agentos-operational-accent)/0.3)]")}>
      <div className={cn("h-1", complete ? "bg-[hsl(var(--status-success))]" : failed ? "bg-[hsl(var(--status-danger))]" : "bg-[hsl(var(--agentos-operational-accent))]")} />
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">OpenClaw · Runtime update</p>
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium", complete ? "border-[hsl(var(--status-success)/0.25)] text-[hsl(var(--status-success-foreground))]" : "border-border text-muted-foreground")}>
            {complete ? <CheckCircle2 className="h-3 w-3" /> : disconnected ? <Unplug className="h-3 w-3" /> : <Radio className="h-3 w-3" />}
            {accessDenied ? "Access required" : complete ? "Verified" : failed ? "Review required" : !progress ? "Connecting to monitor" : disconnected ? "Reconnecting automatically" : "Live tracking"}
          </span>
        </div>
        <div className="mt-6 flex items-start gap-4" role="status" aria-live="polite" aria-atomic="true">
          <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border", complete ? "border-[hsl(var(--status-success)/0.2)] bg-[hsl(var(--status-success)/0.08)] text-[hsl(var(--status-success-foreground))]" : "border-border bg-muted/50 text-foreground")}>
            <Icon className={cn("h-6 w-6", !complete && !failed && !disconnected && "animate-spin motion-reduce:animate-none")} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-sm">
          {before ? <span className="text-muted-foreground">v{before}</span> : null}
          {before && target ? <ArrowRight aria-hidden="true" className="mx-1 h-4 w-4 text-muted-foreground" /> : null}
          {target ? <span className="rounded-md border border-border bg-muted/40 px-2.5 py-1 font-semibold">v{target}</span> : null}
        </div>
        <ol aria-label="Update stages" className="mt-7 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-border pt-5 sm:grid-cols-6 sm:gap-x-2">
          {stages.map((label, index) => {
            const done = complete || index < stage;
            const active = !complete && index === stage;
            return <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-2 sm:flex-col sm:items-start">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold", done ? "border-[hsl(var(--status-success)/0.25)] bg-[hsl(var(--status-success)/0.08)] text-[hsl(var(--status-success-foreground))]" : active ? "border-foreground/30 bg-foreground text-background" : "border-border text-muted-foreground")}>
                {done ? <Check className="h-3.5 w-3.5" /> : active && !failed ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : index + 1}
              </span>
              <span className={cn("text-[11px]", active || done ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </li>;
          })}
        </ol>
        {complete ? <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{["Version confirmed", "Gateway healthy", "Configuration applied", "Native access verified"].map(label => <span key={label} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[hsl(var(--status-success-foreground))]" />{label}</span>)}</div> : null}
        {delayed ? <p className="mt-5 rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">This stage is taking longer. Automatic tracking is still active; do not start another update. Last recorded phase: {run?.phase ?? "waiting for admission"}.</p> : null}
        {run?.steps.length ? <details className="mt-5 border-t border-border pt-3">
          <summary className="cursor-pointer rounded-sm py-1 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View recorded update details</summary>
          <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-2 text-xs text-muted-foreground">{run.steps.map((step, index) => <li key={`${step.step}-${index}`} className="flex items-start gap-2">{step.status === "completed" ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <Circle className="mt-0.5 h-3 w-3 shrink-0" />}<span className="min-w-0 break-words">{step.step.replaceAll(/[-_:]/g, " ")}<span className="ml-2 text-[10px]">{step.status.replaceAll("_", " ")}</span></span></li>)}</ul>
        </details> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3 text-xs text-muted-foreground sm:px-7">
        <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 className="h-3.5 w-3.5" />{complete || failed ? "Duration" : "Elapsed"} {elapsed}</span>
        {lastContactAt ? <span className="tabular-nums">Last Gateway contact {formatUpdateDuration(now - lastContactAt)} ago</span> : null}
        {failed || (delayed && !run) ? <Button type="button" variant="secondary" size="sm" onClick={onReview}>Review update options</Button> : null}
        {!complete ? <Button type="button" variant="ghost" size="sm" onClick={onCheck}><RefreshCw className="mr-1.5 h-3 w-3" />Check status</Button> : null}
      </div>
    </section>
  );
}
