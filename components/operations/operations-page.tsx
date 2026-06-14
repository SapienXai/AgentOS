"use client";

import { AccountsPageContent } from "@/components/operations/accounts/accounts-page-content";
import { AgentsPageContent } from "@/components/operations/agents/agents-page-content";
import { DashboardPageContent } from "@/components/operations/dashboard/dashboard-page-content";
import { FilesPageContent } from "@/components/operations/files/files-page-content";
import { IntegrationsPageContent } from "@/components/operations/integrations/integrations-page-content";
import { ModelsPageContent } from "@/components/operations/models/models-page-content";
import { OperationsShell } from "@/components/operations/operations-shell";
import { TasksPageContent } from "@/components/operations/tasks/tasks-page-content";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export type OperationsPageId = "dashboard" | "agents" | "tasks" | "files" | "accounts" | "models" | "integrations";

export function OperationsPage({
  initialSnapshot,
  page
}: {
  initialSnapshot: MissionControlSnapshot;
  page: OperationsPageId;
}) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot}>
      {(context) => {
        if (page === "dashboard") {
          return (
            <DashboardPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              activeWorkspace={context.activeWorkspace}
              activeWorkspaceId={context.activeWorkspaceId}
              connectionState={context.connectionState}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        if (page === "agents") {
          return (
            <AgentsPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        if (page === "tasks") {
          return (
            <TasksPageContent
              snapshot={context.snapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
            />
          );
        }

        if (page === "files") {
          return (
            <FilesPageContent
              snapshot={context.snapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              surfaceTheme={context.surfaceTheme}
            />
          );
        }

        if (page === "accounts") {
          return (
            <AccountsPageContent
              snapshot={context.snapshot}
              activeWorkspace={context.activeWorkspace}
              activeWorkspaceId={context.activeWorkspaceId}
              surfaceTheme={context.surfaceTheme}
            />
          );
        }

        if (page === "models") {
          return (
            <ModelsPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        return (
          <IntegrationsPageContent
            snapshot={context.snapshot}
            rootSnapshot={context.rootSnapshot}
            activeWorkspaceId={context.activeWorkspaceId}
            surfaceTheme={context.surfaceTheme}
            refresh={context.refresh}
            setSnapshot={context.setSnapshot}
          />
        );
      }}
    </OperationsShell>
  );
}
