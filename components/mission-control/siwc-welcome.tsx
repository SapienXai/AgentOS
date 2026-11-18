"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isTauriDesktopRuntime, openExternalAuthUrl } from "@/lib/desktop/open-external-auth-url";
import { SIWC_ENDPOINT, type SiwcFailure, type SiwcOnboardingState } from "@/lib/openclaw/siwc-onboarding";
import { cn } from "@/lib/utils";

const errors: Record<SiwcFailure, string> = {
  owner: "Sign in as the AgentOS owner to connect ChatGPT to the default agent.",
  "local-required": "Open AgentOS on the Gateway computer to connect ChatGPT. For a remote Gateway, choose another sign-in method.",
  gateway: "OpenClaw could not be reached. Check Gateway settings or retry setup.",
  version: "This OpenClaw installation does not expose Sign in with ChatGPT. Review Updates or choose another provider.",
  unsupported: "OpenClaw could not start this sign-in. Review Gateway access or use another provider.",
  busy: "A sign-in is already running. Finish or cancel that sign-in before starting again.",
  declined: "ChatGPT authorization was declined. You can try again when ready.",
  timeout: "The sign-in expired. Start again to get a new authorization link.",
  callback: "OpenClaw could not receive the sign-in response. Close other sign-in attempts on this computer and try again.",
  sharing: "Your ChatGPT identity was connected. Enable token sharing in the browser to use models.",
  policy: "This connection is restricted by Gateway or workspace policy. Ask the administrator to review access.",
  quota: "Your ChatGPT plan or workspace has reached its usage limit. Try again later or choose another provider.",
  "no-models": "OpenClaw could not verify a model for this account. Review model access or use another provider.",
  unavailable: "The provider is temporarily unavailable. Try again in a moment.",
  verification: "OpenClaw did not verify a model reply. Try again or review Models.",
  restart: "OpenClaw verified a reply. Apply the Gateway changes in Settings, then try again."
};
const primaryAction = "min-h-12 bg-[color:color-mix(in_srgb,hsl(var(--primary)),black_12%)] hover:bg-[color:color-mix(in_srgb,hsl(var(--primary)),black_16%)]";

type Props = {
  systemReady: boolean;
  onPrepare: () => void | Promise<void>;
  onStart: () => void;
  onAlternative: () => void;
  onEnter: () => void;
  onClose: () => void;
  surfaceTheme: "light" | "dark";
  themeControl: React.ReactNode;
};

function active(state: SiwcOnboardingState | null) {
  return state?.phase === "checking" || state?.phase === "preparing" ||
    state?.phase === "verifying" || state?.phase === "authorize" || state?.phase === "choose-account";
}

export function SiwcWelcome({ systemReady, onPrepare, onStart, onAlternative, onEnter, onClose, surfaceTheme, themeControl }: Props) {
  const [state, setState] = useState<SiwcOnboardingState | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [launchError, setLaunchError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const popup = useRef<Window | null>(null);
  const launchRequested = useRef(false);
  const working = preparing || active(state);
  const authorizeId = state?.phase === "authorize" ? state.flowId : null;

  useEffect(() => {
    const controller = new AbortController();
    void requestSiwc(undefined, controller.signal).then((next) => {
      if (!controller.signal.aborted && active(next)) setState(next);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!active(state) || preparing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void requestSiwc(undefined, controller.signal).then((next) => {
        if (!controller.signal.aborted) setState(next ?? { phase: "failed", reason: "gateway" });
      }).catch(() => {
        if (!controller.signal.aborted) setState({ phase: "failed", reason: "gateway" });
      });
    }, 850);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [state, preparing]);

  useEffect(() => {
    if (!authorizeId || !launchRequested.current) return;
    launchRequested.current = false;
    if (isTauriDesktopRuntime()) {
      void openDesktop(authorizationPath(authorizeId)).catch(() => setLaunchError(true));
    } else if (popup.current && !popup.current.closed) {
      popup.current.location.replace(authorizationPath(authorizeId));
      popup.current = null;
    }
  }, [authorizeId]);

  useEffect(() => () => { popup.current?.close(); }, []);

  const start = async () => {
    if (working) return;
    onStart();
    setPreparing(true);
    setLaunchError(false);
    launchRequested.current = true;
    if (!isTauriDesktopRuntime()) {
      popup.current = window.open("", "_blank");
      if (popup.current) popup.current.opener = null;
    }
    try {
      const current = await requestSiwc();
      if (current?.phase === "failed" || active(current)) {
        setState(current);
        return;
      }
      if (!systemReady) {
        setState({ phase: "preparing" });
        await onPrepare();
      }
      setState(await requestSiwc({ action: "start" }));
    } catch {
      setState({ phase: "failed", reason: "gateway" });
    } finally {
      setPreparing(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const next = await requestSiwc({ action: "cancel" });
      setState(next);
    } catch {
      setState({ phase: "failed", reason: "gateway" });
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (working || !state) return;
    popup.current?.close();
    popup.current = null;
  }, [working, state]);

  const title = state?.phase === "ready" ? "You're ready." : "Your AI workspace starts here.";
  const description = state?.phase === "ready"
    ? (state.reused ? `Verified your existing model · ${state.model}` : `ChatGPT connected · ${state.model}`)
    : "Connect ChatGPT to power your agents.";
  const progress = state?.phase === "authorize" ? "Waiting for ChatGPT authorization…"
    : state?.phase === "verifying" ? "Checking your connection…"
    : state?.phase === "choose-account" ? "Choose an account to reconnect."
    : "Preparing your AI workspace…";
  const failed = state?.phase === "failed" ? state.reason : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }}
        className={cn(
          "inset-0 top-0 left-0 z-[1000] flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-none border-0 bg-background px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-foreground shadow-none backdrop-blur-none transition-none duration-0",
          surfaceTheme === "light" && "agentos-light-modal"
        )}
        overlayClassName="z-[999]"
        closeClassName="hidden"
      >
        <div className="absolute right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))]">{themeControl}</div>
        <div className="mx-auto my-auto flex w-full max-w-md flex-col items-center py-10 text-center">
          <div className="mb-9 flex items-center gap-2.5 text-lg font-semibold tracking-tight" aria-label="AgentOS">
            {/* The static brand asset stays still under reduced motion. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo.webp" alt="" width={32} height={32} className="rounded-lg" />
            <span>Agent<span className="text-primary">OS</span></span>
          </div>
          <DialogTitle className="max-w-sm text-balance text-[clamp(2rem,5vw,3.125rem)] font-semibold leading-[1.08] tracking-[-0.045em] text-foreground">{title}</DialogTitle>
          <DialogDescription className="mt-4 max-w-sm break-words text-base leading-6">{description}</DialogDescription>
          <div className="mt-9 flex w-full max-w-[22rem] flex-col items-stretch gap-3">
            {state?.phase === "ready" ? (
              <Button className={primaryAction} onClick={onEnter}>Open AgentOS</Button>
            ) : working ? (
              <>
                <p role="status" className="flex min-h-12 items-center justify-center gap-2 text-sm text-muted-foreground">
                  {state?.phase !== "choose-account" && <LoaderCircle aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" />}
                  {progress}
                </p>
                {authorizeId && <p className="text-xs leading-5 text-muted-foreground">This connection is shared by the default agent.</p>}
                {authorizeId && (
                  isTauriDesktopRuntime() ? (
                    <Button className={primaryAction} onClick={() => void openDesktop(authorizationPath(authorizeId)).catch(() => setLaunchError(true))}>Open ChatGPT</Button>
                  ) : (
                    <Button asChild className={primaryAction}><a href={authorizationPath(authorizeId)} target="_blank" rel="noopener noreferrer">Open ChatGPT</a></Button>
                  )
                )}
                {state?.phase === "choose-account" && state.options.map((label, index) => (
                  <Button key={index} variant="secondary" className="h-auto min-h-12 whitespace-normal" onClick={() => {
                    void requestSiwc({ action: "select", index }).catch(() => setState({ phase: "failed", reason: "gateway" }));
                  }}>{label}</Button>
                ))}
                {launchError && <p role="alert" className="text-sm text-destructive">Could not open the system browser. Try Open ChatGPT again.</p>}
                {!preparing && (
                  <Button variant="ghost" className="min-h-11" disabled={cancelling} onClick={() => void cancel()}>Cancel sign-in</Button>
                )}
              </>
            ) : (
              <>
                {failed && <p role="alert" className="mb-2 text-sm leading-6 text-muted-foreground">{errors[failed]}</p>}
                {state?.phase === "cancelled" && <p role="status" className="text-sm text-muted-foreground">ChatGPT sign-in was cancelled.</p>}
                {failed === "owner" ? (
                  <Button asChild className="min-h-12"><a href="/settings#security">Open Security settings</a></Button>
                ) : failed === "restart" ? (
                  <Button asChild className="min-h-12"><a href="/settings#gateway">Open Gateway settings</a></Button>
                ) : (
                  <Button className={cn(primaryAction, "text-sm sm:text-base")} onClick={() => void start()}>
                    <span aria-hidden className="mr-2 size-[18px] bg-current [mask:url(/assets/provider-logos/openai.svg)_center/contain_no-repeat]" />
                    {failed ? "Try ChatGPT again" : "Continue with ChatGPT"}
                  </Button>
                )}
                {!failed && <p className="text-xs text-muted-foreground">No API key required.</p>}
                <Button variant="ghost" className="mt-1 min-h-11 text-foreground" onClick={onAlternative}>Use another provider</Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function authorizationPath(id: string) {
  return `${SIWC_ENDPOINT}?authorize=${encodeURIComponent(id)}`;
}

async function openDesktop(path: string) {
  const response = await fetch(`${path}&desktop=1`, { cache: "no-store" });
  if (!response.ok) throw new Error("Sign-in link expired.");
  const { url } = await response.json() as { url: string };
  await openExternalAuthUrl(url);
}

async function requestSiwc(action?: { action: "start" | "cancel" } | { action: "select"; index: number }, signal?: AbortSignal) {
  const response = await fetch(SIWC_ENDPOINT, {
    cache: "no-store", signal,
    ...(action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {})
  });
  const payload = await response.json() as { state?: SiwcOnboardingState | null };
  return payload.state ?? (response.ok ? null : { phase: "failed", reason: "owner" } as const);
}
