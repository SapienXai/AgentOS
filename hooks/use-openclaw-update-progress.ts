"use client";

import { useEffect, useState } from "react";
import type { OpenClawUpdateProgress } from "@/lib/openclaw/application/update-progress-service";
import { mergeUpdateProgress } from "@/lib/openclaw/update-progress";

export function useOpenClawUpdateProgress() {
  const [progress, setProgress] = useState<OpenClawUpdateProgress | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [lastContactAt, setLastContactAt] = useState<number | null>(null);
  useEffect(() => {
    const stream = new EventSource("/api/openclaw/update-progress");
    stream.addEventListener("progress", (event) => {
      try {
        const next = JSON.parse(event.data) as OpenClawUpdateProgress;
        if (!next.observedAt || typeof next.connected !== "boolean" || !next.verification) return;
        setProgress((previous) => mergeUpdateProgress(previous, next));
        setStreamConnected(true);
        if (next.connected) setLastContactAt(Date.parse(next.observedAt));
      } catch { setStreamConnected(false); }
    });
    stream.addEventListener("forbidden", () => { stream.close(); setProgress(null); setStreamConnected(false); setAccessDenied(true); });
    stream.addEventListener("unavailable", () => setStreamConnected(false));
    stream.onerror = () => setStreamConnected(false);
    return () => stream.close();
  }, []);
  return { progress, streamConnected, lastContactAt, accessDenied };
}
