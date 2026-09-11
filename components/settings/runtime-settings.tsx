"use client";

import Link from "next/link";
import { Activity, ExternalLink, LoaderCircle, Plug, RefreshCw, Wrench } from "lucide-react";

import { OpenClawAppConnectDialog } from "@/components/mission-control/openclaw-app-connect-dialog";
import { Button } from "@/components/ui/button";
import { SettingsList, SettingsRow, SettingsSection, SettingsStatus } from "@/components/settings/settings-section";
import type { GatewayControlAction, SettingsPageProps } from "@/components/settings/settings-types";
import { formatOpenClawProductUpdateStateLabel } from "@/lib/openclaw/update-presentation";
import { cn } from "@/lib/utils";

export function RuntimeSettings({
  snapshot,
  surfaceTheme,
  onOpenControlUi,
  isOpeningControlUi,
  controlUiOpenError,
  isGatewayServiceOnline,
  gatewayActionGuidance,
  gatewayActionBusy,
  gatewayControlAction,
  onRunRecommendedGatewayAction,
  onRunGatewayControlAction,
  openClawAppConnectOpen,
  onOpenClawAppConnectOpenChange,
  onPairingPrepared,
  onOpenSetupWizard
}: Pick<SettingsPageProps, "snapshot" | "surfaceTheme" | "onOpenControlUi" | "isOpeningControlUi" | "controlUiOpenError" | "isGatewayServiceOnline" | "gatewayActionGuidance" | "gatewayActionBusy" | "gatewayControlAction" | "onRunRecommendedGatewayAction" | "onRunGatewayControlAction" | "openClawAppConnectOpen" | "onOpenClawAppConnectOpenChange" | "onPairingPrepared" | "onOpenSetupWizard">) {
  const openClawConnected = snapshot.diagnostics.loaded;
  const gatewayReady = isGatewayServiceOnline && snapshot.diagnostics.rpcOk;
  const version = snapshot.diagnostics.version ? `v${snapshot.diagnostics.version}` : "Version unavailable";
  const updateState = snapshot.diagnostics.updateProductState?.state ?? (
    snapshot.diagnostics.updateAvailable === true
      ? "available-fallback"
      : snapshot.diagnostics.updateAvailable === false
        ? "up-to-date"
        : "unknown"
  );
  const updateTarget = snapshot.diagnostics.updateProductState?.availableVersion || snapshot.diagnostics.latestVersion || null;
  const updateVisible = updateState !== "up-to-date" && updateState !== "unknown" && updateState !== "unavailable";
  const updateDescription = snapshot.diagnostics.updateProductState?.reason || (
    updateTarget && updateVisible ? `OpenClaw v${updateTarget} is available.` : "OpenClaw update status could not be verified."
  );
  const gatewayAction = gatewayActionGuidance.action as GatewayControlAction | null;
  const showRecovery = gatewayActionGuidance.state === "attention" && Boolean(gatewayAction);

  return (
    <SettingsSection title="Runtime" description="Manage the OpenClaw runtime and Gateway used by AgentOS." surfaceTheme={surfaceTheme}>
      <SettingsList surfaceTheme={surfaceTheme}>
        <SettingsRow label="OpenClaw" description={version} surfaceTheme={surfaceTheme}>
          <SettingsStatus label={openClawConnected ? "Connected" : "Needs attention"} tone={openClawConnected ? "success" : "warning"} surfaceTheme={surfaceTheme} />
        </SettingsRow>
        <SettingsRow label="OpenClaw Control UI" description="Open the official native control surface when you need more detail." surfaceTheme={surfaceTheme} className="flex-col items-start sm:flex-row sm:items-center">
          <Button type="button" onClick={() => void onOpenControlUi()} disabled={!openClawConnected || isOpeningControlUi} title={!openClawConnected ? "Start OpenClaw before opening its Control UI." : undefined} className="min-h-11 rounded-md text-xs sm:min-h-9">
            {isOpeningControlUi ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            {isOpeningControlUi ? "Opening…" : "Open OpenClaw Control UI"}
          </Button>
        </SettingsRow>
        <SettingsRow label="Gateway" description={gatewayReady ? "The runtime is ready for AgentOS tasks." : "The runtime is not currently ready."} surfaceTheme={surfaceTheme}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SettingsStatus label={gatewayReady ? "Online" : isGatewayServiceOnline ? "Needs attention" : "Offline"} tone={gatewayReady ? "success" : "warning"} surfaceTheme={surfaceTheme} />
            {gatewayReady ? <Button type="button" size="sm" variant="secondary" onClick={() => onRunGatewayControlAction("restart")} disabled={gatewayActionBusy} className="min-h-10 rounded-md text-xs sm:min-h-9"><RefreshCw className={cn("h-3.5 w-3.5", gatewayControlAction === "restart" && "animate-spin")} /> Restart</Button> : null}
          </div>
        </SettingsRow>
        <SettingsRow label="OpenClaw App" description="Pair the mobile app with this Gateway." surfaceTheme={surfaceTheme} action={<Button type="button" size="sm" variant="secondary" onClick={() => onOpenClawAppConnectOpenChange(true)} disabled={!openClawConnected} title={!openClawConnected ? "Start OpenClaw before connecting the app." : undefined} className="min-h-10 rounded-md text-xs sm:min-h-9"><Plug className="h-3.5 w-3.5" /> Connect</Button>}>
          <SettingsStatus label="Not connected" tone="muted" surfaceTheme={surfaceTheme} />
        </SettingsRow>
        <SettingsRow label="Updates" description={updateDescription} surfaceTheme={surfaceTheme} action={<Button asChild type="button" size="sm" variant="ghost" className="min-h-10 rounded-md px-2 text-xs sm:min-h-9"><Link href="/updates">Manage updates <span aria-hidden="true">→</span></Link></Button>}>
          <SettingsStatus label={formatOpenClawProductUpdateStateLabel(updateState)} tone={updateState === "up-to-date" ? "success" : updateState === "unknown" || updateState === "unavailable" ? "muted" : "warning"} surfaceTheme={surfaceTheme} />
        </SettingsRow>
      </SettingsList>

      {showRecovery ? (
        <div className={cn("mt-4 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between", surfaceTheme === "light" ? "border-amber-200 bg-amber-50/70" : "border-amber-300/20 bg-amber-300/[0.08]")} role="alert">
          <div className="flex min-w-0 items-start gap-3">
            <Wrench className={cn("mt-0.5 h-4 w-4 shrink-0", surfaceTheme === "light" ? "text-amber-700" : "text-amber-300")} />
            <div><p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-amber-950" : "text-amber-100")}>Gateway needs attention</p><p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-amber-900/80" : "text-amber-100/75")}>{gatewayActionGuidance.detail}</p></div>
          </div>
          <Button type="button" size="sm" onClick={onRunRecommendedGatewayAction} disabled={gatewayActionBusy} className="min-h-11 shrink-0 rounded-md text-xs sm:min-h-9">{gatewayControlAction ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}{gatewayActionGuidance.label}</Button>
        </div>
      ) : null}
      {!openClawConnected ? <div className="mt-4 flex flex-wrap items-center gap-2"><p className={cn("flex-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>OpenClaw is not connected yet. Finish setup to enable runtime controls.</p><Button type="button" size="sm" variant="secondary" onClick={() => onOpenSetupWizard()} className="min-h-10 rounded-md text-xs sm:min-h-9"><Activity className="h-3.5 w-3.5" /> Open setup</Button></div> : null}
      {controlUiOpenError ? <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-red-700" : "text-rose-300")} role="alert">{controlUiOpenError}</p> : null}
      <OpenClawAppConnectDialog
        open={openClawAppConnectOpen}
        onOpenChange={onOpenClawAppConnectOpenChange}
        surfaceTheme={surfaceTheme}
        bindMode={snapshot.diagnostics.bindMode}
        configuredGatewayUrl={snapshot.diagnostics.configuredGatewayUrl}
        onPairingPrepared={() => {
          onPairingPrepared();
        }}
      />
    </SettingsSection>
  );
}
