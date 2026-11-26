import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { buildDashboardSnapshotDelta } from "@/lib/agentos/dashboard-snapshot-delta";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
import {
  getOpenClawEventBridgeStreamStatus,
  getOpenClawAttentionRevision,
  isHumanControlAttentionEvent,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import {
  probeLocalGatewayConfiguration,
  probeLocalGatewayRegistration,
  probeLocalGatewayStatus
} from "@/lib/openclaw/client/local-gateway-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const STREAM_RECONCILIATION_INTERVAL_MS = 60_000;
const STREAM_EVENT_DEBOUNCE_MS = 300;
const STREAM_SYSTEM_STATUS_INTERVAL_MS = 10_000;
const STREAM_INITIAL_SNAPSHOT_DELAY_MS = 0;

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.inspect");
  if ("response" in permission) return permission.response;
  const deltaEnabled = new URL(request.url).searchParams.get("delta") === "1";
  let interval: ReturnType<typeof setInterval> | undefined;
  let systemStatusInterval: ReturnType<typeof setInterval> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeGatewayEvents: (() => void) | undefined;
  let closed = false;
  let snapshotTask: Promise<void> | null = null;
  let snapshotDirty = false;
  let publishedSnapshot: ControlPlaneSnapshot | undefined;
  let systemStatusTask: Promise<void> | null = null;
  let cliInstalled: boolean | null = null;
  let gatewayRegistered: boolean | null = null;
  let gatewayConfigured: boolean | null = null;
  let runtimeWritable: boolean | null = null;
  let modelStatus = { checked: false, defaultModelId: null as string | null, modelIds: [] as string[] };

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
        if (systemStatusInterval) {
          clearInterval(systemStatusInterval);
          systemStatusInterval = undefined;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = undefined;
        }
        unsubscribeGatewayEvents?.();
        unsubscribeGatewayEvents = undefined;

        request.signal.removeEventListener("abort", handleAbort);
      };

      const sendEvent = (event: string, data: unknown, redacted = false) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(redacted ? data : redactSecrets(data))}\n\n`));
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

      const checkAccess = async () => {
        const current = await requireAgentOsProductPermission(request, "runtime.inspect");
        if ("response" in current || current.actor.actorId !== permission.actor.actorId) {
          close();
          return false;
        }
        return !closed;
      };

      const sendSnapshot = async (reconcile = false) => {
        if (closed) {
          return;
        }

        if (snapshotTask) {
          snapshotDirty = true;
          return snapshotTask;
        }

        snapshotTask = (async () => {
          try {
            if (!(await checkAccess())) return;
            // The control-plane boundary already normalizes and redacts every snapshot.
            const next = await getMissionControlSnapshot();
            if (!(await checkAccess())) return;
            const baseline = publishedSnapshot;
            const delta = deltaEnabled && !reconcile && baseline ? buildDashboardSnapshotDelta(baseline, next) : null;
            if (!delta) {
              if (sendEvent("snapshot", next, true)) publishedSnapshot = next;
              return;
            }
            if ((delta.diagnostics || delta.runtimes || delta.tasks || Object.keys(delta.changes).length) &&
                sendEvent("snapshot-delta", delta, true)) publishedSnapshot = next;
          } catch (error) {
            if (await checkAccess().catch(() => { close(); return false; })) {
              sendEvent("error", {
                error: redactErrorMessage(error, "Unknown stream error.")
              });
            }
          } finally {
            snapshotTask = null;
            if (snapshotDirty) {
              snapshotDirty = false;
              scheduleSnapshot(STREAM_EVENT_DEBOUNCE_MS);
            }
          }
        })();

        return snapshotTask;
      };

      const scheduleSnapshot = (delayMs: number) => {
        if (closed) {
          return;
        }

        // Bound the wait from the first event in a burst. A busy Gateway
        // must not keep pushing the next snapshot further into the future.
        if (debounceTimer) return;

        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void sendSnapshot();
        }, delayMs);
      };

      const sendSystemStatus = () => {
        if (systemStatusTask) {
          return systemStatusTask;
        }

        systemStatusTask = (async () => {
          if (!(await checkAccess())) return;
          const [gatewayStatus, detectedGatewayRegistered, detectedGatewayConfigured, detectedCliInstalled] = await Promise.all([
          probeLocalGatewayStatus().catch(() => null),
          gatewayRegistered === true
            ? Promise.resolve(true)
            : probeLocalGatewayRegistration().catch(() => null),
          gatewayConfigured === true
            ? Promise.resolve(true)
            : probeLocalGatewayConfiguration().catch(() => false),
          cliInstalled === true
            ? Promise.resolve(true)
            : import("@/lib/openclaw/cli")
                .then(({ resolveOpenClawBin }) => resolveOpenClawBin().then(() => true).catch(() => false))
                .catch(() => false)
        ]);
        cliInstalled = detectedCliInstalled;
        gatewayRegistered = detectedGatewayRegistered;
        gatewayConfigured = detectedGatewayConfigured;
        const gatewayReady = gatewayStatus?.rpc?.ok === true;

        if (gatewayReady && !modelStatus.checked) {
          modelStatus = await import("@/lib/openclaw/state/local-model-status")
            .then(({ probeLocalDefaultModel }) => probeLocalDefaultModel())
            .catch(() => modelStatus);
        }

        if (gatewayReady && runtimeWritable !== true) {
          runtimeWritable = await Promise.all([
            import("@/lib/openclaw/state/runtime-state"),
            import("@/lib/openclaw/state/paths")
          ]).then(async ([runtimeState, statePaths]) => {
            const result = await runtimeState.inspectOpenClawRuntimeState(
              statePaths.openClawStateRootPath,
              [],
              { touch: true }
            );
            return result.stateWritable && result.sessionStoreWritable;
          }).catch(() => false);
        }

          if (!(await checkAccess())) return;
          sendEvent("system-status", {
            gatewayReachable: Boolean(gatewayStatus),
            gatewayReady,
            gatewayRegistered,
            gatewayConfigured,
            cliInstalled,
            runtimeWritable,
            modelStatus
          });
        })().catch(close).finally(() => {
          systemStatusTask = null;
        });

        return systemStatusTask;
      };

      unsubscribeGatewayEvents = subscribeOpenClawEventBridgeEvents((frame) => {
        if (isHumanControlAttentionEvent(frame)) {
          void checkAccess().then((allowed) => {
            if (allowed) sendEvent("attention", { revision: getOpenClawAttentionRevision() });
          }).catch(close);
        }
        scheduleSnapshot(STREAM_EVENT_DEBOUNCE_MS);
      });

      interval = setInterval(() => {
        void sendSnapshot(true);
      }, STREAM_RECONCILIATION_INTERVAL_MS);

      sendEvent("ready", {
        ok: true,
        eventBridge: getOpenClawEventBridgeStreamStatus()
      });
      void sendSystemStatus();
      systemStatusInterval = setInterval(() => {
        void sendSystemStatus();
      }, STREAM_SYSTEM_STATUS_INTERVAL_MS);
      scheduleSnapshot(STREAM_INITIAL_SNAPSHOT_DELAY_MS);
    },
    cancel() {
      closed = true;

      if (interval) {
        clearInterval(interval);
      }
      if (systemStatusInterval) {
        clearInterval(systemStatusInterval);
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
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive"
    }
  });
}
