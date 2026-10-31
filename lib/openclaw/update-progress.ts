import type { OpenClawUpdateProgress } from "./application/update-progress-service";
import type { NativeUpdateRunProjection } from "./application/native-doctor-service";

/** Browser-owned correlation metadata, never OpenClaw runtime truth. */
export type OpenClawUpdateAttempt = {
  startedAtMs: number;
  targetVersion: string | null;
  beforeVersion?: string | null;
  previousRunIds: string[];
  runId?: string;
};

export function matchesUpdateAttempt(run: NativeUpdateRunProjection | null, attempt: OpenClawUpdateAttempt) {
  if (!run) return false;
  if (attempt.runId) return run.runId === attempt.runId;
  return !attempt.previousRunIds.includes(run.runId) && run.createdAtMs >= attempt.startedAtMs - 5000 &&
    (!attempt.targetVersion || run.targetVersion?.replace(/^v/, "") === attempt.targetVersion.replace(/^v/, ""));
}

export function mergeUpdateProgress(previous: OpenClawUpdateProgress | null, next: OpenClawUpdateProgress): OpenClawUpdateProgress {
  if (!previous) return next;
  if (Date.parse(next.observedAt) < Date.parse(previous.observedAt)) return previous;
  const run = !next.run ? previous.run
    : previous.run?.runId === next.run.runId && previous.run.updatedAtMs > next.run.updatedAtMs ? previous.run
    : next.run;
  return { ...next, run, currentVersion: next.connected ? next.currentVersion : previous.currentVersion };
}

export function parseUpdateAttempt(value: string | null, now = Date.now()): OpenClawUpdateAttempt | null {
  try {
    const attempt = JSON.parse(value || "null") as OpenClawUpdateAttempt | null;
    if (!attempt || !Number.isFinite(attempt.startedAtMs) || attempt.startedAtMs > now || now - attempt.startedAtMs > 86_400_000 ||
      !Array.isArray(attempt.previousRunIds) || attempt.previousRunIds.length > 10 ||
      !attempt.previousRunIds.every((id) => typeof id === "string" && id.length <= 128) ||
      (attempt.beforeVersion !== undefined && attempt.beforeVersion !== null && (typeof attempt.beforeVersion !== "string" || !/^v?\d{4}\.\d+\.\d+(?:-[\w.-]+)?$/.test(attempt.beforeVersion))) ||
      (attempt.runId !== undefined && (typeof attempt.runId !== "string" || attempt.runId.length > 128)) ||
      (attempt.targetVersion !== null && (typeof attempt.targetVersion !== "string" || !/^v?\d{4}\.\d+\.\d+(?:-[\w.-]+)?$/.test(attempt.targetVersion)))) return null;
    return attempt;
  } catch { return null; }
}
