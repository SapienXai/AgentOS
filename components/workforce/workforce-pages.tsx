"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

import { HumanControlInbox } from "@/components/operations/human-control-inbox";
import { OperationsShell, type OperationsShellContext } from "@/components/operations/operations-shell";
import { MissionDetailPage } from "@/components/workforce/mission-detail-page";
import { MissionListPage, TaskViewNavigation, type TaskView } from "@/components/workforce/mission-list-page";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceMissionListResponse, WorkforceMissionProjection } from "@/lib/agentos/workforce/types";

const ScheduledTasks = dynamic(() => import("@/components/operations/operations/operations-jobs-page-content").then(module => module.OperationsJobsPageContent));

export function WorkforceMissionsRoute({ initialSnapshot, initial }: { initialSnapshot: MissionControlSnapshot; initial: WorkforceMissionListResponse }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{context => (
    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading tasks…</p>}>
      <TaskDestination initial={initial} context={context} />
    </Suspense>
  )}</OperationsShell>;
}

function TaskDestination({ initial, context }: { initial: WorkforceMissionListResponse; context: OperationsShellContext }) {
  const requested = useSearchParams().get("view");
  const view: TaskView = requested === "progress" || requested === "needs-you" || requested === "completed" || requested === "scheduled" ? requested : "all";

  if (view === "scheduled") {
    return <><TaskViewNavigation view={view} /><ScheduledTasks scheduled snapshot={context.rootSnapshot}
      activeWorkspaceId={context.activeWorkspaceId} surfaceTheme={context.surfaceTheme} refresh={context.refresh} /></>;
  }
  return <MissionListPage initial={initial} snapshot={context.snapshot} activeWorkspaceId={context.activeWorkspaceId}
    connectionState={context.connectionState} attentionRefreshGeneration={context.attentionRefreshGeneration}
    surfaceTheme={context.surfaceTheme} refresh={context.refresh} view={view} />;
}

export function WorkforceMissionDetailRoute({ initialSnapshot, initial }: { initialSnapshot: MissionControlSnapshot; initial: WorkforceMissionProjection }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{(context) => <MissionDetailPage initial={initial} snapshot={context.snapshot} connectionState={context.connectionState} attentionRefreshGeneration={context.attentionRefreshGeneration} refresh={context.refresh} />}</OperationsShell>;
}

export function WorkforceHumanControlRoute({ initialSnapshot, missionId }: { initialSnapshot: MissionControlSnapshot; missionId: string | null }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{(context) => <><TaskViewNavigation view="needs-you" /><HumanControlInbox mode="page" missionId={missionId} surfaceTheme={context.surfaceTheme} attentionRefreshGeneration={context.attentionRefreshGeneration} /></>}</OperationsShell>;
}
