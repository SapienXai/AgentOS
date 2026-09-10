import "server-only";

import { extractMissionCommandPayloads } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  getOpenClawAdapter,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  WorkspaceArchitectMode,
  WorkspaceArchitectModelExecutionRequest,
  WorkspaceArchitectModelExecutionResult
} from "@/lib/agentos/domains/workspace-blueprint";

export const DEFAULT_WORKSPACE_ARCHITECT_AGENT_ID = "agentos-planner-runtime-architect";

/**
 * Shared AgentOS/OpenClaw execution boundary for structured architect turns.
 * It deliberately does not create agents, workspaces, or planner topology.
 */
export async function runStructuredWorkspaceArchitectAgent(
  request: WorkspaceArchitectModelExecutionRequest,
  options: {
    adapter?: OpenClawAdapter;
    agentId?: string;
    sessionKey?: string;
  } = {}
): Promise<WorkspaceArchitectModelExecutionResult> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const agentId = options.agentId?.trim() || DEFAULT_WORKSPACE_ARCHITECT_AGENT_ID;
  const sessionKey = options.sessionKey?.trim() || `agent:${agentId}:architect:${request.runId}`;
  const timeoutMs = Math.max(1_000, Math.min(request.timeoutMs, 125_000));

  const payload = await adapter.runAgentTurn(
    {
      agentId,
      sessionKey,
      message: `${request.systemPrompt}\n\n${request.userPrompt}`,
      thinking: request.mode === "review" ? "high" : "medium",
      timeoutSeconds: Math.ceil(timeoutMs / 1_000),
      idempotencyKey: `${request.runId}:${request.attempt}`
    },
    {
      timeoutMs,
      signal: request.signal
    }
  );

  const text = extractMissionCommandPayloads(payload)
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n") || payload.summary?.trim() || "";

  return {
    text,
    runId: payload.runId ?? null,
    runtime: "native-openclaw"
  };
}

export function buildArchitectExecutionPrompt(
  policy: string,
  evidencePack: unknown,
  mode: WorkspaceArchitectMode,
  repairInstruction?: string
) {
  return {
    systemPrompt: policy,
    userPrompt: [
      `Architect mode: ${mode}`,
      "Return only the structured JSON proposal described by the policy.",
      repairInstruction,
      "Evidence pack:",
      JSON.stringify(evidencePack, null, 2)
    ].filter(Boolean).join("\n\n")
  };
}
