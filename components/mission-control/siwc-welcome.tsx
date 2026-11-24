"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, KeyRound, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isTauriDesktopRuntime, openExternalAuthUrl } from "@/lib/desktop/open-external-auth-url";
import {
  SIWC_ENDPOINT, type SiwcFailure, type SiwcModelApplyResult, type SiwcModelCatalog,
  type SiwcModelThinking, type SiwcOnboardingState
} from "@/lib/openclaw/siwc-onboarding";
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
const primaryAction = "h-12 w-full bg-[color:color-mix(in_srgb,hsl(var(--primary)),black_12%)] hover:bg-[color:color-mix(in_srgb,hsl(var(--primary)),black_16%)]";

type Props = {
  systemReady: boolean;
  onPrepare: () => void | Promise<void>;
  onStart: () => void;
  onAlternative: () => void;
  onEnter: () => void;
  onCreateWorkspace?: () => void;
  onVerifiedChange: (verified: boolean) => void;
  onBack: () => void;
};

function active(state: SiwcOnboardingState | null) {
  return state?.phase === "checking" || state?.phase === "preparing" ||
    state?.phase === "verifying" || state?.phase === "restarting" || state?.phase === "authorize" || state?.phase === "choose-account";
}

export function SiwcWelcome({ systemReady, onPrepare, onStart, onAlternative, onEnter, onCreateWorkspace, onVerifiedChange, onBack }: Props) {
  const modelFieldId = useId();
  const reasoningFieldId = useId();
  const [state, setState] = useState<SiwcOnboardingState | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [launchError, setLaunchError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pollIssue, setPollIssue] = useState(false);
  const [desktopOpened, setDesktopOpened] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SiwcModelCatalog | null>();
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [draftModel, setDraftModel] = useState<string>();
  const [draftThinking, setDraftThinking] = useState<SiwcModelThinking | "">("");
  const [applyingModel, setApplyingModel] = useState(false);
  const [modelError, setModelError] = useState<string>();
  const interacted = useRef(false);
  const pendingTab = useRef<Window | null>(null);
  const desktopAutoOpen = useRef(false);
  const working = preparing || active(state);
  const authorizeId = state?.phase === "authorize" ? state.flowId : null;
  const browserOpened = state?.phase === "authorize" && (state.browserRedirected || desktopOpened === authorizeId);
  const polling = active(state) && !preparing && !cancelling;
  const ready = state?.phase === "ready";

  useEffect(() => onVerifiedChange(ready), [ready, onVerifiedChange]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    fetch(`${SIWC_ENDPOINT}?models=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? (await response.json() as { catalog?: SiwcModelCatalog }).catalog ?? null : null)
      .then((available) => { if (!controller.signal.aborted) setCatalog(available); })
      .catch(() => { if (!controller.signal.aborted) setCatalog(null); });
    return () => controller.abort();
  }, [ready, catalogAttempt]);

  useEffect(() => () => pendingTab.current?.close(), []);


  useEffect(() => {
    const controller = new AbortController();
    void requestSiwc(undefined, controller.signal).then((next) => {
      if (controller.signal.aborted || interacted.current) return;
      if (next?.phase === "failed" && (next.reason === "owner" || next.reason === "local-required")) return;
      setState(next);
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    let timer: number;
    let failures = 0;
    const clear = () => window.clearTimeout(timer);
    const poll = async () => {
      clear();
      timer = 0;
      try {
        const next = await requestSiwc(undefined, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        setPollIssue(false);
        setState(next ?? { phase: "failed", reason: "gateway" });
      } catch {
        if (controller.signal.aborted) return;
        failures += 1;
        if (failures >= 2) setPollIssue(true);
      }
      timer = window.setTimeout(poll, failures ? 1_500 : 500);
    };
    const onFocus = () => {
      if (document.visibilityState === "visible" && timer) {
        clear();
        timer = 0;
        void poll();
      }
    };
    timer = window.setTimeout(poll, 0);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clear();
      controller.abort();
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [polling]);

  const phase = state?.phase;
  useEffect(() => {
    if (authorizeId && pendingTab.current) {
      const tab = pendingTab.current;
      pendingTab.current = null;
      if (!tab.closed) {
        try {
          tab.location.replace(authorizationPath(authorizeId));
        } catch {
          tab.close();
          setLaunchError(true);
        }
      }
    } else if (authorizeId && desktopAutoOpen.current) {
      desktopAutoOpen.current = false;
      void openDesktop(authorizationPath(authorizeId))
        .then(() => setDesktopOpened(authorizeId), () => setLaunchError(true));
    } else if (phase === "choose-account" || phase === "ready" || phase === "failed" || phase === "cancelled") {
      pendingTab.current?.close();
      pendingTab.current = null;
      desktopAutoOpen.current = false;
    }
  }, [authorizeId, phase]);

  const prepareBrowser = () => {
    setLaunchError(false);
    if (isTauriDesktopRuntime()) {
      desktopAutoOpen.current = true;
      return;
    }
    const tab = window.open("/onboarding/chatgpt", "_blank");
    if (tab) {
      tab.opener = null;
      pendingTab.current = tab;
    }
  };

  const start = async () => {
    if (working) return;
    interacted.current = true;
    prepareBrowser();
    onStart();
    setPreparing(true);
    try {
      if (!systemReady) {
        const current = await requestSiwc();
        if (active(current) || (current?.phase === "failed" &&
          (current.reason === "owner" || current.reason === "local-required"))) {
          setState(current);
          return;
        }
        if (!current || (current.phase === "failed" && (current.reason === "gateway" || current.reason === "unsupported"))) {
          setState({ phase: "preparing" });
          await onPrepare();
        }
      }
      setState(await requestSiwc({ action: "start" }));
    } catch {
      setState({ phase: "failed", reason: "gateway" });
    } finally {
      setPreparing(false);
    }
  };

  const verifySaved = async () => {
    if (working || state?.phase !== "saved") return;
    interacted.current = true;
    onStart();
    setPreparing(true);
    setLaunchError(false);
    setState({ phase: "verifying" });
    try {
      setState(await requestSiwc({ action: "verify-saved" }) ?? state);
    } catch {
      setState(state);
      setLaunchError(true);
    } finally {
      setPreparing(false);
    }
  };

  const cancel = async () => {
    pendingTab.current?.close();
    pendingTab.current = null;
    desktopAutoOpen.current = false;
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

  const failed = state?.phase === "failed" ? state.reason : null;
  const activeMessage = phase === "restarting" ? "Restarting OpenClaw"
    : phase === "verifying" ? "Testing a model reply"
    : phase === "checking" ? "Checking your OpenClaw setup"
    : phase === "choose-account" ? "Choose a ChatGPT account"
    : phase === "authorize" ? browserOpened ? "Finish in your browser" : "Your sign-in link is ready"
    : "Preparing secure sign-in";
  const progressDescription = phase === "restarting" ? "AgentOS will resume the model check when OpenClaw is back."
    : phase === "authorize"
    ? (browserOpened
      ? "Approve token sharing in the OpenAI tab. AgentOS will pick up the result and test a model reply automatically."
      : "Open ChatGPT in a new tab to approve token sharing. The sign-in link expires after a few minutes.")
    : phase === "verifying"
      ? "OpenClaw checks that your default agent can get a real reply."
      : "OpenClaw is getting this connection ready.";
  const isSaved = state?.phase === "saved";
  const currentModel = state?.phase === "ready" ? state.model : undefined;
  const model = draftModel ?? currentModel;
  const selectedModel = catalog?.models.find(({ id }) => id === model);
  const pendingModel = Boolean(selectedModel && (model !== currentModel || draftThinking));
  const lowAlternatives = catalog?.models.filter(({ id, thinkingLevels }) =>
    (id === "openai/gpt-6.1-sol" || id === "openai/gpt-6-luna") && thinkingLevels.includes("low"));

  const applyModel = async () => {
    if (!selectedModel || applyingModel) return;
    setApplyingModel(true);
    setModelError(undefined);
    try {
      const response = await fetch(SIWC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "choose-model", model: selectedModel.id, thinking: draftThinking || undefined })
      });
      const { result } = await response.json() as { result?: SiwcModelApplyResult };
      if (!result) throw new Error("Could not apply model");
      if (result.model) setState({ phase: "ready", model: result.model, reused: false, thinking: result.ok ? result.thinking : undefined });
      if (result.ok) {
        setDraftModel(undefined);
        setDraftThinking("");
      } else {
        setModelError(modelErrors[result.reason]);
      }
    } catch {
      setModelError("Could not confirm this model change. Try again.");
    } finally {
      setApplyingModel(false);
    }
  };

  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className="mb-6">
        <div className={cn("mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-muted text-foreground", ready && "border-primary/20 bg-primary/10 text-primary")}>
          {ready ? <CheckCircle2 aria-hidden className="size-6" /> : <ChatGptMark className="size-6" />}
        </div>
        <h2 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
          {ready ? "Your AI is ready" : "Connect ChatGPT"}
        </h2>
        <p className="mt-2 max-w-md text-pretty text-sm leading-6 text-muted-foreground sm:text-base">
          {state?.phase === "ready"
            ? (state.reused ? "Your connected model responded successfully." : "Your ChatGPT connection responded successfully.")
            : "Use your ChatGPT account to power your default agent."}
        </p>
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-background/50 p-4 sm:p-6">
        {state?.phase === "ready" ? (
          <>
            <p role="status" className="flex items-center gap-2.5 rounded-xl bg-muted/55 px-3 py-3 text-sm font-medium">
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Verified default model</span>
                <span className="break-words">{state.model}{state.thinking ? ` · ${thinkingLabel(state.thinking)}` : ""}</span>
              </span>
            </p>
            <details className="border-y border-border py-4">
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                Model settings
              </summary>
              <div className="mt-3">
              {catalog === undefined ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" /> Loading OpenAI models…
                </p>
              ) : catalog?.models.length ? (
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void applyModel(); }}>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor={modelFieldId} className="block text-sm font-medium">Model</label>
                      <select id={modelFieldId} className={modelSelectClass} value={model} disabled={applyingModel} required onChange={(event) => {
                        setDraftModel(event.target.value);
                        setDraftThinking("");
                        setModelError(undefined);
                      }}>
                        {currentModel && !catalog.models.some(({ id }) => id === currentModel) && (
                          <option value={currentModel}>{currentModel}</option>
                        )}
                        {catalog.models.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.name}{entry.id === "openai/gpt-6.2-sol" ? " · Everyday" : entry.id === "openai/gpt-6-luna" ? " · Lightweight" : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <label htmlFor={reasoningFieldId} className="block text-sm font-medium">Reasoning</label>
                      <select id={reasoningFieldId} className={modelSelectClass} value={draftThinking} disabled={applyingModel || !selectedModel?.thinkingLevels.length}
                        onChange={(event) => { setDraftThinking(event.target.value as SiwcModelThinking | ""); setModelError(undefined); }}>
                        <option value="">Keep model setting</option>
                        {selectedModel?.thinkingLevels.map((level) => <option key={level} value={level}>{thinkingLabel(level)}</option>)}
                      </select>
                    </div>
                  </div>
                  {catalog.scope === "gateway" && (
                    <p className="text-xs leading-5 text-muted-foreground">Showing the Gateway’s OpenAI catalog. Each new selection is verified with your saved ChatGPT sign-in.</p>
                  )}
                  {selectedModel?.id === "openai/gpt-6.2-sol" && !selectedModel.thinkingLevels.includes("low") && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Low is unavailable for this model in your Gateway.
                      {lowAlternatives?.length ? ` Try ${lowAlternatives.map(({ name }) => name).join(" or ")} for Low.` : ""}
                    </p>
                  )}
                  {modelError && <p role="alert" className="text-sm text-destructive">{modelError}</p>}
                  {pendingModel && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="secondary" disabled={applyingModel}>
                        {applyingModel && <LoaderCircle aria-hidden className="mr-2 size-4 motion-safe:animate-spin" />}
                        {applyingModel ? "Verifying model…" : "Verify and use model"}
                      </Button>
                      {!applyingModel && <Button type="button" variant="ghost" onClick={() => {
                        setDraftModel(undefined);
                        setDraftThinking("");
                        setModelError(undefined);
                      }}>Keep current model</Button>}
                    </div>
                  )}
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="status" className="text-sm text-muted-foreground">
                    {catalog ? "OpenClaw returned no selectable OpenAI models." : "The OpenAI model catalog is unavailable."}
                  </p>
                  <Button variant="ghost" onClick={() => { setCatalog(undefined); setCatalogAttempt((attempt) => attempt + 1); }}>
                    Reload models
                  </Button>
                </div>
              )}
              </div>
            </details>
            {onCreateWorkspace && (
              <Button className={primaryAction} onClick={onCreateWorkspace} disabled={applyingModel || pendingModel}>
                Create your first workspace <ArrowRight aria-hidden className="ml-2 size-4" />
              </Button>
            )}
            <Button variant={onCreateWorkspace ? "ghost" : "default"} className={onCreateWorkspace ? "min-h-11 w-full" : primaryAction} onClick={onEnter} disabled={applyingModel || pendingModel}>
              {onCreateWorkspace ? "Set up a workspace later" : "Open AgentOS"}
            </Button>
          </>
        ) : isSaved ? (
          <>
            <div role="status" className="space-y-1">
              <p className="font-semibold">ChatGPT sign-in saved</p>
              <p className="text-sm leading-6 text-muted-foreground">
                {state.recoveryFailed
                  ? "OpenClaw recovery could not be confirmed. Retry the model check or review Gateway settings."
                  : "Retry the model check to finish connecting your account."}
              </p>
            </div>
            <Button className={primaryAction} onClick={() => void verifySaved()}>
              Retry model check
            </Button>
            {launchError && <p role="alert" className="text-sm text-destructive">The model check could not start. Try again.</p>}
          </>
        ) : working ? (
          <>
            <div className="flex items-start gap-3">
              {phase === "authorize"
                ? <ArrowUpRight aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                : phase !== "choose-account" && <LoaderCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-primary motion-safe:animate-spin" />}
              <div className="min-w-0 space-y-1">
                <p role="status" className="font-semibold">{activeMessage}</p>
                {phase !== "choose-account" && <p className="text-sm leading-6 text-muted-foreground">{progressDescription}</p>}
              </div>
            </div>
            {authorizeId && !cancelling && (
              isTauriDesktopRuntime() ? (
                <Button variant={browserOpened ? "secondary" : "default"} className={browserOpened ? "h-11 w-full" : primaryAction} onClick={() => {
                  setLaunchError(false);
                  void openDesktop(authorizationPath(authorizeId))
                    .then(() => setDesktopOpened(authorizeId), () => setLaunchError(true));
                }}>{browserOpened ? "Reopen ChatGPT" : "Open ChatGPT"} <ArrowUpRight aria-hidden className="ml-2 size-4" /></Button>
              ) : (
                <Button asChild variant={browserOpened ? "secondary" : "default"} className={browserOpened ? "h-11 w-full" : primaryAction}>
                  <a href={authorizationPath(authorizeId)} target="_blank" rel="noopener noreferrer">
                    {browserOpened ? "Reopen ChatGPT" : "Open ChatGPT"} <ArrowUpRight aria-hidden className="ml-2 size-4" />
                  </a>
                </Button>
              )
            )}
            {state?.phase === "choose-account" && state.options.map((label, index) => (
              <Button key={index} variant="secondary" className="h-auto min-h-11 w-full whitespace-normal" disabled={preparing} onClick={() => {
                prepareBrowser();
                setPreparing(true);
                void requestSiwc({ action: "select", index })
                  .then((next) => setState(next?.phase === "choose-account" ? { phase: "preparing" } : next))
                  .catch(() => setState({ phase: "failed", reason: "gateway" }))
                  .finally(() => setPreparing(false));
              }}>{label}</Button>
            ))}
            {launchError && <p role="alert" className="text-sm text-destructive">AgentOS could not open the browser. Use the ChatGPT link to continue.</p>}
            {pollIssue && <p role="status" className="text-sm text-muted-foreground">Reconnecting to AgentOS to check your sign-in…</p>}
            {!preparing && (
              <Button variant="ghost" className="min-h-11 w-full" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? "Cancelling…" : "Cancel sign-in"}
              </Button>
            )}
          </>
        ) : (
          <>
            {failed && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-foreground">{errors[failed]}</p>}
            {phase === "cancelled" && <p role="status" className="text-sm text-muted-foreground">ChatGPT sign-in was cancelled.</p>}
            {!failed && (
              <div className="flex items-start gap-3 text-sm">
                <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="leading-5 text-muted-foreground">Your browser opens OpenAI so you can review and approve token sharing. No API key required.</p>
              </div>
            )}
            {failed === "owner" ? (
              <Button asChild className={primaryAction}><a href="/settings#security">Open Security settings</a></Button>
            ) : failed === "restart" ? (
              <Button asChild className={primaryAction}><a href="/settings#gateway">Open Gateway settings</a></Button>
            ) : (
              <Button className={primaryAction} onClick={() => void start()}>
                {failed ? "Try ChatGPT again" : "Continue with ChatGPT"} <ArrowUpRight aria-hidden className="ml-2 size-4" />
              </Button>
            )}
          </>
        )}
      </div>
      {!working && !ready && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-1">
          <Button variant="ghost" className="min-h-11 px-2 text-muted-foreground" onClick={onBack}>
            <ArrowLeft aria-hidden className="mr-1.5 size-4" /> OpenClaw setup
          </Button>
          <Button variant="ghost" className="min-h-11 px-2" onClick={onAlternative}>Use another provider</Button>
        </div>
      )}
    </div>
  );
}

function ChatGptMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("bg-current [mask:url(/assets/provider-logos/openai.svg)_center/contain_no-repeat]", className)} />;
}

const modelSelectClass = "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:text-sm";

const modelErrors: Record<Extract<SiwcModelApplyResult, { ok: false }>["reason"], string> = {
  unavailable: "This model is no longer available. Choose another model or keep the current default.",
  level: "OpenClaw no longer offers this reasoning level. Choose another level.",
  verification: "OpenClaw could not verify a reply from this model with your ChatGPT sign-in.",
  "thinking-save": "The verified model is active. AgentOS could not save its reasoning setting. Try again.",
  restart: "OpenClaw needs a Gateway restart to apply this model. Open Gateway settings to review it.",
  busy: "OpenClaw is still finishing another model setup. Try again shortly."
};

function thinkingLabel(level: SiwcModelThinking) {
  return level === "xhigh" ? "Extra high" : level[0].toUpperCase() + level.slice(1);
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

async function requestSiwc(action?: { action: "start" | "cancel" | "verify-saved" } | { action: "select"; index: number }, signal?: AbortSignal) {
  const response = await fetch(SIWC_ENDPOINT, {
    cache: "no-store", signal,
    ...(action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : {})
  });
  const payload = await response.json() as { state?: SiwcOnboardingState | null };
  if (payload.state !== undefined) return payload.state;
  if (response.status === 401 || response.status === 403) return { phase: "failed", reason: "owner" } as const;
  throw new Error("AgentOS could not check ChatGPT sign-in.");
}
