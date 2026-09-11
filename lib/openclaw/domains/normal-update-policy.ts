import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";
import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
  resolveOpenClawUpdateDecision,
  type OpenClawCompatibilityManifest
} from "@/lib/openclaw/update-compatibility";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type { OpenClawUpdateDecision } from "@/lib/openclaw/types";

export type NativeUpdateUserState =
  | "up-to-date" | "available-certified" | "available-uncertified" | "blocked"
  | "held" | "running" | "unavailable" | "unknown";

export type OpenClawProductUpdateState =
  | "up-to-date"
  | "available-certified"
  | "available-agentos-required"
  | "available-uncertified"
  | "available-fallback"
  | "blocked"
  | "held"
  | "running"
  | "unavailable"
  | "unknown";

export type OpenClawProductUpdateAction =
  | "none"
  | "update-openclaw"
  | "update-agentos"
  | "advanced"
  | "view-compatibility"
  | "check-again";

export type OpenClawProductUpdateAvailabilitySource = "native-gateway" | "openclaw-cli-fallback" | null;

export type OpenClawProductUpdateProjection = {
  state: OpenClawProductUpdateState;
  action: OpenClawProductUpdateAction;
  currentVersion: string | null;
  availableVersion: string | null;
  availabilitySource: OpenClawProductUpdateAvailabilitySource;
  nativeState: NativeUpdateUserState;
  agentOsDecision: OpenClawUpdateDecision | null;
  reason: string;
};

export type NormalOpenClawUpdatePolicy = {
  currentVersion: string | null;
  nativeAvailableVersion: string | null;
  effectiveChannel: string | null;
  agentOsDecision: OpenClawUpdateDecision | null;
  state: NativeUpdateUserState;
  productUpdate: OpenClawProductUpdateProjection;
  canRunNormalUpdate: boolean;
  canHoldUpdate: boolean;
  reason: string;
};

export function resolveNativeUpdateUserState(input: {
  update: NativeDoctorSnapshot["update"];
  agentOsDecision?: OpenClawUpdateDecision | null;
}): NativeUpdateUserState {
  if (isNativeUpdateInProgress(input.update)) return "running";
  if (input.update.readStatus === "forbidden" || input.update.status === "unavailable") return "unavailable";
  if (input.update.readStatus !== "available" || input.update.status === "unknown") return "unknown";
  if (isUpdateHeld(input.update.schedule)) return "held";
  if (input.update.status === "current") return "up-to-date";
  if (input.update.status !== "available") return "unknown";
  if (input.agentOsDecision?.status === "blocked") return "blocked";
  return input.agentOsDecision?.status === "certified" && input.agentOsDecision.allowed && input.agentOsDecision.defaultVisible
    ? "available-certified"
    : "available-uncertified";
}

export function resolveOpenClawProductUpdateState(input: {
  nativeState: NativeUpdateUserState;
  currentVersion: string | null;
  availableVersion: string | null;
  availabilitySource?: OpenClawProductUpdateAvailabilitySource;
  agentOsDecision: OpenClawUpdateDecision | null;
}): OpenClawProductUpdateProjection {
  const availabilitySource = input.availabilitySource ?? null;
  const hasVersionDelta = Boolean(
      input.currentVersion &&
      input.availableVersion &&
      compareVersionStrings(input.availableVersion, input.currentVersion) > 0
  );

  if (input.nativeState === "running") {
    return buildProductUpdateProjection(input, "running", "none", "OpenClaw is applying its native update lifecycle.");
  }
  if (input.nativeState === "held") {
    return buildProductUpdateProjection(input, "held", "none", "OpenClaw has temporarily held the active update campaign.");
  }
  if (input.nativeState === "unavailable") {
    return buildProductUpdateProjection(input, "unavailable", "check-again", "The native OpenClaw update status is unavailable or forbidden.");
  }
  if (input.nativeState === "unknown") {
    return buildProductUpdateProjection(input, "unknown", "check-again", "AgentOS could not verify the native OpenClaw update state.");
  }

  if (input.nativeState === "up-to-date") {
    if (availabilitySource === "openclaw-cli-fallback" && hasVersionDelta && input.availableVersion) {
      return buildAvailableProductUpdateProjection(input, "available-fallback", "advanced");
    }

    return buildProductUpdateProjection(input, "up-to-date", "none", "OpenClaw reports no update is currently available.");
  }

  if (!input.availableVersion) {
    return buildProductUpdateProjection(input, "unknown", "check-again", "OpenClaw reported an update without an exact target version.");
  }

  return buildAvailableProductUpdateProjection(input, input.nativeState === "available-certified" ? "available-certified" : input.nativeState);
}

export function resolveNormalOpenClawUpdatePolicy(input: {
  snapshot: {
    status: Pick<NativeDoctorSnapshot["status"], "runtimeVersion" | "version" | "updateChannel">;
    update: NativeDoctorSnapshot["update"];
  };
  agentOsVersion: string;
  manifest?: OpenClawCompatibilityManifest;
}): NormalOpenClawUpdatePolicy {
  const manifest = input.manifest ?? LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST;
  const currentVersion = normalizeVersion(input.snapshot.update.currentVersion || input.snapshot.status.runtimeVersion || input.snapshot.status.version);
  const nativeAvailableVersion = normalizeVersion(input.snapshot.update.latestVersion);
  const discoveredAvailableVersion = normalizeVersion(input.snapshot.update.discoveredAvailableVersion);
  const availableVersion = nativeAvailableVersion || discoveredAvailableVersion;
  const availabilitySource = nativeAvailableVersion
    ? "native-gateway" as const
    : input.snapshot.update.availabilitySource === "openclaw-cli-fallback"
      ? "openclaw-cli-fallback" as const
      : null;
  const effectiveChannel = readString(input.snapshot.update.effectiveChannel || input.snapshot.status.updateChannel);
  const decisionVersion = input.snapshot.update.status === "available" ? availableVersion : availableVersion || currentVersion;
  const agentOsDecision = decisionVersion
    ? resolveOpenClawUpdateDecision({ manifest, agentOsVersion: input.agentOsVersion, targetVersion: decisionVersion, mode: "recommended" })
    : null;
  const state = resolveNativeUpdateUserState({ update: input.snapshot.update, agentOsDecision });
  const productUpdate = resolveOpenClawProductUpdateState({
    nativeState: state,
    currentVersion,
    availableVersion,
    availabilitySource,
    agentOsDecision
  });
  const canRunNormalUpdate = state === "available-certified" &&
    input.snapshot.update.readStatus === "available" &&
    input.snapshot.update.status === "available" &&
    input.snapshot.update.updateAvailable === true &&
    Boolean(nativeAvailableVersion) && Boolean(effectiveChannel) &&
    agentOsDecision?.status === "certified" && agentOsDecision.allowed && agentOsDecision.defaultVisible;

  return {
    currentVersion,
    nativeAvailableVersion,
    effectiveChannel,
    agentOsDecision,
    state,
    productUpdate,
    canRunNormalUpdate,
    canHoldUpdate: canHoldNativeUpdate(input.snapshot.update),
    reason: normalUpdatePolicyReason({ state, update: input.snapshot.update, decision: agentOsDecision, nativeAvailableVersion })
  };
}

export type NormalOpenClawUpdateGateResult =
  | { allowed: true }
  | { allowed: false; code: "UPDATE_CONFIRMATION_STALE" | "NATIVE_UPDATE_STATUS_UNAVAILABLE" | "NATIVE_UPDATE_NOT_AVAILABLE" | "NATIVE_UPDATE_TARGET_UNKNOWN" | "UPDATE_CERTIFICATION_REQUIRED" | "UPDATE_POLICY_BLOCKED" | "UPDATE_ALREADY_RUNNING"; status: 409 | 403 | 503; error: string };

export function guardNormalOpenClawUpdate(input: {
  policy: NormalOpenClawUpdatePolicy;
  confirmationMatches: boolean;
}): NormalOpenClawUpdateGateResult {
  if (!input.confirmationMatches) return { allowed: false, code: "UPDATE_CONFIRMATION_STALE", status: 409, error: "The OpenClaw Gateway identity, update channel, or available target changed. Refresh before retrying." };
  if (input.policy.state === "running") return { allowed: false, code: "UPDATE_ALREADY_RUNNING", status: 409, error: "An OpenClaw update is already in progress. Return here after the Gateway reconnects to verify it." };
  if (input.policy.state === "unavailable" || input.policy.state === "unknown") return { allowed: false, code: "NATIVE_UPDATE_STATUS_UNAVAILABLE", status: input.policy.state === "unavailable" ? 403 : 503, error: input.policy.reason };
  if (input.policy.state === "up-to-date" || input.policy.state === "held") return { allowed: false, code: "NATIVE_UPDATE_NOT_AVAILABLE", status: 409, error: input.policy.reason };
  if (!input.policy.nativeAvailableVersion || !input.policy.agentOsDecision) return { allowed: false, code: "NATIVE_UPDATE_TARGET_UNKNOWN", status: 409, error: "OpenClaw reported an update, but the exact available target could not be verified. Refresh before retrying." };
  if (input.policy.agentOsDecision.status === "blocked") return { allowed: false, code: "UPDATE_POLICY_BLOCKED", status: 409, error: input.policy.agentOsDecision.reason };
  if (!input.policy.canRunNormalUpdate) return { allowed: false, code: "UPDATE_CERTIFICATION_REQUIRED", status: 409, error: input.policy.agentOsDecision.reason };
  return { allowed: true };
}

export function isUpdateHeld(schedule: NativeDoctorSnapshot["update"]["schedule"]) {
  const campaign = schedule && isRecord(schedule.campaign) ? schedule.campaign : null;
  const state = readString(campaign?.state)?.toLowerCase();
  const holdUntilMs = typeof campaign?.holdUntilMs === "number" ? campaign.holdUntilMs : null;
  return Boolean(holdUntilMs !== null && holdUntilMs > Date.now() && (state === "waiting-for-idle" || state === "countdown"));
}

export function isNativeUpdateInProgress(update: NativeDoctorSnapshot["update"]) {
  if (update.activeRun?.status === "running") return true;
  const campaign = update.schedule && isRecord(update.schedule.campaign) ? update.schedule.campaign : null;
  return readString(campaign?.state)?.toLowerCase() === "applying";
}

export function canHoldNativeUpdate(update: NativeDoctorSnapshot["update"]) {
  const schedule = update.schedule;
  const campaign = schedule && isRecord(schedule.campaign) ? schedule.campaign : null;
  const state = readString(campaign?.state)?.toLowerCase();
  const holdUntilMs = typeof campaign?.holdUntilMs === "number" ? campaign.holdUntilMs : null;
  return update.readStatus === "available" && update.status === "available" && update.updateAvailable === true &&
    schedule?.autoEnabled === true && (state === "waiting-for-idle" || state === "countdown") &&
    (holdUntilMs === null || holdUntilMs <= Date.now());
}

function normalUpdatePolicyReason(input: { state: NativeUpdateUserState; update: NativeDoctorSnapshot["update"]; decision: OpenClawUpdateDecision | null; nativeAvailableVersion: string | null }) {
  if (input.state === "unavailable") return input.update.readStatus === "forbidden" ? "OpenClaw update status requires operator admin access." : "The native OpenClaw update status method is unavailable.";
  if (input.state === "unknown") return "AgentOS could not verify the current native OpenClaw update state.";
  if (input.state === "running") return "OpenClaw is applying an update through its native campaign lifecycle.";
  if (input.state === "held") return "OpenClaw has temporarily held the active update campaign.";
  if (input.state === "up-to-date") return "OpenClaw reports no update is currently available.";
  if (!input.nativeAvailableVersion) return "OpenClaw reported an update, but its exact target version is unknown.";
  return input.decision?.reason || "AgentOS could not verify whether this OpenClaw release is allowed for normal updating.";
}

function buildAvailableProductUpdateProjection(
  input: Parameters<typeof resolveOpenClawProductUpdateState>[0],
  state: OpenClawProductUpdateState,
  fallbackAction?: OpenClawProductUpdateAction
): OpenClawProductUpdateProjection {
  if (input.agentOsDecision?.requiresAgentOsUpdate) {
    return buildProductUpdateProjection(
      input,
      "available-agentos-required",
      "update-agentos",
      input.agentOsDecision.reason
    );
  }

  if (input.agentOsDecision?.status === "blocked") {
    return buildProductUpdateProjection(
      input,
      "blocked",
      "view-compatibility",
      input.agentOsDecision.reason
    );
  }

  if (state === "available-certified" && input.agentOsDecision?.status === "certified" && input.agentOsDecision.allowed && input.agentOsDecision.defaultVisible) {
    if (input.availabilitySource === "openclaw-cli-fallback") {
      return buildProductUpdateProjection(
        input,
        "available-fallback",
        "advanced",
        "OpenClaw's CLI status fallback found an update, but the connected Gateway did not expose a native target for update.run."
      );
    }

    return buildProductUpdateProjection(
      input,
      "available-certified",
      "update-openclaw",
      "AgentOS has certified this exact OpenClaw target for the normal native update path."
    );
  }

  return buildProductUpdateProjection(
    input,
    state === "available-fallback" ? "available-fallback" : "available-uncertified",
    fallbackAction ?? "advanced",
    input.agentOsDecision?.reason || "AgentOS has not certified this exact OpenClaw target."
  );
}

function buildProductUpdateProjection(
  input: Parameters<typeof resolveOpenClawProductUpdateState>[0],
  state: OpenClawProductUpdateState,
  action: OpenClawProductUpdateAction,
  reason: string
): OpenClawProductUpdateProjection {
  return {
    state,
    action,
    currentVersion: input.currentVersion,
    availableVersion: input.availableVersion,
    availabilitySource: input.availabilitySource ?? null,
    nativeState: input.nativeState,
    agentOsDecision: input.agentOsDecision,
    reason
  };
}


function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
