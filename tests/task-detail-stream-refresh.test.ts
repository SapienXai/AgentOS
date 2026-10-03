import assert from "node:assert/strict";
import test from "node:test";

import {
  createTaskDetailStreamRefreshController,
  TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS,
  TASK_DETAIL_RECONCILIATION_INTERVAL_MS,
  TASK_DETAIL_STREAM_HEARTBEAT_INTERVAL_MS,
  type TaskDetailStreamTimers
} from "@/lib/agentos/application/task-detail-stream-refresh";

test("Task detail refresh is event-first with a bounded reconciliation and heartbeat cadence", async () => {
  const timers = new ManualTimers();
  let refreshes = 0;
  let heartbeats = 0;
  const controller = createTaskDetailStreamRefreshController(async () => {
    refreshes += 1;
  }, { onHeartbeat: () => { heartbeats += 1; }, timers });

  controller.start();
  assert.deepEqual([...timers.intervals.values()].map((entry) => entry.delayMs).sort(), [
    TASK_DETAIL_STREAM_HEARTBEAT_INTERVAL_MS,
    TASK_DETAIL_RECONCILIATION_INTERVAL_MS
  ]);
  assert.equal(TASK_DETAIL_RECONCILIATION_INTERVAL_MS, 30_000);

  timers.fireInterval(TASK_DETAIL_RECONCILIATION_INTERVAL_MS);
  await settleMicrotasks();
  assert.equal(refreshes, 1);

  timers.fireInterval(TASK_DETAIL_STREAM_HEARTBEAT_INTERVAL_MS);
  assert.equal(heartbeats, 1);

  controller.close();
  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
});

test("Task event invalidations debounce and in-flight detail reads coalesce one follow-up", async () => {
  const timers = new ManualTimers();
  let refreshes = 0;
  let releaseFirstRefresh!: () => void;
  const firstRefreshGate = new Promise<void>((resolve) => { releaseFirstRefresh = resolve; });
  const controller = createTaskDetailStreamRefreshController(async () => {
    refreshes += 1;
    if (refreshes === 1) {
      await firstRefreshGate;
    }
  }, { timers });

  const firstRefresh = controller.refreshNow();
  await settleMicrotasks();
  const coalescedRefresh = controller.refreshNow();
  controller.scheduleEventRefresh();
  controller.scheduleEventRefresh();
  controller.scheduleEventRefresh();
  assert.equal([...timers.timeouts.values()].filter((entry) => entry.delayMs === TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS).length, 1);

  releaseFirstRefresh();
  await Promise.all([firstRefresh, coalescedRefresh]);
  assert.equal(refreshes, 2);

  timers.fireTimeout(TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS);
  await settleMicrotasks();
  assert.equal(refreshes, 3);
  controller.close();
});

test("closing a Task detail stream cancels pending event and reconciliation timers", () => {
  const timers = new ManualTimers();
  let refreshes = 0;
  const controller = createTaskDetailStreamRefreshController(async () => {
    refreshes += 1;
  }, { timers });

  controller.start();
  controller.scheduleEventRefresh();
  controller.close();
  timers.fireInterval(TASK_DETAIL_RECONCILIATION_INTERVAL_MS);
  timers.fireTimeout(TASK_DETAIL_EVENT_REFRESH_DEBOUNCE_MS);
  assert.equal(refreshes, 0);
  assert.equal(timers.intervals.size, 0);
  assert.equal(timers.timeouts.size, 0);
});

class ManualTimers implements TaskDetailStreamTimers {
  readonly intervals = new Map<object, { callback: () => void; delayMs: number }>();
  readonly timeouts = new Map<object, { callback: () => void; delayMs: number }>();

  setTimeout(callback: () => void, delayMs: number) {
    const handle = {};
    this.timeouts.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimeout(handle: unknown) {
    if (typeof handle === "object" && handle !== null) this.timeouts.delete(handle);
  }

  setInterval(callback: () => void, delayMs: number) {
    const handle = {};
    this.intervals.set(handle, { callback, delayMs });
    return handle;
  }

  clearInterval(handle: unknown) {
    if (typeof handle === "object" && handle !== null) this.intervals.delete(handle);
  }

  fireInterval(delayMs: number) {
    for (const entry of this.intervals.values()) {
      if (entry.delayMs === delayMs) entry.callback();
    }
  }

  fireTimeout(delayMs: number) {
    for (const [handle, entry] of this.timeouts) {
      if (entry.delayMs !== delayMs) continue;
      this.timeouts.delete(handle);
      entry.callback();
    }
  }
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
