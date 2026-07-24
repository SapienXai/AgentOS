"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Focus,
  Hand,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  MonitorUp,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LiveViewExchange = {
  accountId: string;
  workspaceId: string;
  providerSessionId: string;
  sessionExpiresAt: string;
  viewerPath: string;
};

type BrowserConnectionStatus = "loading" | "connecting" | "connected" | "disconnected" | "error";
type BrowserViewMode = "adaptive" | "fit" | "actual";

type SecureBrowserMessage = {
  source: "agentos-secure-browser";
  type: "ready" | "status";
  status?: BrowserConnectionStatus;
};

type LiveViewThemeStyle = CSSProperties & Record<`--live-${string}`, string>;

const liveViewTheme: LiveViewThemeStyle = {
  "--live-surface":
    "radial-gradient(circle at 12% -10%, rgba(124,58,237,0.19), transparent 30%), linear-gradient(145deg, #0c1019, #06080e 64%, #0a0b13)",
  "--live-panel": "rgba(15,20,31,0.88)",
  "--live-panel-strong": "rgba(7,10,17,0.94)",
  "--live-panel-hover": "rgba(255,255,255,0.09)",
  "--live-border": "rgba(255,255,255,0.11)",
  "--live-border-subtle": "rgba(255,255,255,0.07)",
  "--live-text": "#f8fafc",
  "--live-muted": "#94a3b8",
  "--live-accent": "#a78bfa",
  "--live-accent-soft": "rgba(139,92,246,0.18)"
};

const zoomSteps = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75];

export function SecureBrowserLiveView() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<LiveViewExchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<"confirm" | "stop" | null>(null);
  const [finished, setFinished] = useState(false);
  const [finishedVerification, setFinishedVerification] = useState<
    "verified" | "unverified" | "expired" | "needs_user_action" | "unknown" | null
  >(null);
  const [connectionStatus, setConnectionStatus] =
    useState<BrowserConnectionStatus>("loading");
  const [viewMode, setViewMode] = useState<BrowserViewMode>("adaptive");
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const sendBrowserCommand = useCallback((command: string, payload?: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "agentos-live-view", command, ...payload },
      window.location.origin
    );
  }, []);

  const configureBrowser = useCallback((mode: BrowserViewMode) => {
    sendBrowserCommand("configure", { mode });
  }, [sendBrowserCommand]);

  useEffect(() => {
    const capability = new URLSearchParams(window.location.hash.slice(1)).get("capability");
    window.history.replaceState(null, "", window.location.pathname);
    if (!capability) {
      setError("This Live View link is missing, expired, or has already been used.");
      return;
    }

    void exchangeCapability(capability)
      .then(setSession)
      .catch((exchangeError) => {
        setError(readError(exchangeError, "Secure Live View could not be opened."));
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow ||
        !isSecureBrowserMessage(event.data)
      ) {
        return;
      }
      if (event.data.type === "ready") {
        setConnectionStatus("connecting");
        configureBrowser(viewMode);
        return;
      }
      if (event.data.status) {
        setConnectionStatus(event.data.status);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [configureBrowser, viewMode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const closeTools = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeTools);
    return () => window.removeEventListener("pointerdown", closeTools);
  }, [toolsOpen]);

  const secondsRemaining = useMemo(
    () => session
      ? Math.max(0, Math.floor((Date.parse(session.sessionExpiresAt) - now) / 1_000))
      : 0,
    [now, session]
  );

  useEffect(() => {
    if (!session) return;
    configureBrowser(viewMode);
  }, [configureBrowser, session, viewMode]);

  const selectViewMode = (mode: BrowserViewMode) => {
    setViewMode(mode);
    setPanMode(false);
    setZoom(1);
    setToolsOpen(false);
  };

  const adjustZoom = (direction: -1 | 1) => {
    const currentIndex = zoomSteps.reduce(
      (bestIndex, step, index) =>
        Math.abs(step - zoom) < Math.abs(zoomSteps[bestIndex] - zoom) ? index : bestIndex,
      0
    );
    const nextIndex = Math.min(zoomSteps.length - 1, Math.max(0, currentIndex + direction));
    const nextZoom = zoomSteps[nextIndex];
    setZoom(nextZoom);
    if (nextZoom <= 1) setPanMode(false);
  };

  const focusBrowser = () => {
    setPanMode(false);
    sendBrowserCommand("focus");
    iframeRef.current?.focus();
  };

  const toggleFullscreen = async () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else {
        await viewport.requestFullscreen();
      }
    } catch {
      setError("Fullscreen could not be opened in this browser.");
    }
  };

  const finish = async (confirmLogin: boolean) => {
    if (!session || finishing) return;
    setFinishing(confirmLogin ? "confirm" : "stop");
    try {
      if (confirmLogin) {
        const confirmation = await postBrowserAccountAction<{
          authenticationStatus?: typeof finishedVerification;
        }>({
          action: "confirm-login",
          accountId: session.accountId,
          workspaceId: session.workspaceId,
          providerSessionId: session.providerSessionId
        });
        setFinishedVerification(confirmation?.authenticationStatus ?? "unknown");
      }
      await postBrowserAccountAction({
        action: "stop-live-view",
        accountId: session.accountId,
        workspaceId: session.workspaceId,
        providerSessionId: session.providerSessionId
      });
      setFinished(true);
      setSession(null);
    } catch (finishError) {
      setError(readError(finishError, "The browser session could not be closed cleanly."));
    } finally {
      setFinishing(null);
    }
  };

  if (finished) {
    return (
      <main
        style={liveViewTheme}
        className="flex min-h-dvh items-center justify-center bg-[image:var(--live-surface)] p-6 text-[var(--live-text)]"
      >
        <div className="w-full max-w-md rounded-2xl border border-emerald-400/20 bg-[var(--live-panel)] p-6 text-center shadow-2xl backdrop-blur-xl">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
          <h1 className="mt-4 text-lg font-semibold">Browser session closed</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--live-muted)]">
            {finishedVerification === "verified"
              ? "The provider-specific login marker was verified and the persistent profile was saved."
              : finishedVerification
                ? "The persistent profile was saved with user-confirmed login. Provider verification remains pending."
                : "The persistent profile was saved. You can close this window and return to Accounts."}
          </p>
          <Button className="mt-5" onClick={() => window.close()}>Close window</Button>
        </div>
      </main>
    );
  }

  return (
    <main
      style={liveViewTheme}
      className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-[image:var(--live-surface)] text-[var(--live-text)]"
    >
      <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-[var(--live-border-subtle)] bg-[var(--live-panel)] px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-lg backdrop-blur-xl sm:gap-3 sm:px-4 sm:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-300/15 bg-[var(--live-accent-soft)]">
            <MonitorUp className="h-4 w-4 text-[var(--live-accent)]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-tight">Secure Browser</h1>
              <ConnectionBadge status={connectionStatus} />
            </div>
            <p className="hidden truncate text-[11px] text-[var(--live-muted)] sm:block">
              Passwords and verification codes stay inside this browser.
            </p>
          </div>
        </div>

        {session ? (
          <span
            className="shrink-0 rounded-full border border-[var(--live-border)] bg-white/[0.045] px-2 py-1 text-[11px] font-medium tabular-nums text-slate-300"
            title="Session time remaining"
          >
            {formatDuration(secondsRemaining)}
          </span>
        ) : null}

        <Button
          variant="ghost"
          size="icon"
          title="End session"
          aria-label="End session"
          className="h-9 w-9 shrink-0 text-slate-400 hover:bg-rose-400/10 hover:text-rose-200"
          disabled={!session || Boolean(finishing)}
          onClick={() => void finish(false)}
        >
          {finishing === "stop" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          className="h-8 shrink-0 rounded-md border border-violet-300/20 bg-violet-400/14 px-2.5 text-[11px] font-semibold text-violet-50 shadow-sm shadow-violet-950/25 hover:bg-violet-400/22 hover:text-white sm:px-3"
          disabled={!session || Boolean(finishing)}
          onClick={() => void finish(true)}
        >
          {finishing === "confirm" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin sm:mr-1.5" />
          ) : (
            <Check className="h-3.5 w-3.5 sm:mr-1.5" />
          )}
          <span className="hidden sm:inline">
            {finishing === "confirm" ? "Saving..." : "I’m signed in"}
          </span>
        </Button>
      </header>

      <section ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#05070c]">
        {!session && !error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--live-border)] bg-[var(--live-panel)] px-4 py-3 text-sm text-slate-300 shadow-xl">
              <LoaderCircle className="h-4 w-4 animate-spin text-[var(--live-accent)]" />
              Exchanging one-time Live View access...
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/72 p-6 backdrop-blur-sm">
            <div className="relative max-w-md rounded-2xl border border-rose-400/20 bg-slate-950/90 p-5 text-center shadow-2xl">
              {session ? (
                <button
                  type="button"
                  aria-label="Dismiss error"
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                  onClick={() => setError(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <ShieldAlert className="mx-auto h-7 w-7 text-rose-300" />
              <p className="mt-3 text-sm font-medium">Live View is unavailable</p>
              <p className="mt-2 text-xs leading-5 text-rose-100/70">{error}</p>
            </div>
          </div>
        ) : null}

        {session ? (
          <div
            className={cn(
              "absolute inset-0 overflow-auto overscroll-contain bg-[#05070c]",
              panMode && "cursor-grab active:cursor-grabbing"
            )}
          >
            <div
              className="h-full min-h-full w-full min-w-full origin-top-left transition-transform duration-150 ease-out"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: zoom < 1 ? "center center" : "top left"
              }}
            >
              <iframe
                ref={iframeRef}
                title="Secure remote browser"
                src={session.viewerPath}
                className={cn(
                  "block h-full w-full border-0 bg-[#05070c]",
                  panMode && "pointer-events-none select-none"
                )}
                sandbox="allow-scripts allow-same-origin"
                allow=""
                referrerPolicy="no-referrer"
                onLoad={() => setConnectionStatus("connecting")}
              />
            </div>
          </div>
        ) : null}

        {session ? (
          <>
            <button
              type="button"
              aria-expanded={controlsOpen}
              aria-label={controlsOpen ? "Hide browser controls" : "Show browser controls"}
              title={controlsOpen ? "Hide browser controls" : "Show browser controls"}
              onClick={() => setControlsOpen((current) => !current)}
              className={cn(
                "absolute right-3 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--live-border)] bg-[var(--live-panel)] text-slate-300 shadow-xl backdrop-blur-xl transition hover:bg-[var(--live-panel-hover)] hover:text-white",
                "top-3 sm:right-4",
                isFullscreen && "top-[max(0.75rem,env(safe-area-inset-top))]"
              )}
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", !controlsOpen && "rotate-180")} />
            </button>

            <BrowserControls
              open={controlsOpen}
              viewMode={viewMode}
              zoom={zoom}
              panMode={panMode}
              isFullscreen={isFullscreen}
              toolsOpen={toolsOpen}
              toolsRef={toolsRef}
              onViewModeChange={selectViewMode}
              onZoomOut={() => adjustZoom(-1)}
              onZoomIn={() => adjustZoom(1)}
              onResetZoom={() => {
                setZoom(1);
                setPanMode(false);
              }}
              onTogglePan={() => setPanMode((current) => !current)}
              onFocus={focusBrowser}
              onToggleFullscreen={() => void toggleFullscreen()}
              onToggleTools={() => setToolsOpen((current) => !current)}
              onReconnect={() => {
                setConnectionStatus("connecting");
                sendBrowserCommand("reconnect");
                setToolsOpen(false);
              }}
              onCtrlAltDelete={() => {
                sendBrowserCommand("ctrl-alt-delete");
                setToolsOpen(false);
              }}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

function BrowserControls({
  open,
  viewMode,
  zoom,
  panMode,
  isFullscreen,
  toolsOpen,
  toolsRef,
  onViewModeChange,
  onZoomOut,
  onZoomIn,
  onResetZoom,
  onTogglePan,
  onFocus,
  onToggleFullscreen,
  onToggleTools,
  onReconnect,
  onCtrlAltDelete
}: {
  open: boolean;
  viewMode: BrowserViewMode;
  zoom: number;
  panMode: boolean;
  isFullscreen: boolean;
  toolsOpen: boolean;
  toolsRef: React.RefObject<HTMLDivElement | null>;
  onViewModeChange: (mode: BrowserViewMode) => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
  onTogglePan: () => void;
  onFocus: () => void;
  onToggleFullscreen: () => void;
  onToggleTools: () => void;
  onReconnect: () => void;
  onCtrlAltDelete: () => void;
}) {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      className={cn(
        "absolute z-20 transition-all duration-200",
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 sm:bottom-auto sm:top-3",
        open
          ? "pointer-events-auto translate-y-0 opacity-100"
          : "pointer-events-none translate-y-3 opacity-0 sm:-translate-y-3"
      )}
    >
      <div className="flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-2xl border border-[var(--live-border)] bg-[var(--live-panel)] p-1.5 shadow-[0_16px_50px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div className="hidden items-center rounded-xl bg-black/20 p-0.5 lg:flex">
          <ControlTextButton active={viewMode === "adaptive"} onClick={() => onViewModeChange("adaptive")}>
            Adaptive
          </ControlTextButton>
          <ControlTextButton active={viewMode === "fit"} onClick={() => onViewModeChange("fit")}>
            Fit
          </ControlTextButton>
          <ControlTextButton active={viewMode === "actual"} onClick={() => onViewModeChange("actual")}>
            Actual
          </ControlTextButton>
        </div>

        <div className="hidden h-6 w-px bg-[var(--live-border)] lg:block" />

        <ControlIconButton
          label="Zoom out"
          disabled={zoom <= zoomSteps[0]}
          onClick={onZoomOut}
        >
          <Minus className="h-4 w-4" />
        </ControlIconButton>
        <button
          type="button"
          title="Reset zoom"
          onClick={onResetZoom}
          className="h-9 min-w-14 rounded-lg px-2 text-[11px] font-semibold tabular-nums text-slate-200 transition hover:bg-[var(--live-panel-hover)]"
        >
          {zoomPercent}%
        </button>
        <ControlIconButton
          label="Zoom in"
          disabled={zoom >= zoomSteps[zoomSteps.length - 1]}
          onClick={onZoomIn}
        >
          <Plus className="h-4 w-4" />
        </ControlIconButton>

        <div className="h-6 w-px bg-[var(--live-border)]" />

        <ControlIconButton
          label={panMode ? "Return to browser interaction" : "Pan zoomed view"}
          active={panMode}
          disabled={zoom <= 1}
          onClick={onTogglePan}
        >
          <Hand className="h-4 w-4" />
        </ControlIconButton>
        <ControlIconButton label="Focus browser keyboard" onClick={onFocus}>
          <Keyboard className="h-4 w-4" />
        </ControlIconButton>
        <ControlIconButton
          label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ControlIconButton>

        <div ref={toolsRef} className="relative">
          <ControlIconButton label="Session tools" active={toolsOpen} onClick={onToggleTools}>
            <MoreHorizontal className="h-4 w-4" />
          </ControlIconButton>
          {toolsOpen ? (
            <div className="absolute bottom-[calc(100%+0.65rem)] right-0 w-56 overflow-hidden rounded-xl border border-[var(--live-border)] bg-[var(--live-panel-strong)] p-1.5 shadow-2xl backdrop-blur-xl sm:bottom-auto sm:top-[calc(100%+0.65rem)]">
              <div className="mb-1.5 rounded-lg bg-black/20 p-1 lg:hidden">
                <p className="px-2 pb-1 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Display mode
                </p>
                <div className="grid grid-cols-3 gap-0.5">
                  <ControlTextButton active={viewMode === "adaptive"} onClick={() => onViewModeChange("adaptive")}>
                    Adaptive
                  </ControlTextButton>
                  <ControlTextButton active={viewMode === "fit"} onClick={() => onViewModeChange("fit")}>
                    Fit
                  </ControlTextButton>
                  <ControlTextButton active={viewMode === "actual"} onClick={() => onViewModeChange("actual")}>
                    Actual
                  </ControlTextButton>
                </div>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:bg-[var(--live-panel-hover)]"
                onClick={onReconnect}
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
                Reconnect viewer
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:bg-[var(--live-panel-hover)]"
                onClick={onCtrlAltDelete}
              >
                <Focus className="h-3.5 w-3.5 text-slate-400" />
                Send Ctrl + Alt + Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ControlTextButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 rounded-lg px-2.5 text-[11px] font-semibold transition",
        active
          ? "bg-[var(--live-accent-soft)] text-violet-100"
          : "text-slate-400 hover:bg-[var(--live-panel-hover)] hover:text-slate-100"
      )}
    >
      {children}
    </button>
  );
}

function ControlIconButton({
  label,
  active = false,
  disabled = false,
  children,
  onClick
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-30",
        active
          ? "bg-[var(--live-accent-soft)] text-violet-100"
          : "text-slate-300 hover:bg-[var(--live-panel-hover)] hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function ConnectionBadge({ status }: { status: BrowserConnectionStatus }) {
  const labels: Record<BrowserConnectionStatus, string> = {
    loading: "Loading",
    connecting: "Connecting",
    connected: "Live",
    disconnected: "Disconnected",
    error: "Connection issue"
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        status === "connected"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
          : status === "error" || status === "disconnected"
            ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
            : "border-amber-300/20 bg-amber-300/10 text-amber-100"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "connected"
            ? "bg-emerald-400"
            : status === "error" || status === "disconnected"
              ? "bg-rose-400"
              : "animate-pulse bg-amber-300"
        )}
      />
      {labels[status]}
    </span>
  );
}

async function exchangeCapability(capability: string): Promise<LiveViewExchange> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/accounts/browser-live/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability }),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as (LiveViewExchange & { error?: string }) | null;
    if (!response.ok || !payload) {
      throw new Error(payload?.error ?? "The one-time Live View link is invalid.");
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Live View access exchange timed out. Return to Accounts and open Live View again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function postBrowserAccountAction<T = unknown>(input: Record<string, string>): Promise<T | null> {
  const response = await fetch("/api/accounts/browser-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = await response.json().catch(() => null) as {
    error?: string;
    result?: T;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? "The browser account action failed.");
  }
  return payload?.result ?? null;
}

function isSecureBrowserMessage(value: unknown): value is SecureBrowserMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SecureBrowserMessage>;
  return (
    message.source === "agentos-secure-browser" &&
    (message.type === "ready" || message.type === "status") &&
    (
      message.status === undefined ||
      ["loading", "connecting", "connected", "disconnected", "error"].includes(message.status)
    )
  );
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
