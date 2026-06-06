"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { MissionSidebar } from "@/components/mission-control/sidebar";
import { useMissionControlPreferences } from "@/components/mission-control/use-mission-control-preferences";
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
import type { MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
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
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [loadedWorkspaceSelectionRoot, setLoadedWorkspaceSelectionRoot] = useState<string | null>(null);
  const activeWorkspace = useMemo(
    () =>
      activeWorkspaceId
        ? snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
        : null,
    [activeWorkspaceId, snapshot.workspaces]
  );
  const scopedSnapshot = useMemo(
    () => scopeMissionControlSnapshot(snapshot, activeWorkspaceId),
    [activeWorkspaceId, snapshot]
  );

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
    const resolvedWorkspaceId = resolveWorkspaceSelection(
      snapshot.workspaces.map((workspace) => workspace.id),
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

  return (
    <div
      className={cn(
        "mission-shell relative min-h-screen overflow-hidden bg-[#030814] text-slate-100",
        surfaceTheme === "light" && "mission-shell--light"
      )}
    >
      <div className="mission-canvas-backdrop fixed inset-0 z-0">
        <div aria-hidden="true" className="mission-canvas-pattern absolute inset-0 z-0 opacity-60" />
        <div
          aria-hidden="true"
          className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_54%_0%,rgba(37,99,235,0.16),transparent_32%),linear-gradient(180deg,rgba(2,6,17,0.12),rgba(2,6,17,0.58))]"
        />
      </div>

      <div
        className={cn(
          "fixed left-0 top-0 z-30 hidden h-[100dvh] overflow-hidden bg-[#050a12] shadow-[18px_0_60px_rgba(0,0,0,0.36)] transition-[width] duration-200 ease-out lg:block",
          sidebarExpanded ? "w-[256px]" : "w-[72px]"
        )}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        onFocusCapture={() => setSidebarExpanded(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setSidebarExpanded(false);
          }
        }}
      >
        <MissionSidebar
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          activeWorkspaceId={activeWorkspaceId}
          requestedAgentAction={null}
          connectionState={connectionState}
          collapsed={!sidebarExpanded}
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
          onToggleCollapsed={() => setSidebarExpanded((current) => !current)}
          onSelectWorkspace={setActiveWorkspaceId}
          onRefresh={refresh}
          onRunModelRefresh={() => toast.message("Model refresh is available from Mission Control setup.")}
          onRunModelDiscover={() => toast.message("Model discovery is available from Mission Control setup.")}
          onRunModelSetDefault={() => toast.message("Default model changes are not exposed on this page yet.")}
          onConnectModelProvider={(provider) => toast.message(`Open ${provider} setup from Mission Control to connect it.`)}
          onOpenModelSetup={() => toast.message("Model setup opens from Mission Control.")}
          onOpenAddModels={() => toast.message("Add Models opens from Mission Control.")}
          onOpenWorkspaceCreate={() => toast.message("Workspace creation opens from Mission Control.")}
          onEditWorkspace={() => toast.message("Workspace editing opens from Mission Control.")}
          onSnapshotChange={setSnapshot}
          onAgentCreatedVisible={() => {}}
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
          "fixed left-0 top-0 z-50 h-[100dvh] overflow-hidden bg-[#050a12] shadow-[18px_0_60px_rgba(0,0,0,0.42)] transition-[width] duration-200 ease-out lg:hidden",
          mobileSidebarOpen ? "w-[min(86vw,292px)]" : "w-[56px]"
        )}
        onClickCapture={(event) => {
          if (mobileSidebarOpen && event.target instanceof Element && event.target.closest("a")) {
            setMobileSidebarOpen(false);
          }
        }}
      >
        <MissionSidebar
          snapshot={snapshot}
          surfaceTheme={surfaceTheme}
          activeWorkspaceId={activeWorkspaceId}
          requestedAgentAction={null}
          connectionState={connectionState}
          collapsed={!mobileSidebarOpen}
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
          onOpenWorkspaceCreate={() => toast.message("Workspace creation opens from Mission Control.")}
          onEditWorkspace={() => toast.message("Workspace editing opens from Mission Control.")}
          onSnapshotChange={setSnapshot}
          onAgentCreatedVisible={() => {}}
        />
      </div>

      <main className={cn("relative z-20 min-h-screen pb-4 pl-[68px] pr-3 pt-4 sm:pl-[76px] sm:pr-5 lg:pl-[92px] lg:pr-4")}>
        <div className="mx-auto flex w-full max-w-[1880px] flex-col gap-3">
          <OperationsTopBar
            snapshot={snapshot}
            connectionState={connectionState}
            surfaceTheme={surfaceTheme}
            onRefresh={() => {
              void refresh();
            }}
            onToggleTheme={() => setSurfaceTheme((current) => (current === "light" ? "dark" : "light"))}
          />
          {children({
            snapshot: scopedSnapshot,
            rootSnapshot: snapshot,
            activeWorkspace,
            activeWorkspaceId,
            connectionState,
            surfaceTheme,
            refresh,
            setSnapshot
          })}
        </div>
      </main>
    </div>
  );
}
