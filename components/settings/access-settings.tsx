"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, QrCode } from "lucide-react";

import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { SettingsSection } from "@/components/settings/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RemoteAccessChange, RemoteAccessSettings } from "@/lib/security/remote-access-policy";

type AccessView = RemoteAccessSettings & { environmentOrigins: string[]; lanOrigins: string[] };

async function requestAccess(change?: RemoteAccessChange, signal?: AbortSignal): Promise<AccessView> {
  const response = await fetch("/api/auth/access", change ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change)
  } : { cache: "no-store", signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Access settings could not be loaded.");
  return payload;
}

export function AccessSettings({ surfaceTheme }: { surfaceTheme: "dark" | "light" }) {
  const { status } = useInstanceProtection();
  const enabled = status?.protectionEnabled === true;
  const [settings, setSettings] = useState<AccessView | null>(null);
  const [origin, setOrigin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [qrOrigin, setQrOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void requestAccess(undefined, controller.signal).then(setSettings).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, [enabled, status?.actorId]);

  async function save(change: RemoteAccessChange) {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      setSettings(await requestAccess(change));
      if (change.action === "add") setOrigin("");
      setFeedback("Access settings saved.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Access settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection title="Access" description="Sign in from another device using an approved HTTPS address." surfaceTheme={surfaceTheme}>
      {!enabled ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          Set up <Link className="font-medium text-foreground underline" href="/settings#security">Instance Protection</Link> to manage remote sign-in.
        </p>
      ) : null}
      {enabled && !settings && !error ? <p role="status" className="text-sm text-muted-foreground">Loading access settings…</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-xl border border-destructive/40 bg-card p-3 text-sm text-foreground">{error}</p> : null}
      {enabled && settings ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="access-lan-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="access-lan-title" className="text-sm font-semibold">Local network access</h3>
                <p id="access-lan-help" className="mt-1 text-sm leading-5 text-muted-foreground">
                  Allow sign-in over HTTPS on this host’s private IP addresses. The HTTPS listener and a certificate trusted by your phone must be ready before connecting.
                </p>
              </div>
              <label className="relative flex min-h-11 shrink-0 items-center">
                <input type="checkbox" role="switch" {...{ switch: "" }} checked={settings.lanEnabled}
                  disabled={saving || (!settings.lanOrigins.length && !settings.lanEnabled)}
                  aria-labelledby="access-lan-title" aria-describedby="access-lan-help"
                  className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  onChange={(event) => void save({ action: "lan", enabled: event.currentTarget.checked })} />
                <span aria-hidden="true" className="pointer-events-none block h-6 w-11 rounded-full border border-border bg-muted p-0.5 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card peer-disabled:opacity-50 [&>span]:peer-checked:translate-x-5">
                  <span className="block h-4 w-4 rounded-full bg-foreground motion-safe:transition-transform" />
                </span>
              </label>
            </div>
            {!settings.lanOrigins.length ? <p className="mt-3 text-sm text-muted-foreground">No private IPv4 address is currently available.</p> : null}
            {settings.lanEnabled && settings.lanOrigins.length ? (
              <ul className="mt-3 divide-y divide-border border-t border-border">
                {settings.lanOrigins.map((address) => (
                  <li key={address} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a href={address} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-sm font-medium underline underline-offset-4">
                        {address}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </a>
                      <Button type="button" size="sm" variant="ghost" aria-expanded={qrOrigin === address}
                        onClick={() => setQrOrigin(qrOrigin === address ? null : address)}>
                        <QrCode className="mr-1.5 h-4 w-4" aria-hidden="true" />QR code
                      </Button>
                    </div>
                    {qrOrigin === address ? <AccessQrCode address={address} /> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="access-origins-title">
            <h3 id="access-origins-title" className="text-sm font-semibold">Trusted HTTPS addresses</h3>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Add a domain or tunnel that already routes to this AgentOS instance. Users still sign in with their AgentOS account.</p>
            <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void save({ action: "add", origin }); }}>
              <Label htmlFor="access-origin">HTTPS address</Label>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Input id="access-origin" type="url" required maxLength={512} autoCapitalize="none" spellCheck={false}
                  placeholder="https://agentos.example.com" value={origin} onChange={(event) => setOrigin(event.currentTarget.value)} />
                <Button type="submit" size="sm" className="h-10 shrink-0" disabled={saving || !origin.trim()}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add address</Button>
              </div>
            </form>
            {settings.origins.length || settings.environmentOrigins.length ? (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {[...new Set([...settings.origins, ...settings.environmentOrigins])].map((address) => (
                  <li key={address} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-all">{address}</span>
                    {settings.environmentOrigins.includes(address) ? <Badge variant="muted">Server configured</Badge> : (
                      <Button type="button" size="sm" variant="ghost" disabled={saving} aria-label={`Remove ${address}`}
                        onClick={() => void save({ action: "remove", origin: address })}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-4 text-sm text-muted-foreground">No trusted addresses added.</p>}
          </section>
          <p role="status" className="text-sm text-muted-foreground">{feedback}</p>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function AccessQrCode({ address }: { address: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    void import("qrcode").then(({ toCanvas }) => toCanvas(element, address, { width: 144, margin: 3 })).catch(() => setError(true));
  }, [address]);
  return error ? <p className="text-sm text-muted-foreground">QR code unavailable. Open the address on your phone.</p>
    : <canvas ref={canvas} role="img" aria-label={`QR code for ${address}`} className="mt-2 rounded-md" />;
}
