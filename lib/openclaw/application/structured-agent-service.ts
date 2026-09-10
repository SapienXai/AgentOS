import "server-only";

import { extractMissionCommandPayloads } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  getOpenClawAdapter,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  ensureWorkspaceArchitectRuntime,
  PLANNER_RUNTIME_ARCHITECT_AGENT_ID,
  type PlannerRuntimeEnsureDependencies,
  type PlannerRuntimeFailureKind
} from "@/lib/openclaw/application/planner-runtime-service";
import type {
  WorkspaceArchitectMode,
  WorkspaceArchitectModelExecutionRequest,
  WorkspaceArchitectModelExecutionResult
} from "@/lib/agentos/domains/workspace-blueprint";

export const DEFAULT_WORKSPACE_ARCHITECT_AGENT_ID = PLANNER_RUNTIME_ARCHITECT_AGENT_ID;

export class WorkspaceArchitectRuntimeUnavailableError extends Error {
  readonly kind: Exclude<PlannerRuntimeFailureKind, "none">;

  constructor(message: string, kind: Exclude<PlannerRuntimeFailureKind, "none"> = "runtime-bootstrap") {
    super(message);
    this.kind = kind;
    this.name = "WorkspaceArchitectRuntimeUnavailableError";
  }
}

/**
 * Shared AgentOS/OpenClaw execution boundary for structured architect turns.
 * It may ensure only the hidden AgentOS Architect runtime before execution;
 * final user workspace topology remains outside this boundary.
 */
export async function runStructuredWorkspaceArchitectAgent(
  request: WorkspaceArchitectModelExecutionRequest,
  options: {
    adapter?: OpenClawAdapter;
    sessionKey?: string;
    runtimeDependencies?: PlannerRuntimeEnsureDependencies;
  } = {}
): Promise<WorkspaceArchitectModelExecutionResult> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const runtime = await ensureWorkspaceArchitectRuntime({ dependencies: options.runtimeDependencies });
  if (runtime.status !== "ready" || !runtime.architectAgentId) {
    throw new WorkspaceArchitectRuntimeUnavailableError(
      runtime.warning ?? "The hidden AgentOS Architect runtime is unavailable.",
      runtime.failureKind === "gateway" || runtime.failureKind === "authorization"
        ? runtime.failureKind
        : "runtime-bootstrap"
    );
  }
  const agentId = runtime.architectAgentId;
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
