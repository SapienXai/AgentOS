"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  CircleHelp,
  Download,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles
} from "lucide-react";

import {
  KeyValue,
  OperationsPageLayout,
  PageHeader,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  ToolbarButton,
  type StatusTone
} from "@/components/operations/operations-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type {
  MissionControlSnapshot,
  OpenClawUpdateStreamEvent
} from "@/lib/agentos/contracts";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import { compareOpenClawReleases } from "@/lib/openclaw/release-comparison";
import type { OpenClawUpdateSafetyCheck, OpenClawUpdateSafetyReport } from "@/lib/openclaw/types";
import type {
  OpenClawStabilityRelease,
  OpenClawStabilitySnapshot,
  OpenClawStabilityUiStatus
} from "@/lib/openclaw/stability-types";
import { cn } from "@/lib/utils";

type UpdateRunState = "idle" | "running" | "success" | "error";

type UpdatesPageContentProps = {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
};

type StabilityResponse = {
  stability: OpenClawStabilitySnapshot;
};

const emptyReleases: OpenClawStabilityRelease[] = [];

export function UpdatesPageContent({
  rootSnapshot,
  refresh,
  setSnapshot
}: UpdatesPageContentProps) {
  const [stability, setStability] = useState<OpenClawStabilitySnapshot | null>(null);
  const [stabilityError, setStabilityError] = useState<string | null>(null);
  const [isLoadingStability, setIsLoadingStability] = useState(true);
  const [selectedRelease, setSelectedRelease] = useState<OpenClawStabilityRelease | null>(null);
  const [installTarget, setInstallTarget] = useState<OpenClawStabilityRelease | null>(null);
  const [updateRunState, setUpdateRunState] = useState<UpdateRunState>("idle");
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string | null>(null);
  const [updateResultMessage, setUpdateResultMessage] = useState<string | null>(null);
  const [updateLog, setUpdateLog] = useState("");
  const [preflightReport, setPreflightReport] = useState<OpenClawUpdateSafetyReport | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightTargetVersion, setPreflightTargetVersion] = useState<string | null>(null);
  const [isRunningPreflight, setIsRunningPreflight] = useState(false);
  const preflightRequestId = useRef(0);

  const installedVersion = normalizeVersion(rootSnapshot.diagnostics.version);
  const latestVersion = stability?.latestVersion ?? normalizeVersion(rootSnapshot.diagnostics.latestVersion);
  const recommendedVersion =
    stability?.recommendedVersion ?? normalizeVersion(rootSnapshot.diagnostics.updateCompatibility?.recommendedVersion);
  const releases = stability?.releases ?? emptyReleases;
  const installedRelease = useMemo(
    () => releases.find((release) => installedVersion && compareVersionStrings(release.version, installedVersion) === 0) ?? null,
    [installedVersion, releases]
  );
  const recommendedRelease = useMemo(
    () => releases.find((release) => recommendedVersion && compareVersionStrings(release.version, recommendedVersion) === 0) ?? null,
    [recommendedVersion, releases]
  );
  const visibleSelectedRelease = selectedRelease ?? recommendedRelease ?? releases[0] ?? null;
  const isUpdateRunning = updateRunState === "running";
  const releaseComparison = useMemo(() => compareOpenClawReleases({
    installedVersion,
    installedRelease,
    targetRelease: visibleSelectedRelease,
    releases
  }), [installedRelease, installedVersion, releases, visibleSelectedRelease]);
  const selectedPreflight = preflightTargetVersion === visibleSelectedRelease?.version ? preflightReport : null;

  const loadStability = useCallback(async () => {
    setIsLoadingStability(true);
    setStabilityError(null);

    try {
      const response = await fetch("/api/openclaw/updates", {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as Partial<StabilityResponse> & { error?: string } | null;

      if (!response.ok || !payload?.stability) {
        throw new Error(payload?.error || "OpenClaw stability data unavailable.");
      }

      setStability(payload.stability);
      if (payload.stability.source === "unavailable") {
        setStabilityError(payload.stability.error ?? "Stability data unavailable.");
      }
    } catch (error) {
      setStabilityError(error instanceof Error ? error.message : "OpenClaw stability data unavailable.");
    } finally {
      setIsLoadingStability(false);
    }
  }, []);

  useEffect(() => {
    void loadStability();
  }, [loadStability]);

  const runPreflight = useCallback(async (release: OpenClawStabilityRelease) => {
    const requestId = preflightRequestId.current + 1;
    preflightRequestId.current = requestId;
    setIsRunningPreflight(true);
    setPreflightError(null);
    setPreflightReport(null);
    setPreflightTargetVersion(release.version);

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify({
          action: "preflight",
          targetVersion: release.version,
          rollbackPolicy: "manual",
          mode: resolveUpdateMode(
            release.version,
            rootSnapshot.diagnostics.updateCompatibility?.recommendedVersion
          )
        })
      });
      const payload = (await response.json().catch(() => null)) as {
        report?: OpenClawUpdateSafetyReport;
        error?: string;
      } | null;

      if (!response.ok || !payload?.report) {
        throw new Error(payload?.error || "OpenClaw update preflight failed.");
      }

      if (preflightRequestId.current === requestId) {
        setPreflightReport(payload.report);
      }
    } catch (error) {
      if (preflightRequestId.current === requestId) {
        setPreflightError(error instanceof Error ? error.message : "Unable to run OpenClaw update preflight.");
      }
    } finally {
      if (preflightRequestId.current === requestId) {
        setIsRunningPreflight(false);
      }
    }
  }, [rootSnapshot.diagnostics.updateCompatibility?.recommendedVersion]);

  useEffect(() => {
    if (!visibleSelectedRelease || isUpdateRunning) {
      return;
    }

    if (preflightTargetVersion === visibleSelectedRelease.version && (isRunningPreflight || preflightReport || preflightError)) {
      return;
    }

    void runPreflight(visibleSelectedRelease);
  }, [
    isRunningPreflight,
    isUpdateRunning,
    preflightError,
    preflightReport,
    preflightTargetVersion,
    runPreflight,
    visibleSelectedRelease
  ]);

  const appendUpdateLog = useCallback((text: string) => {
    setUpdateLog((current) => `${current}${text}`);
  }, []);

  const runInstall = useCallback(async (release: OpenClawStabilityRelease) => {
    if (updateRunState === "running") {
      return;
    }

    if (preflightTargetVersion !== release.version || !preflightReport?.canAttemptUpdate) {
      toast.error("Update is not ready.", {
        description: "Run preflight and resolve every blocker before installing."
      });
      return;
    }

    setInstallTarget(null);
    setSelectedRelease(release);
    setUpdateRunState("running");
    setUpdateStatusMessage(`Installing OpenClaw v${release.version}...`);
    setUpdateResultMessage(null);
    setUpdateLog("");

    const toastId = toast.loading("Installing OpenClaw...", {
      description: `Target v${release.version}`,
      duration: Infinity
    });

    try {
      const response = await fetch("/api/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "update",
          confirmed: true,
          targetVersion: release.version,
          mode: resolveUpdateMode(
            release.version,
            rootSnapshot.diagnostics.updateCompatibility?.recommendedVersion
          )
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "OpenClaw install request failed.");
      }

      if (!response.body) {
        throw new Error("OpenClaw install did not return a readable stream.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as OpenClawUpdateStreamEvent;

          if (event.type === "status") {
            setUpdateStatusMessage(event.message);
            appendUpdateLog(`\n> ${event.message}\n`);
            toast.loading("Installing OpenClaw...", {
              id: toastId,
              description: event.message,
              duration: Infinity
            });
          } else if (event.type === "log") {
            appendUpdateLog(event.text);
          } else {
            sawDone = true;
            setUpdateStatusMessage(null);
            setUpdateResultMessage(event.message);
            setUpdateRunState(event.ok ? "success" : "error");
            appendUpdateLog(`\n> ${event.message}\n`);

            if (event.snapshot) {
              setSnapshot(event.snapshot);
            }

            if (event.ok) {
              toast.success("OpenClaw installed.", {
                id: toastId,
                description: event.message
              });
              void loadStability();
            } else {
              toast.error("OpenClaw install failed.", {
                id: toastId,
                description: event.message
              });
            }
          }
        }
      }

      const trailing = buffer.trim();

      if (trailing) {
        const event = JSON.parse(trailing) as OpenClawUpdateStreamEvent;

        if (event.type === "done") {
          sawDone = true;
          setUpdateStatusMessage(null);
          setUpdateResultMessage(event.message);
          setUpdateRunState(event.ok ? "success" : "error");
          appendUpdateLog(`\n> ${event.message}\n`);

          if (event.snapshot) {
            setSnapshot(event.snapshot);
          }

          if (event.ok) {
            toast.success("OpenClaw installed.", {
              id: toastId,
              description: event.message
            });
            void loadStability();
          } else {
            toast.error("OpenClaw install failed.", {
              id: toastId,
              description: event.message
            });
          }
        }
      }

      if (!sawDone) {
        throw new Error("OpenClaw install stream ended unexpectedly.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw install failed.";
      setUpdateRunState("error");
      setUpdateStatusMessage(null);
      setUpdateResultMessage(message);
      appendUpdateLog(`\n> ${message}\n`);
      toast.error("OpenClaw install failed.", {
        id: toastId,
        description: message
      });
    }
  }, [
    appendUpdateLog,
    loadStability,
    preflightReport,
    preflightTargetVersion,
    rootSnapshot.diagnostics.updateCompatibility?.recommendedVersion,
    setSnapshot,
    updateRunState
  ]);

  const requestInstall = (release: OpenClawStabilityRelease) => {
    const reportMatches = preflightTargetVersion === release.version && preflightReport?.canAttemptUpdate;

    if (!reportMatches) {
      setSelectedRelease(release);
      void runPreflight(release);
      return;
    }

    setInstallTarget(release);
  };

  const refreshAll = async () => {
    preflightRequestId.current += 1;
    setPreflightReport(null);
    setPreflightError(null);
    setPreflightTargetVersion(null);
    setIsRunningPreflight(false);
    await Promise.all([
      loadStability(),
      refresh()
    ]);
  };

  return (
    <>
      <PageHeader
        title="OpenClaw Updates"
        subtitle="Choose a version to install based on release confidence."
        actions={(
          <>
            <ToolbarButton
              icon={RefreshCw}
              label={isLoadingStability ? "Refreshing" : "Refresh"}
              onClick={() => void refreshAll()}
              disabled={isLoadingStability || isUpdateRunning}
            />
          </>
        )}
      />

      <OperationsPageLayout
        main={(
          <>
            <StatGrid columns={4}>
              <StatCard
                icon={PackageCheck}
                label="Installed"
                value={installedVersion ? `v${installedVersion}` : "Unknown"}
                detail={installedRelease ? statusLabel(installedRelease.uiStatus) : rootSnapshot.diagnostics.installed ? "Detected locally" : "Not installed"}
                tone={installedVersion ? "success" : "warning"}
              />
              <StatCard
                icon={Download}
                label="Latest"
                value={latestVersion ? `v${latestVersion}` : "Unknown"}
                detail={stability?.source === "cache" ? "Loaded from cache" : "Release radar"}
                tone="info"
              />
              <StatCard
                icon={Sparkles}
                label="Recommended"
                value={recommendedVersion ? `v${recommendedVersion}` : "Unknown"}
                detail={recommendedRelease?.reason ?? "Advisory install confidence"}
                tone="purple"
              />
              <StatCard
                icon={ShieldCheck}
                label="Stability Source"
                value={stabilitySourceLabel(stability)}
                detail={formatCacheDetail(stability)}
                tone={stability?.source === "unavailable" ? "warning" : stability?.source === "cache" ? "muted" : "success"}
              />
            </StatGrid>

            {stabilityError && releases.length === 0 ? (
              <SectionCard>
                <div className="flex items-start gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.10)] text-[hsl(var(--status-warning-foreground))]">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">Stability data unavailable</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{stabilityError}</p>
                  </div>
                </div>
              </SectionCard>
            ) : (
              <SectionCard
                title="Available Versions"
                action={
                  stability?.source === "cache" ? <StatusBadge label="Cached" tone="muted" /> : null
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                    <thead className="border-b border-border text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2.5">Version</th>
                        <th className="px-3 py-2.5">Release age</th>
                        <th className="px-3 py-2.5">Score</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Signal</th>
                        <th className="px-3 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-[0.78rem]">
                      {isLoadingStability && releases.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            <LoaderCircle className="mx-auto mb-2 h-4 w-4 animate-spin" />
                            Loading OpenClaw release confidence...
                          </td>
                        </tr>
                      ) : null}
                      {!isLoadingStability && releases.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                            No OpenClaw releases were returned by the stability data source.
                          </td>
                        </tr>
                      ) : null}
                      {releases.map((release) => {
                        const installed = Boolean(installedVersion && compareVersionStrings(release.version, installedVersion) === 0);
                        const recommended = release.recommended || Boolean(recommendedVersion && compareVersionStrings(release.version, recommendedVersion) === 0);
                        const rowTone = statusTone(release.uiStatus);
                        const selected = visibleSelectedRelease?.version === release.version;
                        const rowPreflight = selected && preflightTargetVersion === release.version ? preflightReport : null;

                        return (
                          <tr
                            key={release.version}
                            data-openclaw-version={release.version}
                            data-openclaw-status={release.uiStatus}
                            className={cn(
                              "transition-colors hover:bg-muted/35",
                              recommended && "bg-primary/5",
                              selected && "bg-muted/50"
                            )}
                            onClick={() => setSelectedRelease(release)}
                          >
                            <td className="px-3 py-3 align-middle">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-semibold text-foreground">v{release.version}</span>
                                {installed ? <Badge variant="success">Installed</Badge> : null}
                                {recommended ? <Badge>Recommended</Badge> : null}
                              </div>
                              {release.url ? (
                                <a
                                  href={release.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-flex items-center gap-1 text-[0.68rem] text-muted-foreground hover:text-foreground"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Release notes <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : null}
                            </td>
                            <td className="px-3 py-3 align-middle text-muted-foreground">{formatReleaseAge(release.releaseAgeMs)}</td>
                            <td className="px-3 py-3 align-middle">
                              <span className="font-mono text-sm font-semibold text-foreground">
                                {typeof release.score === "number" ? release.score.toFixed(1) : "Unknown"}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-middle">
                              <StatusBadge label={statusLabel(release.uiStatus)} tone={rowTone} />
                            </td>
                            <td className="max-w-[280px] px-3 py-3 align-middle">
                              <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{release.reason ?? "No stability rationale returned."}</p>
                            </td>
                            <td className="px-3 py-3 align-middle text-right">
                              {installed ? (
                                <Button size="sm" variant="secondary" className="h-8 text-xs" disabled>
                                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                  Installed
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant={selected && rowPreflight?.canAttemptUpdate ? "default" : "secondary"}
                                  className="h-8 min-w-[90px] text-xs"
                                  disabled={
                                    isUpdateRunning ||
                                    !rootSnapshot.diagnostics.installed ||
                                    Boolean(selected && rowPreflight && !rowPreflight.canAttemptUpdate)
                                  }
                                  title={
                                    !rootSnapshot.diagnostics.installed
                                      ? "OpenClaw is not installed."
                                      : selected && rowPreflight && !rowPreflight.canAttemptUpdate
                                        ? rowPreflight.recommendedNextAction
                                        : undefined
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (selected && rowPreflight?.canAttemptUpdate) {
                                      requestInstall(release);
                                    } else {
                                      setSelectedRelease(release);
                                    }
                                  }}
                                >
                                  {(isUpdateRunning && selected) || (isRunningPreflight && selected) ? (
                                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  ) : selected && rowPreflight && !rowPreflight.canAttemptUpdate ? (
                                    <Ban className="mr-1.5 h-3.5 w-3.5" />
                                  ) : selected && rowPreflight?.canAttemptUpdate ? (
                                    <Download className="mr-1.5 h-3.5 w-3.5" />
                                  ) : (
                                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  {isRunningPreflight && selected
                                    ? "Checking"
                                    : selected && rowPreflight && !rowPreflight.canAttemptUpdate
                                      ? "Blocked"
                                      : selected && rowPreflight?.canAttemptUpdate
                                        ? "Install"
                                        : "Inspect"}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}

            {visibleSelectedRelease ? (
              <SectionCard
                title="Update Readiness"
                action={(
                  <StatusBadge
                    label={preflightStatusLabel({
                      loading: isRunningPreflight,
                      report: selectedPreflight,
                      error: preflightError
                    })}
                    tone={preflightStatusTone({
                      loading: isRunningPreflight,
                      report: selectedPreflight,
                      error: preflightError
                    })}
                  />
                )}
              >
                <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-border">
                  <div className="min-w-0 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {installedVersion ? `v${installedVersion}` : "Unknown"}
                      </span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm font-semibold text-foreground">
                        v{visibleSelectedRelease.version}
                      </span>
                      <StatusBadge label={directionLabel(releaseComparison.direction)} tone={directionTone(releaseComparison.direction)} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {visibleSelectedRelease.reason ?? "No release confidence rationale was returned for this target."}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                      <ComparisonMetric
                        label="Confidence"
                        value={formatDelta(releaseComparison.scoreDelta, 1)}
                        detail={confidenceChangeLabel(releaseComparison.confidenceChange)}
                        tone={deltaTone(releaseComparison.scoreDelta, true)}
                      />
                      <ComparisonMetric
                        label="Negative issues"
                        value={formatDelta(releaseComparison.negativeIssueDelta)}
                        detail="Target versus installed"
                        tone={deltaTone(releaseComparison.negativeIssueDelta, false)}
                      />
                      <ComparisonMetric
                        label="Advisories"
                        value={formatDelta(releaseComparison.advisoryDelta)}
                        detail="Affected advisory delta"
                        tone={deltaTone(releaseComparison.advisoryDelta, false)}
                      />
                      <ComparisonMetric
                        label="Watch issues"
                        value={formatDelta(releaseComparison.watchIssueDelta)}
                        detail="Monitoring delta"
                        tone={deltaTone(releaseComparison.watchIssueDelta, false)}
                      />
                      <ComparisonMetric
                        label="Releases crossed"
                        value={releaseComparison.crossedReleaseCount == null ? "Unknown" : String(releaseComparison.crossedReleaseCount)}
                        detail="Observed by stability source"
                        tone="muted"
                      />
                      <ComparisonMetric
                        label="Release notes"
                        value={visibleSelectedRelease.url ? "Available" : "Unavailable"}
                        detail={visibleSelectedRelease.url ? "Opens the upstream release" : "No upstream link returned"}
                        tone={visibleSelectedRelease.url ? "info" : "muted"}
                      />
                    </div>

                    {visibleSelectedRelease.url ? (
                      <a
                        href={visibleSelectedRelease.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        Review upstream release notes <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>

                  <div className="min-w-0 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Environment preflight</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Non-mutating checks against the current AgentOS and OpenClaw environment.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 text-xs"
                        disabled={isRunningPreflight || isUpdateRunning}
                        onClick={() => void runPreflight(visibleSelectedRelease)}
                      >
                        {isRunningPreflight ? (
                          <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Run again
                      </Button>
                    </div>

                    {isRunningPreflight ? (
                      <div className="mt-4 flex min-h-[150px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Checking update readiness...
                      </div>
                    ) : preflightError ? (
                      <div className="mt-4 rounded-lg border border-[hsl(var(--status-danger)/0.25)] bg-[hsl(var(--status-danger)/0.08)] p-3">
                        <div className="flex items-start gap-2">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-danger-foreground))]" />
                          <div>
                            <p className="text-sm font-semibold text-foreground">Preflight unavailable</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{preflightError}</p>
                          </div>
                        </div>
                      </div>
                    ) : selectedPreflight ? (
                      <>
                        <div className="mt-4 rounded-lg border border-border bg-muted/35 p-3">
                          <div className="flex items-start gap-2.5">
                            {selectedPreflight.canAttemptUpdate ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-success-foreground))]" />
                            ) : (
                              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-danger-foreground))]" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">
                                {selectedPreflight.canAttemptUpdate ? "Update can be attempted" : "Update is blocked"}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {selectedPreflight.recommendedNextAction}
                              </p>
                            </div>
                          </div>
                        </div>
                        <PreflightCheckList report={selectedPreflight} />
                      </>
                    ) : (
                      <div className="mt-4 flex min-h-[150px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                        <CircleHelp className="mr-2 h-4 w-4" />
                        Select a target to run preflight.
                      </div>
                    )}

                    <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[0.68rem] leading-4 text-muted-foreground">
                        Install uses the existing OpenClaw CLI fallback and may restart the Gateway.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 shrink-0 text-xs"
                        disabled={
                          isRunningPreflight ||
                          isUpdateRunning ||
                          !selectedPreflight?.canAttemptUpdate ||
                          Boolean(installedVersion && compareVersionStrings(installedVersion, visibleSelectedRelease.version) === 0)
                        }
                        title={!selectedPreflight?.canAttemptUpdate ? selectedPreflight?.recommendedNextAction ?? "Preflight must pass before install." : undefined}
                        onClick={() => requestInstall(visibleSelectedRelease)}
                      >
                        {isUpdateRunning ? (
                          <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Install v{visibleSelectedRelease.version}
                      </Button>
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {(updateRunState !== "idle" || updateLog) ? (
              <SectionCard title="Install Progress">
                <div className="p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge
                      label={updateRunState === "running" ? "Running" : updateRunState === "success" ? "Completed" : "Failed"}
                      tone={updateRunState === "success" ? "success" : updateRunState === "error" ? "danger" : "warning"}
                    />
                    <p className="text-xs text-muted-foreground">{updateStatusMessage ?? updateResultMessage ?? "Waiting for install output."}</p>
                  </div>
                  <pre className="mt-3 max-h-[280px] overflow-auto rounded-lg border border-border bg-muted/45 p-3 font-mono text-[11px] leading-5 text-foreground">
                    {updateLog || "Waiting for command output..."}
                  </pre>
                </div>
              </SectionCard>
            ) : null}
          </>
        )}
        inspector={(
          <aside className={cn("hidden min-w-0 xl:block")}>
            <SectionCard title="Version Detail" className="sticky top-4">
              <div className="p-3">
                {visibleSelectedRelease ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-base font-semibold text-foreground">v{visibleSelectedRelease.version}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {visibleSelectedRelease.reason ?? "No confidence rationale returned."}
                        </p>
                      </div>
                      <StatusBadge label={statusLabel(visibleSelectedRelease.uiStatus)} tone={statusTone(visibleSelectedRelease.uiStatus)} />
                    </div>
                    <div className="mt-4">
                      <KeyValue label="Score" value={typeof visibleSelectedRelease.score === "number" ? visibleSelectedRelease.score.toFixed(1) : "Unknown"} />
                      <KeyValue label="Band" value={visibleSelectedRelease.band ?? "Unknown"} />
                      <KeyValue label="API status" value={visibleSelectedRelease.status ?? "Unknown"} />
                      <KeyValue label="Age" value={formatReleaseAge(visibleSelectedRelease.releaseAgeMs)} />
                      <KeyValue label="Negative issues" value={formatCount(visibleSelectedRelease.negativeIssues)} />
                      <KeyValue label="Positive issues" value={formatCount(visibleSelectedRelease.positiveIssues)} />
                      <KeyValue label="Watch issues" value={formatCount(visibleSelectedRelease.watchIssueCount)} />
                      <KeyValue label="Affected advisories" value={formatCount(visibleSelectedRelease.affectedAdvisoryCount)} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a release to inspect its stability signal.</p>
                )}
              </div>
            </SectionCard>
          </aside>
        )}
      />

      <Dialog open={Boolean(installTarget)} onOpenChange={(open) => !open && setInstallTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Confirm OpenClaw update</DialogTitle>
            <DialogDescription>
              This operation may restart the Gateway and interrupt active work. Review the advisory and environment warnings before continuing.
            </DialogDescription>
          </DialogHeader>
          {installTarget ? (
            <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-semibold text-foreground">v{installTarget.version}</p>
                  <StatusBadge label={statusLabel(installTarget.uiStatus)} tone={statusTone(installTarget.uiStatus)} />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{installTarget.reason ?? "No stability rationale returned."}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs font-semibold text-foreground">Execution plan</p>
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <KeyValue label="Current version" value={installedVersion ? `v${installedVersion}` : "Unknown"} />
                  <KeyValue label="Target version" value={`v${installTarget.version}`} />
                  <KeyValue label="Install method" value={`OpenClaw CLI --tag ${installTarget.version}`} />
                  <KeyValue label="Gateway" value="May restart during verification" />
                  <KeyValue label="Postflight" value="Version, Gateway and runtime smoke" />
                  <KeyValue label="Rollback policy" value="Manual - keep target on failure" />
                </dl>
                <p className="mt-3 text-[0.68rem] leading-5 text-muted-foreground">
                  AgentOS will save a rollback snapshot before mutation. If postflight verification reports a problem, the selected target stays installed and Runtime Inbox will offer an explicit restore action.
                </p>
              </div>
              {preflightReport && preflightTargetVersion === installTarget.version && (preflightReport.warnings.length > 0 || preflightReport.unknowns.length > 0) ? (
                <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.08)] p-3">
                  <p className="text-xs font-semibold text-foreground">Preflight items requiring review</p>
                  <ul className="mt-2 space-y-2">
                    {[...preflightReport.warnings, ...preflightReport.unknowns].map((check) => (
                      <li key={check.id} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--status-warning-foreground))]" />
                        <span><strong className="font-medium text-foreground">{check.label}:</strong> {check.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setInstallTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const target = installTarget;
                setInstallTarget(null);
                if (target) {
                  void runInstall(target);
                }
              }}
            >
              Confirm and install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ComparisonMetric({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
}) {
  return (
    <div className="min-w-0 bg-card p-3">
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", metricToneClass(tone))}>{value}</p>
      <p className="mt-1 text-[0.64rem] leading-4 text-muted-foreground">{detail}</p>
    </div>
  );
}

function PreflightCheckList({ report }: { report: OpenClawUpdateSafetyReport }) {
  const checks = [
    ...report.blockers,
    ...report.warnings,
    ...report.unknowns,
    ...report.safeChecks
  ];

  return (
    <div className="mt-3 max-h-[260px] space-y-1.5 overflow-y-auto pr-1" data-preflight-target={report.targetVersion}>
      {checks.map((check) => (
        <PreflightCheckRow key={check.id} check={check} />
      ))}
    </div>
  );
}

function PreflightCheckRow({ check }: { check: OpenClawUpdateSafetyCheck }) {
  const Icon = check.status === "safe"
    ? CheckCircle2
    : check.status === "blocker"
      ? Ban
      : check.status === "warning"
        ? AlertTriangle
        : CircleHelp;
  const tone = check.status === "safe"
    ? "success"
    : check.status === "blocker"
      ? "danger"
      : check.status === "warning"
        ? "warning"
        : "muted";

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", metricToneClass(tone))} />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{check.label}</p>
        <p className="mt-0.5 text-[0.66rem] leading-4 text-muted-foreground">{check.message}</p>
      </div>
    </div>
  );
}

function normalizeVersion(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^v/i, "");

  return trimmed || null;
}

function resolveUpdateMode(targetVersion: string, agentOsRecommendedVersion: string | null | undefined) {
  return agentOsRecommendedVersion && compareVersionStrings(targetVersion, agentOsRecommendedVersion) === 0
    ? "recommended"
    : "advanced";
}

function preflightStatusLabel(input: {
  loading: boolean;
  report: OpenClawUpdateSafetyReport | null;
  error: string | null;
}) {
  if (input.loading) {
    return "Checking";
  }

  if (input.error) {
    return "Unavailable";
  }

  if (!input.report) {
    return "Not checked";
  }

  if (!input.report.canAttemptUpdate) {
    return "Blocked";
  }

  return input.report.warnings.length > 0 || input.report.unknowns.length > 0 ? "Review" : "Ready";
}

function preflightStatusTone(input: {
  loading: boolean;
  report: OpenClawUpdateSafetyReport | null;
  error: string | null;
}): StatusTone {
  if (input.loading || !input.report) {
    return input.error ? "danger" : "muted";
  }

  if (!input.report.canAttemptUpdate) {
    return "danger";
  }

  return input.report.warnings.length > 0 || input.report.unknowns.length > 0 ? "warning" : "success";
}

function directionLabel(direction: "upgrade" | "downgrade" | "same" | "unknown") {
  switch (direction) {
    case "upgrade":
      return "Upgrade";
    case "downgrade":
      return "Downgrade";
    case "same":
      return "Installed";
    case "unknown":
      return "Unknown";
  }
}

function directionTone(direction: "upgrade" | "downgrade" | "same" | "unknown"): StatusTone {
  if (direction === "upgrade") {
    return "info";
  }

  if (direction === "downgrade") {
    return "warning";
  }

  return direction === "same" ? "success" : "muted";
}

function confidenceChangeLabel(change: "improved" | "reduced" | "unchanged" | "unknown") {
  switch (change) {
    case "improved":
      return "Higher target score";
    case "reduced":
      return "Lower target score";
    case "unchanged":
      return "No score change";
    case "unknown":
      return "Installed score unavailable";
  }
}

function formatDelta(value: number | null, fractionDigits = 0) {
  if (value == null) {
    return "Unknown";
  }

  const formatted = Math.abs(value).toFixed(fractionDigits);
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function deltaTone(value: number | null, positiveIsGood: boolean): StatusTone {
  if (value == null || value === 0) {
    return "muted";
  }

  const isGood = positiveIsGood ? value > 0 : value < 0;
  return isGood ? "success" : "warning";
}

function metricToneClass(tone: StatusTone) {
  switch (tone) {
    case "success":
      return "text-[hsl(var(--status-success-foreground))]";
    case "warning":
      return "text-[hsl(var(--status-warning-foreground))]";
    case "danger":
      return "text-[hsl(var(--status-danger-foreground))]";
    case "info":
      return "text-primary";
    case "purple":
      return "text-[hsl(var(--status-purple-foreground))]";
    case "muted":
      return "text-muted-foreground";
  }
}

function statusLabel(status: OpenClawStabilityUiStatus) {
  switch (status) {
    case "recommended":
      return "Recommended";
    case "stable":
      return "Stable";
    case "caution":
      return "Caution";
    case "wait":
      return "Wait";
    case "risky":
      return "Risky";
    case "skip":
      return "Skip";
    case "unknown":
      return "Unknown";
  }
}

function statusTone(status: OpenClawStabilityUiStatus): StatusTone {
  switch (status) {
    case "recommended":
      return "purple";
    case "stable":
      return "success";
    case "caution":
      return "warning";
    case "wait":
      return "warning";
    case "risky":
    case "skip":
      return "danger";
    case "unknown":
      return "muted";
  }
}

function stabilitySourceLabel(stability: OpenClawStabilitySnapshot | null) {
  if (!stability) {
    return "Loading";
  }

  if (stability.source === "network") {
    return "Live";
  }

  if (stability.source === "cache") {
    return "Cache";
  }

  return "Unavailable";
}

function formatCacheDetail(stability: OpenClawStabilitySnapshot | null) {
  if (!stability) {
    return "Checking release radar";
  }

  if (stability.source === "cache" && typeof stability.cacheAgeMs === "number") {
    return `Cached ${formatReleaseAge(stability.cacheAgeMs)} ago`;
  }

  if (stability.fetchedAt) {
    return `Updated ${new Date(stability.fetchedAt).toLocaleString()}`;
  }

  return stability.error ?? "No stability data";
}

function formatReleaseAge(ageMs: number | null) {
  if (typeof ageMs !== "number") {
    return "Unknown";
  }

  const days = Math.floor(ageMs / 86_400_000);
  if (days >= 1) {
    return `${days}d`;
  }

  const hours = Math.floor(ageMs / 3_600_000);
  if (hours >= 1) {
    return `${hours}h`;
  }

  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  return `${minutes}m`;
}

function formatCount(value: number | null) {
  return typeof value === "number" ? value.toLocaleString() : "Unknown";
}
