import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";

export type ChannelAccountHumanState =
  | "NEEDS_SETUP"
  | "READY"
  | "STARTING"
  | "ONLINE"
  | "STOPPED"
  | "NEEDS_ATTENTION"
  | "STATUS_UNAVAILABLE";

export type ChannelAccountPresentation = {
  state: ChannelAccountHumanState;
  label: string;
  detail: string;
  tone: "success" | "info" | "warning" | "danger" | "muted";
  primaryAction: "setup" | "start" | "refresh" | "review" | null;
};

export type ChannelAccountStateInput = {
  accountId: string;
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  running: boolean;
  connected: boolean;
  liveStatusAvailable: boolean;
  authenticationRequired: boolean;
  lastError: string | null;
  healthState?: string | null;
  credentialState?: "present" | "missing" | "unknown";
};

export function presentChannelAccountState(
  account: ChannelAccountStateInput,
  options: { statusError?: string | null } = {}
): ChannelAccountPresentation {
  if (!account.liveStatusAvailable || options.statusError) {
    return {
      state: "STATUS_UNAVAILABLE",
      label: "Status unavailable",
      detail: account.configured
        ? "OpenClaw configuration was found, but live account status is not available."
        : "OpenClaw has not confirmed this account’s credentials or runtime state.",
      tone: "muted",
      primaryAction: "refresh"
    };
  }

  if (account.lastError) {
    return {
      state: "NEEDS_ATTENTION",
      label: "Needs attention",
      detail: account.lastError,
      tone: "danger",
      primaryAction: "review"
    };
  }

  if (!account.enabled) {
    return {
      state: "NEEDS_ATTENTION",
      label: "Disabled",
      detail: "OpenClaw has this account disabled. Review the provider configuration before starting it.",
      tone: "warning",
      primaryAction: "review"
    };
  }

  if (account.authenticationRequired || !account.configured || account.credentialState === "missing") {
    return {
      state: "NEEDS_SETUP",
      label: "Needs setup",
      detail: "OpenClaw does not have usable credentials for this account yet.",
      tone: "warning",
      primaryAction: "setup"
    };
  }

  if (account.connected) {
    return {
      state: "ONLINE",
      label: "Online",
      detail: "OpenClaw confirms that this account is connected and usable.",
      tone: "success",
      primaryAction: null
    };
  }

  if (account.running) {
    return {
      state: "STARTING",
      label: "Starting",
      detail: "OpenClaw is running the account, but has not confirmed a usable connection yet.",
      tone: "info",
      primaryAction: null
    };
  }

  if (isStoppedHealthState(account.healthState)) {
    return {
      state: "STOPPED",
      label: "Stopped",
      detail: "The account is configured, but its OpenClaw runtime is stopped.",
      tone: "warning",
      primaryAction: "start"
    };
  }

  return {
    state: "READY",
    label: "Ready",
    detail: "Credentials and provider configuration are present. Start the account to make it available to routes.",
    tone: "info",
    primaryAction: "start"
  };
}

export function presentChannelLogoutResult(input: {
  result?: Record<string, unknown> | null;
  status?: OpenClawChannelStatusPayload | null;
  statusError?: string | null;
  provider: string;
  accountId: string;
}) {
  const account = input.status?.channelAccounts?.[input.provider]?.find(
    (candidate) => candidate.accountId === input.accountId
  );
  const loggedOut = input.result?.loggedOut === true;
  const usableAfterLogout = Boolean(account?.connected || account?.running || account?.linked);

  if (loggedOut && input.status && !input.statusError && !usableAfterLogout) {
    return {
      state: "NEEDS_SETUP" as const,
      label: "Logged out",
      detail: "OpenClaw confirms that the account is no longer authenticated. Credentials were not exposed or copied into AgentOS.",
      tone: "success" as const,
      primaryAction: "setup" as const
    } satisfies ChannelAccountPresentation;
  }

  return {
    state: "STATUS_UNAVAILABLE" as const,
    label: "Logout requested",
    detail: input.statusError
      ? "OpenClaw accepted the logout request, but the final account state could not be verified."
      : "OpenClaw accepted the logout request; refresh to verify the account is no longer usable.",
    tone: "warning" as const,
    primaryAction: "refresh" as const
  } satisfies ChannelAccountPresentation;
}

function isStoppedHealthState(value: string | null | undefined) {
  return typeof value === "string" && /stopped|manual-stop|offline/i.test(value);
}
