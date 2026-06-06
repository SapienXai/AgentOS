"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  Clock3,
  Command,
  LayoutGrid,
  List,
  Moon,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  SunMedium
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "info" | "warning" | "danger" | "muted" | "purple";

export const pageSurface =
  "border border-white/[0.08] bg-[linear-gradient(180deg,rgba(13,24,42,0.86),rgba(6,12,23,0.82))] shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_20px_64px_rgba(0,0,0,0.30)] backdrop-blur-xl";

const toneStyles: Record<StatusTone, string> = {
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  info: "border-sky-400/25 bg-sky-400/10 text-sky-200",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  danger: "border-rose-400/30 bg-rose-400/10 text-rose-100",
  muted: "border-white/10 bg-white/[0.06] text-slate-300",
  purple: "border-violet-400/25 bg-violet-400/10 text-violet-200"
};

const dotStyles: Record<StatusTone, string> = {
  success: "bg-emerald-400",
  info: "bg-sky-400",
  warning: "bg-amber-300",
  danger: "bg-rose-400",
  muted: "bg-slate-400",
  purple: "bg-violet-400"
};

const iconToneStyles: Record<StatusTone, string> = {
  success: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200 shadow-emerald-500/10",
  info: "border-sky-300/20 bg-sky-400/10 text-sky-200 shadow-sky-500/10",
  warning: "border-amber-300/20 bg-amber-400/10 text-amber-100 shadow-amber-500/10",
  danger: "border-rose-300/20 bg-rose-400/10 text-rose-100 shadow-rose-500/10",
  muted: "border-white/10 bg-white/[0.065] text-slate-200 shadow-black/20",
  purple: "border-violet-300/20 bg-violet-400/10 text-violet-200 shadow-violet-500/10"
};

export function OperationsTopBar({
  snapshot,
  connectionState,
  surfaceTheme,
  onRefresh,
  onToggleTheme
}: {
  snapshot: MissionControlSnapshot;
  connectionState: "connecting" | "live" | "retrying";
  surfaceTheme: "dark" | "light";
  onRefresh: () => void;
  onToggleTheme: () => void;
}) {
  const version = snapshot.diagnostics.version ?? snapshot.diagnostics.latestVersion ?? "unknown";
  const streamLive = connectionState === "live";
  const online = streamLive && snapshot.diagnostics.health === "healthy";
  const label = streamLive ? "Online" : connectionState === "retrying" ? "Retrying" : "Connecting";
  const ThemeIcon = surfaceTheme === "light" ? SunMedium : Moon;

  return (
    <div className="flex items-center justify-end gap-2 text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
      <span className="hidden sm:inline">OpenClaw</span>
      <span className="hidden font-mono text-slate-500 sm:inline">v{version}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tracking-[0.16em]",
          online
            ? "border-emerald-300/18 bg-emerald-400/10 text-emerald-200"
            : "border-amber-300/18 bg-amber-400/10 text-amber-100"
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-emerald-400" : "bg-amber-300")} />
        {label}
      </span>
      <IconButton ariaLabel="Refresh status" icon={Clock3} onClick={onRefresh} />
      <IconButton
        ariaLabel={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
        icon={ThemeIcon}
        active={surfaceTheme === "light"}
        onClick={onToggleTheme}
      />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  actions,
  children
}: {
  title: string;
  subtitle: string;
  primaryAction?: { label: string; icon?: LucideIcon; onClick?: () => void; disabled?: boolean; title?: string };
  secondaryAction?: { label: string; icon?: LucideIcon; onClick?: () => void };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const PrimaryIcon = primaryAction?.icon;
  const SecondaryIcon = secondaryAction?.icon;

  return (
    <header className="border-b border-white/[0.07] pb-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[1.48rem] font-semibold leading-tight tracking-normal text-white">
            {title}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[0.78rem] leading-5 text-slate-300">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions ?? (
            <>
              {secondaryAction ? (
                <Button variant="secondary" size="sm" className="h-8 rounded-[10px] px-3 text-xs" onClick={secondaryAction.onClick}>
                  {SecondaryIcon ? <SecondaryIcon className="mr-1.5 h-3.5 w-3.5" /> : null}
                  {secondaryAction.label}
                </Button>
              ) : null}
              {primaryAction ? (
                <Button
                  size="sm"
                  className="h-8 rounded-[10px] bg-blue-500 px-3 text-xs text-white shadow-blue-500/20 hover:bg-blue-400"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  title={primaryAction.title}
                >
                  {PrimaryIcon ? <PrimaryIcon className="mr-1.5 h-3.5 w-3.5" /> : null}
                  {primaryAction.label}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "info"
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: StatusTone;
}) {
  return (
    <div className={cn("flex min-h-[72px] items-center gap-3 rounded-[12px] p-3", pageSurface)}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border shadow-lg", iconToneStyles[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </span>
        <span className="mt-1 block truncate text-[1.05rem] font-semibold leading-none text-white">{value}</span>
        <span className="mt-1 block truncate text-[0.63rem] text-slate-400">{detail}</span>
      </span>
    </div>
  );
}

export function StatGrid({ children, columns = 5 }: { children: ReactNode; columns?: 4 | 5 | 6 }) {
  const columnsClass =
    columns === 6
      ? "xl:grid-cols-6"
      : columns === 4
        ? "xl:grid-cols-4"
        : "xl:grid-cols-5";

  return <div className={cn("grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3", columnsClass)}>{children}</div>;
}

export function SearchToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  children,
  right
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 rounded-[10px] border-white/[0.09] bg-slate-950/42 pl-8 pr-11 text-[0.74rem]"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.56rem] text-slate-500 sm:flex">
            <Command className="h-2.5 w-2.5" /> K
          </span>
        </div>
        {children}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function OperationsPageLayout({ main, inspector }: { main: ReactNode; inspector: ReactNode }) {
  return (
    <div className={cn("grid gap-3", inspector ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-1")}>
      <div className="flex min-w-0 flex-col gap-3">{main}</div>
      {inspector}
    </div>
  );
}

export function ToolbarButton({
  icon: Icon = SlidersHorizontal,
  label,
  chevron,
  active,
  onClick,
  disabled,
  title
}: {
  icon?: LucideIcon;
  label: string;
  chevron?: boolean;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-2.5 text-[0.74rem] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        disabled
          ? "cursor-not-allowed border-white/[0.06] bg-white/[0.025] text-slate-600"
          : active
          ? "border-sky-300/30 bg-sky-400/14 text-sky-100"
          : "border-white/[0.09] bg-white/[0.045] text-slate-300 hover:border-white/[0.14] hover:bg-white/[0.075] hover:text-white"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {chevron ? <ChevronDown className="h-3 w-3 text-slate-500" /> : null}
    </button>
  );
}

export function ViewToggle({
  value,
  onChange,
  labels = ["Grid", "List"]
}: {
  value: "grid" | "list" | "board";
  onChange: (value: "grid" | "list") => void;
  labels?: [string, string];
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-[10px] border border-white/[0.09] bg-white/[0.045] p-0.5">
      <button
        type="button"
        aria-label={labels[0]}
        onClick={() => onChange("grid")}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-[8px] text-slate-400 transition-colors hover:text-white",
          (value === "grid" || value === "board") && "bg-sky-400/14 text-sky-200"
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={labels[1]}
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-[8px] text-slate-400 transition-colors hover:text-white",
          value === "list" && "bg-sky-400/14 text-sky-200"
        )}
      >
        <List className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function FilterChip({
  label,
  count,
  active,
  tone = "info",
  onClick
}: {
  label: string;
  count?: number;
  active: boolean;
  tone?: StatusTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[9px] border px-2.5 text-[0.72rem] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        active
          ? toneStyles[tone]
          : "border-white/[0.08] bg-white/[0.035] text-slate-300 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      {label}
      {typeof count === "number" ? (
        <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[0.58rem] text-slate-300">{count}</span>
      ) : null}
    </button>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[12px]", pageSurface, className)}>
      {title || action ? (
        <div className="flex min-h-10 items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
          {title ? <h2 className="text-[0.82rem] font-semibold text-white">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function InspectorPanelFrame({
  title,
  onClose,
  children,
  className
}: {
  title?: string;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "sticky top-4 hidden max-h-[calc(100dvh-32px)] min-h-[calc(100dvh-32px)] overflow-hidden rounded-[12px] xl:block",
        pageSurface,
        className
      )}
    >
      {title ? (
        <div className="flex h-10 items-center justify-between border-b border-white/[0.08] px-3">
          <h2 className="text-xs font-semibold text-white">{title}</h2>
          {onClose ? <IconButton ariaLabel="Close details" icon={MoreHorizontal} onClick={onClose} /> : null}
        </div>
      ) : null}
      <div className="h-full overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

export function StatusBadge({
  label,
  tone = "muted",
  dot = true,
  className
}: {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[0.56rem] font-semibold uppercase tracking-[0.11em]",
        toneStyles[tone],
        className
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[tone])} /> : null}
      {label}
    </span>
  );
}

export function EntityIcon({
  icon: Icon,
  label,
  tone = "info",
  size = "md"
}: {
  icon?: LucideIcon;
  label: string;
  tone?: StatusTone;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-12 w-12 rounded-[14px]" : size === "sm" ? "h-7 w-7 rounded-[9px]" : "h-10 w-10 rounded-[12px]";
  const textClass = size === "lg" ? "text-lg" : size === "sm" ? "text-xs" : "text-base";

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border shadow-lg",
        sizeClass,
        iconToneStyles[tone]
      )}
    >
      {Icon ? <Icon className={cn(size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5")} /> : (
        <span className={cn("font-semibold uppercase", textClass)}>{label.slice(0, 1)}</span>
      )}
    </span>
  );
}

export function KeyValue({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-white/[0.07] py-2 last:border-b-0">
      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[0.74rem] font-medium text-slate-100">
        {value}
        {action ? <span className="ml-2">{action}</span> : null}
      </span>
    </div>
  );
}

export function ProgressBar({
  value,
  tone = "info",
  className
}: {
  value: number;
  tone?: StatusTone;
  className?: string;
}) {
  const fillClass: Record<StatusTone, string> = {
    success: "bg-emerald-400",
    info: "bg-blue-400",
    warning: "bg-amber-300",
    danger: "bg-rose-400",
    muted: "bg-slate-400",
    purple: "bg-violet-400"
  };

  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-white/[0.08]", className)}>
      <div className={cn("h-full rounded-full", fillClass[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function IconButton({
  ariaLabel,
  icon: Icon,
  active,
  dot,
  onClick,
  disabled,
  title
}: {
  ariaLabel: string;
  icon: LucideIcon;
  active?: boolean;
  dot?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        disabled
          ? "cursor-not-allowed border-white/[0.06] bg-white/[0.025] text-slate-600"
          : active
          ? "border-sky-300/30 bg-sky-400/14 text-sky-200"
          : "border-white/[0.08] bg-white/[0.035] text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-white"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {dot ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
    </button>
  );
}

export function MoreButton({ onClick, title = "More actions require backend support." }: { onClick?: () => void; title?: string }) {
  return <IconButton ariaLabel="More actions" icon={MoreHorizontal} onClick={onClick} disabled={!onClick} title={title} />;
}

export function EmptyState({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[170px] flex-col items-center justify-center rounded-[12px] border border-dashed border-white/[0.10] bg-white/[0.025] p-6 text-center">
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

export function MiniBadge({ children }: { children: ReactNode }) {
  return <Badge variant="muted" className="border-white/[0.08] bg-white/[0.055] px-1.5 py-0 text-[0.56rem] tracking-normal text-slate-300">{children}</Badge>;
}
