"use client";

import { ExternalLink, LoaderCircle, RefreshCw, RotateCw } from "lucide-react";

import { KeyValue, SectionCard, StatusBadge, type StatusTone } from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import type {
  AgentOsProductUpdateOperationState,
  AgentOsProductUpdatePhase,
  AgentOsProductUpdateSnapshot
} from "@/lib/agentos/domains/product-update";
import type { DesktopUpdateProgress } from "@/lib/desktop/product-update";
import { useAgentOsUpdate } from "@/hooks/use-agentos-update";

export function AgentOsUpdateCard() {
  const update = useAgentOsUpdate();
  const snapshot = update.snapshot;
  const operation = snapshot?.operation ?? null;
  const label = operationLabel(operation?.state, snapshot?.availability, update.loading);
  const tone = operationTone(operation?.state, snapshot?.availability, update.loading);
  const progressMessage = update.progress?.message ?? operationMessage(operation?.state, operation?.phase, update.progress);
  const action = snapshot ? resolveAction(snapshot, update.desktop, update.installing) : null;

  return (
    <SectionCard className="overflow-hidden">
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={label} tone={tone} />
              {snapshot?.evidence === "stale" ? <StatusBadge label="Stale evidence" tone="warning" /> : null}
            </div>
            <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">AgentOS</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
              {snapshot?.ownerReason ?? (update.loading ? "Reading AgentOS update ownership and release status." : "AgentOS update status is unavailable.")}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {action}
            <Button type="button" variant="secondary" size="sm" onClick={() => void update.refresh()} disabled={update.checking || update.loading || update.installing}>
              {update.checking || update.loading ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              {update.checking || update.loading ? "Checking…" : "Check for updates"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 rounded-md border border-border bg-muted/25 p-3 sm:grid-cols-3">
          <KeyValue label="Installed version" value={snapshot ? `v${snapshot.currentVersion}` : "Loading"} />
          <KeyValue label="Latest stable" value={snapshot?.latestVersion ? `v${snapshot.latestVersion}` : snapshot?.availability === "up-to-date" ? `v${snapshot.currentVersion}` : "Not verified"} />
          <KeyValue label="Update owner" value={ownerLabel(snapshot?.owner)} />
        </div>

        {update.desktop && snapshot?.action === "native-install" ? (
          <p className="mt-3 text-xs leading-5 text-muted-foreground" role="note">
            {snapshot.storageReady
              ? "Updating AgentOS will close the embedded server and restart this application. Your AgentOS data is stored outside the replaceable application bundle."
              : "AgentOS will restart during an update, but the persistent data migration is incomplete. Updating stays disabled until the storage issue is resolved."}
          </p>
        ) : null}

        {progressMessage ? (
          <div className="mt-3 rounded-md border border-[hsl(var(--status-info)/0.24)] bg-[hsl(var(--status-info)/0.08)] p-3 text-sm" role="status" aria-live="polite">
            <div className="flex items-start gap-2">
              {operation?.state === "running" || update.installing ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" /> : operation?.state === "restart-required" ? <RotateCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : null}
              <div className="min-w-0 flex-1">
                <p className="leading-5 text-foreground">{progressMessage}</p>
                {operation?.progress !== null && operation?.progress !== undefined && operation.state === "running" ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`Update download ${operation.progress}%`}>
                    <div className="h-full bg-primary transition-[width]" style={{ width: `${operation.progress}%` }} />
                  </div>
                ) : null}
                {operation?.state === "failed" || operation?.state === "unknown" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Review the native update state and retry only after the failure is understood. AgentOS will not replay an interrupted installation automatically.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {update.error ? <p className="mt-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]" role="status">{update.error}</p> : null}
        {snapshot?.checkedAt ? <p className="mt-2 text-[0.68rem] text-muted-foreground">Last check: {formatTimestamp(snapshot.checkedAt)}{snapshot.sourceId ? ` · ${snapshot.sourceId}` : ""}</p> : null}
        {snapshot?.releaseUrl ? (
          <a href={snapshot.releaseUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            Release information <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </SectionCard>
  );

  function resolveAction(value: AgentOsProductUpdateSnapshot, desktop: boolean, installing: boolean) {
    if (value.action === "native-install") {
      const reason = !value.storageReady
        ? "Persistent data migration is incomplete. Resolve it before updating."
        : !value.canManageUpdates
          ? "Your AgentOS role does not allow application updates."
          : value.availability !== "available"
            ? "Check for a newer signed Desktop release first."
            : !value.canInstall
              ? "The native update evidence is stale or no longer matches this launch. Check again."
              : undefined;
      return (
        <div className="flex flex-col gap-1 sm:items-end">
          <Button type="button" size="sm" onClick={() => void update.install()} disabled={!desktop || !value.canInstall || installing} title={reason}>
            {installing ? <LoaderCircle className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {installing ? "Preparing update…" : "Update AgentOS"}
          </Button>
          {!value.canInstall && reason ? <span className="max-w-64 text-right text-[0.68rem] leading-4 text-muted-foreground">{reason}</span> : null}
        </div>
      );
    }

    if (value.action === "release-guidance" && value.releaseUrl && value.cliAssetAvailable !== false) {
      return <Button asChild variant="secondary" size="sm"><a href={value.releaseUrl} target="_blank" rel="noreferrer">View update instructions <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>;
    }
    if (value.action === "package-manager-guidance") {
      if (value.owner === "desktop") {
        return <Button asChild variant="secondary" size="sm"><a href={value.releaseUrl ?? "https://github.com/SapienXai/AgentOS/releases/latest"} target="_blank" rel="noreferrer">View Linux packages <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>;
      }
      const href = value.packageManager === "pnpm"
        ? "https://pnpm.io/cli/update"
        : value.packageManager === "npm"
          ? "https://docs.npmjs.com/cli/v11/commands/npm-update"
          : "https://www.npmjs.com/package/@sapienx/agentos";
      return <Button asChild variant="secondary" size="sm"><a href={href} target="_blank" rel="noreferrer">Update with {value.packageManager ?? "your package manager"} <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>;
    }
    if (value.action === "deployment-guidance") {
      return <Button asChild variant="secondary" size="sm"><a href="https://github.com/SapienXai/AgentOS/blob/main/docs/deploy-on-railway.md" target="_blank" rel="noreferrer">View deployment update guidance <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>;
    }
    if (value.action === "source-guidance") {
      return <Button asChild variant="secondary" size="sm"><a href="https://github.com/SapienXai/AgentOS" target="_blank" rel="noreferrer">View source update guidance <ExternalLink className="ml-1.5 h-3.5 w-3.5" /></a></Button>;
    }
    return null;
  }
}

function operationLabel(
  operationState: AgentOsProductUpdateOperationState | undefined,
  availability: AgentOsProductUpdateSnapshot["availability"] | undefined,
  loading: boolean
) {
  if (loading) return "Checking";
  if (operationState === "requested") return "Prepared";
  if (operationState === "running") return "Updating";
  if (operationState === "restart-required" || operationState === "verifying") return "Verifying restart";
  if (operationState === "succeeded") return "Updated";
  if (operationState === "failed") return "Update failed";
  if (operationState === "unknown") return "Needs review";
  if (availability === "available") return "Update available";
  if (availability === "up-to-date") return "Up to date";
  if (availability === "unavailable") return "Check unavailable";
  return "Unknown";
}

function operationTone(
  operationState: string | undefined,
  availability: AgentOsProductUpdateSnapshot["availability"] | undefined,
  loading: boolean
): StatusTone {
  if (loading || operationState === "running" || operationState === "verifying" || availability === "available") return "info";
  if (operationState === "succeeded" || availability === "up-to-date") return "success";
  if (operationState === "failed") return "danger";
  if (operationState === "restart-required" || operationState === "unknown" || availability === "unavailable") return "warning";
  return "muted";
}

function operationMessage(
  state: AgentOsProductUpdateOperationState | undefined,
  phase: AgentOsProductUpdatePhase | null | undefined,
  progress: DesktopUpdateProgress | null
) {
  if (progress?.message) return progress.message;
  if (state === "requested") return "The update is prepared. AgentOS is waiting for the native signed update check.";
  if (state === "running") return phase === "download" ? "Downloading and verifying the signed Desktop update." : phase === "install" ? "Installing the verified Desktop update." : "AgentOS Desktop update is in progress.";
  if (state === "restart-required" || state === "verifying") return "AgentOS is restarting and checking the new native and server versions.";
  if (state === "succeeded") return "AgentOS restarted and verified the new Desktop and server versions.";
  if (state === "failed") return "AgentOS could not complete or verify the Desktop update.";
  if (state === "unknown") return "The previous update stopped without enough evidence to confirm its result.";
  return null;
}

function ownerLabel(owner: AgentOsProductUpdateSnapshot["owner"] | undefined) {
  switch (owner) {
    case "desktop": return "AgentOS Desktop";
    case "release-launcher": return "Release launcher";
    case "package-manager": return "Package manager";
    case "deployment": return "Deployment owner";
    case "source": return "Source checkout";
    default: return "Unknown";
  }
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}
