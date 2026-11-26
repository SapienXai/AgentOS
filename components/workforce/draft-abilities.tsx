"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { SelectionList } from "@/components/workforce/selection-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DRAFT_TOOL_LABELS } from "@/lib/agentos/domains/draft-abilities";

export function abilityName(id: string) {
  return Object.hasOwn(DRAFT_TOOL_LABELS, id) ? DRAFT_TOOL_LABELS[id] :
    id.replace(/^project-/, "").replaceAll("_", " ").replaceAll("-", " ");
}

type LibraryItem = { id: string; label: string; description?: string; setup: string };
type LibraryResult = {
  groups: Array<{ id: string; label: string; items: LibraryItem[] }>;
  skills: LibraryItem[];
  partial: boolean;
};

function AbilityLibrary() {
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<LibraryResult | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/openclaw/capabilities?view=ability-library", { signal: abort.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "The capability library is unavailable.");
        setCatalog(data);
        setError("");
      })
      .catch(failure => { if (!abort.signal.aborted) setError(failure.message); });
    return () => abort.abort();
  }, [attempt]);
  const query = search.trim().toLowerCase();
  const groups = catalog ? [...catalog.groups, { id: "skills", label: "Skills", items: catalog.skills }]
    .map(group => ({ ...group, items: group.items.filter(item =>
      !query || [item.label, item.description, group.label].join(" ").toLowerCase().includes(query)) }))
    .filter(group => group.items.length) : [];
  return <div className="space-y-3 pt-2">
    <p className="text-sm text-muted-foreground">Browse what OpenClaw reports. Review effective access on the employee’s profile after adding them.</p>
    <a href="/integrations" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline">
      Manage connections <ArrowUpRight className="size-4" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
    </a>
    {catalog ? <>
      {catalog.partial && <p role="status" className="text-sm text-muted-foreground">Some sections could not be verified. The results below are partial.</p>}
      <Input type="search" aria-label="Search the capability library" placeholder="Search tools and skills" value={search}
        onChange={event => setSearch(event.target.value)} className="min-h-11 text-base sm:text-sm" />
      {groups.length ? <div className="max-h-[min(24rem,52dvh)] space-y-1 overflow-y-auto overscroll-contain">
        {groups.map(group => <details key={group.id} open={query ? true : undefined} className="rounded-lg border border-border px-3">
          <summary className="cursor-pointer py-2.5 text-sm font-medium">{group.label} <span className="pl-1 text-xs text-muted-foreground">{group.items.length}</span></summary>
          <ul className="divide-y divide-border">
            {group.items.map(item => <li key={item.id} className="py-2.5">
              <p className="text-sm font-medium">{abilityName(item.label)}</p>
              {item.description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.description}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{item.setup}</p>
            </li>)}
          </ul>
        </details>)}
      </div> : <p className="text-sm text-muted-foreground">{query ? "No matching tools or skills." : "OpenClaw didn’t report any tools or skills."}</p>}
    </> : error ? <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button type="button" size="sm" variant="secondary" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</Button>
    </div> : <p role="status" className="text-sm text-muted-foreground">Checking the capability library…</p>}
  </div>;
}

export function DraftAbilities({ selected, proposed, onChange }: { selected: string[]; proposed?: string[]; onChange: (ids: string[]) => void }) {
  const [options, setOptions] = useState<Array<{ name: string; description: string }> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);

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

  const choices = options;

  return (
    <details className="border-t border-border/75 pt-3" onToggle={event => { if (event.currentTarget.open && !attempt) setAttempt(1); }}>
      <summary className="cursor-pointer py-2 text-sm font-medium">Browse abilities</summary>
      <div className="mt-2 space-y-1">
        {!options && !error ? <p role="status" className="text-xs text-muted-foreground">Checking what OpenClaw offers…</p> : null}
        {choices && <SelectionList label="Abilities" selected={selected} onChange={onChange}
          items={choices.map(item => ({
            id: item.name, label: abilityName(item.name),
            detail: proposed?.includes(item.name) ? "Already included in this employee’s setup" : item.description,
            included: proposed?.includes(item.name)
          }))}
          empty="No additional abilities are available for guided setup." />}
        {error && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span role="status">The current abilities could not be verified.</span>
          <button type="button" className="min-h-9 text-primary underline" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Try again</button>
        </div>}
        <details className="mt-3 border-t border-border/75" onToggle={event => setLibraryOpen(event.currentTarget.open)}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Explore the capability library</summary>
          {libraryOpen && <AbilityLibrary />}
        </details>
      </div>
    </details>
  );
}
