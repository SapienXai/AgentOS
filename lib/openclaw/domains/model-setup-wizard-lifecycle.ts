import {
  advanceModelSetupWizard,
  type ModelSetupWizardAdvanceOptions,
  type ModelSetupWizardResult,
  type ModelSetupWizardStartResult,
  type ModelSetupWizardStatusResult
} from "@/lib/openclaw/domains/model-setup-wizard";

export type ModelSetupWizardLifecyclePhase =
  | "starting"
  | "active"
  | "abandoned-awaiting-cleanup"
  | "cancelled"
  | "terminal";

export type ModelSetupWizardLifecycleTransport = {
  start: () => Promise<ModelSetupWizardStartResult>;
  next: (
    answer?: { stepId: string; value?: unknown },
    signal?: AbortSignal
  ) => Promise<ModelSetupWizardResult>;
  status: () => Promise<ModelSetupWizardStatusResult>;
  cancel: () => Promise<ModelSetupWizardStatusResult>;
};

export type ModelSetupWizardLifecycleOptions = Omit<
  ModelSetupWizardAdvanceOptions,
  "signal" | "status"
> & {
  startWaitMs?: number;
  signal?: AbortSignal;
};

export class ModelSetupWizardStartTimeoutError extends Error {
  constructor() {
    super("OpenClaw provider setup did not start before the client deadline.");
    this.name = "ModelSetupWizardStartTimeoutError";
  }
}

/**
 * Owns one OpenClaw setup session across HTTP requests. The start request is
 * deliberately retained after the client deadline so a late admission can be
 * cancelled with the exact session id instead of becoming an orphan.
 */
export class ModelSetupWizardLifecycle {
  private phaseValue: ModelSetupWizardLifecyclePhase = "starting";
  private startRequest: Promise<ModelSetupWizardStartResult> | null = null;
  private startSettled = false;
  private lateCleanup = Promise.resolve();
  private cancelInFlight: Promise<ModelSetupWizardStatusResult> | null = null;
  private nextInFlight: Promise<ModelSetupWizardResult> | null = null;
  private currentResult: ModelSetupWizardResult | null = null;
  private generation = 0;

  constructor(
    readonly sessionId: string,
    private readonly transport: ModelSetupWizardLifecycleTransport,
    private readonly options: ModelSetupWizardLifecycleOptions = {}
  ) {}

  get phase() {
    return this.phaseValue;
  }

  get result() {
    return this.currentResult;
  }

  async start() {
    if (this.startRequest) throw new Error("OpenClaw provider setup has already started.");

    const request = Promise.resolve().then(() => this.transport.start());
    this.startRequest = request;
    void request.then(
      () => {
        this.startSettled = true;
      },
      () => {
        this.startSettled = true;
      }
    );

    try {
      const started = await awaitBeforeClientDeadline(request, {
        timeoutMs: this.options.startWaitMs ?? 30_000,
        signal: this.options.signal
      });
      this.startSettled = true;
      if (started.sessionId !== this.sessionId) {
        throw new Error("OpenClaw returned a mismatched provider setup session.");
      }
      if (this.phaseValue !== "starting") {
        this.queueLateStartCleanup(started);
        await this.whenCleanupSettled();
        throw new DOMException("Provider setup was cancelled.", "AbortError");
      }

      this.phaseValue = "active";
      const result = await advanceModelSetupWizard(
        started,
        (answer) => this.transport.next(answer, this.options.signal),
        {
          ...this.options,
          signal: this.options.signal,
          status: this.transport.status
        }
      );
      this.currentResult = result;
      if (result.done) this.phaseValue = "terminal";
      return result;
    } catch (error) {
      if (this.phaseValue === "starting" || this.phaseValue === "active") {
        const startMayStillResolve = !this.startSettled;
        if (startMayStillResolve) {
          this.phaseValue = "abandoned-awaiting-cleanup";
          this.queueLateStartCleanup();
        }
        await this.requestCancel();
        this.phaseValue = "cancelled";
      }
      throw error;
    }
  }

  /** Serialize all wizard.next calls for this session. */
  async advance(
    answer?: { stepId: string; value?: unknown },
    signal?: AbortSignal
  ) {
    if (this.phaseValue !== "active") {
      throw new Error("OpenClaw provider setup is no longer active.");
    }
    if (this.nextInFlight) return this.nextInFlight;

    const generation = this.generation;
    const request = (async () => {
      const first = await this.transport.next(answer, signal);
      const result = await advanceModelSetupWizard(
        first,
        (nextAnswer) => this.transport.next(nextAnswer, signal),
        {
          ...this.options,
          primeRunningWithoutStep: false,
          signal,
          status: this.transport.status
        }
      );
      if (generation !== this.generation || this.phaseValue !== "active") {
        return { done: true, status: "cancelled", error: "Provider setup was cancelled." } satisfies ModelSetupWizardResult;
      }
      this.currentResult = result;
      if (result.done) this.phaseValue = "terminal";
      return result;
    })();
    this.nextInFlight = request;
    try {
      return await request;
    } catch (error) {
      await this.requestCancel();
      this.phaseValue = "cancelled";
      throw error;
    } finally {
      if (this.nextInFlight === request) this.nextInFlight = null;
    }
  }

  async status() {
    const status = await this.transport.status();
    if (status.status !== "running") {
      this.currentResult = {
        done: true,
        status: status.status,
        ...(status.error ? { error: status.error } : {})
      };
      this.phaseValue = "terminal";
    }
    return status;
  }

  async cancel() {
    if (this.phaseValue === "terminal" || this.phaseValue === "cancelled") {
      return { status: "cancelled" } satisfies ModelSetupWizardStatusResult;
    }
    this.generation += 1;
    if (!this.startSettled && this.phaseValue === "starting") {
      this.phaseValue = "abandoned-awaiting-cleanup";
      this.queueLateStartCleanup();
    } else {
      this.phaseValue = "cancelled";
    }
    const status = await this.requestCancel();
    this.phaseValue = "cancelled";
    return status;
  }

  /** Wait until any retained late start has been reconciled and cleaned up. */
  whenCleanupSettled() {
    return this.lateCleanup;
  }

  private requestCancel() {
    if (!this.cancelInFlight) {
      this.cancelInFlight = this.transport.cancel().catch(() => ({
        status: "error" as const,
        error: "OpenClaw could not confirm provider setup cancellation."
      })).finally(() => {
        this.cancelInFlight = null;
      });
    }
    return this.cancelInFlight;
  }

  private queueLateStartCleanup(started?: ModelSetupWizardStartResult) {
    this.lateCleanup = this.lateCleanup.then(async () => {
      const result = started ?? await this.startRequest?.catch(() => null);
      if (result && !result.done) {
        await this.transport.cancel().catch(() => undefined);
        return;
      }
      if (result) return;
      const status = await this.transport.status().catch(() => null);
      if (status?.status === "running") {
        await this.transport.cancel().catch(() => undefined);
      }
    }).catch(() => undefined);
  }
}

function awaitBeforeClientDeadline<T>(
  promise: Promise<T>,
  options: { timeoutMs: number; signal?: AbortSignal }
) {
  return new Promise<T>((resolve, reject) => {
    if (options.timeoutMs <= 0) {
      reject(new ModelSetupWizardStartTimeoutError());
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      reject(new ModelSetupWizardStartTimeoutError());
    }, Math.max(1, options.timeoutMs));
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Provider setup was cancelled.", "AbortError"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
