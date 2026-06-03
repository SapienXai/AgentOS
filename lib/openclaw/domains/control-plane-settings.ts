import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  OpenClawCompatibilitySmokeReport,
  OpenClawRuntimeSmokeTest,
  OpenClawSmokeTestCheck
} from "@/lib/agentos/contracts";
import {
  buildOpenAiCodexAuthLoginCommand,
  isOpenAiCodexAuthFailure,
  resolveOpenAiCodexAuthRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const missionControlSettingsPath = path.join(missionControlRootPath, "settings.json");
const runtimeSmokeTestTtlMs = 12 * 60 * 60 * 1000;
const providerAuthSmokeTestTtlMs = 5 * 60 * 1000;
const allowRemoteGatewayUrlEnv = "AGENTOS_ALLOW_REMOTE_GATEWAY_URL";

export type RuntimeSmokeTestCacheEntry = {
  status: "passed" | "failed";
  checkedAt: string;
  runId?: string;
  summary?: string;
  error?: string;
};

export type MissionControlSettings = {
  workspaceRoot?: string;
  runtimePreflight?: {
    smokeTests?: Record<string, RuntimeSmokeTestCacheEntry>;
  };
  compatibilitySmokeTest?: OpenClawCompatibilitySmokeReport;
};

export function normalizeGatewayRemoteUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  let parsed: URL;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Gateway address must be a valid WebSocket URL.");
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("Gateway address must start with ws:// or wss://.");
  }

  if (!parsed.hostname) {
    throw new Error("Gateway address must include a hostname.");
  }

  if (!isLoopbackGatewayHost(parsed.hostname) && process.env[allowRemoteGatewayUrlEnv] !== "1") {
    throw new Error(`Gateway address must target localhost unless ${allowRemoteGatewayUrlEnv}=1 is set.`);
  }

  return parsed.toString().replace(/\/$/, "");
}

export function normalizeWorkspaceRoot(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed !== "~" && !trimmed.startsWith("~/") && !path.isAbsolute(trimmed)) {
    throw new Error("Workspace root must be an absolute path or start with ~/.");
  }

  return normalizeConfiguredWorkspaceRootValue(trimmed);
}

export function normalizeConfiguredWorkspaceRootValue(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const expanded = expandHomeRelativePath(trimmed);
  const normalized = path.normalize(expanded);

  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, "") : normalized;
}

export async function getConfiguredWorkspaceRoot() {
  const settings = await readMissionControlSettings();
  return normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;
}

export async function readMissionControlSettings(): Promise<MissionControlSettings> {
  let raw: string;

  try {
    raw = await readFile(missionControlSettingsPath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const workspaceRoot =
      typeof parsed.workspaceRoot === "string"
        ? normalizeConfiguredWorkspaceRootValue(parsed.workspaceRoot)
        : undefined;
    const runtimePreflight = normalizeRuntimePreflightSettings(
      typeof parsed.runtimePreflight === "object" && parsed.runtimePreflight ? parsed.runtimePreflight : undefined
    );
    const compatibilitySmokeTest = normalizeCompatibilitySmokeTest(parsed.compatibilitySmokeTest);

    return {
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(runtimePreflight ? { runtimePreflight } : {}),
      ...(compatibilitySmokeTest ? { compatibilitySmokeTest } : {})
    };
  } catch {
    return {};
  }
}

export async function writeMissionControlSettings(settings: MissionControlSettings) {
  await mkdir(missionControlRootPath, { recursive: true });
  await writeFile(missionControlSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(missionControlSettingsPath, 0o600);
}

function isLoopbackGatewayHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4MappedLoopback = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4MappedLoopback) {
    return isLoopbackGatewayHost(ipv4MappedLoopback[1]);
  }

  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) && parts[0] === 127;
}

export function getRuntimeSmokeTestCacheEntry(settings: MissionControlSettings, agentId: string) {
  return settings.runtimePreflight?.smokeTests?.[agentId] ?? null;
}

export function mapRuntimeSmokeTestEntry(
  agentId: string | null,
  entry: RuntimeSmokeTestCacheEntry | null
): OpenClawRuntimeSmokeTest {
  if (!entry || !agentId || isStaleProviderAuthSmokeTestFailure(entry)) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: null
    };
  }

  return {
    status: entry.status,
    checkedAt: entry.checkedAt,
    agentId,
    runId: entry.runId ?? null,
    summary: entry.summary ?? null,
    error: normalizeRuntimeSmokeTestError(entry.error ?? null)
  };
}

export function getLatestRuntimeSmokeTest(settings: MissionControlSettings): OpenClawRuntimeSmokeTest {
  const latest = listRuntimeSmokeTestEntries(settings)[0];
  return mapRuntimeSmokeTestEntry(latest?.[0] ?? null, latest?.[1] ?? null);
}

export function getLatestOpenClawCompatibilitySmokeTest(settings: MissionControlSettings) {
  return settings.compatibilitySmokeTest ?? null;
}

export function isRuntimeSmokeTestFresh(entry: RuntimeSmokeTestCacheEntry | null) {
  if (!entry || entry.status !== "passed") {
    return false;
  }

  const checkedAt = Date.parse(entry.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt <= runtimeSmokeTestTtlMs;
}

export async function persistRuntimeSmokeTest(result: OpenClawRuntimeSmokeTest) {
  const settings = await readMissionControlSettings();
  const smokeTests = {
    ...(settings.runtimePreflight?.smokeTests ?? {})
  };

  if (!result.agentId || result.status === "not-run" || !result.checkedAt) {
    return;
  }

  smokeTests[result.agentId] = {
    status: result.status,
    checkedAt: result.checkedAt,
    ...(result.runId ? { runId: result.runId } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.error ? { error: result.error } : {})
  };

  await writeMissionControlSettings({
    ...settings,
    runtimePreflight: {
      smokeTests
    }
  });
}

export async function persistOpenClawCompatibilitySmokeTest(result: OpenClawCompatibilitySmokeReport) {
  const settings = await readMissionControlSettings();

  await writeMissionControlSettings({
    ...settings,
    compatibilitySmokeTest: normalizeCompatibilitySmokeTest(result) ?? result
  });
}

export async function clearOpenAiCodexAuthRuntimeSmokeFailures() {
  const settings = await readMissionControlSettings();
  const smokeTests = settings.runtimePreflight?.smokeTests ?? {};
  const nextSmokeTests = Object.fromEntries(
    Object.entries(smokeTests).filter(([, entry]) => {
      return !(entry.status === "failed" && isOpenAiCodexAuthFailure(entry.error ?? ""));
    })
  );

  if (Object.keys(nextSmokeTests).length === Object.keys(smokeTests).length) {
    return false;
  }

  const nextSettings: MissionControlSettings = { ...settings };
  if (Object.keys(nextSmokeTests).length > 0) {
    nextSettings.runtimePreflight = {
      smokeTests: nextSmokeTests
    };
  } else {
    delete nextSettings.runtimePreflight;
  }

  await writeMissionControlSettings(nextSettings);

  return true;
}

export function getLatestOpenAiCodexAuthRuntimeSmokeFailure(settings: MissionControlSettings) {
  const latest = listRuntimeSmokeTestEntries(settings).find(([, entry]) => {
    return (
      entry.status === "failed" &&
      isOpenAiCodexAuthFailure(entry.error ?? "") &&
      !isStaleProviderAuthSmokeTestFailure(entry)
    );
  });

  return latest?.[1] ?? null;
}

function listRuntimeSmokeTestEntries(settings: MissionControlSettings) {
  return Object.entries(settings.runtimePreflight?.smokeTests ?? {}).sort((left, right) => {
    const leftTs = Date.parse(left[1].checkedAt);
    const rightTs = Date.parse(right[1].checkedAt);
    return rightTs - leftTs;
  });
}

function normalizeRuntimePreflightSettings(value: unknown): MissionControlSettings["runtimePreflight"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const smokeTestsSource =
    "smokeTests" in value && value.smokeTests && typeof value.smokeTests === "object"
      ? (value.smokeTests as Record<string, unknown>)
      : {};
  const smokeTests = Object.entries(smokeTestsSource).reduce<Record<string, RuntimeSmokeTestCacheEntry>>(
    (result, [agentId, entry]) => {
      if (!entry || typeof entry !== "object") {
        return result;
      }

      const normalizedEntry = entry as Record<string, unknown>;

      const checkedAt = typeof normalizedEntry.checkedAt === "string" ? normalizedEntry.checkedAt : null;
      const status =
        normalizedEntry.status === "passed" || normalizedEntry.status === "failed"
          ? normalizedEntry.status
          : null;

      if (!checkedAt || !status) {
        return result;
      }

      result[agentId] = {
        status,
        checkedAt,
        ...(typeof normalizedEntry.runId === "string" ? { runId: normalizedEntry.runId } : {}),
        ...(typeof normalizedEntry.summary === "string" ? { summary: normalizedEntry.summary } : {}),
        ...(typeof normalizedEntry.error === "string"
          ? { error: normalizeRuntimeSmokeTestError(normalizedEntry.error) ?? normalizedEntry.error }
          : {})
      };
      return result;
    },
    {}
  );

  return Object.keys(smokeTests).length > 0 ? { smokeTests } : undefined;
}

function normalizeCompatibilitySmokeTest(value: unknown): OpenClawCompatibilitySmokeReport | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const status = normalizeCompatibilityStatus(candidate.status);
  const checkedAt = typeof candidate.checkedAt === "string" && candidate.checkedAt.trim()
    ? candidate.checkedAt
    : null;
  const compatibility = normalizeCompatibilitySummary(candidate.compatibility);

  if (!status || !checkedAt || !compatibility) {
    return undefined;
  }

  const durationMs = typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs)
    ? Math.max(0, candidate.durationMs)
    : 0;
  const safeToDispatchMissions = candidate.safeToDispatchMissions === true;
  const recovery = typeof candidate.recovery === "string" && candidate.recovery.trim()
    ? candidate.recovery.trim()
    : "Review OpenClaw compatibility diagnostics, then rerun the smoke test.";
  const checks = Array.isArray(candidate.checks)
    ? candidate.checks.map(normalizeCompatibilitySmokeCheck).filter((entry): entry is OpenClawSmokeTestCheck => Boolean(entry))
    : [];

  return {
    status,
    checkedAt,
    durationMs,
    safeToDispatchMissions,
    recovery,
    checks,
    compatibility
  };
}

function normalizeCompatibilitySmokeCheck(value: unknown): OpenClawSmokeTestCheck | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const status = normalizeSmokeCheckStatus(candidate.status);
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null;
  const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : null;
  const summary = typeof candidate.summary === "string" && candidate.summary.trim() ? candidate.summary.trim() : null;

  if (!id || !label || !status || !summary) {
    return null;
  }

  return {
    id,
    label,
    status,
    required: candidate.required === true,
    summary,
    recovery: typeof candidate.recovery === "string" && candidate.recovery.trim()
      ? candidate.recovery.trim()
      : null,
    durationMs: typeof candidate.durationMs === "number" && Number.isFinite(candidate.durationMs)
      ? Math.max(0, candidate.durationMs)
      : 0,
    ...(candidate.rawDetails !== undefined ? { rawDetails: candidate.rawDetails } : {})
  };
}

function normalizeCompatibilitySummary(value: unknown): OpenClawCompatibilitySmokeReport["compatibility"] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const range = candidate.agentOsSupportedProtocolRange && typeof candidate.agentOsSupportedProtocolRange === "object"
    ? candidate.agentOsSupportedProtocolRange as Record<string, unknown>
    : null;
  const rangeMin = typeof range?.min === "number" && Number.isFinite(range.min) ? range.min : null;
  const rangeMax = typeof range?.max === "number" && Number.isFinite(range.max) ? range.max : null;

  if (rangeMin === null || rangeMax === null) {
    return null;
  }

  return {
    installedVersion: normalizeOptionalString(candidate.installedVersion),
    requiredOpenClawVersion: normalizeOptionalString(candidate.requiredOpenClawVersion),
    recommendedOpenClawVersion: normalizeOptionalString(candidate.recommendedOpenClawVersion),
    gatewayProtocolVersion: normalizeOptionalString(candidate.gatewayProtocolVersion),
    requiredGatewayProtocolVersion: normalizeOptionalString(candidate.requiredGatewayProtocolVersion) ?? "4",
    agentOsSupportedProtocolRange: {
      min: rangeMin,
      max: rangeMax
    },
    nodeVersion: normalizeOptionalString(candidate.nodeVersion),
    nodeRequiredVersion: normalizeOptionalString(candidate.nodeRequiredVersion) ?? "22.19.0",
    nodeRecommendedVersion: normalizeOptionalString(candidate.nodeRecommendedVersion) ?? "24.x",
    nodeStatus: candidate.nodeStatus === "supported" || candidate.nodeStatus === "unsupported" || candidate.nodeStatus === "unknown"
      ? candidate.nodeStatus
      : "unknown",
    gatewayAuthStatus: normalizeOptionalString(candidate.gatewayAuthStatus) ?? "Unknown",
    nativeGatewayStatus: normalizeOptionalString(candidate.nativeGatewayStatus) ?? "Unknown",
    cliFallbackUsageCount: typeof candidate.cliFallbackUsageCount === "number" && Number.isFinite(candidate.cliFallbackUsageCount)
      ? Math.max(0, candidate.cliFallbackUsageCount)
      : 0,
    lastNativeError: normalizeOptionalString(candidate.lastNativeError),
    lastFallbackReason: normalizeOptionalString(candidate.lastFallbackReason),
    modelReady: typeof candidate.modelReady === "boolean" ? candidate.modelReady : null
  };
}

function normalizeCompatibilityStatus(value: unknown) {
  return value === "compatible" || value === "degraded" || value === "incompatible" || value === "unknown"
    ? value
    : null;
}

function normalizeSmokeCheckStatus(value: unknown) {
  return value === "pass" || value === "warning" || value === "fail" ? value : null;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRuntimeSmokeTestError(error: string | null) {
  if (!error) {
    return null;
  }

  return isOpenAiCodexAuthFailure(error)
    ? resolveOpenAiCodexAuthRecoveryMessage(buildOpenAiCodexAuthLoginCommand("openclaw"))
    : error;
}

function isStaleProviderAuthSmokeTestFailure(entry: RuntimeSmokeTestCacheEntry) {
  if (entry.status !== "failed" || !isOpenAiCodexAuthFailure(entry.error ?? "")) {
    return false;
  }

  const checkedAt = Date.parse(entry.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt > providerAuthSmokeTestTtlMs;
}

function expandHomeRelativePath(value: string) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}
