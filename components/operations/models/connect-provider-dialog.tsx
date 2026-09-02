"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Copy, KeyRound, Link2, LoaderCircle, Plus, Settings2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  answerForModelSetupWizardStep,
  initialModelSetupWizardValue,
  toggleModelSetupWizardSelection,
  wizardStateFromResult,
  type ModelSetupWizardResult,
  type ModelSetupWizardState,
  type ModelSetupWizardStep
} from "@/lib/openclaw/domains/model-setup-wizard";
import { presentModelProviderSetupHint, type ModelManagementProvider } from "@/lib/openclaw/domains/model-management";
import { cn } from "@/lib/utils";

type ActiveWizard = {
  sessionId: string;
  authChoice: string;
  flow: "auth" | "prepare" | "activation";
  state: ModelSetupWizardState;
};

type ActionResponse = { error?: string; sessionId?: string; wizard?: ModelSetupWizardResult };

export function ConnectProviderDialog({
  open,
  providers,
  onOpenChange,
  onComplete,
  surfaceTheme = "dark",
  canManageSecrets = true
}: {
  open: boolean;
  providers: ModelManagementProvider[];
  onOpenChange: (open: boolean) => void;
  onComplete: () => Promise<void> | void;
  surfaceTheme?: "dark" | "light";
  canManageSecrets?: boolean;
}) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [authChoice, setAuthChoice] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizard, setWizard] = useState<ActiveWizard | null>(null);
  const wizardSessionRef = useRef<string | null>(null);
  const wizardGenerationRef = useRef(0);
  const [wizardValue, setWizardValue] = useState<unknown>("");
  const [advanced, setAdvanced] = useState(false);
  const [customProviderId, setCustomProviderId] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModelId, setCustomModelId] = useState("");

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectableProviders = useMemo(
    () => providers.filter((provider) => provider.setupAvailable || provider.authMethods.length > 0 || provider.prepareOptions.length > 0),
    [providers]
  );

  useEffect(() => {
    if (!open) {
      setSelectedProviderId(null);
      setAuthChoice(null);
      setApiKey("");
      setError(null);
      setWizard(null);
      setWizardValue("");
      wizardSessionRef.current = null;
      wizardGenerationRef.current += 1;
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
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "OpenClaw could not complete provider setup.");
      return payload;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "OpenClaw could not complete provider setup.";
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const finishSuccessfulWizard = async (active: ActiveWizard, state: Extract<ModelSetupWizardState, { phase: "done" }>) => {
    if (wizardSessionRef.current !== active.sessionId) return;
    if (!state.ready) {
      setWizard({ ...active, state: { phase: "error", message: active.flow === "prepare" ? "OpenClaw prepared this model, but live activation has not completed." : "OpenClaw did not verify this provider connection yet." } });
      return;
    }
    await onComplete();
    if (state.gatewayRestartRequired) {
      toast.info("Connection saved.", { description: "OpenClaw needs to restart before this model is ready." });
      return;
    }
    toast.success("Provider connected.", { description: "OpenClaw verified the provider and model." });
    onOpenChange(false);
  };

  const applyWizardResult = async (active: ActiveWizard, result: ModelSetupWizardResult) => {
    if (wizardSessionRef.current !== active.sessionId) return;
    const nextState = wizardStateFromResult(active.authChoice, result);
    const nextActive = { ...active, state: nextState };
    setWizard(nextActive);
    setWizardValue(nextState.phase === "step" && nextState.step ? initialModelSetupWizardValue(nextState.step) : "");

    if (nextState.phase !== "done") return;
    if (active.flow === "prepare") {
      if (!nextState.preparedModelRef) {
        setWizard({ ...nextActive, state: { phase: "error", message: "OpenClaw finished preparation without returning a model reference." } });
        return;
      }
      if (nextState.ready) {
        await finishSuccessfulWizard(nextActive, nextState);
        return;
      }
      const payload = await runAction({
        action: "start-activation",
        kind: `provider-auto:${encodeURIComponent(active.authChoice)}`,
        modelRef: nextState.preparedModelRef
      });
      if (!payload.sessionId || !payload.wizard) {
        setWizard({ ...nextActive, state: { phase: "error", message: "OpenClaw prepared the model, but activation could not be started." } });
        return;
      }
      if (wizardSessionRef.current !== active.sessionId) {
        await runAction({ action: "wizard-cancel", sessionId: payload.sessionId }).catch(() => undefined);
        return;
      }
      wizardSessionRef.current = payload.sessionId;
      await applyWizardResult(
        { sessionId: payload.sessionId, authChoice: active.authChoice, flow: "activation", state: { phase: "starting", authChoice: active.authChoice } },
        payload.wizard
      );
      return;
    }
    await finishSuccessfulWizard(nextActive, nextState);
  };

  const startWizard = async (flow: ActiveWizard["flow"], body: Record<string, unknown>, choice: string) => {
    const generation = ++wizardGenerationRef.current;
    try {
      const payload = await runAction(body);
      if (!payload.sessionId || !payload.wizard) throw new Error("OpenClaw did not return a provider setup session.");
      if (wizardGenerationRef.current !== generation) {
        await runAction({ action: "wizard-cancel", sessionId: payload.sessionId }).catch(() => undefined);
        return;
      }
      wizardSessionRef.current = payload.sessionId;
      await applyWizardResult(
        { sessionId: payload.sessionId, authChoice: choice, flow, state: { phase: "starting", authChoice: choice } },
        payload.wizard
      );
    } catch {
      // The actionable error remains visible inside the dialog.
    }
  };

  const connectWithApiKey = async () => {
    if (!selectedProvider || !authChoice || !apiKey.trim()) return;
    await startWizard("activation", { action: "start-activation", kind: "api-key", authChoice, apiKey }, authChoice);
    setApiKey("");
  };

  const startInteractiveAuth = async () => {
    if (!selectedProvider || !authChoice) return;
    await startWizard("auth", { action: "start-auth", authChoice }, authChoice);
  };

  const startPrepare = async (option: ModelManagementProvider["prepareOptions"][number]) => {
    await startWizard("prepare", { action: "start-prepare", authChoice: option.id }, option.id);
  };

  const advanceWizard = async (answer?: { stepId: string; value?: unknown }) => {
    if (!wizard || wizard.state.phase !== "step" || !wizard.state.step) return;
    const active = wizard;
    if (wizardSessionRef.current !== active.sessionId) return;
    try {
      const payload = await runAction({ action: "wizard-next", sessionId: active.sessionId, ...(answer ? { answer } : {}) });
      if (!payload.wizard) throw new Error("OpenClaw did not return the next provider setup state.");
      await applyWizardResult(active, payload.wizard);
    } catch {
      // The actionable error remains visible inside the dialog.
    }
  };

  const cancelWizard = async () => {
    const sessionId = wizard?.sessionId;
    wizardGenerationRef.current += 1;
    wizardSessionRef.current = null;
    setWizard(null);
    setWizardValue("");
    if (sessionId) await runAction({ action: "wizard-cancel", sessionId }).catch(() => undefined);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (wizard && wizard.state.phase !== "done") {
        void cancelWizard();
      } else {
        wizardGenerationRef.current += 1;
        wizardSessionRef.current = null;
        setWizard(null);
      }
    }
    onOpenChange(nextOpen);
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
      // The actionable error remains visible inside the dialog.
    }
  };

  const isLight = surfaceTheme === "light";
  const activeStep = wizard?.state.phase === "step" && wizard.state.step ? wizard.state.step : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeClassName="right-3 top-[max(0.75rem,env(safe-area-inset-top))] sm:right-4 sm:top-4" className={cn("flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(88dvh,760px)] sm:max-h-[88dvh] sm:w-[min(720px,calc(100vw-32px))] sm:max-w-[720px] sm:rounded-[24px] sm:border", isLight ? "bg-card text-card-foreground" : "border-white/10 bg-[#080b15] text-white")}>
        <DialogHeader className={cn("shrink-0 border-b px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] pr-14", isLight ? "border-border" : "border-white/10")}>
          <DialogTitle className="text-lg">Connect a provider</DialogTitle>
          <DialogDescription>OpenClaw decides which authentication methods and models this workspace supports.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {wizard ? <WizardStepView busy={busy} state={wizard.state} value={wizardValue} onValueChange={setWizardValue} onBack={() => void cancelWizard()} onAnswer={(value, includeValue = true) => { if (!activeStep) return; const normalized = answerForModelSetupWizardStep(activeStep, value); void advanceWizard({ stepId: activeStep.id, ...(includeValue ? { value: normalized } : {}) }); }} /> : advanced ? <CustomProviderForm busy={busy} providerId={customProviderId} baseUrl={customBaseUrl} apiKey={customApiKey} modelId={customModelId} onChange={{ setProviderId: setCustomProviderId, setBaseUrl: setCustomBaseUrl, setApiKey: setCustomApiKey, setModelId: setCustomModelId }} onSave={() => void saveCustomProvider()} onBack={() => setAdvanced(false)} /> : selectedProvider ? <ProviderAuthChooser provider={selectedProvider} busy={busy} authChoice={authChoice} apiKey={apiKey} error={error} onBack={() => { setSelectedProviderId(null); setAuthChoice(null); setError(null); }} onAuthChoice={setAuthChoice} onApiKey={setApiKey} onConnectApiKey={() => void connectWithApiKey()} onStartInteractive={() => void startInteractiveAuth()} onStartPrepare={(option) => void startPrepare(option)} /> : <div className="space-y-4">
            {error ? <ErrorNotice message={error} /> : null}
            {!canManageSecrets ? <p className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">You can view provider availability, but an owner must manage provider credentials.</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">{selectableProviders.map((provider) => <button key={provider.id} type="button" disabled={!canManageSecrets} onClick={() => setSelectedProviderId(provider.id)} className={cn("flex min-h-20 items-center gap-3 rounded-2xl border px-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60", isLight ? "border-border bg-background hover:border-primary/50 hover:bg-primary/5" : "border-white/10 bg-white/[0.03] hover:border-violet-300/40 hover:bg-violet-400/10")}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{provider.name.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{provider.name}</span><span className="mt-1 block text-xs text-muted-foreground">{provider.status === "connected" ? "Connected · manage account" : provider.authMethods.length || provider.prepareOptions.length ? "Choose a setup method" : "Setup unavailable"}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>)}</div>
            {selectableProviders.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">OpenClaw has not exposed a provider setup method yet. Refresh the Gateway and try again.</p> : null}
            <button type="button" disabled={!canManageSecrets} onClick={() => setAdvanced(true)} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed border-border px-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"><Settings2 className="h-4 w-4" /><span className="flex-1"><span className="block font-medium text-foreground">Advanced: custom provider</span><span className="text-xs">Connect an OpenAI-compatible endpoint configured in OpenClaw.</span></span><ChevronRight className="h-4 w-4" /></button>
          </div>}
        </div>
        <div className={cn("flex shrink-0 items-center justify-between border-t px-4 py-3 sm:px-5", isLight ? "border-border" : "border-white/10")}><span className="text-[0.68rem] text-muted-foreground">Credentials stay in OpenClaw and are never returned here.</span>{wizard ? <Button type="button" variant="secondary" size="sm" onClick={() => void cancelWizard()} disabled={busy}><X className="mr-1.5 h-3.5 w-3.5" />Cancel</Button> : null}</div>
      </DialogContent>
    </Dialog>
  );
}

function ProviderAuthChooser({ provider, busy, authChoice, apiKey, error, onBack, onAuthChoice, onApiKey, onConnectApiKey, onStartInteractive, onStartPrepare }: { provider: ModelManagementProvider; busy: boolean; authChoice: string | null; apiKey: string; error: string | null; onBack: () => void; onAuthChoice: (value: string) => void; onApiKey: (value: string) => void; onConnectApiKey: () => void; onStartInteractive: () => void; onStartPrepare: (option: ModelManagementProvider["prepareOptions"][number]) => void }) {
  const selectedMethod = provider.authMethods.find((method) => method.id === authChoice);
  return <div className="space-y-5"><button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />All providers</button><div><p className="text-xl font-semibold">{provider.name}</p><p className="mt-1 text-sm text-muted-foreground">Choose one of the setup methods OpenClaw exposed for this provider.</p></div>{error ? <ErrorNotice message={error} /> : null}{provider.prepareOptions.length ? <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Provider setup</p>{provider.prepareOptions.map((option) => <button key={option.id} type="button" disabled={busy} onClick={() => onStartPrepare(option)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-background px-3 text-left hover:bg-accent disabled:opacity-60"><Settings2 className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{option.actionLabel || option.label}</span>{presentModelProviderSetupHint(option.hint) ? <span className="mt-0.5 block text-xs text-muted-foreground">{presentModelProviderSetupHint(option.hint)}</span> : null}</span><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>)}</div> : null}{provider.authMethods.length ? <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Authentication</p>{provider.authMethods.map((method) => <button key={method.id} type="button" disabled={method.kind === "other" || busy} onClick={() => onAuthChoice(method.id)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left disabled:cursor-not-allowed disabled:opacity-60", authChoice === method.id ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-accent")}>{method.kind === "api-key" ? <KeyRound className="h-4 w-4 text-primary" /> : <Link2 className="h-4 w-4 text-primary" />}<span className="min-w-0 flex-1"><span className="block text-sm font-medium">{method.label}</span><span className="text-xs text-muted-foreground">{presentModelProviderSetupHint(method.hint) || (method.kind === "api-key" ? "Stored and validated by OpenClaw" : method.kind === "device-code" ? "Continue with OpenClaw device sign-in" : method.kind === "other" ? "Managed by OpenClaw" : "Continue with OpenClaw")}</span></span>{authChoice === method.id ? <Check className="h-4 w-4 text-primary" /> : null}</button>)}</div> : null}{selectedMethod?.kind === "api-key" ? <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4"><Label htmlFor="provider-api-key">API key or token</Label><Input id="provider-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => onApiKey(event.target.value)} placeholder="Paste your credential" onKeyDown={(event) => { if (event.key === "Enter") onConnectApiKey(); }} /><Button type="button" className="w-full" disabled={busy || !apiKey.trim()} onClick={onConnectApiKey}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{busy ? "Connecting..." : "Connect provider"}</Button></div> : selectedMethod && selectedMethod.kind !== "other" ? <Button type="button" className="w-full" disabled={busy} onClick={onStartInteractive}>{busy ? <LoaderCircle className="mr-2 h-4 w-4" /> : <Link2 className="mr-2 h-4 w-4" />}{busy ? "Starting OpenClaw sign-in..." : "Continue"}</Button> : null}</div>;
}

function WizardStepView({ busy, state, value, onValueChange, onBack, onAnswer }: { busy: boolean; state: ModelSetupWizardState; value: unknown; onValueChange: (value: unknown) => void; onBack: () => void; onAnswer: (value: unknown, includeValue?: boolean) => void }) {
  if (state.phase === "starting" || (state.phase === "progressing" && !state.step)) return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />OpenClaw is preparing provider setup.</div>;
  if (state.phase === "error") return <div className="space-y-4"><ErrorNotice message={state.message} /><Button type="button" variant="secondary" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button></div>;
  if (state.phase === "cancelled") return <div className="space-y-4"><p className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">Provider setup was cancelled.</p><Button type="button" variant="secondary" onClick={onBack}>Back</Button></div>;
  if (state.phase === "done") return <div className="space-y-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-5"><Check className="h-6 w-6 text-emerald-500" /><p className="font-semibold">{state.gatewayRestartRequired ? "Connection saved" : state.ready ? "Provider connected" : "Activation pending"}</p><p className="text-sm text-muted-foreground">{state.gatewayRestartRequired ? "OpenClaw needs to restart before this model is ready." : state.ready ? "OpenClaw verified the provider and model." : "OpenClaw has not reported a live activation yet."}</p><Button type="button" variant="secondary" onClick={onBack}>{state.gatewayRestartRequired ? "Close" : "Back"}</Button></div>;
  if (state.phase !== "step" && state.phase !== "progressing") return null;
  const step = state.step;
  if (!step) return null;
  return <WizardStepControls busy={busy || state.busy} step={step} value={value} onValueChange={onValueChange} onBack={onBack} onAnswer={onAnswer} />;
}

function WizardStepControls({ busy, step, value, onValueChange, onBack, onAnswer }: { busy: boolean; step: ModelSetupWizardStep; value: unknown; onValueChange: (value: unknown) => void; onBack: () => void; onAnswer: (value: unknown, includeValue?: boolean) => void }) {
  const openExternalUrl = () => {
    if (!step.externalUrl) return;
    try { const url = new URL(step.externalUrl); if (url.protocol === "https:") window.open(url.toString(), "_blank", "noopener,noreferrer"); } catch { /* Keep malformed provider destinations inert. */ }
  };
  const isSelected = (optionValue: unknown) => step.type === "multiselect" ? Array.isArray(value) && value.some((selected) => Object.is(selected, optionValue)) : Object.is(value, optionValue);
  const submit = () => onAnswer(value);
  return <div className="space-y-5"><button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back</button><div><p className="text-lg font-semibold">{step.title || "OpenClaw provider setup"}</p>{step.message ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.message}</p> : null}</div>{step.deviceCode ? <DeviceCodeCard code={step.deviceCode.code} expiresInMinutes={step.deviceCode.expiresInMinutes} message={step.deviceCode.message} /> : null}{step.externalUrl ? <Button type="button" variant="secondary" className="w-full" onClick={openExternalUrl}><Link2 className="mr-2 h-4 w-4" />Open provider sign-in</Button> : null}{step.type === "select" || step.type === "multiselect" ? <div className="space-y-2" role={step.type === "select" ? "radiogroup" : undefined}>{(step.options ?? []).map((option, index) => <button key={`${step.id}-${index}`} type="button" disabled={busy} aria-pressed={isSelected(option.value)} onClick={() => onValueChange(step.type === "multiselect" ? toggleModelSetupWizardSelection(value, option.value) : option.value)} className={cn("flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm disabled:opacity-60", isSelected(option.value) ? "border-primary bg-primary/10" : "border-border hover:bg-accent")}><span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[0.65rem]", isSelected(option.value) ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>{isSelected(option.value) ? "✓" : ""}</span><span className="min-w-0 flex-1"><span className="block font-medium">{option.label}</span>{option.hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span> : null}</span></button>)}</div> : null}{step.type === "text" ? <Input autoFocus type={step.sensitive ? "password" : "text"} autoComplete={step.sensitive ? "off" : "on"} value={typeof value === "string" ? value : ""} placeholder={step.placeholder} onChange={(event) => onValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /> : null}{step.type === "confirm" ? <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant={value === false ? "default" : "secondary"} disabled={busy} aria-pressed={value === false} onClick={() => onAnswer(false)}>Not now</Button><Button type="button" variant={value === true ? "default" : "secondary"} disabled={busy} aria-pressed={value === true} onClick={() => onAnswer(true)}>Continue</Button></div> : null}{step.type === "note" || step.type === "action" || (step.type === "progress" && step.executor !== "gateway") ? <Button type="button" disabled={busy} onClick={() => onAnswer(undefined, false)}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}{step.type === "action" && step.externalUrl ? "Continue after sign-in" : busy ? "Working..." : "Continue"}</Button> : null}{step.type === "progress" && step.executor === "gateway" ? <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />OpenClaw is working…</p> : null}{(step.type === "select" || step.type === "multiselect" || step.type === "text") ? <Button type="button" disabled={busy || (step.type === "select" && (value === "" || value === undefined))} onClick={submit}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}{busy ? "Working..." : "Continue"}</Button> : null}</div>;
}

function DeviceCodeCard({ code, expiresInMinutes, message }: { code: string; expiresInMinutes?: number; message?: string }) { const copy = async () => { const write = navigator.clipboard?.writeText(code); if (write) await write.catch(() => undefined); }; return <div className="rounded-2xl border border-primary/30 bg-primary/10 p-5 text-center"><p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Device code</p><p className="mt-2 break-all font-mono text-2xl font-semibold tracking-[0.2em]">{code}</p>{message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}<div className="mt-3 flex flex-wrap items-center justify-center gap-2"><Button type="button" variant="secondary" size="sm" onClick={() => void copy()}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy code</Button>{expiresInMinutes ? <span className="text-xs text-muted-foreground">Expires in {expiresInMinutes} minutes</span> : null}</div></div>; }

function CustomProviderForm({ busy, providerId, baseUrl, apiKey, modelId, onChange, onSave, onBack }: { busy: boolean; providerId: string; baseUrl: string; apiKey: string; modelId: string; onChange: { setProviderId: (value: string) => void; setBaseUrl: (value: string) => void; setApiKey: (value: string) => void; setModelId: (value: string) => void }; onSave: () => void; onBack: () => void }) { return <div className="space-y-4"><button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Connection methods</button><div><p className="text-lg font-semibold">Custom provider</p><p className="mt-1 text-sm text-muted-foreground">Saved as a distinct OpenClaw provider under models.providers.*.</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Provider ID"><Input value={providerId} onChange={(event) => onChange.setProviderId(event.target.value)} placeholder="my-provider" /></Field><Field label="Base URL"><Input type="url" value={baseUrl} onChange={(event) => onChange.setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></Field><Field label="Optional model ID"><Input value={modelId} onChange={(event) => onChange.setModelId(event.target.value)} placeholder="model-name" /></Field></div><Field label="Credential"><Input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => onChange.setApiKey(event.target.value)} placeholder="Paste the provider credential" /></Field><Button type="button" className="w-full" disabled={busy || !providerId.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={onSave}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}{busy ? "Saving..." : "Save custom provider"}</Button></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>; }
function ErrorNotice({ message }: { message: string }) { return <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-700 dark:text-rose-200">{message}</div>; }
