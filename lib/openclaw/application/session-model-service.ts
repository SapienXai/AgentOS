import "server-only";

import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { buildSessionModelOverrides } from "@/lib/openclaw/domains/session-model-scope";
import { redactSecretText } from "@/lib/security/redaction";
import { normalizeOpenAiModelId } from "@/lib/openclaw/domains/model-provider-connection";

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

export async function setSessionModelOverride(input: {
  sessionKey: string;
  agentId?: string;
  modelId: string;
}) {
  const sessionKey = input.sessionKey.trim();
  const modelId = normalizeOpenAiModelId(input.modelId);
  if (!sessionKey || !modelId) {
    throw new Error("A session and model are required.");
  }

  const adapter = getOpenClawAdapter();
  if (!adapter.patchSessionModel) {
    throw new Error("This OpenClaw adapter does not support sessions.patch.");
  }

  const catalog = await adapter.listModels(
    { view: "configured", ...(input.agentId ? { agentId: input.agentId } : {}) },
    { timeoutMs: 8_000 }
  );
  const selected = catalog.models.find((model) => model.key.toLowerCase() === modelId.toLowerCase());
  if (!selected) {
    throw new Error("OpenClaw did not return that model for this worker.");
  }
  if (selected.available !== true) {
    throw new Error(selected.unavailableReason === "missing-auth"
      ? "Connect this provider in OpenClaw before selecting the model."
      : "OpenClaw reports that model is not ready for this worker.");
  }

  try {
    await adapter.patchSessionModel({
      key: sessionKey,
      agentId: input.agentId,
      model: modelId
    }, { timeoutMs: 8_000 });
  } catch (error) {
    const reconciled = await readNativeSessionForModelMutation(adapter, sessionKey, input.agentId).catch(() => null);
    if (!reconciled || normalizeNativeSessionModel(reconciled) !== modelId.toLowerCase()) {
      throw error;
    }
  }
  clearMissionControlCaches();
  return getMissionControlSnapshot({ force: true });
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
  const remainingOverrides = new Set(
    buildSessionModelOverrides(snapshot).map((override) => override.sessionKey)
  );
  for (const failure of [...failures]) {
    if (!remainingOverrides.has(failure.sessionKey)) {
      failures.splice(failures.indexOf(failure), 1);
      resetCount += 1;
    }
  }
  return { snapshot, resetCount, failures };
}

async function readNativeSessionForModelMutation(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  sessionKey: string,
  agentId?: string
) {
  const payload = await adapter.listSessions({
    limit: 20,
    ...(agentId ? { agentId } : {}),
    search: sessionKey
  }, { timeoutMs: 8_000 });

  return payload.sessions.find((session) => session.key === sessionKey || session.sessionId === sessionKey) ?? null;
}

function normalizeNativeSessionModel(
  session: Record<string, unknown> & { model?: string; modelProvider?: string }
) {
  const model = typeof session.model === "string" ? session.model.trim() : "";
  const provider = typeof session.modelProvider === "string" ? session.modelProvider.trim() : "";
  if (!model) {
    return null;
  }

  return normalizeOpenAiModelId(provider && !model.includes("/") ? `${provider}/${model}` : model).toLowerCase();
}
