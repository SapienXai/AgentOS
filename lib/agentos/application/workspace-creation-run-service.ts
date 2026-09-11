import "server-only";

import { createHash } from "node:crypto";

import {
  persistWorkspaceCreationIntake,
  persistWorkspaceCreationIntelligencePack,
  readWorkspaceCreationIntelligencePack,
  readWorkspaceCreationIntelligenceSummary,
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
import type { WorkspaceArchitectIntelligenceInput, WorkspaceArchitectLifecycleEvent, WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import { DEFAULT_KNOWLEDGE_INGESTION_LIMITS, type KnowledgeIngestionProgress } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { normalizeWorkspaceKnowledgeSources, workspaceKnowledgeSourceIdentity, type WorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";
import type { ProjectIntelligenceExtractionSummary } from "@/lib/agentos/application/project-intelligence-extraction-service";
import {
  createFallbackProjectIntelligenceSynthesisProposal,
  createFallbackProjectIntelligencePack,
  createProjectIntelligenceSynthesisInputFingerprint,
  synthesizeProjectIntelligence,
  type ProjectIntelligenceSynthesisResult
} from "@/lib/agentos/application/project-intelligence-synthesis-service";
import { ProjectIntelligenceRemoteExecutionError } from "@/lib/openclaw/application/structured-agent-service";

export const DEFAULT_WORKSPACE_CREATION_BUDGET = {
  overallAnalysisBudgetMs: 300_000,
  architectReserveMs: 90_000,
  intelligenceReserveMs: 90_000,
  maxArchitectAttempts: 3,
  maxArchitectAttemptMs: 90_000,
  maxIntelligenceAttempts: 2,
  maxIntelligenceAttemptMs: 75_000
} as const;

export type WorkspaceCreationBudget = Partial<typeof DEFAULT_WORKSPACE_CREATION_BUDGET>;

export type WorkspaceCreationRunDependencies = {
  rootPath?: string;
  now?: () => Date;
  budget?: WorkspaceCreationBudget;
  persistIntake?: typeof persistWorkspaceCreationIntake;
  stageContext?: typeof stageWorkspaceCreationKnowledge;
  readContext?: typeof readWorkspaceCreationContext;
  synthesizeIntelligence?: typeof synthesizeProjectIntelligence;
  readIntelligencePack?: typeof readWorkspaceCreationIntelligencePack;
  readIntelligenceSummary?: typeof readWorkspaceCreationIntelligenceSummary;
  persistIntelligencePack?: typeof persistWorkspaceCreationIntelligencePack;
  generateArchitect?: typeof generateWorkspaceBlueprint;
};

type ResolvedDependencies = Required<Pick<WorkspaceCreationRunDependencies, "rootPath" | "now" | "persistIntake" | "stageContext" | "readContext" | "synthesizeIntelligence" | "readIntelligencePack" | "readIntelligenceSummary" | "persistIntelligencePack" | "generateArchitect">> & {
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
      dependencies.budget.overallAnalysisBudgetMs - dependencies.budget.architectReserveMs - dependencies.budget.intelligenceReserveMs
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
    run = await updateSnapshot(filePath, run, dependencies, { stage: "structured-extraction" }, "state-changed");
    run = await appendAndPersist(
      filePath,
      run,
      dependencies,
      { ...run.snapshot, extraction: { ...run.snapshot.extraction, status: "pending" } },
      "context-updated",
      null,
      null,
      dependencies.now().toISOString(),
      "extraction-started",
      { extractionStatus: "pending" }
    );
    if (context.extractionSummary) run = await updateExtractionSnapshot(filePath, run, dependencies, context.extractionSummary);
    const staged = await dependencies.readContext({ actorId, draftContextId: run.draftContextId! }).catch(() => null);
    if (staged?.extraction) {
      run = await synthesizeCreationIntelligence(filePath, actorId, run, dependencies, staged.extraction, contextPartial && usableContext, deadline, controller.signal);
    }
    const intelligencePack = run.draftContextId
      ? await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null)
      : null;
    const intelligenceSummary = run.draftContextId
      ? await dependencies.readIntelligenceSummary({ actorId, draftContextId: run.draftContextId }).catch(() => null)
      : null;
    const architectIntelligence: WorkspaceArchitectIntelligenceInput | undefined = intelligencePack ? {
      pack: intelligencePack,
      operatorIntent: {
        brief: run.input.brief,
        constraints: run.input.operatorConstraints,
        mode: run.input.mode,
        materialization: run.input.materialization as WorkspaceMaterialization
      },
      contextStatus: {
        intelligenceStatus: intelligenceSummary?.synthesisStatus ?? (run.snapshot.intelligence.status === "blocked" ? "blocked" : run.snapshot.intelligence.status === "fallback" ? "fallback" : "model"),
        packState: intelligencePack.state,
        partialContext: contextPartial && usableContext,
        warnings: context?.warnings.slice(0, 8) ?? []
      }
    } : undefined;
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
      ...(staged ? { knowledge: staged.knowledge } : {}),
      ...(architectIntelligence ? { projectIntelligence: architectIntelligence } : {})
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

async function synthesizeCreationIntelligence(
  filePath: string,
  actorId: string,
  run: WorkspaceCreationRun,
  dependencies: ResolvedDependencies,
  extraction: import("@/lib/agentos/application/project-intelligence-extraction-service").ProjectIntelligenceExtraction,
  partialContext: boolean,
  deadline: number,
  signal: AbortSignal
) {
  const input = { brief: run.input.brief, extraction };
  const inputFingerprint = createProjectIntelligenceSynthesisInputFingerprint(input);
  const fallbackResult = (failureCode: string, attempts: number): ProjectIntelligenceSynthesisResult => {
    const pack = createFallbackProjectIntelligencePack({
      extraction,
      packId: `project-intelligence-${inputFingerprint.slice(0, 32)}`,
      inputFingerprint,
      now: dependencies.now().toISOString()
    });
    return {
      proposal: createFallbackProjectIntelligenceSynthesisProposal(inputFingerprint),
      pack,
      execution: {
        status: "fallback",
        attempts,
        modelExecutionOccurred: false,
        remoteRunId: null,
        remoteSessionKey: null,
        failureCode
      }
    };
  };
  const existing = run.draftContextId
    ? await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null)
    : null;
  if (existing?.provenance.generationId === inputFingerprint) {
    const summary = run.draftContextId
      ? await dependencies.readIntelligenceSummary({ actorId, draftContextId: run.draftContextId }).catch(() => null)
      : null;
    const executionStatus = summary?.synthesisStatus ?? (existing.unknowns.includes("intelligence-synthesis") ? "fallback" : "model");
    const reusedResult: ProjectIntelligenceSynthesisResult = {
      proposal: createFallbackProjectIntelligenceSynthesisProposal(inputFingerprint),
      pack: existing,
      execution: { status: executionStatus, attempts: run.snapshot.intelligence.attempts, modelExecutionOccurred: executionStatus === "model", remoteRunId: null, remoteSessionKey: null, failureCode: null }
    };
    const completed = await completeIntelligenceExecution(filePath, reusedResult);
    return updateIntelligenceSnapshot(filePath, completed, dependencies, reusedResult, partialContext, true);
  }
  if (run.intelligenceExecution.outcome === "in-flight" || run.intelligenceExecution.outcome === "ambiguous") {
    if (signal.aborted || run.snapshot.cancelRequested) throw new DOMException("Project Intelligence execution was cancelled.", "AbortError");
    const recovered = fallbackResult("intelligence-execution-ambiguous", Math.max(1, run.snapshot.intelligence.attempts));
    await dependencies.persistIntelligencePack({
      actorId,
      draftContextId: run.draftContextId!,
      inputFingerprint,
      pack: recovered.pack,
      synthesisStatus: "fallback"
    });
    const recoveredRun = await mutateWorkspaceCreationRun(filePath, (latest) => ({
      ...latest,
      intelligenceExecution: { ...latest.intelligenceExecution, outcome: "ambiguous" }
    }));
    return updateIntelligenceSnapshot(filePath, recoveredRun, dependencies, recovered, partialContext, false);
  }
  const remaining = Math.max(1_000, deadline - Date.now() - dependencies.budget.architectReserveMs);
  const attemptTimeout = Math.min(dependencies.budget.maxIntelligenceAttemptMs, remaining);
  let current = await appendAndPersist(
    filePath,
    run,
    dependencies,
    { ...run.snapshot, stage: "intelligence-synthesis", intelligence: { ...run.snapshot.intelligence, status: "pending", attempts: 1, partialContext } },
    "intelligence-updated",
    null,
    null,
    dependencies.now().toISOString(),
    "intelligence-synthesis-started",
    { intelligenceStatus: "pending", packState: null, packId: null }
  );
  current = await mutateWorkspaceCreationRun(filePath, (latest) => ({
    ...latest,
    intelligenceExecution: {
      ...latest.intelligenceExecution,
      idempotencyKey: `project-intelligence:${latest.runId}:${latest.attempt}`,
      outcome: "in-flight"
    }
  }));
  let result: ProjectIntelligenceSynthesisResult;
  try {
    result = await dependencies.synthesizeIntelligence({
      brief: run.input.brief,
      extraction,
      packId: `project-intelligence-${inputFingerprint.slice(0, 32)}`
    }, {
      runId: run.runId,
      attempt: 1,
      maxAttempts: dependencies.budget.maxIntelligenceAttempts,
      signal,
      timeoutMs: attemptTimeout
    });
  } catch (error) {
    if (signal.aborted || run.snapshot.cancelRequested) throw error;
    if (!(error instanceof ProjectIntelligenceRemoteExecutionError)) throw error;
    result = fallbackResult("intelligence-execution-ambiguous", 1);
    await dependencies.persistIntelligencePack({
      actorId,
      draftContextId: run.draftContextId!,
      inputFingerprint,
      pack: result.pack,
      synthesisStatus: "fallback"
    });
    current = await mutateWorkspaceCreationRun(filePath, (latest) => ({
      ...latest,
      intelligenceExecution: {
        ...latest.intelligenceExecution,
        outcome: "ambiguous"
      }
    }));
    return updateIntelligenceSnapshot(filePath, current, dependencies, result, partialContext, false);
  }
  try {
    await dependencies.persistIntelligencePack({
      actorId,
      draftContextId: run.draftContextId!,
      inputFingerprint,
      pack: result.pack,
      synthesisStatus: result.execution.status
    });
  } catch (error) {
    // The remote outcome is known, but the normalized result was not durable;
    // record completion before the outer run is failed so recovery cannot
    // replay a completed model turn.
    await completeIntelligenceExecution(filePath, result);
    throw error;
  }
  current = await completeIntelligenceExecution(filePath, result);
  return updateIntelligenceSnapshot(filePath, current, dependencies, result, partialContext, false);
}

async function completeIntelligenceExecution(filePath: string, result: ProjectIntelligenceSynthesisResult) {
  return mutateWorkspaceCreationRun(filePath, (latest) => ({
    ...latest,
    intelligenceExecution: {
      ...latest.intelligenceExecution,
      runId: result.execution.remoteRunId,
      sessionKey: result.execution.remoteSessionKey,
      outcome: "completed"
    }
  }));
}

async function updateIntelligenceSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, result: ProjectIntelligenceSynthesisResult, partialContext: boolean, reused: boolean) {
  const fallback = result.execution.status === "fallback";
  const intelligenceFailure = fallback && result.execution.failureCode
    ? result.execution.failureCode === "intelligence-execution-ambiguous"
      ? failure("unknown", result.execution.failureCode, "terminal", "Project Intelligence execution was ambiguous; a deterministic fallback was used without replaying the remote turn.")
      : failure("model", result.execution.failureCode, result.execution.failureCode === "intelligence-structured-output-rejected" ? "repairable" : "transient", "AI project intelligence was unavailable; canonical extracted evidence was preserved.")
    : null;
  const snapshot: WorkspaceCreationSnapshot = {
    ...run.snapshot,
    intelligence: {
      status: fallback ? "fallback" : "model",
      attempts: reused ? run.snapshot.intelligence.attempts : Math.max(result.execution.attempts, run.snapshot.intelligence.attempts),
      elapsedMs: Math.max(run.snapshot.intelligence.elapsedMs, elapsedMs(run.createdAt, dependencies.now().toISOString())),
      failure: intelligenceFailure,
      modelExecutionOccurred: result.execution.modelExecutionOccurred,
      retryAvailable: Boolean(intelligenceFailure),
      packId: result.pack.id,
      packState: result.pack.state,
      partialContext
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "intelligence-updated", fallback ? result.execution.failureCode : null, intelligenceFailure ? { kind: intelligenceFailure.kind, code: intelligenceFailure.code, retryability: intelligenceFailure.retryability } : null, dependencies.now().toISOString(), fallback ? "intelligence-fallback" : "intelligence-completed", { intelligenceStatus: fallback ? "fallback" : "model", packState: result.pack.state, packId: result.pack.id });
}

async function updateExtractionSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, summary: ProjectIntelligenceExtractionSummary) {
  const snapshot: WorkspaceCreationSnapshot = {
    ...run.snapshot,
    extraction: {
      status: summary.status,
      extractionId: summary.extractionId,
      generationId: summary.generationId,
      evidenceCount: summary.evidenceCount,
      factCount: summary.factCount,
      resourceCount: summary.resourceCount,
      verifiedFactCount: summary.verifiedFactCount,
      verifiedResourceCount: summary.verifiedResourceCount,
      conflictCount: summary.conflictCount,
      warningCount: summary.warningCount,
      unknownCount: summary.unknownCount
    }
  };
  const activityCode: WorkspaceCreationActivityCode = summary.status === "partial" ? "extraction-partial" : "extraction-completed";
  const activityData: WorkspaceCreationActivityData = {
    evidenceCount: summary.evidenceCount,
    factCount: summary.factCount,
    resourceCount: summary.resourceCount,
    verifiedFactCount: summary.verifiedFactCount,
    verifiedResourceCount: summary.verifiedResourceCount,
    conflictCount: summary.conflictCount,
    extractionStatus: summary.status
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "context-updated", summary.status === "partial" ? "extraction-partial" : null, null, dependencies.now().toISOString(), activityCode, activityData);
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
    const intelligenceBlocked = current.intelligenceExecution.outcome === "in-flight" || current.intelligenceExecution.outcome === "ambiguous";
    const intelligenceFailure = intelligenceBlocked
      ? failure("unknown", "intelligence-execution-ambiguous", "terminal", "Project Intelligence execution could not be safely recovered.")
      : current.snapshot.intelligence.failure;
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      state,
      stage: null,
      intelligence: intelligenceBlocked
        ? { ...current.snapshot.intelligence, status: "blocked", failure: intelligenceFailure, retryAvailable: false }
        : current.snapshot.intelligence,
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

async function appendAndPersist(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, snapshot: WorkspaceCreationSnapshot, kind: "state-changed" | "context-updated" | "intelligence-updated" | "architect-updated" | "warning", warningCode: string | null, failureValue: WorkspaceCreationEventFailure | null, now: string, activityCode: WorkspaceCreationActivityCode | null = null, activityData: WorkspaceCreationActivityData | null = null, sourceId: string | null = null) {
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
      intelligence: { ...current.snapshot.intelligence, ...snapshot.intelligence },
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
  if (run.intelligenceExecution.outcome === "in-flight" || run.intelligenceExecution.outcome === "ambiguous") {
    return failRun(filePath, run, dependencies, failure("unknown", "intelligence-execution-ambiguous", "terminal", "Project Intelligence execution could not be safely recovered."));
  }
  if (run.remoteExecution.outcome === "in-flight" || run.remoteExecution.outcome === "ambiguous") {
    return failRun(filePath, run, dependencies, failure("unknown", "remote-execution-ambiguous", "terminal", "Architect execution could not be safely recovered."));
  }
  return failRun(filePath, run, dependencies, failure("unknown", "creation-run-failed", "terminal", redactErrorMessage(error, "Workspace creation failed.")));
}

function resolveDependencies(input: WorkspaceCreationRunDependencies): ResolvedDependencies {
  return {
    rootPath: resolveWorkspaceCreationRunRoot(input.rootPath),
    now: input.now ?? (() => new Date()),
    persistIntake: input.persistIntake ?? persistWorkspaceCreationIntake,
    stageContext: input.stageContext ?? stageWorkspaceCreationKnowledge,
    readContext: input.readContext ?? readWorkspaceCreationContext,
    synthesizeIntelligence: input.synthesizeIntelligence ?? synthesizeProjectIntelligence,
    readIntelligencePack: input.readIntelligencePack ?? readWorkspaceCreationIntelligencePack,
    readIntelligenceSummary: input.readIntelligenceSummary ?? readWorkspaceCreationIntelligenceSummary,
    persistIntelligencePack: input.persistIntelligencePack ?? persistWorkspaceCreationIntelligencePack,
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
    "architect-started", "architect-runtime-ready", "architect-attempt-started", "architect-model-started", "architect-model-completed", "architect-structured-output-rejected", "architect-attempt-failed", "architect-retry-scheduled", "architect-attempt-completed", "architect-fallback", "architect-completed",
    "extraction-started", "extraction-completed", "extraction-partial", "evidence-created", "fact-extracted", "resource-extracted", "resource-verified", "conflict-detected"
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
