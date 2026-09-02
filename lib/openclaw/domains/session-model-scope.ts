import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { normalizeOpenAiModelId } from "@/lib/openclaw/domains/model-provider-connection";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

export type SessionModelOverrideRecord = {
  runtimeId: string;
  sessionKey: string;
  sessionId: string | null;
  agentId: string;
  agentName: string;
  sessionModelId: string;
  agentModelId: string;
  title: string;
  updatedAt: number;
};

export function buildSessionModelOverrides(
  snapshot: MissionControlSnapshot
): SessionModelOverrideRecord[] {
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

  return snapshot.runtimes
    .flatMap((runtime) => {
      if (runtime.source !== "session" || !runtime.key || !runtime.modelId || !runtime.agentId) {
        return [];
      }

      const agent = agents.get(runtime.agentId);
      const agentModelId =
        agent?.modelId && agent.modelId !== "unassigned"
          ? normalizeOpenAiModelId(agent.modelId)
          : "";
      const sessionModelId = normalizeOpenAiModelId(runtime.modelId);

      if (!agent || !agentModelId || modelIdsShareRoute(sessionModelId, agentModelId)) {
        return [];
      }

      return [{
        runtimeId: runtime.id,
        sessionKey: runtime.key,
        sessionId: runtime.sessionId || null,
        agentId: agent.id,
        agentName: formatAgentDisplayName(agent),
        sessionModelId,
        agentModelId,
        title: runtime.title,
        updatedAt: runtime.updatedAt ?? 0
      }];
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function modelIdsShareRoute(left: string, right: string) {
  return (
    left === right ||
    left.endsWith(`/${right}`) ||
    right.endsWith(`/${left}`)
  );
}
