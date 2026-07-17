"use client";

import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wifi
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type PairingStatus = "idle" | "checking" | "preparing" | "ready" | "failed";
type PairingNetwork = "current" | "lan";
type CopiedField = "setup-code" | "host" | "port" | "pairing-token";

type PairingResult = {
  qrDataUrl: string;
  setupCode: string;
  gatewayUrl: string;
  gatewayUrls: string[];
  auth: string | null;
  urlSource: string | null;
  manual: {
    host: string;
    port: number;
    secure: boolean;
    pairingToken: string;
    expiresAtMs: number | null;
  } | null;
  restarted: boolean;
};

export function OpenClawAppConnectDialog({
  open,
  onOpenChange,
  surfaceTheme,
  bindMode,
  configuredGatewayUrl,
  onPairingPrepared
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceTheme: SurfaceTheme;
  bindMode?: string;
  configuredGatewayUrl?: string | null;
  onPairingPrepared?: () => void;
}) {
  const [status, setStatus] = useState<PairingStatus>("idle");
  const [network, setNetwork] = useState<PairingNetwork>(isLoopbackBind(bindMode) ? "lan" : "current");
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<CopiedField | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [showSetupCode, setShowSetupCode] = useState(false);
  const [showPairingToken, setShowPairingToken] = useState(false);
  const isWorking = status === "checking" || status === "preparing";
  const isLoopback = isLoopbackBind(bindMode);
  const routeLabel = useMemo(() => describeRoute(bindMode, configuredGatewayUrl), [bindMode, configuredGatewayUrl]);

  const prepareConnection = async () => {
    setStatus("checking");
    setError(null);
    setPairing(null);
    setCopiedField(null);
    setCopyError(null);
    setShowSetupCode(false);
    setShowPairingToken(false);

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
      setStatus("ready");
      onPairingPrepared?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to prepare a secure mobile connection.");
      setStatus("failed");
    }
  };

  const copyPairingValue = async (field: CopiedField, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setCopyError(null);
    } catch {
      setCopyError("Clipboard access was blocked. Show the value and copy it manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "w-[calc(100vw-1.5rem)] max-w-[720px] gap-0 overflow-hidden rounded-[22px] p-0 shadow-2xl",
        surfaceTheme === "dark" && "border-white/10 bg-[#0b1220] text-white"
      )}>
        <DialogHeader className={cn("border-b px-5 py-4 pr-12", surfaceTheme === "dark" ? "border-white/10" : "border-border/70")}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Smartphone className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <DialogTitle className={cn("text-base", surfaceTheme === "dark" ? "text-white" : "text-foreground")}>Connect OpenClaw App</DialogTitle>
              <DialogDescription className={cn("mt-0.5 text-xs", surfaceTheme === "dark" ? "text-slate-400" : undefined)}>Pair your OpenClaw mobile app with this AgentOS workspace.</DialogDescription>
            </div>
            <RouteBadge label={isLoopback ? "Local network" : routeLabel} surfaceTheme={surfaceTheme} />
          </div>
        </DialogHeader>

        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto px-5 py-4">
          <PairingProgress status={status} surfaceTheme={surfaceTheme} />

          {status === "idle" || isWorking ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setNetwork(isLoopback ? "lan" : "current")}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border p-3.5 text-left transition",
                  surfaceTheme === "dark" ? "border-primary/25 bg-primary/[0.07] hover:bg-primary/10" : "border-primary/25 bg-primary/[0.04] hover:bg-primary/[0.07]"
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wifi className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{isLoopback ? "Enable LAN pairing" : routeLabel}</span>
                  <span className={cn("mt-0.5 block text-xs leading-relaxed", mutedText(surfaceTheme))}>{isLoopback ? "Gateway restarts once, then becomes reachable on this Wi-Fi." : "Use the Gateway route already configured in OpenClaw."}</span>
                </span>
              </button>

              <div className={cn("flex items-start gap-3 rounded-2xl border p-3.5", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-border/70 bg-muted/25")}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500"><ShieldCheck className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-medium">Authenticated pairing</p>
                  <p className={cn("mt-0.5 text-xs leading-relaxed", mutedText(surfaceTheme))}>AgentOS verifies Gateway authentication before exposing a reachable route.</p>
                </div>
              </div>
            </div>
          ) : null}

          {status === "ready" && pairing ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-[232px_minmax(0,1fr)]">
              <section className={cn("rounded-2xl border p-3", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-border/70 bg-muted/20")}>
                <div className="rounded-xl bg-white p-2.5 shadow-sm">
                  <Image unoptimized src={pairing.qrDataUrl} alt="OpenClaw mobile pairing QR code" width={208} height={208} className="aspect-square h-auto w-full" />
                </div>
                <div className="px-1 pb-0.5 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"><Check className="h-3 w-3" /></span>
                    <p className="text-sm font-medium">Ready to scan</p>
                  </div>
                  <p className={cn("mt-1.5 text-xs leading-relaxed", mutedText(surfaceTheme))}>Open Settings → Gateway → Pair Device in the mobile app.</p>
                  {pairing.restarted ? <p className="mt-2 text-[11px] text-primary">Gateway restarted on the local network.</p> : null}
                </div>
              </section>

              <section className="min-w-0 space-y-3">
                <div className={cn("rounded-2xl border p-3.5", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-border/70 bg-card")}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Setup code fallback</p>
                      <p className={cn("mt-0.5 text-xs", mutedText(surfaceTheme))}>Use Enter setup code if scanning fails.</p>
                    </div>
                    <SecretActions
                      shown={showSetupCode}
                      copied={copiedField === "setup-code"}
                      onToggle={() => setShowSetupCode((value) => !value)}
                      onCopy={() => void copyPairingValue("setup-code", pairing.setupCode)}
                    />
                  </div>
                  <div className={cn("mt-3 min-h-9 rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed", surfaceTheme === "dark" ? "bg-black/20 text-slate-300" : "bg-muted/60 text-foreground")}>
                    <span className={showSetupCode ? "break-all select-all" : "tracking-[0.22em]"}>{showSetupCode ? pairing.setupCode : "••••••••••••••••••••••••"}</span>
                  </div>
                </div>

                <details className={cn("group rounded-2xl border", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.025]" : "border-border/70 bg-card")}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-sm font-medium">
                    <span><span className="block">Manual setup</span><span className={cn("mt-0.5 block text-[11px] font-normal", mutedText(surfaceTheme))}>Host, port and temporary token</span></span>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-current/10 px-3.5 py-3">
                    {pairing.manual ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-2">
                          <ManualSetupValue label="Host" value={pairing.manual.host} copied={copiedField === "host"} onCopy={() => void copyPairingValue("host", pairing.manual!.host)} surfaceTheme={surfaceTheme} />
                          <ManualSetupValue label="Port" value={String(pairing.manual.port)} copied={copiedField === "port"} onCopy={() => void copyPairingValue("port", String(pairing.manual!.port))} surfaceTheme={surfaceTheme} />
                        </div>
                        <div className="flex items-center justify-between gap-3 py-0.5">
                          <div><p className={cn("text-[10px] uppercase tracking-wider", mutedText(surfaceTheme))}>Security</p><p className="mt-0.5 text-xs font-medium">{pairing.manual.secure ? "Secure (TLS)" : "Unencrypted · trusted Wi-Fi only"}</p></div>
                        </div>
                        <div className={cn("rounded-xl border p-2.5", surfaceTheme === "dark" ? "border-white/10" : "border-border/70")}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0"><p className={cn("text-[10px] uppercase tracking-wider", mutedText(surfaceTheme))}>Pairing token</p><p className="mt-1 break-all font-mono text-[11px]">{showPairingToken ? pairing.manual.pairingToken : "Hidden temporary token"}</p></div>
                            <SecretActions
                              shown={showPairingToken}
                              copied={copiedField === "pairing-token"}
                              onToggle={() => setShowPairingToken((value) => !value)}
                              onCopy={() => void copyPairingValue("pairing-token", pairing.manual!.pairingToken)}
                            />
                          </div>
                        </div>
                        <p className={cn("text-[11px]", mutedText(surfaceTheme))}>Paste into Token and leave Password blank.</p>
                      </div>
                    ) : <p className={cn("text-xs", mutedText(surfaceTheme))}>Manual fields are unavailable for this route. Use the setup code above.</p>}
                  </div>
                </details>

                <p className={cn("px-1 text-[11px]", mutedText(surfaceTheme))}>Codes are short-lived secrets. Keep them private and generate a new code if this one expires.</p>
                {copyError ? <p className="px-1 text-xs text-destructive">{copyError}</p> : null}
              </section>
            </div>
          ) : null}

          {status === "failed" && error ? (
            <div className={cn("mt-4 flex gap-3 rounded-2xl border p-3.5 text-sm", surfaceTheme === "dark" ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-destructive/25 bg-destructive/5 text-destructive")}>
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-medium">Connection failed</p><p className="mt-1 text-xs leading-relaxed opacity-85">{error}</p></div>
            </div>
          ) : null}
        </div>

        <DialogFooter className={cn("flex-row items-center justify-end gap-2 border-t px-5 py-3", surfaceTheme === "dark" ? "border-white/10" : "border-border/70")}>
          {status === "ready" ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => void prepareConnection()}><RefreshCw className="h-3.5 w-3.5" />New code</Button>
              <Button type="button" size="sm" onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => void prepareConnection()} disabled={isWorking}>
              {isWorking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {isWorking ? "Preparing pairing" : status === "failed" ? "Try again" : "Prepare pairing"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PairingProgress({ status, surfaceTheme }: { status: PairingStatus; surfaceTheme: SurfaceTheme }) {
  const steps = ["Gateway", "Secure route", "Pairing ready"];
  const currentIndex = status === "ready" ? 2 : status === "preparing" ? 1 : status === "checking" ? 0 : -1;

  return <div className="grid grid-cols-3 gap-2">{steps.map((label, index) => {
    const complete = currentIndex > index;
    const active = currentIndex === index;
    return <div key={label} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]", active ? "bg-primary/10 font-medium text-primary" : complete ? surfaceTheme === "dark" ? "text-slate-300" : "text-foreground" : mutedText(surfaceTheme))}>
      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", complete ? "border-emerald-500 bg-emerald-500 text-white" : active ? "border-primary bg-primary text-primary-foreground" : surfaceTheme === "dark" ? "border-white/15" : "border-border")}>
        {complete ? <Check className="h-2.5 w-2.5" /> : <span className="text-[8px]">{index + 1}</span>}
      </span>
      <span className="truncate">{label}</span>
    </div>;
  })}</div>;
}

function RouteBadge({ label, surfaceTheme }: { label: string; surfaceTheme: SurfaceTheme }) {
  return <span className={cn("ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:inline-flex", surfaceTheme === "dark" ? "border-white/10 bg-white/[0.035] text-slate-300" : "border-border/70 bg-muted/40 text-muted-foreground")}><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{label}</span>;
}

function SecretActions({ shown, copied, onToggle, onCopy }: { shown: boolean; copied: boolean; onToggle: () => void; onCopy: () => void }) {
  return <div className="flex shrink-0 items-center gap-0.5">
    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={shown ? "Hide secret" : "Show secret"} onClick={onToggle}>{shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>
    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={copied ? "Copied" : "Copy secret"} onClick={onCopy}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}</Button>
  </div>;
}

function ManualSetupValue({ label, value, copied, onCopy, surfaceTheme }: { label: string; value: string; copied: boolean; onCopy: () => void; surfaceTheme: SurfaceTheme }) {
  return <div className={cn("flex min-w-0 items-center justify-between gap-1 rounded-xl border px-2.5 py-2", surfaceTheme === "dark" ? "border-white/10" : "border-border/70")}><div className="min-w-0"><p className={cn("text-[10px] uppercase tracking-wider", mutedText(surfaceTheme))}>{label}</p><p className="mt-0.5 truncate font-mono text-xs">{value}</p></div><Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy}>{copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>;
}

function mutedText(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "dark" ? "text-slate-400" : "text-muted-foreground";
}

function isLoopbackBind(bindMode: string | undefined) {
  return !bindMode || /^(local|loopback|localhost)$/i.test(bindMode);
}

function describeRoute(bindMode: string | undefined, configuredGatewayUrl: string | null | undefined) {
  if (configuredGatewayUrl?.includes("tailscale") || configuredGatewayUrl?.includes(".ts.net")) return "Tailscale";
  if (configuredGatewayUrl) return "Public URL";
  return bindMode === "lan" ? "Local network" : "Configured route";
}
