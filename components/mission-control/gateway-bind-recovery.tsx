"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { Button } from "@/components/ui/button";
import type { AgentOsSurfaceTheme } from "@/components/ui/design-system";
import type { GatewayBindRecoveryStatus, GatewayBindRepairResult } from "@/lib/openclaw/gateway-bind-recovery";
import { cn } from "@/lib/utils";

const endpoint = "/api/gateway/bind-recovery";

export function useGatewayBindRecovery(enabled: boolean) {
  const [detected, setDetected] = useState<GatewayBindRecoveryStatus>({ state: "none" });
  const [inspection, setInspection] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const next = response.ok ? await response.json() as GatewayBindRecoveryStatus : { state: "none" } as const;
        if (!controller.signal.aborted) setDetected(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, inspection]);

  return {
    status: enabled ? detected : { state: "none" } as const,
    recheck: () => setInspection((value) => value + 1)
  };
}

export function GatewayBindRecovery({
  status, recheck, surfaceTheme, onRecovery, className
}: {
  status: GatewayBindRecoveryStatus;
  recheck: () => void;
  surfaceTheme: AgentOsSurfaceTheme;
  onRecovery: () => Promise<void>;
  className?: string;
}) {
  const [review, setReview] = useState<Extract<GatewayBindRecoveryStatus, { state: "repairable" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GatewayBindRepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const visibleStatus = review ?? status;
  if (visibleStatus.state === "none") return null;

  const plan = visibleStatus.state === "repairable" ? visibleStatus.plan : null;
  const close = () => {
    setReview(null);
    recheck();
  };
  const detail = plan
    ? `The configured address ${plan.previousAddress} is no longer on this host. AgentOS found ${plan.nextAddress} on the same subnet.`
    : visibleStatus.state === "manual"
      ? `The configured address ${visibleStatus.previousAddress} is no longer on this host. ${visibleStatus.reason === "ambiguous-network"
        ? "There is no single replacement address on the same subnet. Check the host network and OpenClaw configuration."
        : "A private address repair requires the Gateway to use token or password authentication. Review the OpenClaw configuration."}`
      : "The configured address is no longer on this host. Enable Instance Protection and sign in as the owner to review the repair.";

  const repair = async () => {
    if (!plan || pending.current || result || error) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan)
      });
      const data = await response.json() as GatewayBindRepairResult | { error: string };
      if ("error" in data) {
        setError(data.error);
      } else {
        setResult(data);
        if ("plan" in data) void onRecovery().catch(() => {});
      }
    } catch {
      setError("AgentOS lost the repair response. Check the current Gateway state before trying again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const resultMessage = result ? {
    stale: "The configuration or network changed after this review. Close the dialog to check again.",
    busy: "A Gateway address repair is already running. Check Gateway status before trying again.",
    "write-unverified": "OpenClaw did not confirm the configuration write. Check the current address before retrying.",
    saved: "OpenClaw saved the new address, but AgentOS could not verify both listeners. Check the service in Gateway settings.",
    listening: "OpenClaw is listening at the new address. Review Gateway settings to verify AgentOS authentication and readiness.",
    recovered: "OpenClaw is listening and AgentOS verified the native Gateway connection."
  }[result.outcome] : null;

  return (
    <section className={cn("rounded-lg border border-[hsl(var(--status-warning)/0.35)] bg-card p-3 text-card-foreground shadow-sm", className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-warning-foreground))]" aria-hidden />
        <div className="min-w-0">
          <div role="status">
            <p className="text-sm font-semibold">OpenClaw Gateway address is unavailable</p>
            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</p>
          </div>
          {plan ? (
            <MissionControlDialogShell
              open={review !== null}
              onOpenChange={(next) => {
                if (pending.current) return;
                if (!next) {
                  close();
                } else if (visibleStatus.state === "repairable") {
                  setReview(visibleStatus);
                  setResult(null);
                  setError(null);
                }
              }}
              title="Repair the Gateway address"
              description="OpenClaw will save the replacement address and restart its local Gateway service."
              variant="quiet"
              surfaceTheme={surfaceTheme}
              contentClassName="sm:h-[min(26rem,calc(100dvh-72px))] sm:w-[min(90vw,34rem)]"
              disableOutsideDismiss
              trigger={<Button type="button" size="sm" variant="secondary" className="mt-2 min-h-9">Review repair</Button>}
              footer={
                <>
                  <Button type="button" variant="secondary" disabled={busy} onClick={close}>
                    {result || error ? "Close" : "Cancel"}
                  </Button>
                  {!result && !error ? (
                    <Button type="button" disabled={busy} onClick={() => void repair()}>
                      {busy ? "Repairing…" : "Update address and restart"}
                    </Button>
                  ) : null}
                </>
              }
            >
              <div className="space-y-3 p-4 text-sm sm:p-6">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">Configured address</dt><dd className="break-words font-mono">{plan.previousAddress}:{plan.port}</dd>
                  <dt className="text-muted-foreground">Replacement address</dt><dd className="break-words font-mono">{plan.nextAddress}:{plan.port}</dd>
                </dl>
                <p>Confirm this is the intended private network. Devices using the old address will need the replacement address.</p>
                <p className="text-muted-foreground">The repair uses the OpenClaw CLI while the Gateway API is unavailable.</p>
                <div role="status">{busy ? "Applying the address change and verifying the Gateway…" : resultMessage}</div>
                {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                {result && (result.outcome === "saved" || result.outcome === "listening") ? (
                  <Link className="underline underline-offset-2" href="/settings#gateway">Open Gateway settings</Link>
                ) : null}
              </div>
            </MissionControlDialogShell>
          ) : visibleStatus.state === "owner-required" ? (
            <Button asChild size="sm" variant="secondary" className="mt-2 min-h-9"><Link href="/settings#security">Open Security settings</Link></Button>
          ) : (
            <Button type="button" size="sm" variant="secondary" className="mt-2 min-h-9" onClick={recheck}>Check again</Button>
          )}
        </div>
      </div>
    </section>
  );
}
