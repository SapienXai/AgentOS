"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createNativeMemoryLoaderState,
  NativeMemoryRequestLedger,
  type NativeMemoryLoaderState,
  type NativeMemoryRequestKind,
  type NativeMemoryRequestToken
} from "@/lib/openclaw/memory-loader-state";
import type {
  WorkerMemoryAction,
  WorkerMemoryActionResponse,
  WorkerMemoryDreamDiaryResponse,
  WorkerMemoryProjection,
  WorkerMemorySearchResponse
} from "@/lib/openclaw/memory-types";

export function useNativeMemoryLoader(agentId: string | null) {
  const ledgerRef = useRef<NativeMemoryRequestLedger | null>(null);
  if (!ledgerRef.current) {
    ledgerRef.current = new NativeMemoryRequestLedger(agentId);
  } else {
    ledgerRef.current.switchAgent(agentId);
  }
  const readControllersRef = useRef(new Map<number, AbortController>());
  const [state, setState] = useState<NativeMemoryLoaderState>(() => createNativeMemoryLoaderState(agentId));

  useEffect(() => {
    const controllers = readControllersRef.current;
    for (const controller of controllers.values()) {
      controller.abort();
    }
    controllers.clear();
    setState(createNativeMemoryLoaderState(agentId));

    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, [agentId]);

  const visibleState = state.agentId === agentId ? state : createNativeMemoryLoaderState(agentId);

  const beginRequest = useCallback((kind: NativeMemoryRequestKind, abortable = true) => {
    if (!agentId) return null;
    const token = ledgerRef.current!.begin(kind, agentId);
    const controller = abortable ? new AbortController() : null;
    if (controller) {
      readControllersRef.current.set(token.sequence, controller);
    }
    return { token, controller };
  }, [agentId]);

  const isCurrent = useCallback((token: NativeMemoryRequestToken) => {
    return ledgerRef.current?.isCurrent(token, agentId) === true;
  }, [agentId]);

  const loadStatus = useCallback(async () => {
    const request = beginRequest("status");
    if (!request) return null;
    setState((current) => current.agentId === agentId ? { ...current, isLoadingStatus: true, error: null } : current);
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId!)}/memory`, {
        cache: "no-store",
        signal: request.controller?.signal
      });
      const payload = await readJson<WorkerMemoryProjection>(result, "Memory health could not be loaded.");
      if (!isCurrent(request.token)) return null;
      setState((current) => current.agentId === agentId
        ? { ...current, projection: payload, isLoadingStatus: false }
        : current);
      return payload;
    } catch (error) {
      if (!isCurrent(request.token)) return null;
      const message = error instanceof Error ? error.message : "Memory health could not be loaded.";
      setState((current) => current.agentId === agentId
        ? { ...current, isLoadingStatus: false, error: message }
        : current);
      throw error;
    } finally {
      readControllersRef.current.delete(request.token.sequence);
    }
  }, [agentId, beginRequest, isCurrent]);

  const loadDiary = useCallback(async () => {
    const request = beginRequest("diary");
    if (!request) return null;
    setState((current) => current.agentId === agentId ? { ...current, isLoadingDiary: true, error: null } : current);
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId!)}/memory/diary`, {
        cache: "no-store",
        signal: request.controller?.signal
      });
      const payload = await readJson<WorkerMemoryDreamDiaryResponse>(result, "Dream diary could not be loaded.");
      if (!isCurrent(request.token)) return null;
      setState((current) => current.agentId === agentId
        ? { ...current, diary: payload, isLoadingDiary: false }
        : current);
      return payload;
    } catch (error) {
      if (!isCurrent(request.token)) return null;
      const message = error instanceof Error ? error.message : "Dream diary could not be loaded.";
      setState((current) => current.agentId === agentId
        ? { ...current, isLoadingDiary: false, error: message }
        : current);
      throw error;
    } finally {
      readControllersRef.current.delete(request.token.sequence);
    }
  }, [agentId, beginRequest, isCurrent]);

  const search = useCallback(async (query: string) => {
    const request = beginRequest("search");
    if (!request) return null;
    setState((current) => current.agentId === agentId
      ? { ...current, isSearching: true, actionResult: null, error: null }
      : current);
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId!)}/memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: request.controller?.signal
      });
      const payload = await readJson<WorkerMemorySearchResponse>(result, "Memory search could not be completed.");
      if (!isCurrent(request.token)) return null;
      setState((current) => current.agentId === agentId
        ? { ...current, searchResult: payload, isSearching: false }
        : current);
      return payload;
    } catch (error) {
      if (!isCurrent(request.token)) return null;
      const message = error instanceof Error ? error.message : "Memory search could not be completed.";
      setState((current) => current.agentId === agentId
        ? { ...current, isSearching: false, error: message }
        : current);
      throw error;
    } finally {
      readControllersRef.current.delete(request.token.sequence);
    }
  }, [agentId, beginRequest, isCurrent]);

  const runAction = useCallback(async (action: WorkerMemoryAction, confirmed = false) => {
    const request = beginRequest("action", false);
    if (!request) return null;
    setState((current) => current.agentId === agentId
      ? { ...current, activeAction: action, actionResult: null, error: null }
      : current);
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId!)}/memory/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmed })
      });
      const payload = await readActionJson(result, "Native memory action failed.");
      if (!isCurrent(request.token)) return null;
      setState((current) => current.agentId === agentId
        ? {
            ...current,
            projection: payload.projection ?? current.projection,
            diary: action === "reset" || action === "dedupeDreamDiary" ? null : current.diary,
            activeAction: null,
            actionResult: payload,
            error: null
          }
        : current);
      return payload;
    } catch (error) {
      if (!isCurrent(request.token)) return null;
      const message = error instanceof Error ? error.message : "Native memory action failed.";
      setState((current) => current.agentId === agentId
        ? { ...current, activeAction: null, error: message }
        : current);
      throw error;
    }
  }, [agentId, beginRequest, isCurrent]);

  return { ...visibleState, loadStatus, loadDiary, search, runAction };
}

async function readActionJson(response: Response, fallback: string): Promise<WorkerMemoryActionResponse> {
  const payload = await response.json().catch(() => null);
  if (isWorkerMemoryActionResponse(payload)) {
    return payload;
  }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : fallback;
    throw new Error(error);
  }
  return payload as WorkerMemoryActionResponse;
}

function isWorkerMemoryActionResponse(value: unknown): value is WorkerMemoryActionResponse {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { action?: unknown }).action === "string"
    && ["succeeded", "failed", "unknown"].includes((value as { outcome?: unknown }).outcome as string);
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : fallback;
    throw new Error(error);
  }
  return payload as T;
}
