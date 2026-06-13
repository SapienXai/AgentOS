"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Box,
  Check,
  ChevronDown,
  Copy,
  Folder,
  KeyRound,
  ListChecks,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  Trash2,
  Wrench
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MissionControlShellSettingsPanelProps } from "@/components/mission-control/mission-control-shell.settings";
import {
  buildOpenClawCapabilityRows,
  formatGatewayFallbackDiagnosticKind,
  resolveTransportDiagnosticsSummary,
  resolveGatewayFallbackRecovery,
  summarizeOpenClawCapabilityRows,
  type OpenClawCapabilityMatrixRow,
  type OpenClawCapabilityMatrixSummary,
  type TransportDiagnosticsSummary,
  type TransportStatusTone
} from "@/components/mission-control/settings-control-center.utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  GatewayNativeAuthCredentialKind,
  GatewayNativeAuthStatus
} from "@/lib/openclaw/gateway-auth";
import { compactPath } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

const binaryModes: Array<{
  value: MissionControlShellSettingsPanelProps["openClawBinarySelection"]["mode"];
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "local-prefix", label: "Local prefix" },
  { value: "global-path", label: "Global PATH" },
  { value: "custom", label: "Custom" }
];

type SurfaceTheme = "dark" | "light";
type GatewayCompatibilityProfile = NonNullable<
  NonNullable<MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["capabilityMatrix"]>["compatibility"]
>;
type GatewayCapabilityOperations = NonNullable<
  NonNullable<MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["capabilityMatrix"]>["operations"]
>;
type GatewayMethodContractAudit = GatewayCompatibilityProfile["methodContract"];
type CompatibilitySmokeReport = NonNullable<
  MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["compatibilitySmokeTest"]
>;
type CompatibilityReport = NonNullable<
  MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["compatibilityReport"]
>;
type SettingsSectionId =
  | "openclaw"
  | "gateway"
  | "capabilities"
  | "models"
  | "workspace"
  | "agents"
  | "diagnostics"
  | "advanced"
  | "danger-zone";

type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
};

const settingsSections: SettingsSection[] = [
  { id: "openclaw", label: "OpenClaw", icon: Activity },
  { id: "gateway", label: "Gateway", icon: ShieldCheck },
  { id: "capabilities", label: "Capabilities", icon: ListChecks },
  { id: "models", label: "Models", icon: Box },
  { id: "workspace", label: "Workspace", icon: Folder },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "diagnostics", label: "Diagnostics", icon: TerminalSquare },
  { id: "advanced", label: "Advanced", icon: Settings2 },
  { id: "danger-zone", label: "Danger Zone", icon: AlertTriangle, destructive: true }
];

export function SettingsControlCenter(
  props: MissionControlShellSettingsPanelProps & { sidebarOpen?: boolean }
) {
  const {
    snapshot,
    surfaceTheme,
    connectionState,
    gatewayDraft,
    workspaceRootDraft,
    openClawBinarySelection,
    isSavingGateway,
    isSavingWorkspaceRoot,
    isSavingOpenClawBinary,
    isCheckingForUpdates,
    updateRunState,
    selectedModelId,
    modelOnboardingRunState,
    gatewayControlAction,
    lastCheckedAt,
    onGatewayDraftChange,
    onWorkspaceRootDraftChange,
    onSelectedModelIdChange,
    onSaveGatewaySettings,
    onSaveWorkspaceRootSettings,
    onCheckForUpdates,
    onControlGateway,
    onOpenSetupWizard,
    onRunModelRefresh,
    onRunModelSetDefault,
    onOpenAddModels,
    onOpenUpdateDialog,
    onRollbackOpenClaw,
    onOpenResetDialog,
    onOpenClawBinarySelectionModeChange,
    onOpenClawBinarySelectionPathChange,
    onSaveOpenClawBinarySettings,
    installSummary,
    sidebarOpen = false
  } = props;
  const [gatewayAuthStatus, setGatewayAuthStatus] = useState<GatewayNativeAuthStatus | null>(null);
  const [gatewayAuthError, setGatewayAuthError] = useState<string | null>(null);
  const [gatewayAuthCredentialKind, setGatewayAuthCredentialKind] =
    useState<GatewayNativeAuthCredentialKind>("token");
  const [gatewayAuthCredential, setGatewayAuthCredential] = useState("");
  const [gatewayAuthSaveMessage, setGatewayAuthSaveMessage] = useState<string | null>(null);
  const [isCheckingGatewayAuth, setIsCheckingGatewayAuth] = useState(false);
  const [isSavingGatewayAuthCredential, setIsSavingGatewayAuthCredential] = useState(false);
  const [isGeneratingGatewayAuthToken, setIsGeneratingGatewayAuthToken] = useState(false);
  const [isRepairingGatewayDeviceAccess, setIsRepairingGatewayDeviceAccess] = useState(false);
  const [compatibilitySmokeReport, setCompatibilitySmokeReport] = useState<CompatibilitySmokeReport | null>(
    () => snapshot.diagnostics.compatibilitySmokeTest ?? null
  );
  const [compatibilitySmokeError, setCompatibilitySmokeError] = useState<string | null>(null);
  const [isRunningCompatibilitySmoke, setIsRunningCompatibilitySmoke] = useState(false);
  const [configUpdatePacing, setConfigUpdatePacing] = useState(() => snapshot.diagnostics.configUpdatePacing);
  const [configUpdatePacingMode, setConfigUpdatePacingMode] = useState(
    () => snapshot.diagnostics.configUpdatePacing.settings.mode
  );
  const [configUpdatePacingCustomSeconds, setConfigUpdatePacingCustomSeconds] = useState(() =>
    String(Math.ceil((snapshot.diagnostics.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
  );
  const [configUpdatePacingError, setConfigUpdatePacingError] = useState<string | null>(null);
  const [isSavingConfigUpdatePacing, setIsSavingConfigUpdatePacing] = useState(false);
  const [configUpdatePacingTick, setConfigUpdatePacingTick] = useState(0);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => resolveInitialSettingsSection());
  const [settingsHashHydrated, setSettingsHashHydrated] = useState(false);
  const renderedActiveSection = settingsHashHydrated ? activeSection : resolveInitialSettingsSection();
  const updateCompatibility = snapshot.diagnostics.updateCompatibility;
  const recommendedVersion = updateCompatibility?.recommendedVersion ?? snapshot.diagnostics.latestVersion ?? null;
  const hasUpdateAvailable = Boolean(snapshot.diagnostics.updateAvailable && recommendedVersion);
  const isUpdateRegistryLoading = Boolean(
    snapshot.diagnostics.version && !recommendedVersion && !snapshot.diagnostics.updateError
  );
  const currentVersion = snapshot.diagnostics.version || "unknown";
  const latestVersion = recommendedVersion;
  const updateInfo = snapshot.diagnostics.updateInfo?.trim() || null;
  const updateError = snapshot.diagnostics.updateError?.trim() || null;
  const defaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "";
  const selectedOrDefaultModelId = selectedModelId || defaultModel || "";
  const selectedModel = snapshot.models.find((model) => model.id === selectedOrDefaultModelId);
  const modelProvider =
    selectedModel?.provider ||
    snapshot.diagnostics.modelReadiness.preferredLoginProvider ||
    deriveProviderFromModel(defaultModel) ||
    "Not connected";
  const commandHistory = useMemo(
    () => snapshot.diagnostics.commandHistory ?? [],
    [snapshot.diagnostics.commandHistory]
  );
  const latestCommands = commandHistory.slice(0, 6);
  const commandStats = useMemo(
    () => ({
      ok: latestCommands.filter((command) => command.status === "ok").length,
      failed: latestCommands.filter((command) => command.status !== "ok").length
    }),
    [latestCommands]
  );
  const transportSummary = useMemo(
    () => resolveTransportDiagnosticsSummary(snapshot.diagnostics.transport, connectionState, snapshot.diagnostics.eventBridge),
    [connectionState, snapshot.diagnostics.eventBridge, snapshot.diagnostics.transport]
  );
  const capabilityMatrix = snapshot.diagnostics.capabilityMatrix;
  const compatibilityReport = snapshot.diagnostics.compatibilityReport;
  const gatewayCompatibilityProfile = capabilityMatrix?.compatibility;
  const capabilityRows = useMemo(
    () => buildOpenClawCapabilityRows(snapshot.diagnostics),
    [snapshot.diagnostics]
  );
  const capabilitySummary = useMemo(
    () => summarizeOpenClawCapabilityRows(snapshot.diagnostics, capabilityRows),
    [capabilityRows, snapshot.diagnostics]
  );
  const gatewayFallbackDiagnostics = (
    snapshot.diagnostics.gatewayFallbackDiagnostics?.length
      ? snapshot.diagnostics.gatewayFallbackDiagnostics
      : capabilityMatrix?.fallbackDiagnostics ?? []
  ).slice(0, 4);
  const nativeAuthLabel = gatewayAuthStatus
    ? gatewayAuthStatus.native.ok
      ? "Authenticated"
      : formatGatewayAuthIssue(gatewayAuthStatus.native.kind)
    : "Unknown";

  useEffect(() => {
    const snapshotReport = snapshot.diagnostics.compatibilitySmokeTest;
    if (!snapshotReport) {
      return;
    }

    setCompatibilitySmokeReport((current) => {
      if (!current) {
        return snapshotReport;
      }

      const currentTime = Date.parse(current.checkedAt);
      const snapshotTime = Date.parse(snapshotReport.checkedAt);
      return Number.isFinite(snapshotTime) && (!Number.isFinite(currentTime) || snapshotTime > currentTime)
        ? snapshotReport
        : current;
    });
  }, [snapshot.diagnostics.compatibilitySmokeTest]);

  useEffect(() => {
    setConfigUpdatePacing(snapshot.diagnostics.configUpdatePacing);
    setConfigUpdatePacingMode(snapshot.diagnostics.configUpdatePacing.settings.mode);
    setConfigUpdatePacingCustomSeconds(
      String(Math.ceil((snapshot.diagnostics.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
    );
  }, [snapshot.diagnostics.configUpdatePacing]);

  useEffect(() => {
    if (!configUpdatePacing.cooldownUntil) {
      return;
    }

    const timer = window.setInterval(() => {
      setConfigUpdatePacingTick((value) => value + 1);
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [configUpdatePacing.cooldownUntil]);

  const refreshGatewayAuthStatus = useCallback(async () => {
    setIsCheckingGatewayAuth(true);
    setGatewayAuthError(null);

    try {
      setGatewayAuthStatus(await fetchGatewayAuthStatus());
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to check Gateway auth status.");
    } finally {
      setIsCheckingGatewayAuth(false);
    }
  }, []);

  useEffect(() => {
    void refreshGatewayAuthStatus();
  }, [refreshGatewayAuthStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncActiveSectionFromHash = () => {
      setActiveSection(resolveHashSettingsSection());
      setSettingsHashHydrated(true);
      scrollSettingsToTop();
    };

    window.addEventListener("hashchange", syncActiveSectionFromHash);
    syncActiveSectionFromHash();

    return () => {
      window.removeEventListener("hashchange", syncActiveSectionFromHash);
    };
  }, []);

  useEffect(() => {
    scrollSettingsToTop();
  }, [activeSection]);

  const saveGatewayAuthCredential = async () => {
    const credential = gatewayAuthCredential.trim();
    if (!credential) {
      setGatewayAuthError("Gateway token/password is required.");
      return;
    }

    setIsSavingGatewayAuthCredential(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "saveCredential",
          kind: gatewayAuthCredentialKind,
          value: credential
        })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway credential could not be saved.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthCredential("");
      setGatewayAuthSaveMessage("Saved to .env.local and applied to the current AgentOS server session.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to save Gateway credential.");
    } finally {
      setIsSavingGatewayAuthCredential(false);
    }
  };

  const generateGatewayAuthToken = async () => {
    setIsGeneratingGatewayAuthToken(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "generateLocalToken" })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway token could not be generated.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthSaveMessage("Generated a local Gateway token and applied it to AgentOS.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to generate Gateway token.");
    } finally {
      setIsGeneratingGatewayAuthToken(false);
    }
  };

  const repairGatewayDeviceAccess = async () => {
    setIsRepairingGatewayDeviceAccess(true);
    setGatewayAuthError(null);
    setGatewayAuthSaveMessage(null);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "repairDeviceAccess" })
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Gateway device access could not be repaired.");
      }

      const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
      setGatewayAuthStatus(result.authStatus);
      setGatewayAuthSaveMessage("Local Gateway device access repaired for AgentOS.");
    } catch (error) {
      setGatewayAuthError(error instanceof Error ? error.message : "Unable to repair Gateway access.");
    } finally {
      setIsRepairingGatewayDeviceAccess(false);
    }
  };

  const runCompatibilitySmokeTest = async () => {
    setIsRunningCompatibilitySmoke(true);
    setCompatibilitySmokeError(null);

    try {
      const response = await fetch("/api/openclaw/compatibility-smoke", {
        method: "POST",
        cache: "no-store"
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "OpenClaw compatibility smoke test failed.");
      }

      const result = (await response.json()) as { report: CompatibilitySmokeReport };
      setCompatibilitySmokeReport(result.report);
    } catch (error) {
      setCompatibilitySmokeError(
        error instanceof Error ? error.message : "Unable to run OpenClaw compatibility smoke test."
      );
    } finally {
      setIsRunningCompatibilitySmoke(false);
    }
  };

  const saveConfigUpdatePacing = async () => {
    setIsSavingConfigUpdatePacing(true);
    setConfigUpdatePacingError(null);

    try {
      const minimumIntervalMs = configUpdatePacingMode === "custom"
        ? Math.max(1, Math.round(Number(configUpdatePacingCustomSeconds) || 10)) * 1_000
        : null;
      const response = await fetch("/api/settings/config-pacing", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: configUpdatePacingMode,
          minimumIntervalMs
        })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to update config update pacing.");
      }

      setConfigUpdatePacing(payload.configUpdatePacing);
      setConfigUpdatePacingMode(payload.configUpdatePacing.settings.mode);
      setConfigUpdatePacingCustomSeconds(
        String(Math.ceil((payload.configUpdatePacing.settings.minimumIntervalMs ?? 10_000) / 1_000))
      );
    } catch (error) {
      setConfigUpdatePacingError(error instanceof Error ? error.message : "Unable to update config update pacing.");
    } finally {
      setIsSavingConfigUpdatePacing(false);
    }
  };

  const configUpdatePacingRetryMs = configUpdatePacing.cooldownUntil
    ? Math.max(0, Date.parse(configUpdatePacing.cooldownUntil) - Date.now() + configUpdatePacingTick * 0)
    : null;

  return (
    <main
      className={cn(
        "relative z-10 min-h-screen",
        surfaceTheme === "light" ? "text-foreground" : "text-slate-100"
      )}
    >
        <section
          className={cn(
            "min-w-0 pb-8 pl-[72px] pr-3 pt-[86px] sm:pl-[84px] sm:pr-6 lg:mr-[84px] lg:px-7 xl:px-8",
            sidebarOpen ? "lg:ml-[316px]" : "lg:ml-[80px]"
          )}
        >
          <div className="mx-auto max-w-[1160px] 2xl:max-w-[1240px]">
            <div className="flex flex-col">
              <nav
                aria-label="Settings sections"
                className={cn(
                  "flex flex-wrap gap-2 rounded-[22px] border p-2 backdrop-blur-xl",
                  surfaceTheme === "light"
                    ? "border-border bg-card/88 shadow-card"
                    : "border-border bg-card/88 shadow-[0_18px_44px_rgba(0,0,0,0.16)]"
                )}
              >
                {settingsSections.map((section) => {
                  const active = renderedActiveSection === section.id;
                  const Icon = section.icon;

                  return (
                    <Link
                      key={section.id}
                      href={`/settings#${section.id}`}
                      scroll={false}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        setActiveSection(section.id);
                        scrollSettingsToTop();
                      }}
                      className={cn(
                        "inline-flex h-10 items-center gap-2 rounded-[14px] border px-3 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                        active && !section.destructive
                          ? surfaceTheme === "light"
                            ? "border-primary/35 bg-primary/10 text-primary shadow-[0_10px_26px_hsl(var(--primary)/0.10)]"
                            : "border-primary/35 bg-primary/12 text-primary shadow-[0_10px_26px_hsl(var(--primary)/0.14)]"
                          : active && section.destructive
                            ? surfaceTheme === "light"
                              ? "border-destructive/35 bg-destructive/10 text-destructive shadow-[0_10px_26px_hsl(var(--destructive)/0.10)]"
                              : "border-destructive/35 bg-destructive/12 text-destructive shadow-[0_10px_26px_hsl(var(--destructive)/0.14)]"
                            : surfaceTheme === "light"
                              ? "border-border bg-card/75 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                              : "border-border bg-white/[0.035] text-muted-foreground hover:border-primary/20 hover:bg-white/[0.07] hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{section.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="mt-5 flex flex-col gap-4">
              {renderedActiveSection === "openclaw" ? (
              <section id="openclaw" className="scroll-mt-24">
                <div
                  className={cn(
                    "panel-surface panel-glow min-h-full overflow-hidden rounded-[22px] p-4",
                    surfaceTheme === "light"
                      ? "border-border bg-card/95 text-foreground shadow-card"
                      : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(16,24,38,0.98),rgba(7,11,18,0.96))] text-slate-100"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                        surfaceTheme === "light"
                          ? "border-primary/15 bg-primary/10 text-primary"
                          : "border-primary/15 bg-primary/10 text-primary"
                      )}
                    >
                      <Activity className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-lg">OpenClaw</h2>
                      <p
                        className={cn(
                          "mt-0.5 text-xs leading-5",
                          surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400"
                        )}
                      >
                        Source of truth for runtime and control state.
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <Metric
                      label="Current version"
                      value={`v${snapshot.diagnostics.version || "unknown"}`}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                    />
                    <Metric
                      label="Recommended"
                      value={recommendedVersion ? `v${recommendedVersion}` : "Unknown"}
                      badge={updateCompatibility?.recommendedDecision.status ?? (hasUpdateAvailable ? "Update" : "Stable")}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() => onOpenUpdateDialog(recommendedVersion ?? undefined, "recommended")}
                      disabled={!hasUpdateAvailable || updateRunState === "running"}
                      className="h-9 rounded-full bg-emerald-600 px-4 text-xs text-white hover:bg-emerald-500"
                    >
                      {updateRunState === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
                      Update to recommended
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onCheckForUpdates()}
                      disabled={isCheckingForUpdates || updateRunState === "running"}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Check
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenSetupWizard()}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      Open wizard
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={onRollbackOpenClaw}
                      disabled={updateRunState === "running"}
                      className={secondaryButtonClassName(surfaceTheme, "px-4")}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Rollback to last working OpenClaw
                    </Button>
                  </div>

                  <UpdateRegistryPanel
                    surfaceTheme={surfaceTheme}
                    isCheckingForUpdates={isCheckingForUpdates}
                    isUpdateRegistryLoading={isUpdateRegistryLoading}
                    hasUpdateAvailable={hasUpdateAvailable}
                    currentVersion={currentVersion}
                    latestVersion={latestVersion}
                    updateInfo={updateInfo}
                    updateError={updateError}
                    lastCheckedAt={lastCheckedAt}
                    isUpdateRunning={updateRunState === "running"}
                    updateCompatibility={updateCompatibility}
                    onTryPreviewVersion={(version) => onOpenUpdateDialog(version, "candidate")}
                  />

                  <div className={cn("mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2", surfaceTheme === "light" ? "border-border" : "border-white/10")}>
                    <Metric
                      label="Detected install"
                      value={installSummary.label || "Unknown"}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                      compact
                    />
                    <Metric
                      label="Resolved path"
                      value={shortPath(openClawBinarySelection.resolvedPath || "openclaw", 26)}
                      surfaceTheme={surfaceTheme}
                      dark={surfaceTheme === "dark"}
                      compact
                    />
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[18px] border p-3.5",
                      surfaceTheme === "light" ? "border-border bg-muted/45" : "border-white/10 bg-white/[0.035]"
                    )}
                  >
                    <Label className={labelClassName(surfaceTheme)}>OpenClaw binary mode</Label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {binaryModes.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => onOpenClawBinarySelectionModeChange(mode.value)}
                          className={cn(
                            "h-9 rounded-full border px-3 text-xs transition-colors",
                            openClawBinarySelection.mode === mode.value
                              ? surfaceTheme === "light"
                                ? "border-primary/35 bg-primary/10 text-primary"
                                : "border-primary/30 bg-primary/12 text-primary"
                              : surfaceTheme === "light"
                                ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                                : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
                          )}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                    {openClawBinarySelection.mode === "custom" ? (
                      <Input
                        value={openClawBinarySelection.path ?? ""}
                        onChange={(event) => onOpenClawBinarySelectionPathChange(event.target.value)}
                        placeholder="/path/to/openclaw"
                        className={inputClassName(surfaceTheme, "mt-3")}
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onSaveOpenClawBinarySettings(openClawBinarySelection)}
                      disabled={isSavingOpenClawBinary}
                      className={secondaryButtonClassName(surfaceTheme, "mt-3 w-full")}
                    >
                      {isSavingOpenClawBinary ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save selection
                    </Button>
                  </div>
                </div>
              </section>
              ) : null}

              {renderedActiveSection === "gateway" ? (
              <section id="gateway" className="scroll-mt-24">
                <Card title="Gateway" icon={ShieldCheck} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Status", `${resolveGatewayLocality(snapshot)} / ${snapshot.diagnostics.loaded || snapshot.diagnostics.rpcOk ? "Online" : "Offline"}`],
                      ["Native Gateway", transportSummary.statusLabel],
                      ["Gateway mode", transportSummary.gatewayModeLabel],
                      ["CLI fallback used", `${transportSummary.fallbackTotal} operations`],
                      ["Endpoint", snapshot.diagnostics.gatewayUrl || "Not configured"],
                      ["Auth status", nativeAuthLabel],
                      ["Protocol", `${transportSummary.protocolRangeLabel}, connected: ${transportSummary.protocolLabel}`],
                      ["OpenClaw Compatibility", compatibilityReport ? formatCompatibilityReportStatus(compatibilityReport.status) : "Unknown"],
                      ["Native Gateway coverage", compatibilityReport ? `${compatibilityReport.summary.nativeGatewayCoveragePercent}% (${compatibilityReport.summary.nativeGatewayCoverageLabel})` : "Unknown"],
                      ["CLI fallback operation count", compatibilityReport ? String(compatibilityReport.summary.cliFallbackOperationCount) : "Unknown"],
                      ["Unsupported/degraded integrations", compatibilityReport ? formatCompatibilityReportIssues(compatibilityReport) : "Unknown"],
                      ["Compatibility", formatGatewayCompatibilityStatus(gatewayCompatibilityProfile)],
                      ["Contract audit", formatGatewayMethodContractStatus(gatewayCompatibilityProfile?.methodContract)],
                      ["Contract gaps", formatGatewayMethodContractGaps(gatewayCompatibilityProfile?.methodContract, capabilityMatrix?.operations)],
                      ["Native ops", formatGatewayOperationCounts(gatewayCompatibilityProfile)],
                      ["Alias ops", formatGatewayAliasOperations(gatewayCompatibilityProfile?.aliasOperations, capabilityMatrix?.operations)],
                      ["Limited ops", formatGatewayDegradedOperations(gatewayCompatibilityProfile?.degradedOperations, capabilityMatrix?.operations)],
                      ["Native chat", formatCapabilitySupport(capabilityMatrix?.nativeMissionDispatch)],
                      ["Config patch", formatCapabilitySupport(capabilityMatrix?.configPatch)],
                      ["Events", formatCapabilitySupport(capabilityMatrix?.eventBridge)]
                    ]}
                    successIndex={1}
                  />

                  <CompatibilityPanel
                    compatibilityReport={compatibilityReport}
                    report={compatibilitySmokeReport}
                    snapshot={snapshot}
                    capabilityMatrix={capabilityMatrix}
                    transportSummary={transportSummary}
                    nativeAuthLabel={nativeAuthLabel}
                    error={compatibilitySmokeError}
                    isRunning={isRunningCompatibilitySmoke}
                    onRun={() => void runCompatibilitySmokeTest()}
                    surfaceTheme={surfaceTheme}
                  />

                  {transportSummary.recovery || transportSummary.lastNativeError ? (
                    <div className={cn("mt-4 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
                      <p className={labelClassName(surfaceTheme)}>Native Gateway diagnostic</p>
                      {transportSummary.lastNativeError ? (
                        <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                          Last native error: {transportSummary.lastNativeError}
                        </p>
                      ) : null}
                      {transportSummary.recovery ? (
                        <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                          Recovery: {transportSummary.recovery}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className={labelClassName(surfaceTheme)}>Gateway endpoint</Label>
                      <Input
                        value={gatewayDraft}
                        onChange={(event) => onGatewayDraftChange(event.target.value)}
                        placeholder="ws://127.0.0.1:18789"
                        className={inputClassName(surfaceTheme, "mt-2")}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => void onSaveGatewaySettings(gatewayDraft.trim() || null)}
                        disabled={isSavingGateway}
                        className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                      >
                        {isSavingGateway ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save endpoint
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void onSaveGatewaySettings(null)}
                        disabled={isSavingGateway}
                        className={secondaryButtonClassName(surfaceTheme)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {(["start", "stop", "restart"] as const).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        variant="secondary"
                        onClick={() => void onControlGateway(action)}
                        disabled={gatewayControlAction !== null}
                        className={cn(secondaryButtonClassName(surfaceTheme), "capitalize")}
                      >
                        {gatewayControlAction === action ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                        {action}
                      </Button>
                    ))}
                  </div>

                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-emerald-200 bg-emerald-50/55"
                        : "border border-cyan-300/12 bg-cyan-300/[0.06]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <KeyRound
                        className={cn(
                          "mt-0.5 h-4 w-4",
                          surfaceTheme === "light" ? "text-emerald-700" : "text-cyan-200"
                        )}
                      />
                      <div>
                        <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-[#2f624b]" : "text-slate-100")}>
                          Native Gateway auth
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-xs leading-5",
                            surfaceTheme === "light" ? "text-[#6f836f]" : "text-slate-400"
                          )}
                        >
                          Use local repair when AgentOS reports missing operator scopes.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void repairGatewayDeviceAccess()}
                        disabled={isRepairingGatewayDeviceAccess}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                      >
                        {isRepairingGatewayDeviceAccess ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                        Repair local access
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void generateGatewayAuthToken()}
                        disabled={isGeneratingGatewayAuthToken}
                        className={secondaryButtonClassName(surfaceTheme, "px-3", "gateway-contrast")}
                      >
                        {isGeneratingGatewayAuthToken ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        Generate token
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[112px_1fr]">
                      <select
                        value={gatewayAuthCredentialKind}
                        onChange={(event) => setGatewayAuthCredentialKind(event.target.value as GatewayNativeAuthCredentialKind)}
                        className={inputClassName(surfaceTheme)}
                      >
                        <option value="token">Token</option>
                        <option value="password">Password</option>
                      </select>
                      <Input
                        type="password"
                        value={gatewayAuthCredential}
                        onChange={(event) => setGatewayAuthCredential(event.target.value)}
                        placeholder="Paste known credential"
                        className={inputClassName(surfaceTheme)}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        onClick={() => void saveGatewayAuthCredential()}
                        disabled={isSavingGatewayAuthCredential}
                        className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                      >
                        {isSavingGatewayAuthCredential ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save credential
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void refreshGatewayAuthStatus()}
                        disabled={isCheckingGatewayAuth}
                        className={secondaryButtonClassName(surfaceTheme, undefined, "gateway-contrast")}
                      >
                        {isCheckingGatewayAuth ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Test auth
                      </Button>
                    </div>
                    {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue ? (
                      <p
                        className={cn(
                          "mt-3 text-xs leading-5",
                          gatewayAuthError
                            ? surfaceTheme === "light"
                              ? "text-red-700"
                              : "text-rose-300"
                            : surfaceTheme === "light"
                              ? "text-muted-foreground"
                              : "text-slate-400"
                        )}
                      >
                        {gatewayAuthError || gatewayAuthSaveMessage || gatewayAuthStatus?.native.issue}
                      </p>
                    ) : null}
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "capabilities" ? (
              <section id="capabilities" className="scroll-mt-24">
                <Card title="OpenClaw Capability Matrix" icon={ListChecks} surfaceTheme={surfaceTheme}>
                  <CapabilityMatrixPanel
                    rows={capabilityRows}
                    summary={capabilitySummary}
                    surfaceTheme={surfaceTheme}
                  />
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "models" ? (
              <section id="models" className="scroll-mt-24">
                <Card title="Models" icon={Box} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Default model", defaultModel || "Not selected"],
                      ["Provider", modelProvider],
                      ["Available", `${snapshot.diagnostics.modelReadiness.availableModelCount} of ${snapshot.diagnostics.modelReadiness.totalModelCount}`]
                    ]}
                  />
                  <div className="mt-4">
                    <Label className={labelClassName(surfaceTheme)}>Model</Label>
                    <select
                      value={selectedOrDefaultModelId}
                      onChange={(event) => onSelectedModelIdChange(event.target.value)}
                      className={inputClassName(surfaceTheme, "mt-2")}
                    >
                      <option value="">Choose model</option>
                      {snapshot.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name || model.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => void onRunModelSetDefault(selectedOrDefaultModelId)}
                      disabled={!selectedOrDefaultModelId || modelOnboardingRunState === "running"}
                      className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                    >
                      {modelOnboardingRunState === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Use selected
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => onOpenAddModels(null)}
                      className={secondaryButtonClassName(surfaceTheme)}
                    >
                      Add models
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void onRunModelRefresh()}
                    disabled={modelOnboardingRunState === "running"}
                    className={cn(secondaryButtonClassName(surfaceTheme), "mt-3 w-full")}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh models
                  </Button>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "workspace" ? (
              <section id="workspace" className="scroll-mt-24">
                <Card title="Workspace" icon={Folder} surfaceTheme={surfaceTheme}>
                  <div>
                    <Label className={labelClassName(surfaceTheme)}>Workspace root</Label>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={workspaceRootDraft}
                        onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                        placeholder="~/Documents/AgentOS"
                        className={inputClassName(surfaceTheme)}
                      />
                      <button
                        type="button"
                        aria-label="Copy workspace root"
                        onClick={() => copyToClipboard(workspaceRootDraft || snapshot.diagnostics.workspaceRoot)}
                        className={copyButtonClassName(surfaceTheme)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => void onSaveWorkspaceRootSettings(workspaceRootDraft.trim() || null)}
                      disabled={isSavingWorkspaceRoot}
                      className="h-9 rounded-full bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                    >
                      {isSavingWorkspaceRoot ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void onSaveWorkspaceRootSettings(null)}
                      disabled={isSavingWorkspaceRoot}
                      className={secondaryButtonClassName(surfaceTheme)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Current root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.workspaceRoot, 56)}
                    </p>
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "diagnostics" ? (
              <section id="diagnostics" className="scroll-mt-24">
                <Card
                  title="Diagnostics"
                  icon={TerminalSquare}
                  surfaceTheme={surfaceTheme}
                  action={
                    <span
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                        surfaceTheme === "light"
                          ? "border-border bg-card text-muted-foreground"
                          : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {commandStats.ok} OK
                      {commandStats.failed ? <span className="text-red-600">{commandStats.failed} failed</span> : null}
                    </span>
                  }
                >
                  <div className="space-y-2">
                    <TransportDiagnosticsPanel summary={transportSummary} surfaceTheme={surfaceTheme} />
                    {gatewayFallbackDiagnostics.length ? (
                      <div
                        className={cn(
                          "border-l-2 py-1 pl-3",
                          surfaceTheme === "light" ? "border-amber-300" : "border-amber-300/45"
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className={labelClassName(surfaceTheme)}>Gateway fallback diagnostics</p>
                          <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                            {gatewayFallbackDiagnostics.length} recent
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          {gatewayFallbackDiagnostics.map((diagnostic) => (
                            <div key={`${diagnostic.at}-${diagnostic.operation}`} className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                                  {diagnostic.operationLabel}
                                </span>
                                <code className={cn("rounded-full px-2 py-0.5 text-[10px]", surfaceTheme === "light" ? "bg-muted text-muted-foreground" : "bg-white/[0.06] text-slate-300")}>
                                  {diagnostic.operation}
                                </code>
                                <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-amber-700" : "text-amber-200")}>
                                  {formatGatewayFallbackDiagnosticKind(diagnostic.kind)}
                                </span>
                                <span className={cn("text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                                  {formatTimestamp(diagnostic.at)}
                                </span>
                              </div>
                              <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                                Reason: {diagnostic.issue}
                              </p>
                              <p className={cn("mt-0.5 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                                Recovery: {diagnostic.recovery || resolveGatewayFallbackRecovery(diagnostic.kind)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {latestCommands.length ? (
                      latestCommands.map((command) => (
                        <details
                          key={command.id}
                          className={cn(
                            "group rounded-[16px] border",
                            surfaceTheme === "light"
                              ? "border-border bg-card"
                              : "border-white/[0.08] bg-[#101a2a]/92"
                          )}
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                            <code className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                              {command.command} {command.args.join(" ")}
                            </code>
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]",
                                command.status === "ok"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              )}
                            >
                              {command.status}
                            </span>
                            <span className={cn("hidden text-xs sm:inline", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                              {command.durationMs} ms
                            </span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
                          </summary>
                          <div
                            className={cn(
                              "border-t p-3.5",
                              surfaceTheme === "light" ? "border-border" : "border-white/[0.08]"
                            )}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DiagnosticBlock title="stdout" value={command.stdoutPreview} surfaceTheme={surfaceTheme} />
                              <DiagnosticBlock title="stderr" value={command.stderrPreview} surfaceTheme={surfaceTheme} />
                            </div>
                            <p className={cn("mt-3 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                              Exit code: {command.exitCode ?? "n/a"} | Started: {formatTimestamp(command.startedAt)}
                            </p>
                          </div>
                        </details>
                      ))
                    ) : (
                      <EmptyState
                        title="No recent CLI calls"
                        detail="Diagnostics will appear after AgentOS uses fallback commands."
                        surfaceTheme={surfaceTheme}
                      />
                    )}
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "agents" ? (
              <section id="agents" className="scroll-mt-24">
                <Card title="Agents" icon={Bot} surfaceTheme={surfaceTheme}>
                  <InfoRows
                    surfaceTheme={surfaceTheme}
                    rows={[
                      ["Agents", String(snapshot.agents.length)],
                      ["Workspaces", String(snapshot.workspaces.length)],
                      ["Active runtimes", String(snapshot.runtimes.filter((runtime) => runtime.status === "running").length)]
                    ]}
                  />
                  <Button
                    asChild
                    variant="secondary"
                    className={cn(secondaryButtonClassName(surfaceTheme), "mt-4 w-full")}
                  >
                    <Link href="/">Open mission control</Link>
                  </Button>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "advanced" ? (
              <section id="advanced" className="scroll-mt-24">
                <Card title="Advanced" icon={Settings2} surfaceTheme={surfaceTheme}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      label="Install method"
                      value={snapshot.diagnostics.updateInstallKind || installSummary.label || "Unknown"}
                      surfaceTheme={surfaceTheme}
                    />
                    <Metric
                      label="Updater"
                      value={snapshot.diagnostics.updatePackageManager || "Unknown"}
                      surfaceTheme={surfaceTheme}
                    />
                    <Metric
                      label="Last checked"
                      value={lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not checked"}
                      surfaceTheme={surfaceTheme}
                    />
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <p className={labelClassName(surfaceTheme)}>Install root</p>
                    <p className={cn("mt-2 break-all text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                      {shortPath(snapshot.diagnostics.updateRoot || installSummary.root || "Not detected", 80)}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "mt-4 rounded-[18px] p-3.5",
                      surfaceTheme === "light"
                        ? "border border-border bg-muted/45"
                        : "border border-white/[0.08] bg-[#101a2a]/92"
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className={labelClassName(surfaceTheme)}>Config update pacing</p>
                        <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                          Controls how often AgentOS attempts OpenClaw config updates. It does not change the OpenClaw Gateway rate limit.
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]",
                          configUpdatePacing.pending
                            ? surfaceTheme === "light"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-amber-300/24 bg-amber-300/[0.08] text-amber-200"
                            : surfaceTheme === "light"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
                        )}
                      >
                        {configUpdatePacing.pending ? "Pending config update" : "Idle"}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("respect-gateway")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "respect-gateway")}
                      >
                        Respect Gateway
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("fast-local-testing")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "fast-local-testing")}
                      >
                        Fast testing
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfigUpdatePacingMode("custom")}
                        className={segmentedButtonClassName(surfaceTheme, configUpdatePacingMode === "custom")}
                      >
                        Custom
                      </button>
                    </div>

                    {configUpdatePacingMode === "custom" ? (
                      <div className="mt-3">
                        <Label className={labelClassName(surfaceTheme)}>Minimum local interval, seconds</Label>
                        <Input
                          type="number"
                          min={1}
                          max={600}
                          value={configUpdatePacingCustomSeconds}
                          onChange={(event) => setConfigUpdatePacingCustomSeconds(event.target.value)}
                          className={inputClassName(surfaceTheme, "mt-2")}
                        />
                      </div>
                    ) : null}

                    <InfoRows
                      surfaceTheme={surfaceTheme}
                      rows={[
                        ["Current mode", formatConfigUpdatePacingMode(configUpdatePacing.settings.mode)],
                        ["Minimum local interval", formatConfigUpdatePacingInterval(configUpdatePacing.settings.minimumIntervalMs)],
                        ["Queue durability", configUpdatePacing.queueDurability === "persistent" ? "Persistent AgentOS sidecar queue" : "Volatile memory"],
                        ["Pending paths", configUpdatePacing.pendingPaths.length ? configUpdatePacing.pendingPaths.join(", ") : "None"],
                        ["Pending since", configUpdatePacing.pendingSince ? formatTimestamp(configUpdatePacing.pendingSince) : "None"],
                        ["Retry countdown", configUpdatePacingRetryMs !== null ? formatConfigUpdatePacingInterval(configUpdatePacingRetryMs) : "None"],
                        ["Last update", configUpdatePacing.lastUpdatedAt ? formatTimestamp(configUpdatePacing.lastUpdatedAt) : "None"],
                        ["CLI fallback", "Disabled for Gateway config cooldown recovery"]
                      ]}
                    />

                    {configUpdatePacing.lastIssue ? (
                      <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-amber-700" : "text-amber-200")}>
                        Last Gateway issue: {configUpdatePacing.lastIssue}
                      </p>
                    ) : null}
                    {configUpdatePacingError ? (
                      <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-red-700" : "text-rose-300")}>
                        {configUpdatePacingError}
                      </p>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void saveConfigUpdatePacing()}
                      disabled={isSavingConfigUpdatePacing}
                      className={cn(secondaryButtonClassName(surfaceTheme), "mt-3 w-full")}
                    >
                      {isSavingConfigUpdatePacing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save pacing
                    </Button>
                  </div>
                </Card>
              </section>
              ) : null}

              {renderedActiveSection === "danger-zone" ? (
              <section id="danger-zone" className="scroll-mt-24">
                <div
                  className={cn(
                    "rounded-[22px] p-4 shadow-[0_18px_44px_rgba(185,28,28,0.06)]",
                    surfaceTheme === "light"
                      ? "border border-red-200 bg-red-50/58"
                      : "border border-rose-400/20 bg-rose-500/[0.08]"
                  )}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
                          surfaceTheme === "light"
                            ? "border-red-200 bg-white text-red-600"
                            : "border-rose-300/20 bg-rose-400/10 text-rose-200"
                        )}
                      >
                        <AlertTriangle className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className={cn("font-display text-lg", surfaceTheme === "light" ? "text-red-700" : "text-rose-100")}>
                          Danger Zone
                        </h2>
                        <p className={cn("mt-1.5 max-w-2xl text-sm leading-6", surfaceTheme === "light" ? "text-red-700/72" : "text-rose-100/80")}>
                          These actions are destructive and cannot be undone. Confirmation is required before anything runs.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:min-w-[340px]">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => onOpenResetDialog("mission-control")}
                        className="h-9 rounded-full bg-red-600 text-xs text-white hover:bg-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Reset AgentOS
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => onOpenResetDialog("full-uninstall")}
                        className={cn(
                          "h-9 rounded-full text-xs",
                          surfaceTheme === "light"
                            ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
                            : "border-rose-300/20 bg-[#121d2d] text-rose-100 hover:bg-[#182538]"
                        )}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Full uninstall
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
              ) : null}
            </div>
          </div>
        </section>
    </main>
  );
}

function Card({
  title,
  icon: Icon,
  children,
  action,
  surfaceTheme
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "min-h-full rounded-[22px] p-4 shadow-[0_20px_54px_rgba(101,74,54,0.07)] backdrop-blur-xl",
        cardClassName(surfaceTheme)
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={cardIconClassName(surfaceTheme)}>
            <Icon className="h-4 w-4" />
          </span>
          <h2 className={cn("font-display text-lg", surfaceTheme === "light" ? "text-[#2d211b]" : "text-slate-100")}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  badge,
  surfaceTheme,
  dark = false,
  compact = false
}: {
  label: string;
  value: string;
  badge?: string;
  surfaceTheme: SurfaceTheme;
  dark?: boolean;
  compact?: boolean;
}) {
  const cardToneIsDark = dark || surfaceTheme === "dark";
  return (
    <div>
      <p className={cn("text-[11px]", cardToneIsDark ? "text-slate-400" : "text-muted-foreground")}>{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p
          className={cn(
            "min-w-0 truncate font-medium",
            compact ? "text-sm" : "text-[1.05rem]",
            cardToneIsDark ? "text-white" : "text-foreground"
          )}
          title={value}
        >
          {value}
        </p>
        {badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]",
              cardToneIsDark
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            )}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function InfoRows({
  rows,
  successIndex,
  surfaceTheme
}: {
  rows: Array<[string, string]>;
  successIndex?: number;
  surfaceTheme: SurfaceTheme;
}) {
  const cardToneIsDark = surfaceTheme === "dark";
  return (
    <div className={cn("overflow-hidden rounded-[18px] border", infoRowsShellClassName(surfaceTheme))}>
      {rows.map(([label, value], index) => (
        <div key={label} className={cn("flex items-center justify-between gap-3 px-3.5 py-2.5 last:border-b-0", infoRowBorderClassName(surfaceTheme))}>
          <span className={cn("text-sm", cardToneIsDark ? "text-slate-400" : "text-muted-foreground")}>{label}</span>
          <span
            className={cn(
              "min-w-0 truncate text-right text-sm",
              cardToneIsDark ? "text-slate-100" : "text-foreground",
              successIndex === index
                ? cardToneIsDark
                  ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100"
                  : "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
                : ""
            )}
            title={value}
          >
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiagnosticBlock({
  title,
  value,
  surfaceTheme
}: {
  title: string;
  value: string | null;
  surfaceTheme: SurfaceTheme;
}) {
  const cardToneIsDark = surfaceTheme === "dark";
  return (
    <div>
      <p className={labelClassName(surfaceTheme)}>{title}</p>
      <pre
        className={cn(
          "mt-2 max-h-40 overflow-auto rounded-[14px] border p-3 text-xs",
          cardToneIsDark
            ? "border-white/[0.08] bg-[#0d1624]/92 text-slate-200"
            : "border-border bg-muted/55 text-foreground"
        )}
      >
        {value || "No output"}
      </pre>
    </div>
  );
}

function CapabilityMatrixPanel({
  rows,
  summary,
  surfaceTheme
}: {
  rows: OpenClawCapabilityMatrixRow[];
  summary: OpenClawCapabilityMatrixSummary;
  surfaceTheme: SurfaceTheme;
}) {
  const rowsByStatus = {
    native: rows.filter((row) => row.status === "gateway-native"),
    fallback: rows.filter((row) => row.status === "cli-fallback" || row.fallbackCount > 0),
    missing: rows.filter((row) => row.status === "missing" || row.missingRequiredMethods.length > 0),
    degraded: rows.filter((row) => row.status === "degraded" || row.status === "unknown"),
    disabled: rows.filter((row) => row.status === "disabled")
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="OpenClaw"
          value={summary.openClawVersionLabel}
          badge={`Recommended ${summary.recommendedVersionLabel}`}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="AgentOS compatibility"
          value={summary.agentOsCompatibilityLabel}
          badge={summary.gatewayProtocolLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Native operations"
          value={`${summary.nativeOperationCount}/${summary.totalOperationCount}`}
          badge={summary.cliFallbackOperationCount > 0 ? `${summary.cliFallbackOperationCount} fallback` : "No fallback"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Required gaps"
          value={String(summary.missingRequiredOperationCount)}
          badge={summary.unknownOrDegradedOperationCount > 0 ? `${summary.unknownOrDegradedOperationCount} unknown/degraded` : "Clear"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="CLI fallback calls"
          value={String(summary.fallbackTotal)}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Disabled operations"
          value={String(summary.disabledOperationCount)}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last native failure"
          value={summary.lastNativeFailure || "None"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <InfoRows
        surfaceTheme={surfaceTheme}
        rows={[
          ["Native", `${rowsByStatus.native.length} operations`],
          ["CLI fallback", `${rowsByStatus.fallback.length} operations`],
          ["Missing required/native", `${rowsByStatus.missing.length} operations`],
          ["Unknown/degraded", `${rowsByStatus.degraded.length} operations`],
          ["Disabled", `${rowsByStatus.disabled.length} operations`]
        ]}
      />

      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <details
              key={row.id}
              className={cn(
                "group rounded-[18px] border",
                surfaceTheme === "light"
                  ? "border-border bg-card"
                  : "border-white/[0.08] bg-[#101a2a]/92"
              )}
            >
              <summary className="grid cursor-pointer list-none gap-3 px-3.5 py-3 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={transportTonePillClassName(row.tone, surfaceTheme)}>
                      {row.statusLabel}
                    </span>
                    <span className={baselinePillClassName(row.baseline, surfaceTheme)}>
                      {formatCapabilityBaseline(row.baseline)}
                    </span>
                  </div>
                  <p className={cn("mt-2 truncate text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                    {row.label}
                  </p>
                  <code className={cn("mt-1 block truncate text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                    {row.id}
                  </code>
                </div>
                <div className="min-w-0">
                  <p className={labelClassName(surfaceTheme)}>Native coverage</p>
                  <p className={cn("mt-1 truncate text-xs", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
                    {row.methodCoverageLabel}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className={labelClassName(surfaceTheme)}>CLI fallback</p>
                  <p className={cn("mt-1 truncate text-xs", row.fallbackCount > 0 ? surfaceTheme === "light" ? "text-amber-700" : "text-amber-200" : mutedTextClassName(surfaceTheme))}>
                    {row.fallbackAllowed ? `${row.fallbackCount} calls` : "Not allowed"}
                  </p>
                </div>
                <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
              </summary>
              <div className={cn("border-t p-3.5", surfaceTheme === "light" ? "border-border" : "border-white/[0.08]")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CapabilityDetail label="Preferred method" value={row.preferredMethod || "Unknown"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Supported method" value={row.supportedMethod || "Unknown"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Alias methods" value={row.aliasMethods.length ? row.aliasMethods.join(", ") : "None"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Gateway events" value={row.events.length ? row.events.join(", ") : "None"} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Compatibility" value={formatCapabilityCompatibility(row.compatibility)} surfaceTheme={surfaceTheme} />
                  <CapabilityDetail label="Fallback issue" value={row.fallbackIssue || "None"} surfaceTheme={surfaceTheme} />
                </div>

                {row.missingMethods.length > 0 ? (
                  <div className={cn("mt-3 rounded-[16px] border p-3 text-xs leading-5", surfaceTheme === "light" ? "border-red-200 bg-red-50 text-red-800" : "border-rose-300/20 bg-rose-300/10 text-rose-100")}>
                    Missing methods: {row.missingMethods.join(", ")}
                    {row.missingRequiredMethods.length > 0 ? ` / Required: ${row.missingRequiredMethods.join(", ")}` : ""}
                  </div>
                ) : null}

                <div className="mt-3 grid gap-2">
                  <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                    Reason: {row.reason}
                  </p>
                  <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                    Recovery: {row.recovery || row.fallbackRecovery || "No recovery suggestion reported."}
                  </p>
                  {row.fallbackKind ? (
                    <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-500")}>
                      Last fallback kind: {formatGatewayFallbackDiagnosticKind(row.fallbackKind)}
                    </p>
                  ) : null}
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No OpenClaw capability matrix"
          detail="AgentOS has not received Gateway capability diagnostics yet. Start or repair the OpenClaw Gateway, then refresh diagnostics."
          surfaceTheme={surfaceTheme}
        />
      )}
    </div>
  );
}

function CapabilityDetail({
  label,
  value,
  surfaceTheme
}: {
  label: string;
  value: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[16px] border p-3", insetPanelClassName(surfaceTheme))}>
      <p className={labelClassName(surfaceTheme)}>{label}</p>
      <p className={cn("mt-1.5 break-words text-xs leading-5", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
        {value}
      </p>
    </div>
  );
}

function CompatibilityPanel({
  compatibilityReport,
  report,
  snapshot,
  capabilityMatrix,
  transportSummary,
  nativeAuthLabel,
  error,
  isRunning,
  onRun,
  surfaceTheme
}: {
  compatibilityReport: CompatibilityReport | null | undefined;
  report: CompatibilitySmokeReport | null;
  snapshot: MissionControlShellSettingsPanelProps["snapshot"];
  capabilityMatrix: MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["capabilityMatrix"];
  transportSummary: TransportDiagnosticsSummary;
  nativeAuthLabel: string;
  error: string | null;
  isRunning: boolean;
  onRun: () => void;
  surfaceTheme: SurfaceTheme;
}) {
  const compatibility = report?.compatibility;
  const reportStatus = compatibilityReport?.status;
  const protocolRange = compatibility
    ? `v${compatibility.agentOsSupportedProtocolRange.min}-v${compatibility.agentOsSupportedProtocolRange.max}`
    : compatibilityReport
      ? `v${compatibilityReport.gateway.protocolRange.min}-v${compatibilityReport.gateway.protocolRange.max}`
      : transportSummary.protocolRangeLabel;
  const fallbackReason =
    compatibility?.lastFallbackReason ||
    compatibilityReport?.fallback.diagnostics[0]?.issue ||
    snapshot.diagnostics.gatewayFallbackDiagnostics?.[0]?.issue ||
    "None";
  const lastNativeError = compatibility?.lastNativeError || transportSummary.lastNativeError || "None";
  const recovery =
    compatibilityReport?.recovery ||
    report?.recovery ||
    transportSummary.recovery ||
    snapshot.diagnostics.issues[0] ||
    "OpenClaw compatibility is not available yet.";
  const statusLabel = reportStatus
    ? formatCompatibilityReportStatus(reportStatus)
    : report
      ? formatCompatibilitySmokeStatus(report.status)
      : "Unknown";
  const statusTone = reportStatus ? compatibilityReportStatusTone(reportStatus) : report ? compatibilitySmokeStatusTone(report.status) : "neutral";
  const safeLabel = report
    ? report.safeToDispatchMissions
      ? "Safe to dispatch"
      : "Do not dispatch"
    : compatibilityReport
      ? compatibilityReport.status === "compatible"
        ? "Compatible"
        : compatibilityReport.status === "degraded"
          ? "Degraded"
          : "Incompatible"
      : "Not tested";
  const reportIssues = compatibilityReport
    ? [
      ...compatibilityReport.summary.failedSurfaces,
      ...compatibilityReport.summary.unsupportedSurfaces,
      ...compatibilityReport.summary.degradedSurfaces
    ]
    : [];
  const visibleContractIssues = compatibilityReport?.contracts
    .filter((check) => check.status !== "ok")
    .slice(0, 5) ?? [];

  return (
    <div className={cn("mt-4 rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={labelClassName(surfaceTheme)}>Compatibility</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
              {statusLabel}
            </p>
            <span className={transportTonePillClassName(statusTone, surfaceTheme)}>{safeLabel}</span>
          </div>
          <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            Report: {compatibilityReport ? formatTimestamp(compatibilityReport.generatedAt) : "Not available"}
            {report ? ` / Smoke: ${formatTimestamp(report.checkedAt)}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={onRun}
          disabled={isRunning}
          className={secondaryButtonClassName(surfaceTheme, "px-4")}
        >
          {isRunning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          {isRunning ? "Running..." : "Run OpenClaw Smoke Test"}
        </Button>
      </div>

      <div className="mt-3">
        <InfoRows
          surfaceTheme={surfaceTheme}
          rows={[
            ["Installed OpenClaw", formatVersionValue(compatibilityReport?.openClaw.installedVersion ?? compatibility?.installedVersion ?? snapshot.diagnostics.version ?? null)],
            ["Required OpenClaw", formatVersionValue(compatibility?.requiredOpenClawVersion ?? compatibilityReport?.openClaw.supportedBaselineVersion ?? null)],
            ["Recommended OpenClaw", formatVersionValue(compatibilityReport?.openClaw.recommendedVersion ?? compatibility?.recommendedOpenClawVersion ?? snapshot.diagnostics.latestVersion ?? null)],
            ["Gateway protocol status", compatibilityReport ? formatGatewayProtocolReport(compatibilityReport) : compatibility?.gatewayProtocolVersion ? `v${compatibility.gatewayProtocolVersion}` : capabilityMatrix?.gatewayProtocolVersion ? `v${capabilityMatrix.gatewayProtocolVersion}` : transportSummary.protocolLabel],
            ["AgentOS protocol range", protocolRange],
            ["Native Gateway coverage", compatibilityReport ? `${compatibilityReport.summary.nativeGatewayCoveragePercent}% (${compatibilityReport.summary.nativeGatewayCoverageLabel})` : "Unknown"],
            ["CLI fallback operation count", compatibilityReport ? String(compatibilityReport.summary.cliFallbackOperationCount) : "Unknown"],
            ["Unsupported/degraded integrations", compatibilityReport ? (reportIssues.length > 0 ? formatShortList(reportIssues, 3) : "None") : "Unknown"],
            ["Node.js", compatibility?.nodeVersion ? `${compatibility.nodeVersion} / ${formatNodeStatus(compatibility.nodeStatus)}` : "Run smoke test"],
            ["Gateway auth", compatibility?.gatewayAuthStatus || nativeAuthLabel],
            ["Native Gateway", compatibilityReport ? `${compatibilityReport.gateway.health} / ${compatibilityReport.gateway.capabilitySource}` : compatibility?.nativeGatewayStatus || transportSummary.statusLabel],
            ["CLI fallback count", String(compatibility?.cliFallbackUsageCount ?? transportSummary.fallbackTotal)],
            ["Last native error", lastNativeError],
            ["Last fallback reason", fallbackReason]
          ]}
        />
      </div>

      <div
        className={cn(
          "mt-3 rounded-[16px] border p-3 text-xs leading-5",
          surfaceTheme === "light"
            ? "border-border bg-muted/45 text-foreground"
            : "border-white/[0.08] bg-[#0d1624] text-slate-300"
        )}
      >
        <p className={labelClassName(surfaceTheme)}>Recovery suggestion</p>
        <p className="mt-1.5">{recovery}</p>
        {error ? (
          <p className={cn("mt-1.5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>
            {error}
          </p>
        ) : null}
      </div>

      {visibleContractIssues.length > 0 ? (
        <div className="mt-3 space-y-2">
          {visibleContractIssues.map((check) => (
            <div
              key={check.operation}
              className={cn(
                "rounded-[16px] border p-3",
                surfaceTheme === "light"
                  ? "border-border bg-card"
                  : "border-white/[0.08] bg-[#101a2a]/92"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={transportTonePillClassName(contractStatusTone(check.status), surfaceTheme)}>
                  {formatContractStatus(check.status)}
                </span>
                <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                  {check.label}
                </p>
              </div>
              <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                {check.reason}
              </p>
              <p className={cn("mt-1 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                Recovery: {check.suggestedRecovery}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {report?.checks.length ? (
        <div className="mt-3 space-y-2">
          {report.checks.map((check) => (
            <details
              key={check.id}
              className={cn(
                "group rounded-[16px] border",
                surfaceTheme === "light"
                  ? "border-border bg-card"
                  : "border-white/[0.08] bg-[#101a2a]/92"
              )}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5">
                <span className={transportTonePillClassName(smokeCheckTone(check.status), surfaceTheme)}>
                  {formatSmokeCheckStatus(check.status)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                    {check.label}
                  </p>
                  <p className={cn("mt-0.5 truncate text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                    {check.summary}
                  </p>
                </div>
                <span className={cn("hidden text-xs sm:inline", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
                  {check.durationMs} ms
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform group-open:rotate-180", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} />
              </summary>
              <div
                className={cn(
                  "border-t p-3.5",
                  surfaceTheme === "light" ? "border-border" : "border-white/[0.08]"
                )}
              >
                {check.recovery ? (
                  <p className={cn("mb-3 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
                    Recovery: {check.recovery}
                  </p>
                ) : null}
                <DiagnosticBlock
                  title="raw details"
                  value={formatRawDetails(check.rawDetails)}
                  surfaceTheme={surfaceTheme}
                />
              </div>
            </details>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No compatibility smoke report"
          detail="Run the smoke test to verify OpenClaw binary, Gateway, models, sessions, tasks, config, events, and fallback behavior."
          surfaceTheme={surfaceTheme}
        />
      )}
    </div>
  );
}

function TransportDiagnosticsPanel({
  summary,
  surfaceTheme
}: {
  summary: TransportDiagnosticsSummary;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div className={cn("rounded-[18px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={labelClassName(surfaceTheme)}>Gateway Transport</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
              {summary.statusLabel}
            </p>
            <span className={transportTonePillClassName(summary.statusTone, surfaceTheme)}>
              {summary.gatewayModeLabel}
            </span>
          </div>
          <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            {summary.connectionLabel} / {summary.modeLabel}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className={labelClassName(surfaceTheme)}>Snapshot stream</p>
          <p className={cn("mt-1.5 text-sm", surfaceTheme === "light" ? "text-foreground" : "text-slate-200")}>
            {summary.streamLabel}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Metric
          label="Protocol support"
          value={summary.protocolRangeLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Connected protocol"
          value={summary.protocolLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="CLI fallback used"
          value={String(summary.fallbackTotal)}
          badge={summary.fallbackTotal > 0 ? "Used" : "Clean"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last connected"
          value={summary.lastConnectedLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Last disconnected"
          value={summary.lastDisconnectedLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Fallback summary"
          value={summary.fallbackSummaryLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Gateway event stream"
          value={summary.eventBridgeLabel}
          badge={summary.eventBridgeTone === "success" ? "Live" : summary.eventBridgeTone === "warning" ? "Degraded" : "Unknown"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Last Gateway event"
          value={summary.eventBridgeLastEventLabel}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      {summary.lastNativeError ? (
        <div className="mt-3">
          <DiagnosticBlock title="Last native error" value={summary.lastNativeError} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}
      {summary.eventBridgeLastError ? (
        <div className="mt-3">
          <DiagnosticBlock title="Last event stream error" value={summary.eventBridgeLastError} surfaceTheme={surfaceTheme} />
        </div>
      ) : null}
      {summary.recovery ? (
        <p className={cn("mt-3 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
          Recovery: {summary.recovery}
        </p>
      ) : null}
      {summary.eventBridgeRecovery ? (
        <p className={cn("mt-2 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
          Event stream recovery: {summary.eventBridgeRecovery}
        </p>
      ) : null}
    </div>
  );
}

function transportTonePillClassName(tone: TransportStatusTone, surfaceTheme: SurfaceTheme) {
  const base = "inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]";

  if (tone === "success") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
    );
  }

  if (tone === "danger") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-rose-300/20 bg-rose-300/10 text-rose-100"
    );
  }

  if (tone === "warning") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-amber-300/20 bg-amber-300/10 text-amber-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground"
      : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
  );
}

function baselinePillClassName(
  baseline: OpenClawCapabilityMatrixRow["baseline"],
  surfaceTheme: SurfaceTheme
) {
  const base = "inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[9px] uppercase tracking-[0.12em]";

  if (baseline === "required") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-sky-300/20 bg-sky-300/10 text-sky-100"
    );
  }

  if (baseline === "experimental") {
    return cn(
      base,
      surfaceTheme === "light"
        ? "border-violet-200 bg-violet-50 text-violet-700"
        : "border-violet-300/20 bg-violet-300/10 text-violet-100"
    );
  }

  return cn(
    base,
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground"
      : "border-white/[0.08] bg-[#101a2a]/92 text-slate-300"
  );
}

function formatCapabilityBaseline(value: OpenClawCapabilityMatrixRow["baseline"]) {
  switch (value) {
    case "required":
      return "Required";
    case "optional":
      return "Optional";
    case "experimental":
      return "Experimental";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatCapabilityCompatibility(value: OpenClawCapabilityMatrixRow["compatibility"]) {
  switch (value) {
    case "preferred":
      return "Preferred native method";
    case "alias":
      return "Compatible alias";
    case "missing":
      return "Missing native method";
    case "unknown":
    default:
      return "Unknown";
  }
}

function EmptyState({
  title,
  detail,
  surfaceTheme
}: {
  title: string;
  detail: string;
  surfaceTheme: SurfaceTheme;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-dashed p-4 text-center",
        surfaceTheme === "light"
          ? "border-border bg-muted/45"
          : "border-white/[0.08] bg-[#0d1624]/60"
      )}
    >
      <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
        {title}
      </p>
      <p className={cn("mt-1 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{detail}</p>
    </div>
  );
}

function UpdateRegistryPanel({
  surfaceTheme,
  isCheckingForUpdates,
  isUpdateRegistryLoading,
  hasUpdateAvailable,
  currentVersion,
  latestVersion,
  updateInfo,
  updateError,
  lastCheckedAt,
  isUpdateRunning,
  updateCompatibility,
  onTryPreviewVersion
}: {
  surfaceTheme: SurfaceTheme;
  isCheckingForUpdates: boolean;
  isUpdateRegistryLoading: boolean;
  hasUpdateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateInfo: string | null;
  updateError: string | null;
  lastCheckedAt: number | null;
  isUpdateRunning: boolean;
  updateCompatibility: MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["updateCompatibility"];
  onTryPreviewVersion: (version: string) => void;
}) {
  const isBusy = isCheckingForUpdates || isUpdateRunning;
  const statusLabel = isCheckingForUpdates
    ? "Checking registry"
    : isUpdateRunning
      ? "Updating"
      : hasUpdateAvailable
        ? "Recommended update"
        : updateError
          ? "Check failed"
          : isUpdateRegistryLoading
            ? "Registry loading"
            : "Up to date";
  const statusToneClass = hasUpdateAvailable
    ? surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
    : updateError
      ? surfaceTheme === "light"
        ? "border-rose-300 bg-rose-50 text-rose-700"
        : "border-rose-300/20 bg-rose-300/10 text-rose-100"
      : isBusy || isUpdateRegistryLoading
        ? surfaceTheme === "light"
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : surfaceTheme === "light"
          ? "border-slate-300 bg-white text-slate-600"
          : "border-white/10 bg-[#0f1826] text-slate-300";

  const detailLabel = isCheckingForUpdates
    ? "Refreshing OpenClaw update registry..."
    : isUpdateRunning
      ? "Installing the selected OpenClaw update."
      : hasUpdateAvailable
        ? "The certified recommended OpenClaw release is ready to install."
        : updateError
          ? "OpenClaw returned an error while checking updates."
          : isUpdateRegistryLoading
            ? "OpenClaw has not reported a latest release yet."
            : "No newer release is currently available.";

  return (
    <div className={cn("mt-3 rounded-[20px] border p-3.5", insetPanelClassName(surfaceTheme))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Update status</p>
          <div className="mt-1 flex items-center gap-2">
            {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-400" /> : null}
            <p className={cn("font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{statusLabel}</p>
            <span className={cn("rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]", statusToneClass)}>
              {hasUpdateAvailable ? "Ready" : isBusy ? "Working" : updateError ? "Attention" : "Stable"}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Last checked</p>
          <p className={cn("mt-1 text-[11px]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")}>
            {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Not yet"}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            isBusy
              ? "w-1/2 animate-pulse bg-emerald-400/80"
              : hasUpdateAvailable
                ? "w-full bg-emerald-500"
                : updateError
                  ? "w-2/3 bg-rose-400"
                  : "w-5/6 bg-slate-400/70"
          )}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Metric
          label="Current version"
          value={`v${currentVersion}`}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
        <Metric
          label="Recommended"
          value={latestVersion ? `v${latestVersion}` : "Unknown"}
          badge={hasUpdateAvailable ? "Ready" : updateError ? "Error" : isBusy || isUpdateRegistryLoading ? "Loading" : "Stable"}
          surfaceTheme={surfaceTheme}
          dark={surfaceTheme === "dark"}
          compact
        />
      </div>

      <div
        className={cn(
          "mt-3 rounded-[18px] border p-3 text-[11px] leading-5",
          surfaceTheme === "light"
            ? "border-border bg-card text-foreground"
            : "border-white/[0.08] bg-[#0d1624] text-slate-300"
        )}
      >
        <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>Details</p>
        <p className="mt-1.5">{detailLabel}</p>
        {updateInfo ? <p className="mt-1.5 opacity-90">{updateInfo}</p> : null}
        {updateCompatibility ? (
          <p className="mt-1.5 opacity-90">
            Manifest source: {formatManifestSource(updateCompatibility.manifestSource)}. Recommended status:{" "}
            {formatUpdateCompatibilityStatus(updateCompatibility.recommendedDecision.status)}.
          </p>
        ) : null}
        {updateError ? (
          <p className={cn("mt-1.5", surfaceTheme === "light" ? "text-rose-700" : "text-rose-200")}>{updateError}</p>
        ) : null}
        {hasUpdateAvailable ? (
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
            <span className={cn("rounded-full border px-2 py-1", statusToneClass)}>Update ready</span>
            <span className={cn("rounded-full border px-2 py-1", mutedTextClassName(surfaceTheme))}>
              Review before install
            </span>
          </div>
        ) : null}
      </div>

      {updateCompatibility ? (
        <div className="mt-3 grid gap-2">
          <CompatibilityVersionRows
            label="Certified"
            versions={updateCompatibility.certifiedVersions}
            surfaceTheme={surfaceTheme}
          />
          <CompatibilityVersionRows
            label="Preview"
            versions={updateCompatibility.candidateVersions}
            surfaceTheme={surfaceTheme}
            actionLabel="Try preview version"
            onAction={onTryPreviewVersion}
            disabled={isBusy}
          />
          <CompatibilityVersionRows
            label="Blocked"
            versions={updateCompatibility.blockedVersions}
            surfaceTheme={surfaceTheme}
            blocked
          />
        </div>
      ) : null}
    </div>
  );
}

function CompatibilityVersionRows({
  label,
  versions,
  surfaceTheme,
  actionLabel,
  onAction,
  disabled = false,
  blocked = false
}: {
  label: string;
  versions: NonNullable<MissionControlShellSettingsPanelProps["snapshot"]["diagnostics"]["updateCompatibility"]>["certifiedVersions"];
  surfaceTheme: SurfaceTheme;
  actionLabel?: string;
  onAction?: (version: string) => void;
  disabled?: boolean;
  blocked?: boolean;
}) {
  if (versions.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-[16px] border p-3", insetPanelClassName(surfaceTheme))}>
      <p className={cn("text-[10px] uppercase tracking-[0.18em]", mutedTextClassName(surfaceTheme))}>{label}</p>
      <div className="mt-2 grid gap-2">
        {versions.map((entry) => (
          <div key={`${label}:${entry.version}`} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className={cn("font-mono text-[11px]", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>
                v{entry.version}
              </p>
              <p className={cn("mt-0.5 text-[11px] leading-4", blocked ? "text-rose-300" : mutedTextClassName(surfaceTheme))}>
                {entry.reason || entry.notes || formatUpdateCompatibilityStatus(entry.status)}
              </p>
            </div>
            {actionLabel && onAction ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onAction(entry.version)}
                disabled={disabled}
                className={secondaryButtonClassName(surfaceTheme, "px-3")}
              >
                {actionLabel}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

async function fetchGatewayAuthStatus() {
  const response = await fetch("/api/settings/gateway", {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || "Unable to check Gateway auth status.");
  }

  const result = (await response.json()) as { authStatus: GatewayNativeAuthStatus };
  return result.authStatus;
}

function resolveGatewayLocality(snapshot: MissionControlShellSettingsPanelProps["snapshot"]) {
  return snapshot.diagnostics.bindMode === "remote" || snapshot.diagnostics.configuredGatewayUrl
    ? "Remote"
    : "Local";
}

function formatCapabilitySupport(value?: "supported" | "unsupported" | "unknown") {
  if (value === "supported") {
    return "Supported";
  }

  if (value === "unsupported") {
    return "Fallback";
  }

  return "Unknown";
}

function formatCompatibilitySmokeStatus(value: CompatibilitySmokeReport["status"]) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatCompatibilityReportStatus(value: CompatibilityReport["status"]) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatUpdateCompatibilityStatus(value: string) {
  switch (value) {
    case "certified":
      return "Certified";
    case "candidate":
      return "Preview";
    case "blocked":
      return "Blocked";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatManifestSource(value: string) {
  switch (value) {
    case "local-fallback":
      return "Local fallback";
    case "remote":
      return "Remote";
    case "override":
      return "Override";
    default:
      return value;
  }
}

function compatibilitySmokeStatusTone(value: CompatibilitySmokeReport["status"]): TransportStatusTone {
  switch (value) {
    case "compatible":
      return "success";
    case "degraded":
      return "warning";
    case "incompatible":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function compatibilityReportStatusTone(value: CompatibilityReport["status"]): TransportStatusTone {
  switch (value) {
    case "compatible":
      return "success";
    case "degraded":
      return "warning";
    case "incompatible":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function formatContractStatus(value: CompatibilityReport["contracts"][number]["status"]) {
  switch (value) {
    case "ok":
      return "OK";
    case "degraded":
      return "Degraded";
    case "unsupported":
      return "Unsupported";
    case "failed":
      return "Failed";
  }
}

function contractStatusTone(value: CompatibilityReport["contracts"][number]["status"]): TransportStatusTone {
  switch (value) {
    case "ok":
      return "success";
    case "degraded":
      return "warning";
    case "unsupported":
    case "failed":
      return "danger";
  }
}

function formatSmokeCheckStatus(value: CompatibilitySmokeReport["checks"][number]["status"]) {
  switch (value) {
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Fail";
    default:
      return "Unknown";
  }
}

function smokeCheckTone(value: CompatibilitySmokeReport["checks"][number]["status"]): TransportStatusTone {
  switch (value) {
    case "pass":
      return "success";
    case "warning":
      return "warning";
    case "fail":
      return "danger";
    default:
      return "neutral";
  }
}

function formatNodeStatus(value: CompatibilitySmokeReport["compatibility"]["nodeStatus"]) {
  switch (value) {
    case "supported":
      return "Supported";
    case "unsupported":
      return "Unsupported";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatVersionValue(value: string | null | undefined) {
  return value ? `v${value.replace(/^v/i, "")}` : "Unknown";
}

function formatGatewayProtocolReport(report: CompatibilityReport) {
  const version = report.gateway.protocolVersion ? `v${report.gateway.protocolVersion}` : "unknown";
  return `${version} / ${report.gateway.protocolStatus}`;
}

function formatCompatibilityReportIssues(report: CompatibilityReport) {
  const values = [
    ...report.summary.failedSurfaces,
    ...report.summary.unsupportedSurfaces,
    ...report.summary.degradedSurfaces
  ];

  return values.length > 0 ? formatShortList(values, 3) : "None";
}

function formatShortList(values: string[], maxVisible: number) {
  const unique = Array.from(new Set(values));
  const visible = unique.slice(0, maxVisible);
  const suffix = unique.length > visible.length ? ` +${unique.length - visible.length}` : "";

  return `${visible.join(", ")}${suffix}`;
}

function formatRawDetails(value: unknown) {
  if (value === undefined || value === null) {
    return "No raw details";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatGatewayCompatibilityStatus(
  value?: GatewayCompatibilityProfile
) {
  switch (value?.protocol.status) {
    case "compatible":
      return "Compatible";
    case "unsupported":
      return "Unsupported";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatGatewayOperationCounts(value?: GatewayCompatibilityProfile) {
  if (!value) {
    return "Unknown";
  }

  return `${value.nativeOperationCount} native / ${value.degradedOperationCount} limited`;
}

function formatGatewayMethodContractStatus(value?: GatewayMethodContractAudit) {
  if (!value) {
    return "Unknown";
  }

  const source = formatGatewayMethodContractSource(value.source);

  switch (value.status) {
    case "advertised":
      return `Advertised via ${source}`;
    case "verified":
      return `Verified via ${source}`;
    case "drift":
      return `Drift via ${source}`;
    case "unknown":
    default:
      return `Unknown via ${source}`;
  }
}

function formatGatewayMethodContractGaps(
  value?: GatewayMethodContractAudit,
  operations?: GatewayCapabilityOperations
) {
  if (!value) {
    return "Unknown";
  }

  if (value.status === "advertised" || value.status === "verified") {
    return "None";
  }

  if (value.status === "unknown") {
    return value.reason;
  }

  if (value.missingOperations.length > 0) {
    return formatGatewayOperationList(value.missingOperations, operations);
  }

  return `${value.missingMethodCount} methods`;
}

function formatGatewayMethodContractSource(source: GatewayMethodContractAudit["source"]) {
  switch (source) {
    case "gateway-handshake":
      return "handshake";
    case "disabled":
      return "disabled";
    case "unavailable":
      return "unavailable";
    default:
      return source;
  }
}

function formatGatewayAliasOperations(value?: string[], operations?: GatewayCapabilityOperations) {
  if (!value) {
    return "Unknown";
  }

  return value.length > 0 ? formatGatewayOperationList(value, operations) : "None";
}

function formatGatewayDegradedOperations(value?: string[], operations?: GatewayCapabilityOperations) {
  if (!value) {
    return "Unknown";
  }

  return value.length > 0 ? formatGatewayOperationList(value, operations) : "None";
}

function formatGatewayOperationList(value: string[], operations?: GatewayCapabilityOperations) {
  const visible = value.slice(0, 3).map((entry) => formatGatewayOperationEntry(entry, operations));
  const suffix = value.length > visible.length ? ` +${value.length - visible.length}` : "";

  return `${value.length}: ${visible.join(", ")}${suffix}`;
}

function formatGatewayOperationEntry(entry: string, operations?: GatewayCapabilityOperations) {
  const [operationId, detail] = entry.split(/:\s*/, 2);
  const operation = operations?.[operationId];
  const label = operation?.label ?? titleizeGatewayOperationId(operationId || entry);

  if (!detail && operation?.recovery && operation.mode !== "gateway-native") {
    return `${label}: ${operation.recovery}`;
  }

  return detail ? `${label} via ${detail}` : label;
}

function titleizeGatewayOperationId(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Gateway operation";
}

function formatGatewayAuthIssue(kind: GatewayNativeAuthStatus["native"]["kind"]) {
  switch (kind) {
    case "auth":
      return "Needs credential";
    case "scope-limited":
      return "Needs scope repair";
    case "rate-limited":
      return "Rate limited";
    case "disabled":
      return "Disabled";
    case "unreachable":
      return "Unreachable";
    case "timeout":
      return "Timed out";
    case "malformed-response":
      return "Invalid response";
    default:
      return "Check failed";
  }
}

function deriveProviderFromModel(modelId: string | null) {
  if (!modelId) {
    return null;
  }

  const [provider] = modelId.split("/");
  return provider || null;
}

function shortPath(value: string, maxLength: number) {
  const compacted = compactPath(value);
  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function formatConfigUpdatePacingMode(value: string) {
  switch (value) {
    case "fast-local-testing":
      return "Fast local testing";
    case "custom":
      return "Custom";
    case "respect-gateway":
    default:
      return "Respect Gateway cooldown";
  }
}

function formatConfigUpdatePacingInterval(valueMs: number | null | undefined) {
  if (!valueMs || valueMs <= 0) {
    return "Gateway cooldown only";
  }

  const seconds = Math.ceil(valueMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function copyToClipboard(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }

  void navigator.clipboard.writeText(value);
}

function scrollSettingsToTop() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

function resolveInitialSettingsSection(): SettingsSectionId {
  return "openclaw";
}

function resolveHashSettingsSection(): SettingsSectionId {
  if (typeof window === "undefined") {
    return resolveInitialSettingsSection();
  }

  switch (window.location.hash.replace(/^#/, "")) {
    case "gateway":
      return "gateway";
    case "capabilities":
      return "capabilities";
    case "models":
      return "models";
    case "workspace":
      return "workspace";
    case "agents":
      return "agents";
    case "diagnostics":
      return "diagnostics";
    case "advanced":
      return "advanced";
    case "danger-zone":
      return "danger-zone";
    case "openclaw":
    default:
      return "openclaw";
  }
}

function cardClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-card/92 text-card-foreground shadow-card"
    : "border-border bg-card/96 text-card-foreground shadow-[0_20px_54px_rgba(0,0,0,0.26)]";
}

function cardIconClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "flex h-10 w-10 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary"
    : "flex h-10 w-10 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary";
}

function labelClassName(surfaceTheme: SurfaceTheme) {
  return cn("text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400");
}

function inputClassName(surfaceTheme: SurfaceTheme, extraClassName?: string) {
  return cn(
    "h-10 rounded-[16px] px-3 text-sm outline-none",
    extraClassName,
    surfaceTheme === "light"
      ? "border-input bg-card text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/25"
      : "border-input bg-[#0f1826] text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
  );
}

function copyButtonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border",
    surfaceTheme === "light"
      ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function secondaryButtonClassName(surfaceTheme: SurfaceTheme, extraClassName?: string, mode?: "default" | "gateway-contrast") {
  return cn(
    "h-9 rounded-full px-3 text-xs",
    extraClassName,
    surfaceTheme === "light"
      ? "border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground"
      : mode === "gateway-contrast"
        ? "border-primary/15 bg-[#0f1826] text-foreground hover:bg-[#182538]"
        : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function segmentedButtonClassName(surfaceTheme: SurfaceTheme, active: boolean) {
  return cn(
    "h-9 rounded-full border px-3 text-xs transition-colors",
    active
      ? surfaceTheme === "light"
        ? "border-primary/35 bg-primary/10 text-primary"
        : "border-primary/30 bg-primary/12 text-primary"
      : surfaceTheme === "light"
        ? "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
        : "border-border bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}

function insetPanelClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-muted/45"
    : "border-border bg-[#101a2a]/92";
}

function mutedTextClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400";
}

function infoRowsShellClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-card"
    : "border-border bg-[#0f1826]";
}

function infoRowBorderClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light" ? "border-b border-border" : "border-b border-border";
}
