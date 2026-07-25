import "server-only";

import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { buildSessionModelOverrides } from "@/lib/openclaw/domains/session-model-scope";
import { redactSecretText } from "@/lib/security/redaction";

type SessionModelResetTarget = {
  sessionKey: string;
  agentId?: string;
};

export async function resetSessionModelOverride(input: {
  sessionKey: string;
  agentId?: string;
}) {
  const result = await resetSessionModelOverrides({ sessions: [input] });
  if (result.failures.length > 0) {
    throw new Error(result.failures[0]?.error || "Unable to reset the session model override.");
  }
  return result.snapshot;
}

export async function resetSessionModelOverrides(input: {
  sessions: SessionModelResetTarget[];
}) {
  const currentSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const activeOverrides = new Map(
    buildSessionModelOverrides(currentSnapshot).map((override) => [override.sessionKey, override])
  );
  const targets = Array.from(
    new Map(input.sessions.map((session) => [session.sessionKey, session])).values()
  );

  if (targets.length === 0) {
    throw new Error("At least one active session model override is required.");
  }

  for (const target of targets) {
    const activeOverride = activeOverrides.get(target.sessionKey);
    if (!activeOverride || (target.agentId && activeOverride.agentId !== target.agentId)) {
      throw new Error("One or more session model overrides are stale or outside the current OpenClaw snapshot.");
    }
  }

  const adapter = getOpenClawAdapter();
  if (!adapter.patchSessionModel) {
    throw new Error("This OpenClaw adapter does not support sessions.patch.");
  }

  const failures: Array<{ sessionKey: string; error: string }> = [];
  let resetCount = 0;

  for (const target of targets) {
    try {
      await adapter.patchSessionModel(
        {
          key: target.sessionKey,
          agentId: target.agentId,
          model: null
        },
        { timeoutMs: 8_000 }
      );
      resetCount += 1;
    } catch (error) {
      failures.push({
        sessionKey: target.sessionKey,
        error: redactSecretText(error instanceof Error ? error.message : "OpenClaw rejected the session model reset.")
      });
    }
  }

  if (resetCount > 0) {
    clearMissionControlCaches();
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  return { snapshot, resetCount, failures };
}
