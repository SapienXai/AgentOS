"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Menu } from "lucide-react";

import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { MissionSidebar } from "@/components/mission-control/sidebar";
import { useSidebarPinning } from "@/components/mission-control/use-sidebar-pinning";
import {
  buildPendingAgentRecord,
  buildPendingAgentsForWorkspaceResult,
  parsePendingAgentProjections,
  pendingAgentProjectionStorageKey,
  type PendingAgentProjection
} from "@/components/mission-control/pending-agent-projection";
import { useMissionControlPreferences } from "@/components/mission-control/use-mission-control-preferences";
import { WorkspaceWizardDialog } from "@/components/mission-control/workspace-wizard/workspace-wizard-dialog";
import {
  buildWorkspaceSelectionStorageKey,
  resolveWorkspaceSelection,
  serializeWorkspaceSelection,
  shouldDeferWorkspaceSelectionHydration
} from "@/components/mission-control/mission-control-shell.utils";
import { scopeMissionControlSnapshot } from "@/components/operations/operations-data";
import { OperationsTopBar } from "@/components/operations/operations-ui";
import { toast } from "@/components/ui/sonner";
import { useMissionControlData } from "@/hooks/use-mission-control-data";
import type { MissionControlSnapshot, WorkspaceCreateResult, WorkspacePlanDeployResult, WorkspaceRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

export type OperationsShellContext = {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
};

function loadPendingAgentProjections() {
  if (typeof globalThis.localStorage === "undefined") {
    return [];
  }

  return parsePendingAgentProjections(globalThis.localStorage.getItem(pendingAgentProjectionStorageKey));
}

function buildPendingWorkspaceRecord(workspaceId: string, pendingAgents: PendingAgentProjection[]): WorkspaceRecord {
  const firstAgent = pendingAgents[0];
  const workspacePath = firstAgent?.workspacePath ?? "";
  const workspaceName = firstAgent?.workspaceName ?? readPathBasename(workspacePath) ?? workspaceId;

  return {
    id: workspaceId,
    name: workspaceName,
    slug: workspaceId,
    path: workspacePath,
    kind: "workspace",
    agentIds: pendingAgents.map((agent) => agent.id),
    modelIds: pendingAgents.map((agent) => agent.modelId).filter(Boolean),
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "standby",
    bootstrap: {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      coreFiles: [],
      optionalFiles: [],
      folders: [],
      projectShell: [],
      localSkillIds: []
    },
    capabilities: {
      skills: [],
      tools: [],
      workspaceOnlyAgentCount: pendingAgents.filter((agent) => agent.policy.fileAccess === "workspace-only").length
    },
    channels: []
  };
}

function readPathBasename(value: string) {
  const normalized = value.trim().replace(/\/+$/g, "");

  if (!normalized) {
    return null;
  }

  return normalized.split("/").pop() || null;
}

export function OperationsShell({
  initialSnapshot,
  children
}: {
  initialSnapshot: MissionControlSnapshot;
  children: (context: OperationsShellContext) => ReactNode;
}) {
  const { snapshot, connectionState, refresh, setSnapshot } = useMissionControlData(initialSnapshot);
  const { surfaceTheme, setSurfaceTheme } = useMissionControlPreferences();
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    initialSnapshot.workspaces[0]?.id ?? null
  );
  const [sidebarExpandedState, setSidebarExpanded] = useState(false);
  const { isSidebarPinned, setIsSidebarPinned } = useSidebarPinning();
  const sidebarExpanded = isSidebarPinned || sidebarExpandedState;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [loadedWorkspaceSelectionRoot, setLoadedWorkspaceSelectionRoot] = useState<string | null>(null);
  const [isWorkspaceWizardOpen, setIsWorkspaceWizardOpen] = useState(false);
  const [workspaceWizardInitialMode, setWorkspaceWizardInitialMode] = useState<"basic" | "advanced">("basic");
  const [workspaceWizardEditId, setWorkspaceWizardEditId] = useState<string | null>(null);
  const [isCreateAgentDialogOpen, setIsCreateAgentDialogOpen] = useState(false);
  const [pendingCreatedAgents, setPendingCreatedAgents] = useState<PendingAgentProjection[]>(loadPendingAgentProjections);
  const liveAgentIds = useMemo(() => new Set(snapshot.agents.map((agent) => agent.id)), [snapshot.agents]);
  const visiblePendingCreatedAgents = useMemo(
    () => pendingCreatedAgents.filter((agent) => !liveAgentIds.has(agent.id)),
    [liveAgentIds, pendingCreatedAgents]
  );
  const activePendingAgents = useMemo(
    () => activeWorkspaceId
      ? visiblePendingCreatedAgents.filter((agent) => agent.workspaceId === activeWorkspaceId)
      : [],
    [activeWorkspaceId, visiblePendingCreatedAgents]
  );
  const activePendingWorkspace = useMemo(
    () =>
      activeWorkspaceId && activePendingAgents.length > 0 && !snapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId)
        ? buildPendingWorkspaceRecord(activeWorkspaceId, activePendingAgents)
        : null,
    [activePendingAgents, activeWorkspaceId, snapshot.workspaces]
  );
  const uiSnapshot = useMemo<MissionControlSnapshot>(() => {
    if (!activePendingWorkspace) {
      return snapshot;
    }

    return {
      ...snapshot,
      workspaces: [...snapshot.workspaces, activePendingWorkspace],
      agents: [
        ...snapshot.agents,
        ...activePendingAgents.map(buildPendingAgentRecord)
      ]
    };
  }, [activePendingAgents, activePendingWorkspace, snapshot]);
  const activeWorkspace = useMemo(
    () =>
      activeWorkspaceId
        ? uiSnapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
        : null,
    [activeWorkspaceId, uiSnapshot.workspaces]
  );
  const scopedSnapshot = useMemo(
    () => scopeMissionControlSnapshot(uiSnapshot, activeWorkspaceId),
    [activeWorkspaceId, uiSnapshot]
  );

  const handleSidebarPinToggle = useCallback(() => {
    const nextPinned = !isSidebarPinned;
    setIsSidebarPinned(nextPinned);
    setSidebarExpanded(nextPinned);
  }, [isSidebarPinned, setIsSidebarPinned]);

  useEffect(() => {
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;

    root.classList.toggle("dark", surfaceTheme !== "light");
    root.style.colorScheme = surfaceTheme === "light" ? "light" : "dark";

    return () => {
      root.classList.toggle("dark", hadDarkClass);
      root.style.colorScheme = previousColorScheme;
    };
  }, [surfaceTheme]);

  useEffect(() => {
    if (!mobileSidebarOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const workspaceRoot = snapshot.diagnostics.workspaceRoot;

    if (loadedWorkspaceSelectionRoot === workspaceRoot) {
      return;
    }

    if (shouldDeferWorkspaceSelectionHydration(snapshot)) {
      return;
    }

    const workspaceSelectionStorageKey = buildWorkspaceSelectionStorageKey(workspaceRoot);
    const storedWorkspaceId = globalThis.localStorage?.getItem(workspaceSelectionStorageKey) ?? null;
    const selectableWorkspaceIds = Array.from(new Set([
      ...snapshot.workspaces.map((workspace) => workspace.id),
      ...visiblePendingCreatedAgents.map((agent) => agent.workspaceId)
    ]));
    const resolvedWorkspaceId = resolveWorkspaceSelection(
      selectableWorkspaceIds,
      storedWorkspaceId,
      activeWorkspaceId
    );

    queueMicrotask(() => {
      if (resolvedWorkspaceId !== activeWorkspaceId) {
        setActiveWorkspaceId(resolvedWorkspaceId);
      }

      setLoadedWorkspaceSelectionRoot(workspaceRoot);
    });
  }, [
    activeWorkspaceId,
    loadedWorkspaceSelectionRoot,
    visiblePendingCreatedAgents,
    snapshot
  ]);

  useEffect(() => {
    const workspaceRoot = snapshot.diagnostics.workspaceRoot;

    if (loadedWorkspaceSelectionRoot !== workspaceRoot) {
      return;
    }

    const storage = globalThis.localStorage;

    if (typeof storage === "undefined") {
      return;
    }

    storage.setItem(
      buildWorkspaceSelectionStorageKey(workspaceRoot),
      serializeWorkspaceSelection(activeWorkspaceId)
    );
  }, [activeWorkspaceId, loadedWorkspaceSelectionRoot, snapshot.diagnostics.workspaceRoot]);

  useEffect(() => {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }

    if (visiblePendingCreatedAgents.length === 0) {
      globalThis.localStorage.removeItem(pendingAgentProjectionStorageKey);
      return;
    }

    globalThis.localStorage.setItem(pendingAgentProjectionStorageKey, JSON.stringify(visiblePendingCreatedAgents));
  }, [visiblePendingCreatedAgents]);

  const openWorkspaceWizard = (mode: "basic" | "advanced" = "basic") => {
    setWorkspaceWizardEditId(null);
    setWorkspaceWizardInitialMode(mode);
    setIsWorkspaceWizardOpen(true);
  };

  const openWorkspaceWizardForEdit = (workspaceId: string) => {
    setWorkspaceWizardEditId(workspaceId);
    setWorkspaceWizardInitialMode("advanced");
    setIsWorkspaceWizardOpen(true);
  };

  const handleWorkspaceWizardOpenChange = (nextOpen: boolean) => {
    setIsWorkspaceWizardOpen(nextOpen);

    if (!nextOpen) {
      setWorkspaceWizardEditId(null);
      setWorkspaceWizardInitialMode("basic");
    }
  };

  const handleWorkspaceCreated = (result: WorkspaceCreateResult | WorkspacePlanDeployResult) => {
    const pendingAgents = buildPendingAgentsForWorkspaceResult(result);

    if (pendingAgents.length > 0) {
      const pendingAgentIds = new Set(pendingAgents.map((agent) => agent.id));
      setPendingCreatedAgents((current) => [
        ...current.filter((agent) => !pendingAgentIds.has(agent.id)),
        ...pendingAgents
      ]);
    }

    setActiveWorkspaceId(result.workspaceId);
  };

  const handleAgentCreationPending = (agent: PendingAgentProjection) => {
    setPendingCreatedAgents((current) => [
      ...current.filter((pendingAgent) => pendingAgent.id !== agent.id),
      agent
    ]);
    setActiveWorkspaceId(agent.workspaceId);
  };

  const handleCreatedAgentVisible = (agentId: string) => {
    setPendingCreatedAgents((current) => current.filter((agent) => agent.id !== agentId));
  };

  return (
    <div
      className={cn(
        "mission-shell relative min-h-screen overflow-hidden bg-background text-foreground",
        surfaceTheme === "light" && "mission-shell--light"
      )}
    >
      <div className="mission-canvas-backdrop fixed inset-0 z-0">
        <div aria-hidden="true" className="mission-canvas-pattern absolute inset-0 z-0 opacity-60" />
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_54%_0%,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(180deg,hsl(var(--background)/0.10),hsl(var(--background)/0.58))]"
        />
      </div>

      <div
        className={cn(
          "pointer-events-auto fixed left-0 top-0 z-30 hidden h-[100dvh] overflow-visible mission-ease-smooth transition-[width] duration-500 lg:block",
          sidebarExpanded
            ? "w-[calc(100vw-96px)] max-w-[292px] lg:w-[292px] lg:max-w-none"
            : "w-[56px]"
        )}
        onMouseEnter={() => {
          if (!isSidebarPinned) setSidebarExpanded(true);
        }}
        onMouseLeave={() => {
          if (!isSidebarPinned) setSidebarExpanded(false);
        }}
        onFocusCapture={() => {
          if (!isSidebarPinned) setSidebarExpanded(true);
        }}
        onBlurCapture={(event) => {
          if (!isSidebarPinned && !event.currentTarget.contains(event.relatedTarget)) {
            setSidebarExpanded(false);
          }
        }}
      >
        <MissionSidebar
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
          activeWorkspaceId={activeWorkspaceId}
          pendingCreatedAgents={visiblePendingCreatedAgents}
          requestedAgentAction={null}
          connectionState={connectionState}
          collapsed={!sidebarExpanded}
          sidebarPinned={isSidebarPinned}
          modelManager={{
            runState: "idle",
            statusMessage: null,
            resultMessage: null,
            log: "",
            manualCommand: null,
            docsUrl: null,
            discoveredModels: [],
            systemReady: snapshot.diagnostics.health === "healthy"
          }}
          onExpandCollapsed={() => setSidebarExpanded(true)}
          onToggleCollapsed={handleSidebarPinToggle}
          onSelectWorkspace={setActiveWorkspaceId}
          onRefresh={refresh}
          onRunModelRefresh={() => toast.message("Model refresh is available from Mission Control setup.")}
          onRunModelDiscover={() => toast.message("Model discovery is available from Mission Control setup.")}
          onRunModelSetDefault={() => toast.message("Default model changes are not exposed on this page yet.")}
          onConnectModelProvider={(provider) => toast.message(`Open ${provider} setup from Mission Control to connect it.`)}
          onOpenModelSetup={() => toast.message("Model setup opens from Mission Control.")}
          onOpenAddModels={() => toast.message("Add Models opens from Mission Control.")}
          onOpenCreateAgent={() => {
            setSidebarExpanded(true);
            setIsCreateAgentDialogOpen(true);
          }}
          onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
          onEditWorkspace={openWorkspaceWizardForEdit}
          onSnapshotChange={setSnapshot}
          onAgentCreationPending={handleAgentCreationPending}
          onAgentCreatedVisible={handleCreatedAgentVisible}
        />
      </div>

      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/62 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}

      <div
        className={cn(
          "pointer-events-auto fixed left-0 top-0 z-50 h-[100dvh] w-[min(86vw,292px)] overflow-hidden mission-ease-smooth bg-[#050a12] shadow-[18px_0_60px_rgba(0,0,0,0.42)] transition-transform duration-300 [&_button]:min-h-11 lg:hidden",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!mobileSidebarOpen}
        inert={!mobileSidebarOpen}
        onClickCapture={(event) => {
          if (mobileSidebarOpen && event.target instanceof Element && event.target.closest("a")) {
            setMobileSidebarOpen(false);
          }
        }}
      >
        <MissionSidebar
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
          activeWorkspaceId={activeWorkspaceId}
          pendingCreatedAgents={visiblePendingCreatedAgents}
          requestedAgentAction={null}
          connectionState={connectionState}
          collapsed={false}
          modelManager={{
            runState: "idle",
            statusMessage: null,
            resultMessage: null,
            log: "",
            manualCommand: null,
            docsUrl: null,
            discoveredModels: [],
            systemReady: snapshot.diagnostics.health === "healthy"
          }}
          onExpandCollapsed={() => setMobileSidebarOpen(true)}
          onToggleCollapsed={() => setMobileSidebarOpen((current) => !current)}
          onSelectWorkspace={setActiveWorkspaceId}
          onRefresh={refresh}
          onRunModelRefresh={() => toast.message("Model refresh is available from Mission Control setup.")}
          onRunModelDiscover={() => toast.message("Model discovery is available from Mission Control setup.")}
          onRunModelSetDefault={() => toast.message("Default model changes are not exposed on this page yet.")}
          onConnectModelProvider={(provider) => toast.message(`Open ${provider} setup from Mission Control to connect it.`)}
          onOpenModelSetup={() => toast.message("Model setup opens from Mission Control.")}
          onOpenAddModels={() => toast.message("Add Models opens from Mission Control.")}
          onOpenCreateAgent={() => {
            setMobileSidebarOpen(false);
            setIsCreateAgentDialogOpen(true);
          }}
          onOpenWorkspaceCreate={() => openWorkspaceWizard("basic")}
          onEditWorkspace={openWorkspaceWizardForEdit}
          onSnapshotChange={setSnapshot}
          onAgentCreationPending={handleAgentCreationPending}
          onAgentCreatedVisible={handleCreatedAgentVisible}
        />
      </div>

      <main
        className={cn(
          "operations-content mission-ease-smooth relative z-20 min-h-screen px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-0 transition-[padding] duration-500 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11 sm:px-5 sm:[&_a]:min-h-0 sm:[&_a]:min-w-0 sm:[&_button]:min-h-0 sm:[&_button]:min-w-0 sm:[&_input]:min-h-0 sm:[&_select]:min-h-0 lg:pb-4 lg:pr-4 lg:pt-4",
          sidebarExpanded ? "lg:pl-[316px]" : "lg:pl-[80px]"
        )}
      >
        <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-3">
          <div className="sticky top-0 z-30 -mx-3 flex min-h-14 items-center gap-3 border-b border-border bg-background/92 px-3 backdrop-blur-xl sm:-mx-5 sm:px-5 lg:hidden">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card/80 text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{activeWorkspace?.name ?? "All workspaces"}</p>
              <p className="truncate text-[0.65rem] text-muted-foreground">AgentOS operations</p>
            </div>
            <OperationsTopBar
              compact
              snapshot={snapshot}
              connectionState={connectionState}
              surfaceTheme={surfaceTheme}
              onRefresh={() => {
                void refresh();
              }}
              onSnapshotChange={setSnapshot}
              onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            />
          </div>
          <div className="hidden lg:block">
            <OperationsTopBar
              snapshot={snapshot}
              connectionState={connectionState}
              surfaceTheme={surfaceTheme}
              onRefresh={() => {
                void refresh();
              }}
              onSnapshotChange={setSnapshot}
              onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
            />
          </div>
          {children({
            snapshot: scopedSnapshot,
            rootSnapshot: uiSnapshot,
            activeWorkspace,
            activeWorkspaceId,
            connectionState,
            surfaceTheme,
            refresh,
            setSnapshot
          })}
        </div>
      </main>

      <WorkspaceWizardDialog
        key={workspaceWizardEditId ? `workspace-edit:${workspaceWizardEditId}` : "workspace-create"}
        open={isWorkspaceWizardOpen}
        onOpenChange={handleWorkspaceWizardOpenChange}
        initialMode={workspaceWizardInitialMode}
        workspaceEditId={workspaceWizardEditId}
        surfaceTheme={surfaceTheme}
        snapshot={snapshot}
        onRefresh={refresh}
        onWorkspaceCreated={handleWorkspaceCreated}
        onWorkspaceUpdated={setActiveWorkspaceId}
      />

      <CreateAgentDialog
        open={isCreateAgentDialogOpen}
        onOpenChange={setIsCreateAgentDialogOpen}
        snapshot={uiSnapshot}
        defaultWorkspaceId={activeWorkspaceId}
        onRefresh={refresh}
        onSnapshotChange={setSnapshot}
        onAgentCreationPending={handleAgentCreationPending}
        onAgentCreatedVisible={handleCreatedAgentVisible}
        surfaceTheme={surfaceTheme}
      />
    </div>
  );
}
