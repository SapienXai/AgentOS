"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearWorkspaceCreationMinimizedRun,
  readWorkspaceCreationMinimizedRunId,
  workspaceCreationActivityChangeEvent
} from "@/components/mission-control/workspace-creation-activity";
import type { WorkspaceCreationRun } from "@/lib/agentos/domains/workspace-creation-run";
import { cn } from "@/lib/utils";

const workspaceCreationActivityPollMs = 1200;

function presentWorkspaceCreationActivity(run: WorkspaceCreationRun) {
  if (run.snapshot.state === "review-ready") {
    return {
      title: "Workspace draft ready",
      phase: "Review your workspace",
      complete: true
    };
  }

  const phaseLabels: Record<string, string> = {
    intake: "Starting workspace creation",
    "context-staging": "Reading project context",
    "source-ingestion": "Reading project context",
    "structured-extraction": "Extracting project signals",
    "intelligence-synthesis": "Understanding your project",
    "architect-runtime-preparation": "Preparing the workspace design",
    "architect-reasoning": "Designing your workspace",
    "architect-validation": "Validating the workspace design",
    "workspace-composition": "Preparing workspace files",
    "review-preparation": "Preparing your review"
  };

  return {
    title: "Workspace creation",
    phase: phaseLabels[run.snapshot.stage ?? ""] ?? "Working on your workspace",
    complete: false
  };
}

export function WorkspaceCreationActivityIndicator() {
  const [run, setRun] = useState<WorkspaceCreationRun | null>(null);
  const requestInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlightRef.current) {
      return;
    }

    const minimizedRunId = readWorkspaceCreationMinimizedRunId();
    if (!minimizedRunId) {
      setRun(null);
      return;
    }

    requestInFlightRef.current = true;
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${encodeURIComponent(minimizedRunId)}`, {
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null) as WorkspaceCreationRun & { error?: string } | null;

      if (!response.ok) {
        if (response.status === 404) {
          clearWorkspaceCreationMinimizedRun();
        }
        setRun(null);
        return;
      }

      const runState = payload?.snapshot?.state;
      const isResumable = runState === "pending"
        || runState === "running"
        || runState === "review-ready";
      if (!payload?.runId || !isResumable) {
        clearWorkspaceCreationMinimizedRun();
      }
      setRun(payload?.runId && isResumable ? payload : null);
    } catch {
      // Keep the persisted marker for a later retry, but do not show stale run data.
      setRun(null);
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();

    const interval = window.setInterval(() => {
      void refresh();
    }, workspaceCreationActivityPollMs);
    const handleActivityChange = () => {
      void refresh();
    };

    window.addEventListener(workspaceCreationActivityChangeEvent, handleActivityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(workspaceCreationActivityChangeEvent, handleActivityChange);
    };
  }, [refresh]);

  if (!run) {
    return null;
  }

  const activity = presentWorkspaceCreationActivity(run);

  return (
    <button
      type="button"
      onClick={() => {
        const url = new URL("/", window.location.origin);
        url.searchParams.set("workspaceCreationReopen", Date.now().toString());
        window.location.assign(`${url.pathname}${url.search}`);
      }}
      aria-label="Reopen workspace creation"
      className={cn(
        "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[#e4d7ca] bg-white/95 px-3 py-2 text-left text-[#4d4036] shadow-[0_16px_40px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-transform hover:-translate-x-1/2 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70",
        "dark:border-white/15 dark:bg-[#111827]/95 dark:text-slate-100"
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-[#f3e7db] text-[#9a6d45] dark:bg-violet-400/15 dark:text-violet-200">
        {activity.complete ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> : <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold">{activity.title}</span>
        <span className="block max-w-[210px] truncate text-[10px] text-[#8b7b6e] dark:text-slate-400">{activity.phase}</span>
      </span>
      <span className="ml-1 text-[10px] font-medium text-[#9a6d45] dark:text-violet-200">View</span>
    </button>
  );
}
