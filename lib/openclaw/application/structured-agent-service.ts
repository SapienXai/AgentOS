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
import { classifyNativeMutationError } from "@/lib/openclaw/client/native-ws-gateway-errors";

export const DEFAULT_WORKSPACE_ARCHITECT_AGENT_ID = PLANNER_RUNTIME_ARCHITECT_AGENT_ID;

export type ProjectIntelligenceModelExecutionRequest = {
  runId: string;
  attempt: number;
  signal: AbortSignal;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
};

export type ProjectIntelligenceModelExecutionResult = {
  text: string;
  runId: string | null;
  sessionKey: string | null;
  runtime: "native-openclaw" | "model-runtime";
};

export class WorkspaceArchitectRuntimeUnavailableError extends Error {
  readonly kind: Exclude<PlannerRuntimeFailureKind, "none">;

  constructor(message: string, kind: Exclude<PlannerRuntimeFailureKind, "none"> = "runtime-bootstrap") {
    super(message);
    this.kind = kind;
    this.name = "WorkspaceArchitectRuntimeUnavailableError";
  }
}

/**
 * The adapter accepted a Project Intelligence turn but did not return a
 * trustworthy outcome. Callers must preserve the idempotency identity and
 * fail closed instead of retrying a potentially duplicated remote turn.
 */
export class ProjectIntelligenceRemoteExecutionError extends Error {
  readonly remoteExecutionStarted = true as const;

  constructor() {
    super("Project Intelligence execution outcome is ambiguous.");
    this.name = "ProjectIntelligenceRemoteExecutionError";
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
  const abortHandler = () => {
    void adapter.abortAgentTurn?.({ agentId, sessionKey }, { timeoutMs: 15_000 }).catch(() => undefined);
  };
  request.signal.addEventListener("abort", abortHandler, { once: true });
  let payload: Awaited<ReturnType<OpenClawAdapter["runAgentTurn"]>>;
  try {
    payload = await adapter.runAgentTurn(
      {
        agentId,
        sessionKey,
        message: `${request.systemPrompt}\n\n${request.userPrompt}`,
        thinking: "high",
        timeoutSeconds: Math.ceil(timeoutMs / 1_000),
        idempotencyKey: `${request.runId}:${request.attempt}`
      },
      {
        timeoutMs,
        signal: request.signal
      }
    );
  } finally {
    request.signal.removeEventListener("abort", abortHandler);
  }

  const text = extractMissionCommandPayloads(payload)
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n") || payload.summary?.trim() || "";
  const effectiveSessionKey = payload.sessionKey?.trim() || sessionKey;

  return {
    text,
    runId: payload.runId ?? null,
    sessionKey: effectiveSessionKey,
    runtime: "native-openclaw"
  };
}

/**
 * Uses the existing hidden OpenClaw runtime with an independent session
 * namespace for project-intelligence synthesis. It does not create a worker
 * or materialize a workspace.
 */
export async function runStructuredProjectIntelligenceAgent(
  request: ProjectIntelligenceModelExecutionRequest,
  options: {
    adapter?: OpenClawAdapter;
    runtimeDependencies?: PlannerRuntimeEnsureDependencies;
  } = {}
): Promise<ProjectIntelligenceModelExecutionResult> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const runtime = await ensureWorkspaceArchitectRuntime({ dependencies: options.runtimeDependencies });
  if (runtime.status !== "ready" || !runtime.architectAgentId) {
    throw new WorkspaceArchitectRuntimeUnavailableError(
      runtime.warning ?? "The hidden AgentOS Project Intelligence runtime is unavailable.",
      runtime.failureKind === "gateway" || runtime.failureKind === "authorization"
        ? runtime.failureKind
        : "runtime-bootstrap"
    );
  }
  const agentId = runtime.architectAgentId;
  const sessionKey = `agent:${agentId}:project-intelligence:${request.runId}`;
  const timeoutMs = Math.max(1_000, Math.min(request.timeoutMs, 125_000));
  const abortHandler = () => {
    void adapter.abortAgentTurn?.({ agentId, sessionKey }, { timeoutMs: 15_000 }).catch(() => undefined);
  };
  request.signal.addEventListener("abort", abortHandler, { once: true });
  let payload: Awaited<ReturnType<OpenClawAdapter["runAgentTurn"]>>;
  try {
    payload = await adapter.runAgentTurn(
      {
        agentId,
        sessionKey,
        message: `${request.systemPrompt}\n\n${request.userPrompt}`,
        thinking: "high",
        timeoutSeconds: Math.ceil(timeoutMs / 1_000),
        idempotencyKey: `project-intelligence:${request.runId}:${request.attempt}`
      },
      { timeoutMs, signal: request.signal }
    );
  } catch (error) {
    const classification = classifyNativeMutationError(error);
    if (classification.disposition === "definite-rejection") throw error;
    throw new ProjectIntelligenceRemoteExecutionError();
  } finally {
    request.signal.removeEventListener("abort", abortHandler);
  }
  const text = extractMissionCommandPayloads(payload)
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n") || payload.summary?.trim() || "";
  return {
    text,
    runId: payload.runId ?? null,
    sessionKey: payload.sessionKey?.trim() || sessionKey,
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

export function buildProjectIntelligenceExecutionPrompt(bundle: unknown) {
  return [
    "Return only a ProjectIntelligenceSynthesisProposal JSON object.",
    "The operator brief is context, not proof.",
    "Bounded normalized extraction:",
    JSON.stringify(bundle, null, 2)
  ].join("\n\n");
}
