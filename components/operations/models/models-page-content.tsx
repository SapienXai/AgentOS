"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BrainCircuit, ChevronDown, ChevronRight, CircleAlert, CircleHelp, LoaderCircle, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { ConnectProviderDialog } from "@/components/operations/models/connect-provider-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { ModelManagementProvider, ModelManagementSnapshot } from "@/lib/openclaw/domains/model-management";
import { formatModelProviderLabel } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import { readClientError } from "@/components/operations/operations-shared";

export function ModelsPageContent({ snapshot, surfaceTheme, refresh }: { snapshot: MissionControlSnapshot; surfaceTheme: "dark" | "light"; refresh: () => Promise<void> }) {
  const [management, setManagement] = useState<ModelManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [draftDefault, setDraftDefault] = useState("");
  const [fallbackEditorOpen, setFallbackEditorOpen] = useState(false);
  const [fallbackDraft, setFallbackDraft] = useState<string[]>([]);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ModelManagementProvider | null>(null);

  const loadManagement = async (force = false) => {
    if (force) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/models/management?setup=1${force ? "&refresh=1" : ""}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as (ModelManagementSnapshot & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || "OpenClaw model management is temporarily unavailable.");
      setManagement(payload);
      setDraftDefault(payload.defaultModel ?? "");
      setFallbackDraft(payload.fallbackModels);
      setPolicyDraft(payload.modelPolicy.allow ?? []);
      return payload;
    } catch (cause) {
      setError(readClientError(cause));
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadManagement(); }, []);

  const models = management?.models ?? snapshot.models.map((model) => ({
    id: model.id,
    name: model.name && model.name !== model.id ? model.name : humanizeModelId(model.id),
    provider: model.provider,
    providerName: formatModelProviderLabel(model.provider),
    input: model.input,
    contextWindow: model.contextWindow,
    available: model.available,
    tags: model.tags,
    role: "available" as const,
    linkedAgents: model.usageCount,
    advanced: { rawId: model.id, providerId: model.provider, deprecated: false, disabled: false }
  }));
  const defaultModel = management?.defaultModel ?? snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel ?? null;
  const fallbackModels = management?.fallbackModels ?? [];
  const availableModels = models.filter((model) => model.available !== false && !model.advanced.disabled && !model.advanced.deprecated);
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;
  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return models.filter((model) => !query || `${model.name} ${model.providerName} ${model.id} ${model.tags.join(" ")}`.toLowerCase().includes(query));
  }, [models, search]);
  const providers = management?.providers ?? buildFallbackProviders(models);
  const visibleFallbacks = fallbackDraft;
  const disconnectModels = disconnectTarget ? models.filter((model) => model.provider === disconnectTarget.id) : [];
  const disconnectDefault = disconnectTarget && defaultModel ? models.find((model) => model.id.toLowerCase() === defaultModel.toLowerCase() && model.provider === disconnectTarget.id) : null;
  const disconnectFallbacks = disconnectTarget ? fallbackModels.filter((modelId) => models.some((model) => model.id.toLowerCase() === modelId.toLowerCase() && model.provider === disconnectTarget.id)) : [];
  const disconnectLinkedAgents = disconnectModels.reduce((total, model) => total + model.linkedAgents, 0);

  const mutate = async (action: Record<string, unknown>, success: string) => {
    setSaving(String(action.action));
    try {
      const response = await fetch("/api/models/management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const payload = await response.json().catch(() => null) as { error?: string; state?: ModelManagementSnapshot } | null;
      if (!response.ok || !payload?.state) throw new Error(payload?.error || "OpenClaw could not save this setting.");
      setManagement(payload.state);
      setDraftDefault(payload.state.defaultModel ?? "");
      setFallbackDraft(payload.state.fallbackModels);
      setPolicyDraft(payload.state.modelPolicy.allow ?? []);
      toast.success(success);
      await refresh();
    } catch (cause) {
      toast.error("Could not save model settings.", { description: readClientError(cause) });
    } finally {
      setSaving(null);
    }
  };

  const setDefault = () => draftDefault && draftDefault !== defaultModel ? void mutate({ action: "set-default", modelId: draftDefault }, "Default model updated.") : undefined;
  const saveFallbacks = () => void mutate({ action: "set-fallbacks", modelIds: fallbackDraft }, "Fallback order updated.");
  const savePolicy = () => void mutate({ action: "set-policy", allow: policyDraft.length ? policyDraft : null }, policyDraft.length ? "Model access policy updated." : "All models are allowed.");
  const statusText = loading ? "Loading OpenClaw catalog..." : error ? error : `${models.length} models from OpenClaw`;

  return <>
    <OperationsPageLayout
      main={<div className="space-y-3">
        <PageHeader surfaceTheme={surfaceTheme} title="Models" subtitle="Manage the AI models and providers available to your workforce." actions={<Button size="sm" className="h-9 rounded-xl px-3 text-xs" onClick={() => setConnectOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Connect Provider</Button>} />
        {error ? <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><Button variant="secondary" size="sm" className="h-8 shrink-0 rounded-lg text-xs" onClick={() => void loadManagement(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Retry"}</Button></div> : null}

        <SectionCard>
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex min-w-0 items-center gap-3"><EntityIcon icon={BrainCircuit} label="Default" tone="info" /><div className="min-w-0"><p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Default model</p><p className="mt-1 truncate text-base font-semibold text-foreground">{modelLabel(defaultModel, models)}</p><p className="mt-0.5 text-xs text-muted-foreground">{providerLabel(defaultModel, models)} · {defaultModel ? "OpenClaw default" : "Choose a model for your workforce"}</p></div></div>
            <div className="flex w-full gap-2 sm:w-auto"><select aria-label="Choose default model" value={draftDefault} onChange={(event) => setDraftDefault(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-xs text-foreground sm:w-[240px] sm:flex-none"><option value="">No default configured</option>{defaultModel && !availableModels.some((model) => model.id === defaultModel) ? <option value={defaultModel}>{modelLabel(defaultModel, models)} · currently unavailable</option> : null}{availableModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.providerName}</option>)}</select><Button size="sm" className="h-10 rounded-xl px-3 text-xs" disabled={!draftDefault || draftDefault === defaultModel || Boolean(saving)} onClick={setDefault}>{saving === "set-default" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Change"}</Button></div>
          </div>
        </SectionCard>

        <SectionCard title="Fallbacks" action={<Button variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => { setFallbackDraft(fallbackModels); setFallbackEditorOpen((current) => !current); }}>{fallbackEditorOpen ? "Done" : "Edit"}</Button>}>
          <div className="px-3 py-2.5">{visibleFallbacks.length === 0 && !fallbackEditorOpen ? <p className="py-2 text-xs text-muted-foreground">OpenClaw has no fallback models configured.</p> : <div className="space-y-1.5">{visibleFallbacks.map((id, index) => <div key={`${id}-${index}`} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[0.68rem] font-semibold text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{modelLabel(id, models)}</span><span className="block truncate text-[0.68rem] text-muted-foreground">{providerLabel(id, models)}</span></span>{fallbackEditorOpen ? <><Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={index === 0} aria-label={`Move ${modelLabel(id, models)} up`} onClick={() => setFallbackDraft((current) => moveItem(current, index, index - 1))}><ArrowUp className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={index === fallbackDraft.length - 1} aria-label={`Move ${modelLabel(id, models)} down`} onClick={() => setFallbackDraft((current) => moveItem(current, index, index + 1))}><ArrowDown className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" aria-label={`Remove ${modelLabel(id, models)} from fallbacks`} onClick={() => setFallbackDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-3.5 w-3.5" /></Button></> : null}</div>)}{fallbackEditorOpen ? <div className="flex flex-col gap-2 pt-2 sm:flex-row"><select aria-label="Add fallback model" defaultValue="" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-xs text-foreground" onChange={(event) => { const modelId = event.target.value; if (modelId) setFallbackDraft((current) => current.includes(modelId) ? current : [...current, modelId]); }}><option value="">Add a fallback model...</option>{availableModels.filter((model) => !fallbackDraft.includes(model.id) && model.id !== draftDefault).map((model) => <option key={model.id} value={model.id}>{model.name} · {model.providerName}</option>)}</select><Button type="button" size="sm" className="h-10 rounded-xl text-xs" disabled={Boolean(saving)} onClick={saveFallbacks}>{saving === "set-fallbacks" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Save order"}</Button></div> : null}</div>}</div>
        </SectionCard>

        <SectionCard title="Available models" action={<Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={() => void loadManagement(true)} disabled={refreshing}>{refreshing ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh</Button>}>
          <div className="border-b border-border px-3 py-2.5"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models..." className="h-9 rounded-xl pl-9 text-xs" /></div></div>
          {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />{statusText}</div> : visibleModels.length === 0 ? <EmptyState title="No models found" description="Connect a provider or change your search. Available models come from OpenClaw's catalog." /> : <div className="divide-y divide-border">{visibleModels.map((model) => <ModelRow key={model.id} model={model} selected={selectedModelId === model.id} onSelect={() => setSelectedModelId(model.id)} defaultModel={defaultModel} fallbackPosition={fallbackModels.indexOf(model.id) + 1} />)}</div>}
        </SectionCard>

        <SectionCard title="Providers" action={<Button variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => setConnectOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />Connect Provider</Button>}>
          {providers.length === 0 ? <EmptyState title="No providers connected" description="Connect a provider to make its models available to your workforce." /> : <div className="grid gap-2 p-2.5 sm:grid-cols-2">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} models={models.filter((model) => model.provider === provider.id)} onDisconnect={provider.canLogout ? () => setDisconnectTarget(provider) : undefined} />)}</div>}
        </SectionCard>

        <SectionCard title="Advanced" action={<Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-xs" onClick={() => setPolicyOpen((current) => !current)}>{policyOpen ? "Hide" : "Show"}<ChevronDown className={cn("ml-1 h-3.5 w-3.5 transition-transform", policyOpen && "rotate-180")} /></Button>}>
          {policyOpen ? <div className="space-y-4 p-3"><div><p className="text-sm font-semibold text-foreground">Model access policy</p><p className="mt-1 text-xs leading-5 text-muted-foreground">An empty policy means OpenClaw allows all models. This is separate from aliases and per-model settings.</p></div><div className="flex flex-col gap-2 sm:flex-row"><select aria-label="Add allowed model pattern" defaultValue="" className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-xs text-foreground" onChange={(event) => { if (event.target.value && !policyDraft.includes(event.target.value)) setPolicyDraft([...policyDraft, event.target.value]); event.target.value = ""; }}><option value="">Add a model or provider pattern...</option>{[...new Set(models.map((model) => model.provider).filter(Boolean))].map((provider) => <option key={`${provider}/*`} value={`${provider}/*`}>{provider}{"/"}{"*"}</option>)}{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select><Button size="sm" className="h-10 rounded-xl text-xs" disabled={Boolean(saving)} onClick={savePolicy}>{saving === "set-policy" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : "Save policy"}</Button></div><div className="flex flex-wrap gap-1.5">{policyDraft.length ? policyDraft.map((entry) => <button key={entry} type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-[0.68rem] text-foreground" onClick={() => setPolicyDraft(policyDraft.filter((item) => item !== entry))}>{entry}<Trash2 className="h-3 w-3 text-muted-foreground" /></button>) : <MiniBadge>All models allowed</MiniBadge>}</div><div className="grid gap-2 rounded-xl border border-border bg-muted/25 p-3 sm:grid-cols-2"><KeyValue label="Catalog view" value={management?.view ?? "default"} /><KeyValue label="Catalog source" value="OpenClaw models.list" /><KeyValue label="Auth status" value={management?.diagnostics.authStatusAvailable ? "OpenClaw native" : "Unavailable"} /><KeyValue label="Setup metadata" value={management?.diagnostics.setupMetadataAvailable ? "OpenClaw native" : "Unavailable"} /><KeyValue label="Default ref" value={defaultModel ?? "Not configured"} /><KeyValue label="Models page state" value={statusText} /></div></div> : <p className="px-3 py-3 text-xs text-muted-foreground">Technical provider IDs, auth state, policy rules, and catalog diagnostics are available here when needed.</p>}
        </SectionCard>
      </div>}
      inspector={selectedModel ? <ModelInspector model={selectedModel} defaultModel={defaultModel} fallbackPosition={fallbackModels.indexOf(selectedModel.id) + 1} onClose={() => setSelectedModelId(null)} /> : null}
    />
    <ConnectProviderDialog open={connectOpen} providers={providers} onOpenChange={setConnectOpen} onComplete={async () => { await loadManagement(true); await refresh(); }} surfaceTheme={surfaceTheme} />
    <Dialog open={Boolean(disconnectTarget)} onOpenChange={(open) => { if (!open && !saving) setDisconnectTarget(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect {disconnectTarget?.name ?? "provider"}?</DialogTitle>
          <DialogDescription>OpenClaw will remove the selected saved credential. Existing model and fallback settings stay in place and may need a replacement connection.</DialogDescription>
        </DialogHeader>
        {disconnectTarget ? <div className="space-y-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200"><p className="font-semibold">Check before disconnecting</p>{disconnectDefault ? <p>{modelLabel(disconnectDefault.id, models)} is the current default model.</p> : null}{disconnectFallbacks.length ? <p>{disconnectFallbacks.length} fallback {disconnectFallbacks.length === 1 ? "model uses" : "models use"} this provider.</p> : null}{disconnectLinkedAgents ? <p>{disconnectLinkedAgents} linked agent {disconnectLinkedAgents === 1 ? "uses" : "use"} this provider.</p> : null}{!disconnectDefault && disconnectFallbacks.length === 0 && disconnectLinkedAgents === 0 ? <p>No current default, fallback, or agent links were found.</p> : null}</div> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setDisconnectTarget(null)} disabled={Boolean(saving)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => { if (!disconnectTarget) return; const target = disconnectTarget; setDisconnectTarget(null); void mutate({ action: "logout", provider: target.id }, `${target.name} disconnected.`); }} disabled={Boolean(saving)}>Disconnect</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function ModelRow({ model, selected, onSelect, defaultModel, fallbackPosition }: { model: ModelManagementSnapshot["models"][number]; selected: boolean; onSelect: () => void; defaultModel: string | null; fallbackPosition: number }) {
  const unavailable = model.available === false || model.role === "unavailable";
  const role = defaultModel?.toLowerCase() === model.id.toLowerCase() ? "Default" : fallbackPosition > 0 ? `Fallback ${fallbackPosition}` : unavailable ? "Unavailable" : "Available";
  return <button type="button" onClick={onSelect} className={cn("flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/45 sm:px-4", selected && "bg-primary/10")}><EntityIcon icon={BrainCircuit} label={model.name} tone={unavailable ? "danger" : "success"} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{model.name}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{model.providerName}</span></span><span className="hidden text-xs text-muted-foreground md:block">{model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k context` : "Context —"}</span><StatusBadge label={role} tone={role === "Default" ? "info" : role.startsWith("Fallback") ? "purple" : unavailable ? "danger" : "success"} dot={false} /><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>;
}

function ProviderCard({ provider, models, onDisconnect }: { provider: ModelManagementProvider; models: Array<{ id: string; name: string; available: boolean | null }>; onDisconnect?: () => void }) {
  const tone = provider.status === "connected" ? "success" : provider.status === "needs-attention" ? "warning" : provider.status === "unavailable" ? "danger" : "muted";
  return <article className="rounded-2xl border border-border bg-background p-3.5"><div className="flex items-start gap-3"><EntityIcon label={provider.name} tone={tone} size="sm" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-semibold text-foreground">{provider.name}</p><StatusBadge label={provider.status === "connected" ? "Connected" : provider.status === "needs-attention" ? "Needs attention" : provider.status === "not-connected" ? "Not connected" : provider.status} tone={tone} /></div><p className="mt-1 text-xs text-muted-foreground">{provider.modelCount ? `${provider.availableModelCount} model${provider.availableModelCount === 1 ? "" : "s"} available` : "No models discovered yet"}{provider.profiles.length ? ` · ${provider.profiles.length} account${provider.profiles.length === 1 ? "" : "s"}` : ""}</p></div></div>{provider.profiles.length ? <div className="mt-3 flex flex-wrap gap-1.5">{provider.profiles.map((profile) => <MiniBadge key={profile.id}>{profile.type === "api_key" ? "API key" : profile.type} · {profile.status}</MiniBadge>)}</div> : null}{models.length ? <details className="mt-3 rounded-xl border border-border bg-muted/20 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-foreground">View models</summary><div className="mt-2 space-y-1">{models.map((model) => <div key={model.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-muted-foreground">{model.name}</span><span className={cn("shrink-0", model.available === false ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300")}>{model.available === false ? "Needs attention" : "Available"}</span></div>)}</div></details> : null}{onDisconnect ? <div className="mt-3 flex justify-end"><Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-destructive" onClick={onDisconnect}>Disconnect</Button></div> : null}</article>;
}

function ModelInspector({ model, defaultModel, fallbackPosition, onClose }: { model: ModelManagementSnapshot["models"][number]; defaultModel: string | null; fallbackPosition: number; onClose: () => void }) {
  return <InspectorPanelFrame title="Model details" onClose={onClose}><div className="space-y-4"><div className="flex items-start gap-3"><EntityIcon icon={BrainCircuit} label={model.name} tone={model.available === false ? "danger" : "success"} size="lg" /><div className="min-w-0"><h2 className="truncate text-base font-semibold text-foreground">{model.name}</h2><p className="mt-1 text-xs text-muted-foreground">{model.providerName}</p><div className="mt-2"><StatusBadge label={model.available === false ? "Unavailable" : "Available"} tone={model.available === false ? "danger" : "success"} /></div></div></div><div className="rounded-xl border border-border bg-muted/25 px-3"><KeyValue label="Role" value={defaultModel?.toLowerCase() === model.id.toLowerCase() ? "Default" : fallbackPosition > 0 ? `Fallback ${fallbackPosition}` : "Available"} /><KeyValue label="Context window" value={model.contextWindow ? `${model.contextWindow.toLocaleString()} tokens` : "—"} /><KeyValue label="Capabilities" value={model.reasoning || model.supportsTools ? [model.reasoning ? "Reasoning" : null, model.supportsTools ? "Tools" : null].filter(Boolean).join(" · ") : "OpenClaw did not report metadata"} /><KeyValue label="Linked agents" value={String(model.linkedAgents)} /></div>{model.unavailableReason ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200"><CircleHelp className="mr-1 inline h-3.5 w-3.5" />{humanizeUnavailableReason(model.unavailableReason)}</div> : null}<details className="rounded-xl border border-border bg-muted/20 p-3"><summary className="cursor-pointer text-xs font-semibold text-foreground">Advanced details</summary><div className="mt-3 space-y-2"><KeyValue label="Model ref" value={<span className="break-all font-mono text-[0.66rem]">{model.advanced.rawId}</span>} /><KeyValue label="Provider ID" value={<span className="font-mono text-[0.66rem]">{model.advanced.providerId}</span>} /><KeyValue label="Runtime route" value={model.advanced.runtimeRoute ?? "Not reported"} /><KeyValue label="Catalog tags" value={model.tags.length ? model.tags.join(", ") : "—"} /></div></details></div></InspectorPanelFrame>;
}

function buildFallbackProviders(models: Array<{ provider: string; providerName: string; available: boolean | null }>): ModelManagementProvider[] {
  return [...new Set(models.map((model) => model.provider).filter(Boolean))].map((id) => { const rows = models.filter((model) => model.provider === id); return { id, name: rows[0]?.providerName || id, status: rows.some((model) => model.available !== false) ? "connected" : "unavailable", authMethods: [], profiles: [], modelCount: rows.length, availableModelCount: rows.filter((model) => model.available !== false).length, local: id === "ollama", source: "openclaw", setupAvailable: false, canLogout: false, presentation: {} }; });
}

function modelLabel(id: string | null, models: Array<{ id: string; name: string }>) { return id ? models.find((model) => model.id.toLowerCase() === id.toLowerCase())?.name || humanizeModelId(id) : "Not configured"; }
function providerLabel(id: string | null, models: Array<{ id: string; providerName: string }>) { return id ? models.find((model) => model.id.toLowerCase() === id.toLowerCase())?.providerName || formatModelProviderLabel(id.split("/", 1)[0] || "unknown") : "No provider"; }
function moveItem<T>(items: T[], from: number, to: number) { if (to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); if (item !== undefined) next.splice(to, 0, item); return next; }
function humanizeUnavailableReason(reason: string) { if (reason === "missing-auth") return "This provider needs a connection before the model can be used."; if (reason === "auth-failed") return "This provider connection needs attention."; if (reason === "cooldown") return "OpenClaw has temporarily paused this model. Try again shortly."; return "OpenClaw reported that this model is unavailable."; }
function humanizeModelId(id: string) { return (id.split("/").at(-1) || id).replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
