"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, Loader2, Plus, RefreshCw, Trash2, UserRound } from "lucide-react";

import { SurfaceIcon } from "@/components/mission-control/surface-icon";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  getWorkspaceChannels,
  removeSnapshotChannelAccount,
  replaceSnapshotChannelRegistry,
  upsertSnapshotChannelAccount
} from "@/lib/openclaw/channel-bindings";
import {
  buildSurfaceCatalogEntries,
  getSurfaceCatalogEntry,
  sortSurfaceAccounts,
  type SurfaceCatalogEntry,
  type SurfaceProvisionField
} from "@/lib/openclaw/surface-catalog";
import {
  buildEmptyProvisionDraft,
  buildProvisionConfig,
  getProvisionConfigPath,
  getProvisionDraftText,
  isProvisionFieldSatisfied
} from "@/lib/openclaw/surface-provision";
import {
  resolveGatewayAuthRepairAction,
  type GatewayAuthRepairAction
} from "@/lib/openclaw/gateway-auth-actions";
import {
  formatGatewayConfigRateLimitMessage,
  isGatewayConfigRateLimitMessage
} from "@/lib/openclaw/gateway-config-errors";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type {
  ChannelAccountRecord,
  DiscoveredSurfaceRoute,
  MissionControlSnapshot,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider,
  SurfaceAccountRuntimeStatus,
  SurfaceBindingDriftIssue,
  SurfaceBindingRepairResult,
  WorkspaceChannelGroupAssignment
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChannelMutationResult = {
  error?: string;
  registry?: MissionControlSnapshot["channelRegistry"];
  account?: MissionControlSnapshot["channelAccounts"][number];
  snapshot?: MissionControlSnapshot;
};

type SurfaceReconcileResult = {
  error?: string;
  repair?: SurfaceBindingRepairResult;
  snapshot?: MissionControlSnapshot;
};

type GatewayAuthStatusResult = {
  authStatus?: {
    native?: {
      ok?: boolean;
      issue?: string | null;
    };
    recommendation?: string | null;
  };
  error?: string;
};

const SURFACE_KIND_ORDER: MissionControlSurfaceKind[] = ["chat", "inbox", "trigger"];

export function WorkspaceChannelsDialog({
  snapshot,
  workspaceId,
  open,
  initialProvider = null,
  onOpenChange,
  onRefresh,
  onSnapshotChange
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string | null;
  open: boolean;
  initialProvider?: MissionControlSurfaceProvider | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const workspace = useMemo(
    () => snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [snapshot.workspaces, workspaceId]
  );
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => agent.workspaceId === workspace?.id),
    [snapshot.agents, workspace?.id]
  );
  const workspaceSurfaces = useMemo(
    () => (workspace ? getWorkspaceChannels(snapshot, workspace.id) : []),
    [snapshot, workspace]
  );
  const allAccounts = useMemo(() => sortSurfaceAccounts(snapshot.channelAccounts), [snapshot.channelAccounts]);
  const surfaceCatalogEntries = useMemo(
    () =>
      buildSurfaceCatalogEntries({
        channelAccounts: allAccounts,
        surfaceRuntime: snapshot.surfaceRuntime
      }),
    [allAccounts, snapshot.surfaceRuntime]
  );
  const surfaceCatalogByProvider = useMemo(
    () => new Map(surfaceCatalogEntries.map((entry) => [entry.provider, entry] as const)),
    [surfaceCatalogEntries]
  );
  const availableKinds = useMemo(() => {
    const catalogKinds = new Set(surfaceCatalogEntries.map((entry) => entry.kind));
    return SURFACE_KIND_ORDER.filter((kind) => catalogKinds.has(kind));
  }, [surfaceCatalogEntries]);

  const [activeKind, setActiveKind] = useState<MissionControlSurfaceKind>("chat");
  const [activeProvider, setActiveProvider] = useState<MissionControlSurfaceProvider>("telegram");
  const [isSaving, setIsSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);
  const [newPrimaryAgentId, setNewPrimaryAgentId] = useState("");
  const [delegateDraftBySurfaceId, setDelegateDraftBySurfaceId] = useState<Record<string, string>>({});
  const [delegateRouteDraftBySurfaceId, setDelegateRouteDraftBySurfaceId] = useState<Record<string, string>>({});
  const [discoveredRoutesBySurfaceId, setDiscoveredRoutesBySurfaceId] = useState<
    Record<string, DiscoveredSurfaceRoute[]>
  >({});
  const [loadingRoutesBySurfaceId, setLoadingRoutesBySurfaceId] = useState<Record<string, boolean>>({});
  const [routeErrorsBySurfaceId, setRouteErrorsBySurfaceId] = useState<Record<string, string | null>>({});
  const [deleteTarget, setDeleteTarget] = useState<ChannelAccountRecord | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [provisionDraft, setProvisionDraft] = useState<Record<string, string | boolean>>(
    buildEmptyProvisionDraft(getSurfaceCatalogEntry(activeProvider))
  );

  useEffect(() => {
    if (!open || !initialProvider) {
      return;
    }

    const entry = surfaceCatalogByProvider.get(initialProvider) ?? getSurfaceCatalogEntry(initialProvider);
    setActiveKind(entry.kind);
    setActiveProvider(initialProvider);
    setProvisionDraft(buildEmptyProvisionDraft(entry));
  }, [initialProvider, open, surfaceCatalogByProvider]);

  const providerAccounts = useMemo(
    () =>
      mergeRuntimeSurfaceAccounts(
        allAccounts.filter((account) => account.type === activeProvider),
        Object.values(snapshot.surfaceRuntime.accountsByProvider[activeProvider] ?? {})
      ),
    [activeProvider, allAccounts, snapshot.surfaceRuntime.accountsByProvider]
  );
  const providerWorkspaceSurfaces = useMemo(
    () => workspaceSurfaces.filter((surface) => surface.type === activeProvider),
    [activeProvider, workspaceSurfaces]
  );
  const currentCatalogEntry = useMemo(
    () => surfaceCatalogByProvider.get(activeProvider) ?? getSurfaceCatalogEntry(activeProvider),
    [activeProvider, surfaceCatalogByProvider]
  );
  const surfaceGatewayAccess = snapshot.surfaceRuntime.gatewayAccess;
  const workspaceDriftIssues = useMemo(
    () => filterWorkspaceDriftIssues(snapshot.surfaceDrift.issues, workspace?.id ?? null),
    [snapshot.surfaceDrift.issues, workspace?.id]
  );
  const workspaceDriftSummary = useMemo(
    () => summarizeSurfaceDriftIssues(workspaceDriftIssues),
    [workspaceDriftIssues]
  );
  const activeProviderDriftIssues = useMemo(
    () => workspaceDriftIssues.filter((issue) => issue.provider === activeProvider),
    [activeProvider, workspaceDriftIssues]
  );
  const basicProvisionFields = currentCatalogEntry.provisionFields.filter((field) => field.section !== "advanced");
  const advancedProvisionFields = currentCatalogEntry.provisionFields.filter((field) => field.section === "advanced");
  const isLinkedAccountId = useCallback(
    (accountId: string) =>
      providerWorkspaceSurfaces.some(
        (surface) => surface.id === accountId || surface.id === toLegacySurfaceId(accountId)
      ),
    [providerWorkspaceSurfaces]
  );
  const resolveAgentDisplayName = useCallback(
    (agentId: string | null | undefined, fallback = "Unset") => {
      if (!agentId) {
        return fallback;
      }

      return formatAgentDisplayName(snapshot.agents.find((agent) => agent.id === agentId) ?? { name: agentId });
    },
    [snapshot.agents]
  );
  const resolveWorkspaceDisplayName = useCallback(
    (candidateWorkspaceId: string) =>
      snapshot.workspaces.find((entry) => entry.id === candidateWorkspaceId)?.name ?? candidateWorkspaceId,
    [snapshot.workspaces]
  );

  const providerOptions = useMemo(() => {
    return surfaceCatalogEntries.filter((entry) => entry.kind === activeKind).map((entry) => entry.provider);
  }, [activeKind, surfaceCatalogEntries]);

  const refreshSurfaceRoutes = useCallback(
    async (surfaceId: string, provider: MissionControlSurfaceProvider) => {
      if (!workspace?.id) {
        return;
      }

      setLoadingRoutesBySurfaceId((current) => ({ ...current, [surfaceId]: true }));
      setRouteErrorsBySurfaceId((current) => ({ ...current, [surfaceId]: null }));

      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/discovery?provider=${encodeURIComponent(
            provider
          )}&accountId=${encodeURIComponent(surfaceId)}`
        );
        const result = (await response.json()) as {
          error?: string;
          routes?: DiscoveredSurfaceRoute[];
          supported?: boolean;
        };

        if (!response.ok || result.error) {
          throw new Error(result.error || `${getSurfaceCatalogEntry(provider).label} route discovery failed.`);
        }

        setDiscoveredRoutesBySurfaceId((current) => ({
          ...current,
          [surfaceId]: result.supported === false || !Array.isArray(result.routes) ? [] : result.routes
        }));
        if (provider === "telegram" && Array.isArray(result.routes) && result.routes.length > 0) {
          const surface = workspaceSurfaces.find((entry) => entry.id === surfaceId) ?? null;
          const workspaceBinding = surface?.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;

          if (surface && workspaceBinding) {
            const currentAssignments = (workspaceBinding.groupAssignments ?? []).filter(
              (assignment) => assignment.enabled !== false
            );
            const currentRouteIds = new Set(currentAssignments.map((assignment) => assignment.chatId));
            const missingRoutes = result.routes.filter((route) => route.routeId && !currentRouteIds.has(route.routeId));
            const routeTitlesById = new Map(
              result.routes
                .filter((route) => route.routeId && route.title?.trim())
                .map((route) => [route.routeId, route.title?.trim() ?? null] as const)
            );
            const titledAssignments = currentAssignments.map((assignment) => {
              const discoveredTitle = routeTitlesById.get(assignment.chatId);

              if (!discoveredTitle || assignment.title === discoveredTitle) {
                return assignment;
              }

              return {
                ...assignment,
                title: discoveredTitle
              };
            });
            const titleChanged = titledAssignments.some(
              (assignment, index) => assignment.title !== currentAssignments[index]?.title
            );

            if (missingRoutes.length > 0 || titleChanged) {
              try {
                const syncResponse = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    action: "groups",
                    channelId: surfaceId,
                    groupAssignments: [
                      ...titledAssignments,
                      ...missingRoutes.map((route) => ({
                        chatId: route.routeId,
                        title: route.title ?? null,
                        agentId: null,
                        enabled: true
                      }))
                    ]
                  })
                });
                const syncResult = (await syncResponse.json()) as ChannelMutationResult;

                if (!syncResponse.ok || syncResult.error) {
                  throw new Error(syncResult.error || "Discovered groups could not be enabled.");
                }

                if (syncResult.registry && onSnapshotChange) {
                  onSnapshotChange((current) => replaceSnapshotChannelRegistry(current, syncResult.registry!));
                }

                toast.success("Telegram routes enabled.", {
                  description:
                    missingRoutes.length === 1
                      ? `${missingRoutes[0].title ?? missingRoutes[0].routeId} now falls back to the primary agent.`
                      : missingRoutes.length > 1
                        ? `${missingRoutes.length} discovered groups now fall back to the primary agent.`
                        : "Discovered group names were synced."
                });
                void onRefresh().catch(() => {});
              } catch (error) {
                toast.error("Telegram route sync failed.", {
                  description: error instanceof Error ? error.message : "Discovered groups could not be enabled."
                });
              }
            }
          }
        }
      } catch (error) {
        setRouteErrorsBySurfaceId((current) => ({
          ...current,
          [surfaceId]:
            error instanceof Error ? error.message : `${getSurfaceCatalogEntry(provider).label} discovery failed.`
        }));
      } finally {
        setLoadingRoutesBySurfaceId((current) => ({ ...current, [surfaceId]: false }));
      }
    },
    [onRefresh, onSnapshotChange, workspace, workspaceSurfaces]
  );

  useEffect(() => {
    if (!open) {
      setIsSaving(false);
      setSavingMessage(null);
      setDeleteTarget(null);
      setDeleteConfirmText("");
      setProvisionDraft(buildEmptyProvisionDraft(currentCatalogEntry));
      setDelegateDraftBySurfaceId({});
      setDelegateRouteDraftBySurfaceId({});
      setDiscoveredRoutesBySurfaceId({});
      setRouteErrorsBySurfaceId({});
      setLoadingRoutesBySurfaceId({});
      return;
    }

    if (!newPrimaryAgentId) {
      setNewPrimaryAgentId(workspaceAgents[0]?.id ?? "");
    }
  }, [currentCatalogEntry, newPrimaryAgentId, open, workspaceAgents]);

  useEffect(() => {
    setProvisionDraft(buildEmptyProvisionDraft(currentCatalogEntry));
  }, [currentCatalogEntry]);

  useEffect(() => {
    if (!providerOptions.includes(activeProvider)) {
      setActiveProvider(providerOptions[0] ?? "telegram");
    }
  }, [activeProvider, providerOptions]);

  useEffect(() => {
    if (!open || !workspace?.id || !currentCatalogEntry.supportsRouteDiscovery) {
      return;
    }

    for (const surface of providerWorkspaceSurfaces) {
      if (discoveredRoutesBySurfaceId[surface.id] || loadingRoutesBySurfaceId[surface.id]) {
        continue;
      }

      void refreshSurfaceRoutes(surface.id, surface.type);
    }
  }, [
    currentCatalogEntry.supportsRouteDiscovery,
    discoveredRoutesBySurfaceId,
    loadingRoutesBySurfaceId,
    open,
    providerWorkspaceSurfaces,
    refreshSurfaceRoutes,
    workspace?.id
  ]);

  const beginSaving = (message: string) => {
    setIsSaving(true);
    setSavingMessage(message);
  };

  const endSaving = () => {
    setIsSaving(false);
    setSavingMessage(null);
  };

  const postWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const patchWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const deleteWorkspaceSurface = async (payload: Record<string, unknown>) => {
    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = (await response.json()) as ChannelMutationResult;
    if (!response.ok || result.error) {
      throw new Error(result.error || "OpenClaw could not update this surface right now.");
    }

    return result;
  };

  const applyRegistryUpdate = (result: ChannelMutationResult) => {
    if (!result.registry || !onSnapshotChange) {
      return;
    }

    onSnapshotChange((current) => {
      let next = replaceSnapshotChannelRegistry(current, result.registry!);
      if (result.account) {
        next = upsertSnapshotChannelAccount(next, result.account);
      }
      return next;
    });
  };

  const resolveSurfaceGatewayRepairAction = async (message: string) => {
    const directAction = resolveGatewayAuthRepairAction(message);
    if (directAction) {
      return directAction;
    }

    if (!isGatewayRecoveryCandidate(message)) {
      return null;
    }

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "GET"
      });
      const result = (await response.json().catch(() => null)) as GatewayAuthStatusResult | null;
      const nativeIssue = result?.authStatus?.native?.issue ?? null;
      const recommendation = result?.authStatus?.recommendation ?? null;

      return resolveGatewayAuthRepairAction([message, nativeIssue, recommendation].filter(Boolean).join("\n"));
    } catch {
      return null;
    }
  };

  const repairGatewayAccessAndRetry = async (
    action: GatewayAuthRepairAction,
    retry: () => Promise<void>,
    scopes: string[] = ["operator.admin"]
  ) => {
    beginSaving(`${action.label} repair...`);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: action.apiAction, scopes })
      });
      const result = (await response.json().catch(() => null)) as GatewayAuthStatusResult | null;

      if (!response.ok) {
        throw new Error(result?.error || "Gateway access could not be repaired.");
      }

      if (result?.authStatus?.native && result.authStatus.native.ok === false) {
        throw new Error(result.authStatus.native.issue || "Gateway access still needs attention.");
      }

      toast.success(`${action.label} repaired.`, {
        description: "Retrying the surface operation."
      });
      await onRefresh().catch(() => undefined);
      await retry();
    } catch (error) {
      toast.error("Gateway repair failed.", {
        description: error instanceof Error ? error.message : "Unable to repair Gateway access."
      });
    } finally {
      endSaving();
    }
  };

  const showSurfaceMutationError = async (
    title: string,
    error: unknown,
    retry?: () => Promise<void>,
    repairScopes: string[] = ["operator.admin"]
  ) => {
    const message = readSurfaceErrorMessage(error);

    if (isGatewayConfigRateLimitMessage(message) && retry) {
      toast.error(title, {
        description: formatGatewayConfigRateLimitMessage(message, "the surface operation"),
        duration: 12_000,
        action: {
          label: "Retry",
          onClick: () => void retry()
        }
      });
      return;
    }

    const repairAction =
      (await resolveSurfaceGatewayRepairAction(message)) ??
      (isGatewayRecoveryCandidate(message) ? buildFallbackGatewayRepairAction() : null);

    if (repairAction && retry) {
      toast.error(title, {
        description: `${message} ${repairAction.detail}`,
        duration: 12_000,
        action: {
          label: "Repair & retry",
          onClick: () => void repairGatewayAccessAndRetry(repairAction, retry, repairScopes)
        }
      });
      return;
    }

    if (isGatewayRecoveryCandidate(message) && retry) {
      toast.error(title, {
        description: `${message} Wait for the OpenClaw Gateway to finish restarting, then retry.`,
        duration: 10_000,
        action: {
          label: "Retry",
          onClick: () => void retry()
        }
      });
      return;
    }

    toast.error(title, {
      description: message
    });
  };

  const handleAttachExisting = async (account: ChannelAccountRecord) => {
    if (!workspace) {
      return;
    }

    beginSaving(`Connecting ${account.name}...`);

    try {
      const result = await postWorkspaceSurface({
        channelId: account.id,
        type: activeProvider,
        name: account.name,
        workspacePath: workspace.path,
        primaryAgentId: newPrimaryAgentId || null,
        agentId: newPrimaryAgentId || undefined
      });
      applyRegistryUpdate(result);
      toast.success(`${getSurfaceCatalogEntry(activeProvider).label} connected to this workspace.`);
      void onRefresh().catch(() => {});
    } catch (error) {
      await showSurfaceMutationError("Surface connection failed.", error, () => handleAttachExisting(account));
    } finally {
      endSaving();
    }
  };

  const handleProvisionSurface = async () => {
    if (!workspace) {
      return;
    }

    if (!getProvisionDraftText(provisionDraft, "name").trim()) {
      toast.error("A surface name is required.");
      return;
    }

    beginSaving(`Provisioning ${currentCatalogEntry.label}...`);

    try {
      const config = buildProvisionConfig(currentCatalogEntry.provisionFields, provisionDraft);
      const payload: Record<string, unknown> = {
        type: activeProvider,
        name: getProvisionDraftText(provisionDraft, "name").trim(),
        workspacePath: workspace.path,
        config,
        primaryAgentId: newPrimaryAgentId || null,
        agentId: newPrimaryAgentId || undefined
      };

      for (const field of currentCatalogEntry.provisionFields) {
        if (field.key === "token" && typeof config.token === "string") {
          payload.token = config.token;
        }

        if (field.key === "botToken" && typeof config.botToken === "string") {
          payload.botToken = config.botToken;
        }

        if (field.key === "webhookUrl" && typeof config.webhookUrl === "string") {
          payload.webhookUrl = config.webhookUrl;
        }
      }

      const result = await postWorkspaceSurface(payload);
      applyRegistryUpdate(result);
      setProvisionDraft(buildEmptyProvisionDraft(currentCatalogEntry));
      toast.success(`${currentCatalogEntry.label} provisioned and connected.`);
      void onRefresh().catch(() => {});
    } catch (error) {
      await showSurfaceMutationError("Surface provisioning failed.", error, handleProvisionSurface);
    } finally {
      endSaving();
    }
  };

  const handlePrimaryChange = async (surfaceId: string, primaryAgentId: string) => {
    if (!workspace || !primaryAgentId) {
      return;
    }

    beginSaving("Updating owner agent...");

    try {
      const surface = workspaceSurfaces.find((entry) => entry.id === surfaceId) ?? null;
      const binding = surface?.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;

      if (surface && binding && !binding.agentIds.includes(primaryAgentId)) {
        const bindResult = await patchWorkspaceSurface({
          action: "bind-agent",
          channelId: surfaceId,
          agentId: primaryAgentId,
          workspacePath: workspace.path
        });
        applyRegistryUpdate(bindResult);
      }

      const result = await patchWorkspaceSurface({
        action: "primary",
        channelId: surfaceId,
        primaryAgentId
      });
      applyRegistryUpdate(result);
      toast.success("Owner agent updated.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleDisconnectSurface = async (surfaceId: string) => {
    beginSaving("Disconnecting surface from workspace...");

    try {
      const result = await deleteWorkspaceSurface({ channelId: surfaceId });
      applyRegistryUpdate(result);
      toast.success("Surface disconnected from this workspace.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface disconnect failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleAddAssistant = async (surfaceId: string) => {
    const agentId = delegateDraftBySurfaceId[surfaceId]?.trim();
    const routeId = delegateRouteDraftBySurfaceId[surfaceId]?.trim();
    if (!workspace || !agentId) {
      return;
    }

    beginSaving(routeId ? "Adding assistant and assigning route..." : "Adding assistant agent...");

    try {
      const result = await patchWorkspaceSurface({
        action: "bind-agent",
        channelId: surfaceId,
        agentId,
        workspacePath: workspace.path
      });
      applyRegistryUpdate(result);

      let assignedRouteTitle: string | null = null;
      if (routeId) {
        const surface = workspaceSurfaces.find((entry) => entry.id === surfaceId) ?? null;
        const workspaceBinding = surface?.workspaces.find((entry) => entry.workspaceId === workspace.id) ?? null;

        if (!surface || !workspaceBinding) {
          throw new Error("Surface route binding was not found.");
        }

        const currentAssignments = (workspaceBinding.groupAssignments ?? []).filter(
          (assignment) => assignment.enabled !== false
        );
        const visibleAssignments = surface.workspaces.flatMap((binding) =>
          (binding.groupAssignments ?? []).filter((assignment) => assignment.enabled !== false)
        );
        const route =
          buildSurfaceRouteOptions(discoveredRoutesBySurfaceId[surfaceId] ?? [], visibleAssignments, surface.type).find(
            (entry) => entry.routeId === routeId
          ) ?? null;
        assignedRouteTitle = route?.title ?? routeId;

        const nextAssignment: WorkspaceChannelGroupAssignment = {
          chatId: routeId,
          title: route?.title ?? currentAssignments.find((assignment) => assignment.chatId === routeId)?.title ?? null,
          agentId,
          enabled: true
        };
        const nextAssignments = currentAssignments.some((assignment) => assignment.chatId === routeId)
          ? currentAssignments.map((assignment) =>
              assignment.chatId === routeId ? { ...assignment, ...nextAssignment } : assignment
            )
          : [...currentAssignments, nextAssignment];

        const routeResult = await patchWorkspaceSurface({
          action: "groups",
          channelId: surfaceId,
          groupAssignments: nextAssignments
        });
        applyRegistryUpdate(routeResult);
      }

      setDelegateDraftBySurfaceId((current) => ({ ...current, [surfaceId]: "" }));
      setDelegateRouteDraftBySurfaceId((current) => ({ ...current, [surfaceId]: "" }));
      toast.success(routeId ? "Assistant added and assigned." : "Assistant agent added.", {
        description:
          routeId && assignedRouteTitle
            ? `${resolveAgentDisplayName(agentId, agentId)} now owns ${assignedRouteTitle}.`
            : undefined
      });
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Assistant update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleRemoveAssistant = async (surfaceId: string, agentId: string) => {
    beginSaving("Removing assistant agent...");

    try {
      const result = await patchWorkspaceSurface({
        action: "unbind-agent",
        channelId: surfaceId,
        agentId
      });
      applyRegistryUpdate(result);
      toast.success("Assistant agent removed.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Assistant update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const updateSurfaceAssignments = async (
    surfaceId: string,
    nextAssignments: WorkspaceChannelGroupAssignment[]
  ) => {
    beginSaving("Updating surface routes...");

    try {
      const result = await patchWorkspaceSurface({
        action: "groups",
        channelId: surfaceId,
        groupAssignments: nextAssignments
      });
      applyRegistryUpdate(result);
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface route update failed.", {
        description: error instanceof Error ? error.message : "Unknown surface routing error."
      });
    } finally {
      endSaving();
    }
  };

  const handleDeleteAccountEverywhere = async () => {
    if (!deleteTarget) {
      return;
    }

    beginSaving(`Deleting ${deleteTarget.name} from OpenClaw...`);

    try {
      const result = await deleteWorkspaceSurface({
        channelId: deleteTarget.id,
        scope: "global"
      });
      if (result.registry && onSnapshotChange) {
        onSnapshotChange((current) =>
          removeSnapshotChannelAccount(replaceSnapshotChannelRegistry(current, result.registry!), deleteTarget.id)
        );
      }
      setDeleteTarget(null);
      setDeleteConfirmText("");
      toast.success("Surface account deleted everywhere.");
      void onRefresh().catch(() => {});
    } catch (error) {
      toast.error("Surface deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown surface error."
      });
    } finally {
      endSaving();
    }
  };

  const handleRepairSurfaceDrift = async () => {
    if (!workspace) {
      return;
    }

    beginSaving("Previewing OpenClaw binding repair...");

    try {
      const previewResponse = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ scope: "workspace", dryRun: true })
      });
      const previewResult = (await previewResponse.json()) as SurfaceReconcileResult;

      if (!previewResponse.ok || previewResult.error || !previewResult.repair?.auditId) {
        throw new Error(previewResult.error || "OpenClaw binding repair preview could not be created.");
      }

      const preview = previewResult.repair;
      const confirmed = window.confirm(
        [
          "Apply OpenClaw binding repair?",
          "",
          `${preview.addedBindingCount} binding${preview.addedBindingCount === 1 ? "" : "s"} will be added.`,
          `${preview.removedBindingCount} binding${preview.removedBindingCount === 1 ? "" : "s"} will be removed.`,
          `Preview audit: ${preview.auditId}`,
          "",
          "AgentOS will write a redacted backup snapshot before changing OpenClaw config."
        ].join("\n")
      );

      if (!confirmed) {
        toast.info("Binding repair preview created.", {
          description: `Audit ${preview.auditId} was written without changing OpenClaw config.`
        });
        return;
      }

      beginSaving("Applying OpenClaw binding repair...");
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scope: "workspace",
          dryRun: false,
          confirm: "apply-surface-reconcile",
          previewAuditId: preview.auditId
        })
      });
      const result = (await response.json()) as SurfaceReconcileResult;

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw bindings could not be reconciled.");
      }
      if (result.snapshot && onSnapshotChange) {
        onSnapshotChange(() => result.snapshot!);
      }

      const repair = result.repair;
      toast.success("OpenClaw bindings repaired.", {
        description: repair
          ? `${repair.addedBindingCount} added, ${repair.removedBindingCount} removed. Backup ${repair.backupId || "recorded"}.`
          : "Managed bindings were rewritten from the AgentOS registry."
      });
      void onRefresh().catch(() => {});
    } catch (error) {
      await showSurfaceMutationError("Binding repair failed.", error, handleRepairSurfaceDrift, ["operator.admin"]);
    } finally {
      endSaving();
    }
  };

  const deleteConfirmationValid = deleteTarget
    ? deleteConfirmText.trim().toLowerCase() === deleteTarget.name.trim().toLowerCase()
    : false;
  const provisionPreviewConfig = currentCatalogEntry.kind === "chat"
    ? null
    : buildProvisionConfig(currentCatalogEntry.provisionFields, provisionDraft);
  const provisionPreviewPath = currentCatalogEntry.kind === "chat"
    ? null
    : getProvisionConfigPath(currentCatalogEntry.provider);
  const provisionFieldsReady = currentCatalogEntry.provisionFields.every((field) =>
    isProvisionFieldSatisfied(field, provisionDraft)
  );
  const canProvisionSurface =
    currentCatalogEntry.supportsProvisioning &&
    !isSaving &&
    Boolean(newPrimaryAgentId) &&
    Boolean(getProvisionDraftText(provisionDraft, "name").trim()) &&
    provisionFieldsReady;

  const renderProvisionField = (field: SurfaceProvisionField) => {
    const fieldId = `surface-${field.key}`;
    const value = provisionDraft[field.key];

    if (field.inputType === "checkbox") {
      return (
        <label
          key={field.key}
          htmlFor={fieldId}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
        >
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(value)}
            disabled={isSaving}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.checked
              }))
            }
            className="mt-0.5 h-4 w-4 rounded border-white/20 bg-white/5 text-cyan-400 focus:ring-cyan-400/60"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{field.label}</p>
            {field.helpText ? <p className="mt-1 text-[11px] leading-4 text-slate-500">{field.helpText}</p> : null}
          </div>
        </label>
      );
    }

    return (
      <FormField key={field.key} label={field.label} htmlFor={fieldId}>
        {field.inputType === "select" ? (
          <select
            id={fieldId}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            className="flex h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
            disabled={isSaving}
          >
            <option value="">Select one</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : field.inputType === "textarea" ? (
          <Textarea
            id={fieldId}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            placeholder={field.placeholder}
            disabled={isSaving}
            className="min-h-20 rounded-xl px-3 py-2"
          />
        ) : (
          <Input
            id={fieldId}
            type={field.inputType === "number" ? "number" : field.secret ? "password" : field.inputType ?? "text"}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              setProvisionDraft((current) => ({
                ...current,
                [field.key]: event.target.value
              }))
            }
            placeholder={field.placeholder}
            disabled={isSaving}
            className="h-10 rounded-xl px-3"
          />
        )}
        {field.helpText ? <p className="text-[11px] leading-4 text-slate-500">{field.helpText}</p> : null}
      </FormField>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-[22px] p-0"
        closeClassName="right-3 top-3"
      >
        <div className="flex min-h-0 flex-1 flex-col">
        <DialogHeader className="border-b border-white/10 px-4 py-3 pr-12 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg">Workspace surfaces</DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                Manage accounts, owners, and routes for this workspace.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                {workspaceSurfaces.length} linked
              </Badge>
              <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                {allAccounts.length} accounts
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {isSaving && savingMessage ? (
          <div className="mx-4 mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-2 sm:mx-6">
            <div className="flex items-center gap-2 text-[11px] text-cyan-50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{savingMessage}</span>
            </div>
          </div>
        ) : null}

        {surfaceGatewayAccess.blocked ? (
          <div className="mx-4 mt-4 rounded-2xl border border-amber-300/25 bg-amber-400/[0.08] px-3 py-3 sm:mx-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-50">Gateway access blocked</p>
                  <p className="mt-1 text-xs leading-5 text-amber-100/80">
                    {surfaceGatewayAccess.issue ??
                      "OpenClaw Gateway pairing or scope approval is blocking live channel status."}
                  </p>
                  {surfaceGatewayAccess.missingScopes.length > 0 ? (
                    <p className="mt-1 text-[11px] text-amber-100/70">
                      Missing scopes: {surfaceGatewayAccess.missingScopes.join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
              {surfaceGatewayAccess.repairAction ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-full px-3 text-[11px] sm:shrink-0"
                  disabled={isSaving}
                  onClick={() =>
                    void repairGatewayAccessAndRetry(
                      surfaceGatewayAccess.repairAction!,
                      async () => {
                        await onRefresh();
                      },
                      surfaceGatewayAccess.missingScopes.length > 0
                        ? surfaceGatewayAccess.missingScopes
                        : ["operator.read"]
                    )
                  }
                >
                  Repair Gateway Access
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="grid min-h-0 gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.025] p-2.5 sm:sticky sm:top-0">
            <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as MissionControlSurfaceKind)}>
              <TabsList className="grid h-9 w-full grid-cols-3 rounded-xl">
                {availableKinds.map((kind) => (
                  <TabsTrigger key={kind} className="h-7 rounded-lg px-2 text-[11px]" value={kind}>
                    {formatSurfaceKindLabel(kind)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="mt-2.5 space-y-1.5">
              {providerOptions.map((provider) => {
                const entry = surfaceCatalogByProvider.get(provider) ?? getSurfaceCatalogEntry(provider);
                const providerSurfaceCount = workspaceSurfaces.filter((surface) => surface.type === provider).length;
                const providerAccountCount = allAccounts.filter((account) => account.type === provider).length;
                const providerRuntimeCount = Object.keys(
                  snapshot.surfaceRuntime.accountsByProvider[provider] ?? {}
                ).length;

                return (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => setActiveProvider(provider)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors",
                      activeProvider === provider
                        ? "border-cyan-300/35 bg-cyan-400/[0.08]"
                        : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <SurfaceIcon provider={provider} className="h-8 w-8 shrink-0" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{entry.label}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {Math.max(providerAccountCount, providerRuntimeCount)} account
                          {Math.max(providerAccountCount, providerRuntimeCount) === 1 ? "" : "s"} ·{" "}
                          {formatSurfaceRuntimeSource(snapshot.surfaceRuntime.source)}
                        </p>
                      </div>
                    </div>
                    <Badge variant="muted" className="h-5 shrink-0 rounded-full px-2 text-[10px]">
                      {providerSurfaceCount}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {workspaceDriftIssues.length > 0 ? (
              <section className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] p-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-amber-50">OpenClaw binding drift</p>
                      <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                        {workspaceDriftIssues.length} issue{workspaceDriftIssues.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/75">
                      AgentOS registry and OpenClaw runtime bindings differ for this workspace.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {formatSurfaceDriftSummary(workspaceDriftSummary).map((item) => (
                        <Badge key={item} variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[11px] sm:shrink-0"
                    disabled={isSaving || !snapshot.surfaceDrift.checked}
                    onClick={() => void handleRepairSurfaceDrift()}
                  >
                    Repair bindings
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {workspaceDriftIssues.slice(0, 4).map((issue) => (
                    <div key={issue.id} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                          {formatSurfaceProviderLabelFromCatalog(issue.provider, surfaceCatalogByProvider)}
                        </Badge>
                        <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                          {formatSurfaceDriftKind(issue.kind)}
                        </Badge>
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-white">{issue.title}</p>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-amber-100/75">
                        {formatSurfaceDriftIssueDetail(issue, resolveAgentDisplayName)}
                      </p>
                    </div>
                  ))}
                  {workspaceDriftIssues.length > 4 ? (
                    <p className="text-[11px] text-amber-100/65">
                      {workspaceDriftIssues.length - 4} more drift issue
                      {workspaceDriftIssues.length - 4 === 1 ? "" : "s"} hidden.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-white">{currentCatalogEntry.label} surfaces</p>
                <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                  {providerWorkspaceSurfaces.length} linked
                </Badge>
              </div>

              {providerWorkspaceSurfaces.length > 0 ? (
                <div className="mt-3 space-y-2.5">
                  {providerWorkspaceSurfaces.map((surface) => {
                    const workspaceBinding =
                      surface.workspaces.find((binding) => binding.workspaceId === workspace?.id) ?? null;
                    const assistantIds = (workspaceBinding?.agentIds ?? []).filter(
                      (agentId) => agentId !== surface.primaryAgentId
                    );
                    const availableAssistantAgents = workspaceAgents.filter(
                      (agent) =>
                        agent.id !== surface.primaryAgentId &&
                        !(workspaceBinding?.agentIds ?? []).includes(agent.id)
                    );
                    const currentAssignments = (workspaceBinding?.groupAssignments ?? []).filter(
                      (assignment) => assignment.enabled !== false
                    );
                    const visibleRouteAssignments = surface.workspaces.flatMap((binding) =>
                      (binding.groupAssignments ?? []).filter((assignment) => assignment.enabled !== false)
                    );
                    const externalRouteOwnersByRouteId = surface.workspaces
                      .filter((binding) => binding.workspaceId !== workspace?.id)
                      .flatMap((binding) =>
                        (binding.groupAssignments ?? [])
                          .filter((assignment) => assignment.enabled !== false && assignment.chatId)
                          .map((assignment) => ({
                            routeId: assignment.chatId,
                            workspaceName: resolveWorkspaceDisplayName(binding.workspaceId),
                            ownerName: assignment.agentId
                              ? resolveAgentDisplayName(assignment.agentId, assignment.agentId)
                              : `${resolveAgentDisplayName(surface.primaryAgentId, "Primary agent")} fallback`
                          }))
                      )
                      .reduce<Record<string, Array<{ workspaceName: string; ownerName: string }>>>(
                        (groups, owner) => ({
                          ...groups,
                          [owner.routeId]: [
                            ...(groups[owner.routeId] ?? []),
                            { workspaceName: owner.workspaceName, ownerName: owner.ownerName }
                          ]
                        }),
                        {}
                      );
                    const discoveredRoutes = discoveredRoutesBySurfaceId[surface.id] ?? [];
                    const isLoadingRoutes = Boolean(loadingRoutesBySurfaceId[surface.id]);
                    const routeError = routeErrorsBySurfaceId[surface.id] ?? null;
                    const routeOptions = buildSurfaceRouteOptions(
                      discoveredRoutes,
                      visibleRouteAssignments.length > 0 ? visibleRouteAssignments : currentAssignments,
                      surface.type
                    );
                    const primaryAgentIsInWorkspace = workspaceAgents.some(
                      (agent) => agent.id === surface.primaryAgentId
                    );
                    const runtimeStatus = getSurfaceAccountRuntime(snapshot, surface.type, surface.id);
                    const surfaceDriftIssues = activeProviderDriftIssues.filter(
                      (issue) => issue.accountId === surface.id || issue.accountId === toLegacySurfaceId(surface.id)
                    );

                    return (
                      <div
                        key={surface.id}
                        className="rounded-2xl border border-white/8 bg-white/[0.02] p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <SurfaceIcon provider={surface.type} className="h-9 w-9 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-white">{surface.name}</p>
                                <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                                  {formatSurfaceKindLabel(currentCatalogEntry.kind)}
                                </Badge>
                                <Badge
                                  variant="muted"
                                  className={cn(
                                    "h-5 rounded-full px-2 text-[10px]",
                                    getSurfaceRuntimeBadgeClass(runtimeStatus, surfaceGatewayAccess.blocked)
                                  )}
                                >
                                  {formatSurfaceAccountStatus(runtimeStatus, surfaceGatewayAccess.blocked)}
                                </Badge>
                                {surfaceDriftIssues.length > 0 ? (
                                  <Badge className="h-5 rounded-full border-amber-300/25 bg-amber-400/10 px-2 text-[10px] text-amber-100">
                                    Drift
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {surface.type}:{surface.id} · {formatSurfaceRuntimeSource(runtimeStatus?.source ?? snapshot.surfaceRuntime.source)}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              disabled={isSaving}
                              onClick={() => void handleDisconnectSurface(surface.id)}
                            >
                              <Link2 className="mr-1.5 h-3.5 w-3.5" />
                              Disconnect
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-8 w-8 rounded-full p-0"
                              disabled={isSaving}
                              aria-label={`Delete ${surface.name}`}
                              title="Delete everywhere"
                              onClick={() => {
                                const exactAccount = providerAccounts.find((entry) => entry.id === surface.id) ?? null;
                                const legacyAccount =
                                  exactAccount ??
                                  providerAccounts.find((entry) => toLegacySurfaceId(entry.id) === surface.id) ??
                                  null;
                                const account =
                                  exactAccount ??
                                  (legacyAccount ? { ...legacyAccount, id: surface.id } : null);
                                if (account) {
                                  setDeleteTarget(account);
                                  setDeleteConfirmText("");
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-4">
                          <SurfaceMetric label="Primary" value={resolveAgentDisplayName(surface.primaryAgentId)} />
                          <SurfaceMetric label="Assistants" value={String(assistantIds.length)} />
                          <SurfaceMetric label="Routes" value={String(currentAssignments.length)} />
                          <SurfaceMetric
                            label="Health"
                            value={formatSurfaceAccountStatus(runtimeStatus, surfaceGatewayAccess.blocked)}
                          />
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <FormField label={currentCatalogEntry.kind === "chat" ? "Primary agent" : "Owner agent"} htmlFor={`primary-${surface.id}`}>
                              <select
                                id={`primary-${surface.id}`}
                                value={surface.primaryAgentId ?? ""}
                                disabled={isSaving}
                                onChange={(event) => void handlePrimaryChange(surface.id, event.target.value)}
                                className="flex h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
                              >
                                <option value="">Select agent</option>
                                {surface.primaryAgentId && !primaryAgentIsInWorkspace ? (
                                  <option value={surface.primaryAgentId}>
                                    {resolveAgentDisplayName(surface.primaryAgentId, surface.primaryAgentId)} · outside this workspace
                                  </option>
                                ) : null}
                                {workspaceAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>
                                    {formatAgentDisplayName(agent)}
                                  </option>
                                ))}
                              </select>
                            </FormField>
                            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                              <UserRound className="h-3 w-3" />
                              {resolveAgentDisplayName(surface.primaryAgentId)}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                                Assistants available for routes
                              </p>
                              <p className="text-[11px] leading-4 text-slate-500">
                                Add an agent to the surface, then optionally assign it to a route.
                              </p>
                            </div>
                            {assistantIds.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {assistantIds.map((agentId) => (
                                  <button
                                    key={`${surface.id}-${agentId}`}
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => void handleRemoveAssistant(surface.id, agentId)}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.08]"
                                  >
                                    <span>{resolveAgentDisplayName(agentId, agentId)}</span>
                                    <span className="text-slate-500">remove</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] text-slate-400">No assistant agents attached yet.</p>
                            )}

                            {availableAssistantAgents.length > 0 ? (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                                  <select
                                    value={delegateDraftBySurfaceId[surface.id] ?? ""}
                                    disabled={isSaving}
                                    aria-label="Assistant agent"
                                    onChange={(event) =>
                                      setDelegateDraftBySurfaceId((current) => ({
                                        ...current,
                                        [surface.id]: event.target.value
                                      }))
                                    }
                                    className="flex h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none"
                                  >
                                    <option value="">Select assistant</option>
                                    {availableAssistantAgents.map((agent) => (
                                      <option key={agent.id} value={agent.id}>
                                        {formatAgentDisplayName(agent)}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={delegateRouteDraftBySurfaceId[surface.id] ?? ""}
                                    disabled={isSaving || routeOptions.length === 0}
                                    aria-label="Initial route assignment"
                                    onChange={(event) =>
                                      setDelegateRouteDraftBySurfaceId((current) => ({
                                        ...current,
                                        [surface.id]: event.target.value
                                      }))
                                    }
                                    className="flex h-9 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <option value="">
                                      {routeOptions.length > 0 ? "No route yet" : "No discovered routes"}
                                    </option>
                                    {routeOptions.map((route) => (
                                      <option key={`${surface.id}-target-${route.routeId}`} value={route.routeId}>
                                        Assign to {route.title ?? route.routeId}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-9 rounded-full px-3 text-[11px] sm:shrink-0"
                                  disabled={isSaving || !(delegateDraftBySurfaceId[surface.id] ?? "").trim()}
                                  onClick={() => void handleAddAssistant(surface.id)}
                                >
                                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                                  Add
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {currentCatalogEntry.supportsRouteDiscovery ? (
                          <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-white">
                                  {getSurfaceCatalogEntry(surface.type).label} routes
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500">Unassigned routes use the primary agent.</p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                disabled={isSaving || isLoadingRoutes}
                                onClick={() => void refreshSurfaceRoutes(surface.id, surface.type)}
                              >
                                {isLoadingRoutes ? (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Routes
                              </Button>
                            </div>

                            {routeError ? (
                              <p className="mt-3 text-[11px] text-rose-300">{routeError}</p>
                            ) : null}

                            {routeOptions.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {routeOptions.map((route) => {
                                  const currentAssignment =
                                    currentAssignments.find((assignment) => assignment.chatId === route.routeId) ?? null;
                                  const externalOwners = externalRouteOwnersByRouteId[route.routeId] ?? [];
                                  const enabled = Boolean(currentAssignment);
                                  const nextAssignments = enabled
                                    ? currentAssignments.filter((assignment) => assignment.chatId !== route.routeId)
                                    : [
                                        ...currentAssignments,
                                        {
                                          chatId: route.routeId,
                                          title: route.title ?? null,
                                          agentId: null,
                                          enabled: true
                                        }
                                      ];

                                  return (
                                    <div
                                      key={`${surface.id}:${route.routeId}`}
                                      className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
                                    >
                                      <div className="flex items-start gap-3">
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-4 w-4 rounded border-white/15 bg-white/5 accent-cyan-300"
                                          checked={enabled}
                                          disabled={isSaving}
                                          onChange={() => void updateSurfaceAssignments(surface.id, nextAssignments)}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="min-w-0">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate text-sm font-medium text-white">
                                                  {route.title ?? route.routeId}
                                                </p>
                                                <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                                                  {route.kind}
                                                </Badge>
                                              </div>
                                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                                {route.subtitle ?? route.routeId}
                                                {route.lastSeen ? ` · seen ${formatSurfaceTimestamp(route.lastSeen)}` : ""}
                                              </p>
                                              {externalOwners.length > 0 ? (
                                                <p className="mt-1 text-[11px] leading-4 text-amber-100/75">
                                                  Also routed in{" "}
                                                  {externalOwners
                                                    .map((owner) => `${owner.workspaceName} by ${owner.ownerName}`)
                                                    .join(", ")}
                                                </p>
                                              ) : null}
                                            </div>
                                            <div className="min-w-[190px] space-y-1">
                                              <p className="px-1 text-[9px] uppercase tracking-[0.14em] text-slate-500">
                                                Route owner
                                              </p>
                                              <select
                                                value={currentAssignment?.agentId ?? ""}
                                                disabled={isSaving || !enabled}
                                                onChange={(event) =>
                                                  void updateSurfaceAssignments(
                                                    surface.id,
                                                    currentAssignments.map((assignment) =>
                                                      assignment.chatId === route.routeId
                                                        ? {
                                                            ...assignment,
                                                            title: route.title ?? assignment.title ?? null,
                                                            agentId: event.target.value || null
                                                          }
                                                        : assignment
                                                    )
                                                  )
                                                }
                                                className="flex h-8 w-full rounded-full border border-white/10 bg-white/5 px-3 text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                              >
                                                <option value="">Primary fallback</option>
                                                {workspaceAgents.map((agent) => (
                                                  <option key={agent.id} value={agent.id}>
                                                    {formatAgentDisplayName(agent)}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-[11px] text-slate-500">
                                {getEmptyRouteDiscoveryCopy(surface.type)}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-500">
                  No {currentCatalogEntry.label} surfaces are linked to this workspace yet.
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-white">Connect {currentCatalogEntry.label}</p>
                <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                  {providerAccounts.length} available
                </Badge>
              </div>

              <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Existing accounts</p>
                  {providerAccounts.length > 0 ? (
                    providerAccounts.map((account) => {
                      const linked = isLinkedAccountId(account.id);
                      const runtimeStatus = getSurfaceAccountRuntime(snapshot, account.type, account.id);
                      return (
                        <div
                          key={account.id}
                          className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <SurfaceIcon provider={account.type} className="h-8 w-8 shrink-0" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-medium text-white">{account.name}</p>
                                <Badge
                                  variant="muted"
                                  className={cn(
                                    "h-5 rounded-full px-2 text-[10px]",
                                    getSurfaceRuntimeBadgeClass(runtimeStatus, surfaceGatewayAccess.blocked)
                                  )}
                                >
                                  {formatSurfaceAccountStatus(runtimeStatus, surfaceGatewayAccess.blocked)}
                                </Badge>
                              </div>
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {account.id} · {formatSurfaceRuntimeSource(runtimeStatus?.source ?? snapshot.surfaceRuntime.source)}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={linked ? "secondary" : "default"}
                            className="h-8 rounded-full px-3 text-[11px]"
                            disabled={isSaving || linked}
                            onClick={() => void handleAttachExisting(account)}
                          >
                            {linked ? "Linked" : (
                              <>
                                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                                Connect
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-500">
                      No {currentCatalogEntry.label} accounts found.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">Provision</p>
                    <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                      {currentCatalogEntry.supportsProvisioning ? "AgentOS" : "OpenClaw"}
                    </Badge>
                  </div>

                  {currentCatalogEntry.supportsProvisioning ? (
                    <>
                      <FormField label="Surface name" htmlFor="surface-name">
                        <Input
                          id="surface-name"
                          value={getProvisionDraftText(provisionDraft, "name")}
                          onChange={(event) =>
                            setProvisionDraft((current) => ({ ...current, name: event.target.value }))
                          }
                          placeholder={`${currentCatalogEntry.label} workspace surface`}
                          className="h-10 rounded-xl px-3"
                        />
                      </FormField>

                      {basicProvisionFields.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2">{basicProvisionFields.map(renderProvisionField)}</div>
                      ) : null}

                      {advancedProvisionFields.length > 0 ? (
                        <details className="rounded-xl border border-white/8 bg-white/[0.015] p-3">
                          <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                            Advanced settings
                          </summary>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {advancedProvisionFields.map(renderProvisionField)}
                          </div>
                        </details>
                      ) : null}

                      {provisionPreviewConfig && provisionPreviewPath ? (
                        <details className="rounded-xl border border-cyan-300/15 bg-cyan-400/[0.04] p-3">
                          <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-[0.16em] text-cyan-100">
                            Config preview
                          </summary>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
                              {provisionPreviewPath}
                            </Badge>
                          </div>
                          {currentCatalogEntry.provider === "gmail" ? (
                            <p className="mt-2 text-[11px] leading-5 text-cyan-100/70">Includes Gmail hook enablement.</p>
                          ) : null}
                          <pre className="mt-3 max-h-52 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-3 text-[11px] leading-5 text-slate-100">
                            {JSON.stringify(provisionPreviewConfig, null, 2)}
                          </pre>
                        </details>
                      ) : null}

                      <FormField label="Primary agent" htmlFor="surface-primary-agent">
                        <select
                          id="surface-primary-agent"
                          value={newPrimaryAgentId}
                          onChange={(event) => setNewPrimaryAgentId(event.target.value)}
                          className="flex h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                        >
                          <option value="">Select agent</option>
                          {workspaceAgents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {formatAgentDisplayName(agent)}
                            </option>
                          ))}
                        </select>
                      </FormField>

                      <Button
                        type="button"
                        className="h-10 rounded-full px-4 text-sm"
                        disabled={!canProvisionSurface}
                        onClick={() => void handleProvisionSurface()}
                      >
                        {isSaving ? (
                          "Provisioning..."
                        ) : (
                          <>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Provision
                          </>
                        )}
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-sm leading-5 text-slate-400">
                      Provisioning is not exposed for this OpenClaw provider in AgentOS. Existing OpenClaw accounts can
                      still be attached, monitored, and routed from this workspace.
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        </div>

        <DialogFooter className="border-t border-white/10 px-4 py-3 sm:px-5">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
        </div>
      </DialogContent>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Delete OpenClaw account</DialogTitle>
            <DialogDescription>
              This removes the account from every workspace overlay. For provider-backed chat accounts, AgentOS also asks
              OpenClaw to delete the underlying account when supported.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[20px] border border-rose-500/25 bg-rose-500/[0.08] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-rose-50">
                  Type {deleteTarget?.name ?? "the account name"} to confirm deletion.
                </p>
                <p className="mt-1 text-xs leading-5 text-rose-100/80">
                  This action removes the account overlay everywhere and may delete the underlying OpenClaw provider
                  account if the provider supports it.
                </p>
              </div>
            </div>
          </div>

          <FormField label={`Type ${deleteTarget?.name ?? ""} to confirm`} htmlFor="delete-surface-confirm">
            <Input
              id="delete-surface-confirm"
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder={deleteTarget?.name ?? ""}
            />
          </FormField>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteConfirmationValid || isSaving}
              onClick={() => void handleDeleteAccountEverywhere()}
            >
              {isSaving ? "Deleting..." : "Delete everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SurfaceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.018] px-3 py-2">
      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-[11px] text-slate-200">{value}</p>
    </div>
  );
}

function readSurfaceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown surface error.";
}

function isGatewayRecoveryCandidate(message: string) {
  if (isGatewayConfigRateLimitMessage(message)) {
    return false;
  }

  return /gateway|websocket|connection closed|service restart|ECONNREFUSED|ECONNRESET|socket hang up|unreachable|not reachable|timed out|timeout|scope upgrade|scope mismatch|missing operator/i.test(
    message
  );
}

function buildFallbackGatewayRepairAction(): GatewayAuthRepairAction {
  return {
    apiAction: "repairDeviceAccess",
    cta: "Repair access",
    label: "Gateway access",
    detail: "Approve any pending local AgentOS Gateway scope request, then retry."
  };
}

function mergeRuntimeSurfaceAccounts(
  configuredAccounts: ChannelAccountRecord[],
  runtimeAccounts: SurfaceAccountRuntimeStatus[]
) {
  const accountsById = new Map(configuredAccounts.map((account) => [account.id, account]));

  for (const runtimeAccount of runtimeAccounts) {
    if (accountsById.has(runtimeAccount.accountId)) {
      continue;
    }

    accountsById.set(runtimeAccount.accountId, {
      id: runtimeAccount.accountId,
      type: runtimeAccount.provider,
      name: runtimeAccount.name || runtimeAccount.label || runtimeAccount.accountId,
      enabled: runtimeAccount.enabled,
      kind: getSurfaceCatalogEntry(runtimeAccount.provider).kind,
      metadata: {
        runtimeOnly: true
      }
    });
  }

  return sortSurfaceAccounts(Array.from(accountsById.values()));
}

function getSurfaceAccountRuntime(
  snapshot: MissionControlSnapshot,
  provider: MissionControlSurfaceProvider,
  accountId: string
) {
  return (
    snapshot.surfaceRuntime.accountsByKey[`${provider}:${accountId}`] ??
    snapshot.surfaceRuntime.accountsByKey[`${provider}:${toLegacySurfaceId(accountId)}`] ??
    null
  );
}

function formatSurfaceRuntimeSource(source: MissionControlSnapshot["surfaceRuntime"]["source"]) {
  switch (source) {
    case "gateway-probe":
      return "Gateway probe";
    case "gateway-status":
      return "Gateway status";
    case "config-only":
      return "Config only";
    case "unavailable":
      return "Unavailable";
  }
}

function formatSurfaceAccountStatus(
  runtimeStatus: SurfaceAccountRuntimeStatus | null,
  gatewayBlocked: boolean
) {
  if (gatewayBlocked && !runtimeStatus) {
    return "Gateway blocked";
  }

  if (!runtimeStatus) {
    return "Unknown";
  }

  switch (runtimeStatus.status) {
    case "connected":
      return "Connected";
    case "running":
      return "Running";
    case "linked":
      return "Linked";
    case "configured":
      return "Configured";
    case "disabled":
      return "Disabled";
    case "failed":
      return "Failed";
    case "gateway-blocked":
      return "Gateway blocked";
    case "unknown":
      return "Unknown";
  }
}

function getSurfaceRuntimeBadgeClass(
  runtimeStatus: SurfaceAccountRuntimeStatus | null,
  gatewayBlocked: boolean
) {
  if (gatewayBlocked && !runtimeStatus) {
    return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  }

  switch (runtimeStatus?.status) {
    case "connected":
    case "running":
    case "linked":
      return "border-emerald-300/25 bg-emerald-400/10 text-emerald-100";
    case "configured":
      return "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
    case "disabled":
      return "border-slate-300/15 bg-slate-400/10 text-slate-300";
    case "failed":
      return "border-rose-300/25 bg-rose-400/10 text-rose-100";
    default:
      return "border-white/10 bg-white/[0.04] text-slate-300";
  }
}

function filterWorkspaceDriftIssues(issues: SurfaceBindingDriftIssue[], workspaceId: string | null) {
  if (!workspaceId) {
    return issues;
  }

  return issues.filter((issue) => !issue.workspaceId || issue.workspaceId === workspaceId);
}

function summarizeSurfaceDriftIssues(issues: SurfaceBindingDriftIssue[]) {
  return issues.reduce(
    (summary, issue) => {
      if (issue.kind === "missing-binding") {
        summary.missingBindings += 1;
      } else if (issue.kind === "extra-binding") {
        summary.extraBindings += 1;
      } else if (issue.kind === "agent-mismatch") {
        summary.agentMismatch += 1;
      } else if (issue.kind === "account-missing") {
        summary.accountMissing += 1;
      } else if (issue.kind === "provider-disabled") {
        summary.providerDisabled += 1;
      }
      return summary;
    },
    {
      missingBindings: 0,
      extraBindings: 0,
      agentMismatch: 0,
      accountMissing: 0,
      providerDisabled: 0
    }
  );
}

function formatSurfaceDriftSummary(summary: ReturnType<typeof summarizeSurfaceDriftIssues>) {
  return [
    summary.missingBindings > 0 ? `${summary.missingBindings} missing` : null,
    summary.extraBindings > 0 ? `${summary.extraBindings} extra` : null,
    summary.agentMismatch > 0 ? `${summary.agentMismatch} mismatch` : null,
    summary.accountMissing > 0 ? `${summary.accountMissing} account missing` : null,
    summary.providerDisabled > 0 ? `${summary.providerDisabled} disabled` : null
  ].filter((entry): entry is string => Boolean(entry));
}

function formatSurfaceDriftKind(kind: SurfaceBindingDriftIssue["kind"]) {
  switch (kind) {
    case "missing-binding":
      return "Missing";
    case "extra-binding":
      return "Extra";
    case "agent-mismatch":
      return "Mismatch";
    case "account-missing":
      return "Account";
    case "provider-disabled":
      return "Disabled";
  }
}

function formatSurfaceProviderLabelFromCatalog(
  provider: MissionControlSurfaceProvider,
  catalog: Map<MissionControlSurfaceProvider, SurfaceCatalogEntry>
) {
  return catalog.get(provider)?.label ?? getSurfaceCatalogEntry(provider).label;
}

function formatSurfaceDriftIssueDetail(
  issue: SurfaceBindingDriftIssue,
  resolveAgentDisplayName: (agentId: string | null | undefined, fallback?: string) => string
) {
  const route = issue.routeId ? ` route ${issue.routeId}` : "";
  const account = issue.accountId ? `${issue.provider}:${issue.accountId}` : issue.provider;
  const expected = issue.expectedAgentId ? resolveAgentDisplayName(issue.expectedAgentId, issue.expectedAgentId) : null;
  const actual = issue.actualAgentId ? resolveAgentDisplayName(issue.actualAgentId, issue.actualAgentId) : null;

  if (expected && actual) {
    return `${account}${route}: expected ${expected}, OpenClaw has ${actual}.`;
  }

  if (expected) {
    return `${account}${route}: expected ${expected}. ${issue.detail}`;
  }

  if (actual) {
    return `${account}${route}: OpenClaw has ${actual}. ${issue.detail}`;
  }

  return `${account}${route}: ${issue.detail}`;
}

function buildSurfaceRouteOptions(
  discoveredRoutes: DiscoveredSurfaceRoute[],
  currentAssignments: WorkspaceChannelGroupAssignment[],
  provider: MissionControlSurfaceProvider
) {
  const options = new Map<string, DiscoveredSurfaceRoute>();

  for (const route of discoveredRoutes) {
    options.set(route.routeId, route);
  }

  for (const assignment of currentAssignments) {
    options.set(assignment.chatId, {
      routeId: assignment.chatId,
      provider,
      kind: inferRouteKind(provider, assignment.chatId),
      title: assignment.title ?? options.get(assignment.chatId)?.title ?? null,
      subtitle: options.get(assignment.chatId)?.subtitle ?? null,
      lastSeen: options.get(assignment.chatId)?.lastSeen ?? null
    });
  }

  return Array.from(options.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.routeId;
    const rightLabel = right.title ?? right.routeId;
    return leftLabel.localeCompare(rightLabel);
  });
}

function getEmptyRouteDiscoveryCopy(provider: MissionControlSurfaceProvider) {
  if (provider === "telegram") {
    return "No Telegram groups found yet. Send one message in the target group, then refresh surface discovery.";
  }

  if (provider === "discord") {
    return "No Discord surfaces were discovered yet. Send one message in the target server, then refresh surface discovery.";
  }

  return "No surfaces were discovered yet for this provider.";
}

function formatSurfaceKindLabel(kind: MissionControlSurfaceKind) {
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function inferRouteKind(provider: MissionControlSurfaceProvider, routeId: string): DiscoveredSurfaceRoute["kind"] {
  if (provider === "telegram") {
    return "group";
  }

  if (provider === "discord") {
    if (routeId.startsWith("thread:")) {
      return "thread";
    }

    if (routeId.startsWith("role:")) {
      return "role";
    }

    return "channel";
  }

  return "channel";
}

function toLegacySurfaceId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatSurfaceTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}
