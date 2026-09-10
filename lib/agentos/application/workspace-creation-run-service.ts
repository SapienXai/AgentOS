import "server-only";

import { createHash } from "node:crypto";

import {
  persistWorkspaceCreationIntake,
  readWorkspaceCreationContext,
  stageWorkspaceCreationKnowledge,
  type WorkspaceCreationContextStageResult,
  type WorkspaceCreationUpload
} from "@/lib/agentos/application/workspace-creation-context-service";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import {
  acquireProvisioningLease,
} from "@/lib/agentos/application/workspace-provisioning-lease";
import {
  appendWorkspaceCreationEvent,
  createInitialWorkspaceCreationSnapshot,
  isWorkspaceCreationTerminal,
  type WorkspaceCreationFailure,
  type WorkspaceCreationRun,
  type WorkspaceCreationRunInput,
  type WorkspaceCreationSnapshot
} from "@/lib/agentos/domains/workspace-creation-run";
import {
  createWorkspaceCreationRunAtomically,
  findWorkspaceCreationRunById,
  listWorkspaceCreationRuns,
  readWorkspaceCreationRun,
  readWorkspaceCreationRunFile,
  resolveWorkspaceCreationRunRoot,
  updateWorkspaceCreationRun
} from "@/lib/agentos/application/workspace-creation-run-store";
import { normalizeWorkspaceMaterialization, type WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import type { WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import { DEFAULT_KNOWLEDGE_INGESTION_LIMITS } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

export const DEFAULT_WORKSPACE_CREATION_BUDGET = {
  overallAnalysisBudgetMs: 180_000,
  architectReserveMs: 90_000,
  maxArchitectAttempts: 3,
  maxArchitectAttemptMs: 90_000
} as const;

export type WorkspaceCreationBudget = Partial<typeof DEFAULT_WORKSPACE_CREATION_BUDGET>;

export type WorkspaceCreationRunDependencies = {
  rootPath?: string;
  now?: () => Date;
  budget?: WorkspaceCreationBudget;
  persistIntake?: typeof persistWorkspaceCreationIntake;
  stageContext?: typeof stageWorkspaceCreationKnowledge;
  readContext?: typeof readWorkspaceCreationContext;
  generateArchitect?: typeof generateWorkspaceBlueprint;
};

type ResolvedDependencies = Required<Pick<WorkspaceCreationRunDependencies, "rootPath" | "now" | "persistIntake" | "stageContext" | "readContext" | "generateArchitect">> & {
  budget: typeof DEFAULT_WORKSPACE_CREATION_BUDGET;
};

const inFlight = new Map<string, Promise<WorkspaceCreationRun>>();
const activeControllers = new Map<string, AbortController>();

export type StartWorkspaceCreationRunInput = {
  actorId: string;
  idempotencyKey: string;
  brief: string;
  mode?: "automatic" | "review";
  operatorConstraints?: string[];
  materialization?: unknown;
  sources?: unknown[];
  uploads?: WorkspaceCreationUpload[];
  draftContextId?: string | null;
};

export async function startWorkspaceCreationRun(
  input: StartWorkspaceCreationRunInput,
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const actorId = input.actorId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!actorId) throw new Error("Workspace ownership is unavailable.");
  if (!idempotencyKey) throw new Error("A creation idempotency key is required.");
  const storageKey = buildWorkspaceCreationStorageKey(actorId, idempotencyKey);
  const existing = await readWorkspaceCreationRun(resolved.rootPath, storageKey);
  if (existing) {
    if (existing.input.brief !== redactSecretText(input.brief.trim()).slice(0, 12_000)) throw new Error("This creation idempotency key is already in use.");
    return publicRun(existing);
  }
  const brief = redactSecretText(input.brief.trim()).slice(0, 12_000);
  if (!brief) throw new Error("Workspace architect brief is required.");
  const sources = input.sources ?? [];
  const staged = await resolved.persistIntake({
    actorId,
    draftContextId: input.draftContextId,
    sources,
    uploads: input.uploads ?? []
  });
  const materialization = normalizeWorkspaceMaterialization(input.materialization ?? { mode: "empty" });
  const runInput: WorkspaceCreationRunInput = {
    brief,
    mode: input.mode ?? "automatic",
    operatorConstraints: (input.operatorConstraints ?? []).map((value) => redactSecretText(value.trim()).slice(0, 300)).filter(Boolean).slice(0, 12),
    materialization,
    sources: staged.sources
  };
  const created = await createWorkspaceCreationRunAtomically(resolved.rootPath, storageKey, {
    actorHash: workspaceCreationActorHash(actorId),
    idempotencyKeyHash: sha256(storageKey),
    attempt: 1,
    input: runInput,
    draftContextId: staged.draftContextId,
    snapshot: createInitialWorkspaceCreationSnapshot(staged.sources.length),
    result: null
  });
  if (created.created) ensureCreationRunExecution({ actorId, runId: created.run.runId }, resolved);
  return publicRun(await readWorkspaceCreationRunFile(created.filePath) ?? created.run);
}

export async function ensureCreationRunExecution(
  input: { actorId: string; runId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  if (isWorkspaceCreationTerminal(locator.run.snapshot.state)) return publicRun(locator.run);
  const current = inFlight.get(locator.filePath);
  if (current) return publicRun(await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run);
  const execution = executeCreationRun(locator.filePath, input.actorId, resolved)
    .catch((error) => recoverUnexpectedCreationFailure(locator.filePath, error, resolved))
    .finally(() => {
      if (inFlight.get(locator.filePath) === execution) inFlight.delete(locator.filePath);
      activeControllers.delete(locator.filePath);
    });
  inFlight.set(locator.filePath, execution);
  return publicRun(await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run);
}

export async function getWorkspaceCreationRun(
  input: { actorId: string; runId: string; afterSequence?: number },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  await ensureCreationRunExecution({ actorId: input.actorId, runId: input.runId }, resolved);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const after = Number.isSafeInteger(input.afterSequence) ? input.afterSequence! : 0;
  return publicRun({
    ...locator.run,
    events: locator.run.events.filter((event) => event.sequence > after)
  });
}

export async function listActiveWorkspaceCreationRuns(actorId: string, dependencies: WorkspaceCreationRunDependencies = {}) {
  const resolved = resolveDependencies(dependencies);
  const locators = await listWorkspaceCreationRuns(resolved.rootPath, actorId, true);
  await Promise.all(locators.map((locator) => ensureCreationRunExecution({ actorId, runId: locator.run.runId }, resolved)));
  return (await listWorkspaceCreationRuns(resolved.rootPath, actorId, true)).map(({ run }) => publicRun(run));
}

export async function cancelWorkspaceCreationRun(input: { actorId: string; runId: string }, dependencies: WorkspaceCreationRunDependencies = {}) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  if (isWorkspaceCreationTerminal(locator.run.snapshot.state)) return publicRun(locator.run);
  const now = resolved.now().toISOString();
  const snapshot: WorkspaceCreationSnapshot = {
    ...locator.run.snapshot,
    elapsedMs: elapsedMs(locator.run.createdAt, now),
    cancelRequested: true
  };
  let next = appendWorkspaceCreationEvent(locator.run, {
    schemaVersion: 1,
    createdAt: now,
    kind: "cancel-requested",
    stage: locator.run.snapshot.stage,
    snapshot,
    attempt: locator.run.attempt,
    maxAttempts: resolved.budget.maxArchitectAttempts,
    elapsedMs: elapsedMs(locator.run.createdAt, now),
    sourceId: null,
    warningCode: "cancel-requested",
    failure: { kind: "cancelled", code: "cancelled", retryability: "cancelled" }
  });
  next = await updateWorkspaceCreationRun(locator.filePath, next, { snapshot: next.snapshot, cancelRequestedAt: now });
  activeControllers.get(locator.filePath)?.abort();
  return publicRun(next);
}

async function executeCreationRun(filePath: string, actorId: string, dependencies: ResolvedDependencies): Promise<WorkspaceCreationRun> {
  let run = await readWorkspaceCreationRunFile(filePath);
  if (!run) throw new Error("Workspace creation run is unavailable.");
  const lease = await acquireProvisioningLease({ runFilePath: filePath, runId: run.runId, attempt: run.attempt });
  if (!lease) return await readWorkspaceCreationRunFile(filePath) ?? run;
  const controller = new AbortController();
  activeControllers.set(filePath, controller);
  const deadline = Date.now() + dependencies.budget.overallAnalysisBudgetMs;
  const timeout = setTimeout(() => controller.abort(), dependencies.budget.overallAnalysisBudgetMs);
  timeout.unref?.();
  try {
    await lease.assertOwned();
    if (run.remoteExecution.outcome === "in-flight" || run.remoteExecution.outcome === "ambiguous") {
      return await failRun(filePath, run, dependencies, failure("unknown", "remote-execution-ambiguous", "terminal", "Architect execution could not be safely recovered."));
    }
    if (run.snapshot.cancelRequested) {
      return await failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    }
    if (run.remoteExecution.outcome === "completed") {
      if (run.result === null) {
        return await failRun(filePath, run, dependencies, failure("unknown", "remote-execution-ambiguous", "terminal", "Architect execution completed without a durable review result."));
      }
      return await updateSnapshot(filePath, run, dependencies, { state: "review-ready", stage: "review-preparation" }, "state-changed");
    }
    run = await updateSnapshot(filePath, run, dependencies, { state: "running", stage: "context-staging" }, "state-changed");
    const cancellationCheck = await readWorkspaceCreationRunFile(filePath);
    if (cancellationCheck?.snapshot.cancelRequested) {
      return await failRun(filePath, cancellationCheck, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    }
    const contextBudget = Math.max(1, Math.min(
      DEFAULT_KNOWLEDGE_INGESTION_LIMITS.totalRunTimeoutMs,
      dependencies.budget.overallAnalysisBudgetMs - dependencies.budget.architectReserveMs
    ));
    const contextController = linkAbortSignals(controller.signal, contextBudget);
    let context: WorkspaceCreationContextStageResult;
    try {
      run = await updateSnapshot(filePath, run, dependencies, { stage: "source-ingestion" }, "state-changed");
      context = await dependencies.stageContext({
        actorId,
        draftContextId: run.draftContextId ?? undefined,
        sources: run.input.sources,
        signal: contextController.signal
      });
    } finally {
      contextController.dispose();
    }
    const usableContext = context.runStatus === "ready" || context.runStatus === "reused" || (context.runStatus === "partial" && hasUsableContext(context));
    const contextPartial = context.runStatus === "partial" || context.runStatus === "cancelled";
    run = await updateContextSnapshot(filePath, run, dependencies, context, contextPartial && usableContext, !usableContext && (contextPartial || context.runStatus === "error"));
    if (run.snapshot.cancelRequested) {
      return await failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    }
    if (!usableContext && contextPartial && run.input.sources.length > 0) {
      return await failRun(filePath, run, dependencies, failure("timeout", "context-budget-exhausted", "terminal", "Project context could not be staged within the shared analysis budget."));
    }
    const staged = await dependencies.readContext({ actorId, draftContextId: run.draftContextId! }).catch(() => null);
    const remaining = Math.max(1, deadline - Date.now());
    const attempts = Math.max(1, Math.min(dependencies.budget.maxArchitectAttempts, Math.floor(remaining / 5_000)));
    const attemptTimeout = Math.max(5_000, Math.min(dependencies.budget.maxArchitectAttemptMs, Math.floor(remaining / attempts)));
    run = await updateSnapshot(filePath, run, dependencies, { stage: "architect-runtime-preparation" }, "state-changed");
    run = await updateSnapshot(filePath, run, dependencies, { stage: "architect-reasoning" }, "state-changed");
    run = await updateWorkspaceCreationRun(filePath, run, {
      remoteExecution: {
        ...run.remoteExecution,
        idempotencyKey: `${run.runId}:${run.attempt}`,
        outcome: "in-flight"
      }
    });
    const architectStarted = Date.now();
    const result = await dependencies.generateArchitect({
      brief: run.input.brief,
      mode: run.input.mode,
      materialization: run.input.materialization as WorkspaceMaterialization,
      operatorConstraints: run.input.operatorConstraints,
      ...(staged ? { knowledge: staged.knowledge } : {})
    }, {
      runId: run.runId,
      signal: controller.signal,
      timeoutMs: attemptTimeout,
      maxRetries: attempts - 1,
      ...(staged ? { currentKnowledgeGenerationId: staged.generationId } : {})
    });
    run = await updateArchitectSnapshot(filePath, run, dependencies, result, Date.now() - architectStarted, contextPartial && usableContext);
    run = await updateWorkspaceCreationRun(filePath, run, {
      remoteExecution: {
        ...run.remoteExecution,
        runId: result.reasoning.remoteRunId ?? null,
        sessionKey: result.reasoning.remoteSessionKey ?? null,
        outcome: "completed"
      }
    });
    run = await updateWorkspaceCreationRun(filePath, run, { result });
    run = await updateSnapshot(filePath, run, dependencies, { state: "review-ready", stage: "review-preparation" }, "state-changed");
    return run;
  } catch (error) {
    if (run.snapshot.cancelRequested || controller.signal.aborted && Date.now() < deadline) {
      return await failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    }
    if (Date.now() >= deadline) {
      return await failRun(filePath, run, dependencies, failure("timeout", "budget-exhausted", "terminal", "Workspace creation exceeded its shared analysis budget."));
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    await lease.release().catch(() => undefined);
  }
}

async function updateContextSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, context: WorkspaceCreationContextStageResult, partial: boolean, failed: boolean) {
  const now = dependencies.now().toISOString();
  const snapshot: WorkspaceCreationSnapshot = {
    ...run.snapshot,
    context: {
      status: failed ? "failed" : partial ? "partial" : "ready",
      generationId: context.generationId,
      sourceCount: context.sources.length,
      usableEvidence: hasUsableContext(context),
      warningCodes: unique([...(partial ? ["partial-context"] : []), ...context.warnings.slice(0, 4).map(() => "context-warning")])
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "context-updated", partial ? "partial-context" : null, null, now);
}

async function updateArchitectSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, result: WorkspaceArchitectResult, elapsed: number, partialContext: boolean) {
  const retryability = result.reasoning.retryability ?? "terminal";
  const architectFailure = result.reasoning.failureKind !== "none" ? failure(
    result.reasoning.failureKind,
    result.reasoning.failureCode ?? safeFailureCode(result.reasoning.failureKind),
    retryability,
    "Architect reasoning was unavailable; a safe minimal draft was created."
  ) : null;
  const snapshot: WorkspaceCreationSnapshot = {
    ...run.snapshot,
    architect: {
      status: result.reasoning.status,
      attempts: result.reasoning.attempts,
      modelId: result.reasoning.modelId,
      elapsedMs: elapsed,
      failure: architectFailure,
      modelExecutionOccurred: result.reasoning.status === "model",
      structuredOutputAccepted: result.reasoning.status === "model" && result.validation.valid,
      retryAvailable: retryability === "transient" || retryability === "repairable",
      partialContext
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "architect-updated", partialContext ? "partial-context" : null, architectFailure ? { kind: architectFailure.kind, code: architectFailure.code, retryability: architectFailure.retryability } : null, dependencies.now().toISOString());
}

async function failRun(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, problem: WorkspaceCreationFailure, state: "failed" | "cancelled" = "failed") {
  const snapshot: WorkspaceCreationSnapshot = {
    ...run.snapshot,
    state,
    stage: null,
    architect: { ...run.snapshot.architect, status: "blocked", failure: problem, retryAvailable: problem.retryability === "transient" || problem.retryability === "repairable" },
    cancelRequested: state === "cancelled" || run.snapshot.cancelRequested
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "state-changed", problem.code, { kind: problem.kind, code: problem.code, retryability: problem.retryability }, dependencies.now().toISOString());
}

async function updateSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, change: Partial<WorkspaceCreationSnapshot>, kind: "state-changed" | "warning") {
  const snapshot = { ...run.snapshot, ...change };
  return appendAndPersist(filePath, run, dependencies, snapshot, kind, null, null, dependencies.now().toISOString());
}

async function appendAndPersist(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, snapshot: WorkspaceCreationSnapshot, kind: "state-changed" | "context-updated" | "architect-updated" | "warning", warningCode: string | null, failureValue: WorkspaceCreationEventFailure | null, now: string) {
  const base = await readWorkspaceCreationRunFile(filePath) ?? run;
  const nextSnapshot = {
    ...snapshot,
    elapsedMs: elapsedMs(base.createdAt, now),
    cancelRequested: snapshot.cancelRequested || base.snapshot.cancelRequested
  };
  const next = appendWorkspaceCreationEvent(base, {
    schemaVersion: 1,
    createdAt: now,
    kind,
    stage: snapshot.stage,
    snapshot: nextSnapshot,
    attempt: base.attempt,
    maxAttempts: dependencies.budget.maxArchitectAttempts,
    elapsedMs: elapsedMs(run.createdAt, now),
    sourceId: null,
    warningCode,
    failure: failureValue
  });
  return updateWorkspaceCreationRun(filePath, next, { snapshot: next.snapshot, events: next.events, oldestRetainedSequence: next.oldestRetainedSequence, updatedAt: next.updatedAt });
}

type WorkspaceCreationEventFailure = { kind: WorkspaceCreationFailure["kind"]; code: string; retryability: WorkspaceCreationFailure["retryability"] };

async function recoverUnexpectedCreationFailure(filePath: string, error: unknown, dependencies: ResolvedDependencies) {
  const run = await readWorkspaceCreationRunFile(filePath);
  if (!run) throw error;
  if (isWorkspaceCreationTerminal(run.snapshot.state)) return run;
  return failRun(filePath, run, dependencies, failure("unknown", "creation-run-failed", "terminal", redactErrorMessage(error, "Workspace creation failed.")));
}

function resolveDependencies(input: WorkspaceCreationRunDependencies): ResolvedDependencies {
  return {
    rootPath: resolveWorkspaceCreationRunRoot(input.rootPath),
    now: input.now ?? (() => new Date()),
    persistIntake: input.persistIntake ?? persistWorkspaceCreationIntake,
    stageContext: input.stageContext ?? stageWorkspaceCreationKnowledge,
    readContext: input.readContext ?? readWorkspaceCreationContext,
    generateArchitect: input.generateArchitect ?? generateWorkspaceBlueprint,
    budget: { ...DEFAULT_WORKSPACE_CREATION_BUDGET, ...(input.budget ?? {}) }
  };
}

function publicRun(run: WorkspaceCreationRun): WorkspaceCreationRun {
  return structuredClone(run);
}

function hasUsableContext(context: WorkspaceCreationContextStageResult) {
  return Boolean(context.generationId) && context.sourceReports.some((report) => report.storedDocuments > 0);
}

function failure(kind: WorkspaceCreationFailure["kind"], code: string, retryability: WorkspaceCreationFailure["retryability"], message: string): WorkspaceCreationFailure {
  return { kind, code, retryability, message: redactSecretText(message).slice(0, 300) };
}

function safeFailureCode(kind: string) {
  return kind === "timeout" ? "architect-timeout" : kind === "cancelled" ? "cancelled" : "architect-unavailable";
}

function elapsedMs(start: string, end: string) {
  return Math.max(0, Date.parse(end) - Date.parse(start));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceCreationActorHash(actorId: string) {
  return sha256(actorId.trim()).slice(0, 32);
}

function buildWorkspaceCreationStorageKey(actorId: string, idempotencyKey: string) {
  return `${workspaceCreationActorHash(actorId)}:${sha256(idempotencyKey.trim())}`;
}

function linkAbortSignals(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parent.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent.removeEventListener("abort", onAbort); } };
}
