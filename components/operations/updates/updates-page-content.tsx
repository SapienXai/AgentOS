"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
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
import type { MissionControlSnapshot, OpenClawUpdateStreamEvent } from "@/lib/agentos/contracts";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
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

  const appendUpdateLog = useCallback((text: string) => {
    setUpdateLog((current) => `${current}${text}`);
  }, []);

  const runInstall = useCallback(async (release: OpenClawStabilityRelease) => {
    if (updateRunState === "running") {
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
          mode: release.uiStatus === "recommended" ? "recommended" : "advanced"
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
  }, [appendUpdateLog, loadStability, setSnapshot, updateRunState]);

  const requestInstall = (release: OpenClawStabilityRelease) => {
    if (requiresRiskConfirmation(release.uiStatus)) {
      setInstallTarget(release);
      return;
    }

    void runInstall(release);
  };

  const refreshAll = async () => {
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

                        return (
                          <tr
                            key={release.version}
                            data-openclaw-version={release.version}
                            data-openclaw-status={release.uiStatus}
                            className={cn(
                              "transition-colors hover:bg-muted/35",
                              recommended && "bg-primary/5",
                              selectedRelease?.version === release.version && "bg-muted/50"
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
                                  className="h-8 text-xs"
                                  disabled={isUpdateRunning || !rootSnapshot.diagnostics.installed}
                                  title={!rootSnapshot.diagnostics.installed ? "OpenClaw is not installed." : undefined}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    requestInstall(release);
                                  }}
                                >
                                  {isUpdateRunning && selectedRelease?.version === release.version ? (
                                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Download className="mr-1.5 h-3.5 w-3.5" />
                                  )}
                                  Install
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install lower-confidence OpenClaw?</DialogTitle>
            <DialogDescription>
              This version is marked {installTarget ? statusLabel(installTarget.uiStatus) : "risky"} by release confidence data. The score is advisory, but this install may be more likely to require rollback or operator recovery.
            </DialogDescription>
          </DialogHeader>
          {installTarget ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-mono font-semibold text-foreground">v{installTarget.version}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{installTarget.reason ?? "No stability rationale returned."}</p>
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
              Install anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function normalizeVersion(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^v/i, "");

  return trimmed || null;
}

function requiresRiskConfirmation(status: OpenClawStabilityUiStatus) {
  return status === "caution" || status === "wait" || status === "risky" || status === "skip";
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
