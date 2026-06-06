import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  getOpenClawEventBridgeStreamStatus,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const STREAM_RECONCILIATION_INTERVAL_MS = 60_000;
const STREAM_EVENT_DEBOUNCE_MS = 300;

export async function GET(request: Request) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeGatewayEvents: (() => void) | undefined;
  let closed = false;
  let snapshotTask: Promise<void> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const handleAbort = () => {
        close();
      };

      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        unsubscribeGatewayEvents?.();
        unsubscribeGatewayEvents = undefined;

        request.signal.removeEventListener("abort", handleAbort);
      };

      const sendEvent = (event: string, data: unknown) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(redactSecrets(data))}\n\n`));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", handleAbort);

      const sendSnapshot = async () => {
        if (closed) {
          return;
        }

        if (snapshotTask) {
          return snapshotTask;
        }

        snapshotTask = (async () => {
          try {
            const snapshot = await getMissionControlSnapshot();
            sendEvent("snapshot", snapshot);
          } catch (error) {
            sendEvent("error", {
              error: redactErrorMessage(error, "Unknown stream error.")
            });
          } finally {
            snapshotTask = null;
          }
        })();

        return snapshotTask;
      };

      const scheduleSnapshot = (delayMs: number) => {
        if (closed) {
          return;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void sendSnapshot();
        }, delayMs);
      };

      unsubscribeGatewayEvents = subscribeOpenClawEventBridgeEvents(() => {
        scheduleSnapshot(STREAM_EVENT_DEBOUNCE_MS);
      });

      interval = setInterval(() => {
        void sendSnapshot();
      }, STREAM_RECONCILIATION_INTERVAL_MS);

      sendEvent("ready", {
        ok: true,
        eventBridge: getOpenClawEventBridgeStreamStatus()
      });
      void sendSnapshot();
    },
    cancel() {
      closed = true;

      if (interval) {
        clearInterval(interval);
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      unsubscribeGatewayEvents?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
