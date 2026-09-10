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
  type WorkspaceCreationActivityCode,
  type WorkspaceCreationActivityData,
  type WorkspaceCreationFailure,
  type WorkspaceCreationRun,
  type WorkspaceCreationRunInput,
  type WorkspaceCreationSourceProgress,
  type WorkspaceCreationSnapshot
} from "@/lib/agentos/domains/workspace-creation-run";
import {
  createWorkspaceCreationRunAtomically,
  findWorkspaceCreationRunById,
  listWorkspaceCreationRuns,
  mutateWorkspaceCreationRun,
  readWorkspaceCreationRun,
  readWorkspaceCreationRunFile,
  resolveWorkspaceCreationRunRoot
} from "@/lib/agentos/application/workspace-creation-run-store";
import { normalizeWorkspaceMaterialization, type WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import type { WorkspaceArchitectLifecycleEvent, WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import { DEFAULT_KNOWLEDGE_INGESTION_LIMITS, type KnowledgeIngestionProgress } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { normalizeWorkspaceKnowledgeSources, workspaceKnowledgeSourceIdentity, type WorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
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
  const brief = redactSecretText(input.brief.trim()).slice(0, 12_000);
  if (!brief) throw new Error("Workspace architect brief is required.");
  const mode = input.mode ?? "automatic";
  const operatorConstraints = normalizeCreationConstraints(input.operatorConstraints ?? []);
  const materialization = normalizeWorkspaceMaterialization(input.materialization ?? { mode: "empty" });
  const normalizedSources = normalizeWorkspaceKnowledgeSources(input.sources ?? []);
  const inputFingerprint = createWorkspaceCreationInputFingerprint({
    brief,
    mode,
    operatorConstraints,
    materialization,
    sources: normalizedSources,
    draftContextId: input.draftContextId ?? null,
    uploads: input.uploads ?? []
  });
  const storageKey = buildWorkspaceCreationStorageKey(actorId, idempotencyKey);
  const existing = await readWorkspaceCreationRun(resolved.rootPath, storageKey);
  if (existing) {
    if (existing.inputFingerprint && existing.inputFingerprint !== inputFingerprint) throw new Error("This creation idempotency key is already in use with different creation intent.");
    if (!existing.inputFingerprint && legacyCreationIntentFingerprint(existing, input.draftContextId ?? null) !== inputFingerprint) throw new Error("This creation idempotency key is already in use with different creation intent.");
    return publicRun(existing);
  }
  const sources = input.sources ?? [];
  const staged = await resolved.persistIntake({
    actorId,
    draftContextId: input.draftContextId,
    sources,
    uploads: input.uploads ?? []
  });
  const runInput: WorkspaceCreationRunInput = {
    brief,
    mode,
    operatorConstraints,
    materialization,
    sources: staged.sources
  };
  const created = await createWorkspaceCreationRunAtomically(resolved.rootPath, storageKey, {
    actorHash: workspaceCreationActorHash(actorId),
    idempotencyKeyHash: sha256(storageKey),
    attempt: 1,
    input: runInput,
    inputFingerprint,
    draftContextId: staged.draftContextId,
    snapshot: createInitialWorkspaceCreationSnapshot(staged.sources.length),
    result: null
  });
  if (!created.created && created.run.inputFingerprint && created.run.inputFingerprint !== inputFingerprint) {
    throw new Error("This creation idempotency key is already in use with different creation intent.");
  }
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
  const next = await mutateWorkspaceCreationRun(locator.filePath, (current) => {
    if (isWorkspaceCreationTerminal(current.snapshot.state) || current.snapshot.cancelRequested) return current;
    const now = resolved.now().toISOString();
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      elapsedMs: elapsedMs(current.createdAt, now),
      cancelRequested: true
    };
    return {
      ...appendWorkspaceCreationEvent(current, {
        schemaVersion: 1,
        createdAt: now,
        kind: "cancel-requested",
        stage: current.snapshot.stage,
        snapshot,
        attempt: current.attempt,
        maxAttempts: resolved.budget.maxArchitectAttempts,
        elapsedMs: elapsedMs(current.createdAt, now),
        sourceId: null,
        warningCode: "cancel-requested",
        failure: { kind: "cancelled", code: "cancelled", retryability: "cancelled" },
        activityCode: null,
        activityData: null
      }),
      cancelRequestedAt: now
    };
  });
  activeControllers.get(locator.filePath)?.abort();
  await inFlight.get(locator.filePath)?.catch(() => undefined);
  const completed = await readWorkspaceCreationRunFile(locator.filePath);
  if (completed) return publicRun(completed);
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
      const stagedRun = run;
      context = await dependencies.stageContext({
        actorId,
        draftContextId: stagedRun.draftContextId ?? undefined,
        sources: stagedRun.input.sources,
        signal: contextController.signal,
        onProgress: async (progress) => { await recordIngestionProgress(filePath, stagedRun, dependencies, progress); }
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
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({
      ...current,
      remoteExecution: {
        ...current.remoteExecution,
        idempotencyKey: `${current.runId}:${current.attempt}`,
        outcome: "in-flight"
      }
    }));
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
      ...(staged ? { currentKnowledgeGenerationId: staged.generationId } : {}),
      onLifecycleEvent: (event) => recordArchitectLifecycle(filePath, dependencies, event)
    });
    run = await updateArchitectSnapshot(filePath, run, dependencies, result, Date.now() - architectStarted, contextPartial && usableContext);
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({
      ...current,
      remoteExecution: {
        ...current.remoteExecution,
        runId: result.reasoning.remoteRunId ?? null,
        sessionKey: result.reasoning.remoteSessionKey ?? null,
        outcome: "completed"
      }
    }));
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({ ...current, result }));
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
      warningCodes: unique([...(partial ? ["partial-context"] : []), ...context.warnings.slice(0, 4).map(() => "context-warning")]),
      sourceProgress: run.snapshot.context.sourceProgress ?? []
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "context-updated", partial ? "partial-context" : null, null, now);
}

async function recordIngestionProgress(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, progress: KnowledgeIngestionProgress) {
  const latest = await readWorkspaceCreationRunFile(filePath) ?? run;
  const sourceId = progress.sourceId;
  if (!sourceId) return run;
  const sourceKind = progress.sourceKind ?? sourceKindFromRun(latest, sourceId);
  if (!sourceKind) return run;
  const currentProgress = latest.snapshot.context.sourceProgress ?? [];
  const nextProgress: WorkspaceCreationSourceProgress = {
    sourceId,
    sourceKind,
    state: progressState(progress.status),
    discoveredItems: progress.discoveredItems ?? progress.total,
    fetchedItems: progress.fetchedItems ?? 0,
    storedDocuments: progress.storedDocuments ?? 0,
    warningCount: progress.warningCount,
    currentActivity: progress.activityCode ?? progress.phase,
    currentLocator: safeProgressLocator(progress.currentLocator)
  };
  const sourceProgress = [...currentProgress.filter((entry) => entry.sourceId !== sourceId), nextProgress]
    .sort((left, right) => sourceOrder(latest, left.sourceId) - sourceOrder(latest, right.sourceId));
  const snapshot: WorkspaceCreationSnapshot = {
    ...latest.snapshot,
    context: {
      ...run.snapshot.context,
      sourceProgress
    }
  };
  const activityCode = asCreationActivityCode(progress.activityCode ?? progressStateActivity(progress.status, progress.phase));
  const activityData: WorkspaceCreationActivityData = {
    sourceKind,
    sourceState: nextProgress.state,
    discoveredItems: nextProgress.discoveredItems,
    fetchedItems: nextProgress.fetchedItems,
    storedDocuments: nextProgress.storedDocuments,
    warningCount: nextProgress.warningCount,
    currentActivity: nextProgress.currentActivity,
    currentLocator: nextProgress.currentLocator
  };
  return appendAndPersist(filePath, latest, dependencies, snapshot, "context-updated", null, null, dependencies.now().toISOString(), activityCode, activityData, sourceId);
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

async function recordArchitectLifecycle(filePath: string, dependencies: ResolvedDependencies, event: WorkspaceArchitectLifecycleEvent) {
  const current = await readWorkspaceCreationRunFile(filePath);
  if (!current || isWorkspaceCreationTerminal(current.snapshot.state)) return;
  const attempts = Math.max(current.snapshot.architect.attempts, event.attempt);
  const architectStatus = event.code === "architect-fallback" ? "fallback" : event.code === "architect-completed" ? "model" : current.snapshot.architect.status;
  const failureValue = event.failureKind && event.failureKind !== "none" && event.failureCode && event.retryability
    ? failure(event.failureKind === "structured-output" ? "structured-output" : event.failureKind, event.failureCode, event.retryability, "Architect reasoning was unavailable; a safe minimal draft may be created.")
    : current.snapshot.architect.failure;
  const snapshot: WorkspaceCreationSnapshot = {
    ...current.snapshot,
    architect: {
      ...current.snapshot.architect,
      status: architectStatus,
      attempts,
      elapsedMs: Math.max(current.snapshot.architect.elapsedMs, event.elapsedMs),
      modelId: event.modelId ?? current.snapshot.architect.modelId,
      failure: failureValue,
      modelExecutionOccurred: current.snapshot.architect.modelExecutionOccurred || event.code === "architect-model-started" || event.code === "architect-model-completed",
      structuredOutputAccepted: event.structuredOutputAccepted === true || current.snapshot.architect.structuredOutputAccepted,
      retryAvailable: event.retryability === "transient" || event.retryability === "repairable" || current.snapshot.architect.retryAvailable
    }
  };
  const activityData: WorkspaceCreationActivityData = {
    runtimeMode: event.runtimeMode,
    modelId: event.modelId ?? null,
    structuredOutputAccepted: event.structuredOutputAccepted,
    retryability: event.retryability
  };
  await appendAndPersist(filePath, current, dependencies, snapshot, "architect-updated", event.failureCode ?? null, failureValue ? { kind: failureValue.kind, code: failureValue.code, retryability: failureValue.retryability } : null, dependencies.now().toISOString(), event.code, activityData);
}

async function failRun(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, problem: WorkspaceCreationFailure, state: "failed" | "cancelled" = "failed") {
  return mutateWorkspaceCreationRun(filePath, (current) => {
    if (isWorkspaceCreationTerminal(current.snapshot.state)) return current;
    const now = dependencies.now().toISOString();
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      state,
      stage: null,
      architect: { ...current.snapshot.architect, status: "blocked", failure: problem, retryAvailable: problem.retryability === "transient" || problem.retryability === "repairable" },
      cancelRequested: state === "cancelled" || current.snapshot.cancelRequested,
      elapsedMs: elapsedMs(current.createdAt, now)
    };
    return appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind: "state-changed",
      stage: null,
      snapshot,
      attempt: current.attempt,
      maxAttempts: dependencies.budget.maxArchitectAttempts,
      elapsedMs: elapsedMs(current.createdAt, now),
      sourceId: null,
      warningCode: problem.code,
      failure: { kind: problem.kind, code: problem.code, retryability: problem.retryability },
      activityCode: state === "cancelled" ? null : "source-failed",
      activityData: null
    });
  });
}

async function updateSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, change: Partial<WorkspaceCreationSnapshot>, kind: "state-changed" | "warning") {
  const snapshot = { ...run.snapshot, ...change };
  return appendAndPersist(filePath, run, dependencies, snapshot, kind, null, null, dependencies.now().toISOString());
}

async function appendAndPersist(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, snapshot: WorkspaceCreationSnapshot, kind: "state-changed" | "context-updated" | "architect-updated" | "warning", warningCode: string | null, failureValue: WorkspaceCreationEventFailure | null, now: string, activityCode: WorkspaceCreationActivityCode | null = null, activityData: WorkspaceCreationActivityData | null = null, sourceId: string | null = null) {
  return mutateWorkspaceCreationRun(filePath, (current) => {
    if (isWorkspaceCreationTerminal(current.snapshot.state) && snapshot.state !== current.snapshot.state) return current;
    const requestedCancel = snapshot.cancelRequested || current.snapshot.cancelRequested;
    const sourceProgress = sourceId && activityData?.sourceKind
      ? upsertSourceProgress(current, sourceId, activityData)
      : current.snapshot.context.sourceProgress ?? snapshot.context.sourceProgress ?? [];
    const nextSnapshot: WorkspaceCreationSnapshot = {
      ...snapshot,
      context: {
        ...current.snapshot.context,
        ...snapshot.context,
        sourceProgress
      },
      architect: { ...current.snapshot.architect, ...snapshot.architect },
      cancelRequested: requestedCancel,
      state: requestedCancel ? "cancelled" : snapshot.state,
      stage: requestedCancel ? null : snapshot.stage,
      elapsedMs: elapsedMs(current.createdAt, now)
    };
    const next = appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind,
      stage: nextSnapshot.stage,
      snapshot: nextSnapshot,
      attempt: current.attempt,
      maxAttempts: dependencies.budget.maxArchitectAttempts,
      elapsedMs: elapsedMs(current.createdAt, now),
      sourceId,
      warningCode,
      failure: failureValue,
      activityCode,
      activityData
    });
    return next;
  });
}

type WorkspaceCreationEventFailure = { kind: WorkspaceCreationFailure["kind"]; code: string; retryability: WorkspaceCreationFailure["retryability"] };

function upsertSourceProgress(run: WorkspaceCreationRun, sourceId: string, data: WorkspaceCreationActivityData) {
  const current = run.snapshot.context.sourceProgress ?? [];
  const existing = current.find((entry) => entry.sourceId === sourceId);
  const next: WorkspaceCreationSourceProgress = {
    sourceId,
    sourceKind: data.sourceKind ?? existing?.sourceKind ?? "website",
    state: data.sourceState ?? existing?.state ?? "pending",
    discoveredItems: data.discoveredItems ?? existing?.discoveredItems ?? 0,
    fetchedItems: data.fetchedItems ?? existing?.fetchedItems ?? 0,
    storedDocuments: data.storedDocuments ?? existing?.storedDocuments ?? 0,
    warningCount: data.warningCount ?? existing?.warningCount ?? 0,
    currentActivity: data.currentActivity ?? existing?.currentActivity ?? null,
    currentLocator: data.currentLocator ?? existing?.currentLocator ?? null
  };
  return [...current.filter((entry) => entry.sourceId !== sourceId), next]
    .sort((left, right) => sourceOrder(run, left.sourceId) - sourceOrder(run, right.sourceId));
}

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

function sourceKindFromRun(run: WorkspaceCreationRun, sourceId: string): WorkspaceCreationSourceProgress["sourceKind"] | null {
  const source = run.input.sources.find((value) => Boolean(value && typeof value === "object" && "id" in value && value.id === sourceId)) as { kind?: string } | undefined;
  return source?.kind && ["prompt", "website", "repository", "file", "folder", "connector"].includes(source.kind)
    ? source.kind as WorkspaceCreationSourceProgress["sourceKind"]
    : null;
}

function sourceOrder(run: WorkspaceCreationRun, sourceId: string) {
  const index = run.input.sources.findIndex((value) => Boolean(value && typeof value === "object" && "id" in value && value.id === sourceId));
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function progressState(status: KnowledgeIngestionProgress["status"]): WorkspaceCreationSourceProgress["state"] {
  if (status === "discovering") return "discovering";
  if (status === "fetching") return "fetching";
  if (status === "normalizing") return "normalizing";
  if (status === "ready") return "ready";
  if (status === "partial") return "partial";
  return "failed";
}

function progressStateActivity(status: KnowledgeIngestionProgress["status"], phase: KnowledgeIngestionProgress["phase"]): WorkspaceCreationActivityCode {
  if (status === "ready") return "source-completed";
  if (status === "partial") return "source-partial";
  if (status === "error") return "source-failed";
  if (phase === "discover") return "source-started";
  if (phase === "fetch") return "page-fetch-started";
  if (phase === "normalize") return "document-stored";
  return "source-started";
}

function asCreationActivityCode(value: string): WorkspaceCreationActivityCode {
  const codes: readonly WorkspaceCreationActivityCode[] = [
    "source-started", "page-discovered", "page-fetch-started", "page-fetched", "document-stored", "source-partial", "source-completed", "source-failed",
    "architect-started", "architect-runtime-ready", "architect-attempt-started", "architect-model-started", "architect-model-completed", "architect-structured-output-rejected", "architect-attempt-failed", "architect-retry-scheduled", "architect-attempt-completed", "architect-fallback", "architect-completed"
  ];
  return codes.includes(value as WorkspaceCreationActivityCode) ? value as WorkspaceCreationActivityCode : "source-started";
}

function safeProgressLocator(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}${url.pathname || "/"}`.slice(0, 500);
  } catch {
    return null;
  }
}

function normalizeCreationConstraints(values: string[]) {
  return values.map((value) => redactSecretText(value.trim()).slice(0, 300)).filter(Boolean).slice(0, 12);
}

function createWorkspaceCreationInputFingerprint(input: {
  brief: string;
  mode: "automatic" | "review";
  operatorConstraints: string[];
  materialization: WorkspaceMaterialization;
  sources: WorkspaceKnowledgeSource[];
  draftContextId: string | null;
  uploads: WorkspaceCreationUpload[];
}) {
  return sha256(stableSerialize({
    version: 1,
    brief: input.brief,
    mode: input.mode,
    operatorConstraints: input.operatorConstraints,
    materialization: input.materialization,
    sources: input.sources.map(sourceFingerprintProjection),
    draftContextId: input.draftContextId,
    uploads: input.uploads.map((upload) => ({
      sourceId: upload.sourceId,
      relativePath: upload.relativePath.replace(/\\/g, "/"),
      fileName: upload.fileName,
      size: upload.bytes.byteLength,
      contentHash: sha256(upload.bytes)
    })).sort((left, right) => `${left.sourceId}/${left.relativePath}`.localeCompare(`${right.sourceId}/${right.relativePath}`))
  }));
}

function legacyCreationIntentFingerprint(run: WorkspaceCreationRun, draftContextId: string | null) {
  return sha256(stableSerialize({
    version: 1,
    brief: run.input.brief,
    mode: run.input.mode,
    operatorConstraints: run.input.operatorConstraints,
    materialization: run.input.materialization,
    sources: normalizeWorkspaceKnowledgeSources(run.input.sources).map(sourceFingerprintProjection),
    draftContextId,
    uploads: []
  }));
}

function sourceFingerprintProjection(source: WorkspaceKnowledgeSource) {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    summary: source.summary,
    details: source.details,
    provenance: source.provenance,
    locator: source.locator,
    confidence: source.confidence ?? null,
    error: source.error ?? null,
    identity: workspaceKnowledgeSourceIdentity(source)
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string | Buffer) {
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
