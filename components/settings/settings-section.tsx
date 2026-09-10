import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function SettingsSection({
  title,
  description,
  children,
  surfaceTheme
}: {
  title: string;
  description?: string;
  children: ReactNode;
  surfaceTheme: "dark" | "light";
}) {
  return (
    <section aria-labelledby={`settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="mb-4">
        <h2
          id={`settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          className={cn("text-lg font-semibold tracking-[-0.02em]", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}
        >
          {title}
        </h2>
        {description ? (
          <p className={cn("mt-1 text-sm leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsList({ children, surfaceTheme }: { children: ReactNode; surfaceTheme: "dark" | "light" }) {
  return (
    <div className={cn(
      "overflow-hidden rounded-lg border",
      surfaceTheme === "light" ? "border-border bg-card" : "border-white/[0.1] bg-[#0d1725]"
    )}>
      {children}
    </div>
  );
}

export function SettingsRow({
  label,
  description,
  value,
  action,
  children,
  surfaceTheme,
  className
}: {
  label: string;
  description?: string;
  value?: string;
  action?: ReactNode;
  children?: ReactNode;
  surfaceTheme: "dark" | "light";
  className?: string;
}) {
  return (
    <div className={cn(
      "relative flex min-h-[68px] items-center gap-4 border-b px-4 py-3 last:border-b-0 sm:px-5",
      surfaceTheme === "light" ? "border-border" : "border-white/[0.08]",
      className
    )}>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", surfaceTheme === "light" ? "text-foreground" : "text-slate-100")}>{label}</p>
        {description ? <p className={cn("mt-0.5 text-xs leading-5", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>{description}</p> : null}
        {value ? <p className={cn("mt-1 truncate text-sm", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-300")} title={value}>{value}</p> : null}
      </div>
      {children}
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function SettingsStatus({ label, tone = "muted", surfaceTheme }: { label: string; tone?: "success" | "warning" | "danger" | "muted"; surfaceTheme: "dark" | "light" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs font-medium",
      tone === "success"
        ? surfaceTheme === "light" ? "text-emerald-700" : "text-emerald-300"
        : tone === "warning"
          ? surfaceTheme === "light" ? "text-amber-700" : "text-amber-300"
          : tone === "danger"
            ? surfaceTheme === "light" ? "text-red-700" : "text-rose-300"
            : surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400"
    )}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
