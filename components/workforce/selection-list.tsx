"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SelectionItem = {
  id: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
  unavailable?: boolean;
  included?: boolean;
};

export function SelectionList({ label, items, selected, onChange, limit, disabled, empty }: {
  label: string;
  items: SelectionItem[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  limit?: number;
  disabled?: boolean;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const selectedIds = new Set(selected);
  const needle = query.trim().toLowerCase();
  const matches = items.filter(item => (item.label + " " + (item.detail ?? "")).toLowerCase().includes(needle));
  const atLimit = limit !== undefined && selected.length >= limit;
  return (
    <fieldset className="min-w-0 space-y-3" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {items.length > 2 && <div className="relative min-w-[12rem] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={"Search " + label.toLowerCase()} placeholder={"Search " + label.toLowerCase()}
            className="min-h-11 pl-9 text-base sm:text-sm" value={query} onChange={event => setQuery(event.target.value)} />
        </div>}
        <p className="text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">{selected.length} selected</p>
      </div>
      {atLimit && <p className="text-xs text-muted-foreground">Up to {limit} selections at a time.</p>}
      {matches.length ? <div className={cn("divide-y divide-border rounded-xl border border-border", matches.length > 8 && "max-h-[min(22rem,42dvh)] overflow-y-auto")}>
        {matches.map(item => {
          const checked = selectedIds.has(item.id);
          return <label key={item.id} className="flex min-h-12 cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50 has-[:disabled]:cursor-default">
            <input type="checkbox" checked={checked || item.included === true} disabled={item.included || (!checked && (item.unavailable || atLimit))}
              className="mt-1 size-4 shrink-0 accent-primary"
              onChange={event => onChange(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
            {item.icon}
            <span className="min-w-0"><span className="block break-words text-sm font-medium">{item.label}</span>
              {item.detail && <span className="block text-xs leading-5 text-muted-foreground">{item.detail}</span>}
            </span>
          </label>;
        })}
      </div> : <p className="text-sm text-muted-foreground">{needle ? "No matches. Try a different search." : empty}</p>}
    </fieldset>
  );
}
