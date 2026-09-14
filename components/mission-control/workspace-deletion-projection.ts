export const pendingWorkspaceDeletionStorageKey = "agentos:pending-deleted-workspaces";

export const pendingWorkspaceDeletionTimeoutMs = 45 * 1000;
export const pendingWorkspaceDeletionRetentionMs = 30 * 60 * 1000;

export type PendingWorkspaceDeletion = {
  id: string;
  name: string;
  requestedAt: number;
};

export function parsePendingWorkspaceDeletions(
  rawValue: string | null,
  referenceTimeMs = Date.now()
): PendingWorkspaceDeletion[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    const byId = new Map<string, PendingWorkspaceDeletion>();

    for (const value of parsed) {
      const entry = normalizePendingWorkspaceDeletion(value, referenceTimeMs);

      if (!entry) {
        continue;
      }

      const existing = byId.get(entry.id);
      if (!existing || entry.requestedAt >= existing.requestedAt) {
        byId.set(entry.id, entry);
      }
    }

    return Array.from(byId.values()).sort(
      (left, right) => right.requestedAt - left.requestedAt || left.id.localeCompare(right.id)
    );
  } catch {
    return [];
  }
}

export function serializePendingWorkspaceDeletions(entries: PendingWorkspaceDeletion[]) {
  return JSON.stringify(entries);
}

export function loadPendingWorkspaceDeletions() {
  if (typeof globalThis.localStorage === "undefined") {
    return [];
  }

  try {
    return parsePendingWorkspaceDeletions(globalThis.localStorage.getItem(pendingWorkspaceDeletionStorageKey));
  } catch {
    return [];
  }
}

function normalizePendingWorkspaceDeletion(
  value: unknown,
  referenceTimeMs: number
): PendingWorkspaceDeletion | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const name = readString(record.name);
  const requestedAt = typeof record.requestedAt === "number" && Number.isFinite(record.requestedAt)
    ? record.requestedAt
    : null;

  if (!id || !name || requestedAt === null || requestedAt <= 0) {
    return null;
  }

  if (referenceTimeMs - requestedAt > pendingWorkspaceDeletionRetentionMs) {
    return null;
  }

  return {
    id,
    name,
    requestedAt
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
