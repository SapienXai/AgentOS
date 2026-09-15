export const CHANNEL_ACCOUNT_POLL_DELAYS_MS = [0, 600, 1_200, 2_000, 3_000, 4_000] as const;

export async function pollChannelAccount<T>(input: {
  read: () => Promise<T>;
  isTerminal: (value: T) => boolean;
  signal?: AbortSignal;
  delaysMs?: readonly number[];
}): Promise<T> {
  const delays = input.delaysMs ?? CHANNEL_ACCOUNT_POLL_DELAYS_MS;
  let latest: T | undefined;

  for (const delayMs of delays) {
    await waitForPollDelay(delayMs, input.signal);
    latest = await input.read();
    if (input.isTerminal(latest)) return latest;
  }

  if (latest === undefined) {
    throw new Error("OpenClaw account status could not be read.");
  }

  return latest;
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
