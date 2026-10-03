"use client";

import { useCallback, useEffect, useState } from "react";

import type { AgentOsProductUpdateSnapshot } from "@/lib/agentos/domains/product-update";
import {
  checkDesktopAgentOsUpdate,
  installDesktopAgentOsUpdate,
  isAgentOsDesktop,
  listenForDesktopAgentOsUpdateProgress,
  type DesktopUpdateProgress
} from "@/lib/desktop/product-update";

type UpdateApiPayload = {
  snapshot?: AgentOsProductUpdateSnapshot;
  error?: string;
};

export function useAgentOsUpdate() {
  const [snapshot, setSnapshot] = useState<AgentOsProductUpdateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DesktopUpdateProgress | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [desktopReady, setDesktopReady] = useState(false);

  useEffect(() => {
    setDesktop(typeof window !== "undefined" && isAgentOsDesktop());
    setDesktopReady(true);
  }, []);

  const loadSnapshot = useCallback(async (force = false, checkNative = false) => {
    let nativeCheckError: string | null = null;
    if (checkNative || (desktop && force)) {
      setChecking(true);
      try {
        await checkDesktopAgentOsUpdate();
      } catch (cause) {
        nativeCheckError = cause instanceof Error ? cause.message : "The native Desktop update check failed.";
      } finally {
        setChecking(false);
      }
    }

    try {
      const response = await fetch(`/api/agentos/updates${force && !desktop ? "?refresh=1" : ""}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as UpdateApiPayload | null;
      if (!response.ok || !payload?.snapshot) throw new Error(payload?.error || "AgentOS update status is unavailable.");
      setSnapshot(payload.snapshot);
      setError(payload.snapshot.checkError ?? nativeCheckError);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AgentOS update status is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktopReady) return;
    void loadSnapshot(false, desktop);
  }, [desktop, desktopReady, loadSnapshot]);

  useEffect(() => {
    if (!desktopReady || !desktop) return;
    let unlisten: (() => void) | null = null;
    let mounted = true;
    void listenForDesktopAgentOsUpdateProgress((event) => {
      if (!mounted) return;
      setProgress(event);
      setSnapshot((current) => current ? {
        ...current,
        operation: current.operation ? {
          ...current.operation,
          state: event.state,
          phase: event.phase,
          progress: event.progress,
          updatedAt: new Date().toISOString()
        } : current.operation
      } : current);
      if (event.state === "failed" || event.state === "unknown") setError(event.message);
    }).then((stop) => {
      if (mounted) unlisten = stop;
      else stop();
    }).catch(() => {});
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [desktop, desktopReady]);

  useEffect(() => {
    const state = snapshot?.operation?.state;
    if (!state || !["requested", "running", "restart-required", "verifying"].includes(state)) return;
    const timer = window.setInterval(() => void loadSnapshot(false), 1_500);
    return () => window.clearInterval(timer);
  }, [loadSnapshot, snapshot?.operation?.state]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await loadSnapshot(true, desktop);
  }, [desktop, loadSnapshot]);

  const install = useCallback(async () => {
    if (!desktop || !snapshot?.latestVersion || !snapshot.canInstall || !snapshot.canManageUpdates) return;
    setInstalling(true);
    setError(null);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch("/api/agentos/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          action: "prepare",
          requestId,
          nativeCheckId: (await checkDesktopAgentOsUpdate()).checkId,
          targetVersion: snapshot.latestVersion
        })
      });
      const payload = await response.json().catch(() => null) as { operationId?: string; error?: string } | null;
      if (!response.ok || !payload?.operationId) throw new Error(payload?.error || "AgentOS could not prepare the Desktop update.");
      setProgress({ operationId: payload.operationId, state: "running", phase: "download", progress: 0, message: "Downloading the signed AgentOS Desktop update." });
      await loadSnapshot(false);
      await installDesktopAgentOsUpdate(payload.operationId);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The AgentOS Desktop update failed.";
      setError(message);
      await loadSnapshot(false);
    } finally {
      setInstalling(false);
    }
  }, [desktop, loadSnapshot, snapshot]);

  return {
    snapshot,
    loading,
    checking,
    installing,
    error,
    progress,
    desktop,
    refresh,
    install
  };
}
