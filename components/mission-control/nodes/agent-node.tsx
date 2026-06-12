"use client";

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { BrainCircuit, ChevronDown, KeyRound, Layers3, LocateFixed, MessageCircle, MoreHorizontal, Plus, SendHorizontal, Sparkles, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AccountIcon } from "@/components/mission-control/account-icon";
import type { AgentDetailFocus, AgentNodeData } from "@/components/mission-control/canvas-types";
import {
  AGENT_NODE_ATTENTION_CLASSES,
  AGENT_NODE_CREATION_PULSE_CLASSES,
  AGENT_NODE_SELECTED_CLASSES,
  resolveAgentStatusBadgeVariant,
  resolveAgentStatusDotTone
} from "@/components/mission-control/node-visual-tones";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  agentChatLastSeenStoragePrefix,
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  readAgentChatLastSeenAt,
  readAgentChatMessages,
  resolveAgentChatUnreadCount
} from "@/components/mission-control/agent-chat-storage";
import { SurfaceIcon } from "@/components/mission-control/surface-icon";
import {
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  formatAgentPresetLabel,
  formatCapabilityLabel,
  getAgentPresetMeta
} from "@/lib/openclaw/agent-presets";
import {
  formatAgentDisplayName,
  formatModelLabel
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type AgentFlowNode = FlowNode<AgentNodeData, "agent">;
const agentNameVariants = {
  hidden: {
    opacity: 0
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.022,
      delayChildren: 0.03
    }
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.14,
      ease: "easeInOut"
    }
  }
} as const;

const agentNameGlyphVariants = {
  hidden: {
    opacity: 0,
    y: 10
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease: [0.22, 1, 0.36, 1]
    }
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: {
      duration: 0.14,
      ease: "easeOut"
    }
  }
} as const;

const agentHeaderChipClassName =
  "h-5 rounded-[7px] px-2 py-0 text-[8px] leading-none tracking-[0.13em]";

function AnimatedAgentName({ label }: { label: string }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.span
        key={label}
        variants={agentNameVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        aria-label={label}
        className="inline-block max-w-full whitespace-nowrap"
      >
        {Array.from(label).map((glyph, index) => (
          <motion.span
            key={`${label}:${index}:${glyph}`}
            variants={agentNameGlyphVariants}
            aria-hidden="true"
            className="inline-block"
          >
            {glyph === " " ? "\u00A0" : glyph}
          </motion.span>
        ))}
      </motion.span>
    </AnimatePresence>
  );
}

function AgentConnectionTooltip({
  label,
  icon,
  children
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="max-w-[260px] rounded-[12px] border border-slate-200/90 bg-white px-3 py-2 text-slate-950 shadow-[0_18px_44px_rgba(15,23,42,0.2)]"
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0 text-[11px] font-medium leading-4 text-slate-800">{label}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function ConnectionMenuButton({
  icon,
  label,
  description,
  disabled,
  onClick
}: {
  icon: ReactNode;
  label: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) {
          return;
        }

        onClick();
      }}
      className={cn(
        "relative z-10 flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200/50",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : "text-white hover:bg-white/[0.075] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border shadow-[0_10px_22px_rgba(0,0,0,0.24)]",
          disabled
            ? "border-slate-700/60 bg-slate-900/70 text-slate-500"
            : "border-violet-200/20 bg-white/[0.08] text-amber-100"
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-[13px] font-semibold leading-4", disabled ? "text-slate-500" : "text-white")}>
          {label}
        </span>
        <span className={cn("block text-[9.5px] uppercase leading-3 tracking-[0.17em]", disabled ? "text-slate-600" : "text-violet-100/70")}>
          {description}
        </span>
      </span>
    </button>
  );
}

function useAgentChatUnreadCount(agentId: string, chatOpen: boolean) {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (chatOpen) {
        return () => {};
      }

      const handleChatStateChange = (event: Event) => {
        const detail = (event as CustomEvent<{ agentId?: string }>).detail;

        if (!detail || detail.agentId === agentId) {
          onStoreChange();
        }
      };

      const handleStorage = (event: StorageEvent) => {
        if (
          event.key &&
          (event.key.startsWith(agentChatMessageStoragePrefix) ||
            event.key.startsWith(agentChatLastSeenStoragePrefix))
        ) {
          onStoreChange();
        }
      };

      window.addEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
      window.addEventListener("storage", handleStorage);

      return () => {
        window.removeEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
        window.removeEventListener("storage", handleStorage);
      };
    },
    () => {
      if (chatOpen) {
        return 0;
      }

      const messages = readAgentChatMessages(agentId);
      const lastSeenAt = readAgentChatLastSeenAt(agentId);
      return resolveAgentChatUnreadCount(messages, lastSeenAt);
    },
    () => 0
  );
}

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const connectionMenuRef = useRef<HTMLDivElement | null>(null);
  const drawerPanelId = `agent-drawer-${data.agent.id}`;
  const connectionMenuPanelId = `agent-connections-${data.agent.id}`;
  const onConnectionMenuOpenChange = data.onConnectionMenuOpenChange;
  const agentLabel = formatAgentDisplayName(data.agent);
  const chatUnreadCount = useAgentChatUnreadCount(data.agent.id, Boolean(data.chatOpen));
  const hasUnreadChat = chatUnreadCount > 0 && !data.chatOpen;
  const activeTaskCount = Math.max(0, Number(data.activeTaskCount ?? 0));
  const isPendingCreation = Boolean(data.pendingCreation);
  const creationWarning = typeof data.creationWarning === "string" ? data.creationWarning.trim() : "";
  const isAttentionActive = selected || data.composerFocused || data.taskFocused;
  const isCreationPulse = Boolean(data.creationPulse);
  const dotTone = resolveAgentStatusDotTone(data.agent.status);
  const statusBadgeVariant = resolveAgentStatusBadgeVariant(data.agent.status);
  const presetMeta = getAgentPresetMeta(data.agent.policy.preset);
  const declaredSkills = data.agent.skills;
  const declaredTools = data.agent.tools.filter((tool) => tool !== "fs.workspaceOnly");
  const effectiveSkills = declaredSkills.length > 0 ? declaredSkills : presetMeta.skillIds;
  const effectiveTools = declaredTools.length > 0 ? declaredTools : presetMeta.tools;
  const observedTools = data.agent.observedTools ?? [];
  const surfaceBadges = data.surfaceBadges ?? [];
  const accountBadges = data.accountBadges ?? [];
  const canOpenWorkspaceChannels = Boolean(data.onOpenWorkspaceChannels);
  const canOpenAccounts = !isPendingCreation && Boolean(data.onOpenAccounts);
  const canConfigureCapabilities = !isPendingCreation && Boolean(data.onConfigureCapabilities);
  const canOpenContextEngine = !isPendingCreation && Boolean(data.onOpenContextEngine);
  const canOpenConnectionMenu = canOpenWorkspaceChannels || canOpenAccounts || canConfigureCapabilities || canOpenContextEngine;
  const canMessage = !isPendingCreation && Boolean(data.onMessage);
  const isMessageActive = Boolean(data.chatOpen) || hasUnreadChat;
  const canCreateTask = !isPendingCreation && Boolean(data.onCreateTask);
  const maxVisibleConnectionBadges = 4;
  const visibleSurfaceBadges = surfaceBadges.slice(0, maxVisibleConnectionBadges);
  const visibleAccountBadges = accountBadges.slice(
    0,
    Math.max(maxVisibleConnectionBadges - visibleSurfaceBadges.length, 0)
  );
  const hiddenConnectionBadgeCount = Math.max(
    surfaceBadges.length +
      accountBadges.length -
      visibleSurfaceBadges.length -
      visibleAccountBadges.length,
    0
  );
  const declaredToolCount = effectiveTools.length;
  const observedToolCount = observedTools.length;
  const inspectAgentSection = (focus: AgentDetailFocus) => {
    data.onInspect?.(data.agent.id, focus);
  };
  const configureAgentCapabilities = (focus: "skills" | "tools") => {
    if (data.onConfigureCapabilities) {
      data.onConfigureCapabilities(data.agent.id, focus);
      return;
    }

    inspectAgentSection(focus);
  };
  const modelBadgeLabel = data.modelLabel || formatModelLabel(data.agent.modelId);
  const statusLabel = isPendingCreation ? "Provisioning" : data.agent.status;
  const themeLabel = data.agent.identity.theme ?? formatAgentPresetLabel(data.agent.policy.preset);
  const skillCount = effectiveSkills.length;
  const heartbeatLabel = data.agent.heartbeat.enabled
    ? data.agent.heartbeat.every ??
      (typeof data.agent.heartbeat.everyMs === "number"
        ? `${Math.round(data.agent.heartbeat.everyMs / 1000)}s`
        : null)
    : null;
  const currentActionLabel = typeof data.agent.currentAction === "string" ? data.agent.currentAction.trim() : "";
  const purposeLabel = data.agent.profile?.purpose?.trim() || currentActionLabel || "OpenClaw operator";
  const visibleSkills = effectiveSkills.slice(0, 4);
  const visibleDeclaredTools = effectiveTools.slice(0, 3);
  const visibleObservedTools = observedTools.slice(0, 3);
  const remainingSkills = Math.max(effectiveSkills.length - visibleSkills.length, 0);
  const remainingDeclaredTools = Math.max(effectiveTools.length - visibleDeclaredTools.length, 0);
  const remainingObservedTools = Math.max(observedToolCount - visibleObservedTools.length, 0);
  const showLiveTaskChip = activeTaskCount > 0 && !data.taskFocused;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!connectionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!connectionMenuRef.current?.contains(event.target as Node)) {
        setConnectionMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [connectionMenuOpen]);

  useEffect(() => {
    onConnectionMenuOpenChange?.(data.agent.id, connectionMenuOpen);

    return () => {
      if (connectionMenuOpen) {
        onConnectionMenuOpenChange?.(data.agent.id, false);
      }
    };
  }, [connectionMenuOpen, data.agent.id, onConnectionMenuOpenChange]);

  return (
    <div
      className={cn(
        "agent-node dark relative isolate w-[272px] overflow-visible rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,20,26,0.96),rgba(9,11,15,0.96))] pt-0 pb-0 shadow-[0_20px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        isPendingCreation && "border-cyan-200/22 shadow-[0_20px_54px_rgba(34,211,238,0.16),0_18px_46px_rgba(0,0,0,0.36)]",
        selected && AGENT_NODE_SELECTED_CLASSES,
        isCreationPulse && AGENT_NODE_CREATION_PULSE_CLASSES,
        isAttentionActive && AGENT_NODE_ATTENTION_CLASSES,
        connectionMenuOpen && "z-[160]"
      )}
    >
      {isCreationPulse ? (
        <motion.div
          aria-hidden="true"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: [0, 1, 0.72, 0], scale: [0.96, 1.01, 1.015, 1.02] }}
          transition={{ duration: 1.7, times: [0, 0.16, 0.55, 1], ease: "easeOut" }}
          className="pointer-events-none absolute inset-[-4px] z-[5] rounded-[28px]"
        >
          <div className="absolute inset-0 rounded-[28px] border border-cyan-300/60 bg-cyan-300/10 shadow-[0_0_0_1px_rgba(34,211,238,0.14),0_0_34px_rgba(34,211,238,0.28)]" />
          <div className="absolute inset-[10px] rounded-[20px] bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.18),transparent_62%)] opacity-90" />
        </motion.div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_84%_18%,rgba(16,185,129,0.08),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,rgba(125,211,252,0.9),rgba(34,211,238,0.14))]" />
        <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-cyan-200/10" />
        <div className="pointer-events-none absolute right-2 top-2 h-10 w-10 rounded-full bg-cyan-300/10 blur-xl" />
        {isPendingCreation ? (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-[-55%] w-[46%] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,0.12),transparent)]"
            animate={{ x: ["0%", "310%"] }}
            transition={{ duration: 1.7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        ) : null}
      </div>

      {isAttentionActive ? (
        <>
          <div aria-hidden="true" className="agent-node__composer-glow pointer-events-none absolute inset-[-1px] z-0 rounded-[25px]" />
          <svg
            aria-hidden="true"
            className="agent-node__composer-svg pointer-events-none absolute inset-[-1px] z-20 h-[calc(100%+2px)] w-[calc(100%+2px)] overflow-hidden rounded-[25px]"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-rail"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--glow"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--tail"
            />
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              rx="8.5"
              ry="8.5"
              pathLength={100}
              className="agent-node__composer-trace agent-node__composer-trace--core"
            />
          </svg>
        </>
      ) : null}

      <div className="relative z-10">
        <Handle
          type="source"
          id="source-right"
          position={Position.Right}
          className="!z-30 !h-2.5 !w-2.5 !border-0 !bg-cyan-300/90 shadow-[0_0_14px_rgba(103,232,249,0.42)]"
        />
        <Handle
          type="source"
          id="source-surface"
          position={Position.Top}
          style={{ left: 14, top: 6 }}
          className="!z-30 !h-2.5 !w-2.5 !border-0 !bg-cyan-100/90 shadow-[0_0_16px_rgba(125,211,252,0.5)]"
        />

        <div className="relative rounded-t-[24px]">
          <div className="relative h-[144px] overflow-hidden rounded-t-[24px] border-b border-white/[0.12] bg-[linear-gradient(180deg,rgba(14,16,20,0.98),rgba(8,10,14,0.95))]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.22),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.16),transparent_30%)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,rgba(8,10,14,0.82))]" />

            <video
              className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center brightness-[0.88] contrast-[1.04] saturate-[0.92]"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
            >
              <source src="/assets/agent.mp4" type="video/mp4" />
            </video>

            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,7,0.48),rgba(3,4,7,0.84)),radial-gradient(circle_at_center,transparent_38%,rgba(3,4,7,0.34)_100%),radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.07),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.04),transparent_28%)]"
            />

            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-2 right-5 h-12 w-12 rounded-full bg-cyan-300/14 blur-2xl"
            />

            <TooltipProvider delayDuration={120}>
              <div className="absolute left-11 top-2 z-50 flex max-w-[calc(100%-88px)] items-center gap-1.5">
                {visibleSurfaceBadges.map((surfaceBadge) => (
                  <AgentConnectionTooltip
                    key={`surface:${surfaceBadge.provider}`}
                    label={surfaceBadge.roleLabel}
                    icon={
                      <SurfaceIcon
                        provider={surfaceBadge.provider}
                        className="h-6 w-6 border-slate-800/20 bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)]"
                      />
                    }
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                      <SurfaceIcon provider={surfaceBadge.provider} className="h-7 w-7 border-white/12 bg-slate-950/72" />
                    </span>
                  </AgentConnectionTooltip>
                ))}

                {visibleAccountBadges.map((accountBadge) => (
                  <AgentConnectionTooltip
                    key={`account:${accountBadge.id}`}
                    label={accountBadge.roleLabel}
                    icon={
                      <AccountIcon
                        serviceId={accountBadge.serviceId}
                        serviceName={accountBadge.serviceName}
                        primaryDomain={accountBadge.primaryDomain}
                        className="h-6 w-6 border-slate-800/20 bg-slate-950 text-white shadow-[0_8px_18px_rgba(15,23,42,0.18)]"
                      />
                    }
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                      <AccountIcon
                        serviceId={accountBadge.serviceId}
                        serviceName={accountBadge.serviceName}
                        primaryDomain={accountBadge.primaryDomain}
                        className="h-7 w-7 border-amber-200/18 bg-slate-950/72"
                      />
                    </span>
                  </AgentConnectionTooltip>
                ))}

                {hiddenConnectionBadgeCount > 0 ? (
                  <AgentConnectionTooltip
                    label={`${hiddenConnectionBadgeCount} more connected integration or account badge${
                      hiddenConnectionBadgeCount === 1 ? "" : "s"
                    }`}
                    icon={
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-slate-200/90 bg-white px-1.5 text-[10px] font-semibold text-slate-950 shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
                        +{hiddenConnectionBadgeCount}
                      </span>
                    }
                  >
                    <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-slate-950/72 px-2 text-[10px] font-semibold text-slate-200 shadow-[0_10px_24px_rgba(0,0,0,0.32)] backdrop-blur-xl">
                      +{hiddenConnectionBadgeCount}
                    </span>
                  </AgentConnectionTooltip>
                ) : null}
              </div>
            </TooltipProvider>

            <div className="absolute inset-x-0 bottom-0 z-30 p-3.5">
              <div className="max-w-[80%]">
                <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-white/65">
                  <StatusDot tone={dotTone} pulse={data.agent.status === "engaged" || data.agent.status === "monitoring"} />
                  {isPendingCreation ? "Agent birth" : "Agent"}
                </div>
                <p className="mt-1 truncate font-display text-[1.08rem] leading-5 text-white">
                  <AnimatedAgentName label={agentLabel} />
                </p>
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-amber-200/90">
                  {themeLabel}
                </p>
              </div>
            </div>
          </div>

          <div
            ref={connectionMenuRef}
            className="nodrag nopan absolute left-[-2px] top-[-10px] z-[90]"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <motion.button
              type="button"
              aria-label={
                isPendingCreation
                  ? `${agentLabel} connections unavailable while provisioning`
                  : `Open connection menu for ${agentLabel}`
              }
              aria-expanded={connectionMenuOpen}
              aria-controls={connectionMenuPanelId}
              title={
                isPendingCreation
                  ? "Available after the agent syncs from OpenClaw"
                  : `Connect integrations and accounts for ${agentLabel}`
              }
              disabled={!canOpenConnectionMenu}
              initial={false}
              animate={
                canOpenConnectionMenu
                  ? {
                      scale: connectionMenuOpen ? 1.08 : [1, 1.08, 1],
                      y: connectionMenuOpen ? -1 : [0, -0.5, 0],
                      rotate: connectionMenuOpen ? 45 : 0
                    }
                  : { scale: 1, y: 0, rotate: 0 }
              }
              transition={
                connectionMenuOpen
                  ? { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
                  : { duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
              }
              className={cn(
                "relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-full border border-violet-200/55 bg-[radial-gradient(circle_at_36%_24%,rgba(216,180,254,0.58),rgba(168,85,247,0.34)_36%,rgba(24,13,43,0.94)_80%)] text-violet-50 shadow-[0_0_0_1px_rgba(196,181,253,0.24),0_0_26px_rgba(168,85,247,0.54),0_14px_30px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-colors hover:border-violet-200/75 hover:text-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200/60",
                !canOpenConnectionMenu &&
                  "cursor-not-allowed border-slate-500/20 bg-slate-950/72 text-slate-500 shadow-[0_10px_24px_rgba(0,0,0,0.32)]"
              )}
              onClick={(event) => {
                event.stopPropagation();
                if (!canOpenConnectionMenu) {
                  return;
                }

                setConnectionMenuOpen((current) => !current);
              }}
            >
              {canOpenConnectionMenu ? (
                <>
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[-10px] rounded-full bg-violet-400/28 blur-md"
                    animate={{ opacity: [0.34, 0.86, 0.34], scale: [0.86, 1.18, 0.86] }}
                    transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-[-4px] rounded-full border border-fuchsia-200/36"
                    animate={{ opacity: [0, 0.88, 0], scale: [0.82, 1.38, 0.82] }}
                    transition={{ duration: 2.15, repeat: Number.POSITIVE_INFINITY, ease: "easeOut" }}
                  />
                </>
              ) : null}
              <Plus className="relative z-10 h-4 w-4 drop-shadow-[0_0_8px_rgba(216,180,254,0.92)]" />
            </motion.button>

            <AnimatePresence>
              {connectionMenuOpen ? (
                <motion.div
                  id={connectionMenuPanelId}
                  role="menu"
                  aria-label={`${agentLabel} connections`}
                  initial={{ opacity: 0, x: -12, y: 18, scale: 0.9, filter: "blur(8px)" }}
                  animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -10, y: 14, scale: 0.92, filter: "blur(6px)" }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute left-[88px] top-[-150px] z-[160] min-w-[220px] isolate"
                >
                  <motion.svg
                    aria-hidden="true"
                    className="pointer-events-none absolute left-[-90px] top-[86px] h-24 w-40 overflow-visible"
                    viewBox="0 0 160 96"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.32, ease: "easeOut" }}
                  >
                    <motion.path
                      d="M18 80 C18 24 54 8 112 8"
                      fill="none"
                      stroke="rgba(250,204,21,0.20)"
                      strokeWidth="12"
                      strokeLinecap="round"
                    />
                    <motion.path
                      d="M18 80 C18 24 54 8 112 8"
                      fill="none"
                      stroke="rgba(245,158,11,0.36)"
                      strokeWidth="7"
                      strokeLinecap="round"
                    />
                    <motion.path
                      d="M18 80 C18 24 54 8 112 8"
                      fill="none"
                      stroke="rgba(253,224,71,0.88)"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeDasharray="8 10"
                      animate={{ strokeDashoffset: [0, -36], opacity: [0.72, 1, 0.72] }}
                      transition={{ strokeDashoffset: { duration: 1.35, repeat: Number.POSITIVE_INFINITY, ease: "linear" }, opacity: { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } }}
                    />
                    <circle cx="18" cy="80" r="4.5" fill="rgba(253,224,71,0.95)" />
                    <circle cx="112" cy="8" r="4" fill="rgba(216,180,254,0.95)" />
                  </motion.svg>

                  <div className="relative overflow-hidden rounded-[18px] border border-violet-200/20 bg-[linear-gradient(135deg,rgba(18,20,30,0.98),rgba(37,22,53,0.96)_58%,rgba(9,12,20,0.98))] p-1.5 shadow-[0_22px_55px_rgba(8,10,18,0.46),0_0_34px_rgba(168,85,247,0.24)] backdrop-blur-2xl">
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(250,204,21,0.18),transparent_34%),radial-gradient(circle_at_94%_16%,rgba(168,85,247,0.28),transparent_36%)]" />
                    <ConnectionMenuButton
                      icon={<BrainCircuit className="h-[17px] w-[17px]" />}
                      label="Context Engine"
                      description="Files & policy"
                      disabled={!canOpenContextEngine}
                      onClick={() => {
                        data.onOpenContextEngine?.(data.agent.id);
                        setConnectionMenuOpen(false);
                      }}
                    />
                    <ConnectionMenuButton
                      icon={<Sparkles className="h-[17px] w-[17px]" />}
                      label="Add Skill"
                      description="Edit skills"
                      disabled={!canConfigureCapabilities}
                      onClick={() => {
                        configureAgentCapabilities("skills");
                        setConnectionMenuOpen(false);
                      }}
                    />
                    <ConnectionMenuButton
                      icon={<Wrench className="h-[17px] w-[17px]" />}
                      label="Add Tool"
                      description="Edit tools"
                      disabled={!canConfigureCapabilities}
                      onClick={() => {
                        configureAgentCapabilities("tools");
                        setConnectionMenuOpen(false);
                      }}
                    />
                    <ConnectionMenuButton
                      icon={<Layers3 className="h-[17px] w-[17px]" />}
                      label="Integrations"
                      description="Workspace routes"
                      disabled={!canOpenWorkspaceChannels}
                      onClick={() => {
                        data.onOpenWorkspaceChannels?.(data.agent.workspaceId, data.agent.id);
                        setConnectionMenuOpen(false);
                      }}
                    />
                    <ConnectionMenuButton
                      icon={<KeyRound className="h-[17px] w-[17px]" />}
                      label="Accounts"
                      description="Login targets"
                      disabled={!canOpenAccounts}
                      onClick={() => {
                        data.onOpenAccounts?.(data.agent.workspaceId, data.agent.id);
                        setConnectionMenuOpen(false);
                      }}
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <div className="absolute right-2 top-2 z-40" ref={menuRef}>
            <button
              type="button"
              aria-label={`${agentLabel} actions`}
              disabled={isPendingCreation}
              onClick={(event) => {
                event.stopPropagation();
                if (isPendingCreation) {
                  return;
                }
                setMenuOpen((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                "nodrag nopan inline-flex rounded-full border border-white/[0.08] bg-slate-950/60 p-1.5 text-slate-300 shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-colors hover:bg-slate-900/75 hover:text-white",
                isPendingCreation && "cursor-not-allowed text-slate-600 hover:bg-slate-950/60 hover:text-slate-600"
              )}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[136px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <AgentMenuButton
                  label={data.focused ? "Clear focus" : "Focus"}
                  onClick={() => {
                    data.onFocus?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
                <AgentMenuButton
                  label="Edit"
                  onClick={() => {
                    data.onEdit?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
                <AgentMenuButton
                  label="Delete"
                  danger
                  onClick={() => {
                    data.onDelete?.(data.agent.id);
                    setMenuOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

          <div className="px-3.5 pt-3.5 pb-3.5">
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge
                variant={isPendingCreation ? "default" : statusBadgeVariant}
                className={agentHeaderChipClassName}
              >
                {statusLabel}
              </Badge>
              {data.taskFocused ? (
                <Badge variant="default" className={agentHeaderChipClassName}>
                  Working now
                </Badge>
              ) : null}
              {showLiveTaskChip ? (
                <Badge variant="success" className={agentHeaderChipClassName}>
                  {activeTaskCount} live task{activeTaskCount === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {creationWarning ? (
                <Badge variant="warning" className={agentHeaderChipClassName}>
                  Model warning
                </Badge>
              ) : null}
              <button
                type="button"
                aria-label={`Change model for ${agentLabel}`}
                title={`Change model for ${agentLabel}`}
                disabled={isPendingCreation || !data.onConfigureModel}
                className={cn(
                  "nodrag nopan inline-flex h-5 max-w-[142px] items-center rounded-[7px] border border-white/[0.08] bg-white/[0.055] px-2 text-[8px] font-medium uppercase leading-none tracking-[0.13em] text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/35",
                  isPendingCreation || !data.onConfigureModel
                    ? "cursor-default"
                    : "hover:border-cyan-200/18 hover:bg-cyan-300/[0.08] hover:text-cyan-100"
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isPendingCreation) {
                    return;
                  }
                  data.onConfigureModel?.(data.agent.id);
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <span className="min-w-0 truncate">{modelBadgeLabel}</span>
              </button>
            </div>

          <div className="mt-2.5">
            {creationWarning ? (
              <p className="mb-2 rounded-[14px] border border-amber-300/18 bg-amber-300/[0.07] px-2.5 py-2 text-[11px] leading-4 text-amber-100/90">
                {creationWarning}
              </p>
            ) : null}
            <p className="line-clamp-2 text-[12px] leading-5 text-slate-300">{purposeLabel}</p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <AgentStatTile
              label="Skills"
              value={skillCount}
              ariaLabel={`Open skills for ${agentLabel}`}
              onClick={isPendingCreation ? undefined : () => configureAgentCapabilities("skills")}
            />
            <AgentStatTile
              label="Tools"
              value={declaredToolCount}
              ariaLabel={`Open tools for ${agentLabel}`}
              onClick={isPendingCreation ? undefined : () => configureAgentCapabilities("tools")}
            />
            <AgentStatTile
              label="Sessions"
              value={data.agent.sessionCount}
              ariaLabel={`Open sessions for ${agentLabel}`}
              onClick={isPendingCreation ? undefined : () => inspectAgentSection("sessions")}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-label={
                hasUnreadChat
                  ? `${chatUnreadCount} unread message${chatUnreadCount === 1 ? "" : "s"} for ${agentLabel}`
                  : `Message ${agentLabel}`
              }
              title={
                hasUnreadChat
                  ? `${chatUnreadCount} unread message${chatUnreadCount === 1 ? "" : "s"}`
                  : isPendingCreation
                    ? `${agentLabel} is still provisioning`
                    : `Message ${agentLabel}`
              }
              disabled={!canMessage}
              className={cn(
                "nodrag nopan relative inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] border px-3.5 text-[12px] transition-colors",
                !canMessage
                  ? "cursor-not-allowed border-emerald-300/12 bg-emerald-300/[0.04] text-emerald-100/48 shadow-none hover:bg-emerald-300/[0.04] hover:text-emerald-100/48"
                  : isMessageActive
                  ? "border-emerald-200/45 bg-[linear-gradient(180deg,rgba(110,231,183,0.96),rgba(16,185,129,0.9))] text-slate-950 shadow-[0_12px_30px_rgba(16,185,129,0.34)]"
                  : "border-emerald-300/20 bg-[linear-gradient(180deg,rgba(52,211,153,0.18),rgba(5,150,105,0.28))] text-emerald-50 shadow-[0_10px_24px_rgba(16,185,129,0.16)] hover:border-emerald-200/30 hover:text-white"
              )}
              onClick={(event) => {
                event.stopPropagation();
                if (!canMessage) {
                  return;
                }
                data.onMessage?.(data.agent.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {hasUnreadChat ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border border-[#05070d] bg-rose-400 px-1 text-[9px] font-semibold leading-none text-white shadow-[0_0_0_2px_rgba(255,255,255,0.03),0_0_16px_rgba(251,113,133,0.42)]"
                >
                  {chatUnreadCount > 9 ? "9+" : chatUnreadCount}
                </span>
              ) : null}
              <MessageCircle className="h-3.5 w-3.5" />
              <span>Message</span>
            </button>

            <button
              type="button"
              disabled={isPendingCreation || !data.onFocus}
              className={cn(
                "nodrag nopan inline-flex h-10 items-center justify-center gap-1.5 rounded-[11px] border px-3.5 text-[12px] transition-colors",
                isPendingCreation
                  ? "cursor-not-allowed border-cyan-300/14 bg-cyan-300/[0.05] text-cyan-100/62 shadow-[0_10px_24px_rgba(34,211,238,0.08)]"
                  : data.focused
                  ? "border-amber-200/45 bg-[linear-gradient(180deg,rgba(252,211,77,0.96),rgba(217,119,6,0.9))] text-slate-950 shadow-[0_12px_30px_rgba(245,158,11,0.38)]"
                  : "border-amber-300/20 bg-[linear-gradient(180deg,rgba(251,191,36,0.18),rgba(217,119,6,0.28))] text-amber-50 shadow-[0_10px_24px_rgba(245,158,11,0.18)] hover:border-amber-200/30 hover:text-white"
              )}
              onClick={(event) => {
                event.stopPropagation();
                if (isPendingCreation) {
                  return;
                }
                data.onFocus?.(data.agent.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              <span>{isPendingCreation ? "Syncing" : data.focused ? "Focused" : "Focus"}</span>
            </button>
          </div>

          <button
            type="button"
            aria-label={`Create task for ${agentLabel}`}
            title={
              isPendingCreation
                ? `${agentLabel} is still provisioning`
                : `Create a task for ${agentLabel}`
            }
            disabled={!canCreateTask}
            className={cn(
              "nodrag nopan mt-2.5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] border px-4 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200/45",
              !canCreateTask
                ? "cursor-not-allowed border-rose-300/12 bg-rose-300/[0.04] text-rose-100/48 shadow-none hover:bg-rose-300/[0.04] hover:text-rose-100/48"
                : data.composerFocused
                ? "border-rose-200/45 bg-[linear-gradient(180deg,rgba(251,113,133,0.96),rgba(190,18,60,0.9))] text-white shadow-[0_12px_30px_rgba(225,29,72,0.38)]"
                : "border-rose-300/20 bg-[linear-gradient(180deg,rgba(244,63,94,0.18),rgba(190,18,60,0.3))] text-rose-50 shadow-[0_10px_24px_rgba(225,29,72,0.18)] hover:border-rose-200/30 hover:text-white"
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (!canCreateTask) {
                return;
              }
              data.onCreateTask?.(data.agent.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <SendHorizontal className="h-3.5 w-3.5" />
            <span>Create Task</span>
          </button>
        </div>

        <div className="overflow-hidden rounded-b-[24px] border-t border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <button
            type="button"
            aria-expanded={drawerOpen}
            aria-controls={drawerPanelId}
            className="nodrag nopan group flex h-9 w-full items-center gap-2 px-2.5 text-left transition-colors hover:bg-white/[0.04]"
            onClick={(event) => {
              event.stopPropagation();
              setDrawerOpen((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/75 shadow-[0_0_10px_rgba(34,211,238,0.35)]"
              />
              <p className="truncate text-[8px] uppercase tracking-[0.22em] leading-none text-slate-500 transition-colors group-hover:text-slate-400">
                Agent details
              </p>
            </div>
            <p className="ml-auto min-w-0 truncate text-[8px] leading-none text-slate-400">
              {skillCount} skill{skillCount === 1 ? "" : "s"} · {declaredToolCount} tool
              {declaredToolCount === 1 ? "" : "s"} · {formatAgentPresetLabel(data.agent.policy.preset)} policy
            </p>
            <div className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-0.5 text-slate-400 transition-colors group-hover:border-white/[0.12] group-hover:text-slate-200">
              <ChevronDown className={cn("h-2.5 w-2.5 transition-transform duration-200", drawerOpen && "rotate-180")} />
            </div>
          </button>

          <AnimatePresence initial={false}>
            {drawerOpen ? (
              <motion.div
                id={drawerPanelId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="nodrag nopan overflow-hidden nowheel border-t border-white/[0.08]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="px-2.5 py-2">
                  <ScrollArea className="h-[116px] w-full pr-2">
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                          Skills {skillCount}
                        </Badge>
                        <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                          Tools {declaredToolCount}
                        </Badge>
                        <Badge
                          variant={presetMeta.badgeVariant}
                          className="px-2 py-1 text-[9px] normal-case tracking-normal"
                        >
                          {formatAgentPresetLabel(data.agent.policy.preset)}
                        </Badge>
                      </div>

                      <div>
                        <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Skills</p>
                        <div className="flex flex-wrap gap-1">
                          {visibleSkills.length > 0 ? (
                            visibleSkills.map((skill) => (
                              <Badge key={skill} variant="muted" className="max-w-full truncate text-[10px]">
                                {formatCapabilityLabel(skill)}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              No explicit skills
                            </Badge>
                          )}
                          {remainingSkills > 0 ? (
                            <Badge variant="muted" className="text-[10px]">
                              +{remainingSkills}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Tools</p>
                        <div className="flex flex-wrap gap-1">
                          {visibleDeclaredTools.length > 0 ? (
                            visibleDeclaredTools.map((tool) => (
                              <Badge key={tool} variant="warning" className="max-w-full truncate text-[10px]">
                                {formatCapabilityLabel(tool)}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="muted" className="text-[10px]">
                              No explicit tools
                            </Badge>
                          )}
                          {remainingDeclaredTools > 0 ? (
                            <Badge variant="muted" className="text-[10px]">
                              +{remainingDeclaredTools}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {observedTools.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Observed tools</p>
                          <div className="flex flex-wrap gap-1">
                            {visibleObservedTools.length > 0 ? (
                              visibleObservedTools.map((tool) => (
                                <Badge key={tool} variant="default" className="max-w-full truncate text-[10px]">
                                  {formatCapabilityLabel(tool)}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="muted" className="text-[10px]">
                                None recorded
                              </Badge>
                            )}
                            {remainingObservedTools > 0 ? (
                              <Badge variant="muted" className="text-[10px]">
                                +{remainingObservedTools}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <p className="mb-1 text-[8px] uppercase tracking-[0.22em] text-slate-500">Policy</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                            Missing {formatAgentMissingToolBehaviorLabel(data.agent.policy.missingToolBehavior)}
                          </Badge>
                          <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                            File {formatAgentFileAccessLabel(data.agent.policy.fileAccess)}
                          </Badge>
                          <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                            Network {formatAgentNetworkAccessLabel(data.agent.policy.networkAccess)}
                          </Badge>
                          <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                            Install {formatAgentInstallScopeLabel(data.agent.policy.installScope)}
                          </Badge>
                        </div>
                      </div>

                      <AgentDrawerRow
                        label="Heartbeat"
                        value={data.agent.heartbeat.enabled ? (heartbeatLabel ? `On · ${heartbeatLabel}` : "On") : "Off"}
                      />
                    </div>
                  </ScrollArea>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function AgentStatTile({
  label,
  value,
  onClick,
  ariaLabel
}: {
  label: string;
  value: number | string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <p className="text-[15px] font-semibold leading-none text-white">{value}</p>
      <p className="mt-1 text-[8px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        className="nodrag nopan w-full rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300/18 hover:bg-cyan-400/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 focus-visible:ring-offset-0"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="w-full rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {content}
    </div>
  );
}

function AgentDrawerRow({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <span className="shrink-0 text-[8px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[9px] leading-4 text-slate-100">{value}</span>
    </div>
  );
}

function AgentMenuButton({
  label,
  onClick,
  danger = false
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "nodrag nopan flex w-full items-center rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        danger
          ? "text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
          : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <span>{label}</span>
    </button>
  );
}
