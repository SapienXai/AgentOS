import "server-only";

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWorkspaceBlueprintFreshness,
  validateWorkspaceBlueprint
} from "@/lib/agentos/application/workspace-architect";
import { readKnowledgeSnapshot } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  promoteWorkspaceCreationKnowledge,
  readWorkspaceCreationContext,
  readWorkspaceCreationCompositionPlan,
  readWorkspaceCreationIntelligencePack,
  type WorkspaceCreationContextResult
} from "@/lib/agentos/application/workspace-creation-context-service";
import { applyWorkspaceCompositionPlan, createWorkspaceCompositionBlueprintFingerprint } from "@/lib/agentos/application/workspace-composer";
import { createWorkspaceCompositionInputFingerprint, validateWorkspaceCompositionPlan, type WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import {
  ensureWorkspaceNativeKnowledge,
  type WorkspaceNativeKnowledgeBindingResult,
  type WorkspaceNativeKnowledgeStatus
} from "@/lib/agentos/application/workspace-native-knowledge-service";
import {
  acquireProvisioningLease,
  ProvisioningLeaseBusyError,
  ProvisioningLeaseLostError,
  type ProvisioningLeaseHandle
} from "@/lib/agentos/application/workspace-provisioning-lease";
import { persistWorkspaceIntelligenceBinding } from "@/lib/agentos/application/workspace-intelligence-binding-store";
import {
  buildProvisioningStorageKey,
  createRunAtomically,
  findRunById,
  readStoredRun,
  readStoredRunFile,
  resolveProvisioningRoot,
  runPath,
  updateStoredRun,
  writeAtomicJson,
  WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH,
  WORKSPACE_PROVISIONING_ROOT,
  WORKSPACE_PROVISIONING_SCHEMA_VERSION,
  workspaceProvisioningStates,
  type ProvisioningCheckpoint,
  type ProvisioningCompletedStepId,
  type StoredWorkspaceProvisioningRun
} from "@/lib/agentos/application/workspace-provisioning-store";
import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import { normalizeWorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import { filterKnownOpenClawSkillIds, filterKnownOpenClawToolIds } from "@/lib/openclaw/agent-presets";
import { updateAgent } from "@/lib/openclaw/application/agent-service";
import { createWorkspaceProject } from "@/lib/openclaw/application/workspace-service";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { getConfiguredWorkspaceRoot } from "@/lib/openclaw/domains/control-plane-settings";
import { createWorkspaceAgentId } from "@/lib/openclaw/domains/agent-provisioning";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import { buildWorkspaceScaffoldDocumentPaths } from "@/lib/openclaw/workspace-docs";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import { classifyGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import type {
  OperationProgressSnapshot,
  WorkspaceCreateResult,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

const POLL_INTERVAL_MS = 100;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "Documents", "Shared", "projects");
const PROVISIONING_STEP_ORDER: WorkspaceProvisioningState[] = ["validating", "materializing", "bootstrapping", "applying-composition", "promoting-knowledge", "provisioning-agents", "binding-knowledge", "applying-capabilities", "recording-declarations", "verifying"];

export { WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH, WORKSPACE_PROVISIONING_ROOT, WORKSPACE_PROVISIONING_SCHEMA_VERSION, workspaceProvisioningStates };
export type { ProvisioningCheckpoint, ProvisioningCompletedStepId, StoredWorkspaceProvisioningRun };

export type WorkspaceProvisioningState = (typeof workspaceProvisioningStates)[number];

type ProvisioningError = {
  code: string;
  message: string;
};

export type WorkspaceProvisioningRun = {
  runId: string;
  state: WorkspaceProvisioningState;
  blueprintId: string;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  blueprintFingerprint: string;
  workspaceId: string | null;
  result: WorkspaceCreateResult | null;
  warnings: string[];
  error: ProvisioningError | null;
  progress: {
    label: string;
    detail: string;
  } | null;
  steps: Array<{
    id: WorkspaceProvisioningState;
    label: string;
    status: "pending" | "active" | "complete" | "failed";
  }>;
  signals: string[];
  completedSteps: Partial<Record<ProvisioningCompletedStepId, ProvisioningCheckpoint>>;
  knowledge: StoredWorkspaceProvisioningRun["knowledge"];
  nativeKnowledge: StoredWorkspaceProvisioningRun["nativeKnowledge"];
  pendingSetup: StoredWorkspaceProvisioningRun["pendingSetup"];
  composition: StoredWorkspaceProvisioningRun["composition"];
  verifiedAt: string | null;
};

export type ProvisionWorkspaceFromBlueprintInput = {
  actorId: string;
  blueprint: unknown;
  draftContextId?: string | null;
  expectedKnowledgeGenerationId?: string | null;
  idempotencyKey: string;
  acceptDraft?: boolean;
  compositionPlan?: unknown;
  compositionPlanId?: string | null;
  compositionPlanFingerprint?: string | null;
  signal?: AbortSignal;
};

export class WorkspaceProvisioningError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WorkspaceProvisioningError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type PreparedProvisioning = {
  actorId: string;
  blueprint: WorkspaceBlueprint;
  blueprintFingerprint: string;
  draftContextId: string | null;
  expectedKnowledgeGenerationId: string | null;
  context: WorkspaceCreationContextResult | null;
  compositionPlan: WorkspaceCompositionPlan | null;
  createInput: Parameters<typeof createWorkspaceProject>[0];
  intelligencePack: Awaited<ReturnType<typeof readWorkspaceCreationIntelligencePack>>;
};

export type WorkspaceProvisioningDependencies = {
  rootPath?: string;
  now?: () => Date;
  /** Test-only barrier used to deterministically exercise the atomic-create race. */
  beforeAtomicRunCreate?: () => Promise<void>;
  createWorkspaceProject?: typeof createWorkspaceProject;
  getMissionControlSnapshot?: typeof getMissionControlSnapshot;
  readWorkspaceCreationContext?: typeof readWorkspaceCreationContext;
  readWorkspaceCreationCompositionPlan?: typeof readWorkspaceCreationCompositionPlan;
  readWorkspaceCreationIntelligencePack?: typeof readWorkspaceCreationIntelligencePack;
  readKnowledgeSnapshot?: typeof readKnowledgeSnapshot;
  promoteWorkspaceCreationKnowledge?: typeof promoteWorkspaceCreationKnowledge;
  ensureWorkspaceNativeKnowledge?: typeof ensureWorkspaceNativeKnowledge;
  updateAgent?: typeof updateAgent;
  persistWorkspaceIntelligenceBinding?: typeof persistWorkspaceIntelligenceBinding;
};

type ResolvedWorkspaceProvisioningDependencies = {
  rootPath: string;
  now: () => Date;
  beforeAtomicRunCreate?: () => Promise<void>;
  createWorkspaceProject: typeof createWorkspaceProject;
  getMissionControlSnapshot: typeof getMissionControlSnapshot;
  readWorkspaceCreationContext: typeof readWorkspaceCreationContext;
  readWorkspaceCreationCompositionPlan: typeof readWorkspaceCreationCompositionPlan;
  readWorkspaceCreationIntelligencePack: typeof readWorkspaceCreationIntelligencePack;
  readKnowledgeSnapshot: typeof readKnowledgeSnapshot;
  promoteWorkspaceCreationKnowledge: typeof promoteWorkspaceCreationKnowledge;
  ensureWorkspaceNativeKnowledge: typeof ensureWorkspaceNativeKnowledge;
  updateAgent: typeof updateAgent;
  persistWorkspaceIntelligenceBinding: typeof persistWorkspaceIntelligenceBinding;
};

const inFlight = new Map<string, Promise<WorkspaceProvisioningRun>>();

function resolveDependencies(input: WorkspaceProvisioningDependencies = {}): ResolvedWorkspaceProvisioningDependencies {
  return {
    rootPath: resolveProvisioningRoot(input.rootPath),
    now: input.now ?? (() => new Date()),
    beforeAtomicRunCreate: input.beforeAtomicRunCreate,
    createWorkspaceProject: input.createWorkspaceProject ?? createWorkspaceProject,
    getMissionControlSnapshot: input.getMissionControlSnapshot ?? getMissionControlSnapshot,
    readWorkspaceCreationContext: input.readWorkspaceCreationContext ?? readWorkspaceCreationContext,
    readWorkspaceCreationCompositionPlan: input.readWorkspaceCreationCompositionPlan ?? readWorkspaceCreationCompositionPlan,
    readWorkspaceCreationIntelligencePack: input.readWorkspaceCreationIntelligencePack ?? readWorkspaceCreationIntelligencePack,
    readKnowledgeSnapshot: input.readKnowledgeSnapshot ?? readKnowledgeSnapshot,
    promoteWorkspaceCreationKnowledge: input.promoteWorkspaceCreationKnowledge ?? promoteWorkspaceCreationKnowledge,
    ensureWorkspaceNativeKnowledge: input.ensureWorkspaceNativeKnowledge ?? ensureWorkspaceNativeKnowledge,
    updateAgent: input.updateAgent ?? updateAgent,
    persistWorkspaceIntelligenceBinding: input.persistWorkspaceIntelligenceBinding ?? persistWorkspaceIntelligenceBinding
  };
}

export async function startWorkspaceProvisioning(
  input: ProvisionWorkspaceFromBlueprintInput,
  dependencies: WorkspaceProvisioningDependencies = {}
): Promise<WorkspaceProvisioningRun> {
  const resolved = resolveDependencies(dependencies);
  const prepared = await prepareProvisioning(input, resolved);
  const storageKey = buildProvisioningStorageKey(prepared.actorId, input.idempotencyKey);
  const filePath = runPath(resolved.rootPath, storageKey);
  let run = await readStoredRun(resolved.rootPath, storageKey);

  if (run) assertStoredRunIntegrity(run);

  if (!run) {
    await resolved.beforeAtomicRunCreate?.();
    const created = await createRunAtomically(resolved.rootPath, storageKey, {
      actorId: prepared.actorId,
      blueprint: prepared.blueprint,
      blueprintFingerprint: prepared.blueprintFingerprint,
      draftContextId: prepared.draftContextId,
      expectedKnowledgeGenerationId: prepared.expectedKnowledgeGenerationId,
      compositionPlan: prepared.compositionPlan
    });
    run = created.run;
  }

  assertProvisioningIntentMatches(run, prepared);

  if (run.state === "failed" || run.state === "cancelled") {
    run = await retryFailedProvisioningRun(filePath, run, resolved);
  }

  const existing = inFlight.get(filePath);
  if (!existing && !isTerminal(run.state)) {
    const execution = executeWorkspaceProvisioning(filePath, prepared, input.signal, resolved)
      .catch((error) => recoverUnexpectedProvisioningFailure(filePath, error, resolved))
      .finally(() => {
        if (inFlight.get(filePath) === execution) inFlight.delete(filePath);
      });
    inFlight.set(filePath, execution);
  }

  return publicRun(await readStoredRun(resolved.rootPath, storageKey) ?? run);
}

async function retryFailedProvisioningRun(
  filePath: string,
  expectedRun: StoredWorkspaceProvisioningRun,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  const lease = await acquireProvisioningLease({
    runFilePath: filePath,
    runId: expectedRun.runId,
    attempt: expectedRun.attempt
  });
  if (!lease) return await readStoredRunFile(filePath) ?? expectedRun;
  try {
    await lease.assertOwned();
    const current = await readStoredRunFile(filePath);
    if (!current) throw new WorkspaceProvisioningError("run-unavailable", "Workspace provisioning run is unavailable.", 500);
    assertStoredRunIntegrity(current);
    if (current.state !== "failed" && current.state !== "cancelled") return current;
    return updateStoredRun(filePath, current, {
      state: "pending",
      error: null,
      progress: { label: "Preparing workspace", detail: "Retrying the incomplete provisioning run." },
      attempt: current.attempt + 1,
      warnings: [],
      updatedAt: dependencies.now().toISOString()
    });
  } finally {
    await lease.release().catch(() => undefined);
  }
}

export async function provisionWorkspaceFromBlueprint(
  input: ProvisionWorkspaceFromBlueprintInput,
  dependencies: WorkspaceProvisioningDependencies = {}
): Promise<WorkspaceProvisioningRun> {
  return startWorkspaceProvisioning(input, dependencies);
}

export async function waitForWorkspaceProvisioning(
  input: ProvisionWorkspaceFromBlueprintInput,
  dependencies: WorkspaceProvisioningDependencies = {}
): Promise<WorkspaceProvisioningRun> {
  const resolved = resolveDependencies(dependencies);
  const storageKey = buildProvisioningStorageKey(input.actorId, input.idempotencyKey);
  await startWorkspaceProvisioning(input, resolved);

  for (;;) {
    const run = await readStoredRun(resolved.rootPath, storageKey);
    if (!run) throw new WorkspaceProvisioningError("run-unavailable", "Workspace provisioning run is unavailable.", 500);
    if (isTerminal(run.state)) return publicRun(run);
    await delay(POLL_INTERVAL_MS);
  }
}

export async function resumeWorkspaceProvisioningRun(input: {
  actorId: string;
  runId: string;
  signal?: AbortSignal;
}, dependencies: WorkspaceProvisioningDependencies = {}): Promise<WorkspaceProvisioningRun | null> {
  const resolved = resolveDependencies(dependencies);
  const runId = input.runId.trim();
  const locator = await findRunById(resolved.rootPath, input.actorId, runId);
  if (!locator) return null;
  assertStoredRunIntegrity(locator.run);
  if (isTerminal(locator.run.state)) return publicRun(locator.run);

  const prepared = await prepareProvisioning({
    actorId: input.actorId,
    blueprint: locator.run.blueprint,
    draftContextId: locator.run.draftContextId,
    expectedKnowledgeGenerationId: locator.run.expectedKnowledgeGenerationId,
    compositionPlan: locator.run.compositionPlan,
    idempotencyKey: `resume:${locator.run.idempotencyKeyHash}`,
    acceptDraft: true
  }, resolved, {
    allowCompletedKnowledgeRecovery: true,
    trustedCompositionPlan: locator.run.compositionPlan
  });
  ensureExecution(locator.filePath, prepared, input.signal, resolved);
  return publicRun(await readStoredRunFile(locator.filePath) ?? locator.run);
}

export async function ensureWorkspaceProvisioningRunActive(input: {
  actorId: string;
  runId: string;
  signal?: AbortSignal;
}, dependencies: WorkspaceProvisioningDependencies = {}) {
  return resumeWorkspaceProvisioningRun(input, dependencies);
}

export async function getWorkspaceProvisioningRun(input: {
  actorId: string;
  runId: string;
  signal?: AbortSignal;
}, dependencies: WorkspaceProvisioningDependencies = {}): Promise<WorkspaceProvisioningRun | null> {
  return ensureWorkspaceProvisioningRunActive(input, dependencies);
}

async function prepareProvisioning(
  input: ProvisionWorkspaceFromBlueprintInput,
  dependencies: ResolvedWorkspaceProvisioningDependencies,
  options: { allowCompletedKnowledgeRecovery?: boolean; trustedCompositionPlan?: WorkspaceCompositionPlan | null } = {}
): Promise<PreparedProvisioning> {
  const actorId = input.actorId.trim();
  if (!actorId) throw new WorkspaceProvisioningError("actor-unavailable", "Workspace ownership is unavailable.");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new WorkspaceProvisioningError("idempotency-required", "A provisioning idempotency key is required.");

  const validation = validateWorkspaceBlueprint(input.blueprint);
  if (!validation.valid) {
    throw new WorkspaceProvisioningError("blueprint-invalid", formatValidationIssues(validation.issues));
  }
  assertCompleteBlueprint(input.blueprint);
  const blueprint = input.blueprint as WorkspaceBlueprint;
  if (blueprint.status === "blocked") {
    throw new WorkspaceProvisioningError("blueprint-blocked", "This workspace blueprint is blocked and cannot be provisioned.");
  }
  if (blueprint.status === "draft" && input.acceptDraft !== true) {
    throw new WorkspaceProvisioningError("draft-acceptance-required", "Accept the safe draft before provisioning the workspace.");
  }

  const materialization = normalizeWorkspaceMaterialization(blueprint.materialization);
  await validateMaterializationTarget(materialization);
  if (materialization.mode === "clone") {
    validateCloneUrl(materialization.repoUrl);
  }

  const draftContextId = input.draftContextId?.trim() || null;
  let context: WorkspaceCreationContextResult | null = null;
  if (draftContextId) {
    try {
      context = await dependencies.readWorkspaceCreationContext({ actorId, draftContextId });
    } catch (error) {
      if (!options.allowCompletedKnowledgeRecovery) throw error;
    }
  }
  const expectedKnowledgeGenerationId = input.expectedKnowledgeGenerationId?.trim() || null;
  if (context && expectedKnowledgeGenerationId !== (context.generationId ?? null)) {
    throw new WorkspaceProvisioningError("knowledge-generation-mismatch", "The staged project context changed; review the blueprint again.", 409);
  }
  if (context || !options.allowCompletedKnowledgeRecovery) validateKnowledgeFreshness(blueprint, context);

  let compositionPlan: WorkspaceCompositionPlan | null = null;
  const intelligencePack = draftContextId
    ? await dependencies.readWorkspaceCreationIntelligencePack({ actorId, draftContextId }).catch(() => null)
    : null;
  const hasCompositionReference = Boolean(
    input.compositionPlan !== undefined && input.compositionPlan !== null
    || normalizeOptionalIntent(input.compositionPlanId)
    || normalizeOptionalIntent(input.compositionPlanFingerprint)
  );
  const storedCompositionPlan = options.trustedCompositionPlan ?? (draftContextId && hasCompositionReference
    ? await dependencies.readWorkspaceCreationCompositionPlan({ actorId, draftContextId })
    : null);
  if (input.compositionPlan !== undefined && input.compositionPlan !== null) {
    if (!validateWorkspaceCompositionPlan(input.compositionPlan)) throw new WorkspaceProvisioningError("composition-invalid", "The workspace composition plan is invalid or tampered with.", 409);
    if (!storedCompositionPlan || stableStringify(storedCompositionPlan) !== stableStringify(input.compositionPlan)) {
      throw new WorkspaceProvisioningError("composition-canonical-mismatch", "The workspace composition plan must match the durable server plan.", 409);
    }
    compositionPlan = input.compositionPlan;
  } else {
    compositionPlan = storedCompositionPlan;
  }
  if (input.compositionPlanId !== undefined && normalizeOptionalIntent(input.compositionPlanId) !== (compositionPlan?.planId ?? null)) {
    throw new WorkspaceProvisioningError("composition-reference-mismatch", "The requested composition plan is not the reviewed server plan.", 409);
  }
  if (input.compositionPlanFingerprint !== undefined && normalizeOptionalIntent(input.compositionPlanFingerprint) !== (compositionPlan?.inputFingerprint ?? null)) {
    throw new WorkspaceProvisioningError("composition-reference-mismatch", "The requested composition fingerprint is not the reviewed server plan.", 409);
  }
  if (compositionPlan?.status === "blocked") {
    throw new WorkspaceProvisioningError("composition-blocked", "The workspace composition plan contains unresolved conflicts and cannot be provisioned.", 409);
  }

  const blueprintFingerprint = fingerprintBlueprint(blueprint);
  if (compositionPlan) {
    if (compositionPlan.workspaceBlueprintId !== blueprint.id
      || compositionPlan.workspaceBlueprintFingerprint !== createWorkspaceCompositionBlueprintFingerprint(blueprint)
      || compositionPlan.materializationMode !== materialization.mode) {
      throw new WorkspaceProvisioningError("composition-binding-mismatch", "The workspace composition plan does not belong to this blueprint.", 409);
    }
    if (compositionPlan.projectIntelligencePackId) {
      if (!draftContextId) throw new WorkspaceProvisioningError("composition-binding-mismatch", "The workspace composition plan requires its staged project intelligence context.", 409);
      const pack = intelligencePack;
      if (!pack
        || pack.id !== compositionPlan.projectIntelligencePackId
        || (pack.provenance.generationId ?? pack.generation?.id ?? null) !== compositionPlan.projectIntelligenceGenerationId) {
        throw new WorkspaceProvisioningError("composition-binding-mismatch", "The workspace composition plan is bound to a different project intelligence generation.", 409);
      }
    } else if (compositionPlan.projectIntelligenceGenerationId !== null) {
      throw new WorkspaceProvisioningError("composition-binding-mismatch", "The workspace composition plan has an invalid project intelligence binding.", 409);
    }
    const expectedInputFingerprint = createWorkspaceCompositionInputFingerprint({
      policyVersion: compositionPlan.policyVersion,
      packId: compositionPlan.projectIntelligencePackId,
      blueprint,
      operatorIntent: { brief: blueprint.brief, constraints: blueprint.operatorConstraints },
      materializationMode: compositionPlan.materializationMode,
      existingFiles: compositionPlan.existingFileHashes
    });
    if (compositionPlan.inputFingerprint !== expectedInputFingerprint) {
      throw new WorkspaceProvisioningError("composition-binding-mismatch", "The workspace composition plan input binding is invalid.", 409);
    }
  }
  const template = inferWorkspaceTemplate(blueprint.identity.projectType);
  const agents = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists].map((agent) => ({
    id: agent.id,
    role: agent.role,
    name: agent.name,
    enabled: agent.enabled,
    skillIds: filterKnownOpenClawSkillIds(agent.skillIds),
    toolIds: filterKnownOpenClawToolIds(agent.toolIds),
    modelId: undefined,
    isPrimary: agent.isPrimary,
    policy: agent.policy,
    heartbeat: { enabled: false }
  }));

  return {
    actorId,
    blueprint,
    blueprintFingerprint,
    draftContextId,
    expectedKnowledgeGenerationId,
    context,
    compositionPlan,
    intelligencePack,
    createInput: {
      name: blueprint.identity.name,
      brief: blueprint.brief,
      materialization,
      template,
      teamPreset: "custom",
      modelProfile: "balanced",
      rules: {
        workspaceOnly: true,
        generateStarterDocs: true,
        generateMemory: true,
        kickoffMission: false
      },
      agents,
      knowledgeSources: context?.knowledge.sources ?? blueprint.knowledge.sources,
      creation: {
        source: "api",
        idempotencyKey: `phase6:${blueprint.id}:${blueprintFingerprint}`
      }
    }
  };
}

function assertProvisioningIntentMatches(
  run: StoredWorkspaceProvisioningRun,
  prepared: PreparedProvisioning
) {
  const draftContextId = normalizeOptionalIntent(prepared.draftContextId);
  const expectedKnowledgeGenerationId = normalizeOptionalIntent(prepared.expectedKnowledgeGenerationId);
  if (
    run.blueprintId !== prepared.blueprint.id
    || run.blueprintFingerprint !== prepared.blueprintFingerprint
    || normalizeOptionalIntent(run.draftContextId) !== draftContextId
    || normalizeOptionalIntent(run.expectedKnowledgeGenerationId) !== expectedKnowledgeGenerationId
    || (run.compositionPlan?.planId ?? null) !== (prepared.compositionPlan?.planId ?? null)
    || (run.compositionPlan?.inputFingerprint ?? null) !== (prepared.compositionPlan?.inputFingerprint ?? null)
  ) {
    throw new WorkspaceProvisioningError(
      "idempotency-conflict",
      "This provisioning request conflicts with an existing workspace creation run.",
      409
    );
  }
}

function normalizeOptionalIntent(value: string | null | undefined) {
  return value?.trim() || null;
}

function ensureExecution(
  filePath: string,
  prepared: PreparedProvisioning,
  signal: AbortSignal | undefined,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  const existing = inFlight.get(filePath);
  if (existing) return existing;
  const execution = executeWorkspaceProvisioning(filePath, prepared, signal, dependencies)
    .catch((error) => recoverUnexpectedProvisioningFailure(filePath, error, dependencies))
    .finally(() => {
      if (inFlight.get(filePath) === execution) inFlight.delete(filePath);
    });
  inFlight.set(filePath, execution);
  return execution;
}

async function executeWorkspaceProvisioning(
  filePath: string,
  prepared: PreparedProvisioning,
  signal: AbortSignal | undefined,
  dependencies: ResolvedWorkspaceProvisioningDependencies
): Promise<WorkspaceProvisioningRun> {
  let run = await readStoredRunFile(filePath);
  if (!run) throw new WorkspaceProvisioningError("run-unavailable", "Workspace provisioning run is unavailable.", 500);
  assertStoredRunIntegrity(run);
  if (isTerminal(run.state)) return publicRun(run);

  let lease: ProvisioningLeaseHandle | null = null;
  try {
    lease = await acquireProvisioningLease({
      runFilePath: filePath,
      runId: run.runId,
      attempt: run.attempt
    });
    if (!lease) return publicRun(await readStoredRunFile(filePath) ?? run);

    await lease.assertOwned();
    throwIfProvisioningAborted(signal);
    if (!isCompleted(run, "validated")) {
      run = await transition(filePath, run, "validating", "Validating the blueprint and staged project context.", lease, dependencies);
      run = await completeStep(filePath, run, "validated", { blueprintFingerprint: run.blueprintFingerprint }, lease, dependencies);
    }

    const ensured = await ensureWorkspaceBootstrap(filePath, run, prepared, lease, dependencies);
    run = ensured.run;
    const created = ensured.created;

    throwIfProvisioningAborted(signal);
    if (prepared.compositionPlan && !isCompleted(run, "composition-applied")) {
      run = await transition(filePath, run, "applying-composition", "Applying the reviewed workspace composition plan.", lease, dependencies);
      const applied = await applyWorkspaceCompositionPlan({ workspacePath: created.workspacePath, plan: prepared.compositionPlan });
      const compositionConflicts = applied.results.filter((result) => result.status === "conflict").length;
      const compositionWarnings = uniqueStrings([...prepared.compositionPlan.warnings, ...applied.warnings]);
      run = await updateStoredRun(filePath, run, {
        composition: {
          planId: prepared.compositionPlan.planId,
          status: compositionConflicts > 0 ? "partial" : prepared.compositionPlan.status,
          artifactCount: prepared.compositionPlan.artifacts.length,
          appliedCount: applied.results.filter((result) => ["created", "updated", "unchanged"].includes(result.status)).length,
          conflictCount: compositionConflicts,
          warnings: compositionWarnings.slice(0, 24)
        },
        warnings: uniqueStrings([...run.warnings, ...compositionWarnings]),
        updatedAt: dependencies.now().toISOString()
      });
      if (compositionConflicts === 0) {
        run = await completeStep(filePath, run, "composition-applied", { planId: prepared.compositionPlan.planId, artifactCount: String(prepared.compositionPlan.artifacts.length) }, lease, dependencies);
      }
    }

    throwIfProvisioningAborted(signal);
    run = await transition(filePath, run, "promoting-knowledge", "Promoting the accepted staged knowledge.", lease, dependencies);
    const knowledge = await ensureKnowledgePromotion(filePath, run, prepared, created, lease, dependencies);
    run = knowledge.run;

    throwIfProvisioningAborted(signal);
    run = await transition(filePath, run, "binding-knowledge", "Binding workspace knowledge through OpenClaw native memory.", lease, dependencies);
    const nativeBinding = await bindNativeKnowledge(created, prepared, dependencies, lease);
    run = await updateStoredRun(filePath, run, {
      nativeKnowledge: nativeBinding
        ? {
            status: normalizeNativeKnowledgeStatus(nativeBinding.status),
            indexActionRequired: nativeBinding.indexRefresh.some((entry) => entry.action === "unavailable" || entry.action === "failed")
              ? "unknown"
              : "not-required",
            restartRequired: nativeBinding.restartRequired
          }
        : { status: "not-applicable", indexActionRequired: "not-required", restartRequired: null },
      warnings: uniqueStrings([
        ...run.warnings,
        ...safeMessages(nativeBinding?.warnings ?? []),
        ...safeMessages(nativeBinding?.errors ?? [])
      ]),
      updatedAt: dependencies.now().toISOString()
    });
    if (!isCompleted(run, "knowledge-bound")) {
      run = await completeStep(filePath, run, "knowledge-bound", { status: nativeBinding?.status ?? "not-applicable" }, lease, dependencies);
    }

    throwIfProvisioningAborted(signal);
    run = await transition(filePath, run, "applying-capabilities", "Applying the selected skills and tools through the canonical AgentOS agent boundary.", lease, dependencies);
    const capabilityWarnings = await applyAgentCapabilities(created, prepared.blueprint, dependencies, lease);
    run = await updateStoredRun(filePath, run, {
      warnings: uniqueStrings([...run.warnings, ...capabilityWarnings]),
      updatedAt: dependencies.now().toISOString()
    });
    if (capabilityWarnings.length === 0) {
      run = await completeStep(filePath, run, "capabilities-applied", { agentCount: String(created.agentIds.length) }, lease, dependencies);
    }

    throwIfProvisioningAborted(signal);
    run = await transition(filePath, run, "recording-declarations", "Recording pending channel, connection, and automation setup.", lease, dependencies);
    const pendingSetup = buildPendingSetup(prepared.blueprint);
    await writeProvisioningManifest(created.workspacePath, run, prepared.blueprint, pendingSetup);
    await writeCuratedMemory(created.workspacePath, prepared.blueprint.memory.durableFacts);
    run = await updateStoredRun(filePath, run, { pendingSetup, updatedAt: dependencies.now().toISOString() });
    run = await completeStep(filePath, run, "declarations-recorded", { pendingSetup: "recorded" }, lease, dependencies);

    throwIfProvisioningAborted(signal);
    run = await transition(filePath, run, "verifying", "Verifying the physical workspace, agents, bootstrap files, and native bindings.", lease, dependencies);
    const verification = await verifyProvisionedWorkspace(created, prepared.blueprint, nativeBinding, dependencies, run);
    const warnings = uniqueStrings([...run.warnings, ...verification.warnings]);
    const finalState: WorkspaceProvisioningState = verification.coreErrors.length > 0 ? "failed" : warnings.length > 0 ? "partial" : "ready";
    const verifiedAt = dependencies.now().toISOString();
    const verificationError = verification.coreErrors.length > 0
      ? { code: "verification-failed", message: verification.coreErrors[0] }
      : null;
    const completedSteps = verification.coreErrors.length > 0
      ? run.completedSteps
      : {
          ...run.completedSteps,
          "final-verification-complete": { completedAt: verifiedAt, evidence: { state: finalState } }
        };
    const terminalRun: StoredWorkspaceProvisioningRun = {
      ...run,
      state: finalState,
      warnings,
      error: verificationError,
      completedSteps,
      verifiedAt,
      updatedAt: verifiedAt
    };
    // Keep the non-terminal state visible until the sidecar and the durable run
    // record agree. This prevents pollers from observing a false terminal state
    // while the final manifest write is still in flight.
    await lease.assertOwned();
    await writeProvisioningManifest(created.workspacePath, terminalRun, prepared.blueprint, pendingSetup);
    await lease.assertOwned();
    run = await updateStoredRun(filePath, run, {
      state: finalState,
      warnings,
      error: verificationError,
      completedSteps,
      verifiedAt,
      updatedAt: verifiedAt
    });
    if (finalState === "ready" || finalState === "partial") {
      try {
        await dependencies.persistWorkspaceIntelligenceBinding({
          actorId: prepared.actorId,
          workspaceId: created.workspaceId,
          sourceGenerationId: prepared.context?.generationId ?? prepared.expectedKnowledgeGenerationId,
          projectIntelligencePackId: prepared.intelligencePack?.id ?? prepared.context?.intelligenceSummary?.packId ?? null,
          projectIntelligenceGenerationId: prepared.intelligencePack?.provenance.generationId ?? prepared.intelligencePack?.generation?.id ?? prepared.compositionPlan?.projectIntelligenceGenerationId ?? null,
          blueprintId: prepared.blueprint.id,
          blueprintFingerprint: run.blueprintFingerprint,
          compositionPlan: prepared.compositionPlan,
          provisioningRunId: run.runId,
          status: finalState === "partial" ? "partial" : "current",
          now: verifiedAt
        });
      } catch (error) {
        const warning = "Workspace intelligence binding could not be recorded; freshness will remain unknown until the workspace is refreshed.";
        run = await updateStoredRun(filePath, run, {
          state: "partial",
          warnings: uniqueStrings([...run.warnings, warning]),
          updatedAt: dependencies.now().toISOString()
        });
        await writeProvisioningManifest(created.workspacePath, run, prepared.blueprint, pendingSetup).catch(() => undefined);
        void error;
      }
    }
    return publicRun(run);
  } catch (error) {
    if (error instanceof ProvisioningLeaseBusyError || error instanceof ProvisioningLeaseLostError) {
      return publicRun(await readStoredRunFile(filePath) ?? run);
    }
    const message = redactErrorMessage(error, "Workspace provisioning did not complete.");
    const cancelled = isAbortError(error);
    const latest = await readStoredRunFile(filePath);
    if (!latest) throw error;
    run = await updateStoredRun(filePath, latest, {
      state: cancelled ? "cancelled" : "failed",
      error: {
        code: cancelled ? "cancelled" : error instanceof WorkspaceProvisioningError ? error.code : "provisioning-failed",
        message: cancelled ? "Provisioning stopped; the workspace may be incomplete and can be resumed." : message
      },
      warnings: uniqueStrings([...latest.warnings, cancelled ? "Provisioning stopped; the workspace may be incomplete and can be resumed." : message]),
      updatedAt: dependencies.now().toISOString()
    });
    return publicRun(run);
  } finally {
    await lease?.release().catch(() => undefined);
  }
}

async function ensureWorkspaceBootstrap(
  filePath: string,
  initialRun: StoredWorkspaceProvisioningRun,
  prepared: PreparedProvisioning,
  lease: ProvisioningLeaseHandle,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  let run = initialRun;
  await lease.assertOwned();
  let created = run.result;
  let bootstrap = created ? await verifyWorkspaceBootstrap(created, prepared.blueprint) : { coreErrors: ["The workspace creation result is not available."], warnings: [] };
  let agents = created ? await verifyWorkspaceAgents(created, prepared.blueprint, dependencies) : { coreErrors: ["The workspace agent result is not available."], warnings: [] };

  if (!created || bootstrap.coreErrors.length > 0 || agents.coreErrors.length > 0) {
    if (bootstrap.coreErrors.some((message) => message.startsWith("Workspace identity conflict"))) {
      throw new WorkspaceProvisioningError("workspace-conflict", bootstrap.coreErrors[0], 409);
    }
    run = await transition(filePath, run, "materializing", "Creating or reusing the workspace through the canonical OpenClaw workspace service.", lease, dependencies);
    try {
      created = await dependencies.createWorkspaceProject(prepared.createInput, {
        onProgress: async (snapshot: OperationProgressSnapshot) => {
          await updateCanonicalOpenClawProgress(filePath, snapshot, lease, dependencies);
        }
      });
    } catch (error) {
      const gatewayKind = classifyGatewayError(redactErrorMessage(error, "OpenClaw workspace bootstrap failed."), error);
      const code = gatewayKind === "unreachable" || gatewayKind === "timeout" || gatewayKind === "auth" ? "gateway" : "bootstrap";
      throw new WorkspaceProvisioningError(code, redactErrorMessage(error, "OpenClaw workspace bootstrap failed."), code === "gateway" ? 503 : 500);
    }
    await lease.assertOwned();
    run = await updateStoredRun(filePath, run, {
      workspaceId: created.workspaceId,
      workspacePath: created.workspacePath,
      result: created,
      updatedAt: dependencies.now().toISOString()
    });
    bootstrap = await verifyWorkspaceBootstrap(created, prepared.blueprint);
    agents = await verifyWorkspaceAgents(created, prepared.blueprint, dependencies);
  }

  if (run.workspaceId !== created.workspaceId || run.workspacePath !== created.workspacePath || run.result === null) {
    await lease.assertOwned();
    run = await updateStoredRun(filePath, run, {
      workspaceId: created.workspaceId,
      workspacePath: created.workspacePath,
      result: created,
      updatedAt: dependencies.now().toISOString()
    });
  }

  if (bootstrap.coreErrors.length > 0) {
    throw new WorkspaceProvisioningError("bootstrap", bootstrap.coreErrors[0], 500);
  }
  if (agents.coreErrors.length > 0) {
    throw new WorkspaceProvisioningError("agent-provisioning", agents.coreErrors[0], 500);
  }
  run = await completeStep(filePath, run, "workspace-materialized", { workspacePath: created.workspacePath }, lease, dependencies);
  run = await completeStep(filePath, run, "bootstrap-verified", { workspacePath: created.workspacePath }, lease, dependencies);
  run = await completeStep(filePath, run, "agents-verified", { agentCount: String(created.agentIds.length) }, lease, dependencies);
  return { run, created };
}

async function verifyWorkspaceBootstrap(created: WorkspaceCreateResult, blueprint: WorkspaceBlueprint) {
  const coreErrors: string[] = [];
  await access(created.workspacePath).catch(() => coreErrors.push("The physical workspace folder is missing."));
  const manifest = await readWorkspaceProjectManifest(created.workspacePath);
  if (manifest.name && manifest.name !== blueprint.identity.name) {
    coreErrors.push(`Workspace identity conflict: the existing workspace is named ${manifest.name}.`);
  }
  if (manifest.directory && path.resolve(manifest.directory) !== path.resolve(created.workspacePath)) {
    coreErrors.push("Workspace identity conflict: the canonical manifest points to another directory.");
  }
  const rules = {
    workspaceOnly: true,
    generateStarterDocs: true,
    generateMemory: true,
    kickoffMission: false
  };
  for (const relativePath of buildWorkspaceScaffoldDocumentPaths(inferWorkspaceTemplate(blueprint.identity.projectType), rules)) {
    await access(path.join(created.workspacePath, relativePath)).catch(() => coreErrors.push(`Required bootstrap file ${relativePath} is missing.`));
  }
  return { coreErrors, warnings: [] as string[] };
}

async function verifyWorkspaceAgents(
  created: WorkspaceCreateResult,
  blueprint: WorkspaceBlueprint,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  const requiredIds = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists]
    .filter((agent) => agent.enabled)
    .map((agent) => createWorkspaceAgentId(slugify(blueprint.identity.name), agent.id));
  const manifest = await readWorkspaceProjectManifest(created.workspacePath);
  const manifestIds = new Set(manifest.agents.filter((agent) => agent.enabled).map((agent) => agent.id));
  const snapshot = await dependencies.getMissionControlSnapshot({ force: true, includeHidden: true });
  const liveIds = new Set(snapshot.agents
    .filter((agent) => agent.workspaceId === created.workspaceId || path.resolve(agent.workspacePath) === path.resolve(created.workspacePath))
    .map((agent) => agent.id));
  const coreErrors = requiredIds
    .filter((agentId) => !created.agentIds.includes(agentId) || !manifestIds.has(agentId) || !liveIds.has(agentId))
    .map((agentId) => `Required workspace agent ${agentId} was not verified.`);
  return { coreErrors, warnings: [] as string[] };
}

async function updateCanonicalOpenClawProgress(
  filePath: string,
  snapshot: OperationProgressSnapshot,
  lease: ProvisioningLeaseHandle,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  await lease.assertOwned();
  const active = snapshot.steps.find((step) => step.status === "active") ?? snapshot.steps.find((step) => step.status === "done");
  if (!active) return;
  const state = mapOpenClawProgressState(active.id);
  const run = await readStoredRunFile(filePath);
  if (!run || isTerminal(run.state)) return;
  await updateStoredRun(filePath, run, {
    state,
    progress: {
      label: openClawProgressLabel(active.id),
      detail: active.detail ?? active.description
    },
    updatedAt: dependencies.now().toISOString()
  });
}

async function ensureKnowledgePromotion(
  filePath: string,
  initialRun: StoredWorkspaceProvisioningRun,
  prepared: PreparedProvisioning,
  created: WorkspaceCreateResult,
  lease: ProvisioningLeaseHandle,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  let run = initialRun;
  const sourceIds = [...prepared.blueprint.knowledge.sourceIds];
  if (sourceIds.length === 0) {
    if (!run.knowledge || run.knowledge.sourceIds.length > 0) {
      await lease.assertOwned();
      run = await updateStoredRun(filePath, run, {
        knowledge: {
          stagedGenerationId: prepared.expectedKnowledgeGenerationId,
          promotedGenerationId: null,
          sourceIds: [],
          documentCount: 0
        },
        updatedAt: dependencies.now().toISOString()
      });
    }
    if (!isCompleted(run, "knowledge-promoted")) {
      run = await completeStep(filePath, run, "knowledge-promoted", { sourceCount: "0", documentCount: "0" }, lease, dependencies);
    }
    return { run };
  }

  const targetSnapshot = await dependencies.readKnowledgeSnapshot(
    path.join(created.workspacePath, "knowledge"),
    path.join(created.workspacePath, ".openclaw", "knowledge")
  );
  if (run.knowledge?.promotedGenerationId && targetSnapshot?.state.generationId === run.knowledge.promotedGenerationId) {
    if (!isCompleted(run, "knowledge-promoted")) {
      run = await completeStep(filePath, run, "knowledge-promoted", {
        generationId: run.knowledge.promotedGenerationId,
        documentCount: String(run.knowledge.documentCount)
      }, lease, dependencies);
    }
    return { run };
  }

  const expectedGenerationId = prepared.context?.generationId ?? run.expectedKnowledgeGenerationId;
  if (prepared.context && targetSnapshot && finalKnowledgeMatchesContext(targetSnapshot, sourceIds)) {
    const promoted = {
      stagedGenerationId: expectedGenerationId,
      promotedGenerationId: targetSnapshot.state.generationId ?? null,
      sourceIds,
      documentCount: targetSnapshot.documents.length
    };
    if (!promoted.promotedGenerationId) {
      throw new WorkspaceProvisioningError("knowledge-promotion", "The promoted workspace knowledge generation could not be verified.", 500);
    }
    await lease.assertOwned();
    run = await updateStoredRun(filePath, run, { knowledge: promoted, updatedAt: dependencies.now().toISOString() });
    run = await completeStep(filePath, run, "knowledge-promoted", {
      generationId: promoted.promotedGenerationId,
      documentCount: String(promoted.documentCount)
    }, lease, dependencies);
    return { run };
  }

  if (!prepared.draftContextId || !expectedGenerationId) {
    throw new WorkspaceProvisioningError("knowledge-context-missing", "The staged project context is required to promote this workspace knowledge.", 409);
  }

  let promoted: Awaited<ReturnType<typeof promoteWorkspaceCreationKnowledge>>;
  try {
    promoted = await dependencies.promoteWorkspaceCreationKnowledge({
      actorId: prepared.actorId,
      draftContextId: prepared.draftContextId,
      targetWorkspacePath: created.workspacePath,
      expectedGenerationId
    });
  } catch (error) {
    throw new WorkspaceProvisioningError(
      "knowledge-promotion",
      redactErrorMessage(error, "The staged project knowledge could not be promoted."),
      500
    );
  }
  if (!promoted.generationId) {
    throw new WorkspaceProvisioningError("knowledge-promotion", "The promoted workspace knowledge generation could not be verified.", 500);
  }
  await lease.assertOwned();
  run = await updateStoredRun(filePath, run, {
    knowledge: {
      stagedGenerationId: promoted.stagedGenerationId,
      promotedGenerationId: promoted.generationId,
      sourceIds: promoted.sourceIds,
      documentCount: promoted.documentCount
    },
    updatedAt: dependencies.now().toISOString()
  });
  run = await completeStep(filePath, run, "knowledge-promoted", {
    generationId: promoted.generationId,
    documentCount: String(promoted.documentCount)
  }, lease, dependencies);
  return { run };
}

function finalKnowledgeMatchesContext(snapshot: Awaited<ReturnType<typeof readKnowledgeSnapshot>>, sourceIds: string[]) {
  if (!snapshot?.state.generationId) return false;
  const reportedSourceIds = snapshot.state.sourceReports.map((report) => report.sourceId).sort();
  return reportedSourceIds.length === sourceIds.length
    && reportedSourceIds.every((sourceId, index) => sourceId === [...sourceIds].sort()[index]);
}

function mapOpenClawProgressState(stepId: string): WorkspaceProvisioningState {
  if (stepId === "validate") return "validating";
  if (stepId === "source") return "materializing";
  if (stepId === "scaffold") return "bootstrapping";
  if (stepId === "agents") return "provisioning-agents";
  return "bootstrapping";
}

function openClawProgressLabel(stepId: string) {
  if (stepId === "validate") return "Preparing workspace";
  if (stepId === "source") return "Preparing workspace source";
  if (stepId === "scaffold") return "Writing workspace bootstrap";
  if (stepId === "agents") return "Creating workspace agents";
  return "Preparing workspace";
}

async function bindNativeKnowledge(
  created: WorkspaceCreateResult,
  prepared: PreparedProvisioning,
  dependencies: ResolvedWorkspaceProvisioningDependencies,
  lease: ProvisioningLeaseHandle
): Promise<WorkspaceNativeKnowledgeBindingResult | null> {
  if (prepared.blueprint.knowledge.sourceIds.length === 0) return null;
  await lease.assertOwned();
  return dependencies.ensureWorkspaceNativeKnowledge({
    workspacePath: created.workspacePath,
    agentIds: created.agentIds
  });
}

async function applyAgentCapabilities(
  created: WorkspaceCreateResult,
  blueprint: WorkspaceBlueprint,
  dependencies: ResolvedWorkspaceProvisioningDependencies,
  lease: ProvisioningLeaseHandle
) {
  await lease.assertOwned();
  const snapshot = await dependencies.getMissionControlSnapshot({ force: true, includeHidden: true });
  const warnings: string[] = [];
  const desiredAgents = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists];
  for (const desired of desiredAgents) {
    const agentId = createWorkspaceAgentId(slugify(blueprint.identity.name), desired.id);
    if (!created.agentIds.includes(agentId)) {
      warnings.push(`Selected agent ${desired.id} was not found after workspace bootstrap.`);
      continue;
    }
    const current = snapshot.agents.find((agent) => agent.id === agentId);
    if (!current) {
      warnings.push(`Selected agent ${desired.id} was not visible in the current OpenClaw snapshot.`);
      continue;
    }
    const skills = filterKnownOpenClawSkillIds(desired.skillIds);
    const tools = filterKnownOpenClawToolIds(desired.toolIds);
    if (
      sameStringArray(current.skills, skills)
      && sameStringArray(current.tools, tools)
      && current.name === desired.name
      && stableStringify(current.policy) === stableStringify(desired.policy)
    ) {
      continue;
    }
    try {
      await lease.assertOwned();
      await dependencies.updateAgent({
        id: agentId,
        workspaceId: created.workspaceId,
        workspacePath: created.workspacePath,
        skills,
        tools,
        policy: desired.policy,
        name: desired.name
      });
    } catch (error) {
      warnings.push(`${desired.name}: ${redactErrorMessage(error, "Selected capabilities could not be applied.")}`);
    }
  }
  return warnings;
}

async function verifyProvisionedWorkspace(
  created: WorkspaceCreateResult,
  blueprint: WorkspaceBlueprint,
  nativeBinding: WorkspaceNativeKnowledgeBindingResult | null,
  dependencies: ResolvedWorkspaceProvisioningDependencies,
  run: StoredWorkspaceProvisioningRun
) {
  const warnings: string[] = [];
  const coreErrors: string[] = [];
  await access(created.workspacePath).catch(() => coreErrors.push("The physical workspace folder is missing."));

  const rules = {
    workspaceOnly: true,
    generateStarterDocs: true,
    generateMemory: true,
    kickoffMission: false
  };
  for (const relativePath of buildWorkspaceScaffoldDocumentPaths(inferWorkspaceTemplate(blueprint.identity.projectType), rules)) {
    await access(path.join(created.workspacePath, relativePath)).catch(() => coreErrors.push(`Required bootstrap file ${relativePath} is missing.`));
  }

  const manifest = await readWorkspaceProjectManifest(created.workspacePath);
  await access(path.join(created.workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH)).catch(() => coreErrors.push("The AgentOS provisioning manifest is missing."));
  const requiredIds = [blueprint.workforce.primaryAgent, ...blueprint.workforce.specialists]
    .filter((agent) => agent.enabled)
    .map((agent) => createWorkspaceAgentId(slugify(blueprint.identity.name), agent.id));
  const manifestIds = new Set(manifest.agents.filter((agent) => agent.enabled).map((agent) => agent.id));
  const snapshot = await dependencies.getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === created.workspaceId || path.resolve(entry.path) === path.resolve(created.workspacePath));
  if (!workspace) coreErrors.push("The workspace was not present in the authoritative OpenClaw snapshot.");
  const liveIds = new Set(snapshot.agents.filter((agent) => agent.workspaceId === created.workspaceId || path.resolve(agent.workspacePath) === path.resolve(created.workspacePath)).map((agent) => agent.id));
  for (const agentId of requiredIds) {
    if (!manifestIds.has(agentId) || !liveIds.has(agentId)) coreErrors.push(`Required workspace agent ${agentId} was not verified.`);
  }

  if (blueprint.knowledge.sourceIds.length > 0 && !nativeBinding) {
    warnings.push("Knowledge sources were declared but no staged corpus generation was available to promote.");
  }
  if (nativeBinding?.status === "failed" || nativeBinding?.status === "partial" || nativeBinding?.status === "pending") {
    warnings.push("Native workspace knowledge binding is not fully active yet.");
  }
  if (nativeBinding?.indexRefresh.some((entry) => entry.action === "unavailable" || entry.action === "failed")) {
    warnings.push("Native memory index maintenance is deferred or unavailable from this AgentOS runtime.");
  }

  const provisioningManifestPath = path.join(created.workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH);
  const provisioningManifest = await readFile(provisioningManifestPath, "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => null);
  const recorded = isRecord(provisioningManifest) && isRecord(provisioningManifest.agentosProvisioning)
    ? provisioningManifest.agentosProvisioning
    : null;
  if (!recorded || recorded.runId !== run.runId || recorded.blueprintFingerprint !== run.blueprintFingerprint) {
    coreErrors.push("The AgentOS provisioning manifest does not match the durable provisioning run.");
  }

  return { warnings, coreErrors };
}

function buildPendingSetup(blueprint: WorkspaceBlueprint) {
  return {
    channels: blueprint.operations.channels.filter((channel) => channel.enabled).map((channel) => `${channel.type}:${channel.id}`),
    connections: blueprint.connections.map((connection) => `${connection.provider}:${connection.id}`),
    automations: blueprint.operations.automations.filter((automation) => automation.enabled).map((automation) => automation.id)
  };
}

async function writeProvisioningManifest(
  workspacePath: string,
  run: StoredWorkspaceProvisioningRun,
  blueprint: WorkspaceBlueprint,
  pendingSetup: StoredWorkspaceProvisioningRun["pendingSetup"]
) {
  const manifestPath = path.join(workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH);
  await writeAtomicJson(manifestPath, {
    manifestVersion: 1,
    agentosProvisioning: {
      manifestVersion: 1,
      runId: run.runId,
      state: run.state,
      blueprintId: blueprint.id,
      blueprintSchemaVersion: blueprint.schemaVersion,
      blueprintFingerprint: run.blueprintFingerprint,
      architectRunId: blueprint.provenance.architectRunId,
      knowledgeGenerationId: blueprint.provenance.knowledgeGenerationId,
      promotedKnowledgeGenerationId: run.knowledge?.promotedGenerationId ?? null,
      knowledgeSourceIds: blueprint.knowledge.sourceIds,
      agentIds: run.result?.agentIds ?? [],
      primaryAgentId: run.result?.primaryAgentId ?? null,
      pendingSetup,
      composition: run.composition,
      verifiedAt: run.verifiedAt
    }
  });
}

function normalizeNativeKnowledgeStatus(status: WorkspaceNativeKnowledgeBindingResult["status"]): WorkspaceNativeKnowledgeStatus["status"] {
  if (status === "applied" || status === "unchanged") return "configured";
  if (status === "not-applicable") return "not-applicable";
  if (status === "failed") return "degraded";
  return "unknown";
}

async function writeCuratedMemory(workspacePath: string, durableFacts: string[]) {
  if (durableFacts.length === 0) return;
  const memoryPath = path.join(workspacePath, "MEMORY.md");
  const current = await readFile(memoryPath, "utf8").catch(() => "# Workspace Memory\n");
  const marker = "\n## AgentOS-approved durable facts\n";
  const base = current.split(marker)[0].trimEnd();
  const next = `${base}${marker}${durableFacts.map((fact) => `- ${redactSecretText(fact).slice(0, 300)}`).join("\n")}\n`;
  if (next !== current) await writeTextFileEnsured(memoryPath, next);
}

async function validateMaterializationTarget(materialization: ReturnType<typeof normalizeWorkspaceMaterialization>) {
  if (materialization.mode !== "existing") return;
  const root = path.resolve(await getConfiguredWorkspaceRoot() ?? DEFAULT_WORKSPACE_ROOT);
  const target = path.resolve(materialization.existingPath);
  if (!isWithin(root, target) || target === path.resolve(missionControlRootPath) || isWithin(path.resolve(missionControlRootPath), target)) {
    throw new WorkspaceProvisioningError("unsafe-materialization-target", "Existing workspaces must be inside the configured workspace root.");
  }
}

function validateCloneUrl(repoUrl: string) {
  if (!/^((https?|ssh|git):\/\/[^\s]+|git@[^:\s]+:[^\s]+)$/i.test(repoUrl.trim())) {
    throw new WorkspaceProvisioningError("unsafe-repository-url", "The selected repository URL is not supported for workspace materialization.");
  }
}

function validateKnowledgeFreshness(blueprint: WorkspaceBlueprint, context: WorkspaceCreationContextResult | null) {
  if (blueprint.knowledge.sourceIds.length === 0) {
    if (blueprint.provenance.knowledgeGenerationId) {
      throw new WorkspaceProvisioningError("knowledge-context-missing", "The blueprint references knowledge that is no longer available.", 409);
    }
    return;
  }
  if (!context) throw new WorkspaceProvisioningError("knowledge-context-missing", "The staged project context is required to provision this blueprint.", 409);
  const freshness = getWorkspaceBlueprintFreshness(blueprint, context.generationId);
  const emptyFailedContext = !context.generationId && (context.knowledge.documents ?? []).length === 0 && (context.knowledge.sources ?? []).length > 0;
  if (freshness.status === "stale" || (freshness.status === "unknown" && !emptyFailedContext)) {
    throw new WorkspaceProvisioningError("blueprint-stale", "The workspace blueprint is not fresh against the staged project context.", 409);
  }
}

function assertCompleteBlueprint(value: unknown): asserts value is WorkspaceBlueprint {
  if (!isRecord(value)) throw new WorkspaceProvisioningError("blueprint-invalid", "The workspace blueprint is invalid.");
  const required = ["createdAt", "updatedAt", "operatorConstraints", "capabilities", "memory", "connections", "operations", "recommendations", "assumptions", "warnings", "evidence", "operatorOverrides"];
  if (required.some((key) => !(key in value))) {
    throw new WorkspaceProvisioningError("blueprint-invalid", "The workspace blueprint is incomplete.");
  }
}

function inferWorkspaceTemplate(projectType: string): WorkspaceTemplate {
  if (/frontend|backend|research|content|support/i.test(projectType)) {
    if (/frontend/i.test(projectType)) return "frontend";
    if (/backend/i.test(projectType)) return "backend";
    if (/research/i.test(projectType)) return "research";
    if (/content|support/i.test(projectType)) return "content";
  }
  return "software";
}

function formatValidationIssues(issues: Array<{ path: string; message: string; severity: string }>) {
  const first = issues.find((issue) => issue.severity === "error") ?? issues[0];
  return first ? `Blueprint validation failed at ${first.path}: ${first.message}` : "The workspace blueprint is invalid.";
}

function publicRun(run: StoredWorkspaceProvisioningRun): WorkspaceProvisioningRun {
  return {
    runId: run.runId,
    state: run.state,
    blueprintId: run.blueprintId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    attempt: run.attempt,
    blueprintFingerprint: run.blueprintFingerprint,
    workspaceId: run.workspaceId,
    result: run.result,
    warnings: run.warnings.slice(0, 24),
    error: run.error,
    progress: run.progress,
    steps: buildSteps(run.state, run.completedSteps),
    signals: buildSignals(run),
    completedSteps: run.completedSteps,
    knowledge: run.knowledge,
    nativeKnowledge: run.nativeKnowledge,
    composition: run.composition,
    pendingSetup: run.pendingSetup,
    verifiedAt: run.verifiedAt
  };
}

const completedStepForState: Record<WorkspaceProvisioningState, ProvisioningCompletedStepId | null> = {
  pending: null,
  validating: "validated",
  materializing: "workspace-materialized",
  bootstrapping: "bootstrap-verified",
  "applying-composition": "composition-applied",
  "promoting-knowledge": "knowledge-promoted",
  "provisioning-agents": "agents-verified",
  "binding-knowledge": "knowledge-bound",
  "applying-capabilities": "capabilities-applied",
  "recording-declarations": "declarations-recorded",
  verifying: "final-verification-complete",
  ready: null,
  partial: null,
  failed: null,
  cancelled: null
};

function buildSteps(state: WorkspaceProvisioningState, completedSteps: StoredWorkspaceProvisioningRun["completedSteps"]) {
  const index = PROVISIONING_STEP_ORDER.indexOf(state);
  return PROVISIONING_STEP_ORDER.map((id, position) => ({
    id,
    label: provisioningLabel(id),
    status: completedStepForState[id] && completedSteps[completedStepForState[id]]
      ? "complete" as const
      : state === "failed" && position >= Math.max(index, 0)
        ? "failed" as const
        : position === index
          ? "active" as const
          : "pending" as const
  }));
}

function buildSignals(run: StoredWorkspaceProvisioningRun) {
  const signals = [
    run.workspaceId ? "Workspace folder" : null,
    run.result?.primaryAgentId ? "Primary agent" : null,
    run.result && run.result.agentIds.length > 1 ? `${run.result.agentIds.length - 1} specialist${run.result.agentIds.length === 2 ? "" : "s"}` : null,
    run.knowledge?.sourceIds.length ? `${run.knowledge.sourceIds.length} knowledge source${run.knowledge.sourceIds.length === 1 ? "" : "s"}` : null,
    run.knowledge?.documentCount ? `${run.knowledge.documentCount} document${run.knowledge.documentCount === 1 ? "" : "s"} promoted` : null,
    run.nativeKnowledge?.status === "configured" ? "Native memory bound" : run.nativeKnowledge?.status === "unknown" ? "Native memory needs verification" : null,
    run.composition?.status === "fallback" ? "Workspace documents use a safe fallback" : run.composition?.status === "partial" ? "Workspace documents are partial" : run.composition?.conflictCount ? "Workspace document conflict needs review" : null,
    run.pendingSetup.connections.length ? `${run.pendingSetup.connections.length} connection setup pending` : null,
    run.pendingSetup.channels.length ? `${run.pendingSetup.channels.length} channel setup pending` : null,
    run.pendingSetup.automations.length ? `${run.pendingSetup.automations.length} automation setup pending` : null
  ];
  return signals.filter((signal): signal is string => Boolean(signal));
}

function provisioningLabel(state: WorkspaceProvisioningState) {
  const labels: Record<string, string> = {
    validating: "Validating blueprint",
    materializing: "Creating workspace folder",
    bootstrapping: "Writing workspace bootstrap",
    "applying-composition": "Applying workspace documents",
    "promoting-knowledge": "Promoting project knowledge",
    "provisioning-agents": "Provisioning selected agents",
    "binding-knowledge": "Binding native memory",
    "applying-capabilities": "Applying skills and tools",
    "recording-declarations": "Recording setup declarations",
    verifying: "Verifying workspace",
    ready: "Workspace ready",
    partial: "Workspace ready with setup pending",
    failed: "Workspace provisioning needs attention"
  };
  return labels[state] ?? "Preparing workspace";
}

function isTerminal(state: WorkspaceProvisioningState) {
  return state === "ready" || state === "partial" || state === "failed" || state === "cancelled";
}

async function transition(
  filePath: string,
  run: StoredWorkspaceProvisioningRun,
  state: WorkspaceProvisioningState,
  detail: string,
  lease: ProvisioningLeaseHandle,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  await lease.assertOwned();
  return updateStoredRun(filePath, run, {
    state,
    progress: { label: provisioningLabel(state), detail },
    updatedAt: dependencies.now().toISOString()
  });
}

async function completeStep(
  filePath: string,
  run: StoredWorkspaceProvisioningRun,
  stepId: ProvisioningCompletedStepId,
  evidence: Record<string, string>,
  lease: ProvisioningLeaseHandle,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  if (isCompleted(run, stepId)) return run;
  await lease.assertOwned();
  const completedAt = dependencies.now().toISOString();
  return updateStoredRun(filePath, run, {
    completedSteps: {
      ...run.completedSteps,
      [stepId]: { completedAt, evidence }
    },
    updatedAt: completedAt
  });
}

function isCompleted(run: StoredWorkspaceProvisioningRun, stepId: ProvisioningCompletedStepId) {
  return Boolean(run.completedSteps[stepId]);
}

function assertStoredRunIntegrity(run: StoredWorkspaceProvisioningRun): asserts run is StoredWorkspaceProvisioningRun & { blueprint: WorkspaceBlueprint } {
  const blueprint = isRecord(run.blueprint) ? run.blueprint as unknown as WorkspaceBlueprint : null;
  if (
    !isProvisioningState(run.state)
    || !blueprint
    || run.blueprintId !== blueprint.id
    || !isRecord(run.completedSteps)
    || !Array.isArray(run.warnings)
    || !isRecord(run.pendingSetup)
    || !Array.isArray(run.pendingSetup.channels)
    || !Array.isArray(run.pendingSetup.connections)
    || !Array.isArray(run.pendingSetup.automations)
    || (run.compositionPlan !== undefined && run.compositionPlan !== null && !validateWorkspaceCompositionPlan(run.compositionPlan))
    || (run.compositionPlan !== undefined && run.compositionPlan !== null && (
      run.compositionPlan.workspaceBlueprintId !== run.blueprintId
      || run.compositionPlan.workspaceBlueprintFingerprint !== createWorkspaceCompositionBlueprintFingerprint(blueprint)
      || run.compositionPlan.materializationMode !== blueprint.materialization.mode
    ))
    || (run.composition !== null && !validateStoredCompositionSummary(run.composition))
  ) {
    throw new WorkspaceProvisioningError("provisioning-state-integrity-failed", "The durable provisioning record is invalid and cannot be resumed.", 500);
  }
  const validation = validateWorkspaceBlueprint(blueprint);
  if (!validation.valid || run.blueprintFingerprint !== fingerprintBlueprint(blueprint)) {
    throw new WorkspaceProvisioningError("provisioning-state-integrity-failed", "The durable provisioning record is invalid and cannot be resumed.", 500);
  }
}

function validateStoredCompositionSummary(value: unknown): value is NonNullable<StoredWorkspaceProvisioningRun["composition"]> {
  if (!isRecord(value)) return false;
  const keys = ["planId", "status", "artifactCount", "appliedCount", "conflictCount", "warnings"];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  return typeof value.planId === "string"
    && ["ready", "partial", "fallback", "blocked"].includes(value.status as string)
    && ["artifactCount", "appliedCount", "conflictCount"].every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function isProvisioningState(value: unknown): value is WorkspaceProvisioningState {
  return typeof value === "string" && (workspaceProvisioningStates as readonly string[]).includes(value);
}

function fingerprintBlueprint(blueprint: WorkspaceBlueprint) {
  return sha256(stableStringify(blueprint));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function recoverUnexpectedProvisioningFailure(
  filePath: string,
  error: unknown,
  dependencies: ResolvedWorkspaceProvisioningDependencies
) {
  if (error instanceof ProvisioningLeaseBusyError || error instanceof ProvisioningLeaseLostError) {
    const latest = await readStoredRunFile(filePath);
    return latest ? publicRun(latest) : Promise.reject(error);
  }
  const run = await readStoredRunFile(filePath);
  if (!run) throw error;
  const message = redactErrorMessage(error, "Workspace provisioning did not complete.");
  const failed = await updateStoredRun(filePath, run, {
    state: "failed",
    error: { code: "provisioning-failed", message },
    warnings: uniqueStrings([...run.warnings, message]),
    updatedAt: dependencies.now().toISOString()
  });
  return publicRun(failed);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwIfProvisioningAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("Workspace provisioning was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function safeMessages(values: readonly string[]) {
  return values.map((value) => redactErrorMessage(new Error(value), "OpenClaw operation reported a warning."));
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[]) {
  return Boolean(left) && (left ?? []).length === right.length && (left ?? []).every((value, index) => value === right[index]);
}
