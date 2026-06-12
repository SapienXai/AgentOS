"use client";

import { useCallback } from "react";

import type {
  ContextEngineFileReadResponse,
  ContextEngineSaveInput,
  ContextEngineSnapshot
} from "@/lib/openclaw/context-engine-types";

type ApiErrorPayload = {
  error?: string;
};

export function useContextEngineLoader(agentId: string | null) {
  const loadSnapshot = useCallback(async () => {
    if (!agentId) {
      throw new Error("Agent is required.");
    }

    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context`, {
      cache: "no-store"
    });
    const result = (await response.json()) as ContextEngineSnapshot & ApiErrorPayload;

    if (!response.ok || result.error) {
      throw new Error(result.error || "Context Engine snapshot could not be loaded.");
    }

    return result;
  }, [agentId]);

  const loadFile = useCallback(async (selectedPath: string) => {
    if (!agentId) {
      throw new Error("Agent is required.");
    }

    const response = await fetch(
      `/api/agents/${encodeURIComponent(agentId)}/context/file?path=${encodeURIComponent(selectedPath)}`,
      { cache: "no-store" }
    );
    const result = (await response.json()) as ContextEngineFileReadResponse & ApiErrorPayload;

    if (!response.ok || result.error) {
      throw new Error(result.error || "Context file could not be loaded.");
    }

    return result;
  }, [agentId]);

  const saveConfiguration = useCallback(async (payload: ContextEngineSaveInput) => {
    if (!agentId) {
      throw new Error("Agent is required.");
    }

    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const result = (await response.json()) as ContextEngineSnapshot & ApiErrorPayload;

    if (!response.ok || result.error) {
      throw new Error(result.error || "Context configuration could not be saved.");
    }

    return result;
  }, [agentId]);

  const saveFile = useCallback(async (input: { path: string; content: string }) => {
    if (!agentId) {
      throw new Error("Agent is required.");
    }

    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context/file`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    });
    const result = (await response.json()) as ContextEngineFileReadResponse & ApiErrorPayload;

    if (!response.ok || result.error) {
      throw new Error(result.error || "Context file could not be saved.");
    }

    return result;
  }, [agentId]);

  return {
    loadSnapshot,
    loadFile,
    saveConfiguration,
    saveFile
  };
}
