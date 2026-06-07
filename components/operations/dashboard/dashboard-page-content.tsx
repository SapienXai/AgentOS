"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  CircleCheck,
  Clock3,
  Cpu,
  Gauge,
  KeyRound,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import { compactPath, formatRelativeTime, formatTokens, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import {
  buildAgentViews,
  buildIntegrationViews,
  buildModelViews,
  buildTaskViews,
  formatBigNumber,
  summarizeTokens,
  type AgentView,
  type TaskView
} from "@/components/operations/operations-data";
import {
  EmptyState,
  EntityIcon,
  KeyValue,
  MiniBadge,
  PageHeader,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  type StatusTone
} from "@/components/operations/operations-ui";
import { MissionDispatchDialog } from "@/components/operations/operations-shared";
import { cn } from "@/lib/utils";

export function DashboardPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspace,
  activeWorkspaceId,
  connectionState,
  surfaceTheme,
  refresh
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const agents = useMemo(() => buildAgentViews(snapshot), [snapshot]);
  const tasks = useMemo(() => buildTaskViews(snapshot), [snapshot]);
  const models = useMemo(() => buildModelViews(snapshot), [snapshot]);
  const integrations = useMemo(() => buildIntegrationViews(rootSnapshot), [rootSnapshot]);
  const referenceMs = resolveRelativeTimeReferenceMs(rootSnapshot.generatedAt);
  const taskCounts = summarizeTasks(tasks);
  const runningAgents = agents.filter((agent) => agent.status === "running");
  const readyAgents = agents.filter((agent) => agent.status === "ready");
  const tokenTotal = summarizeSnapshotTokens(snapshot);
  const gatewaySummary = summarizeGateway(rootSnapshot);
  const modelReadiness = rootSnapshot.diagnostics.modelReadiness;
  const enabledAccounts = rootSnapshot.channelAccounts.filter((account) => account.enabled);
  const connectedIntegrations = integrations.filter((integration) => integration.status === "connected");
  const attentionItems = buildAttentionItems(rootSnapshot);
  const hasGatewayPermissionIssue = attentionItems.some(isGatewayPermissionIssue);
  const recentTasks = [...tasks]
    .sort((left, right) => (right.source?.updatedAt ?? 0) - (left.source?.updatedAt ?? 0))
    .slice(0, 6);

  return (
    <>
      <div className="flex flex-col gap-3">
        <PageHeader
          surfaceTheme={surfaceTheme}
          title="Dashboard"
          subtitle="Operational cockpit for the current AgentOS workspace, backed by the live OpenClaw snapshot and local diagnostics."
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => void refresh()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button
                size="sm"
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => setDispatchOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create Task
              </Button>
            </>
          }
        >
          <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <SectionCard>
              <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-4">
                <WorkspaceSignal
                  label="Workspace"
                  value={activeWorkspace?.name ?? "All Workspaces"}
                  detail={activeWorkspace?.path ? compactPath(activeWorkspace.path) : `${rootSnapshot.workspaces.length} workspaces visible`}
                />
                <WorkspaceSignal
                  label="Snapshot"
                  value={rootSnapshot.mode === "live" ? "Live" : "Fallback"}
                  detail={`Updated ${formatRelativeTime(Date.parse(rootSnapshot.generatedAt), referenceMs)}`}
                  tone={rootSnapshot.mode === "live" ? "success" : "warning"}
                />
                <WorkspaceSignal
                  label="Gateway"
                  value={gatewaySummary.label}
                  detail={gatewaySummary.detail}
                  tone={gatewaySummary.tone}
                />
                <WorkspaceSignal
                  label="Models"
                  value={modelReadiness.ready ? "Ready" : "Needs Setup"}
                  detail={`${modelReadiness.availableModelCount}/${modelReadiness.totalModelCount} available`}
                  tone={modelReadiness.ready ? "success" : "warning"}
                />
              </div>
            </SectionCard>
            <SectionCard title="Quick Actions">
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                <QuickAction icon={Plus} label="Create Task" onClick={() => setDispatchOpen(true)} />
                <QuickAction icon={Bot} label="Add Agent" href="/agents" />
                <QuickAction icon={KeyRound} label="Connect Account" href="/accounts" />
                <QuickAction icon={BrainCircuit} label="Manage Models" href="/models" />
                <QuickAction icon={Settings2} label="Open Settings" href="/settings" />
                <QuickAction icon={Gauge} label="Mission Control" href="/" />
              </div>
            </SectionCard>
          </div>
        </PageHeader>

        <StatGrid columns={6}>
          <StatCard label="Workspaces" value={String(rootSnapshot.workspaces.length)} detail="Visible in snapshot" icon={Workflow} tone="info" />
          <StatCard label="Agents" value={String(agents.length)} detail={`${runningAgents.length} active, ${readyAgents.length} ready`} icon={Bot} tone="success" />
          <StatCard label="Running Tasks" value={String(taskCounts.running)} detail={`${taskCounts.queued} queued`} icon={Activity} tone="info" />
          <StatCard label="Completed" value={String(taskCounts.completed)} detail="Completed task records" icon={CircleCheck} tone="success" />
          <StatCard label="Needs Attention" value={String(taskCounts.attention)} detail="Stalled, cancelled, warning, or approval state" icon={AlertTriangle} tone={taskCounts.attention > 0 ? "warning" : "muted"} />
          <StatCard label="Tokens" value={tokenTotal > 0 ? formatBigNumber(tokenTotal) : "None"} detail={tokenTotal > 0 ? "Reported by tasks/runtimes" : "No usage reported"} icon={Sparkles} tone="purple" />
        </StatGrid>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-3">
            <SectionCard title="OpenClaw Runtime">
              <div className="grid gap-3 p-3 lg:grid-cols-3">
                <StatusPanel
                  icon={TerminalSquare}
                  title="Gateway"
                  status={gatewaySummary.label}
                  tone={gatewaySummary.tone}
                  rows={[
                    ["Health", rootSnapshot.diagnostics.health],
                    ["RPC", rootSnapshot.diagnostics.rpcOk ? "OK" : "Unavailable"],
                    ["Loaded", rootSnapshot.diagnostics.loaded ? "Yes" : "No"],
                    ["URL", rootSnapshot.diagnostics.gatewayUrl || "Not reported"]
                  ]}
                />
                <StatusPanel
                  icon={Cpu}
                  title="Native Coverage"
                  status={`${gatewaySummary.nativeOperationCount} native`}
                  tone={gatewaySummary.nativeOperationCount > 0 ? "success" : "muted"}
                  rows={[
                    ["Fallback ops", String(gatewaySummary.cliFallbackOperationCount)],
                    ["Limited ops", String(gatewaySummary.degradedOperationCount)],
                    ["Unsupported methods", String(gatewaySummary.unsupportedGatewayMethods)],
                    ["Protocol", rootSnapshot.diagnostics.capabilityMatrix?.gatewayProtocolVersion ?? "Unknown"]
                  ]}
                />
                <StatusPanel
                  icon={ShieldCheck}
                  title="Fallback"
                  status={gatewaySummary.fallbackCount > 0 ? `${gatewaySummary.fallbackCount} recorded` : "No recent fallback"}
                  tone={gatewaySummary.fallbackCount > 0 ? "warning" : "success"}
                  rows={[
                    ["Reasons", gatewaySummary.fallbackReasonCount ? String(gatewaySummary.fallbackReasonCount) : "None"],
                    ["Last reason", gatewaySummary.lastFallbackReason ?? "None"],
                    ["Transport", rootSnapshot.diagnostics.transport?.mode ?? "Unknown"],
                    ["Smoke test", rootSnapshot.diagnostics.compatibilitySmokeTest?.status ?? "Not run"]
                  ]}
                />
              </div>
            </SectionCard>

            <SectionCard title="Active Agents">
              {agents.length === 0 ? (
                <div className="p-3">
                  <EmptyState title="No agents in this workspace" description="AgentOS did not receive any OpenClaw agents for the selected workspace." />
                </div>
              ) : (
                <div className="grid gap-2 p-3 lg:grid-cols-2">
                  {agents.slice(0, 6).map((agent) => (
                    <AgentSummaryRow key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Recent Task Activity">
              {recentTasks.length === 0 ? (
                <div className="p-3">
                  <EmptyState title="No task activity" description="No OpenClaw task records are available for this workspace yet." />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentTasks.map((task) => (
                    <TaskActivityRow key={task.id} task={task} referenceMs={referenceMs} />
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <SectionCard title="Models">
              <div className="p-3">
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Default Model</p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {modelReadiness.resolvedDefaultModel ?? modelReadiness.defaultModel ?? "Not configured"}
                      </p>
                    </div>
                    <StatusBadge label={modelReadiness.ready ? "Ready" : "Needs Setup"} tone={modelReadiness.ready ? "success" : "warning"} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MiniMetric label="Available" value={String(modelReadiness.availableModelCount)} />
                    <MiniMetric label="Local" value={String(modelReadiness.localModelCount)} />
                    <MiniMetric label="Remote" value={String(modelReadiness.remoteModelCount)} />
                  </div>
                </div>
                {models.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {models.slice(0, 8).map((model) => (
                      <MiniBadge key={model.id}>{model.name}</MiniBadge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">No model records are available in the snapshot.</p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Accounts & Integrations">
              <div className="p-3">
                <div className="grid grid-cols-2 gap-2">
                  <MiniMetric label="Accounts" value={String(rootSnapshot.channelAccounts.length)} detail={`${enabledAccounts.length} enabled`} />
                  <MiniMetric label="Connected" value={String(connectedIntegrations.length)} detail={`${integrations.length} tracked`} />
                </div>
                {rootSnapshot.channelAccounts.length === 0 ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">No channel accounts are reported by OpenClaw yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {rootSnapshot.channelAccounts.slice(0, 4).map((account) => (
                      <div key={account.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2">
                        <span className="min-w-0 truncate text-xs font-medium text-foreground">{account.name}</span>
                        <StatusBadge label={account.enabled ? "Enabled" : "Disabled"} tone={account.enabled ? "success" : "muted"} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="System Health">
              <div className="p-3">
                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">AgentOS stream</p>
                    <p className="mt-1 text-xs text-muted-foreground">{connectionState}</p>
                  </div>
                  <StatusBadge label={rootSnapshot.diagnostics.health} tone={healthTone(rootSnapshot.diagnostics.health)} />
                </div>
                {attentionItems.length === 0 ? (
                  <EmptyState title="No diagnostics requiring attention" description="The current snapshot does not report gateway, runtime, or security warnings." />
                ) : (
                  <div className="space-y-2">
                    {attentionItems.slice(0, 6).map((item) => (
                      <div key={item} className="rounded-[9px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-2.5 py-2 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
                        {item}
                      </div>
                    ))}
                    {hasGatewayPermissionIssue ? (
                      <Button
                        asChild
                        variant="secondary"
                        size="sm"
                        className="mt-3 w-full justify-between border-[hsl(var(--status-warning)/0.28)] bg-[hsl(var(--status-warning)/0.10)] text-xs text-[hsl(var(--status-warning-foreground))] hover:bg-[hsl(var(--status-warning)/0.14)] hover:text-[hsl(var(--status-warning-foreground))]"
                      >
                        <Link href="/settings#gateway">
                          Manage Gateway permissions
                          <Settings2 className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      <MissionDispatchDialog
        open={dispatchOpen}
        agent={null}
        defaultWorkspaceId={activeWorkspaceId}
        onOpenChange={setDispatchOpen}
        onSubmitted={refresh}
      />
    </>
  );
}

function WorkspaceSignal({
  label,
  value,
  detail,
  tone = "info"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: StatusTone;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(tone))} />
        <p className="truncate text-sm font-semibold text-foreground">{value}</p>
      </div>
      <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{detail}</p>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <Button asChild variant="secondary" size="sm" className="h-8 justify-start rounded-[10px] px-2.5 text-xs">
        <Link href={href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" className="h-8 justify-start rounded-[10px] px-2.5 text-xs" onClick={onClick}>
      {content}
    </Button>
  );
}

function StatusPanel({
  icon,
  title,
  status,
  tone,
  rows
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: StatusTone;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityIcon icon={icon} label={title} tone={tone} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{status}</p>
          </div>
        </div>
        <StatusBadge label={status} tone={tone} />
      </div>
      <div className="mt-3">
        {rows.map(([label, value]) => (
          <KeyValue key={label} label={label} value={<span className="break-words">{value}</span>} />
        ))}
      </div>
    </div>
  );
}

function AgentSummaryRow({ agent }: { agent: AgentView }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
      <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-xs font-semibold text-foreground">{agent.name}</p>
          <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
        </div>
        <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">{agent.purpose}</p>
      </div>
    </div>
  );
}

function TaskActivityRow({ task, referenceMs }: { task: TaskView; referenceMs: number }) {
  const Icon = task.status === "completed" ? CircleCheck : task.status === "running" ? Activity : task.status === "stalled" ? AlertTriangle : Clock3;
  const tokenLabel =
    typeof task.source?.tokenUsage?.total === "number"
      ? `${formatTokens(task.source.tokenUsage.total)} tokens`
      : "No tokens reported";

  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3">
      <EntityIcon icon={Icon} label={task.statusLabel} tone={task.statusTone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-xs font-semibold text-foreground">{task.title}</p>
          <StatusBadge label={task.statusLabel} tone={task.statusTone} />
        </div>
        <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">
          {task.agentName} / {formatRelativeTime(task.source?.updatedAt ?? null, referenceMs)} / {tokenLabel}
        </p>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-2.5">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-0.5 truncate text-[0.66rem] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function summarizeTasks(tasks: TaskView[]) {
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const completed = tasks.filter((task) => task.status === "completed").length;

  return {
    running,
    queued,
    completed,
    attention: new Set([
      ...tasks.filter((task) => task.status === "stalled" || task.status === "cancelled" || task.status === "approval").map((task) => task.id),
      ...tasks.filter((task) => (task.source?.warningCount ?? 0) > 0).map((task) => task.id)
    ]).size
  };
}

function summarizeSnapshotTokens(snapshot: MissionControlSnapshot) {
  const taskTokens = snapshot.tasks.reduce((sum, task) => sum + (task.tokenUsage?.total ?? 0), 0);
  return taskTokens || summarizeTokens(snapshot);
}

function summarizeGateway(snapshot: MissionControlSnapshot) {
  const diagnostics = snapshot.diagnostics;
  const operations = Object.values(diagnostics.capabilityMatrix?.operations ?? {});
  const compatibility = diagnostics.capabilityMatrix?.compatibility;
  const fallbackDiagnostics = diagnostics.gatewayFallbackDiagnostics ?? diagnostics.capabilityMatrix?.fallbackDiagnostics ?? [];
  const fallbackReasons = diagnostics.gatewayFallbackReasons ?? diagnostics.capabilityMatrix?.fallbackReasons ?? [];
  const nativeOperationCount =
    compatibility?.nativeOperationCount ?? operations.filter((operation) => operation.mode === "gateway-native").length;
  const degradedOperationCount =
    compatibility?.degradedOperationCount ??
    operations.filter((operation) => operation.mode === "degraded" || operation.mode === "cli-fallback" || operation.mode === "disabled").length;
  const cliFallbackOperationCount = operations.filter((operation) => operation.mode === "cli-fallback").length;
  const label = diagnostics.rpcOk ? "Native RPC" : diagnostics.loaded ? "Gateway Degraded" : diagnostics.installed ? "Installed" : "Unavailable";

  return {
    label,
    detail: diagnostics.version ? `OpenClaw v${diagnostics.version}` : diagnostics.installed ? "Version unknown" : "OpenClaw not installed",
    tone: diagnostics.rpcOk && diagnostics.health === "healthy" ? "success" as const : diagnostics.installed ? "warning" as const : "danger" as const,
    nativeOperationCount,
    degradedOperationCount,
    cliFallbackOperationCount,
    unsupportedGatewayMethods: diagnostics.capabilityMatrix?.unsupportedGatewayMethods.length ?? 0,
    fallbackCount: fallbackDiagnostics.length,
    fallbackReasonCount: fallbackReasons.length,
    lastFallbackReason: fallbackReasons[0] ?? fallbackDiagnostics[0]?.issue ?? null
  };
}

function buildAttentionItems(snapshot: MissionControlSnapshot) {
  return [
    ...snapshot.diagnostics.securityWarnings,
    ...snapshot.diagnostics.issues,
    ...snapshot.diagnostics.runtime.issues,
    ...(snapshot.diagnostics.capabilityMatrix?.diagnostics ?? []),
    ...(snapshot.diagnostics.gatewayFallbackReasons ?? []),
    ...(snapshot.diagnostics.capabilityMatrix?.fallbackReasons ?? [])
  ].filter((item, index, items) => item.trim() && items.indexOf(item) === index);
}

function isGatewayPermissionIssue(item: string) {
  return /operator-scope approval|device access|pairing-pending|scope upgrade/i.test(item);
}

function healthTone(health: MissionControlSnapshot["diagnostics"]["health"]): StatusTone {
  if (health === "healthy") {
    return "success";
  }

  if (health === "degraded") {
    return "warning";
  }

  return "danger";
}

function dotClass(tone: StatusTone) {
  if (tone === "success") {
    return "bg-emerald-400";
  }

  if (tone === "warning") {
    return "bg-amber-300";
  }

  if (tone === "danger") {
    return "bg-rose-400";
  }

  if (tone === "purple") {
    return "bg-violet-400";
  }

  if (tone === "muted") {
    return "bg-slate-400";
  }

  return "bg-primary";
}
