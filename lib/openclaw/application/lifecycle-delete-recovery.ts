import "server-only";

export type LifecycleDeleteRecoveryDecision =
  | { action: "confirm-absent" }
  | { action: "wait"; reason: "authoritative-state-unknown" | "recovery-generation-required" }
  | { action: "mutate"; recoveryGeneration: number | null };

/**
 * OpenClaw 2026.9.4 resumes an incomplete deletion journal safely, but its
 * public method still reports an absent agent as not-found. Keep replay
 * explicit and bounded at the AgentOS boundary.
 */
export function decideLifecycleDeleteRecovery(input: {
  targetPresent: boolean | null;
  mutationPreviouslyAccepted: boolean;
  requestedRecoveryGeneration?: number;
  currentRecoveryGeneration: number;
}): LifecycleDeleteRecoveryDecision {
  if (input.targetPresent === false) {
    return { action: "confirm-absent" };
  }

  if (input.targetPresent === null) {
    return { action: "wait", reason: "authoritative-state-unknown" };
  }

  if (!input.mutationPreviouslyAccepted) {
    return { action: "mutate", recoveryGeneration: null };
  }

  if (
    Number.isInteger(input.requestedRecoveryGeneration) &&
    input.requestedRecoveryGeneration === input.currentRecoveryGeneration + 1
  ) {
    return { action: "mutate", recoveryGeneration: input.requestedRecoveryGeneration };
  }

  return { action: "wait", reason: "recovery-generation-required" };
}
