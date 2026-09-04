"use client";

import { useState } from "react";
import { Check, Eye, FileCode2, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { EmptyState, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import type { NativeWorkSnapshot, SuggestedWorkProjection } from "@/lib/agentos/contracts";

export function SuggestedWorkPanel({ nativeWork, refresh }: { nativeWork?: NativeWorkSnapshot; refresh: () => Promise<void> }) {
  const [reviewTarget, setReviewTarget] = useState<SuggestedWorkProjection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const availability = nativeWork?.availability.suggestions ?? "unknown";

  if (availability !== "supported") {
    return <SectionCard title="Suggested work" action={<StatusBadge label={availability === "unknown" ? "Unknown" : "Unavailable"} tone="muted" />}>
      <p className="p-4 text-xs leading-5 text-muted-foreground">OpenClaw does not currently advertise task suggestions to AgentOS. Suggested work stays hidden until the native capability is available.</p>
    </SectionCard>;
  }

  const suggestions = nativeWork?.suggestions ?? [];
  const act = async (action: "accept" | "dismiss", suggestion: SuggestedWorkProjection, mode?: SuggestedWorkProjection["availableAcceptModes"][number]) => {
    setBusy(`${action}:${suggestion.id}`);
    try {
      const response = await fetch("/api/task-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, taskId: suggestion.id, mode })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the suggestion.");
      toast.success(action === "accept" ? "Suggested work accepted by OpenClaw." : "Suggested work dismissed.");
      setReviewTarget(null);
      await refresh();
    } catch (error) {
      toast.error(action === "accept" ? "Suggested work was not accepted." : "Suggested work was not dismissed.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally {
      setBusy(null);
    }
  };

  return <>
    <SectionCard title="Suggested work" action={<StatusBadge label="OpenClaw native" tone="purple" />}>
      <div className="border-b border-border bg-primary/[0.035] px-4 py-3 text-xs leading-5 text-muted-foreground"><Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-primary" />These are proposals from OpenClaw, separate from active AgentOS tasks until you accept one.</div>
      {suggestions.length ? <div className="divide-y divide-border">{suggestions.map((suggestion) => <SuggestedWorkRow key={suggestion.id} suggestion={suggestion} busy={busy} onReview={() => setReviewTarget(suggestion)} onDismiss={() => void act("dismiss", suggestion)} />)}</div> : <EmptyState title="No suggested work" description="OpenClaw has no pending task suggestions for the current operator scope." />}
    </SectionCard>
    <SuggestedWorkReviewDialog key={reviewTarget?.id ?? "closed"} target={reviewTarget} busy={busy === `accept:${reviewTarget?.id}`} onClose={() => { if (!busy) setReviewTarget(null); }} onAccept={(mode) => { if (reviewTarget) void act("accept", reviewTarget, mode); }} />
  </>;
}

function SuggestedWorkRow({ suggestion, busy, onReview, onDismiss }: { suggestion: SuggestedWorkProjection; busy: string | null; onReview: () => void; onDismiss: () => void }) {
  return <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><FileCode2 className="h-4 w-4 shrink-0 text-primary" /><p className="truncate text-sm font-semibold text-foreground">{suggestion.title}</p></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{suggestion.summary}</p><p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{suggestion.cwd} · {new Date(suggestion.createdAt).toLocaleString()}</p></div><div className="flex shrink-0 items-center gap-2"><Button variant="secondary" size="sm" className="h-8 rounded-lg" onClick={onReview}><Eye className="mr-1.5 h-3.5 w-3.5" />Review</Button><Button variant="ghost" size="sm" className="h-8 rounded-lg" disabled={busy === `dismiss:${suggestion.id}`} onClick={onDismiss}>{busy === `dismiss:${suggestion.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}<span className="sr-only">Dismiss {suggestion.title}</span></Button></div></div>;
}

function SuggestedWorkReviewDialog({ target, busy, onClose, onAccept }: { target: SuggestedWorkProjection | null; busy: boolean; onClose: () => void; onAccept: (mode: SuggestedWorkProjection["availableAcceptModes"][number]) => void }) {
  const [mode, setMode] = useState<SuggestedWorkProjection["availableAcceptModes"][number]>(target?.availableAcceptModes[0] ?? "worktree");
  const modes = target?.availableAcceptModes ?? [];
  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="w-[calc(100vw-24px)] max-w-[620px] gap-0 overflow-hidden rounded-[20px] border-border bg-popover p-0"><div className="border-b border-border bg-primary/[0.05] px-5 py-4 pr-12"><DialogHeader className="space-y-1"><DialogTitle className="text-base">Review suggested work</DialogTitle><DialogDescription>OpenClaw keeps this proposal separate until you accept or dismiss it.</DialogDescription></DialogHeader></div>{target ? <><div className="max-h-[calc(100dvh-260px)] space-y-4 overflow-y-auto px-5 py-4"><div><p className="text-sm font-semibold text-foreground">{target.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{target.summary}</p></div><div className="rounded-xl border border-border bg-muted/30 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Repository context</p><p className="mt-1 break-all font-mono text-xs text-foreground">{target.cwd}</p><p className="mt-1 text-[10px] text-muted-foreground">Source session: {target.sourceSessionKey}</p></div><div className="rounded-xl border border-border bg-card px-3 py-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Prompt</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground">{target.prompt}</p></div><div className="space-y-1.5"><label htmlFor="suggested-work-mode" className="text-xs font-medium text-foreground">Accept mode</label><select id="suggested-work-mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={!modes.length || busy} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground"><option value="worktree">Managed worktree</option>{modes.filter((entry) => entry !== "worktree").map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select>{!modes.length ? <p className="text-[11px] text-muted-foreground">No native acceptance mode is currently available.</p> : null}</div></div><div className="flex justify-end gap-2 border-t border-border bg-muted/25 px-5 py-3.5"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" disabled={busy || !modes.length} onClick={() => onAccept(mode)}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}{busy ? "Accepting…" : "Accept work"}</Button></div></> : null}</DialogContent></Dialog>;
}
