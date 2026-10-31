import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { readOpenClawUpdateProgress } from "@/lib/openclaw/application/update-progress-service";
import { subscribeOpenClawEventBridgeEvents } from "@/lib/openclaw/application/event-bridge-service";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let busy = false;
      let pending = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(redactSecrets(data))}\n\n`));
      };
      const observe = async () => {
        if (closed) return;
        if (busy) { pending = true; return; }
        busy = true;
        if (timer) clearTimeout(timer);
        let delay = 2000;
        try {
          const current = await requireAgentOsProductPermission(request, "runtime.use");
          if ("response" in current || current.actor.actorId !== permission.actor.actorId) {
            send("forbidden", { message: "Update tracking access ended." });
            cleanup();
            return;
          }
          const progress = await readOpenClawUpdateProgress();
          send("progress", progress);
          if (progress.connected && progress.run?.status !== "running" && progress.verification.status === "verified") delay = 15_000;
        } catch {
          send("unavailable", { message: "Waiting for the Gateway. Tracking will resume automatically." });
        } finally {
          busy = false;
          if (!closed) {
            timer = setTimeout(() => { void observe(); }, pending ? 0 : delay);
            pending = false;
          }
        }
      };
      const unsubscribe = subscribeOpenClawEventBridgeEvents((frame) => {
        if (frame.event === "update.run.changed") void observe();
      });
      cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) cleanup();
      else void observe();
    },
    cancel() { cleanup(); }
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  } });
}
