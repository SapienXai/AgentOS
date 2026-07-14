"use client";

import { CheckCircle2, LoaderCircle, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type PairingStatus = "idle" | "checking" | "preparing" | "prepared" | "ready" | "failed" | "connected";
type PairingNetwork = "current" | "lan";

type PairingResult = {
  qrDataUrl: string;
  gatewayUrl: string;
  gatewayUrls: string[];
  auth: string | null;
  urlSource: string | null;
  restarted: boolean;
};

export function OpenClawAppConnectDialog({
  open,
  onOpenChange,
  surfaceTheme,
  bindMode,
  configuredGatewayUrl
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceTheme: SurfaceTheme;
  bindMode?: string;
  configuredGatewayUrl?: string | null;
}) {
  const [status, setStatus] = useState<PairingStatus>("idle");
  const [network, setNetwork] = useState<PairingNetwork>(isLoopbackBind(bindMode) ? "lan" : "current");
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWorking = status === "checking" || status === "preparing";
  const isLoopback = isLoopbackBind(bindMode);
  const routeLabel = useMemo(() => describeRoute(bindMode, configuredGatewayUrl), [bindMode, configuredGatewayUrl]);

  const prepareConnection = async () => {
    setStatus("checking");
    setError(null);
    setPairing(null);

    try {
      setStatus("preparing");
      const response = await fetch("/api/openclaw/mobile-pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ network })
      });
      const result = (await response.json().catch(() => null)) as { pairing?: PairingResult; error?: string } | null;

      if (!response.ok || !result?.pairing) {
        throw new Error(result?.error || "Unable to prepare a secure mobile connection.");
      }

      setPairing(result.pairing);
      setStatus("prepared");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare a secure mobile connection.");
      setStatus("failed");
    }
  };

  const done = () => {
    setStatus("connected");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[min(560px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-[24px] p-0", surfaceTheme === "dark" && "border-white/10 bg-[#0d1522] text-white")}>
        <DialogHeader className={cn("border-b px-6 py-5 pr-12", surfaceTheme === "dark" ? "border-white/10" : "border-border")}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></span>
            <div>
              <DialogTitle className={surfaceTheme === "dark" ? "text-white" : "text-foreground"}>Connect OpenClaw App</DialogTitle>
              <DialogDescription className={surfaceTheme === "dark" ? "text-slate-400" : undefined}>Pair your OpenClaw mobile app with this AgentOS workspace.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <PairingProgress status={status} surfaceTheme={surfaceTheme} />

          {status !== "ready" && status !== "prepared" ? (
            <>
              <div className={cn("rounded-2xl border p-4", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.03]" : "border-border bg-muted/40")}>
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Secure connection required</p>
                    <p className={surfaceTheme === "dark" ? "text-slate-400" : "text-muted-foreground"}>Your Gateway must be reachable from your mobile device. AgentOS will verify authentication before enabling network access.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Connection route</p>
                {isLoopback ? (
                  <button type="button" onClick={() => setNetwork("lan")} className={routeOptionClassName(surfaceTheme, network === "lan")}>
                    <span>Local Network</span><span className="text-xs font-normal opacity-70">Requires a secure Gateway restart</span>
                  </button>
                ) : (
                  <button type="button" onClick={() => setNetwork("current")} className={routeOptionClassName(surfaceTheme, network === "current")}>
                    <span>{routeLabel}</span><span className="text-xs font-normal opacity-70">Use the configured reachable route</span>
                  </button>
                )}
                {configuredGatewayUrl && !isLoopback ? <p className={cn("px-1 text-xs", surfaceTheme === "dark" ? "text-slate-400" : "text-muted-foreground")}>Configured route available. OpenClaw will select the secure route in the pairing code.</p> : null}
              </div>
            </>
          ) : null}

          {status === "prepared" ? <p className={cn("rounded-2xl border p-4 text-sm", surfaceTheme === "dark" ? "border-primary/20 bg-primary/10 text-slate-200" : "border-primary/20 bg-primary/5 text-foreground")}>Secure connection prepared. Show the QR code only when your phone is ready to scan.</p> : null}

          {status === "ready" && pairing ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm"><Image unoptimized src={pairing.qrDataUrl} alt="OpenClaw mobile pairing QR code" width={256} height={256} className="h-64 w-64 max-w-full" /></div>
              <div className="space-y-1 text-sm"><p className="font-medium">OpenClaw mobile app</p><p className={surfaceTheme === "dark" ? "text-slate-400" : "text-muted-foreground"}>Open Settings → Gateway, choose “Pair Device”, then scan this code.</p></div>
              {pairing.restarted ? <p className="text-xs text-primary">Gateway restarted securely before this code was generated.</p> : null}
            </div>
          ) : null}

          {status === "failed" && error ? <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm", surfaceTheme === "dark" ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-destructive/25 bg-destructive/5 text-destructive")}><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">Connection failed</p><p className="mt-1">{error}</p></div></div> : null}
        </div>

        <DialogFooter className={cn("border-t px-6 py-4", surfaceTheme === "dark" ? "border-white/10" : "border-border")}>
          {status === "failed" ? <Button type="button" onClick={() => void prepareConnection()}>Retry</Button> : null}
          {status === "prepared" ? <Button type="button" onClick={() => setStatus("ready")}>Show QR Code</Button> : null}
          {status === "ready" ? <Button type="button" onClick={done}>Done</Button> : null}
          {status !== "ready" && status !== "failed" ? <Button type="button" onClick={() => void prepareConnection()} disabled={isWorking}>{isWorking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{isWorking ? "Preparing secure connection" : "Prepare Connection"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PairingProgress({ status, surfaceTheme }: { status: PairingStatus; surfaceTheme: SurfaceTheme }) {
  const steps: Array<{ id: PairingStatus; label: string }> = [
    { id: "checking", label: "Checking Gateway" },
    { id: "preparing", label: "Preparing secure connection" },
    { id: "ready", label: "QR ready" },
    { id: "connected", label: "Device connected" }
  ];
  const currentIndex = steps.findIndex((step) => step.id === (status === "prepared" ? "preparing" : status));
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{steps.map((step, index) => {
    const active = status !== "idle" && status !== "failed" && index <= currentIndex;
    return <div key={step.id} className={cn("rounded-xl border px-2 py-2 text-center text-[11px] font-medium", active ? "border-primary/30 bg-primary/10 text-primary" : surfaceTheme === "dark" ? "border-white/10 text-slate-500" : "border-border text-muted-foreground")}><CheckCircle2 className={cn("mx-auto mb-1 h-3.5 w-3.5", active ? "opacity-100" : "opacity-35")} />{step.label}</div>;
  })}</div>;
}

function isLoopbackBind(bindMode: string | undefined) { return !bindMode || /^(local|loopback|localhost)$/i.test(bindMode); }
function describeRoute(bindMode: string | undefined, configuredGatewayUrl: string | null | undefined) { if (configuredGatewayUrl?.includes("tailscale") || configuredGatewayUrl?.includes(".ts.net")) return "Tailscale"; if (configuredGatewayUrl) return "Public URL"; return bindMode === "lan" ? "Local Network" : "Configured route"; }
function routeOptionClassName(surfaceTheme: SurfaceTheme, selected: boolean) { return cn("flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-medium", selected ? "border-primary/40 bg-primary/10 text-primary" : surfaceTheme === "dark" ? "border-white/10 bg-white/[0.03] text-slate-200" : "border-border bg-card text-foreground"); }
