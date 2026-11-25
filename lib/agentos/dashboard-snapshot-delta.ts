import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type RecordValue = Record<string, unknown>;
type ObjectDelta = { set: RecordValue; unset: string[] };
type IdentifiedRow = { id: string };
type CollectionDelta<Row extends IdentifiedRow> = {
  order: string[];
  added: Row[];
  changed: Array<{ id: string; patch: ObjectDelta }>;
};

export type DashboardSnapshotDelta = {
  baseRevision?: number;
  baseGeneratedAt: string;
  changes: Partial<ControlPlaneSnapshot>;
  diagnostics?: ObjectDelta;
  runtimes?: CollectionDelta<ControlPlaneSnapshot["runtimes"][number]>;
  tasks?: CollectionDelta<ControlPlaneSnapshot["tasks"][number]>;
};

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function objectDelta(previous: object, next: object): ObjectDelta {
  const baseline = previous as RecordValue;
  const current = next as RecordValue;
  return {
    set: Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== undefined && !sameValue(baseline[key], value))),
    unset: Object.keys(previous).filter((key) => baseline[key] !== undefined && (!Object.hasOwn(current, key) || current[key] === undefined))
  };
}

function applyObjectDelta<T extends object>(baseline: T, { set, unset }: ObjectDelta): T {
  const result = { ...baseline, ...set };
  for (const key of unset) delete (result as RecordValue)[key];
  return result;
}

function collectionDelta<Row extends IdentifiedRow>(previous: Row[], next: Row[]): CollectionDelta<Row> | undefined {
  const baseline = new Map(previous.map((row) => [row.id, row]));
  const order = next.map(({ id }) => id);
  if (baseline.size !== previous.length || new Set(order).size !== next.length) return undefined;
  const added: Row[] = [];
  const changed: CollectionDelta<Row>["changed"] = [];
  for (const row of next) {
    const existing = baseline.get(row.id);
    if (!existing) {
      added.push(row);
      continue;
    }
    const patch = objectDelta(existing, row);
    if (Object.keys(patch.set).length || patch.unset.length) changed.push({ id: row.id, patch });
  }
  const delta = { order, added, changed };
  return JSON.stringify(delta).length < JSON.stringify(next).length ? delta : undefined;
}

function applyCollectionDelta<Row extends IdentifiedRow>(baseline: Row[], delta: CollectionDelta<Row>): Row[] | null {
  const rows = new Map([...baseline, ...delta.added].map((row) => [row.id, row]));
  for (const { id, patch } of delta.changed) {
    const row = rows.get(id);
    if (!row) return null;
    rows.set(id, applyObjectDelta(row, patch));
  }
  const ordered = delta.order.map((id) => rows.get(id));
  return ordered.every((row) => row !== undefined) ? ordered : null;
}

export function buildDashboardSnapshotDelta(previous: ControlPlaneSnapshot, next: ControlPlaneSnapshot): DashboardSnapshotDelta | null {
  const { set, unset } = objectDelta(previous, next);
  if (unset.length) return null;
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
    const runtimes = collectionDelta(previous.runtimes, next.runtimes);
    if (runtimes) {
      delete delta.changes.runtimes;
      delta.runtimes = runtimes;
    }
  }
  if (set.tasks) {
    const tasks = collectionDelta(previous.tasks, next.tasks);
    if (tasks) {
      delete delta.changes.tasks;
      delta.tasks = tasks;
    }
  }
  return delta;
}

export function applyDashboardSnapshotDelta(baseline: ControlPlaneSnapshot, delta: DashboardSnapshotDelta): ControlPlaneSnapshot | null {
  if (baseline.revision !== delta.baseRevision || baseline.generatedAt !== delta.baseGeneratedAt) return null;
  const next = { ...baseline, ...delta.changes };
  if (delta.diagnostics) next.diagnostics = applyObjectDelta(baseline.diagnostics, delta.diagnostics);
  if (delta.runtimes) {
    const runtimes = applyCollectionDelta(baseline.runtimes, delta.runtimes);
    if (!runtimes) return null;
    next.runtimes = runtimes;
  }
  if (delta.tasks) {
    const tasks = applyCollectionDelta(baseline.tasks, delta.tasks);
    if (!tasks) return null;
    next.tasks = tasks;
  }
  return next;
}
