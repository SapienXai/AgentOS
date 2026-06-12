"use client";

import type { InspectorRuntimeEvidenceView } from "./inspector-utils";

export function RuntimeEvidencePanel({ view }: { view: InspectorRuntimeEvidenceView }) {
  return (
    <section
      data-testid="inspector-runtime-evidence"
      className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.88),rgba(8,13,24,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Runtime evidence</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <EvidenceMetric label="Runtime records" value={view.runtimeIds.length} />
        <EvidenceMetric label="Sessions" value={view.sessionIds.length} />
        <EvidenceMetric label="Runs" value={view.runIds.length} />
        <EvidenceMetric label="Files" value={view.createdFileCount} />
      </div>
      {view.warningCount > 0 ? (
        <p className="mt-3 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {view.warningCount} runtime warning{view.warningCount === 1 ? "" : "s"} are attached to this evidence.
        </p>
      ) : null}
    </section>
  );
}

function EvidenceMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-[13px] text-slate-100">{value}</p>
    </div>
  );
}
