"use client";

import { Activity } from "lucide-react";
import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { backgroundActivityLabel, backgroundActivityNeedsAttention } from "@/components/mission-control/agent-background-activity";
import { Button } from "@/components/ui/button";
import type { AgentNodeData } from "@/components/mission-control/canvas-types";
import { cn } from "@/lib/utils";

export function AgentBackgroundActivityDialog({ open, onOpenChange, data, surfaceTheme }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AgentNodeData;
  surfaceTheme: "light" | "dark";
}) {
  const tasks = data.backgroundTasks ?? [];
  const muted = surfaceTheme === "light" ? "text-slate-600" : "text-slate-400";
  return <MissionControlDialogShell open={open} onOpenChange={onOpenChange}
    title="Background activity" description={`Automatic maintenance for ${data.agent.name}. These jobs continue when hidden from the canvas.`}
    icon={Activity} surfaceTheme={surfaceTheme} variant="quiet"
    contentClassName={cn("sm:w-[min(92vw,600px)] sm:h-[min(calc(100dvh-72px),580px)]", surfaceTheme === "light" && "mission-shell--light")}
    footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button asChild variant="secondary"><a href="/operations">Manage schedules</a></Button><Button onClick={() => onOpenChange(false)}>Done</Button></div>}>
    <div className="space-y-3 py-2">
      {tasks.length === 0 ? <p className={cn("p-3 text-sm", muted)}>OpenClaw has not reported any background jobs for this agent.</p> : tasks.map((task) => {
        const attention = backgroundActivityNeedsAttention(task);
        const heartbeat = task.metadata.systemOwnedMonitor === "heartbeat";
        return <section key={task.key} className={cn("rounded-xl border p-4", surfaceTheme === "light" ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.025]")}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{backgroundActivityLabel(task)}</h3><span className={cn("text-xs", attention ? "text-amber-600 dark:text-amber-300" : muted)}>{attention ? "Needs attention" : typeof task.metadata.operationStatus === "string" ? task.metadata.operationStatus.replaceAll("-", " ") : task.status}</span></div>
          <p className={cn("mt-2 text-xs", muted)}>{typeof task.metadata.scheduleLabel === "string" ? task.metadata.scheduleLabel : "Schedule not reported"}</p>
          <p className={cn("mt-1 text-xs", muted)}>{typeof task.metadata.dueLabel === "string" ? task.metadata.dueLabel : "Next run not reported"}</p>
          {typeof task.metadata.lastRunStatus === "string" ? <p className={cn("mt-1 text-xs", muted)}>Last run: {task.metadata.lastRunStatus}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant={attention ? "default" : "secondary"} disabled={attention ? !data.onReviewBackgroundTask && !data.onInspectBackgroundTask : !data.onInspectBackgroundTask} onClick={() => {
              onOpenChange(false);
              if (attention && data.onReviewBackgroundTask) data.onReviewBackgroundTask(task);
              else data.onInspectBackgroundTask?.(task, "overview");
            }}>{attention ? "Review result" : "View details"}</Button>
            {heartbeat ? <Button size="sm" variant="secondary" disabled={!data.onEdit} onClick={() => { onOpenChange(false); data.onEdit?.(data.agent.id); }}>Edit heartbeat</Button> : null}
          </div>
        </section>;
      })}
    </div>
  </MissionControlDialogShell>;
}
