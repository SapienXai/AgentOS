import assert from "node:assert/strict";
import test from "node:test";

import {
  handleTaskFeedVisibilityChange,
  subscribeTaskFeedStream,
  type TaskFeedEventSourceFactory,
  type TaskFeedStreamHandlers,
  type TaskFeedVisibilityTarget
} from "@/hooks/task-feed-stream";

test("same-Task feed consumers share one EventSource and close it after the last subscriber", () => {
  const sources: FakeEventSource[] = [];
  const createEventSource: TaskFeedEventSourceFactory = (url) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source as unknown as EventSource;
  };
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  const first = subscribeTaskFeedStream("/api/tasks/task-1/stream?dispatchId=dispatch-1", handlers(firstEvents), { createEventSource, visibilityTarget: null });
  const second = subscribeTaskFeedStream("/api/tasks/task-1/stream?dispatchId=dispatch-1", handlers(secondEvents), { createEventSource, visibilityTarget: null });

  assert.equal(sources.length, 1);
  sources[0]!.emit("task", { type: "task", detail: { id: "detail-1" } });
  assert.deepEqual(firstEvents, ["task"]);
  assert.deepEqual(secondEvents, ["task"]);

  first();
  assert.equal(sources[0]!.closeCount, 0);
  sources[0]!.emit("ready", { type: "ready", ok: true });
  assert.deepEqual(firstEvents, ["task"]);
  assert.deepEqual(secondEvents, ["task", "ready"]);

  second();
  assert.equal(sources[0]!.closeCount, 1);
  const reopened = subscribeTaskFeedStream("/api/tasks/task-1/stream?dispatchId=dispatch-1", handlers([]), { createEventSource, visibilityTarget: null });
  assert.equal(sources.length, 2);
  reopened();
  assert.equal(sources[1]!.closeCount, 1);
});

test("Task detail streams reopen once after browser sleep and release the visibility listener", () => {
  const sources: FakeEventSource[] = [];
  const visibility = new FakeVisibilityTarget();
  const createEventSource: TaskFeedEventSourceFactory = (url) => {
    const source = new FakeEventSource(url);
    sources.push(source);
    return source as unknown as EventSource;
  };
  const unsubscribe = subscribeTaskFeedStream("/api/tasks/task-2/stream", handlers([]), {
    createEventSource,
    visibilityTarget: visibility as unknown as TaskFeedVisibilityTarget
  });

  visibility.setVisibility("hidden");
  handleTaskFeedVisibilityChange(visibility as unknown as TaskFeedVisibilityTarget);
  assert.equal(sources.length, 1);

  visibility.setVisibility("visible");
  handleTaskFeedVisibilityChange(visibility as unknown as TaskFeedVisibilityTarget);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]!.closeCount, 1);
  assert.equal(visibility.listenerCount, 1);

  unsubscribe();
  assert.equal(sources[1]!.closeCount, 1);
  assert.equal(visibility.listenerCount, 0);
});

function handlers(events: string[]): TaskFeedStreamHandlers {
  return {
    onTask: () => events.push("task"),
    onError: () => events.push("error"),
    onReady: () => events.push("ready"),
    onDisconnect: () => events.push("disconnect")
  };
}

class FakeEventSource {
  onerror: ((this: EventSource, event: Event) => unknown) | null = null;
  closeCount = 0;
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  close() {
    this.closeCount += 1;
  }
}

class FakeVisibilityTarget {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly listeners = new Set<EventListenerOrEventListenerObject>();

  get listenerCount() {
    return this.listeners.size;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    const event = new Event("visibilitychange");
    for (const listener of this.listeners) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}
