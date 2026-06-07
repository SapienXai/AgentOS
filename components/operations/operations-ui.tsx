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
export type OperationsSurfaceTheme = "dark" | "light";

export const pageSurface =
  "border border-border bg-card/95 text-card-foreground shadow-card backdrop-blur-xl";

const toneStyles: Record<StatusTone, string> = {
  success: "border-[hsl(var(--status-success)/0.25)] bg-[hsl(var(--status-success)/0.10)] text-[hsl(var(--status-success-foreground))]",
  info: "border-primary/25 bg-primary/10 text-primary",
  warning: "border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.10)] text-[hsl(var(--status-warning-foreground))]",
  danger: "border-[hsl(var(--status-danger)/0.28)] bg-[hsl(var(--status-danger)/0.10)] text-[hsl(var(--status-danger-foreground))]",
  muted: "border-border bg-muted text-muted-foreground",
  purple: "border-[hsl(var(--status-purple)/0.25)] bg-[hsl(var(--status-purple)/0.10)] text-[hsl(var(--status-purple-foreground))]"
};

const dotStyles: Record<StatusTone, string> = {
  success: "bg-[hsl(var(--status-success))]",
  info: "bg-primary",
  warning: "bg-[hsl(var(--status-warning))]",
  danger: "bg-[hsl(var(--status-danger))]",
  muted: "bg-[hsl(var(--status-muted))]",
  purple: "bg-[hsl(var(--status-purple))]"
};

const iconToneStyles: Record<StatusTone, string> = {
  success: "border-[hsl(var(--status-success)/0.20)] bg-[hsl(var(--status-success)/0.10)] text-[hsl(var(--status-success-foreground))]",
  info: "border-primary/20 bg-primary/10 text-primary",
  warning: "border-[hsl(var(--status-warning)/0.20)] bg-[hsl(var(--status-warning)/0.10)] text-[hsl(var(--status-warning-foreground))]",
  danger: "border-[hsl(var(--status-danger)/0.22)] bg-[hsl(var(--status-danger)/0.10)] text-[hsl(var(--status-danger-foreground))]",
  muted: "border-border bg-muted text-muted-foreground",
  purple: "border-[hsl(var(--status-purple)/0.20)] bg-[hsl(var(--status-purple)/0.10)] text-[hsl(var(--status-purple-foreground))]"
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
  surfaceTheme: OperationsSurfaceTheme;
  onRefresh: () => void;
  onToggleTheme: () => void;
}) {
  const version = snapshot.diagnostics.version ?? snapshot.diagnostics.latestVersion ?? "unknown";
  const streamLive = connectionState === "live";
  const online = streamLive && snapshot.diagnostics.health === "healthy";
  const label = streamLive ? "Online" : connectionState === "retrying" ? "Retrying" : "Connecting";
  const ThemeIcon = surfaceTheme === "light" ? SunMedium : Moon;

  return (
    <div className="flex items-center justify-end gap-2 text-[0.58rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
      <span className="hidden sm:inline">OpenClaw</span>
      <span className="hidden font-mono text-muted-foreground/80 sm:inline">
        v{version}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 tracking-[0.16em]",
          online ? toneStyles.success : toneStyles.warning
        )}
      >
        <span
          className={cn("h-1.5 w-1.5 rounded-full", online ? dotStyles.success : dotStyles.warning)}
        />
        {label}
      </span>
      <IconButton ariaLabel="Refresh status" icon={Clock3} surfaceTheme={surfaceTheme} onClick={onRefresh} />
      <IconButton
        ariaLabel={surfaceTheme === "light" ? "Switch to dark theme" : "Switch to light theme"}
        icon={ThemeIcon}
        surfaceTheme={surfaceTheme}
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
  surfaceTheme?: OperationsSurfaceTheme;
  primaryAction?: { label: string; icon?: LucideIcon; onClick?: () => void; disabled?: boolean; title?: string };
  secondaryAction?: { label: string; icon?: LucideIcon; onClick?: () => void };
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const PrimaryIcon = primaryAction?.icon;
  const SecondaryIcon = secondaryAction?.icon;

  return (
    <header className="border-b border-border pb-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1
            className="font-display text-[1.48rem] font-semibold leading-tight tracking-normal text-foreground"
          >
            {title}
          </h1>
          <p className="mt-1.5 max-w-3xl text-[0.78rem] leading-5 text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions ?? (
            <>
              {secondaryAction ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={secondaryAction.onClick}
                >
                  {SecondaryIcon ? <SecondaryIcon className="mr-1.5 h-3.5 w-3.5" /> : null}
                  {secondaryAction.label}
                </Button>
              ) : null}
              {primaryAction ? (
                <Button
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
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
    <div className={cn("flex min-h-[72px] items-center gap-3 rounded-lg p-3", pageSurface)}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-sm", iconToneStyles[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <span className="mt-1 block truncate text-[1.05rem] font-semibold leading-none text-foreground">{value}</span>
        <span className="mt-1 block truncate text-[0.63rem] text-muted-foreground">{detail}</span>
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
  surfaceTheme?: OperationsSurfaceTheme;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 rounded-lg bg-card/80 pl-8 pr-11 text-[0.74rem]"
          />
          <span
            className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.56rem] text-muted-foreground sm:flex"
          >
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
  surfaceTheme?: OperationsSurfaceTheme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[0.74rem] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled
          ? "cursor-not-allowed border-border bg-muted/75 text-muted-foreground/60"
          : active
            ? "border-primary/30 bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.06)]"
            : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {chevron ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : null}
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
  surfaceTheme?: OperationsSurfaceTheme;
}) {
  return (
    <div
      className="inline-flex h-8 items-center rounded-lg border border-border bg-card/75 p-0.5"
    >
      <button
        type="button"
        aria-label={labels[0]}
        onClick={() => onChange("grid")}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
          (value === "grid" || value === "board") && "bg-primary/10 text-primary"
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={labels[1]}
        onClick={() => onChange("list")}
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
          value === "list" && "bg-primary/10 text-primary"
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
  surfaceTheme?: OperationsSurfaceTheme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[0.72rem] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? toneStyles[tone] : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className="rounded-full bg-muted px-1.5 py-0.5 text-[0.58rem] text-muted-foreground"
        >
          {count}
        </span>
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
    <section className={cn("rounded-lg", pageSurface, className)}>
      {title || action ? (
        <div className="flex min-h-10 items-center justify-between gap-2 border-b border-border px-3 py-2">
          {title ? <h2 className="text-[0.82rem] font-semibold text-foreground">{title}</h2> : <span />}
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
        "sticky top-4 hidden max-h-[calc(100dvh-32px)] min-h-[calc(100dvh-32px)] overflow-hidden rounded-lg xl:block",
        pageSurface,
        className
      )}
    >
      {title ? (
        <div className="flex h-10 items-center justify-between border-b border-border px-3">
          <h2 className="text-xs font-semibold text-foreground">{title}</h2>
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
    <div className="flex items-start justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[0.74rem] font-medium text-foreground">
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
    info: "bg-primary",
    warning: "bg-amber-300",
    danger: "bg-[hsl(var(--status-danger))]",
    muted: "bg-slate-400",
    purple: "bg-violet-400"
  };

  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
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
  surfaceTheme?: OperationsSurfaceTheme;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled
          ? "cursor-not-allowed border-border bg-muted/75 text-muted-foreground/60"
          : active
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {dot ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[hsl(var(--status-success))]" /> : null}
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
    <div className="flex min-h-[170px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/50 p-6 text-center">
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export function MiniBadge({ children }: { children: ReactNode }) {
  return <Badge variant="muted" className="px-1.5 py-0 text-[0.56rem] tracking-normal">{children}</Badge>;
}
