"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldAlert, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

type LiveViewExchange = {
  accountId: string;
  workspaceId: string;
  providerSessionId: string;
  sessionExpiresAt: string;
  viewerPath: string;
};

export function SecureBrowserLiveView() {
  const [session, setSession] = useState<LiveViewExchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<"confirm" | "stop" | null>(null);
  const [finished, setFinished] = useState(false);
  const [finishedVerification, setFinishedVerification] = useState<
    "verified" | "unverified" | "expired" | "needs_user_action" | "unknown" | null
  >(null);
  const [now, setNow] = useState(Date.now());

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

  const secondsRemaining = useMemo(
    () => session
      ? Math.max(0, Math.floor((Date.parse(session.sessionExpiresAt) - now) / 1_000))
      : 0,
    [now, session]
  );

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
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-emerald-400/20 bg-slate-900 p-6 text-center shadow-2xl">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" />
          <h1 className="mt-4 text-lg font-semibold">Browser session closed</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
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
    <main className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-violet-300" />
            <h1 className="text-sm font-semibold">Secure Browser Session</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Enter passwords and verification codes only inside the browser below. AgentOS does not receive them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {session ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
              {formatDuration(secondsRemaining)} remaining
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={!session || Boolean(finishing)}
            onClick={() => void finish(false)}
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />
            {finishing === "stop" ? "Closing..." : "End session"}
          </Button>
          <Button
            size="sm"
            disabled={!session || Boolean(finishing)}
            onClick={() => void finish(true)}
          >
            {finishing === "confirm" ? "Saving..." : "I’m signed in"}
          </Button>
        </div>
      </header>

      <section className="relative min-h-0 flex-1">
        {!session && !error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Exchanging one-time Live View access...
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-rose-400/20 bg-rose-950/30 p-5 text-center">
              <ShieldAlert className="mx-auto h-7 w-7 text-rose-300" />
              <p className="mt-3 text-sm font-medium">Live View is unavailable</p>
              <p className="mt-2 text-xs leading-5 text-rose-100/70">{error}</p>
            </div>
          </div>
        ) : null}
        {session ? (
          <iframe
            title="Secure remote browser"
            src={session.viewerPath}
            className="h-full min-h-[600px] w-full border-0 bg-black"
            sandbox="allow-scripts allow-same-origin"
            allow=""
            referrerPolicy="no-referrer"
          />
        ) : null}
      </section>
    </main>
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

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
