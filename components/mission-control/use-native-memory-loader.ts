"use client";

import { useCallback, useState } from "react";

import type {
  WorkerMemoryAction,
  WorkerMemoryActionResponse,
  WorkerMemoryDreamDiaryResponse,
  WorkerMemoryProjection,
  WorkerMemorySearchResponse
} from "@/lib/openclaw/memory-types";

type NativeMemoryLoaderState = {
  projection: WorkerMemoryProjection | null;
  diary: WorkerMemoryDreamDiaryResponse | null;
  searchResult: WorkerMemorySearchResponse | null;
  isLoadingStatus: boolean;
  isLoadingDiary: boolean;
  isSearching: boolean;
  activeAction: WorkerMemoryAction | null;
  error: string | null;
};

export function useNativeMemoryLoader(agentId: string | null) {
  const [state, setState] = useState<NativeMemoryLoaderState>({
    projection: null,
    diary: null,
    searchResult: null,
    isLoadingStatus: false,
    isLoadingDiary: false,
    isSearching: false,
    activeAction: null,
    error: null
  });

  const loadStatus = useCallback(async () => {
    if (!agentId) return null;
    setState((current) => ({ ...current, isLoadingStatus: true, error: null }));
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memory`, { cache: "no-store" });
      const payload = await readJson<WorkerMemoryProjection>(result, "Memory health could not be loaded.");
      setState((current) => ({ ...current, projection: payload, isLoadingStatus: false }));
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Memory health could not be loaded.";
      setState((current) => ({ ...current, isLoadingStatus: false, error: message }));
      throw error;
    }
  }, [agentId]);

  const loadDiary = useCallback(async () => {
    if (!agentId) return null;
    setState((current) => ({ ...current, isLoadingDiary: true, error: null }));
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memory/diary`, { cache: "no-store" });
      const payload = await readJson<WorkerMemoryDreamDiaryResponse>(result, "Dream diary could not be loaded.");
      setState((current) => ({ ...current, diary: payload, isLoadingDiary: false }));
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dream diary could not be loaded.";
      setState((current) => ({ ...current, isLoadingDiary: false, error: message }));
      throw error;
    }
  }, [agentId]);

  const search = useCallback(async (query: string) => {
    if (!agentId) return null;
    setState((current) => ({ ...current, isSearching: true, error: null }));
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const payload = await readJson<WorkerMemorySearchResponse>(result, "Memory search could not be completed.");
      setState((current) => ({ ...current, searchResult: payload, isSearching: false }));
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Memory search could not be completed.";
      setState((current) => ({ ...current, isSearching: false, error: message }));
      throw error;
    }
  }, [agentId]);

  const runAction = useCallback(async (action: WorkerMemoryAction, confirmed = false) => {
    if (!agentId) return null;
    setState((current) => ({ ...current, activeAction: action, error: null }));
    try {
      const result = await fetch(`/api/agents/${encodeURIComponent(agentId)}/memory/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmed })
      });
      const payload = await readJson<WorkerMemoryActionResponse>(result, "Native memory action failed.");
      setState((current) => ({
        ...current,
        projection: payload.projection,
        diary: action === "reset" || action === "dedupeDreamDiary" ? null : current.diary,
        activeAction: null
      }));
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Native memory action failed.";
      setState((current) => ({ ...current, activeAction: null, error: message }));
      throw error;
    }
  }, [agentId]);

  return { ...state, loadStatus, loadDiary, search, runAction };
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
