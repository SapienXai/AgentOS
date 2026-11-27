"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { AccessAddress } from "@/components/settings/access-address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TailscaleAccessView } from "@/lib/security/remote-access-policy";

const labels: Record<TailscaleAccessView["status"], string> = {
  "not-installed": "Not installed",
  unavailable: "Unavailable",
  disconnected: "Disconnected",
  "setup-required": "Setup required",
  manual: "Manual setup",
  ready: "Ready to enable",
  active: "HTTPS verified",
  configured: "Awaiting HTTPS",
  conflict: "Review needed",
  "cleanup-required": "Cleanup required"
};

async function requestStatus(action?: "enable" | "disable", signal?: AbortSignal): Promise<TailscaleAccessView> {
  const response = await fetch("/api/auth/access/tailscale", action ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), signal
  } : { cache: "no-store", signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Tailscale status could not be checked.");
  return result;
}

export function TailscaleAccessSettings() {
  const [view, setView] = useState<TailscaleAccessView | null>(null);
  const [busy, setBusy] = useState<string | null>("Checking Tailscale…");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void requestStatus(undefined, controller.signal).then(setView).catch(() => {
      if (!controller.signal.aborted) setError("Tailscale status could not be checked.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  async function check(action?: "enable" | "disable") {
    setError("");
    setBusy(action === "enable" ? "Enabling remote access…" : action === "disable" ? "Disabling remote access…" : "Checking Tailscale…");
    try {
      setView(await requestStatus(action));
    } catch (failure) {
      setView(null);
      setError(failure instanceof Error ? failure.message : "Tailscale status could not be checked.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="access-tailscale-title" className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="access-tailscale-title" className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" /> Remote Access — Tailscale
        </h3>
        {view ? <Badge variant={view.status === "active" ? "success" : "muted"}>{labels[view.status]}</Badge> : null}
      </div>
      <p role="status" className="text-sm leading-5 text-muted-foreground">{busy || view?.message}</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {view?.origin && !busy ? <AccessAddress key={view.origin} address={view.origin} copy /> : null}
      <div className="flex flex-wrap gap-2">
        {view?.status === "not-installed" ? <Button asChild className="min-h-11">
          <a href={view.installUrl} target="_blank" rel="noopener noreferrer">Install Tailscale</a>
        </Button> : null}
        {view?.status === "setup-required" ? <Button asChild variant="secondary" className="min-h-11">
          <a href="https://login.tailscale.com/admin/dns" target="_blank" rel="noopener noreferrer">Open Tailscale DNS settings</a>
        </Button> : null}
        {view?.canEnable ? <Button type="button" disabled={Boolean(busy)} onClick={() => void check("enable")} className="min-h-11">
          Enable remote access
        </Button> : null}
        {view?.canDisable ? <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void check("disable")} className="min-h-11">
          Disable remote access
        </Button> : null}
        <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => void check()} className="min-h-11">
          <RefreshCw className="size-4" aria-hidden="true" /> Refresh status
        </Button>
      </div>
      <details className="border-t border-border pt-2 text-sm text-muted-foreground">
        <summary className="min-h-10 cursor-pointer py-2 font-medium">Setup and troubleshooting</summary>
        <p className="mt-1">Connect both devices to the same Tailscale network. Sign in with your AgentOS account when you open the link.</p>
        <p className="mt-2">For manual setup, use Tailscale Serve with AgentOS’s loopback address. Add the HTTPS URL under Trusted HTTPS addresses.</p>
        <a href="https://tailscale.com/docs/features/tailscale-serve" target="_blank" rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-10 items-center underline underline-offset-4">Tailscale Serve guide</a>
      </details>
    </section>
  );
}
