"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowLeft, Bot } from "lucide-react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AgentRecord } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

export function AgentChatDialog({
  open,
  onOpenChange,
  agent,
  statusLabel,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentRecord | null;
  statusLabel?: string;
  children: ReactNode;
}) {
  const [viewportMetrics, setViewportMetrics] = useState<{ height: number | null; offsetTop: number }>({
    height: null,
    offsetTop: 0
  });
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      const height = Math.round(visualViewport?.height ?? window.innerHeight);
      const offsetTop = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));

      setViewportMetrics((current) =>
        current.height === height && current.offsetTop === offsetTop ? current : { height, offsetTop }
      );
    };

    syncViewport();
    visualViewport?.addEventListener("resize", syncViewport);
    visualViewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);

    return () => {
      visualViewport?.removeEventListener("resize", syncViewport);
      visualViewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [agent, open]);

  const displayName = agent ? formatAgentDisplayName(agent) : "Agent";
  const dialogStyle = {
    "--agent-chat-viewport-height": viewportMetrics.height === null ? "100dvh" : `${viewportMetrics.height}px`,
    "--agent-chat-viewport-offset-top": `${viewportMetrics.offsetTop}px`,
    "--agent-chat-sheet-drag-y": `${dragOffset}px`
  } as CSSProperties;

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || !window.matchMedia("(max-width: 767px)").matches) {
      return;
    }

    dragStartYRef.current = event.clientY;
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = dragStartYRef.current;
    if (startY !== null) {
      setDragOffset(Math.max(0, event.clientY - startY));
    }
  };
  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = dragStartYRef.current;
    const distance = startY === null ? 0 : Math.max(0, event.clientY - startY);
    dragStartYRef.current = null;
    setIsDragging(false);
    setDragOffset(0);

    if (distance > 112) {
      onOpenChange(false);
    }
  };
  const cancelDrag = () => {
    dragStartYRef.current = null;
    setIsDragging(false);
    setDragOffset(0);
  };

  return (
    <Dialog open={open && Boolean(agent)} onOpenChange={onOpenChange}>
      {agent ? (
        <DialogContent
          overlayClassName="agent-chat-overlay"
          closeLabel={`Close chat with ${displayName}`}
          closeClassName="hidden right-4 top-4 h-8 w-8 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
          style={dialogStyle}
          className={cn(
            "agent-chat-sheet fixed left-1/2 top-auto bottom-0 z-50 flex h-[94dvh] max-h-[96dvh] w-full max-w-none -translate-x-1/2 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-[24px] border border-border bg-background p-0 text-foreground shadow-[0_24px_72px_rgba(0,0,0,0.24)]",
            "md:top-1/2 md:bottom-auto md:h-[min(84dvh,820px)] md:max-h-[calc(100dvh-48px)] md:w-[min(92vw,860px)] md:-translate-y-1/2 md:rounded-[22px]",
            isDragging && "agent-chat-sheet--dragging"
          )}
        >
          <DialogHeader className="shrink-0 space-y-0 border-b border-border/70 px-4 pb-3 pt-2 md:px-6 md:pb-4 md:pt-4">
            <div
              aria-hidden="true"
              className="agent-chat-sheet-handle mx-auto mb-3 flex h-2 w-12 cursor-grab touch-none items-center justify-center md:hidden"
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
            >
              <span className="h-1 w-9 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <DialogClose
                aria-label="Back to agent control center"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Back to agent control center</span>
              </DialogClose>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
                {agent.identity.emoji ? (
                  <span aria-hidden="true" className="text-lg">{agent.identity.emoji}</span>
                ) : (
                  <Bot className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0 flex-1 md:pr-10">
                <DialogTitle className="truncate font-display text-base font-semibold tracking-tight md:text-lg">
                  {displayName}
                </DialogTitle>
                <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
                  {statusLabel || agent.currentAction?.trim() || agent.status}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1">{children}</div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
