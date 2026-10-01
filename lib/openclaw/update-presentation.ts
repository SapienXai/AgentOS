import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";
import {
  canHoldNativeUpdate,
  guardNormalOpenClawUpdate,
  isNativeUpdateInProgress,
  isUpdateHeld,
  resolveNativeUpdateUserState,
  resolveOpenClawProductUpdateState,
  resolveNormalOpenClawUpdatePolicy,
  type NativeUpdateUserState,
  type OpenClawProductUpdateAction,
  type OpenClawProductUpdateAvailabilitySource,
  type OpenClawProductUpdateProjection,
  type OpenClawProductUpdateState,
  type NormalOpenClawUpdateGateResult,
  type NormalOpenClawUpdatePolicy
} from "@/lib/openclaw/domains/normal-update-policy";

export {
  canHoldNativeUpdate,
  guardNormalOpenClawUpdate,
  isNativeUpdateInProgress,
  isUpdateHeld,
  resolveNativeUpdateUserState,
  resolveOpenClawProductUpdateState,
  resolveNormalOpenClawUpdatePolicy,
  type NativeUpdateUserState,
  type OpenClawProductUpdateAction,
  type OpenClawProductUpdateAvailabilitySource,
  type OpenClawProductUpdateProjection,
  type OpenClawProductUpdateState,
  type NormalOpenClawUpdateGateResult,
  type NormalOpenClawUpdatePolicy
};

export function formatNativeChannel(channel: string | null | undefined) {
  switch (channel) {
    case "stable": return "Stable";
    case "extended-stable": return "Extended stable";
    case "beta": return "Beta";
    case "dev": return "Dev";
    default: return channel?.trim() || "Unknown";
  }
}

export function formatAutomaticUpdateState(schedule: NativeDoctorSnapshot["update"]["schedule"]) {
  if (!schedule) return "Not reported";
  if (typeof schedule.autoEnabled === "boolean") return schedule.autoEnabled ? "On" : "Off";
  return "Managed by OpenClaw";
}

export function formatNativeUpdateStateLabel(state: NativeUpdateUserState) {
  switch (state) {
    case "up-to-date": return "Up to date";
    case "available-certified": return "Update available";
    case "available-uncertified": return "Not yet verified";
    case "blocked": return "Blocked by AgentOS policy";
    case "held": return "Update held";
    case "running": return "Updating OpenClaw";
    case "unavailable": return "Status unavailable";
    case "unknown": return "Unable to verify";
  }
}

export function formatOpenClawProductUpdateStateLabel(state: OpenClawProductUpdateState) {
  switch (state) {
    case "up-to-date": return "Up to date";
    case "available-certified": return "Update available";
    case "available-agentos-required": return "AgentOS update required";
    case "available-uncertified": return "Update available — not yet verified";
    case "available-fallback": return "Update found";
    case "blocked": return "Blocked by AgentOS policy";
    case "held": return "Update held";
    case "running": return "Updating OpenClaw";
    case "unavailable": return "Status unavailable";
    case "unknown": return "Unable to verify";
  }
}

export function resolveNativeUpdateActionBlockReason(input: {
  canManageUpdates: boolean;
  policyCanRunNormalUpdate: boolean | null;
  policyReason: string | null;
  hasBoundConfirmation: boolean;
  checking: boolean;
}) {
  if (input.checking || input.policyCanRunNormalUpdate === null) return null;
  if (!input.canManageUpdates) return "Your AgentOS account cannot manage updates.";
  if (!input.policyCanRunNormalUpdate) {
    return input.policyReason || "OpenClaw's native update safety checks are not ready.";
  }
  if (!input.hasBoundConfirmation) return "Refresh native update status to bind confirmation to the current Gateway.";
  return null;
}
