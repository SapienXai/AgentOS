import type {
  MissionControlSurfaceProvider,
  SurfaceAccountRuntimeStatus,
  SurfaceRuntimeSnapshot
} from "@/lib/openclaw/types";

/**
 * Normalize the pure, already-loaded SurfaceRuntime projection for integration
 * consumers. Gateway access and browser/server adapters stay in surface-runtime.
 */
export function normalizeSurfaceIntegrationStatus(
  surfaceRuntime: SurfaceRuntimeSnapshot,
  provider: MissionControlSurfaceProvider
) {
  const providerAccounts = Object.values(surfaceRuntime.accountsByProvider[provider] ?? {}) as SurfaceAccountRuntimeStatus[];
  const accountError = providerAccounts.find((account) => account.errorMessage);

  if (surfaceRuntime.gatewayAccess.blocked) {
    return {
      status: "unknown" as const,
      statusLabel: "Gateway Blocked",
      connectionHealth: {
        label: "Gateway access blocked",
        detail: surfaceRuntime.gatewayAccess.issue ?? "OpenClaw Gateway access needs approval before live status can be checked."
      },
      errorMessage: surfaceRuntime.gatewayAccess.issue
    };
  }

  if (accountError?.errorMessage) {
    return {
      status: "failed" as const,
      statusLabel: "Failed",
      connectionHealth: {
        label: "Connector error",
        detail: accountError.errorMessage
      },
      errorMessage: accountError.errorMessage
    };
  }

  if (surfaceRuntime.source === "unavailable" && providerAccounts.length === 0) {
    return {
      status: "unknown" as const,
      statusLabel: "Unknown",
      connectionHealth: {
        label: "OpenClaw status unavailable",
        detail: surfaceRuntime.issue ?? "OpenClaw channel status is unavailable."
      },
      errorMessage: surfaceRuntime.issue
    };
  }

  if (providerAccounts.length === 0) {
    return {
      status: "missing-credentials" as const,
      statusLabel: "Missing Credentials",
      connectionHealth: {
        label: "No OpenClaw account",
        detail: "OpenClaw channel status did not return an account for this provider."
      },
      errorMessage: null
    };
  }

  if (providerAccounts.every((account) => account.disabled)) {
    return {
      status: "disabled" as const,
      statusLabel: "Disabled",
      connectionHealth: {
        label: "Disabled",
        detail: "OpenClaw returned account records, but every account is disabled."
      },
      errorMessage: null
    };
  }

  const connectedAccounts = providerAccounts.filter((account) => account.connected);
  if (connectedAccounts.length > 0) {
    return {
      status: "connected" as const,
      statusLabel: "Connected",
      connectionHealth: {
        label: "Verified by OpenClaw",
        detail: `${connectedAccounts.length} account${connectedAccounts.length === 1 ? "" : "s"} returned connected from channels.status.`
      },
      errorMessage: null
    };
  }

  const authenticationRequiredAccounts = providerAccounts.filter((account) => account.authenticationRequired === true);
  if (authenticationRequiredAccounts.length > 0) {
    return {
      status: "needs-authentication" as const,
      statusLabel: "Needs Authentication",
      connectionHealth: {
        label: "Authentication required",
        detail: "OpenClaw returned a configured WhatsApp account without a linked authenticated session."
      },
      errorMessage: null
    };
  }

  const runningAccounts = providerAccounts.filter((account) => account.running);
  if (runningAccounts.length > 0) {
    return {
      status: "running" as const,
      statusLabel: "Running",
      connectionHealth: {
        label: "Runtime active",
        detail: `${runningAccounts.length} account${runningAccounts.length === 1 ? "" : "s"} reported running; OpenClaw did not independently report connected authentication.`
      },
      errorMessage: null
    };
  }

  const linkedAccounts = providerAccounts.filter((account) => account.linked);
  if (linkedAccounts.length > 0) {
    return {
      status: "linked" as const,
      statusLabel: "Linked",
      connectionHealth: {
        label: "Linked by OpenClaw",
        detail: `${linkedAccounts.length} account${linkedAccounts.length === 1 ? "" : "s"} reported linked; OpenClaw did not independently report connected authentication.`
      },
      errorMessage: null
    };
  }

  const configuredAccounts = providerAccounts.filter((account) => account.configured);
  if (configuredAccounts.length > 0) {
    return {
      status: surfaceRuntime.source === "config-only" ? "configured" as const : "stopped" as const,
      statusLabel: surfaceRuntime.source === "config-only" ? "Configured" : "Stopped",
      connectionHealth: {
        label: surfaceRuntime.source === "config-only" ? "Configured, not live-verified" : "Stopped",
        detail:
          surfaceRuntime.source === "config-only"
            ? "OpenClaw configuration exists, but live channel status was unavailable."
            : "OpenClaw returned configured account records, but no account reported connected, running, or linked."
      },
      errorMessage: null
    };
  }

  return {
    status: "pending-setup" as const,
    statusLabel: "Pending Setup",
    connectionHealth: {
      label: "Setup incomplete",
      detail: "OpenClaw returned account records without configured or connected state."
    },
    errorMessage: null
  };
}
