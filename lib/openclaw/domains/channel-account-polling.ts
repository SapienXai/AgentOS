export const CHANNEL_ACCOUNT_POLL_DELAYS_MS = [0, 600, 1_200, 2_000, 3_000, 4_000] as const;

export type ChannelAccountPollOperation = "post-create" | "start";
export type ChannelAccountPollClassification = "SUCCESS" | "RETRY" | "FAILURE";

export type ChannelAccountPollResult<T> = {
  value: T;
  classification: ChannelAccountPollClassification;
  timedOut: boolean;
  attempts: number;
};

/**
 * Classifies the human account state for the operation that is in flight.
 *
 * A READY/STOPPED snapshot is enough to prove that a newly-created account
 * exists, but it is stale evidence after a START request. In the latter case
 * both states must remain retryable until OpenClaw reports ONLINE or a
 * definitive credential/configuration failure.
 */
export function classifyChannelAccountPollState(input: {
  operation: ChannelAccountPollOperation;
  state: string | null | undefined;
}): ChannelAccountPollClassification {
  if (input.state === "ONLINE") return "SUCCESS";
  if (input.state === "NEEDS_SETUP" || input.state === "NEEDS_ATTENTION") return "FAILURE";

  if (input.operation === "post-create" && (input.state === "READY" || input.state === "STOPPED")) {
    return "SUCCESS";
  }

  return "RETRY";
}

export async function pollChannelAccount<T>(input: {
  read: () => Promise<T>;
  classify: (value: T) => ChannelAccountPollClassification;
  signal?: AbortSignal;
  delaysMs?: readonly number[];
}): Promise<ChannelAccountPollResult<T>> {
  const delays = input.delaysMs ?? CHANNEL_ACCOUNT_POLL_DELAYS_MS;
  let latest: T | undefined;
  let attempts = 0;

  for (const delayMs of delays) {
    await waitForPollDelay(delayMs, input.signal);
    latest = await input.read();
    attempts += 1;
    const classification = input.classify(latest);
    if (classification !== "RETRY") {
      return {
        value: latest,
        classification,
        timedOut: false,
        attempts
      };
    }
  }

  if (latest === undefined) {
    throw new Error("OpenClaw account status could not be read.");
  }

  return {
    value: latest,
    classification: "RETRY",
    timedOut: true,
    attempts
  };
}

function waitForPollDelay(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  if (delayMs <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const onAbort = () => {
      if (timer !== null) globalThis.clearTimeout(timer);
      finish(() => reject(createAbortError()));
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    timer = globalThis.setTimeout(() => finish(resolve), delayMs);

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function createAbortError() {
  const error = new Error("OpenClaw account status polling was cancelled.");
  error.name = "AbortError";
  return error;
}
