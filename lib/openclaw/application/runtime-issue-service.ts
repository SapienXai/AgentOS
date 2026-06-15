import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  updateRuntimeIssueState
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  runtimeIssueDedupeId,
  type RuntimeIssue,
  type RuntimeIssueSeverity,
  type RuntimeIssueType,
  type RuntimeIssueState
} from "@/lib/openclaw/runtime-issues";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";

const deviceListTimeoutMs = 10_000;
const deviceApproveTimeoutMs = 10_000;

export type RuntimeDeviceReview = {
  command: string;
  rawOutput: string;
  pendingRequests: RuntimeDeviceRequest[];
};

export type RuntimeDeviceRequest = {
  deviceId: string | null;
  requestId: string | null;
  status: string | null;
  requestedScopes: string[];
  approvedScopes: string[];
  createdAt: string | null;
  age: string | null;
  recoveryCommand: string | null;
};

export async function recordOpenClawUpdateRuntimeIssue(input: {
  type: Extract<RuntimeIssueType, "openclaw_update_failed" | "openclaw_postflight_failed" | "openclaw_rollback_needed">;
  title: string;
  message: string;
  severity?: RuntimeIssueSeverity;
  targetVersion?: string | null;
  rawOutput?: string | null;
  errorMessage?: string | null;
  recoveryCommand?: string | null;
  inspectCommand?: string | null;
}) {
  const issueId = runtimeIssueDedupeId({
    type: input.type,
    source: "openclaw_cli",
    requestId: input.targetVersion ?? undefined
  });
  const now = new Date().toISOString();

  await updateRuntimeIssueState(issueId, (current) => ({
    ...current,
    id: issueId,
    type: input.type,
    source: "openclaw_cli",
    severity: input.severity ?? "action_required",
    title: input.title,
    message: input.message,
    status: "failed",
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    recoveryCommand: input.recoveryCommand ?? current?.recoveryCommand,
    inspectCommand: input.inspectCommand ?? "openclaw gateway status --deep",
    rawOutput: input.rawOutput ? redactSecretText(input.rawOutput) : current?.rawOutput,
    errorMessage: input.errorMessage ? redactErrorMessage(input.errorMessage, input.message) : current?.errorMessage
  }));

  invalidateMissionControlSnapshotCache();
}

export async function inspectRuntimeIssueDevices(issueId?: string | null): Promise<{
  issue: RuntimeIssue | null;
  review: RuntimeDeviceReview;
}> {
  const issue = issueId ? await findRuntimeIssue(issueId) : null;
  const adapter = getOpenClawAdapter();
  if (!adapter.listDeviceAccess) {
    throw new Error("OpenClaw device inspection is unavailable in the current adapter.");
  }

  const payload = await adapter.listDeviceAccess({ timeoutMs: deviceListTimeoutMs });
  const rawOutput = redactSecretText(JSON.stringify(redactSecrets(payload), null, 2));
  const pendingRequests = parseRuntimeDeviceRequests(payload);

  if (issue) {
    await updateRuntimeIssueState(issue.id, (current) => ({
      ...runtimeIssueToState(issue),
      ...current,
      id: issue.id,
      status: current?.status === "dismissed" ? "dismissed" : issue.status,
      updatedAt: new Date().toISOString(),
      requestedScopes: pendingRequests.find((entry) => entry.requestId === issue.requestId)?.requestedScopes ?? issue.requestedScopes,
      approvedScopes: pendingRequests.find((entry) => entry.requestId === issue.requestId)?.approvedScopes ?? issue.approvedScopes,
      rawOutput
    }));
  }

  return {
    issue,
    review: {
      command: "openclaw devices list --json",
      rawOutput,
      pendingRequests
    }
  };
}

export async function approveRuntimeIssue(input: {
  issueId?: string | null;
  requestId?: string | null;
  latest?: boolean;
}): Promise<{
  issueId: string;
  approved: boolean;
  result: unknown;
  snapshot: Awaited<ReturnType<typeof getMissionControlSnapshot>>;
}> {
  const issue = input.issueId ? await findRuntimeIssue(input.issueId) : null;
  const requestId = input.requestId?.trim() || issue?.requestId || null;
  const latest = Boolean(input.latest);

  if (!latest && !requestId) {
    throw new Error("A requestId is required before approving a specific OpenClaw scope request.");
  }

  const issueId = issue?.id ?? runtimeIssueDedupeId({
    type: "scope_upgrade_pending",
    source: "openclaw_gateway",
    requestId
  });
  const now = new Date().toISOString();

  await updateRuntimeIssueState(issueId, (current) => ({
    ...(issue ? runtimeIssueToState(issue) : current),
    id: issueId,
    status: "resolving",
    updatedAt: now,
    requestId: requestId ?? current?.requestId,
    recoveryCommand: requestId ? `openclaw devices approve ${requestId}` : current?.recoveryCommand,
    fallbackCommand: "openclaw devices approve --latest"
  }));

  try {
    const result = await getOpenClawAdapter().approveDeviceAccess(
      latest ? { latest: true } : { latest: false, requestId },
      { timeoutMs: deviceApproveTimeoutMs }
    );
    const approvedAt = new Date().toISOString();
    await updateRuntimeIssueState(issueId, (current) => ({
      ...(issue ? runtimeIssueToState(issue) : current),
      id: issueId,
      status: "resolved",
      updatedAt: approvedAt,
      resolvedAt: approvedAt,
      requestId: normalizeString(readRecord(result)?.requestId) ?? requestId ?? current?.requestId,
      requestedScopes: current?.requestedScopes,
      approvedScopes: readStringArray(readRecord(readRecord(result)?.device)?.approvedScopes) ?? current?.approvedScopes,
      rawOutput: redactSecretText(JSON.stringify(redactSecrets(result), null, 2)),
      errorMessage: undefined
    }));

    invalidateMissionControlSnapshotCache();
    const snapshot = await getMissionControlSnapshot({ force: true });

    return {
      issueId,
      approved: true,
      result: redactSecrets(result),
      snapshot
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    await updateRuntimeIssueState(issueId, (current) => ({
      ...(issue ? runtimeIssueToState(issue) : current),
      id: issueId,
      status: "failed",
      updatedAt: failedAt,
      requestId: requestId ?? current?.requestId,
      rawOutput: redactSecretText(readCommandOutput(error)),
      errorMessage: redactErrorMessage(error, "OpenClaw device approval failed.")
    }));
    invalidateMissionControlSnapshotCache();
    throw error;
  }
}

export async function dismissRuntimeIssue(issueId: string) {
  const issue = await findRuntimeIssue(issueId);
  const now = new Date().toISOString();

  await updateRuntimeIssueState(issueId, (current) => ({
    ...(issue ? runtimeIssueToState(issue) : current),
    id: issueId,
    status: "dismissed",
    updatedAt: now,
    dismissedAt: now
  }));

  invalidateMissionControlSnapshotCache();
  return getMissionControlSnapshot({ force: true });
}

async function findRuntimeIssue(issueId: string) {
  const id = issueId.trim();
  if (!id) {
    return null;
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  return snapshot.diagnostics.runtimeIssues.find((issue) => issue.id === id) ?? null;
}

function runtimeIssueToState(issue: RuntimeIssue): RuntimeIssueState {
  return {
    id: issue.id,
    type: issue.type,
    source: issue.source,
    severity: issue.severity,
    title: issue.title,
    message: issue.message,
    requestId: issue.requestId,
    requestedScopes: issue.requestedScopes,
    approvedScopes: issue.approvedScopes,
    command: issue.command,
    recoveryCommand: issue.recoveryCommand,
    fallbackCommand: issue.fallbackCommand,
    inspectCommand: issue.inspectCommand,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    resolvedAt: issue.resolvedAt,
    status: issue.status,
    rawOutput: issue.rawOutput,
    errorMessage: issue.errorMessage
  };
}

function parseRuntimeDeviceRequests(payload: Record<string, unknown>): RuntimeDeviceRequest[] {
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  return pending
    .map((entry) => parseRuntimeDeviceRequest(entry))
    .filter((entry): entry is RuntimeDeviceRequest => Boolean(entry));
}

function parseRuntimeDeviceRequest(value: unknown): RuntimeDeviceRequest | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const requestId = normalizeString(record.requestId) ?? normalizeString(record.id) ?? null;
  const createdAt =
    normalizeString(record.createdAt) ??
    normalizeString(record.created) ??
    normalizeTimestamp(record.ts) ??
    null;

  return {
    deviceId: normalizeString(record.deviceId) ?? normalizeString(record.device) ?? null,
    requestId,
    status: normalizeString(record.status) ?? normalizeString(record.kind) ?? null,
    requestedScopes:
      readStringArray(record.requestedScopes) ??
      readStringArray(record.scopes) ??
      readStringArray(record.requested) ??
      [],
    approvedScopes:
      readStringArray(record.approvedScopes) ??
      readStringArray(record.approved) ??
      [],
    createdAt,
    age: createdAt ? formatAge(createdAt) : normalizeString(record.age) ?? null,
    recoveryCommand: requestId ? `openclaw devices approve ${requestId}` : null
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const output = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));

  return output.length > 0 ? output : null;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const ms = value > 10_000_000_000 ? value : value * 1_000;
  return new Date(ms).toISOString();
}

function formatAge(iso: string) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) {
    return null;
  }

  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function readCommandOutput(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  return stderr || stdout || "";
}
