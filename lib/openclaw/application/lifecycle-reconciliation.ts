import "server-only";

export const LIFECYCLE_RECONCILIATION_ATTEMPTS = 3;
export const LIFECYCLE_RECONCILIATION_DELAY_MS = 250;

export type LifecycleReconciliationResult<T> = {
  outcome: "confirmed" | "not-confirmed" | "unknown";
  attempts: number;
  value: T | null;
  error: string | null;
};

/**
 * Read-only, bounded reconciliation for native lifecycle mutations. This
 * helper deliberately never retries the mutation itself.
 */
export async function reconcileLifecycleState<T>(input: {
  read: () => Promise<T>;
  isConfirmed: (value: T) => boolean;
  attempts?: number;
  delayMs?: number;
}): Promise<LifecycleReconciliationResult<T>> {
  const attempts = Math.max(1, Math.floor(input.attempts ?? LIFECYCLE_RECONCILIATION_ATTEMPTS));
  const delayMs = Math.max(0, Math.floor(input.delayMs ?? LIFECYCLE_RECONCILIATION_DELAY_MS));
  let lastValue: T | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastValue = await input.read();
      lastError = null;
      if (input.isConfirmed(lastValue)) {
        return {
          outcome: "confirmed",
          attempts: attempt,
          value: lastValue,
          error: null
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Native state could not be read.";
    }

    if (attempt < attempts && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    outcome: lastError ? "unknown" : "not-confirmed",
    attempts,
    value: lastValue,
    error: lastError
  };
}
