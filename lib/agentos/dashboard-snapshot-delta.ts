import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type RecordValue = Record<string, unknown>;
type ObjectDelta = { set: RecordValue; unset: string[] };
type RuntimeRows = ControlPlaneSnapshot["runtimes"];
type RuntimeDelta = {
  order: string[];
  added: RuntimeRows;
  changed: Array<{ id: string; patch: ObjectDelta }>;
};

export type DashboardSnapshotDelta = {
  baseRevision?: number;
  baseGeneratedAt: string;
  changes: Partial<ControlPlaneSnapshot>;
  diagnostics?: ObjectDelta;
  runtimes?: RuntimeDelta;
};

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function objectDelta(previous: object, next: object): ObjectDelta {
  const baseline = previous as RecordValue;
  return {
    set: Object.fromEntries(Object.entries(next).filter(([key, value]) => !sameValue(baseline[key], value))),
    unset: Object.keys(previous).filter((key) => !Object.hasOwn(next, key))
  };
}

function applyObjectDelta<T extends object>(baseline: T, { set, unset }: ObjectDelta): T {
  const result = { ...baseline, ...set };
  for (const key of unset) delete (result as RecordValue)[key];
  return result;
}

function runtimeDelta(previous: RuntimeRows, next: RuntimeRows): RuntimeDelta | undefined {
  const baseline = new Map(previous.map((row) => [row.id, row]));
  const order = next.map(({ id }) => id);
  if (baseline.size !== previous.length || new Set(order).size !== next.length) return undefined;
  const added: RuntimeRows = [];
  const changed: RuntimeDelta["changed"] = [];
  for (const row of next) {
    const existing = baseline.get(row.id);
    if (!existing) {
      added.push(row);
      continue;
    }
    const patch = objectDelta(existing, row);
    if (Object.keys(patch.set).length || patch.unset.length) changed.push({ id: row.id, patch });
  }
  return { order, added, changed };
}

export function buildDashboardSnapshotDelta(previous: ControlPlaneSnapshot, next: ControlPlaneSnapshot): DashboardSnapshotDelta | null {
  if (Object.keys(previous).some((key) => !Object.hasOwn(next, key))) return null;
  const { set } = objectDelta(previous, next);
  const delta: DashboardSnapshotDelta = {
    baseRevision: previous.revision,
    baseGeneratedAt: previous.generatedAt,
    changes: set as Partial<ControlPlaneSnapshot>
  };
  if (set.diagnostics) {
    const diagnostics = objectDelta(previous.diagnostics, next.diagnostics);
    if (JSON.stringify(diagnostics).length < JSON.stringify(next.diagnostics).length) {
      delete delta.changes.diagnostics;
      delta.diagnostics = diagnostics;
    }
  }
  if (set.runtimes) {
    const runtimes = runtimeDelta(previous.runtimes, next.runtimes);
    if (runtimes && JSON.stringify(runtimes).length < JSON.stringify(next.runtimes).length) {
      delete delta.changes.runtimes;
      delta.runtimes = runtimes;
    }
  }
  return delta;
}

export function applyDashboardSnapshotDelta(baseline: ControlPlaneSnapshot, delta: DashboardSnapshotDelta): ControlPlaneSnapshot | null {
  if (baseline.revision !== delta.baseRevision || baseline.generatedAt !== delta.baseGeneratedAt) return null;
  const next = { ...baseline, ...delta.changes };
  if (delta.diagnostics) next.diagnostics = applyObjectDelta(baseline.diagnostics, delta.diagnostics);
  if (delta.runtimes) {
    const rows = new Map([...baseline.runtimes, ...delta.runtimes.added].map((row) => [row.id, row]));
    for (const { id, patch } of delta.runtimes.changed) {
      const row = rows.get(id);
      if (!row) return null;
      rows.set(id, applyObjectDelta(row, patch));
    }
    const ordered = delta.runtimes.order.map((id) => rows.get(id));
    if (ordered.some((row) => !row)) return null;
    next.runtimes = ordered as RuntimeRows;
  }
  return next;
}
