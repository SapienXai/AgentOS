"use client";

import dynamic from "next/dynamic";

import { OperationsShell } from "@/components/operations/operations-shell";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

const AccountsPageContent = dynamic(() => import("@/components/operations/accounts/accounts-page-content").then(module => module.AccountsPageContent));
const AgentsPageContent = dynamic(() => import("@/components/operations/agents/agents-page-content").then(module => module.AgentsPageContent));
const DashboardPageContent = dynamic(() => import("@/components/operations/dashboard/dashboard-page-content").then(module => module.DashboardPageContent));
const FilesPageContent = dynamic(() => import("@/components/operations/files/files-page-content").then(module => module.FilesPageContent));
const IntegrationsPageContent = dynamic(() => import("@/components/operations/integrations/integrations-page-content").then(module => module.IntegrationsPageContent));
const ChannelCenterPageContent = dynamic(() => import("@/components/operations/channels/channel-center-page-content").then(module => module.ChannelCenterPageContent));
const ModelsPageContent = dynamic(() => import("@/components/operations/models/models-page-content").then(module => module.ModelsPageContent));
const TasksPageContent = dynamic(() => import("@/components/operations/tasks/tasks-page-content").then(module => module.TasksPageContent));
const UpdatesPageContent = dynamic(() => import("@/components/operations/updates/updates-page-content").then(module => module.UpdatesPageContent));
const OperationsJobsPageContent = dynamic(() => import("@/components/operations/operations/operations-jobs-page-content").then(module => module.OperationsJobsPageContent));

export type OperationsPageId = "dashboard" | "agents" | "tasks" | "files" | "knowledge" | "accounts" | "models" | "channels" | "integrations" | "updates" | "operations";

export function OperationsPage({
  initialSnapshot,
  page,
  preferredWorkspaceId
}: {
  initialSnapshot: MissionControlSnapshot;
  page: OperationsPageId;
  preferredWorkspaceId?: string | null;
}) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot} preferredWorkspaceId={preferredWorkspaceId}>
      {(context) => {
        if (page === "dashboard") {
          return (
            <DashboardPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              activeWorkspace={context.activeWorkspace}
              activeWorkspaceId={context.activeWorkspaceId}
              connectionState={context.connectionState}
              attentionRefreshGeneration={context.attentionRefreshGeneration}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
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
              workspaceSelectionReady={context.workspaceSelectionReady}
              pendingAgentNames={context.pendingAgentNames}
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
              attentionRefreshGeneration={context.attentionRefreshGeneration}
            />
          );
        }

        if (page === "operations") {
          return <OperationsJobsPageContent snapshot={context.rootSnapshot} activeWorkspaceId={context.activeWorkspaceId} workspaceSelectionReady={context.workspaceSelectionReady} surfaceTheme={context.surfaceTheme} refresh={context.refresh} />;
        }

        if (page === "files" || page === "knowledge") {
          return (
            <FilesPageContent
              knowledge={page === "knowledge"}
              workspaceSelectionReady={page !== "knowledge" || context.workspaceSelectionReady}
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
              snapshot={context.rootSnapshot}
              surfaceTheme={context.surfaceTheme}
              refresh={context.refresh}
            />
          );
        }

        if (page === "updates") {
          return (
            <UpdatesPageContent
              snapshot={context.rootSnapshot}
              rootSnapshot={context.rootSnapshot}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        if (page === "channels") {
          return (
            <ChannelCenterPageContent
              rootSnapshot={context.rootSnapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              refresh={context.refresh}
            />
          );
        }

        return (
          <IntegrationsPageContent
            snapshot={context.snapshot}
            activeWorkspaceId={context.activeWorkspaceId}
            surfaceTheme={context.surfaceTheme}
            setSnapshot={context.setSnapshot}
          />
        );
      }}
    </OperationsShell>
  );
}
