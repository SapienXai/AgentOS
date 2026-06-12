"use client";

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export function OverviewGatewaySummaryPanel({ snapshot }: { snapshot: MissionControlSnapshot }) {
  const eventMode = snapshot.diagnostics.eventBridge?.mode ?? "unknown";
  const runtimeState =
    snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable
      ? "writable"
      : "attention";

  return (
    <section
      data-testid="inspector-overview-gateway-summary"
      className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.88),rgba(8,13,24,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Gateway summary</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SummaryMetric label="Health" value={snapshot.diagnostics.health} />
        <SummaryMetric label="Runtime state" value={runtimeState} />
        <SummaryMetric label="Event stream" value={eventMode} />
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-[12px] text-slate-100">{value}</p>
    </div>
  );
}
