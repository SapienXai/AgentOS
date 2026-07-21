"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { PikoLoader } from "@/components/ui/piko-loader";

export type InstanceProtectionStatus = {
  protectionEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  credentialConfigured: boolean;
};

type InstanceProtectionContextValue = {
  status: InstanceProtectionStatus | null;
  loading: boolean;
  refresh: () => Promise<InstanceProtectionStatus>;
  applyStatus: (status: InstanceProtectionStatus) => void;
  lock: () => Promise<void>;
};

const InstanceProtectionContext = createContext<InstanceProtectionContextValue | null>(null);
const AUTH_SYNC_KEY = "agentos-instance-auth-event";

export function InstanceProtectionProvider({ children, initialStatus }: { children: ReactNode; initialStatus: InstanceProtectionStatus }) {
  const [status, setStatus] = useState<InstanceProtectionStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [shielded, setShielded] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    const payload = (await response.json()) as InstanceProtectionStatus & { error?: string };
    if (!response.ok || payload.error) throw new Error(payload.error || "Protection status could not be loaded.");
    setStatus(payload);
    setLoading(false);
    return payload;
  }, []);

  useEffect(() => {
    const synchronize = () => {
      if (window.location.pathname !== "/login") setShielded(true);
      void refresh().then((nextStatus) => {
        if (nextStatus.protectionEnabled && !nextStatus.authenticated && window.location.pathname !== "/login") {
          redirectToLogin();
        } else {
          setShielded(false);
        }
      }).catch(() => setShielded(false));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_SYNC_KEY) synchronize();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("agentos:instance-auth-required", synchronize);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("agentos:instance-auth-required", synchronize);
    };
  }, [refresh]);

  const lock = useCallback(async () => {
    setShielded(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("AgentOS could not be locked.");
      broadcastAuthChange();
      redirectToLogin();
    } catch (error) {
      setShielded(false);
      throw error;
    }
  }, []);

  const value = useMemo(() => ({ status, loading, refresh, applyStatus: setStatus, lock }), [status, loading, refresh, lock]);
  return <InstanceProtectionContext.Provider value={value}>
    {children}
    <PikoLoader
      open={shielded}
      title="Locking AgentOS"
      description="Securing this session before the lock screen opens."
    />
    {shielded ? <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background text-sm text-muted-foreground" role="status">Locking AgentOS…</div> : null}
  </InstanceProtectionContext.Provider>;
}

export function useInstanceProtection() {
  const value = useContext(InstanceProtectionContext);
  if (!value) throw new Error("useInstanceProtection must be used inside InstanceProtectionProvider.");
  return value;
}

export function broadcastAuthChange() {
  try {
    localStorage.setItem(AUTH_SYNC_KEY, `${Date.now()}:${Math.random()}`);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function redirectToLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  const target = returnTo === "/login" ? "/login" : `/login?returnTo=${encodeURIComponent(returnTo)}`;
  window.location.replace(target);
}
