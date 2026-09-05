import "server-only";

import {
  classifyNativeMutationError,
  type NativeMutationErrorClassification
} from "@/lib/openclaw/client/native-ws-gateway-errors";

export const NATIVE_MUTATION_UNKNOWN_MESSAGE =
  "OpenClaw may have applied this change, but AgentOS could not verify the final native state. Refresh the session before making another change.";

export type NativeMutationReconciliation<T> = {
  verified: boolean;
  result?: T | null;
};

export type NativeMutationExecution<T> =
  | {
      outcome: "succeeded";
      reconciled: boolean;
      retryable: false;
      result: T;
      classification: null;
    }
  | {
      outcome: "failed" | "unknown";
      reconciled: false;
      retryable: false;
      result: null;
      classification: NativeMutationErrorClassification;
    };

/**
 * Runs one native mutation and reconciles only errors whose delivery is
 * ambiguous. Target-specific reconciliation must prove causality before it
 * returns verified=true. This helper never retries a mutation.
 */
export async function executeNativeMutation<T>(input: {
  operation: string;
  mutate: () => Promise<T>;
  reconcile?: () => Promise<NativeMutationReconciliation<T>>;
}): Promise<NativeMutationExecution<T>> {
  try {
    return {
      outcome: "succeeded",
      reconciled: false,
      retryable: false,
      result: await input.mutate(),
      classification: null
    };
  } catch (error) {
    const classification = classifyNativeMutationError(error);
    if (classification.disposition === "definite-rejection" || !input.reconcile) {
      return {
        outcome: classification.disposition === "definite-rejection" ? "failed" : "unknown",
        reconciled: false,
        retryable: false,
        result: null,
        classification
      };
    }

    let reconciliation: NativeMutationReconciliation<T>;
    try {
      reconciliation = await input.reconcile();
    } catch {
      return {
        outcome: "unknown",
        reconciled: false,
        retryable: false,
        result: null,
        classification
      };
    }
    if (reconciliation.verified) {
      return {
        outcome: "succeeded",
        reconciled: true,
        retryable: false,
        result: (reconciliation.result ?? null) as T,
        classification: null
      };
    }

    return {
      outcome: "unknown",
      reconciled: false,
      retryable: false,
      result: null,
      classification
    };
  }
}

export function buildNativeMutationFailureResponse(
  execution: Extract<NativeMutationExecution<unknown>, { outcome: "failed" | "unknown" }>
) {
  if (execution.outcome === "unknown") {
    return {
      status: 409,
      body: {
        error: NATIVE_MUTATION_UNKNOWN_MESSAGE,
        outcome: "unknown" as const,
        reconciled: false,
        retryable: false,
        code: "native-mutation-uncertain"
      }
    };
  }

  return {
    status: statusForNativeMutationKind(execution.classification.kind),
    body: {
      error: execution.classification.message || "OpenClaw rejected this native mutation.",
      outcome: "failed" as const,
      reconciled: false,
      retryable: false,
      code: execution.classification.kind
    }
  };
}

function statusForNativeMutationKind(kind: NativeMutationErrorClassification["kind"]) {
  if (kind === "auth" || kind === "scope-limited") return 403;
  if (kind === "conflict") return 409;
  if (kind === "rate-limited") return 429;
  return 400;
}
