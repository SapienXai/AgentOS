"use client";

import { startTransition, useEffect, useState } from "react";

import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

type ConnectionState = "connecting" | "live" | "retrying";

export function preserveConfirmedStatus(current: boolean | null, next: boolean | null) {
  return current === true ? true : next;
}

export function isNewerSnapshot(nextSnapshot: ControlPlaneSnapshot, currentSnapshot: ControlPlaneSnapshot) {
  const nextRevision = nextSnapshot.revision ?? 0;
  const currentRevision = currentSnapshot.revision ?? 0;

  if (nextRevision !== currentRevision) {
    return nextRevision > currentRevision;
  }

  if (currentSnapshot.mode === "live" && nextSnapshot.mode === "fallback") {
    return false;
  }

  if (currentSnapshot.mode === "fallback" && nextSnapshot.mode === "live") {
    return true;
  }

  const nextGeneratedAt = Date.parse(nextSnapshot.generatedAt);
  const currentGeneratedAt = Date.parse(currentSnapshot.generatedAt);

  if (Number.isNaN(nextGeneratedAt) || Number.isNaN(currentGeneratedAt)) {
    return true;
  }

  return nextGeneratedAt >= currentGeneratedAt;
}

export function useMissionControlData(initialSnapshot: ControlPlaneSnapshot) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [hasReceivedLiveSnapshot, setHasReceivedLiveSnapshot] = useState(false);
  const [gatewayReachable, setGatewayReachable] = useState<boolean | null>(null);
  const [gatewayRegistered, setGatewayRegistered] = useState<boolean | null>(null);
  const [gatewayReady, setGatewayReady] = useState<boolean | null>(null);
  const [runtimeWritable, setRuntimeWritable] = useState<boolean | null>(null);
  const [localModelStatus, setLocalModelStatus] = useState<{ checked: boolean; defaultModelId: string | null }>({
    checked: false,
    defaultModelId: null
  });
  const [cliInstalled, setCliInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("snapshot", (event) => {
      const nextSnapshot = JSON.parse(event.data) as ControlPlaneSnapshot;
      startTransition(() => {
        setSnapshot((currentSnapshot) =>
          isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
        );
        setHasReceivedLiveSnapshot(true);
        setConnectionState("live");
      });
    });

    source.addEventListener("system-status", (event) => {
      const status = JSON.parse(event.data) as {
        gatewayReachable?: boolean;
        gatewayReady?: boolean;
        gatewayRegistered?: boolean | null;
        cliInstalled?: boolean;
        runtimeWritable?: boolean | null;
        modelStatus?: { checked?: boolean; defaultModelId?: string | null };
      };
      setGatewayReachable(status.gatewayReachable === true);
      setGatewayRegistered((current) => preserveConfirmedStatus(current, status.gatewayRegistered ?? null));
      setGatewayReady((current) => preserveConfirmedStatus(current, status.gatewayReady === true));
      setCliInstalled(status.cliInstalled === true);
      setRuntimeWritable((current) => preserveConfirmedStatus(current, status.runtimeWritable ?? null));
      if (status.modelStatus?.checked) {
        setLocalModelStatus({ checked: true, defaultModelId: status.modelStatus.defaultModelId ?? null });
      }
    });

    source.addEventListener("error", () => {
      setConnectionState("retrying");
    });

    source.addEventListener("ready", () => {
      setConnectionState("live");
    });

    source.onerror = () => {
      setConnectionState("retrying");
    };

    return () => {
      source.close();
    };
  }, []);

  const refreshSnapshot = async (options: { force?: boolean } = {}) => {
    const url = options.force ? "/api/snapshot?force=true" : "/api/snapshot";
    const response = await fetch(url, {
      cache: "no-store"
    });
    const nextSnapshot = (await response.json()) as ControlPlaneSnapshot;

    startTransition(() => {
      setSnapshot((currentSnapshot) =>
        isNewerSnapshot(nextSnapshot, currentSnapshot) ? nextSnapshot : currentSnapshot
      );
      setHasReceivedLiveSnapshot(true);
      setConnectionState("live");
    });

    return nextSnapshot;
  };

  const refresh = async () => {
    await refreshSnapshot();
  };

  return {
    snapshot,
    connectionState,
    hasReceivedLiveSnapshot,
    gatewayReachable,
    gatewayRegistered,
    gatewayReady,
    runtimeWritable,
    localModelStatus,
    cliInstalled,
    refresh,
    refreshSnapshot,
    setSnapshot
  };
}
