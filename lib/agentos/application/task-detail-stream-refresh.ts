export const TASK_DETAIL_RECONCILIATION_INTERVAL_MS = 30_000;
export const TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS = 150;
export const TASK_DETAIL_STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

export type TaskDetailStreamTimers = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
};

export function createTaskDetailStreamRefreshController(
  refresh: () => Promise<void>,
  options: {
    onHeartbeat?: () => void;
    timers?: TaskDetailStreamTimers;
  } = {}
) {
  const timers = options.timers ?? defaultTimers;
  let closed = false;
  let pendingRefresh = false;
  let inFlight: Promise<void> | null = null;
  let eventRefreshTimer: unknown = null;
  let reconciliationTimer: unknown = null;
  let heartbeatTimer: unknown = null;

  const refreshNow = () => {
    if (closed) {
      return Promise.resolve();
    }
    if (inFlight) {
      pendingRefresh = true;
      return inFlight;
    }

    const current = (async () => {
      do {
        pendingRefresh = false;
        await refresh();
      } while (pendingRefresh && !closed);
    })().finally(() => {
      inFlight = null;
    });
    inFlight = current;
    return current;
  };

  const scheduleEventRefresh = () => {
    if (closed) {
      return;
    }
    if (eventRefreshTimer !== null) {
      timers.clearTimeout(eventRefreshTimer);
    }
    eventRefreshTimer = timers.setTimeout(() => {
      eventRefreshTimer = null;
      void refreshNow();
    }, TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS);
  };

  const start = () => {
    if (closed) {
      return;
    }
    if (reconciliationTimer === null) {
      reconciliationTimer = timers.setInterval(() => {
        void refreshNow();
      }, TASK_DETAIL_RECONCILIATION_INTERVAL_MS);
    }
    if (options.onHeartbeat && heartbeatTimer === null) {
      heartbeatTimer = timers.setInterval(options.onHeartbeat, TASK_DETAIL_STREAM_HEARTBEAT_INTERVAL_MS);
    }
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    pendingRefresh = false;
    if (eventRefreshTimer !== null) {
      timers.clearTimeout(eventRefreshTimer);
      eventRefreshTimer = null;
    }
    if (reconciliationTimer !== null) {
      timers.clearInterval(reconciliationTimer);
      reconciliationTimer = null;
    }
    if (heartbeatTimer !== null) {
      timers.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  return { refreshNow, scheduleEventRefresh, start, close };
}

const defaultTimers: TaskDetailStreamTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
};
