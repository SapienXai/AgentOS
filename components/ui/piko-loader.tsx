"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type PikoLoaderProps = {
  open: boolean;
  title: string;
  description: string;
  className?: string;
};

/**
 * A blocking operation indicator for work that is still happening in OpenClaw.
 * It is portaled above dialogs so it can be used from any screen or workflow.
 */
export function PikoLoader({ open, title, description, className }: PikoLoaderProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const loaderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (loaderRef.current) {
        loaderRef.current.style.left = `${event.clientX + 32}px`;
        loaderRef.current.style.top = `${event.clientY + 24}px`;
        loaderRef.current.style.transform = "translate3d(0, 0, 0)";
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [open]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div
        ref={loaderRef}
        className={cn("piko-loader-follow absolute left-1/2 top-1/2 flex w-full max-w-[152px] flex-col items-center text-center", className)}
      >
        <div className="piko-loader-float relative flex h-[90px] w-[90px] items-center justify-center sm:h-[107px] sm:w-[107px]">
          <div className="absolute inset-3 rounded-full bg-violet-400/20 blur-3xl" />
          <video
            className="relative h-full w-full object-contain drop-shadow-[0_18px_24px_rgba(0,0,0,0.5)]"
            src="/assets/pikoLoader.webm"
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
          />
        </div>
        <div className="mt-0.5 rounded-md border border-border/70 bg-background/80 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          <p className="font-display text-[10px] font-semibold tracking-[-0.02em] text-foreground">{title}</p>
          <p className="mt-px text-[8px] leading-3 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
