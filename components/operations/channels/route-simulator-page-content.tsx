"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleAlert, CircleHelp, FlaskConical, Loader2, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { ChannelCenterProvider } from "@/lib/openclaw/application/channel-center-service";
import type { ChannelRouteSimulationResult } from "@/lib/openclaw/application/channel-route-simulator-service";
import type { ChannelRouteKind } from "@/lib/openclaw/domains/channel-center";
import {
  EmptyState,
  OperationsPageLayout,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/operations/operations-ui";
import { cn } from "@/lib/utils";

type DirectoryEntry = {
  routeId: string;
  kind: ChannelRouteKind;
  accountId: string;
  parentRouteId: string | null;
  title: string | null;
  handle?: string | null;
  agentId: string | null;
  bindingMatch: string | null;
  accessPolicy: {
    enabled: boolean | null;
    groupPolicy: string | null;
    allowFrom: string[];
    requireMention: boolean | null;
  } | null;
};

type DirectoryResponse = {
  entries: DirectoryEntry[];
  status: "ok" | "empty" | "unsupported" | "failed";
  error: string | null;
  fallbackReason: string | null;
};

type MentionChoice = "yes" | "no" | "unknown";

export function RouteSimulatorPageContent({
  rootSnapshot,
  initialQuery
}: {
  rootSnapshot: MissionControlSnapshot;
  initialQuery: Record<string, string | undefined>;
}) {
  const [providers, setProviders] = useState<ChannelCenterProvider[]>([]);
  const [providerId, setProviderId] = useState(initialQuery.provider ?? "");
  const [accountId, setAccountId] = useState(initialQuery.account ?? "");
  const [groupId, setGroupId] = useState(initialQuery.group ?? "");
  const [topicId, setTopicId] = useState(initialQuery.topic ?? "");
  const [groups, setGroups] = useState<DirectoryEntry[]>([]);
  const [topics, setTopics] = useState<DirectoryEntry[]>([]);
  const [senderId, setSenderId] = useState("");
  const [mentioned, setMentioned] = useState<MentionChoice>("unknown");
  const [message, setMessage] = useState("");
  const [expectedAgentId, setExpectedAgentId] = useState(initialQuery.expectedAgentId ?? "");
  const [result, setResult] = useState<ChannelRouteSimulationResult | null>(null);
  const [loadingCenter, setLoadingCenter] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? providers[0] ?? null;
  const selectedAccount = selectedProvider?.accounts.find((account) => account.accountId === accountId) ?? selectedProvider?.accounts[0] ?? null;
  const selectedGroup = groups.find((entry) => entry.routeId === groupId) ?? null;
  const selectedTopic = topics.find((entry) => entry.routeId === topicId) ?? null;
  const selectedRoute = selectedTopic ?? selectedGroup;
  const supportsTopics = selectedProvider?.id === "telegram" && selectedProvider.capabilities.supportsTopics;

  useEffect(() => {
    let cancelled = false;
    setLoadingCenter(true);
    void fetch("/api/openclaw/channels/center", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { providers?: ChannelCenterProvider[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Channel inventory is unavailable.");
        if (cancelled) return;
        const nextProviders = payload.providers ?? [];
        setProviders(nextProviders);
        setProviderId((current) => nextProviders.some((provider) => provider.id === current) ? current : nextProviders[0]?.id ?? "");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Channel inventory is unavailable.");
      })
      .finally(() => { if (!cancelled) setLoadingCenter(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedProvider) {
      setAccountId("");
      return;
    }
    setAccountId((current) => selectedProvider.accounts.some((account) => account.accountId === current) ? current : selectedProvider.accounts[0]?.accountId ?? "");
  }, [selectedProvider]);

  useEffect(() => {
    if (!selectedProvider || !selectedAccount) {
      setGroups([]);
      setGroupId("");
      return;
    }
    let cancelled = false;
    setLoadingGroups(true);
    setError(null);
    const params = new URLSearchParams({ provider: selectedProvider.id, accountId: selectedAccount.accountId, kind: "groups", limit: "200" });
    void fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as DirectoryResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Channel groups are unavailable.");
        if (cancelled) return;
        const nextGroups = payload.entries ?? [];
        setGroups(nextGroups);
        setGroupId((current) => nextGroups.some((entry) => entry.routeId === current) ? current : nextGroups[0]?.routeId ?? "");
      })
      .catch((reason) => { if (!cancelled) { setGroups([]); setError(reason instanceof Error ? reason.message : "Channel groups are unavailable."); } })
      .finally(() => { if (!cancelled) setLoadingGroups(false); });
    return () => { cancelled = true; };
  }, [selectedAccount, selectedProvider]);

  useEffect(() => {
    if (!supportsTopics || !selectedAccount || !selectedGroup) {
      setTopics([]);
      setTopicId("");
      return;
    }
    let cancelled = false;
    setLoadingTopics(true);
    const params = new URLSearchParams({ provider: "telegram", accountId: selectedAccount.accountId, kind: "topics", groupId: selectedGroup.routeId, limit: "200" });
    void fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as DirectoryResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Telegram topics are unavailable.");
        if (cancelled) return;
        setTopics(payload.entries ?? []);
        setTopicId((current) => (payload.entries ?? []).some((entry) => entry.routeId === current) ? current : "");
      })
      .catch(() => { if (!cancelled) { setTopics([]); setTopicId(""); } })
      .finally(() => { if (!cancelled) setLoadingTopics(false); });
    return () => { cancelled = true; };
  }, [selectedAccount, selectedGroup, supportsTopics]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const values: Array<[string, string]> = [
      ["provider", providerId],
      ["account", accountId],
      ["group", groupId],
      ["topic", topicId],
      ["expectedAgentId", expectedAgentId]
    ];
    for (const [key, value] of values) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", url);
  }, [accountId, expectedAgentId, groupId, providerId, topicId]);

  const runSimulation = async () => {
    if (!selectedProvider || !selectedAccount || !selectedRoute) return;
    setSimulating(true);
    setError(null);
    setResult(null);
    try {
      const route = {
        provider: selectedProvider.id,
        accountId: selectedAccount.accountId,
        kind: selectedRoute.kind,
        routeId: selectedRoute.routeId,
        parentRouteId: selectedRoute.parentRouteId,
        ...(selectedRoute.kind === "topic" ? {} : {})
      };
      const response = await fetch("/api/openclaw/channels/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route,
          senderId: senderId.trim() || null,
          mentioned: mentioned === "unknown" ? null : mentioned === "yes",
          message: message.trim() || null,
          expectedAgentId: expectedAgentId || null
        })
      });
      const payload = await response.json() as ChannelRouteSimulationResult & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error || "The route simulation could not be completed.");
      setResult(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The route simulation could not be completed.");
    } finally {
      setSimulating(false);
    }
  };

  const providerOptions = useMemo(() => providers.length ? providers : [], [providers]);

  return (
    <>
      <PageHeader
        title="Route Simulator"
        subtitle="Inspect what the current OpenClaw routing and access policy would do for a hypothetical message."
        actions={<Badge variant="muted" className="gap-1.5 rounded-full px-2.5 py-1 text-[10px] normal-case tracking-normal"><FlaskConical className="h-3 w-3" /> Dry run · no message will be sent</Badge>}
      />
      <OperationsPageLayout
        main={
          <div className="space-y-4">
            <SectionCard title="Message context">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <Field label="Provider">
                  <select value={providerId} onChange={(event) => { setProviderId(event.target.value); setResult(null); }} className={selectClassName}>
                    <option value="">Select a provider</option>
                    {providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </Field>
                <Field label="Account">
                  <select value={accountId} onChange={(event) => { setAccountId(event.target.value); setResult(null); }} className={selectClassName} disabled={!selectedProvider}>
                    <option value="">Select an account</option>
                    {selectedProvider?.accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.name} · {account.accountId}</option>)}
                  </select>
                </Field>
                <Field label={selectedProvider?.id === "telegram" ? "Group" : "Route"}>
                  <select value={groupId} onChange={(event) => { setGroupId(event.target.value); setTopicId(""); setResult(null); }} className={selectClassName} disabled={loadingGroups || !selectedAccount}>
                    <option value="">{loadingGroups ? "Loading routes…" : "Select a route"}</option>
                    {groups.map((group) => <option key={group.routeId} value={group.routeId}>{group.title || group.routeId} · {group.routeId}</option>)}
                  </select>
                </Field>
                {supportsTopics ? (
                  <Field label="Topic (optional)">
                    <select value={topicId} onChange={(event) => { setTopicId(event.target.value); setResult(null); }} className={selectClassName} disabled={loadingTopics || !selectedGroup}>
                      <option value="">Group route</option>
                      {topics.map((topic) => <option key={topic.routeId} value={topic.routeId}>{topic.title || topic.routeId} · {topic.routeId}</option>)}
                    </select>
                  </Field>
                ) : null}
                <Field label="Sender ID" hint="Telegram sender IDs are numeric. Leave blank to keep eligibility unknown.">
                  <Input value={senderId} onChange={(event) => setSenderId(event.target.value)} placeholder="184234234" inputMode="numeric" maxLength={128} />
                </Field>
                <Field label="Bot mentioned?">
                  <select value={mentioned} onChange={(event) => setMentioned(event.target.value as MentionChoice)} className={selectClassName}>
                    <option value="unknown">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </Field>
                <Field label="Expected worker (optional)">
                  <select value={expectedAgentId} onChange={(event) => setExpectedAgentId(event.target.value)} className={selectClassName}>
                    <option value="">No expected worker</option>
                    {rootSnapshot.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.id}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-foreground" htmlFor="simulation-message">Message context <span className="font-normal text-muted-foreground">(informational only)</span></label>
                  <Textarea id="simulation-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="I need a refund" maxLength={2000} className="mt-1.5 min-h-20 resize-y text-xs" />
                  <p className="mt-1 text-[11px] text-muted-foreground">The simulator does not run the model, infer intent, or predict tool use from this text.</p>
                </div>
              </div>
              {error ? <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-[hsl(var(--status-danger)/0.3)] bg-[hsl(var(--status-danger)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-danger-foreground))]" role="alert"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
                <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => { setResult(null); setError(null); }} disabled={!result && !error}>Clear result</Button>
                <Button size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => void runSimulation()} disabled={simulating || loadingCenter || loadingGroups || !selectedRoute || !selectedAccount}>
                  {simulating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                  {simulating ? "Simulating…" : "Simulate routing"}
                </Button>
              </div>
            </SectionCard>
            {result ? <SimulationResult result={result} /> : <SectionCard title="Result"><EmptyState title="No simulation yet" description="Choose a channel context and run a dry run to see the resolved worker, access gates, and evidence." /></SectionCard>}
          </div>
        }
        inspector={null}
      />
    </>
  );
}

function SimulationResult({ result }: { result: ChannelRouteSimulationResult }) {
  const outcome = outcomePresentation(result.outcome);
  const workerHref = result.worker.id ? `/agents/${encodeURIComponent(result.worker.id)}?tab=capabilities` : null;
  const channelsHref = `/channels?provider=${encodeURIComponent(result.input.route.provider)}`;
  return <div className="space-y-4"><SectionCard title="Simulation result" action={<StatusBadge label={outcome.label} tone={outcome.tone} />}><div className="space-y-4 p-4"><div className={cn("rounded-xl border p-3", outcome.className)}><p className="text-sm font-semibold">{outcome.heading}</p><p className="mt-1 text-xs leading-5">{result.explanations[0]}</p><p className="mt-2 text-[10px] uppercase tracking-[0.12em] opacity-75">Captured {new Date(result.capturedAt).toLocaleString()}</p></div><div className="grid gap-3 sm:grid-cols-2"><Summary label="Route" value={`${result.input.route.provider} · ${result.input.route.routeId}${result.input.route.parentRouteId ? ` · topic of ${result.input.route.parentRouteId}` : ""}`} /><Summary label="Sender" value={result.input.senderId || "Not provided"} /><Summary label="Mention" value={result.input.mentioned === true ? "Yes" : result.input.mentioned === false ? "No" : "Unknown"} /><Summary label="Resolved worker" value={result.worker.label ?? result.worker.id ?? "No effective worker"} /></div>{result.input.message ? <div className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Message context</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground/85">{result.input.message}</p></div> : null}</div></SectionCard><SectionCard title="Why this result"><div className="space-y-1 p-4">{result.trace.map((step) => <TraceStep key={step.id} step={step} />)}</div></SectionCard><SectionCard title="Current worker capability snapshot"><div className="p-4">{result.capabilities.status === "available" && result.capabilities.summary ? <><div className="flex flex-wrap gap-2">{Object.entries(result.capabilities.summary).filter(([, value]) => value > 0).map(([key, value]) => <Badge key={key} variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">{value} {key.replaceAll("-", " ")}</Badge>)}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">{result.capabilities.detail}</p>{result.capabilities.entries.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{result.capabilities.entries.slice(0, 8).map((entry) => <div key={entry.id} className="rounded-lg border border-border bg-muted/20 p-2.5"><p className="text-xs font-medium">{entry.label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{entry.status.replaceAll("-", " ")}</p></div>)}</div> : null}</> : <p className="text-xs leading-5 text-muted-foreground">{result.capabilities.detail}</p>}<div className="mt-4 flex flex-wrap gap-2">{workerHref ? <Button asChild size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs"><Link href={workerHref}>Open worker capabilities <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button> : null}<Button asChild size="sm" variant="ghost" className="h-8 rounded-lg px-3 text-xs"><Link href={channelsHref}>Open Channels <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div></div></SectionCard><details className="rounded-xl border border-border bg-card/45 p-4"><summary className="cursor-pointer text-xs font-semibold text-foreground">Show route and policy provenance</summary><div className="mt-3 space-y-3 text-xs"><div><p className="font-medium">Binding</p><p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">{result.binding.source} · {result.binding.match} · {result.binding.matchedBy ?? "no matched tier"}</p></div><div><p className="font-medium">Policy inheritance</p>{result.access.policy.inheritance.length ? <div className="mt-1 space-y-1">{result.access.policy.inheritance.map((layer) => <div key={`${layer.layer}:${layer.path}`} className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><span className={cn("h-1.5 w-1.5 rounded-full", layer.applied ? "bg-primary" : "bg-muted-foreground/40")} />{layer.layer} · {layer.applied ? "contributed" : "observed"} · <span className="break-all font-mono">{layer.path}</span></div>)}</div> : <p className="mt-1 text-[10px] text-muted-foreground">Policy provenance is unavailable for this provider.</p>}</div></div></details></div>;
}

function TraceStep({ step }: { step: ChannelRouteSimulationResult["trace"][number] }) {
  const Icon = step.status === "pass" ? Check : step.status === "fail" ? X : step.status === "warning" ? CircleAlert : CircleHelp;
  return <div className="flex items-start gap-3 rounded-lg px-2 py-2.5"><Icon className={cn("mt-0.5 h-4 w-4 shrink-0", step.status === "pass" ? "text-emerald-500" : step.status === "fail" ? "text-red-500" : step.status === "warning" ? "text-amber-500" : "text-muted-foreground")} aria-hidden="true" /><div className="min-w-0"><p className="text-xs font-medium">{step.label}</p><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{step.detail}</p></div></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div><label className="text-xs font-medium text-foreground">{label}</label>{hint ? <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{hint}</p> : null}<div className={hint ? "mt-1" : "mt-1.5"}>{children}</div></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 break-words text-xs font-medium text-foreground">{value}</p></div>;
}

function outcomePresentation(outcome: ChannelRouteSimulationResult["outcome"]) {
  switch (outcome) {
    case "deliverable": return { label: "Eligible", heading: "Eligible for delivery", tone: "success" as const, className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100" };
    case "blocked": return { label: "Blocked", heading: "Delivery blocked", tone: "danger" as const, className: "border-red-500/25 bg-red-500/10 text-red-800 dark:text-red-100" };
    case "ambiguous": return { label: "Ambiguous", heading: "Routing is ambiguous", tone: "warning" as const, className: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-100" };
    case "unresolved": return { label: "Unresolved", heading: "No effective worker resolved", tone: "muted" as const, className: "border-border bg-muted/30 text-foreground" };
    case "unknown": return { label: "Unknown", heading: "Delivery cannot be determined", tone: "muted" as const, className: "border-border bg-muted/30 text-foreground" };
  }
}

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";
