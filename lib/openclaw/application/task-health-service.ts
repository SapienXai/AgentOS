import "server-only";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import type { TaskAuditSummary } from "@/lib/openclaw/types";

export interface TaskHealthAuditResult {
  command: string;
  transport: "cli-fallback";
  completedAt: string;
  audit: TaskAuditSummary;
}

type TaskHealthAuditDeps = {
  runOpenClawJson?: typeof runOpenClawJson;
};

export async function runTaskHealthAudit(
  options: { timeoutMs?: number } = {},
  deps: TaskHealthAuditDeps = {}
): Promise<TaskHealthAuditResult> {
  const auditPayload = await (deps.runOpenClawJson ?? runOpenClawJson)<unknown>(
    ["tasks", "audit", "--json"],
    { timeoutMs: options.timeoutMs ?? 30_000 }
  );
  const completedAt = new Date().toISOString();

  return {
    command: "openclaw tasks audit --json",
    transport: "cli-fallback",
    completedAt,
    audit: normalizeTaskAuditSummary(auditPayload)
  };
}

function normalizeTaskAuditSummary(payload: unknown): TaskAuditSummary {
  const candidate = findTaskAuditRecord(payload);
  if (!candidate) {
    return {
      state: "unknown",
      total: 0,
      warnings: 0,
      errors: 0,
      byCode: {},
      explanation: "Task audit returned an unstructured payload."
    };
  }

  const total = readNumber(candidate?.total) ?? 0;
  const warnings = readNumber(candidate?.warnings) ?? 0;
  const errors = readNumber(candidate?.errors) ?? 0;
  const explicitState = readString(candidate?.state);
  const state = resolveTaskAuditState(explicitState, total, warnings, errors);
  const explanation =
    readString(candidate?.explanation) ??
    readString(candidate?.summary) ??
    readString(candidate?.message) ??
    resolveTaskAuditExplanation(state, total, warnings, errors);

  return {
    state,
    total,
    warnings,
    errors,
    byCode: readNumberRecord(candidate?.byCode),
    explanation
  };
}

function findTaskAuditRecord(payload: unknown): Record<string, unknown> | null {
  const candidates: unknown[] = [];

  if (isRecord(payload)) {
    candidates.push(payload.taskAudit, payload.audit, payload.report, payload.result, payload.summary, payload);
  } else if (Array.isArray(payload)) {
    candidates.push(...payload);
  }

  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveTaskAuditState(
  explicitState: string | null,
  total: number,
  warnings: number,
  errors: number
): TaskAuditSummary["state"] {
  if (explicitState === "clean" || explicitState === "findings" || explicitState === "error" || explicitState === "unknown") {
    return explicitState;
  }

  if (errors > 0 || warnings > 0 || total > 0) {
    return "findings";
  }

  return "clean";
}

function resolveTaskAuditExplanation(
  state: TaskAuditSummary["state"],
  total: number,
  warnings: number,
  errors: number
) {
  if (state === "clean") {
    return "Task audit found no repairable task state issues.";
  }

  if (state === "error") {
    return "Task audit reported an execution error.";
  }

  if (state === "unknown") {
    return "Task audit returned an unstructured payload.";
  }

  const detail = [
    errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null,
    warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null,
    total > 0 ? `${total} total item${total === 1 ? "" : "s"}` : null
  ].filter(Boolean);

  return detail.length > 0
    ? `Task audit reported ${detail.join(", ")}.`
    : "Task audit reported findings.";
}

function readNumberRecord(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = readNumber(entry);
    if (parsed !== null) {
      result[key] = parsed;
    }
  }

  return result;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
