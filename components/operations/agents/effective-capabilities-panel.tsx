"use client";

import { Button } from "@/components/ui/button";
import type { EffectiveCapabilityStatus, SkillLibraryItem, WorkerEffectiveCapabilitiesPayload } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

export function EffectiveCapabilitiesPanel({
  state,
  onActivate,
  focusId = null
}: {
  state: {
    loading: boolean;
    data: WorkerEffectiveCapabilitiesPayload | null;
    error: string | null;
  };
  onActivate: (skill: SkillLibraryItem) => Promise<void | boolean>;
  focusId?: string | null;
}) {
  if (state.loading) {
    return <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs text-muted-foreground">Reading OpenClaw&apos;s current effective tools and Skills Library state...</div>;
  }

  if (state.error) {
    return <div className="rounded-2xl border border-amber-300/30 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Effective capability state unavailable.</span> {state.error}</div>;
  }

  const data = state.data;
  if (!data) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">What this worker can do now</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {data.session.key
              ? `Based on OpenClaw&apos;s effective tools for session ${shortId(data.session.key)}.`
              : "OpenClaw has not exposed a session context, so configured tools are not presented as effective capabilities."}
          </p>
        </div>
        <CapabilitySummary summary={data.summary} />
      </div>

      {data.capabilities.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.capabilities.map((capability) => (
            <div key={capability.id} data-capability-id={capability.id} className={cn("rounded-xl border border-border bg-background/65 px-3 py-3", focusId === capability.id && "ring-2 ring-primary/40")}>
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", capabilityStatusDot(capability.status))} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold">{capability.label}</p>
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{capabilityStatusLabel(capability.status)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{capability.explanation}</p>
                  {capability.configured !== null ? <p className="mt-1.5 text-[10px] text-muted-foreground">Configured: {capability.configured ? "yes" : "no"} · Effective: {capability.effective === null ? "unknown" : capability.effective ? "yes" : "no"}</p> : null}
                  {capability.reasons[0] ? <p className="mt-1 text-[10px] text-muted-foreground/80">Why: {capability.reasons[0].message}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-3 text-xs text-muted-foreground">No native capability entries were returned for this worker.</p>
      )}

      <SkillLibraryPanel data={data} onActivate={onActivate} />
    </div>
  );
}

function SkillLibraryPanel({ data, onActivate }: { data: WorkerEffectiveCapabilitiesPayload; onActivate: (skill: SkillLibraryItem) => Promise<void | boolean> }) {
  return (
    <div className="space-y-2 border-t border-border/70 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Skills Library</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Native OpenClaw skills, revisions, and session selections.</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{data.skillLibrary.supported ? "Native" : "Unsupported"}</span>
      </div>
      {!data.skillLibrary.supported ? (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground">Skills Library is not available from the current OpenClaw runtime.</p>
      ) : data.skills.length ? (
        <div className="space-y-2">
          {data.skills.map((skill) => {
            const activeLatest = skill.activation.activeRevisionId === skill.revision.id;
            return (
              <div key={skill.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/65 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{skill.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{skill.ownership.scope === "shared" ? "Shared" : skill.ownership.scope === "personal" ? "Personal" : "Ownership unavailable"} · Latest rev {shortId(skill.revision.id)}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{skill.activation.activeInSession ? activeLatest ? "Active in current session" : `Session rev ${shortId(skill.activation.activeRevisionId)} · newer revision available` : skill.activation.enabled ? "Available to activate" : "Disabled in library"}</p>
                </div>
                {skill.activation.enabled && !skill.activation.activeInSession && data.session.key ? <Button type="button" size="sm" variant="secondary" className="h-7 rounded-lg px-2.5 text-[10px]" onClick={() => void onActivate(skill)}>Activate next turn</Button> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-2.5 text-[11px] text-muted-foreground">No native library entries are visible to this operator.</p>
      )}
    </div>
  );
}

function CapabilitySummary({ summary }: { summary: WorkerEffectiveCapabilitiesPayload["summary"] }) {
  const items: Array<[EffectiveCapabilityStatus, string]> = [
    ["available", "available"],
    ["needs-setup", "setup"],
    ["requires-approval", "approval"]
  ];
  return <div className="flex flex-wrap justify-end gap-1.5">{items.filter(([status]) => summary[status] > 0).map(([status, label]) => <span key={status} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">{summary[status]} {label}</span>)}</div>;
}

function capabilityStatusLabel(status: EffectiveCapabilityStatus) {
  switch (status) {
    case "available": return "Available";
    case "requires-approval": return "Requires approval";
    case "needs-setup": return "Needs setup";
    case "blocked": return "Blocked";
    case "unavailable": return "Unavailable";
    case "unknown": return "Unknown";
  }
}

function capabilityStatusDot(status: EffectiveCapabilityStatus) {
  switch (status) {
    case "available": return "bg-emerald-500";
    case "requires-approval": return "bg-amber-500";
    case "needs-setup": return "bg-orange-500";
    case "blocked": return "bg-red-500";
    case "unavailable": return "bg-slate-400";
    case "unknown": return "bg-violet-400";
  }
}

function shortId(value: string | null) {
  return value ? `${value.slice(0, 8)}…` : "unknown";
}
