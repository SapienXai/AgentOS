"use client";

import { useState, type KeyboardEvent, type RefObject } from "react";

import { Lock, X } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { type CapabilityOption } from "@/lib/openclaw/capability-editor";
import { cn } from "@/lib/utils";

const INITIAL_SUGGESTION_COUNT = 8;

type AgentCapabilityEditorColumnProps = {
  title: string;
  selectedValues: string[];
  selectedTone: "cyan" | "amber";
  selectedEmptyLabel: string;
  lockedValues?: string[];
  observedValues?: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onRemove: (value: string) => void;
  onPick: (value: string) => void;
  suggestions: CapabilityOption[];
  emptySuggestionLabel: string;
  loading: boolean;
  catalogError: string | null;
  helperLabel: string;
  currentHintLabel: string;
};

export function AgentCapabilityEditorColumn({
  title,
  selectedValues,
  selectedTone,
  selectedEmptyLabel,
  lockedValues = [],
  observedValues = [],
  inputRef,
  inputValue,
  onInputValueChange,
  onRemove,
  onPick,
  suggestions,
  emptySuggestionLabel,
  loading,
  catalogError,
  helperLabel,
  currentHintLabel
}: AgentCapabilityEditorColumnProps) {
  const [showAllSelected, setShowAllSelected] = useState(false);
  const toneClasses =
    selectedTone === "cyan"
      ? {
          border: "border-cyan-300/20",
          chip: "border-cyan-300/30 bg-cyan-400/10 text-[var(--cap-text-strong)]",
          chipHover: "hover:border-cyan-200/45 hover:bg-cyan-400/15"
        }
      : {
          border: "border-amber-300/20",
          chip: "border-amber-300/30 bg-amber-400/10 text-[var(--cap-text-strong)]",
          chipHover: "hover:border-amber-200/45 hover:bg-amber-400/15"
        };

  const hasLocked = lockedValues.length > 0;
  const lockedValueSet = new Set(lockedValues);
  const selectedSectionLabel = `Current ${title.toLowerCase()}`;
  const suggestionPanelKey = `${title}:${inputValue}:${suggestions.length}:${suggestions[0]?.value ?? ""}`;
  const visibleSelectedValues = showAllSelected ? selectedValues : selectedValues.slice(0, 2);
  const hiddenSelectedCount = Math.max(selectedValues.length - visibleSelectedValues.length, 0);

  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--cap-text-subtle)]">{title}</p>
        <Badge variant="muted" className="border-[var(--cap-border)] bg-[var(--cap-panel-strong)] text-[var(--cap-text-muted)]">Declared</Badge>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--cap-text-subtle)]">{selectedSectionLabel}</p>
              <p className="hidden text-[10px] leading-4 text-[var(--cap-text-muted)] sm:block">{currentHintLabel}</p>
            </div>
            <Badge variant="muted">{selectedValues.length} current</Badge>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {selectedValues.length > 0 ? (
              visibleSelectedValues.map((value) => {
                const isLocked = lockedValueSet.has(value);

                return (
                  <div
                    key={value}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors",
                      toneClasses.chip,
                      toneClasses.chipHover,
                      isLocked && "cursor-not-allowed pr-2.5"
                    )}
                    title={isLocked ? `Managed by policy: ${value}` : value}
                  >
                    <span className="max-w-full truncate">{value}</span>
                    {isLocked ? (
                      <span className="inline-flex items-center gap-1 text-white/70">
                        <Lock className="h-3 w-3" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Remove ${value}`}
                        title={`Remove ${value}`}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--cap-border)] bg-[var(--cap-panel-strong)] text-[var(--cap-text-muted)] transition-colors hover:bg-[var(--cap-panel-hover)] hover:text-[var(--cap-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 focus-visible:ring-offset-0"
                        onClick={() => onRemove(value)}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <Badge variant="muted">{selectedEmptyLabel}</Badge>
            )}
            {hiddenSelectedCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllSelected(true)}
                className="inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.04] px-2 text-[10px] font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                +{hiddenSelectedCount} more
              </button>
            ) : null}
            {showAllSelected && selectedValues.length > 2 ? (
              <button
                type="button"
                onClick={() => setShowAllSelected(false)}
                className="inline-flex h-7 items-center rounded-full px-1 text-[10px] text-slate-400 hover:text-white"
              >
                Show less
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => onInputValueChange(event.target.value)}
            onKeyDown={(event) => handleCapabilityInputKeyDown(event, suggestions, onPick)}
            placeholder={title === "Skills" ? "Search OpenClaw or workspace skills" : "Search built-in tools or plugin tools"}
            className="h-9 flex-1 rounded-[9px] border-[var(--cap-border)] bg-[var(--cap-panel-strong)] px-3 text-[12px] text-[var(--cap-text-strong)] placeholder:text-[var(--cap-text-subtle)]"
          />
        </div>

        <div className="space-y-2">
          <CapabilitySuggestionPanel
            key={suggestionPanelKey}
            kind={title === "Skills" ? "skill" : "tool"}
            suggestions={suggestions}
            onPick={onPick}
            emptyLabel={emptySuggestionLabel}
          />
        </div>

        {hasLocked ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--cap-text-subtle)]">Policy locked</p>
            <div className="flex flex-wrap gap-2">
              {lockedValues.map((value) => (
                <Badge key={value} variant="success">
                  <Lock className="mr-1 h-3 w-3" />
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {observedValues.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--cap-text-subtle)]">Observed</p>
            <div className="flex flex-wrap gap-2">
              {observedValues.slice(0, 10).map((value) => (
                <Badge key={value} variant="muted">
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]">{helperLabel}</p>
        {catalogError ? <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]">{catalogError}</p> : null}
        {loading && suggestions.length === 0 ? (
          <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]">Loading OpenClaw catalog...</p>
        ) : null}
      </div>
    </div>
  );
}

function CapabilitySuggestionPanel({
  kind,
  suggestions,
  onPick,
  emptyLabel
}: {
  kind: CapabilityOption["kind"];
  suggestions: CapabilityOption[];
  onPick: (value: string) => void;
  emptyLabel: string;
}) {
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(INITIAL_SUGGESTION_COUNT);
  const visibleSuggestions = suggestions.slice(0, visibleSuggestionCount);
  const remainingSuggestionCount = Math.max(suggestions.length - visibleSuggestions.length, 0);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--cap-text-subtle)]">Available to add</p>
        <Badge variant="muted">{suggestions.length} total</Badge>
      </div>

      <div className="space-y-1.5">
        <CapabilityOptionList
          kind={kind}
          options={visibleSuggestions}
          onPick={onPick}
          emptyLabel={emptyLabel}
        />

        {remainingSuggestionCount > 0 ? (
          <button
            type="button"
            onClick={() => setVisibleSuggestionCount((current) => current + INITIAL_SUGGESTION_COUNT)}
            className="group flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--cap-border)] bg-[var(--cap-accent-soft)] px-3 py-2.5 text-[11px] font-medium text-[var(--cap-accent)] transition-colors hover:border-violet-300/45 hover:bg-[var(--cap-panel-hover)]"
          >
            <span className="uppercase tracking-[0.18em]">Load more</span>
            <Badge variant="muted" className="h-5 border-[var(--cap-border)] bg-[var(--cap-panel-strong)] px-2 py-0 text-[10px] text-[var(--cap-text)]">
              +{remainingSuggestionCount}
            </Badge>
          </button>
        ) : null}
      </div>
    </>
  );
}

function CapabilityOptionList({
  kind,
  options,
  onPick,
  emptyLabel
}: {
  kind: CapabilityOption["kind"];
  options: CapabilityOption[];
  onPick: (value: string) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p className="text-[11px] leading-5 text-[var(--cap-text-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "group flex w-full items-start justify-between gap-3 rounded-[10px] border border-[var(--cap-border-subtle)] bg-[var(--cap-panel-strong)] px-3 py-2 text-left transition-colors hover:border-violet-300/35 hover:bg-[var(--cap-panel-hover)]",
            kind === "tool" && "hover:border-amber-300/20 hover:bg-amber-400/[0.05]"
          )}
          onClick={() => onPick(option.value)}
          title={option.description}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[12px] leading-4 text-[var(--cap-text-strong)]">{option.label}</p>
              {option.category === "group" ? <Badge variant="muted">group</Badge> : null}
            </div>
            <p className="line-clamp-2 text-[11px] leading-4 text-[var(--cap-text-muted)]">{option.description}</p>
          </div>
          <Badge
            variant={getCapabilityBadgeVariant(option)}
            className="shrink-0 h-4 max-w-[132px] px-1.5 py-0 text-[8px] font-medium tracking-[0.08em] normal-case"
          >
            <span className="truncate">{option.sourceLabel}</span>
          </Badge>
        </button>
      ))}
    </div>
  );
}

function getCapabilityBadgeVariant(option: CapabilityOption): BadgeProps["variant"] {
  if (option.kind === "skill") {
    if (option.category === "workspace") {
      return "success";
    }

    if (option.category === "custom") {
      return "muted";
    }

    return "default";
  }

  if (option.category === "plugin") {
    return "warning";
  }

  if (option.category === "group" || option.category === "custom") {
    return "muted";
  }

  return "default";
}

function handleCapabilityInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  suggestions: CapabilityOption[],
  onPick: (value: string) => void
) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  const firstSuggestion = suggestions[0];

  if (firstSuggestion) {
    onPick(firstSuggestion.value);
  }
}
