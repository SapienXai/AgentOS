"use client";

import type { InspectorAgentRuntimeView } from "./inspector-utils";

export function AgentRuntimeSummaryPanel({ view }: { view: InspectorAgentRuntimeView }) {
  return (
    <section
      data-testid="inspector-agent-runtime-summary"
      className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.88),rgba(8,13,24,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Runtime summary</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <SummaryMetric label="Active runtimes" value={view.activeRuntimeIds.length} />
        <SummaryMetric label="Active sessions" value={view.activeSessionIds.length} />
        <SummaryMetric label="Active runs" value={view.activeRunIds.length} />
        <SummaryMetric label="Recorded sessions" value={view.recordedSessionCount} />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-slate-400">
        {view.recoveredRuntimeCount > 0
          ? `${view.recoveredRuntimeCount} runtime record${view.recoveredRuntimeCount === 1 ? "" : "s"} linked to this agent in the current snapshot.`
          : "No runtime records are linked to this agent in the current snapshot."}
      </p>
    </section>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-[13px] text-slate-100">{value}</p>
    </div>
  );
}
