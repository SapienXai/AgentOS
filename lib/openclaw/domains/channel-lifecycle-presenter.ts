import type {
  OpenClawChannelLifecycleOutcome,
  OpenClawChannelLifecycleResult,
  OpenClawChannelStatusPayload
} from "@/lib/openclaw/client/types";

export type ChannelLifecycleAction = "start" | "stop" | "restart";
export type ChannelLifecyclePresentationState =
  | "running"
  | "stopped"
  | "requested"
  | "pending"
  | "skipped"
  | "failed"
  | "unknown";
export type ChannelLifecyclePresentationTone = "success" | "info" | "warning" | "danger" | "muted";

export type ChannelLifecyclePresentation = {
  state: ChannelLifecyclePresentationState;
  title: string;
  detail: string;
  tone: ChannelLifecyclePresentationTone;
};

type RestartResult = OpenClawChannelLifecycleResult & {
  stop?: OpenClawChannelLifecycleResult;
  start?: OpenClawChannelLifecycleResult;
};

export function presentChannelLifecycleResult(input: {
  action: ChannelLifecycleAction;
  provider: string;
  accountId: string;
  result: OpenClawChannelLifecycleResult | RestartResult | null | undefined;
  status?: OpenClawChannelStatusPayload | null;
  statusError?: string | null;
}): ChannelLifecyclePresentation {
  if (input.action === "restart") {
    return presentRestartResult(input);
  }

  const result = input.result;
  const outcome = result?.outcome;
  if (outcome?.status === "retry") {
    return pendingPresentation(
      input.action === "start" ? "Start pending" : "Stop pending",
      lifecycleReasonDetail(outcome)
    );
  }
  if (outcome?.status === "skipped") {
    return skippedPresentation(input.action, outcome.reason);
  }

  const liveAccount = findLiveAccount(input.status, input.provider, input.accountId);
  if (input.action === "start" && liveAccount?.running === true) {
    return successPresentation("running", "Running", "OpenClaw confirms that this account is running.");
  }
  if (input.action === "stop" && result?.stopped === true && liveAccount?.running === false) {
    return successPresentation("stopped", "Stopped", "The account is stopped. Its OpenClaw authentication and credentials remain saved.");
  }

  if (outcome?.status === "handed-off" || result?.started === true || result?.stopped === true) {
    return requestedPresentation(
      input.action === "start" ? "Start requested" : "Stop requested",
      input.action === "start"
        ? "OpenClaw accepted the start request; live runtime state is not confirmed yet."
        : "OpenClaw accepted the stop request; live runtime state is not confirmed yet.",
      input.statusError
    );
  }

  return unknownPresentation(
    input.action === "start" ? "Start status unavailable" : "Stop status unavailable",
    input.statusError
  );
}

function presentRestartResult(input: {
  provider: string;
  accountId: string;
  result: OpenClawChannelLifecycleResult | RestartResult | null | undefined;
  status?: OpenClawChannelStatusPayload | null;
  statusError?: string | null;
}): ChannelLifecyclePresentation {
  const result = isRestartResult(input.result) ? input.result : null;
  const stop = result?.stop;
  const start = result?.start;

  if (start?.outcome?.status === "retry") {
    return pendingPresentation("Restart pending", lifecycleReasonDetail(start.outcome));
  }
  if (stop?.outcome?.status === "retry") {
    return pendingPresentation("Restart pending", lifecycleReasonDetail(stop.outcome));
  }
  if (start?.outcome?.status === "skipped") {
    return incompleteRestartPresentation(lifecycleReasonDetail(start.outcome));
  }
  if (stop?.outcome?.status === "skipped") {
    return incompleteRestartPresentation(lifecycleReasonDetail(stop.outcome));
  }

  const liveAccount = findLiveAccount(input.status, input.provider, input.accountId);
  if (stop?.stopped === true && start?.started === true && liveAccount?.running === true) {
    return successPresentation("running", "Connection restarted", "OpenClaw confirms that the account is running again.");
  }

  if (start?.outcome?.status === "handed-off" || start?.started === true) {
    return requestedPresentation(
      "Restart requested",
      "OpenClaw accepted the restart; live runtime state is not confirmed yet.",
      input.statusError
    );
  }

  return unknownPresentation("Restart status unavailable", input.statusError);
}

function findLiveAccount(
  status: OpenClawChannelStatusPayload | null | undefined,
  provider: string,
  accountId: string
) {
  return status?.channelAccounts?.[provider]?.find((account) => account.accountId === accountId) ?? null;
}

function lifecycleReasonDetail(outcome: OpenClawChannelLifecycleOutcome): string {
  if (outcome.status === "retry") {
    switch (outcome.reason) {
      case "start-in-flight":
        return "Another start is already in progress.";
      case "stop-in-flight":
        return "A stop is still in progress.";
      case "task-owned":
        return "The runtime task currently owns this account; OpenClaw will reconcile the request.";
    }
  }

  if (outcome.status === "skipped") {
    switch (outcome.reason) {
      case "unsupported":
        return "This provider does not support account lifecycle control.";
      case "autostart-suppressed":
        return "OpenClaw is suppressing automatic startup for this account.";
      case "ambient-suppressed":
        return "OpenClaw is waiting for the account to be explicitly started.";
      case "disabled":
        return "Account is disabled in OpenClaw configuration.";
      case "unconfigured":
        return "Account is not configured in OpenClaw.";
      case "secret-unavailable":
        return "The account credentials are unavailable to OpenClaw.";
      case "unlinked":
        return "Authentication is required before this account can start.";
      case "manual-stop":
        return "OpenClaw is preserving the account's manual stop state.";
    }
  }

  return "OpenClaw returned an unrecognized lifecycle outcome.";
}

function skippedPresentation(action: "start" | "stop", reason: Extract<OpenClawChannelLifecycleOutcome, { status: "skipped" }>['reason']): ChannelLifecyclePresentation {
  if (reason === "unlinked") {
    return {
      state: "skipped",
      title: "Needs authentication",
      detail: lifecycleReasonDetail({ status: "skipped", reason }),
      tone: "warning"
    };
  }
  if (reason === "disabled") {
    return {
      state: "skipped",
      title: "Account disabled",
      detail: lifecycleReasonDetail({ status: "skipped", reason }),
      tone: "warning"
    };
  }
  return {
    state: "skipped",
    title: action === "start" ? "Start skipped" : "Stop skipped",
    detail: lifecycleReasonDetail({ status: "skipped", reason }),
    tone: "warning"
  };
}

function incompleteRestartPresentation(detail: string): ChannelLifecyclePresentation {
  return {
    state: "skipped",
    title: "Restart incomplete",
    detail,
    tone: "warning"
  };
}

function successPresentation(
  state: "running" | "stopped",
  title: string,
  detail: string
): ChannelLifecyclePresentation {
  return { state, title, detail, tone: "success" };
}

function requestedPresentation(title: string, detail: string, statusError?: string | null): ChannelLifecyclePresentation {
  return {
    state: "requested",
    title,
    detail: statusError ? `${detail} Live status could not be refreshed yet.` : detail,
    tone: "info"
  };
}

function pendingPresentation(title: string, detail: string): ChannelLifecyclePresentation {
  return { state: "pending", title, detail, tone: "warning" };
}

function unknownPresentation(title: string, statusError?: string | null): ChannelLifecyclePresentation {
  return {
    state: "unknown",
    title,
    detail: statusError ? "OpenClaw accepted the request, but live state could not be refreshed." : "OpenClaw did not return a definitive lifecycle result.",
    tone: "muted"
  };
}

function isRestartResult(value: OpenClawChannelLifecycleResult | RestartResult | null | undefined): value is RestartResult {
  return Boolean(value && ("stop" in value || "start" in value));
}
