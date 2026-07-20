"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Activity, Bot, ChevronDown, Cpu, Eye, EyeOff, FolderKanban, Layers3, Orbit, Plus } from "lucide-react";

import type { WorkspaceMenuKind, WorkspaceMenuState, WorkspaceNodeData } from "@/components/mission-control/canvas-types";
import { resolveWorkspaceHealthBadgeClasses } from "@/components/mission-control/node-visual-tones";
import { Badge } from "@/components/ui/badge";
import { compactPath } from "@/lib/openclaw/presenters";
import { getWorkspaceNodeStyle } from "@/lib/openclaw/workspace-colors";
import { cn } from "@/lib/utils";

type WorkspaceFlowNode = Node<WorkspaceNodeData, "workspace">;

export function WorkspaceNode({ data, selected }: NodeProps<WorkspaceFlowNode>) {
  const canOpenWorkspaceContextEngine = Boolean(data.onOpenWorkspaceContextEngine);

  return (
    <div
      style={getWorkspaceNodeStyle(data.workspace.id)}
      className={cn(
        "workspace-node relative isolate h-full overflow-visible rounded-[26px] border p-3",
        data.emphasis ? "opacity-100" : "opacity-[0.92]",
        selected && "workspace-node--selected"
      )}
    >
      <div className="relative z-10 flex items-start justify-between gap-4">
        {canOpenWorkspaceContextEngine ? (
          <button
            type="button"
            aria-label={`Open Context Engine for ${data.workspace.name}`}
            title="Open Context Engine"
            onClick={(event) => {
              event.stopPropagation();
              data.onOpenWorkspaceContextEngine?.(data.workspace.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
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
          </button>
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
            <WorkspaceCollectionMenu
              icon={Orbit}
              workspaceId={data.workspace.id}
              kind="agents"
              label="Agents"
              value={String(data.agents.length)}
              entries={data.agents.map((agent) => ({ id: agent.id, label: agent.name || agent.id, detail: agent.modelId || "No model" }))}
              emptyLabel="No agents in this workspace"
              actionLabel="Create agent"
              surfaceTheme={data.surfaceTheme ?? "dark"}
              openMenu={data.openMenu}
              onOpenMenuChange={data.onMenuChange}
              onSelect={(agentId) => {
                data.onSelectEntity?.(agentId);
              }}
              onAction={() => {
                data.onCreateAgent?.(data.workspace.id);
              }}
            />
            <WorkspaceCollectionMenu
              icon={Layers3}
              workspaceId={data.workspace.id}
              kind="models"
              label="Models"
              value={String(data.models.length)}
              entries={data.models.map((model) => ({ id: model.id, label: model.name || model.id, detail: model.provider }))}
              emptyLabel="No models used in this workspace"
              actionLabel="Add model"
              surfaceTheme={data.surfaceTheme ?? "dark"}
              openMenu={data.openMenu}
              onOpenMenuChange={data.onMenuChange}
              onSelect={(modelId) => {
                data.onSelectEntity?.(modelId);
              }}
              onAction={() => {
                data.onAddModel?.(data.workspace.id);
              }}
            />
            <TaskFilterMetric
              value={String(data.taskCardFilter === "active" ? data.activeTaskCardCount : data.taskCardCount)}
              filter={data.taskCardFilter}
              workspaceId={data.workspace.id}
              disabled={data.taskCardCount === 0 || !data.onTaskCardFilterChange}
              surfaceTheme={data.surfaceTheme ?? "dark"}
              openMenu={data.openMenu}
              onOpenMenuChange={data.onMenuChange}
              onChange={(filter) => data.onTaskCardFilterChange?.(filter)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceCollectionMenu({
  icon: Icon,
  workspaceId,
  kind,
  label,
  value,
  entries,
  emptyLabel,
  actionLabel,
  surfaceTheme,
  openMenu,
  onOpenMenuChange,
  onSelect,
  onAction
}: {
  icon: typeof FolderKanban;
  workspaceId: string;
  kind: WorkspaceMenuKind;
  label: string;
  value: string;
  entries: Array<{ id: string; label: string; detail: string }>;
  emptyLabel: string;
  actionLabel: string;
  surfaceTheme: "dark" | "light";
  openMenu: WorkspaceMenuState | null;
  onOpenMenuChange?: (menu: WorkspaceMenuState | null) => void;
  onSelect: (id: string) => void;
  onAction: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visible = openMenu?.workspaceId === workspaceId && openMenu.kind === kind;
  const menuPosition = visible ? openMenu.position : null;
  const isLight = surfaceTheme === "light" || (typeof document !== "undefined" && Boolean(document.querySelector(".mission-shell--light")));

  useEffect(() => {
    if (!visible) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;

      onOpenMenuChange?.(null);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [onOpenMenuChange, visible]);

  const closeMenu = () => {
    onOpenMenuChange?.(null);
  };

  const toggleMenu = (trigger: HTMLButtonElement) => {
    const nextOpen = !visible;
    if (!nextOpen) {
      onOpenMenuChange?.(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    onOpenMenuChange?.({
      workspaceId,
      kind,
      position: {
        left: Math.max(8, Math.min(window.innerWidth - 212, rect.right - 204)),
        top: rect.bottom + 220 > window.innerHeight ? Math.max(8, rect.top - 212) : rect.bottom + 8
      }
    });
  };

  return (
    <div className="nodrag nopan relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label} in workspace`}
        aria-expanded={visible}
        aria-haspopup="menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu(event.currentTarget);
        }}
        className="workspace-node__chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      >
        <Icon className="workspace-node__chip-icon h-3 w-3 text-inherit" />
        <span className="workspace-node__chip-label text-[9px] uppercase tracking-[0.16em] text-inherit">{label}</span>
        <span className="workspace-node__chip-value font-display text-[12px] text-inherit">{value}</span>
      </button>
      {visible && menuPosition ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${label} in this workspace`}
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            width: 204,
            zIndex: 10000,
            color: isLight ? "#3f2f24" : "#f1f5f9",
            background: isLight ? "rgba(255, 250, 246, 0.98)" : "rgba(2, 6, 23, 0.95)",
            borderColor: isLight ? "#ddcdbf" : "rgba(255, 255, 255, 0.1)",
            boxShadow: isLight ? "0 18px 42px rgba(82, 60, 46, 0.18)" : "0 18px 42px rgba(0, 0, 0, 0.42)"
          }}
          className={cn(
            "fixed z-[10000] w-[204px] overflow-hidden rounded-[12px] border p-1",
            isLight
              ? "border-[#ddcdbf] bg-[#fffaf6]/98 text-[#3f2f24] shadow-[0_18px_42px_rgba(82,60,46,0.18)]"
              : "border-white/[0.1] bg-slate-950/95 text-slate-100 shadow-[0_18px_42px_rgba(0,0,0,0.42)]"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="max-h-[156px] space-y-0.5 overflow-y-auto">
            {entries.length > 0 ? (
              entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onSelect(entry.id);
                  }}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left transition",
                    isLight ? "hover:bg-[#f4e9e0]" : "hover:bg-white/[0.07]"
                  )}
                >
                  {label === "Agents" ? <Bot className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-[#7f5e4b]" : "text-cyan-200")} /> : <Cpu className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-[#7b5b83]" : "text-violet-200")} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium">{entry.label}</span>
                    <span className={cn("block truncate text-[9px]", isLight ? "text-[#806657]" : "text-slate-400")}>{entry.detail}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className={cn("px-2 py-2.5 text-center text-[9px]", isLight ? "text-[#806657]" : "text-slate-400")}>{emptyLabel}</p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onAction();
            }}
            className={cn(
              "mt-1 flex w-full items-center justify-center gap-1.5 rounded-[8px] border px-2 py-1.5 text-[9px] font-semibold transition",
              isLight
                ? "border-[#ddcdbf] bg-[#f7eee8] text-[#4f3d31] hover:bg-[#efe0d5]"
                : "border-white/[0.1] bg-white/[0.05] text-white hover:bg-white/[0.1]"
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            {actionLabel}
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function TaskFilterMetric({
  value,
  filter,
  workspaceId,
  disabled,
  surfaceTheme,
  openMenu,
  onOpenMenuChange,
  onChange
}: {
  value: string;
  filter: WorkspaceNodeData["taskCardFilter"];
  workspaceId: string;
  disabled: boolean;
  surfaceTheme: "dark" | "light";
  openMenu: WorkspaceMenuState | null;
  onOpenMenuChange?: (menu: WorkspaceMenuState | null) => void;
  onChange: (filter: WorkspaceNodeData["taskCardFilter"]) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const open = openMenu?.workspaceId === workspaceId && openMenu.kind === "runs";
  const menuPosition = open ? openMenu.position : null;
  const label = filter === "active" ? "Active Runs" : filter === "hidden" ? "Runs Hidden" : "Runs";
  const Icon = filter === "active" ? Activity : filter === "hidden" ? EyeOff : Eye;
  const isLight = surfaceTheme === "light" || (typeof document !== "undefined" && Boolean(document.querySelector(".mission-shell--light")));
  const options: Array<{
    value: WorkspaceNodeData["taskCardFilter"];
    label: string;
    detail: string;
    icon: typeof Activity;
  }> = [
    { value: "all", label: "All Runs", detail: "Show every workspace run", icon: Eye },
    { value: "active", label: "Active Runs", detail: "Show running work only", icon: Activity },
    { value: "hidden", label: "Hide Runs", detail: "Hide run cards from canvas", icon: EyeOff }
  ];

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target && (triggerRef.current?.contains(target) || menuRef.current?.contains(target))) return;

      onOpenMenuChange?.(null);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [onOpenMenuChange, open]);

  const closeMenu = () => {
    onOpenMenuChange?.(null);
  };

  const toggleMenu = (trigger: HTMLButtonElement) => {
    const nextOpen = !open;
    if (!nextOpen) {
      onOpenMenuChange?.(null);
      return;
    }

    const rect = trigger.getBoundingClientRect();
    onOpenMenuChange?.({
      workspaceId,
      kind: "runs",
      position: {
        left: Math.max(8, Math.min(window.innerWidth - 212, rect.right - 204)),
        top: rect.bottom + 180 > window.innerHeight ? Math.max(8, rect.top - 172) : rect.bottom + 8
      }
    });
  };

  return (
    <div className="nodrag nopan relative" onPointerDown={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Filter workspace task cards: ${label}`}
        disabled={disabled}
        title="Filter workspace task cards"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu(event.currentTarget);
        }}
        className="workspace-node__chip workspace-node__task-toggle inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-2 transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-default disabled:opacity-50"
      >
        <Icon className="workspace-node__chip-icon h-3 w-3 shrink-0 text-inherit" />
        <span className="workspace-node__chip-label max-w-[84px] text-[9px] uppercase tracking-[0.13em] text-inherit">{label}</span>
        <span className="workspace-node__chip-value font-display text-[12px] text-inherit">{value}</span>
        <ChevronDown className={cn("pointer-events-none h-3 w-3 shrink-0 text-inherit opacity-70 transition-transform", open && "rotate-180")} />
      </button>
      {open && menuPosition ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Filter workspace task cards"
          style={{
            left: menuPosition.left,
            top: menuPosition.top,
            width: 204,
            zIndex: 10000,
            color: isLight ? "#3f2f24" : "#f1f5f9",
            background: isLight ? "rgba(255, 250, 246, 0.98)" : "rgba(2, 6, 23, 0.95)",
            borderColor: isLight ? "#ddcdbf" : "rgba(255, 255, 255, 0.1)",
            boxShadow: isLight ? "0 18px 42px rgba(82, 60, 46, 0.18)" : "0 18px 42px rgba(0, 0, 0, 0.42)"
          }}
          className={cn(
            "fixed z-[10000] w-[204px] overflow-hidden rounded-[12px] border p-1",
            isLight
              ? "border-[#ddcdbf] bg-[#fffaf6]/98 text-[#3f2f24] shadow-[0_18px_42px_rgba(82,60,46,0.18)]"
              : "border-white/[0.1] bg-slate-950/95 text-slate-100 shadow-[0_18px_42px_rgba(0,0,0,0.42)]"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {options.map((option) => {
            const OptionIcon = option.icon;
            const selected = option.value === filter;

            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  closeMenu();
                  onChange(option.value);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left transition",
                  isLight
                    ? selected ? "bg-[#f1e3d9]" : "hover:bg-[#f4e9e0]"
                    : selected ? "bg-white/[0.1]" : "hover:bg-white/[0.07]"
                )}
              >
                <OptionIcon className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-[#7f5e4b]" : "text-cyan-200")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-medium">{option.label}</span>
                  <span className={cn("block truncate text-[9px]", isLight ? "text-[#806657]" : "text-slate-400")}>{option.detail}</span>
                </span>
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", selected ? "bg-current opacity-80" : "opacity-0")} />
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
