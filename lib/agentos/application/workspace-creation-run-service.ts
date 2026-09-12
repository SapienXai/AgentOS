import "server-only";

import { createHash } from "node:crypto";

import {
  persistWorkspaceCreationIntake,
  cloneWorkspaceCreationContext,
  persistWorkspaceCreationIntelligencePack,
  readWorkspaceCreationCompositionPlan,
  readWorkspaceCreationIntelligencePack,
  readWorkspaceCreationIntelligenceSummary,
  readWorkspaceCreationContext,
  readWorkspaceCreationContextMetadata,
  readWorkspaceCreationContextDocuments,
  persistWorkspaceCreationCompositionPlan,
  stageWorkspaceCreationKnowledge,
  type WorkspaceCreationContextStageResult,
  type WorkspaceCreationUpload
} from "@/lib/agentos/application/workspace-creation-context-service";
import { composeWorkspaceComposition, createDeterministicWorkspaceComposition, createWorkspaceCompositionBlueprintFingerprint, inspectWorkspaceCompositionFiles, type WorkspaceCompositionResult } from "@/lib/agentos/application/workspace-composer";
import { createWorkspaceCompositionInputFingerprint, summarizeWorkspaceCompositionPlan, validateWorkspaceCompositionPlan, type WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import { generateWorkspaceBlueprint, reviseWorkspaceBlueprint, validateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
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
import { readWorkspaceIntelligenceBinding } from "@/lib/agentos/application/workspace-intelligence-binding-store";
import { findRunById, resolveProvisioningRoot } from "@/lib/agentos/application/workspace-provisioning-store";
import { normalizeWorkspaceMaterialization, type WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import type { WorkspaceArchitectIntelligenceInput, WorkspaceArchitectLifecycleEvent, WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import { DEFAULT_KNOWLEDGE_INGESTION_LIMITS, type KnowledgeIngestionProgress } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { normalizeWorkspaceKnowledgeSources, workspaceKnowledgeSourceIdentity, type WorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";
import type { ProjectIntelligenceExtractionSummary } from "@/lib/agentos/application/project-intelligence-extraction-service";
import type { ProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import {
  createFallbackProjectIntelligenceSynthesisProposal,
  createFallbackProjectIntelligencePack,
  createProjectIntelligenceSynthesisInputFingerprint,
  synthesizeProjectIntelligence,
  type ProjectIntelligenceSynthesisResult
} from "@/lib/agentos/application/project-intelligence-synthesis-service";
import { ProjectIntelligenceRemoteExecutionError } from "@/lib/openclaw/application/structured-agent-service";
import { summarizeWorkspaceDrift } from "@/lib/agentos/domains/workspace-freshness";
import type { WorkspaceCreationReviewReadiness } from "@/lib/agentos/domains/workspace-creation-review";
import {
  normalizeWorkspaceCreationProfile,
  normalizeWorkspaceCreationTrigger,
  resolveWorkspaceCreationPolicy,
  type WorkspaceCreationExecutionBudget,
  type WorkspaceCreationProfile,
  type WorkspaceCreationTrigger
} from "@/lib/agentos/domains/workspace-creation-policy";

export const DEFAULT_WORKSPACE_CREATION_BUDGET = resolveWorkspaceCreationPolicy("deep").budget;

export type WorkspaceCreationBudget = Partial<WorkspaceCreationExecutionBudget>;

export type WorkspaceCreationRunDependencies = {
  rootPath?: string;
  provisioningRootPath?: string;
  workspaceIntelligenceBindingRootPath?: string;
  now?: () => Date;
  budget?: WorkspaceCreationBudget;
  persistIntake?: typeof persistWorkspaceCreationIntake;
  cloneContext?: typeof cloneWorkspaceCreationContext;
  stageContext?: typeof stageWorkspaceCreationKnowledge;
  readContext?: typeof readWorkspaceCreationContext;
  readContextMetadata?: typeof readWorkspaceCreationContextMetadata;
  readContextDocuments?: typeof readWorkspaceCreationContextDocuments;
  synthesizeIntelligence?: typeof synthesizeProjectIntelligence;
  readIntelligencePack?: typeof readWorkspaceCreationIntelligencePack;
  readIntelligenceSummary?: typeof readWorkspaceCreationIntelligenceSummary;
  persistIntelligencePack?: typeof persistWorkspaceCreationIntelligencePack;
  generateArchitect?: typeof generateWorkspaceBlueprint;
  reviseArchitect?: typeof reviseWorkspaceBlueprint;
  composeWorkspace?: typeof composeWorkspaceComposition;
  persistCompositionPlan?: typeof persistWorkspaceCreationCompositionPlan;
  readCompositionPlan?: typeof readWorkspaceCreationCompositionPlan;
  inspectCompositionFiles?: typeof inspectWorkspaceCompositionFiles;
  readWorkspaceIntelligenceBinding?: typeof readWorkspaceIntelligenceBinding;
  findProvisioningRunById?: typeof findRunById;
};

type ResolvedDependencies = Required<Pick<WorkspaceCreationRunDependencies, "rootPath" | "provisioningRootPath" | "now" | "persistIntake" | "cloneContext" | "stageContext" | "readContext" | "readContextMetadata" | "readContextDocuments" | "synthesizeIntelligence" | "readIntelligencePack" | "readIntelligenceSummary" | "persistIntelligencePack" | "generateArchitect" | "reviseArchitect" | "composeWorkspace" | "persistCompositionPlan" | "readCompositionPlan" | "inspectCompositionFiles" | "readWorkspaceIntelligenceBinding" | "findProvisioningRunById">> & {
  budget: typeof DEFAULT_WORKSPACE_CREATION_BUDGET;
  budgetOverrides: WorkspaceCreationBudget;
  nativeComposer: boolean;
  workspaceIntelligenceBindingRootPath: string | undefined;
};

const inFlight = new Map<string, Promise<WorkspaceCreationRun>>();
const revisionInFlight = new Map<string, Promise<WorkspaceCreationRun>>();
const activeControllers = new Map<string, AbortController>();
const executionStarting = new Map<string, Promise<void>>();

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
  lineage?: WorkspaceCreationRun["lineage"];
  profile?: WorkspaceCreationProfile;
  continueLearningAfterCreation?: boolean;
  trigger?: WorkspaceCreationTrigger;
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
  const profile = normalizeWorkspaceCreationProfile(input.profile);
  const trigger = normalizeWorkspaceCreationTrigger(input.trigger);
  const continueLearningAfterCreation = input.continueLearningAfterCreation !== false;
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
    uploads: input.uploads ?? [],
    profile,
    continueLearningAfterCreation,
    trigger
  });
  const storageKey = buildWorkspaceCreationStorageKey(actorId, idempotencyKey);
  const existing = await readWorkspaceCreationRun(resolved.rootPath, storageKey);
  if (existing) {
    const existingFingerprint = existing.input.profile === undefined
      ? legacyCreationIntentFingerprint(existing, input.draftContextId ?? null)
      : existing.inputFingerprint;
    if (existingFingerprint && existingFingerprint !== inputFingerprint) throw new Error("This creation idempotency key is already in use with different creation intent.");
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
    sources: staged.sources,
    profile,
    continueLearningAfterCreation,
    trigger
  };
  const created = await createWorkspaceCreationRunAtomically(resolved.rootPath, storageKey, {
    actorHash: workspaceCreationActorHash(actorId),
    idempotencyKeyHash: sha256(storageKey),
    attempt: 1,
    input: runInput,
    inputFingerprint,
    draftContextId: staged.draftContextId,
    snapshot: createInitialWorkspaceCreationSnapshot(staged.sources.length),
    result: null,
    lineage: input.lineage ?? { rootRunId: "pending", parentRunId: null, relation: "initial", trigger }
  });
  if (created.created) {
    await mutateWorkspaceCreationRun(created.filePath, (current) => current.lineage?.rootRunId === "pending"
      ? { ...current, lineage: { ...current.lineage, rootRunId: current.runId } }
      : current);
  }
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
  const starting = executionStarting.get(locator.filePath);
  if (starting) {
    await starting;
    return publicRun(await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run);
  }
  const executionStart = Promise.resolve().then(() => {
    if (inFlight.has(locator.filePath)) return;
    const execution = executeCreationRun(locator.filePath, input.actorId, resolved)
      .catch((error) => recoverUnexpectedCreationFailure(locator.filePath, input.actorId, error, resolved))
      .finally(() => {
        if (inFlight.get(locator.filePath) === execution) inFlight.delete(locator.filePath);
        activeControllers.delete(locator.filePath);
      });
    inFlight.set(locator.filePath, execution);
  });
  executionStarting.set(locator.filePath, executionStart);
  try {
    await executionStart;
  } finally {
    if (executionStarting.get(locator.filePath) === executionStart) executionStarting.delete(locator.filePath);
  }
  return publicRun(await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run);
}

/**
 * Wait for the in-process executor to finish releasing its lease after a run
 * reaches a durable terminal snapshot. This is intentionally separate from
 * polling: active callers remain non-blocking while lifecycle owners can
 * safely clean up their storage after execution is idle.
 */
export async function waitForWorkspaceCreationRunIdle(
  input: { actorId: string; runId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  await ensureCreationRunExecution(input, resolved);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  await inFlight.get(locator.filePath)?.catch(() => undefined);
  const latest = await readWorkspaceCreationRunFile(locator.filePath);
  return latest ? publicRun(latest) : null;
}

export async function getWorkspaceCreationRun(
  input: { actorId: string; runId: string; afterSequence?: number },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  await ensureCreationRunExecution({ actorId: input.actorId, runId: input.runId }, resolved);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  if (isWorkspaceCreationTerminal(locator.run.snapshot.state)) {
    await inFlight.get(locator.filePath)?.catch(() => undefined);
  }
  let latest = await readWorkspaceCreationRunFile(locator.filePath);
  if (latest?.snapshot.state === "review-ready") {
    const certified = await getWorkspaceCreationReviewReadiness({ actorId: input.actorId, runId: input.runId, repair: false, persist: false }, resolved);
    latest = certified?.run ?? latest;
  }
  const after = Number.isSafeInteger(input.afterSequence) ? input.afterSequence! : 0;
  return publicRun({
    ...(latest ?? locator.run),
    events: (latest ?? locator.run).events.filter((event) => event.sequence > after)
  });
}

export async function getWorkspaceCreationReviewReadiness(
  input: { actorId: string; runId: string; acceptDraft?: boolean; repair?: boolean; forceRepair?: boolean; persist?: boolean },
  dependencies: WorkspaceCreationRunDependencies = {}
): Promise<{ run: WorkspaceCreationRun; readiness: WorkspaceCreationReviewReadiness } | null> {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  let run = await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run;
  let readiness = await evaluateWorkspaceCreationReviewReadiness(run, input.actorId, input.acceptDraft === true, resolved);
  const repairPreviouslyFailed = !input.forceRepair && run.snapshot.reviewReadiness?.reasonCode === "composition-rebuild-failed";
  const needsRepair = ["composition-missing", "composition-invalid", "composition-mismatch"].includes(readiness.reasonCode);
  if (input.repair !== false && needsRepair) {
    if (!repairPreviouslyFailed) {
      try {
        run = await rebuildWorkspaceCreationComposition(locator.filePath, input.actorId, run, resolved);
      } catch (error) {
        const checkedAt = resolved.now().toISOString();
        readiness = {
          status: "plan-rebuild-required",
          provisionable: false,
          reasonCode: "composition-rebuild-failed",
          requiredAction: "rebuild-plan",
          message: redactSecretText(error instanceof Error ? error.message : "The workspace plan could not be rebuilt safely.").slice(0, 300),
          checkedAt,
          blueprintFingerprint: isWorkspaceArchitectResult(run.result) ? createWorkspaceCompositionBlueprintFingerprint(run.result.blueprint) : null,
          planId: null,
          planFingerprint: null
        };
      }
      if (readiness.reasonCode !== "composition-rebuild-failed") readiness = await evaluateWorkspaceCreationReviewReadiness(run, input.actorId, input.acceptDraft === true, resolved);
    }
  }
  const persisted = input.persist === false
    ? run
    : await mutateWorkspaceCreationRun(locator.filePath, (current) => ({
      ...current,
      snapshot: { ...current.snapshot, reviewReadiness: readiness }
    }));
  return { run: publicRun(persisted), readiness };
}

/**
 * Resolve the only provisioning intent that may be used for a creation run.
 * The browser may submit stale blueprint data, but it cannot choose a second
 * server-side identity for the certified run.
 */
export async function getWorkspaceCreationProvisioningIntent(
  input: { actorId: string; runId: string; acceptDraft?: boolean },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const certified = await getWorkspaceCreationReviewReadiness({
    actorId: input.actorId,
    runId: input.runId,
    acceptDraft: input.acceptDraft,
    repair: false,
    persist: false
  }, dependencies);
  if (!certified) return null;
  const { run, readiness } = certified;
  if (!readiness.provisionable || !isWorkspaceArchitectResult(run.result)) return { run, readiness, idempotencyKey: null };
  return {
    run,
    readiness,
    idempotencyKey: `workspace-creation-provision:${run.runId}:${readiness.blueprintFingerprint ?? "none"}:${readiness.planFingerprint ?? "none"}`
  };
}

export function isWorkspaceCreationMinimumContextReady(run: WorkspaceCreationRun) {
  const contextReady = run.snapshot.context.status === "ready"
    || run.snapshot.context.status === "partial" && run.snapshot.context.usableEvidence;
  const briefOnlyReady = run.input.sources.length === 0 && run.snapshot.extraction.status === "not-requested";
  return contextReady || briefOnlyReady;
}

/** Request a durable conversion to the quick remainder at the next safe boundary. */
export async function continueWorkspaceCreationNow(
  input: { actorId: string; runId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const next = await mutateWorkspaceCreationRun(locator.filePath, (current) => {
    if (isWorkspaceCreationTerminal(current.snapshot.state)) return current;
    if (!isWorkspaceCreationMinimumContextReady(current)) throw new Error("Minimum project context is not ready yet.");
    if (current.expediteRequestedAt) return current;
    const now = resolved.now().toISOString();
    const snapshot = {
      ...current.snapshot,
      timings: current.snapshot.timings
    };
    return {
      ...appendWorkspaceCreationEvent(current, {
        schemaVersion: 1,
        createdAt: now,
        kind: "state-changed",
        stage: current.snapshot.stage,
        snapshot,
        attempt: current.attempt,
        maxAttempts: resolveWorkspaceCreationPolicy("quick").budget.maxArchitectAttempts,
        elapsedMs: elapsedMs(current.createdAt, now),
        sourceId: null,
        warningCode: "continue-now-requested",
        failure: null,
        activityCode: "continue-now-requested",
        activityData: { runtimeMode: "deterministic-safe-fallback" }
      }),
      expediteRequestedAt: now
    };
  });
  await ensureCreationRunExecution({ actorId: input.actorId, runId: next.runId }, resolved);
  return publicRun(next);
}

async function evaluateWorkspaceCreationReviewReadiness(run: WorkspaceCreationRun, actorId: string, acceptDraft: boolean, dependencies: ResolvedDependencies): Promise<WorkspaceCreationReviewReadiness> {
  const checkedAt = dependencies.now().toISOString();
  const result = isWorkspaceArchitectResult(run.result) ? run.result : null;
  const blueprintFingerprint = result ? createWorkspaceCompositionBlueprintFingerprint(result.blueprint) : null;
  const base = {
    checkedAt,
    blueprintFingerprint,
    planId: null,
    planFingerprint: null
  } satisfies Pick<WorkspaceCreationReviewReadiness, "checkedAt" | "blueprintFingerprint" | "planId" | "planFingerprint">;
  if (run.abandonedAt) return { ...base, status: "blocked", provisionable: false, reasonCode: "abandoned", requiredAction: "none", message: "This workspace draft was abandoned." };
  if (run.snapshot.state !== "review-ready" || !result) return { ...base, status: "design-incomplete", provisionable: false, reasonCode: "blueprint-invalid", requiredAction: "retry-design", message: "The workspace draft is not ready for review yet." };
  const blueprintValidation = validateWorkspaceBlueprint(result.blueprint);
  if (!blueprintValidation.valid) return { ...base, status: "design-incomplete", provisionable: false, reasonCode: "blueprint-invalid", requiredAction: "retry-design", message: "The workspace blueprint needs to be regenerated before it can be created." };
  if (result.blueprint.status === "blocked") return { ...base, status: "blocked", provisionable: false, reasonCode: "blueprint-blocked", requiredAction: "resolve-conflict", message: "The workspace blueprint contains a blocking issue." };
  const quickDraftIsSafe = run.input.profile === "quick";
  if ((result.blueprint.status === "draft" || result.reasoning.status === "fallback") && !acceptDraft && !quickDraftIsSafe) {
    return { ...base, status: "design-incomplete", provisionable: false, reasonCode: "draft-acceptance-required", requiredAction: "accept-draft", message: "Use the basic draft explicitly before creating this workspace." };
  }
  if (result.freshness.status === "stale") return { ...base, status: "refresh-required", provisionable: false, reasonCode: "context-stale", requiredAction: "refresh-context", message: "Project context changed after this design was produced." };
  if (result.blueprint.knowledge.sourceIds.length > 0 && result.freshness.status === "unknown") return { ...base, status: "refresh-required", provisionable: false, reasonCode: "context-unknown", requiredAction: "refresh-context", message: "The current project context could not be verified." };

  if (!run.draftContextId) return { ...base, status: "plan-rebuild-required", provisionable: false, reasonCode: "composition-missing", requiredAction: "rebuild-plan", message: "The workspace plan is not available yet." };
  const plan = await dependencies.readCompositionPlan({ actorId, draftContextId: run.draftContextId }).catch(() => null);
  const pack = await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null);
  const planBase = { ...base, planId: plan?.planId ?? null, planFingerprint: plan?.inputFingerprint ?? null };
  if (!plan) return { ...planBase, status: "plan-rebuild-required", provisionable: false, reasonCode: "composition-missing", requiredAction: "rebuild-plan", message: "The workspace plan needs to be rebuilt." };
  if (!validateWorkspaceCompositionPlan(plan)) return { ...planBase, status: "plan-rebuild-required", provisionable: false, reasonCode: "composition-invalid", requiredAction: "rebuild-plan", message: "The workspace plan is invalid and needs to be rebuilt." };
  const existingFiles = result.blueprint.materialization.mode === "existing" && "existingPath" in result.blueprint.materialization
    ? await dependencies.inspectCompositionFiles(result.blueprint.materialization.existingPath)
    : [];
  const expectedInputFingerprint = createWorkspaceCompositionInputFingerprint({
    policyVersion: plan.policyVersion,
    packId: pack?.id ?? null,
    blueprint: result.blueprint,
    operatorIntent: { brief: result.blueprint.brief, constraints: result.blueprint.operatorConstraints },
    materializationMode: result.blueprint.materialization.mode,
    existingFiles: existingFiles.map((file) => ({ path: file.path, hash: file.currentHash ?? sha256(file.content) }))
  });
  const packGenerationId = pack?.provenance.generationId ?? pack?.generation?.id ?? null;
  const planMatches = plan.workspaceBlueprintId === result.blueprint.id
    && plan.workspaceBlueprintFingerprint === blueprintFingerprint
    && plan.materializationMode === result.blueprint.materialization.mode
    && plan.projectIntelligencePackId === (pack?.id ?? null)
    && plan.projectIntelligenceGenerationId === packGenerationId
    && plan.inputFingerprint === expectedInputFingerprint;
  if (plan.status === "blocked" || plan.conflicts.length > 0) return { ...planBase, status: "blocked", provisionable: false, reasonCode: "composition-blocked", requiredAction: "resolve-conflict", message: "The workspace plan contains a blocking conflict." };
  if (!planMatches) return { ...planBase, status: "plan-rebuild-required", provisionable: false, reasonCode: "composition-mismatch", requiredAction: "rebuild-plan", message: "The workspace plan no longer matches this reviewed blueprint." };
  return { ...planBase, status: "ready", provisionable: true, reasonCode: "ready", requiredAction: "none", message: "The workspace draft is ready to create." };
}

async function rebuildWorkspaceCreationComposition(filePath: string, actorId: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies) {
  if (!isWorkspaceArchitectResult(run.result) || !run.draftContextId) throw new Error("The current workspace draft cannot be rebuilt safely.");
  const result = run.result;
  const intelligencePack = await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null);
  const existingFiles = result.blueprint.materialization.mode === "existing" && "existingPath" in result.blueprint.materialization
    ? await dependencies.inspectCompositionFiles(result.blueprint.materialization.existingPath)
    : [];
  const rebuilt = createDeterministicWorkspaceComposition({
    projectIntelligence: intelligencePack,
    blueprint: result.blueprint,
    operatorIntent: { brief: result.blueprint.brief, constraints: result.blueprint.operatorConstraints },
    existingFiles,
    materializationMode: result.blueprint.materialization.mode
  }, { runId: `${run.runId}:review-repair`, warning: "The canonical workspace plan was rebuilt from the current reviewed draft." });
  await dependencies.persistCompositionPlan({ actorId, draftContextId: run.draftContextId, plan: rebuilt.plan });
  return updateCompositionSnapshot(filePath, run, dependencies, rebuilt);
}

/**
 * Revise a review-ready Create Workspace run from its durable server state.
 * The request intentionally contains no blueprint: the run result, staged
 * context, and Project Intelligence pack are the authoritative inputs.
 */
export async function reviseWorkspaceCreationRun(
  input: {
    actorId: string;
    runId: string;
    instruction?: string;
    operatorEdits?: Parameters<typeof reviseWorkspaceBlueprint>[1]["operatorEdits"];
    operatorConstraints?: string[];
    signal?: AbortSignal;
  },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const existing = revisionInFlight.get(locator.filePath);
  if (existing) return publicRun(await existing);
  const current = await readWorkspaceCreationRunFile(locator.filePath) ?? locator.run;
  if (current.snapshot.state !== "review-ready" || !isWorkspaceArchitectResult(current.result)) {
    throw new Error("Only a review-ready workspace creation run can be revised.");
  }
  const lease = await acquireProvisioningLease({ runFilePath: locator.filePath, runId: current.runId, attempt: current.attempt });
  if (!lease) throw new Error("This workspace draft is being updated in another tab. Refresh and try again.");
  const execution = (async () => {
    try {
      await lease.assertOwned();
      const latest = await readWorkspaceCreationRunFile(locator.filePath) ?? current;
      if (latest.snapshot.state !== "review-ready" || !isWorkspaceArchitectResult(latest.result)) {
        throw new Error("This workspace draft is no longer ready for revision.");
      }
      if (latest.remoteExecution.outcome === "in-flight" || latest.remoteExecution.outcome === "ambiguous") {
        throw new Error("The previous Architect revision outcome is ambiguous; refresh the saved workspace draft before trying again.");
      }
      const oldResult = latest.result;
      const context = latest.draftContextId
        ? await resolved.readContextMetadata({ actorId: input.actorId, draftContextId: latest.draftContextId })
        : null;
      const intelligencePack = latest.draftContextId
        ? await resolved.readIntelligencePack({ actorId: input.actorId, draftContextId: latest.draftContextId }).catch(() => null)
        : null;
      const revisionNumber = (latest.snapshot.revision?.number ?? 0) + 1;
      const architectRunId = `${latest.runId}:revision:${revisionNumber}`;
      const projectIntelligence = intelligencePack ? {
        pack: intelligencePack,
        operatorIntent: {
          brief: latest.input.brief,
          constraints: latest.input.operatorConstraints,
          mode: latest.input.mode,
          materialization: latest.input.materialization as WorkspaceMaterialization
        },
        contextStatus: {
          intelligenceStatus: latest.snapshot.intelligence.status === "blocked" ? "blocked" as const : latest.snapshot.intelligence.status === "fallback" ? "fallback" as const : "model" as const,
          packState: intelligencePack.state,
          partialContext: latest.snapshot.context.status === "partial",
          warnings: context?.warnings.slice(0, 8) ?? []
        }
      } satisfies WorkspaceArchitectIntelligenceInput : undefined;
      await mutateWorkspaceCreationRun(locator.filePath, (stored) => ({
        ...stored,
        remoteExecution: {
          ...stored.remoteExecution,
          idempotencyKey: architectRunId,
          outcome: "in-flight"
        }
      }));
      let revised: WorkspaceArchitectResult;
      try {
        revised = await resolved.reviseArchitect(
          oldResult.blueprint,
          {
            ...(input.instruction?.trim() ? { revisionInstruction: input.instruction.trim() } : {}),
            ...(input.operatorEdits ? { operatorEdits: input.operatorEdits } : {}),
            ...(input.operatorConstraints ? { operatorConstraints: normalizeCreationConstraints(input.operatorConstraints) } : {}),
            ...(context ? { knowledge: context.knowledge } : {}),
            ...(projectIntelligence ? { projectIntelligence } : {}),
            materialization: normalizeWorkspaceMaterialization(oldResult.blueprint.materialization)
          },
          {
            runId: architectRunId,
            signal: input.signal,
            currentKnowledgeGenerationId: context?.generationId ?? null
          }
        );
      } catch (error) {
        await mutateWorkspaceCreationRun(locator.filePath, (stored) => ({
          ...stored,
          remoteExecution: { ...stored.remoteExecution, outcome: "ambiguous" }
        })).catch(() => undefined);
        throw error;
      }
      await mutateWorkspaceCreationRun(locator.filePath, (stored) => ({
        ...stored,
        remoteExecution: {
          ...stored.remoteExecution,
          runId: revised.reasoning.remoteRunId ?? null,
          sessionKey: revised.reasoning.remoteSessionKey ?? null,
          outcome: "completed"
        }
      }));
      if (!revised.validation.valid) throw new Error("The revised workspace draft failed normalized validation.");
      const oldBlueprintFingerprint = latest.snapshot.revision?.blueprintFingerprint
        ?? createWorkspaceCompositionBlueprintFingerprint(oldResult.blueprint);
      const newBlueprintFingerprint = createWorkspaceCompositionBlueprintFingerprint(revised.blueprint);
      await lease.assertOwned();
      let updated = await updateArchitectSnapshot(locator.filePath, latest, resolved, revised, 0, latest.snapshot.context.status === "partial");
      updated = await mutateWorkspaceCreationRun(locator.filePath, (stored) => ({
        ...stored,
        result: revised,
        snapshot: {
          ...stored.snapshot,
          revision: {
            number: revisionNumber,
            previousBlueprintFingerprint: oldBlueprintFingerprint,
            blueprintFingerprint: newBlueprintFingerprint,
            compositionPlanId: null
          },
          freshness: {
            status: revised.freshness.status,
            reason: revised.freshness.reason,
            checkedAt: resolved.now().toISOString(),
            knowledgeGenerationId: revised.freshness.currentGenerationId,
            blueprintFingerprint: newBlueprintFingerprint,
            compositionPlanFingerprint: null
          }
        }
      }));
      await completeWorkspaceComposition(
        locator.filePath,
        input.actorId,
        updated,
        resolved,
        revised,
        intelligencePack,
        new AbortController(),
        Date.now() + resolved.budget.overallAnalysisBudgetMs,
        `revision:${revisionNumber}`
      );
      const completed = await mutateWorkspaceCreationRun(locator.filePath, (stored) => ({
        ...stored,
        snapshot: {
          ...stored.snapshot,
          revision: {
            ...stored.snapshot.revision!,
            compositionPlanId: stored.snapshot.composition?.planId ?? null
          },
          freshness: stored.snapshot.freshness ? {
            ...stored.snapshot.freshness,
            compositionPlanFingerprint: stored.snapshot.composition?.inputFingerprint ?? null
          } : undefined
        }
      }));
      return completed;
    } finally {
      await lease.release().catch(() => undefined);
    }
  })();
  revisionInFlight.set(locator.filePath, execution);
  try {
    return publicRun(await execution);
  } finally {
    if (revisionInFlight.get(locator.filePath) === execution) revisionInFlight.delete(locator.filePath);
  }
}

export async function listActiveWorkspaceCreationRuns(actorId: string, dependencies: WorkspaceCreationRunDependencies = {}) {
  const resolved = resolveDependencies(dependencies);
  const locators = await listWorkspaceCreationRuns(resolved.rootPath, actorId, true);
  await Promise.all(locators.map((locator) => ensureCreationRunExecution({ actorId, runId: locator.run.runId }, resolved)));
  return (await listWorkspaceCreationRuns(resolved.rootPath, actorId, true)).map(({ run }) => publicRun(run));
}

/** Review-ready runs are resumable drafts; failed and cancelled runs are not. */
export async function listResumableWorkspaceCreationRuns(actorId: string, dependencies: WorkspaceCreationRunDependencies = {}) {
  const resolved = resolveDependencies(dependencies);
  const locators = await listWorkspaceCreationRuns(resolved.rootPath, actorId, false);
  const resumable = locators.filter(({ run }) => !run.abandonedAt && ["pending", "running", "review-ready"].includes(run.snapshot.state));
  await Promise.all(resumable
    .filter(({ run }) => run.snapshot.state !== "review-ready")
    .map(({ run }) => ensureCreationRunExecution({ actorId, runId: run.runId }, resolved)));
  return (await listWorkspaceCreationRuns(resolved.rootPath, actorId, false))
    .filter(({ run }) => !run.abandonedAt && ["pending", "running", "review-ready"].includes(run.snapshot.state))
    .map(({ run }) => publicRun(run));
}

/** Start a new immutable run using the prior durable intake as its parent. */
export async function refreshWorkspaceCreationRun(
  input: { actorId: string; runId: string; refreshIntent?: string; profileOverride?: WorkspaceCreationProfile; trigger?: WorkspaceCreationTrigger },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const parent = locator.run;
  if (parent.snapshot.state !== "review-ready" || !isWorkspaceArchitectResult(parent.result)) {
    throw new Error("Only a review-ready workspace creation run can be refreshed.");
  }
  const refreshFingerprint = sha256(stableSerialize({
    version: 1,
    parentRunId: parent.runId,
    parentInputFingerprint: parent.inputFingerprint ?? null,
    parentRevision: parent.snapshot.revision?.number ?? 0,
    parentBlueprintFingerprint: parent.snapshot.revision?.blueprintFingerprint ?? createWorkspaceCompositionBlueprintFingerprint(parent.result.blueprint),
    parentCompositionPlanId: parent.snapshot.composition?.planId ?? null,
    parentCompositionFingerprint: parent.snapshot.composition?.inputFingerprint ?? null,
    refreshIntent: redactSecretText(input.refreshIntent?.trim() ?? "").slice(0, 500)
  }));
  const refreshKey = `reanalysis:${parent.runId}:${refreshFingerprint}`;
  const profile = input.profileOverride ?? parent.input.profile ?? "deep";
  const trigger = input.trigger ?? "manual-refresh";
  const childContextId = parent.draftContextId
    ? deterministicDraftContextId(`workspace-reanalysis-context:v1:${refreshKey}`)
    : null;
  if (parent.draftContextId && childContextId) {
    await resolved.cloneContext({
      actorId: input.actorId,
      sourceDraftContextId: parent.draftContextId,
      targetDraftContextId: childContextId
    });
  }
  const rootRunId = parent.lineage?.rootRunId || parent.runId;
  const refreshedDependencies: WorkspaceCreationRunDependencies = {
    ...dependencies,
    stageContext: async (stageInput) => resolved.stageContext({ ...stageInput, forceRefresh: true })
  };
  return startWorkspaceCreationRun({
    actorId: input.actorId,
    idempotencyKey: refreshKey,
    brief: parent.input.brief,
    mode: parent.input.mode,
    operatorConstraints: parent.input.operatorConstraints,
    materialization: parent.input.materialization,
    sources: parent.input.sources,
    draftContextId: childContextId,
    profile,
    continueLearningAfterCreation: trigger === "post-create-enrichment" ? false : parent.input.continueLearningAfterCreation,
    trigger,
    lineage: { rootRunId, parentRunId: parent.runId, relation: "reanalysis", trigger }
  }, refreshedDependencies);
}

/** Start one durable child analysis after a Quick workspace is provisioned. */
export async function startWorkspacePostCreateEnrichment(
  input: { actorId: string; parentRunId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.parentRunId.trim());
  if (!locator) return null;
  const parent = locator.run;
  if (parent.snapshot.state !== "review-ready" || parent.input.profile !== "quick" || parent.input.continueLearningAfterCreation === false) return null;
  return refreshWorkspaceCreationRun({
    actorId: input.actorId,
    runId: parent.runId,
    refreshIntent: "post-create-enrichment:v1",
    profileOverride: "deep",
    trigger: "post-create-enrichment"
  }, dependencies);
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

/** Abandon a review draft without reusing active-run cancellation semantics. */
export async function abandonWorkspaceCreationRun(input: { actorId: string; runId: string }, dependencies: WorkspaceCreationRunDependencies = {}) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const next = await mutateWorkspaceCreationRun(locator.filePath, (current) => {
    if (current.abandonedAt) return current;
    if (current.snapshot.state !== "review-ready") throw new Error("Only a review-ready workspace draft can be abandoned.");
    if (current.snapshot.provisioningRunId || current.snapshot.provisioningHandoffReady) {
      throw new Error("This workspace draft has already been handed off for provisioning.");
    }
    return { ...current, abandonedAt: resolved.now().toISOString() };
  });
  return publicRun(next);
}

export async function attachWorkspaceProvisioningRun(
  input: { actorId: string; runId: string; provisioningRunId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const provisioningRunId = input.provisioningRunId.trim();
  if (!provisioningRunId) throw new Error("A provisioning run id is required.");
  return publicRun(await mutateWorkspaceCreationRun(locator.filePath, (current) => {
    if (current.snapshot.provisioningRunId && current.snapshot.provisioningRunId !== provisioningRunId) {
      throw new Error("This creation run is already linked to another provisioning run.");
    }
    if (current.snapshot.provisioningRunId === provisioningRunId && current.snapshot.provisioningHandoffReady) return current;
    const now = resolved.now().toISOString();
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      provisioningHandoffReady: true,
      provisioningRunId
    };
    return appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind: "handoff-ready",
      stage: current.snapshot.stage,
      snapshot,
      attempt: current.attempt,
      maxAttempts: resolved.budget.maxArchitectAttempts,
      elapsedMs: elapsedMs(current.createdAt, now),
      sourceId: null,
      warningCode: null,
      failure: null,
      activityCode: null,
      activityData: null
    });
  }));
}

export async function markWorkspaceCreationProvisioningReady(
  input: { actorId: string; runId: string; provisioningRunId: string },
  dependencies: WorkspaceCreationRunDependencies = {}
) {
  const resolved = resolveDependencies(dependencies);
  const locator = await findWorkspaceCreationRunById(resolved.rootPath, input.actorId, input.runId.trim());
  if (!locator) return null;
  const provisioningRunId = input.provisioningRunId.trim();
  if (!provisioningRunId) return publicRun(locator.run);
  const updated = await mutateWorkspaceCreationRun(locator.filePath, (current) => {
    if (current.snapshot.provisioningRunId && current.snapshot.provisioningRunId !== provisioningRunId) return current;
    const now = resolved.now().toISOString();
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      provisioningHandoffReady: true,
      provisioningRunId,
      timings: {
        ...(current.snapshot.timings ?? { firstUsefulSignalMs: null, minimumContextMs: null, reviewReadyMs: null, enrichmentDurationMs: null }),
        provisioningReadyMs: elapsedMs(current.createdAt, now)
      }
    };
    return appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind: "handoff-ready",
      stage: current.snapshot.stage,
      snapshot,
      attempt: current.attempt,
      maxAttempts: resolveWorkspaceCreationPolicy(current.input.profile ?? "deep").budget.maxArchitectAttempts,
      elapsedMs: elapsedMs(current.createdAt, now),
      sourceId: null,
      warningCode: null,
      failure: null,
      activityCode: null,
      activityData: null
    });
  });
  return publicRun(updated);
}

async function executeCreationRun(filePath: string, actorId: string, dependencies: ResolvedDependencies): Promise<WorkspaceCreationRun> {
  let run = await readWorkspaceCreationRunFile(filePath);
  if (!run) throw new Error("Workspace creation run is unavailable.");
  let budget = workspaceCreationBudgetForRun(run, dependencies);
  let policy = resolveWorkspaceCreationPolicy(run.input.profile ?? "deep");
  const lease = await acquireProvisioningLease({ runFilePath: filePath, runId: run.runId, attempt: run.attempt });
  if (!lease) return await readWorkspaceCreationRunFile(filePath) ?? run;
  const controller = new AbortController();
  activeControllers.set(filePath, controller);
  let deadline = Date.now() + budget.overallAnalysisBudgetMs;
  const timeout = setTimeout(() => controller.abort(), budget.overallAnalysisBudgetMs);
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
      const durableArchitectResult = run.result as WorkspaceArchitectResult;
      const intelligencePack = run.draftContextId
        ? await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null)
        : null;
      const completed = await completeWorkspaceComposition(filePath, actorId, run, dependencies, durableArchitectResult, intelligencePack, controller, deadline);
      return recordLineageDrift(filePath, actorId, completed, dependencies);
    }
    run = await updateSnapshot(filePath, run, dependencies, { state: "running", stage: "context-staging" }, "state-changed");
    const cancellationCheck = await readWorkspaceCreationRunFile(filePath);
    if (cancellationCheck?.snapshot.cancelRequested) {
      return await failRun(filePath, cancellationCheck, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    }
    const contextBudget = Math.max(1, Math.min(
      policy.contextLimits.totalRunTimeoutMs ?? DEFAULT_KNOWLEDGE_INGESTION_LIMITS.totalRunTimeoutMs,
      budget.overallAnalysisBudgetMs - budget.architectReserveMs - budget.intelligenceReserveMs - budget.composerReserveMs
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
        limits: policy.contextLimits,
        stopWhenSufficient: policy.stopWhenSufficient,
        signal: contextController.signal,
        onProgress: async (progress) => { await recordIngestionProgress(filePath, stagedRun, dependencies, progress); }
      });
    } finally {
      contextController.dispose();
    }
    const usableContext = context.runStatus === "ready" || context.runStatus === "reused" || (context.runStatus === "partial" && hasUsableContext(context));
    const contextPartial = context.runStatus === "partial" || context.runStatus === "cancelled";
    run = await updateContextSnapshot(filePath, run, dependencies, context, contextPartial && usableContext, !usableContext && (contextPartial || context.runStatus === "error"));
    run = await readWorkspaceCreationRunFile(filePath) ?? run;
    if (run.expediteRequestedAt) {
      policy = resolveWorkspaceCreationPolicy("quick");
      budget = workspaceCreationBudgetForRun({ ...run, input: { ...run.input, profile: "quick" } }, dependencies);
      deadline = Math.min(deadline, Date.now() + budget.overallAnalysisBudgetMs);
    }
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
    const staged = await dependencies.readContextMetadata({ actorId, draftContextId: run.draftContextId! }).catch(() => null);
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
    const remaining = Math.max(1, deadline - Date.now() - budget.composerReserveMs);
    const attempts = Math.max(1, Math.min(budget.maxArchitectAttempts, Math.floor(remaining / 5_000)));
    const attemptTimeout = Math.max(5_000, Math.min(budget.maxArchitectAttemptMs, Math.floor(remaining / attempts)));
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
    const architectDraftContextId = run.draftContextId;
    const generatedResult = await dependencies.generateArchitect({
      brief: run.input.brief,
      mode: run.input.mode,
      materialization: run.input.materialization as WorkspaceMaterialization,
      operatorConstraints: run.input.operatorConstraints,
      ...(staged ? { knowledge: staged.knowledge } : {}),
      ...(staged && architectDraftContextId ? {
        readKnowledgeDocuments: (documentIds: readonly string[], options?: { signal?: AbortSignal }) => dependencies.readContextDocuments({ actorId, draftContextId: architectDraftContextId, documentIds, signal: options?.signal })
      } : {}),
      ...(architectIntelligence ? { projectIntelligence: architectIntelligence } : {})
    }, {
      runId: run.runId,
      signal: controller.signal,
      timeoutMs: attemptTimeout,
      maxRetries: attempts - 1,
      ...(staged ? { currentKnowledgeGenerationId: staged.generationId } : {}),
      maxSpecialists: policy.maxSpecialists,
      onLifecycleEvent: (event) => recordArchitectLifecycle(filePath, dependencies, event)
    });
    const result = applyCreationProfileLimits(generatedResult, policy);
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
    const completed = await completeWorkspaceComposition(filePath, actorId, run, dependencies, result, intelligencePack, controller, deadline);
    return recordLineageDrift(filePath, actorId, completed, dependencies);
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

async function completeWorkspaceComposition(
  filePath: string,
  actorId: string,
  initialRun: WorkspaceCreationRun,
  dependencies: ResolvedDependencies,
  result: WorkspaceArchitectResult,
  intelligencePack: Awaited<ReturnType<typeof readWorkspaceCreationIntelligencePack>>,
  controller: AbortController,
  deadline: number,
  compositionRunSuffix?: string
) {
  let run = await updateSnapshot(filePath, initialRun, dependencies, { state: "running", stage: "workspace-composition" }, "state-changed");
  const policy = resolveWorkspaceCreationPolicy(run.input.profile ?? "deep");
  const budget = workspaceCreationBudgetForRun(run, dependencies);
  const existingFiles = result.blueprint.materialization.mode === "existing" && "existingPath" in result.blueprint.materialization
    ? await dependencies.inspectCompositionFiles(result.blueprint.materialization.existingPath)
    : [];
  const compositionInput = {
    projectIntelligence: intelligencePack,
    blueprint: result.blueprint,
    operatorIntent: { brief: run.input.brief, constraints: run.input.operatorConstraints },
    existingFiles,
    materializationMode: result.blueprint.materialization.mode
  };
  const storedPlan = run.draftContextId
    ? await dependencies.readCompositionPlan({ actorId, draftContextId: run.draftContextId })
    : null;
  const priorOutcome = run.compositionExecution.outcome;
  const currentBlueprintFingerprint = createWorkspaceCompositionBlueprintFingerprint(result.blueprint);
  const storedPlanBelongsToBlueprint = storedPlan?.workspaceBlueprintFingerprint === currentBlueprintFingerprint;
  if (storedPlan && storedPlanBelongsToBlueprint && (priorOutcome === "completed" || storedPlan.provenance.source === "model" && priorOutcome === "in-flight")) {
    if (priorOutcome !== "completed") {
      run = await mutateWorkspaceCreationRun(filePath, (current) => ({
        ...current,
        compositionExecution: {
          ...current.compositionExecution,
          runId: storedPlan.provenance.composerRunId,
          outcome: "completed"
        }
      }));
    }
    run = await updateCompositionSnapshot(filePath, run, dependencies, compositionResultFromPlan(storedPlan));
    return markReviewReady(filePath, actorId, run, dependencies);
  }

  if (priorOutcome === "in-flight" || priorOutcome === "ambiguous") {
    if (run.snapshot.cancelRequested || controller.signal.aborted) return failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    const recovered = createDeterministicWorkspaceComposition(compositionInput, {
      runId: compositionRunId(run, compositionRunSuffix),
      warning: "Workspace composition execution was not safely recoverable; a deterministic safe draft was used."
    });
    if (run.draftContextId) await dependencies.persistCompositionPlan({ actorId, draftContextId: run.draftContextId, plan: recovered.plan });
    run = await updateCompositionSnapshot(filePath, run, dependencies, recovered);
    return markReviewReady(filePath, actorId, run, dependencies);
  }

  // The deadline already reserves Composer time by the way Architect and
  // Intelligence calculate their budgets. Composer owns the remaining shared
  // deadline and must not subtract its reserve a second time.
  const remaining = Math.max(0, deadline - Date.now());
  const canUseModel = policy.compositionStrategy === "model" && remaining >= 5_000;
  const composerAttempts = canUseModel ? Math.max(1, Math.min(budget.maxComposerAttempts, Math.floor(remaining / 5_000))) : 0;
  const composerTimeout = composerAttempts > 0
    ? Math.max(5_000, Math.min(budget.maxComposerAttemptMs, Math.floor(remaining / composerAttempts)))
    : 0;
  if (run.snapshot.cancelRequested || controller.signal.aborted) return failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
  if (!canUseModel) {
    const fallback = createDeterministicWorkspaceComposition(compositionInput, {
      runId: compositionRunId(run, compositionRunSuffix),
      warning: policy.profile === "quick"
        ? "Quick profile uses deterministic safe composition as its primary plan."
        : "The shared analysis budget left no safe Composer attempt; a deterministic safe draft was used."
    });
    if (run.draftContextId) await dependencies.persistCompositionPlan({ actorId, draftContextId: run.draftContextId, plan: fallback.plan });
    run = await updateCompositionSnapshot(filePath, run, dependencies, fallback);
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({
      ...current,
      compositionExecution: { ...current.compositionExecution, outcome: "completed" }
    }));
    return markReviewReady(filePath, actorId, run, dependencies);
  }

  run = await mutateWorkspaceCreationRun(filePath, (current) => ({
    ...current,
    compositionExecution: {
      ...current.compositionExecution,
      idempotencyKey: `workspace-composer:${compositionRunId(current, compositionRunSuffix)}:1`,
      outcome: "in-flight"
    }
  }));
  let composition: WorkspaceCompositionResult;
  try {
    composition = await dependencies.composeWorkspace(compositionInput, {
      runId: compositionRunId(run, compositionRunSuffix),
      signal: controller.signal,
      timeoutMs: composerTimeout,
      maxAttempts: composerAttempts,
      onExecutionStarted: async (execution) => {
        await mutateWorkspaceCreationRun(filePath, (current) => ({
          ...current,
          compositionExecution: { ...current.compositionExecution, idempotencyKey: execution.idempotencyKey, outcome: "in-flight" }
        }));
      },
      onExecutionKnownCompleted: async (execution) => {
        await mutateWorkspaceCreationRun(filePath, (current) => ({
          ...current,
          compositionExecution: { ...current.compositionExecution, idempotencyKey: execution.idempotencyKey, runId: execution.remoteRunId, sessionKey: execution.remoteSessionKey, outcome: "in-flight" }
        }));
      },
      ...(dependencies.nativeComposer ? {} : { modelExecutor: async () => { throw new Error("Workspace composition model is unavailable in the test boundary."); } })
    });
  } catch (error) {
    const current = await readWorkspaceCreationRunFile(filePath) ?? run;
    if (current.snapshot.cancelRequested || controller.signal.aborted && Date.now() < deadline) return failRun(filePath, current, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    throw error;
  }
  const afterComposition = await readWorkspaceCreationRunFile(filePath) ?? run;
  if (afterComposition.snapshot.cancelRequested || controller.signal.aborted && Date.now() < deadline) return failRun(filePath, afterComposition, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
  run = afterComposition;
  try {
    if (run.draftContextId) await dependencies.persistCompositionPlan({ actorId, draftContextId: run.draftContextId, plan: composition.plan });
  } catch (error) {
    await mutateWorkspaceCreationRun(filePath, (current) => ({ ...current, compositionExecution: { ...current.compositionExecution, outcome: "ambiguous" } })).catch(() => undefined);
    throw error;
  }
  if (composition.summary.failure?.code === "workspace-composer-execution-ambiguous") {
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({ ...current, compositionExecution: { ...current.compositionExecution, outcome: "ambiguous" } }));
  } else {
    run = await mutateWorkspaceCreationRun(filePath, (current) => ({
      ...current,
      compositionExecution: { ...current.compositionExecution, outcome: "completed" }
    }));
  }
  run = await updateCompositionSnapshot(filePath, run, dependencies, composition);
  return markReviewReady(filePath, actorId, run, dependencies);
}

function compositionResultFromPlan(plan: WorkspaceCompositionPlan): WorkspaceCompositionResult {
  return { plan, summary: summarizeWorkspaceCompositionPlan(plan, 0, plan.status === "fallback" ? { code: "composition-fallback", message: plan.warnings[0] ?? "A deterministic safe draft was used." } : null) };
}

async function markReviewReady(filePath: string, actorId: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies) {
  const reviewReady = await updateSnapshot(filePath, run, dependencies, { state: "review-ready", stage: "review-preparation" }, "state-changed");
  const certified = await getWorkspaceCreationReviewReadiness({ actorId, runId: reviewReady.runId }, dependencies);
  return certified?.run ?? reviewReady;
}

function compositionRunId(run: WorkspaceCreationRun, suffix?: string) {
  return suffix ? `${run.runId}:${suffix}` : run.runId;
}

async function recordLineageDrift(filePath: string, actorId: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies) {
  const parentRunId = run.lineage?.parentRunId;
  if (!parentRunId) return run;
  const parent = await findWorkspaceCreationRunById(dependencies.rootPath, actorId, parentRunId);
  const currentResult = isWorkspaceArchitectResult(run.result) ? run.result : null;
  const previousResult = parent && isWorkspaceArchitectResult(parent.run.result) ? parent.run.result : null;
  if (!parent || !currentResult || !previousResult) {
    return mutateWorkspaceCreationRun(filePath, (current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        drift: { status: "unknown", categories: [], changes: [], warning: "An upstream workspace artifact could not be compared." }
      }
    }));
  }
  const liveBaseline = await resolveLiveProvisioningBaseline(actorId, parent.run, dependencies);
  const currentPack = run.draftContextId ? await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null) : null;
  const previousContextId = liveBaseline?.draftContextId ?? parent.run.draftContextId;
  const previousPack = previousContextId ? await dependencies.readIntelligencePack({ actorId, draftContextId: previousContextId }).catch(() => null) : null;
  const currentPlan = run.draftContextId ? await dependencies.readCompositionPlan({ actorId, draftContextId: run.draftContextId }).catch(() => null) : null;
  const previousPlan = liveBaseline?.compositionPlan ?? (parent.run.draftContextId ? await dependencies.readCompositionPlan({ actorId, draftContextId: parent.run.draftContextId }).catch(() => null) : null);
  const drift = summarizeWorkspaceDrift({
    previousPack,
    currentPack,
    previousBlueprint: liveBaseline?.blueprint ?? previousResult.blueprint,
    currentBlueprint: currentResult.blueprint,
    previousComposition: previousPlan,
    currentComposition: currentPlan,
    partial: run.snapshot.context.status === "partial"
  });
  return mutateWorkspaceCreationRun(filePath, (current) => ({ ...current, snapshot: { ...current.snapshot, drift } }));
}

async function resolveLiveProvisioningBaseline(actorId: string, parent: WorkspaceCreationRun, dependencies: ResolvedDependencies) {
  const provisioningRunId = parent.snapshot.provisioningRunId;
  if (!provisioningRunId) return null;
  const locator = await dependencies.findProvisioningRunById(dependencies.provisioningRootPath, actorId, provisioningRunId);
  if (!locator || !locator.run.workspaceId) return null;
  const binding = await dependencies.readWorkspaceIntelligenceBinding({ actorId, workspaceId: locator.run.workspaceId, rootPath: dependencies.workspaceIntelligenceBindingRootPath });
  if (!binding || binding.provisioningRunId !== locator.run.runId) return null;
  const blueprint = locator.run.blueprint;
  if (!blueprint || typeof blueprint !== "object" || !("id" in blueprint)) return null;
  return {
    blueprint: blueprint as WorkspaceArchitectResult["blueprint"],
    draftContextId: locator.run.draftContextId,
    compositionPlan: locator.run.compositionPlan ?? null
  };
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
  const budget = workspaceCreationBudgetForRun(run, dependencies);
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
  const remaining = Math.max(1_000, deadline - Date.now() - budget.architectReserveMs - budget.composerReserveMs);
  const attempts = Math.max(1, Math.min(budget.maxIntelligenceAttempts, Math.floor(remaining / 5_000)));
  const attemptTimeout = Math.max(5_000, Math.min(budget.maxIntelligenceAttemptMs, Math.floor(remaining / attempts)));
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
      maxAttempts: attempts,
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
      partialContext,
      review: createIntelligenceReviewSnapshot(result.pack)
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "intelligence-updated", fallback ? result.execution.failureCode : null, intelligenceFailure ? { kind: intelligenceFailure.kind, code: intelligenceFailure.code, retryability: intelligenceFailure.retryability } : null, dependencies.now().toISOString(), fallback ? "intelligence-fallback" : "intelligence-completed", { intelligenceStatus: fallback ? "fallback" : "model", packState: result.pack.state, packId: result.pack.id });
}

function createIntelligenceReviewSnapshot(pack: ProjectIntelligencePack) {
  const conflictedFactIds = new Set(pack.conflicts.flatMap((conflict) => conflict.subjects.filter((subject) => subject.kind === "fact").map((subject) => subject.id)));
  const conflictedResourceIds = new Set(pack.conflicts.flatMap((conflict) => conflict.subjects.filter((subject) => subject.kind === "resource").map((subject) => subject.id)));
  return {
    projectName: pack.identity.projectName.value,
    description: pack.identity.description.value,
    projectType: pack.identity.projectType.value,
    understanding: [
      pack.overview.whatItDoes.value,
      pack.overview.businessContext.value,
      ...pack.overview.goals.value
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => redactSecretText(value).slice(0, 400)).slice(0, 8),
    facts: pack.facts.slice(0, 32).map((fact) => ({
      id: fact.id,
      key: fact.key,
      statement: redactSecretText(fact.statement).slice(0, 320),
      verification: fact.verification,
      conflicted: conflictedFactIds.has(fact.id)
    })),
    resources: pack.officialResources.slice(0, 24).map((resource) => ({
      id: resource.id,
      label: redactSecretText(resource.label).slice(0, 160),
      category: resource.category,
      locator: redactSecretText(resource.locator.value).slice(0, 300),
      verification: resource.verification,
      conflicted: conflictedResourceIds.has(resource.id),
      origin: resource.origin.origin
    })),
    conflicts: pack.conflicts.slice(0, 16).map((conflict) => ({
      id: conflict.id,
      summary: redactSecretText(conflict.summary).slice(0, 300),
      status: conflict.status,
      subjectCount: conflict.subjects.length
    })),
    unknowns: pack.unknowns.slice(0, 24).map((unknown) => redactSecretText(unknown).slice(0, 160)),
    sourceCount: pack.sourceCoverage.sourceIds.length,
    evidenceCount: pack.evidence.length
  } satisfies NonNullable<WorkspaceCreationSnapshot["intelligence"]["review"]>;
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
    },
    revision: {
      number: run.snapshot.revision?.number ?? 0,
      previousBlueprintFingerprint: run.snapshot.revision?.previousBlueprintFingerprint ?? null,
      blueprintFingerprint: createWorkspaceCompositionBlueprintFingerprint(result.blueprint),
      compositionPlanId: run.snapshot.revision?.compositionPlanId ?? null
    },
    freshness: {
      status: partialContext && result.freshness.status === "fresh" ? "partial" : result.freshness.status,
      reason: partialContext ? "The workspace architecture was generated from usable but incomplete project context." : result.freshness.reason,
      checkedAt: dependencies.now().toISOString(),
      knowledgeGenerationId: result.freshness.currentGenerationId,
      blueprintFingerprint: createWorkspaceCompositionBlueprintFingerprint(result.blueprint),
      compositionPlanFingerprint: run.snapshot.freshness?.compositionPlanFingerprint ?? null
    }
  };
  return appendAndPersist(filePath, run, dependencies, snapshot, "architect-updated", partialContext ? "partial-context" : null, architectFailure ? { kind: architectFailure.kind, code: architectFailure.code, retryability: architectFailure.retryability } : null, dependencies.now().toISOString());
}

async function updateCompositionSnapshot(filePath: string, run: WorkspaceCreationRun, dependencies: ResolvedDependencies, result: WorkspaceCompositionResult) {
  const status = result.summary.conflictCount > 0
    ? "conflict" as const
    : result.summary.status === "ready"
      ? "ready" as const
      : result.summary.status === "partial"
        ? "partial" as const
        : "fallback" as const;
  const composition = {
    status,
    planId: result.summary.planId,
    inputFingerprint: result.plan.inputFingerprint,
    artifactCount: result.summary.artifactCount,
    createCount: result.summary.createCount,
    mergeCount: result.summary.mergeCount,
    preserveCount: result.summary.preserveCount,
    conflictCount: result.summary.conflictCount,
    modelExecutionOccurred: result.summary.modelExecutionOccurred,
    attempts: result.summary.attempts,
    elapsedMs: result.summary.elapsedMs,
    failure: result.summary.failure ? failure("model", result.summary.failure.code, "terminal", result.summary.failure.message) : null,
    artifacts: result.plan.artifacts.slice(0, 16).map((artifact) => ({
      artifactId: artifact.artifactId,
      path: artifact.path,
      title: redactSecretText(artifact.title).slice(0, 160),
      operation: artifact.operation,
      preview: redactSecretText(artifact.content.replace(/\s+/g, " ").trim()).slice(0, 360),
      sourceRefCount: artifact.sourceRefs.factIds.length + artifact.sourceRefs.resourceIds.length + artifact.sourceRefs.evidenceRefIds.length
    }))
  };
  const freshness = run.snapshot.freshness ? {
    ...run.snapshot.freshness,
    compositionPlanFingerprint: result.plan.inputFingerprint,
    checkedAt: dependencies.now().toISOString()
  } : undefined;
  return appendAndPersist(filePath, run, dependencies, {
    ...run.snapshot,
    composition,
    freshness
  }, "context-updated", result.summary.conflictCount > 0 ? "composition-conflict" : result.summary.status === "fallback" ? "composition-fallback" : null, null, dependencies.now().toISOString(), result.summary.status === "fallback" ? "composition-fallback" : "composition-completed", {
    compositionStatus: status,
    compositionPlanId: result.summary.planId,
    compositionArtifactCount: result.summary.artifactCount,
    compositionConflictCount: result.summary.conflictCount,
    compositionModelExecutionOccurred: result.summary.modelExecutionOccurred
  });
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
    const compositionBlocked = state !== "cancelled" && (current.compositionExecution.outcome === "in-flight" || current.compositionExecution.outcome === "ambiguous");
    const compositionFailure = compositionBlocked
      ? failure("unknown", "workspace-composer-execution-ambiguous", "terminal", "Workspace composition execution could not be safely recovered.")
      : current.snapshot.composition?.failure ?? null;
    const snapshot: WorkspaceCreationSnapshot = {
      ...current.snapshot,
      state,
      stage: null,
      intelligence: intelligenceBlocked
        ? { ...current.snapshot.intelligence, status: "blocked", failure: intelligenceFailure, retryAvailable: false }
        : current.snapshot.intelligence,
      composition: compositionBlocked && current.snapshot.composition
        ? { ...current.snapshot.composition, status: "blocked", failure: compositionFailure }
        : current.snapshot.composition,
      architect: { ...current.snapshot.architect, status: "blocked", failure: problem, retryAvailable: problem.retryability === "transient" || problem.retryability === "repairable" },
      cancelRequested: state === "cancelled" || current.snapshot.cancelRequested,
      elapsedMs: elapsedMs(current.createdAt, now)
    };
    const next = appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind: "state-changed",
      stage: null,
      snapshot,
      attempt: current.attempt,
      maxAttempts: workspaceCreationBudgetForRun(current, dependencies).maxArchitectAttempts,
      elapsedMs: elapsedMs(current.createdAt, now),
      sourceId: null,
      warningCode: problem.code,
      failure: { kind: problem.kind, code: problem.code, retryability: problem.retryability },
      activityCode: state === "cancelled" ? null : "source-failed",
      activityData: null
    });
    return compositionBlocked
      ? { ...next, compositionExecution: { ...current.compositionExecution, outcome: "ambiguous" as const } }
      : next;
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
    const nextSnapshotBase: WorkspaceCreationSnapshot = {
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
    const nextSnapshot: WorkspaceCreationSnapshot = {
      ...nextSnapshotBase,
      timings: updateCreationTimings(current, nextSnapshotBase, activityCode)
    };
    const next = appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: now,
      kind,
      stage: nextSnapshot.stage,
      snapshot: nextSnapshot,
      attempt: current.attempt,
      maxAttempts: workspaceCreationBudgetForRun(current, dependencies).maxArchitectAttempts,
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

function updateCreationTimings(run: WorkspaceCreationRun, snapshot: WorkspaceCreationSnapshot, activityCode: WorkspaceCreationActivityCode | null) {
  const previous = run.snapshot.timings ?? {
    firstUsefulSignalMs: null,
    minimumContextMs: null,
    reviewReadyMs: null,
    provisioningReadyMs: null,
    enrichmentDurationMs: null
  };
  const signalCodes: WorkspaceCreationActivityCode[] = ["page-fetched", "document-stored", "evidence-created", "fact-extracted", "resource-extracted", "intelligence-completed", "architect-completed", "composition-completed"];
  const elapsed = snapshot.elapsedMs;
  return {
    firstUsefulSignalMs: previous.firstUsefulSignalMs ?? (activityCode && signalCodes.includes(activityCode) ? elapsed : null),
    minimumContextMs: previous.minimumContextMs ?? ((snapshot.context.status === "ready" || snapshot.context.status === "partial" && snapshot.context.usableEvidence || run.input.sources.length === 0 && snapshot.extraction.status === "not-requested") ? elapsed : null),
    reviewReadyMs: previous.reviewReadyMs ?? (snapshot.state === "review-ready" ? elapsed : null),
    provisioningReadyMs: previous.provisioningReadyMs,
    enrichmentDurationMs: previous.enrichmentDurationMs ?? (run.lineage?.trigger === "post-create-enrichment" && snapshot.state === "review-ready" ? elapsed : null)
  };
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

async function recoverUnexpectedCreationFailure(filePath: string, actorId: string, error: unknown, dependencies: ResolvedDependencies) {
  const run = await readWorkspaceCreationRunFile(filePath);
  if (!run) throw error;
  if (isWorkspaceCreationTerminal(run.snapshot.state)) return run;
  if (run.compositionExecution.outcome === "in-flight" || run.compositionExecution.outcome === "ambiguous") {
    if (run.snapshot.cancelRequested) return failRun(filePath, run, dependencies, failure("cancelled", "cancelled", "cancelled", "Workspace creation was cancelled."), "cancelled");
    const architectResult = run.result && isWorkspaceArchitectResult(run.result) ? run.result : null;
    if (!architectResult) return failRun(filePath, run, dependencies, failure("unknown", "workspace-composer-execution-ambiguous", "terminal", "Workspace composition execution could not be safely recovered."));
    const intelligencePack = run.draftContextId
      ? await dependencies.readIntelligencePack({ actorId, draftContextId: run.draftContextId }).catch(() => null)
      : null;
    const existingFiles = architectResult.blueprint.materialization.mode === "existing" && "existingPath" in architectResult.blueprint.materialization
      ? await dependencies.inspectCompositionFiles(architectResult.blueprint.materialization.existingPath)
      : [];
    const recovered = createDeterministicWorkspaceComposition({
      projectIntelligence: intelligencePack,
      blueprint: architectResult.blueprint,
      operatorIntent: { brief: run.input.brief, constraints: run.input.operatorConstraints },
      existingFiles,
      materializationMode: architectResult.blueprint.materialization.mode
    }, { runId: run.runId, warning: "Workspace composition execution was not safely recoverable; a deterministic safe draft was used." });
    if (run.draftContextId) await dependencies.persistCompositionPlan({ actorId, draftContextId: run.draftContextId, plan: recovered.plan });
    const updated = await updateCompositionSnapshot(filePath, run, dependencies, recovered);
    return markReviewReady(filePath, actorId, updated, dependencies);
  }
  if (run.intelligenceExecution.outcome === "in-flight" || run.intelligenceExecution.outcome === "ambiguous") {
    return failRun(filePath, run, dependencies, failure("unknown", "intelligence-execution-ambiguous", "terminal", "Project Intelligence execution could not be safely recovered."));
  }
  if (run.remoteExecution.outcome === "in-flight" || run.remoteExecution.outcome === "ambiguous") {
    return failRun(filePath, run, dependencies, failure("unknown", "remote-execution-ambiguous", "terminal", "Architect execution could not be safely recovered."));
  }
  return failRun(filePath, run, dependencies, failure("unknown", "creation-run-failed", "terminal", redactErrorMessage(error, "Workspace creation failed.")));
}

function isWorkspaceArchitectResult(value: unknown): value is WorkspaceArchitectResult {
  return Boolean(value && typeof value === "object" && "blueprint" in value && "reasoning" in value);
}

function applyCreationProfileLimits(result: WorkspaceArchitectResult, policy: ReturnType<typeof resolveWorkspaceCreationPolicy>) {
  if (policy.profile !== "quick" || result.blueprint.workforce.specialists.length <= policy.maxSpecialists) return result;
  return {
    ...result,
    blueprint: {
      ...result.blueprint,
      workforce: {
        ...result.blueprint.workforce,
        specialists: result.blueprint.workforce.specialists.slice(0, policy.maxSpecialists)
      },
      warnings: [...result.blueprint.warnings, `Quick profile limited persistent specialists to ${policy.maxSpecialists}.`].slice(0, 16)
    }
  };
}

function resolveDependencies(input: WorkspaceCreationRunDependencies): ResolvedDependencies {
  return {
    rootPath: resolveWorkspaceCreationRunRoot(input.rootPath),
    provisioningRootPath: resolveProvisioningRoot(input.provisioningRootPath),
    workspaceIntelligenceBindingRootPath: input.workspaceIntelligenceBindingRootPath,
    now: input.now ?? (() => new Date()),
    persistIntake: input.persistIntake ?? persistWorkspaceCreationIntake,
    cloneContext: input.cloneContext ?? cloneWorkspaceCreationContext,
    stageContext: input.stageContext ?? stageWorkspaceCreationKnowledge,
    readContext: input.readContext ?? readWorkspaceCreationContext,
    readContextMetadata: input.readContextMetadata ?? (input.readContext ? input.readContext : readWorkspaceCreationContextMetadata),
    readContextDocuments: input.readContextDocuments ?? readWorkspaceCreationContextDocuments,
    synthesizeIntelligence: input.synthesizeIntelligence ?? synthesizeProjectIntelligence,
    readIntelligencePack: input.readIntelligencePack ?? readWorkspaceCreationIntelligencePack,
    readIntelligenceSummary: input.readIntelligenceSummary ?? readWorkspaceCreationIntelligenceSummary,
    persistIntelligencePack: input.persistIntelligencePack ?? persistWorkspaceCreationIntelligencePack,
    generateArchitect: input.generateArchitect ?? generateWorkspaceBlueprint,
    composeWorkspace: input.composeWorkspace ?? composeWorkspaceComposition,
    persistCompositionPlan: input.persistCompositionPlan ?? (input.persistIntake
      ? async ({ plan }: { actorId: string; draftContextId: string; plan: Parameters<typeof persistWorkspaceCreationCompositionPlan>[0]["plan"] }) => ({ planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status })
      : persistWorkspaceCreationCompositionPlan),
    readCompositionPlan: input.readCompositionPlan ?? readWorkspaceCreationCompositionPlan,
    reviseArchitect: input.reviseArchitect ?? reviseWorkspaceBlueprint,
    inspectCompositionFiles: input.inspectCompositionFiles ?? inspectWorkspaceCompositionFiles,
    readWorkspaceIntelligenceBinding: input.readWorkspaceIntelligenceBinding ?? readWorkspaceIntelligenceBinding,
    findProvisioningRunById: input.findProvisioningRunById ?? findRunById,
    budget: { ...DEFAULT_WORKSPACE_CREATION_BUDGET, ...(input.budget ?? {}) },
    budgetOverrides: input.budget ?? {},
    nativeComposer: !input.composeWorkspace && !input.generateArchitect && !input.stageContext && !input.persistIntake
  };
}

function workspaceCreationBudgetForRun(run: WorkspaceCreationRun, dependencies: ResolvedDependencies) {
  return {
    ...resolveWorkspaceCreationPolicy(run.expediteRequestedAt ? "quick" : run.input.profile ?? "deep").budget,
    ...dependencies.budgetOverrides
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
    "source-started", "page-discovered", "page-fetch-started", "page-fetched", "rendered-fallback-started", "rendered-fallback-used", "document-stored", "source-partial", "source-completed", "source-failed",
    "architect-started", "architect-runtime-ready", "architect-attempt-started", "architect-model-started", "architect-model-completed", "architect-structured-output-rejected", "architect-attempt-failed", "architect-retry-scheduled", "architect-attempt-completed", "architect-fallback", "architect-completed",
    "extraction-started", "extraction-completed", "extraction-partial", "evidence-created", "fact-extracted", "resource-extracted", "resource-verified", "conflict-detected",
    "continue-now-requested", "enrichment-started", "enrichment-completed"
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
  profile?: WorkspaceCreationProfile;
  continueLearningAfterCreation?: boolean;
  trigger?: WorkspaceCreationTrigger;
}) {
  return sha256(stableSerialize({
    version: 1,
    brief: input.brief,
    mode: input.mode,
    operatorConstraints: input.operatorConstraints,
    materialization: input.materialization,
    sources: input.sources.map(sourceFingerprintProjection),
    draftContextId: input.draftContextId,
    profile: input.profile ?? "quick",
    continueLearningAfterCreation: input.continueLearningAfterCreation !== false,
    trigger: input.trigger ?? "initial",
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

function deterministicDraftContextId(seed: string) {
  const hex = sha256(seed).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
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
