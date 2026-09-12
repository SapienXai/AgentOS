import type {
  WorkspaceCreationActivityCode,
  WorkspaceCreationRun
} from "@/lib/agentos/domains/workspace-creation-run";

/**
 * A bounded, transport-independent projection of what creation has learned.
 * The underlying event stream remains authoritative; this model is only for
 * operator-facing live feedback and deliberately contains no source body.
 */
export type WorkspaceCreationDiscoverySignalKind =
  | "page"
  | "documentation"
  | "resource"
  | "identity"
  | "fact"
  | "technology"
  | "network"
  | "contract"
  | "repository"
  | "social"
  | "governance"
  | "product"
  | "contact"
  | "agent-candidate"
  | "skill-candidate"
  | "file-plan";

export type WorkspaceCreationDiscoverySignalState = "reading" | "found" | "verified" | "inferred" | "attention";

export type WorkspaceCreationDiscoverySignal = {
  id: string;
  kind: WorkspaceCreationDiscoverySignalKind;
  label: string;
  state: WorkspaceCreationDiscoverySignalState;
  sourceId: string | null;
  locator: string | null;
  sequence: number;
};

export type WorkspaceCreationDiscoveryProjection = {
  signals: WorkspaceCreationDiscoverySignal[];
  aggregate: {
    pages: number;
    documents: number;
    facts: number;
    resources: number;
    conflicts: number;
  };
  currentActivity: string;
  currentLocator: string | null;
  historyTruncated: boolean;
};

const MAX_SIGNALS = 32;

const ACTIVITY_LABELS: Partial<Record<WorkspaceCreationActivityCode, string>> = {
  "source-started": "Opening project source",
  "page-discovered": "Page discovered",
  "page-fetch-started": "Reading project page",
  "page-fetched": "Page read",
  "rendered-fallback-started": "Rendering project page",
  "rendered-fallback-used": "Rendered project page read",
  "document-stored": "Project document staged",
  "source-partial": "Source partially read",
  "source-completed": "Source read",
  "source-failed": "Source needs attention",
  "extraction-started": "Structuring project evidence",
  "extraction-completed": "Project evidence structured",
  "extraction-partial": "Project evidence is partial",
  "evidence-created": "Evidence recorded",
  "fact-extracted": "Canonical project claim found",
  "resource-extracted": "Project resource found",
  "resource-verified": "Project resource qualified",
  "conflict-detected": "Project conflict needs review",
  "intelligence-synthesis-started": "Understanding project context",
  "intelligence-fallback": "Using preserved project evidence",
  "intelligence-completed": "Project understanding ready",
  "architect-started": "Preparing workspace design",
  "architect-attempt-started": "Designing workspace",
  "architect-retry-scheduled": "Repairing workspace draft",
  "architect-fallback": "Safe workspace draft created",
  "architect-completed": "Workspace design ready",
  "composition-started": "Preparing workspace files",
  "composition-fallback": "Safe workspace file draft created",
  "composition-completed": "Workspace file plan ready"
};

export function presentWorkspaceCreationDiscovery(run: WorkspaceCreationRun): WorkspaceCreationDiscoveryProjection {
  const entries = new Map<string, WorkspaceCreationDiscoverySignal>();
  let currentActivity = "Reading project context";
  let currentLocator: string | null = null;

  for (const event of run.events ?? []) {
    const code = event.activityCode ?? null;
    const data = event.activityData;
    if (code && ACTIVITY_LABELS[code]) currentActivity = ACTIVITY_LABELS[code]!;
    currentLocator = data?.currentLocator ?? currentLocator;
    if (!code) continue;

    const signal = signalForActivity(event.sequence, code, event.sourceId, data?.currentLocator ?? null, data?.currentActivity ?? null);
    if (!signal) continue;
    const existing = entries.get(signal.id);
    if (!existing || signalStateRank(signal.state) >= signalStateRank(existing.state)) entries.set(signal.id, existing ? { ...existing, ...signal, sequence: Math.max(existing.sequence, signal.sequence) } : signal);
  }

  const snapshot = run.snapshot;
  const aggregate = {
    pages: Math.max(0, snapshot.context.sourceProgress.reduce((sum, source) => sum + source.fetchedItems, 0)),
    documents: Math.max(0, snapshot.context.sourceProgress.reduce((sum, source) => sum + source.storedDocuments, 0)),
    facts: snapshot.extraction.factCount,
    resources: snapshot.extraction.resourceCount,
    conflicts: snapshot.extraction.conflictCount
  };
  addSnapshotSignals(entries, snapshot, aggregate);
  const signals = [...entries.values()]
    .sort((left, right) => right.sequence - left.sequence || left.id.localeCompare(right.id))
    .slice(0, MAX_SIGNALS);
  return {
    signals,
    aggregate,
    currentActivity,
    currentLocator,
    historyTruncated: (run.oldestRetainedSequence ?? 1) > 1
  };
}

function addSnapshotSignals(
  entries: Map<string, WorkspaceCreationDiscoverySignal>,
  snapshot: WorkspaceCreationRun["snapshot"],
  aggregate: WorkspaceCreationDiscoveryProjection["aggregate"]
) {
  const review = snapshot.intelligence.review;
  let sequence = Number.MAX_SAFE_INTEGER;
  const add = (signal: WorkspaceCreationDiscoverySignal) => {
    if (!entries.has(signal.id)) entries.set(signal.id, signal);
    sequence -= 1;
  };

  for (const fact of review?.facts ?? []) {
    add({
      id: `snapshot:fact:${fact.id}`,
      kind: "fact",
      label: displayText(fact.statement, "Canonical project claim"),
      state: signalStateForVerification(fact.verification),
      sourceId: null,
      locator: null,
      sequence
    });
  }
  for (const resource of review?.resources ?? []) {
    add({
      id: `snapshot:resource:${resource.id}`,
      kind: "resource",
      label: displayText(`${resource.label} · ${resource.category}`, "Project resource"),
      state: signalStateForVerification(resource.verification),
      sourceId: null,
      locator: null,
      sequence
    });
  }
  for (const conflict of review?.conflicts ?? []) {
    add({
      id: `snapshot:conflict:${conflict.id}`,
      kind: "resource",
      label: displayText(`Conflict · ${conflict.summary}`, "Project conflict needs review"),
      state: "attention",
      sourceId: null,
      locator: null,
      sequence
    });
  }

  const reviewFactCount = review?.facts.length ?? 0;
  const reviewResourceCount = review?.resources.length ?? 0;
  const reviewConflictCount = review?.conflicts.length ?? 0;
  if (aggregate.facts > reviewFactCount) {
    add({
      id: "snapshot:aggregate:facts",
      kind: "fact",
      label: `${aggregate.facts - reviewFactCount} more canonical claim${aggregate.facts - reviewFactCount === 1 ? "" : "s"} found`,
      state: "found",
      sourceId: null,
      locator: null,
      sequence
    });
  }
  if (aggregate.resources > reviewResourceCount) {
    add({
      id: "snapshot:aggregate:resources",
      kind: "resource",
      label: `${aggregate.resources - reviewResourceCount} more project resource${aggregate.resources - reviewResourceCount === 1 ? "" : "s"} found`,
      state: "found",
      sourceId: null,
      locator: null,
      sequence
    });
  }
  if (aggregate.conflicts > reviewConflictCount) {
    add({
      id: "snapshot:aggregate:conflicts",
      kind: "resource",
      label: `${aggregate.conflicts - reviewConflictCount} more project conflict${aggregate.conflicts - reviewConflictCount === 1 ? "" : "s"} need review`,
      state: "attention",
      sourceId: null,
      locator: null,
      sequence
    });
  }
}

function signalStateForVerification(verification: "declared" | "discovered" | "inferred" | "verified"): WorkspaceCreationDiscoverySignalState {
  if (verification === "verified") return "verified";
  if (verification === "inferred") return "inferred";
  return "found";
}

function displayText(value: string, fallback: string) {
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (safe || fallback).slice(0, 180);
}

function signalForActivity(
  sequence: number,
  code: WorkspaceCreationActivityCode,
  sourceId: string | null,
  locator: string | null,
  activity: string | null
): WorkspaceCreationDiscoverySignal | null {
  const mapping: Partial<Record<WorkspaceCreationActivityCode, { kind: WorkspaceCreationDiscoverySignalKind; state: WorkspaceCreationDiscoverySignalState; label: string }>> = {
    "page-discovered": { kind: "page", state: "found", label: "Project page" },
    "page-fetch-started": { kind: "page", state: "reading", label: "Project page" },
    "page-fetched": { kind: "page", state: "found", label: "Project page" },
    "rendered-fallback-started": { kind: "page", state: "reading", label: "Rendered project page" },
    "rendered-fallback-used": { kind: "page", state: "found", label: "Rendered project page" },
    "document-stored": { kind: "documentation", state: "found", label: "Project document" },
    "fact-extracted": { kind: "fact", state: "found", label: "Project claim" },
    "resource-extracted": { kind: "resource", state: "found", label: "Project resource" },
    "resource-verified": { kind: "resource", state: "verified", label: "Qualified resource" },
    "conflict-detected": { kind: "resource", state: "attention", label: "Conflicting project claim" },
    "composition-completed": { kind: "file-plan", state: "found", label: "Workspace file plan" },
    "composition-fallback": { kind: "file-plan", state: "attention", label: "Safe workspace file draft" }
  };
  const mapped = mapping[code];
  if (!mapped) return null;
  const safeLocator = locator ? locator.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 300) : null;
  const label = safeLocator && mapped.kind !== "fact" && mapped.kind !== "resource" ? `${mapped.label} · ${displayLocator(safeLocator)}` : activity?.trim().slice(0, 160) || mapped.label;
  const id = `${mapped.kind}:${sourceId ?? "run"}:${safeLocator ?? label.toLowerCase()}`.toLowerCase().slice(0, 240);
  return { id, kind: mapped.kind, label, state: mapped.state, sourceId, locator: safeLocator, sequence };
}

function signalStateRank(state: WorkspaceCreationDiscoverySignalState) {
  return { reading: 1, found: 2, inferred: 3, verified: 4, attention: 5 }[state];
}

function displayLocator(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 120);
  } catch {
    return value.slice(0, 120);
  }
}
