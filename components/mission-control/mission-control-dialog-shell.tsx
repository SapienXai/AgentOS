"use client";

import type { ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type MissionControlDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  surfaceTheme?: "dark" | "light";
  icon?: LucideIcon;
  trigger?: ReactNode;
  chips?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
  headerClassName?: string;
  footerClassName?: string;
  footerInnerClassName?: string;
  variant?: "default" | "worker-profile";
  disableOutsideDismiss?: boolean;
};

export function MissionControlDialogShell({
  open,
  onOpenChange,
  title,
  description,
  surfaceTheme = "dark",
  icon: Icon,
  trigger,
  chips,
  headerActions,
  footer,
  children,
  bodyClassName,
  contentClassName,
  headerClassName,
  footerClassName,
  footerInnerClassName,
  variant = "default",
  disableOutsideDismiss = false
}: MissionControlDialogShellProps) {
  const isLight = surfaceTheme === "light";
  const isWorkerProfile = variant === "worker-profile";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        onInteractOutside={disableOutsideDismiss ? (event) => event.preventDefault() : undefined}
        onPointerDownOutside={disableOutsideDismiss ? (event) => event.preventDefault() : undefined}
        overlayClassName={isLight ? "bg-[rgba(26,22,18,0.26)] backdrop-blur-lg" : "bg-black/78 backdrop-blur-lg"}
        closeClassName={cn(
          "right-3 top-3 h-7 w-7",
          isLight
            ? "text-[#756b61] hover:bg-[#f1ebe3] hover:text-[#2d241f]"
            : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
        )}
        className={cn(
          "grid h-[min(calc(100vh-72px),760px)] max-h-[calc(100vh-72px)] w-[min(90vw,1060px)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border border-violet-300/28 bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.16),transparent_28%),linear-gradient(135deg,rgba(16,20,31,0.98),rgba(8,11,19,0.98)_62%,rgba(13,15,25,0.98))] p-0 text-slate-100 shadow-[0_0_0_1px_rgba(167,139,250,0.14),0_24px_80px_rgba(0,0,0,0.68)]",
          isWorkerProfile && "h-[min(calc(100vh-56px),780px)] max-h-[calc(100vh-56px)] w-[min(94vw,1120px)] rounded-[24px] border-violet-300/30 shadow-[0_0_0_1px_rgba(167,139,250,0.16),0_26px_86px_rgba(0,0,0,0.68)]",
          isLight && "agentos-light-modal",
          contentClassName
        )}
      >
        <DialogHeader
          className={cn(
            "relative space-y-0 border-b px-6 pb-2 pt-3",
            isWorkerProfile && "overflow-hidden px-5 pb-3.5 pt-4 sm:px-7",
            isLight ? "border-[#e7dfd4]" : "border-white/[0.06]",
            headerClassName
          )}
        >
          {isWorkerProfile ? (
            <>
              <div className="pointer-events-none absolute -right-20 -top-24 h-44 w-44 rounded-full border border-violet-300/15 bg-violet-400/[0.05]" />
              <div className="pointer-events-none absolute right-24 top-0 h-px w-28 bg-gradient-to-r from-transparent via-violet-300/45 to-transparent" />
            </>
          ) : null}
          <div className="flex items-start justify-between gap-5 pr-9">
            <div className="flex min-w-0 items-start gap-3">
              {Icon ? (
                <div
                  className={cn(
                    "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
                    isWorkerProfile && "h-9 w-9 rounded-xl",
                    isLight
                      ? "border border-[#eadfd3] bg-[#f8f2ea] text-[#855c35] shadow-[0_10px_24px_rgba(101,70,38,0.08)]"
                      : "bg-violet-500/15 text-violet-200 shadow-[0_0_20px_rgba(124,58,237,0.3)]"
                  )}
                >
                  <Icon className={cn(isWorkerProfile ? "h-4 w-4" : "h-[18px] w-[18px]", isLight ? "stroke-[#855c35]" : "stroke-violet-200")} />
                  <span
                    className={cn(
                      "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                      isLight ? "bg-[#b8895f]" : "bg-violet-200 shadow-[0_0_12px_rgba(196,181,253,0.8)]"
                    )}
                  />
                </div>
              ) : null}
              <div className="min-w-0">
                <DialogTitle className={cn("font-display text-[17px] font-semibold leading-5", isWorkerProfile && "text-[19px] tracking-[-0.02em]", isLight ? "text-[#2d241f]" : "text-white")}>
                  {title}
                </DialogTitle>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <DialogDescription className={cn(isWorkerProfile ? "text-xs leading-4" : "text-xs", isLight ? "text-[#7a7168]" : "text-slate-300/78")}>
                    {description}
                  </DialogDescription>
                  {chips}
                </div>
              </div>
            </div>
            {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
          </div>
        </DialogHeader>

        <div className={cn("min-h-0 overflow-y-auto px-4 py-3", isWorkerProfile && "bg-[linear-gradient(180deg,rgba(255,255,255,0.018),transparent_24%)]", bodyClassName)}>{children}</div>

        {footer ? (
          <DialogFooter className={cn("gap-0 border-t px-4 py-1.5", isWorkerProfile && "px-5 py-2 sm:px-7", isLight ? "border-[#e7dfd4]" : "border-white/[0.07]", footerClassName)}>
            <div className={cn("flex w-full items-center justify-between rounded-[8px] px-1.5 py-1", isWorkerProfile && "rounded-xl px-1.5 py-1", isLight ? "bg-white/45" : "bg-white/[0.018]", footerInnerClassName)}>
              {footer}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MissionControlDialogChip({
  children,
  tone = "muted",
  surfaceTheme = "dark"
}: {
  children: ReactNode;
  tone?: "muted" | "violet" | "blue" | "amber" | "emerald";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[6px] border px-2 text-[10px] font-medium",
        tone === "violet" && (isLight ? "border-[#d9bfaa] bg-[#f6eadf] text-[#6a4c36]" : "border-violet-300/22 bg-violet-500/12 text-violet-100"),
        tone === "blue" && (isLight ? "border-sky-300/45 bg-sky-100 text-sky-800" : "border-sky-300/20 bg-sky-500/10 text-sky-100"),
        tone === "amber" && (isLight ? "border-amber-300/45 bg-amber-100 text-amber-800" : "border-amber-300/22 bg-amber-500/12 text-amber-100"),
        tone === "emerald" && (isLight ? "border-emerald-300/45 bg-emerald-100 text-emerald-800" : "border-emerald-300/22 bg-emerald-500/12 text-emerald-100"),
        tone === "muted" && (isLight ? "border-[#e2d7cd] bg-white/80 text-[#765f50]" : "border-white/[0.09] bg-white/[0.045] text-slate-300")
      )}
    >
      {children}
    </span>
  );
}

export function missionControlDialogButtonClassName(
  kind: "primary" | "secondary" = "secondary",
  surfaceTheme: "dark" | "light" = "dark"
) {
  const isLight = surfaceTheme === "light";

  return cn(
    "h-7 rounded-[7px] px-3 text-[11px]",
    kind === "primary"
      ? isLight
        ? "border border-[#c7a17d] bg-[linear-gradient(180deg,#c89e73,#a87852)] text-white shadow-[0_6px_16px_rgba(161,125,101,0.24)] hover:bg-[#b78964]"
        : "border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] hover:bg-violet-500"
      : isLight
        ? "border-[#dfd2c6] bg-white/80 text-[#665446] hover:bg-[#fffaf5] hover:text-[#392b21]"
        : "border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/[0.09] hover:text-white"
  );
}

export function missionControlDialogPanelClassName(className?: string) {
  return cn(
    "rounded-[10px] border border-white/[0.09] bg-black/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    className
  );
}

export function missionControlDialogControlClassName(className?: string) {
  return cn(
    "flex h-9 w-full rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] text-white outline-none transition-colors placeholder:text-slate-500 focus:border-violet-300/38 focus:ring-2 focus:ring-violet-300/12 disabled:cursor-not-allowed disabled:opacity-60",
    className
  );
}
