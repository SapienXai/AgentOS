"use client";

import { BrainCircuit, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

type IntelligenceStatusPayload = {
  status?: "current" | "update-available" | "partial" | "unknown";
  reason?: string;
  enrichment?: {
    status?: "idle" | "running" | "current" | "update-available" | "failed";
    creationRunId?: string | null;
    durationMs?: number | null;
  };
  candidate?: { creationRunId?: string | null } | null;
  drift?: { categories?: string[] } | null;
};

export function WorkspaceIntelligenceStatusIndicator({ workspaceId, surfaceTheme, onReviewUpdates }: { workspaceId: string | null; surfaceTheme: "light" | "dark"; onReviewUpdates?: (creationRunId: string) => void }) {
  const [payload, setPayload] = useState<IntelligenceStatusPayload | null>(null);
  const isLight = surfaceTheme === "light";

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/intelligence-status`, { signal: controller.signal, cache: "no-store" });
        const next = (await response.json().catch(() => null)) as IntelligenceStatusPayload | null;
        if (!disposed && response.ok && next) setPayload(next);
      } catch {
        // Workspace status is an optional projection; creation and provisioning stay independent.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [workspaceId]);

  const enrichmentStatus = payload?.enrichment?.status;
  const visible = enrichmentStatus === "running" || enrichmentStatus === "update-available" || enrichmentStatus === "failed" || payload?.status === "update-available";
  if (!workspaceId || !visible) return null;

  const updateAvailable = enrichmentStatus === "update-available" || payload?.status === "update-available";
  const failed = enrichmentStatus === "failed";
  const candidateCreationRunId = payload?.candidate?.creationRunId ?? payload?.enrichment?.creationRunId ?? null;
  const updateAreaCount = payload?.drift?.categories?.length ?? 0;
  return (
    <div className={`pointer-events-auto fixed right-4 top-4 z-[65] flex max-w-[min(360px,calc(100vw-2rem))] items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur-xl ${isLight ? "border-[#e5dbd0] bg-white/95 text-[#55483e]" : "border-white/10 bg-slate-950/90 text-slate-200"}`} role="status" aria-live="polite">
      {failed ? <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" /> : enrichmentStatus === "running" ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-violet-300 motion-reduce:animate-none" aria-hidden="true" /> : <BrainCircuit className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />}
      <span className="min-w-0"><span className="font-medium">{failed ? "Background learning needs attention" : updateAvailable ? "Workspace update available" : "Learning in background"}</span><span className="ml-1.5 opacity-70">{failed ? "The original workspace is unchanged." : updateAvailable ? `${updateAreaCount ? `${updateAreaCount} area${updateAreaCount === 1 ? "" : "s"} to review. ` : "A candidate is ready. "}Nothing changed automatically.` : "Your workspace is ready while AgentOS finishes the optional pass."}</span></span>
      {updateAvailable && candidateCreationRunId && onReviewUpdates ? <button type="button" onClick={() => onReviewUpdates(candidateCreationRunId)} className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${isLight ? "text-[#8c5f3d] hover:bg-[#f3e7db]" : "text-violet-200 hover:bg-violet-400/10"}`}>Review updates</button> : null}
    </div>
  );
}
