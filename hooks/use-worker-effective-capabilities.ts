"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "@/components/ui/sonner";
import type { SkillLibraryItem, WorkerEffectiveCapabilitiesPayload } from "@/lib/openclaw/types";

export type WorkerEffectiveCapabilitiesState = {
  loading: boolean;
  data: WorkerEffectiveCapabilitiesPayload | null;
  error: string | null;
};

export function useWorkerEffectiveCapabilities({
  agentId,
  enabled = true
}: {
  agentId: string | null | undefined;
  enabled?: boolean;
}) {
  const [state, setState] = useState<WorkerEffectiveCapabilitiesState>({
    loading: false,
    data: null,
    error: null
  });

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!agentId || !enabled) return;

    setState({ loading: true, data: null, error: null });
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/capabilities`, {
        cache: "no-store",
        signal
      });
      const payload = await response.json() as WorkerEffectiveCapabilitiesPayload & { error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to read effective capabilities.");
      }
      setState({ loading: false, data: payload, error: null });
      return payload;
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : "Unable to read effective capabilities.";
      setState({ loading: false, data: null, error: message });
      return null;
    }
  }, [agentId, enabled]);

  useEffect(() => {
    if (!enabled || !agentId) {
      setState({ loading: false, data: null, error: null });
      return;
    }

    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [agentId, enabled, refresh]);

  const activateSkill = useCallback(async (skill: SkillLibraryItem) => {
    if (!agentId) return false;
    const sessionKey = state.data?.session.key;
    if (!sessionKey) {
      toast.message("Skill activation is unavailable.", {
        description: "OpenClaw has not exposed a usable session context for this worker."
      });
      return false;
    }

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/capabilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey,
          action: "attach",
          skillId: skill.id,
          revision: skill.revision.id
        })
      });
      const payload = await response.json() as {
        capabilities?: WorkerEffectiveCapabilitiesPayload;
        error?: string;
      };
      if (!response.ok || payload.error || !payload.capabilities) {
        throw new Error(payload.error || "Skill activation failed.");
      }
      setState({ loading: false, data: payload.capabilities, error: null });
      toast.success("Skill activation requested.", {
        description: "OpenClaw will apply the selected revision on the next turn."
      });
      return true;
    } catch (error) {
      toast.error("Skill activation failed.", {
        description: error instanceof Error ? error.message : "Unknown activation error."
      });
      return false;
    }
  }, [agentId, state.data?.session.key]);

  return {
    ...state,
    refresh,
    activateSkill
  };
}
