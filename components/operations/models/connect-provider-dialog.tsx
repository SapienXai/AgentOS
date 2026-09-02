"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, KeyRound, Link2, LoaderCircle, Plus, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import type { ModelManagementProvider } from "@/lib/openclaw/domains/model-management";
import { cn } from "@/lib/utils";

type WizardStep = {
  id: string;
  type: "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";
  title?: string;
  message?: string;
  options?: Array<{ value: unknown; label: string; hint?: string }>;
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  externalUrl?: string;
  deviceCode?: { code: string; expiresInMinutes?: number; message?: string };
};

type WizardResult = {
  done?: boolean;
  step?: WizardStep;
  error?: string;
  modelActivation?: { modelRef: string };
};

export function ConnectProviderDialog({
  open,
  providers,
  onOpenChange,
  onComplete,
  surfaceTheme = "dark"
}: {
  open: boolean;
  providers: ModelManagementProvider[];
  onOpenChange: (open: boolean) => void;
  onComplete: () => Promise<void> | void;
  surfaceTheme?: "dark" | "light";
}) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [authChoice, setAuthChoice] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<WizardResult | null>(null);
  const [wizardValue, setWizardValue] = useState<unknown>("");
  const [advanced, setAdvanced] = useState(false);
  const [customProviderId, setCustomProviderId] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModelId, setCustomModelId] = useState("");

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectableProviders = useMemo(
    () => providers.filter((provider) => provider.setupAvailable || provider.authMethods.length > 0),
    [providers]
  );

  useEffect(() => {
    if (!open) {
      setSelectedProviderId(null);
      setAuthChoice(null);
      setApiKey("");
      setError(null);
      setWizardSessionId(null);
      setWizard(null);
      setAdvanced(false);
    }
  }, [open]);

  const runAction = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/models/management", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null) as { error?: string; wizard?: WizardResult; sessionId?: string } | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "OpenClaw could not complete the provider setup.");
      }
      return payload;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "OpenClaw could not complete the provider setup.";
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const connectWithApiKey = async () => {
    if (!selectedProvider || !authChoice || !apiKey.trim()) return;
    try {
      await runAction({ action: "activate-api-key", authChoice, apiKey });
      setApiKey("");
      toast.success("Provider connected.", { description: "OpenClaw verified the connection." });
      await onComplete();
      onOpenChange(false);
    } catch {
      // The actionable error is rendered inside the dialog.
    }
  };

  const startInteractiveAuth = async () => {
    if (!selectedProvider || !authChoice) return;
    try {
      const payload = await runAction({ action: "start-auth", authChoice });
      setWizardSessionId(payload.sessionId ?? null);
      setWizard(payload.wizard ?? null);
      setWizardValue(payload.wizard?.step?.initialValue ?? "");
    } catch {
      // The actionable error is rendered inside the dialog.
    }
  };

  const advanceWizard = async (answer?: { stepId: string; value?: unknown }) => {
    if (!wizardSessionId) return;
    try {
      const payload = await runAction({ action: "wizard-next", sessionId: wizardSessionId, ...(answer ? { answer } : {}) });
      const nextWizard = payload.wizard ?? null;
      setWizard(nextWizard);
      setWizardValue(nextWizard?.step?.initialValue ?? "");
      if (nextWizard?.done) {
        toast.success("Provider connected.", { description: "OpenClaw completed the authentication flow." });
        await onComplete();
        onOpenChange(false);
      }
    } catch {
      // The actionable error is rendered inside the dialog.
    }
  };

  const cancelWizard = async () => {
    if (!wizardSessionId) return;
    try {
      await runAction({ action: "wizard-cancel", sessionId: wizardSessionId });
    } finally {
      setWizardSessionId(null);
      setWizard(null);
    }
  };

  const saveCustomProvider = async () => {
    if (!customProviderId.trim() || !customBaseUrl.trim() || !customApiKey.trim()) return;
    try {
      await runAction({
        action: "create-custom-provider",
        providerId: customProviderId,
        baseUrl: customBaseUrl,
        apiKey: customApiKey,
        models: customModelId.trim() ? [{ id: customModelId.trim() }] : undefined
      });
      setCustomApiKey("");
      toast.success("Custom provider saved.", { description: "OpenClaw will include it in the model catalog." });
      await onComplete();
      onOpenChange(false);
    } catch {
      // The actionable error is rendered inside the dialog.
    }
  };

  const isLight = surfaceTheme === "light";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeClassName="right-3 top-[max(0.75rem,env(safe-area-inset-top))] sm:right-4 sm:top-4"
        className={cn(
          "flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(88dvh,760px)] sm:max-h-[88dvh] sm:w-[min(720px,calc(100vw-32px))] sm:max-w-[720px] sm:rounded-[24px] sm:border",
          isLight ? "bg-card text-card-foreground" : "border-white/10 bg-[#080b15] text-white"
        )}
      >
        <DialogHeader className={cn("shrink-0 border-b px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] pr-14", isLight ? "border-border" : "border-white/10")}>
          <DialogTitle className="text-lg">Connect a provider</DialogTitle>
          <DialogDescription>
            OpenClaw decides which authentication methods and models this workspace supports.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {wizardSessionId && wizard ? (
            <WizardStepView
              busy={busy}
              result={wizard}
              value={wizardValue}
              onValueChange={setWizardValue}
              onBack={() => void cancelWizard()}
              onContinue={() => void advanceWizard({ stepId: wizard.step?.id ?? "", value: wizardValue })}
              onSkip={() => void advanceWizard()}
            />
          ) : advanced ? (
            <CustomProviderForm
              busy={busy}
              providerId={customProviderId}
              baseUrl={customBaseUrl}
              apiKey={customApiKey}
              modelId={customModelId}
              onChange={{ setProviderId: setCustomProviderId, setBaseUrl: setCustomBaseUrl, setApiKey: setCustomApiKey, setModelId: setCustomModelId }}
              onSave={() => void saveCustomProvider()}
              onBack={() => setAdvanced(false)}
            />
          ) : selectedProvider ? (
            <ProviderAuthChooser
              provider={selectedProvider}
              busy={busy}
              authChoice={authChoice}
              apiKey={apiKey}
              error={error}
              onBack={() => { setSelectedProviderId(null); setAuthChoice(null); setError(null); }}
              onAuthChoice={setAuthChoice}
              onApiKey={setApiKey}
              onConnectApiKey={() => void connectWithApiKey()}
              onStartInteractive={() => void startInteractiveAuth()}
            />
          ) : (
            <div className="space-y-4">
              {error ? <ErrorNotice message={error} /> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {selectableProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProviderId(provider.id)}
                    className={cn("flex min-h-20 items-center gap-3 rounded-2xl border px-4 text-left transition-colors", isLight ? "border-border bg-background hover:border-primary/50 hover:bg-primary/5" : "border-white/10 bg-white/[0.03] hover:border-violet-300/40 hover:bg-violet-400/10")}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{provider.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{provider.name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{provider.status === "connected" ? "Connected · manage account" : provider.authMethods.length ? "Choose a sign-in method" : "Setup unavailable"}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
              {selectableProviders.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">OpenClaw has not exposed a provider setup method yet. Refresh the Gateway and try again.</p> : null}
              <button type="button" onClick={() => setAdvanced(true)} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                <Settings2 className="h-4 w-4" />
                <span className="flex-1"><span className="block font-medium text-foreground">Advanced: custom provider</span><span className="text-xs">Connect an OpenAI-compatible endpoint configured in OpenClaw.</span></span>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <div className={cn("flex shrink-0 items-center justify-between border-t px-4 py-3 sm:px-5", isLight ? "border-border" : "border-white/10")}>
          <span className="text-[0.68rem] text-muted-foreground">Credentials stay in OpenClaw and are never returned here.</span>
          {wizardSessionId ? <Button type="button" variant="secondary" size="sm" onClick={() => void cancelWizard()} disabled={busy}><X className="mr-1.5 h-3.5 w-3.5" />Cancel</Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderAuthChooser({
  provider,
  busy,
  authChoice,
  apiKey,
  error,
  onBack,
  onAuthChoice,
  onApiKey,
  onConnectApiKey,
  onStartInteractive
}: {
  provider: ModelManagementProvider;
  busy: boolean;
  authChoice: string | null;
  apiKey: string;
  error: string | null;
  onBack: () => void;
  onAuthChoice: (value: string) => void;
  onApiKey: (value: string) => void;
  onConnectApiKey: () => void;
  onStartInteractive: () => void;
}) {
  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />All providers</button>
      <div>
        <p className="text-xl font-semibold">{provider.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">Select an authentication method provided by OpenClaw.</p>
      </div>
      {error ? <ErrorNotice message={error} /> : null}
      <div className="space-y-2">
        {provider.authMethods.map((method) => (
          <button key={method.id} type="button" onClick={() => onAuthChoice(method.id)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left", authChoice === method.id ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent")}>
            {method.kind === "api-key" ? <KeyRound className="h-4 w-4 text-primary" /> : <Link2 className="h-4 w-4 text-primary" />}
            <span className="flex-1"><span className="block text-sm font-medium">{method.label}</span><span className="text-xs text-muted-foreground">{method.kind === "api-key" ? "Stored and validated by OpenClaw" : method.kind === "device-code" ? "Continue with OpenClaw device sign-in" : "Continue with OpenClaw"}</span></span>
            {authChoice === method.id ? <Check className="h-4 w-4 text-primary" /> : null}
          </button>
        ))}
      </div>
      {authChoice ? (
        provider.authMethods.find((method) => method.id === authChoice)?.kind === "api-key" ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
            <Label htmlFor="provider-api-key">API key or token</Label>
            <Input id="provider-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => onApiKey(event.target.value)} placeholder="Paste your credential" onKeyDown={(event) => { if (event.key === "Enter") onConnectApiKey(); }} />
            <Button type="button" className="w-full" disabled={busy || !apiKey.trim()} onClick={onConnectApiKey}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{busy ? "Connecting..." : "Connect provider"}</Button>
          </div>
        ) : (
          <Button type="button" className="w-full" disabled={busy} onClick={onStartInteractive}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}{busy ? "Starting OpenClaw sign-in..." : "Continue"}</Button>
        )
      ) : <p className="text-xs text-muted-foreground">Choose a method to continue.</p>}
    </div>
  );
}

function WizardStepView({ busy, result, value, onValueChange, onBack, onContinue, onSkip }: { busy: boolean; result: WizardResult; value: unknown; onValueChange: (value: unknown) => void; onBack: () => void; onContinue: () => void; onSkip: () => void }) {
  const step = result.step;
  if (result.error) return <div className="space-y-4"><ErrorNotice message={result.error} /><Button type="button" variant="secondary" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></div>;
  if (result.done) return <div className="space-y-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5"><Check className="h-6 w-6 text-emerald-500" /><p className="font-semibold">OpenClaw sign-in complete</p><p className="text-sm text-muted-foreground">The provider is ready for model selection.</p></div>;
  if (!step) return <div className="space-y-4"><p className="text-sm text-muted-foreground">OpenClaw is preparing the sign-in flow.</p><Button type="button" disabled={busy} onClick={onSkip}>Continue</Button></div>;
  const isChoice = step.type === "select" || step.type === "multiselect";
  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back</button>
      <div><p className="text-lg font-semibold">{step.title || "OpenClaw sign-in"}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.message || "Follow the provider's authentication steps."}</p></div>
      {step.deviceCode ? <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 text-center"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Device code</p><p className="mt-2 font-mono text-2xl font-semibold tracking-[0.2em]">{step.deviceCode.code}</p>{step.deviceCode.message ? <p className="mt-2 text-xs text-muted-foreground">{step.deviceCode.message}</p> : null}</div> : null}
      {step.externalUrl ? <Button type="button" variant="secondary" className="w-full" onClick={() => window.open(step.externalUrl, "_blank", "noopener,noreferrer")}><Link2 className="mr-2 h-4 w-4" />Open provider sign-in</Button> : null}
      {isChoice ? <div className="space-y-2">{step.options?.map((option) => <button key={String(option.value)} type="button" onClick={() => onValueChange(step.type === "multiselect" ? [option.value] : option.value)} className={cn("flex w-full items-center rounded-xl border px-3 py-3 text-left text-sm", String(value) === String(option.value) ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}>{option.label}</button>)}</div> : null}
      {!isChoice && ["text", "confirm"].includes(step.type) ? <Input autoFocus type={step.sensitive ? "password" : "text"} value={typeof value === "string" ? value : ""} placeholder={step.placeholder} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onContinue(); }} /> : null}
      <div className="flex justify-end"><Button type="button" disabled={busy} onClick={step.type === "note" || step.type === "progress" || step.type === "action" ? onSkip : onContinue}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}{busy ? "Working..." : step.type === "action" ? "Continue" : "Next"}</Button></div>
    </div>
  );
}

function CustomProviderForm({ busy, providerId, baseUrl, apiKey, modelId, onChange, onSave, onBack }: { busy: boolean; providerId: string; baseUrl: string; apiKey: string; modelId: string; onChange: { setProviderId: (value: string) => void; setBaseUrl: (value: string) => void; setApiKey: (value: string) => void; setModelId: (value: string) => void }; onSave: () => void; onBack: () => void }) {
  return <div className="space-y-4"><button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Connection methods</button><div><p className="text-lg font-semibold">Custom provider</p><p className="mt-1 text-sm text-muted-foreground">Saved as a distinct OpenClaw provider under models.providers.*.</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Provider ID"><Input value={providerId} onChange={(event) => onChange.setProviderId(event.target.value)} placeholder="my-provider" /></Field><Field label="Base URL"><Input value={baseUrl} onChange={(event) => onChange.setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></Field><Field label="Optional model ID"><Input value={modelId} onChange={(event) => onChange.setModelId(event.target.value)} placeholder="model-name" /></Field></div><Field label="Credential"><Input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => onChange.setApiKey(event.target.value)} placeholder="Paste the provider credential" /></Field><Button type="button" className="w-full" disabled={busy || !providerId.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={onSave}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{busy ? "Saving..." : "Save custom provider"}</Button></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function ErrorNotice({ message }: { message: string }) { return <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-200">{message}</div>; }
