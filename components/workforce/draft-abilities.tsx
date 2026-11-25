"use client";

import { useEffect, useState } from "react";
import { DRAFT_TOOL_LABELS } from "@/lib/agentos/domains/draft-abilities";

export function abilityName(id: string) {
  return Object.hasOwn(DRAFT_TOOL_LABELS, id) ? DRAFT_TOOL_LABELS[id] :
    id.replace(/^project-/, "").replaceAll("_", " ").replaceAll("-", " ");
}

export function DraftAbilities({ selected, proposed, onChange }: { selected: string[]; proposed?: string[]; onChange: (ids: string[]) => void }) {
  const [options, setOptions] = useState<Array<{ name: string; description: string }> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!attempt) return;
    const abort = new AbortController();
    void fetch("/api/openclaw/capabilities?view=guided-abilities", { signal: abort.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.tools)) throw new Error("Current ability inventory unavailable.");
        setOptions(data.tools);
      })
      .catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [attempt]);

  const choices = options?.filter(item => !proposed?.includes(item.name));

  return (
    <details className="border-t border-border/75 pt-3" onToggle={event => { if (event.currentTarget.open && !attempt) setAttempt(1); }}>
      <summary className="cursor-pointer text-sm font-medium">Browse abilities</summary>
      <div className="mt-2 space-y-1">
        {!options && !error ? <p role="status" className="text-xs text-muted-foreground">Checking what OpenClaw offers…</p> : null}
        {choices?.map(item => (
          <label key={item.name} className="workforce-row flex cursor-pointer items-start gap-3 px-2 py-2">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={selected.includes(item.name)}
              onChange={event => onChange(event.target.checked ? [...selected, item.name] : selected.filter(id => id !== item.name))} />
            <span><span className="block text-sm font-medium">{abilityName(item.name)}</span><span className="text-xs leading-5 text-muted-foreground">{item.description}</span></span>
          </label>
        ))}
        {choices?.length === 0 && <p className="text-xs text-muted-foreground">No additional abilities are available for guided setup.</p>}
        {error && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span role="status">The current abilities could not be verified.</span>
          <button type="button" className="min-h-9 text-primary underline" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try again</button>
        </div>}
      </div>
    </details>
  );
}
