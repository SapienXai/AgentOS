"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Eye, EyeOff, FolderKanban, Layers3, Orbit } from "lucide-react";
import { motion } from "motion/react";

import type { WorkspaceNodeData } from "@/components/mission-control/canvas-types";
import { resolveWorkspaceHealthBadgeClasses } from "@/components/mission-control/node-visual-tones";
import { Badge } from "@/components/ui/badge";
import { compactPath } from "@/lib/openclaw/presenters";
import { getWorkspaceNodeStyle } from "@/lib/openclaw/workspace-colors";
import { cn } from "@/lib/utils";

type WorkspaceFlowNode = Node<WorkspaceNodeData, "workspace">;

export function WorkspaceNode({ data, selected }: NodeProps<WorkspaceFlowNode>) {
  const canOpenWorkspaceFiles = Boolean(data.onOpenWorkspaceFiles);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={getWorkspaceNodeStyle(data.workspace.id)}
      className={cn(
        "workspace-node relative isolate h-full overflow-hidden rounded-[26px] border p-3 backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-[0.92]",
        selected && "workspace-node--selected"
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-4">
        {canOpenWorkspaceFiles ? (
          <motion.button
            type="button"
            aria-label={`Open workspace files for ${data.workspace.name}`}
            title="Open workspace files"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenWorkspaceFiles?.(data.workspace.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            whileHover={{ scale: 1.025, y: -1 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="workspace-node__workspace-action nodrag nopan group block min-w-0 max-w-[330px] space-y-1.5 text-left focus-visible:outline-none"
          >
            <span className="workspace-node__header inline-flex max-w-full items-center gap-2 rounded-full px-2.5 py-1.5">
              <span className="workspace-node__header-icon rounded-full p-1.5">
                <FolderKanban className="h-3 w-3" />
              </span>
              <span className="min-w-0">
                <span className="workspace-node__title block max-w-[220px] truncate font-display text-[12px] tracking-[0.04em]">
                  {data.workspace.name}
                </span>
                <span className="workspace-node__slug block text-[9px] uppercase tracking-[0.22em]">
                  {data.workspace.slug}
                </span>
              </span>
            </span>

            <span className="workspace-node__path block max-w-[300px] truncate pl-1 text-[9px] uppercase tracking-[0.16em]">
              {compactPath(data.workspace.path)}
            </span>
          </motion.button>
        ) : (
          <div className="min-w-0 space-y-1.5">
            <div className="workspace-node__header inline-flex items-center gap-2 rounded-full px-2.5 py-1.5">
              <div className="workspace-node__header-icon rounded-full p-1.5">
                <FolderKanban className="h-3 w-3" />
              </div>
              <div>
                <p className="workspace-node__title font-display text-[12px] tracking-[0.04em]">
                  {data.workspace.name}
                </p>
                <p className="workspace-node__slug text-[9px] uppercase tracking-[0.22em]">
                  {data.workspace.slug}
                </p>
              </div>
            </div>

            <p className="workspace-node__path max-w-[300px] truncate pl-1 text-[9px] uppercase tracking-[0.16em]">
              {compactPath(data.workspace.path)}
            </p>
          </div>
        )}

        <div className="flex shrink-0 max-w-[48%] flex-wrap items-center justify-end gap-1.5">
          <Badge
            variant="muted"
            data-health={data.workspace.health}
            className={cn("workspace-node__health", resolveWorkspaceHealthBadgeClasses(data.workspace.health))}
          >
            {data.workspace.health}
          </Badge>

          <div className="flex flex-wrap justify-end gap-1.5">
            <Metric icon={Orbit} label="Agents" value={String(data.workspace.agentIds.length)} />
            <Metric icon={Layers3} label="Models" value={String(data.workspace.modelIds.length)} />
            <TaskToggleMetric
              value={String(data.workspace.activeRuntimeIds.length)}
              taskCardsHidden={data.taskCardsHidden}
              disabled={data.taskCardCount === 0 || !data.onToggleTaskCards}
              onToggle={() => data.onToggleTaskCards?.()}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof FolderKanban;
  label: string;
  value: string;
}) {
  return (
    <div className="workspace-node__chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1">
      <Icon className="workspace-node__chip-icon h-3 w-3 text-inherit" />
      <span className="workspace-node__chip-label text-[9px] uppercase tracking-[0.16em] text-inherit">
        {label}
      </span>
      <span className="workspace-node__chip-value font-display text-[12px] text-inherit">{value}</span>
    </div>
  );
}

function TaskToggleMetric({
  value,
  taskCardsHidden,
  disabled,
  onToggle
}: {
  value: string;
  taskCardsHidden: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={taskCardsHidden}
      aria-label={taskCardsHidden ? "Show task cards in this workspace" : "Hide task cards in this workspace"}
      title={taskCardsHidden ? "Show task cards in this workspace" : "Hide task cards in this workspace"}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "workspace-node__chip workspace-node__task-toggle nodrag nopan inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
        disabled && "pointer-events-none"
      )}
    >
      {taskCardsHidden ? (
        <EyeOff className="workspace-node__chip-icon h-3 w-3 text-inherit" />
      ) : (
        <Eye className="workspace-node__chip-icon h-3 w-3 text-inherit" />
      )}
      <span
        className={cn(
          "workspace-node__chip-label text-[9px] uppercase tracking-[0.16em] text-inherit"
        )}
      >
        Runs
      </span>
      <span className="workspace-node__chip-value font-display text-[12px] text-inherit">{value}</span>
    </button>
  );
}
