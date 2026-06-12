"use client";

import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { motion } from "motion/react";

import { AccountIcon } from "@/components/mission-control/account-icon";
import type { SurfaceTetherNodeData } from "@/components/mission-control/canvas-types";
import { resolveSurfaceRoleDotClasses } from "@/components/mission-control/node-visual-tones";
import { SurfaceIcon } from "@/components/mission-control/surface-icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type SurfaceTetherFlowNode = FlowNode<SurfaceTetherNodeData, "surface-module">;

export function SurfaceTetherNode({ data, selected }: NodeProps<SurfaceTetherFlowNode>) {
  const isAddSurface = data.variant === "add";
  const isAccount = data.variant === "account";
  const tooltipLabel = isAddSurface
    ? data.actionLabel ?? "Add a workspace integration"
    : isAccount
      ? data.roleLabel || `${data.label} account access`
    : data.roleLabel || `${data.label} connection`;
  const surfaceSummary = formatSurfaceSummary(data.surfaceNames);
  const roleDotClass = resolveSurfaceRoleDotClasses(data.roleTone);
  const accentColor = data.accentColor ?? "#7dd3fc";
  const shellSizeClass = "h-[64px] w-[64px]";
  const shellGlowClass = "inset-[-10px]";
  const shellFrameClass = "inset-[-4px]";
  const actionHandleTop = 32;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            initial={false}
            animate={{
              scale: [1, 1.03, 1],
              y: [0, -1.5, 0],
              rotate: [0, 0.6, 0]
            }}
            transition={{
              duration: 5.6,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut"
            }}
            onClick={(event) => {
              event.stopPropagation();
              data.onClick?.();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className={cn(
              "nodrag nopan relative overflow-visible opacity-100",
              shellSizeClass,
              isAddSurface && "cursor-pointer",
              selected && "opacity-100"
            )}
            aria-label={tooltipLabel}
          >
            <motion.div
              aria-hidden="true"
              className={cn("pointer-events-none absolute rounded-[20px] blur-lg", shellGlowClass)}
              style={{ backgroundColor: `${accentColor}28` }}
              animate={{ scale: [0.98, 1.1, 0.98] }}
              transition={{
                duration: 3.8,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeInOut"
              }}
            />
            <motion.div
              aria-hidden="true"
              className={cn("pointer-events-none absolute rounded-[20px] border border-white/18", shellFrameClass)}
              animate={{
                rotate: [0, 12, 0],
                scale: [1, 1.015, 1]
              }}
              transition={{ duration: 6.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            <Handle
              type="target"
              id={isAddSurface ? "target-surface-action" : "target-surface"}
              position={Position.Right}
              style={{ right: -4, top: actionHandleTop }}
              className="!h-2.5 !w-2.5 !border-0 !bg-white/78 shadow-[0_0_14px_rgba(255,255,255,0.34)]"
            />

            <motion.div
              className={cn(
                "relative z-10 flex h-full w-full items-center justify-center rounded-[18px] border border-white/18 bg-[linear-gradient(180deg,rgba(10,14,22,1),rgba(4,8,16,0.98))] shadow-[0_18px_30px_rgba(0,0,0,0.26),0_0_32px_rgba(255,255,255,0.08)] backdrop-blur-xl",
                isAddSurface && "border-cyan-300/22 bg-[linear-gradient(180deg,rgba(11,19,28,1),rgba(4,8,16,0.98))]"
              )}
              animate={{ y: [0, -1.25, 0], rotate: [0, -0.45, 0] }}
              transition={{ duration: 4.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-[5px] rounded-[14px] bg-[radial-gradient(circle_at_35%_28%,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_42%,rgba(255,255,255,0)_74%)]"
              />

              {isAddSurface ? (
                <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-200/20 bg-cyan-300/10 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]">
                  <Plus className="h-5 w-5" />
                </div>
              ) : isAccount ? (
                <AccountIcon
                  serviceId={data.accountServiceId}
                  serviceName={data.accountServiceName}
                  primaryDomain={data.accountPrimaryDomain}
                  className="relative z-10 h-10 w-10 border-white/12 bg-transparent shadow-none"
                />
              ) : (
                <SurfaceIcon
                  provider={data.provider!}
                  className="relative z-10 h-10 w-10 border-white/12 bg-transparent shadow-none"
                />
              )}

              {isAddSurface ? null : (
                <div className="pointer-events-none absolute" style={{ right: 5, top: 5 }}>
                  <motion.div
                    aria-hidden="true"
                    className="absolute -inset-1.5 rounded-full border border-white/45 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                    animate={{
                      scale: [0.88, 1.22, 0.88],
                      opacity: [0, 0.95, 0]
                    }}
                    transition={{
                      duration: 1.9,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut"
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    className={cn("h-2 w-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.42)]", roleDotClass)}
                    animate={{
                      scale: [1, 1.12, 1],
                      opacity: [0.9, 1, 0.9]
                    }}
                    transition={{
                      duration: 1.9,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut"
                    }}
                  />
                </div>
              )}

              {!isAddSurface && data.surfaceCount > 1 ? (
                <div className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-[#05070d] bg-cyan-300 px-1 text-[9px] font-semibold leading-none text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]">
                  {data.surfaceCount > 9 ? "9+" : data.surfaceCount}
                </div>
              ) : null}
            </motion.div>
          </motion.button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="center"
          sideOffset={12}
          className="max-w-[280px] rounded-[12px] border border-slate-200/90 bg-white px-3 py-2 text-slate-950 shadow-[0_18px_44px_rgba(15,23,42,0.2)]"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2.5 w-2.5 rounded-full", isAddSurface ? "bg-cyan-100 shadow-[0_0_12px_rgba(103,232,249,0.9)]" : roleDotClass)}
                aria-hidden="true"
              />
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{data.label}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[12px] leading-5 text-slate-900">{tooltipLabel}</p>
            </div>
            {isAddSurface ? null : surfaceSummary ? (
              <p className="text-[11px] leading-4 text-slate-600">
                {isAccount ? "Related accounts" : "Related integrations"}: {surfaceSummary}
              </p>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatSurfaceSummary(surfaceNames: string[]) {
  if (surfaceNames.length === 0) {
    return "";
  }

  if (surfaceNames.length <= 3) {
    return surfaceNames.join(", ");
  }

  const visibleNames = surfaceNames.slice(0, 3).join(", ");
  return `${visibleNames} +${surfaceNames.length - 3} more`;
}
