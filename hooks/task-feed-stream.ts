export type TaskFeedStreamHandlers = {
  onTask: (event: MessageEvent<string>) => void;
  onError: (event: MessageEvent<string>) => void;
  onReady: (event: MessageEvent<string>) => void;
  onDisconnect: () => void;
};

export type TaskFeedEventSourceFactory = (url: string) => EventSource;
export type TaskFeedVisibilityTarget = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

type SharedTaskFeedStream = {
  url: string;
  createEventSource: TaskFeedEventSourceFactory;
  eventSource: EventSource;
  subscribers: Set<TaskFeedStreamHandlers>;
  taskListener: EventListener;
  errorListener: EventListener;
  readyListener: EventListener;
  disconnectListener: ((this: EventSource, event: Event) => unknown) | null;
};

const sharedStreams = new Map<string, SharedTaskFeedStream>();
let visibilityTarget: TaskFeedVisibilityTarget | null = null;
let wasHidden = false;

export function subscribeTaskFeedStream(
  url: string,
  handlers: TaskFeedStreamHandlers,
  options: {
    createEventSource?: TaskFeedEventSourceFactory;
    visibilityTarget?: TaskFeedVisibilityTarget | null;
  } = {}
) {
  let stream = sharedStreams.get(url);
  if (!stream) {
    const createEventSource = options.createEventSource ?? ((sourceUrl) => new EventSource(sourceUrl));
    stream = createSharedStream(url, createEventSource);
    sharedStreams.set(url, stream);
    attachVisibilityTarget(options.visibilityTarget ?? getBrowserVisibilityTarget());
  }

  stream.subscribers.add(handlers);
  return () => {
    const current = sharedStreams.get(url);
    if (!current || !current.subscribers.delete(handlers) || current.subscribers.size > 0) {
      return;
    }

    detachSharedStream(current);
    sharedStreams.delete(url);
    if (sharedStreams.size === 0) {
      detachVisibilityTarget();
    }
  };
}

export function handleTaskFeedVisibilityChange(target: TaskFeedVisibilityTarget | null = visibilityTarget) {
  if (!target) {
    return;
  }
  if (target.visibilityState !== "visible") {
    wasHidden = true;
    return;
  }
  if (!wasHidden) {
    return;
  }

  wasHidden = false;
  for (const stream of sharedStreams.values()) {
    restartSharedStream(stream);
  }
}

function createSharedStream(url: string, createEventSource: TaskFeedEventSourceFactory): SharedTaskFeedStream {
  const stream: SharedTaskFeedStream = {
    url,
    createEventSource,
    eventSource: createEventSource(url),
    subscribers: new Set(),
    taskListener: () => undefined,
    errorListener: () => undefined,
    readyListener: () => undefined,
    disconnectListener: null
  };
  attachSharedStreamListeners(stream);
  return stream;
}

function attachSharedStreamListeners(stream: SharedTaskFeedStream) {
  stream.taskListener = (event) => {
    for (const subscriber of stream.subscribers) {
      subscriber.onTask(event as MessageEvent<string>);
    }
  };
  stream.errorListener = (event) => {
    for (const subscriber of stream.subscribers) {
      subscriber.onError(event as MessageEvent<string>);
    }
  };
  stream.readyListener = (event) => {
    for (const subscriber of stream.subscribers) {
      subscriber.onReady(event as MessageEvent<string>);
    }
  };
  stream.disconnectListener = () => {
    for (const subscriber of stream.subscribers) {
      subscriber.onDisconnect();
    }
  };

  stream.eventSource.addEventListener("task", stream.taskListener);
  stream.eventSource.addEventListener("task-error", stream.errorListener);
  stream.eventSource.addEventListener("ready", stream.readyListener);
  stream.eventSource.onerror = stream.disconnectListener;
}

function detachSharedStream(stream: SharedTaskFeedStream) {
  stream.eventSource.removeEventListener("task", stream.taskListener);
  stream.eventSource.removeEventListener("task-error", stream.errorListener);
  stream.eventSource.removeEventListener("ready", stream.readyListener);
  stream.eventSource.onerror = null;
  stream.eventSource.close();
}

function restartSharedStream(stream: SharedTaskFeedStream) {
  detachSharedStream(stream);
  stream.eventSource = stream.createEventSource(stream.url);
  attachSharedStreamListeners(stream);
}

function attachVisibilityTarget(target: TaskFeedVisibilityTarget | null) {
  if (sharedStreams.size !== 1 || !target) {
    return;
  }
  visibilityTarget = target;
  wasHidden = target.visibilityState !== "visible";
  target.addEventListener("visibilitychange", handleBrowserVisibilityChange);
}

function detachVisibilityTarget() {
  visibilityTarget?.removeEventListener("visibilitychange", handleBrowserVisibilityChange);
  visibilityTarget = null;
  wasHidden = false;
}

function handleBrowserVisibilityChange() {
  handleTaskFeedVisibilityChange();
}

function getBrowserVisibilityTarget(): TaskFeedVisibilityTarget | null {
  return typeof document === "undefined" ? null : document;
}
