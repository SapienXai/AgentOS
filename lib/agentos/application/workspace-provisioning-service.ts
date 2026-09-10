import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getWorkspaceBlueprintFreshness,
  validateWorkspaceBlueprint
} from "@/lib/agentos/application/workspace-architect";
import {
  promoteWorkspaceCreationKnowledge,
  readWorkspaceCreationContext,
  type WorkspaceCreationContextResult
} from "@/lib/agentos/application/workspace-creation-context-service";
import {
  ensureWorkspaceNativeKnowledge,
  type WorkspaceNativeKnowledgeBindingResult,
  type WorkspaceNativeKnowledgeStatus
} from "@/lib/agentos/application/workspace-native-knowledge-service";
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
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import type {
  WorkspaceCreateResult,
  WorkspaceTemplate
} from "@/lib/openclaw/types";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

export const WORKSPACE_PROVISIONING_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_PROVISIONING_ROOT = path.join(missionControlRootPath, "workspace-provisioning-runs");
export const WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH = ".openclaw/agentos-provisioning.json";

const RUN_ID_PATTERN = /^[a-f0-9-]{36}$/i;
const LOCK_STALE_AFTER_MS = 30 * 60 * 1_000;
const POLL_INTERVAL_MS = 100;
const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), "Documents", "Shared", "projects");

export const workspaceProvisioningStates = [
  "pending",
  "validating",
  "materializing",
  "bootstrapping",
  "promoting-knowledge",
  "provisioning-agents",
  "binding-knowledge",
  "applying-capabilities",
  "recording-declarations",
  "verifying",
  "ready",
  "partial",
  "failed",
  "cancelled"
] as const;

export type WorkspaceProvisioningState = (typeof workspaceProvisioningStates)[number];

type ProvisioningCheckpoint = {
  state: WorkspaceProvisioningState;
  completedAt: string;
};

type ProvisioningError = {
  code: string;
  message: string;
};

type StoredWorkspaceProvisioningRun = {
  schemaVersion: typeof WORKSPACE_PROVISIONING_SCHEMA_VERSION;
  runId: string;
  actorHash: string;
  idempotencyKeyHash: string;
  blueprintId: string;
  blueprintFingerprint: string;
  draftContextId: string | null;
  expectedKnowledgeGenerationId: string | null;
  state: WorkspaceProvisioningState;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  workspaceId: string | null;
  workspacePath: string | null;
  result: WorkspaceCreateResult | null;
  checkpoints: Partial<Record<WorkspaceProvisioningState, ProvisioningCheckpoint>>;
  warnings: string[];
  error: ProvisioningError | null;
  progress: {
    label: string;
    detail: string;
  } | null;
  knowledge: {
    stagedGenerationId: string | null;
    promotedGenerationId: string | null;
    sourceIds: string[];
    documentCount: number;
  } | null;
  nativeKnowledge: {
    status: WorkspaceNativeKnowledgeStatus["status"];
    indexActionRequired: WorkspaceNativeKnowledgeStatus["indexActionRequired"];
    restartRequired: boolean | null;
  } | null;
  pendingSetup: {
    channels: string[];
    connections: string[];
    automations: string[];
  };
  verifiedAt: string | null;
};

export type WorkspaceProvisioningRun = {
  runId: string;
  state: WorkspaceProvisioningState;
  blueprintId: string;
  createdAt: string;
  updatedAt: string;
  attempt: number;
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
  knowledge: StoredWorkspaceProvisioningRun["knowledge"];
  nativeKnowledge: StoredWorkspaceProvisioningRun["nativeKnowledge"];
  pendingSetup: StoredWorkspaceProvisioningRun["pendingSetup"];
  verifiedAt: string | null;
};

export type ProvisionWorkspaceFromBlueprintInput = {
  actorId: string;
  blueprint: unknown;
  draftContextId?: string | null;
  expectedKnowledgeGenerationId?: string | null;
  idempotencyKey: string;
  acceptDraft?: boolean;
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
  createInput: Parameters<typeof createWorkspaceProject>[0];
};

const inFlight = new Map<string, Promise<WorkspaceProvisioningRun>>();

export async function startWorkspaceProvisioning(
  input: ProvisionWorkspaceFromBlueprintInput
): Promise<WorkspaceProvisioningRun> {
  const prepared = await prepareProvisioning(input);
  const key = runKey(prepared.actorId, input.idempotencyKey);
  let run = await readStoredRun(key);

  if (run && run.blueprintFingerprint !== prepared.blueprintFingerprint) {
    throw new WorkspaceProvisioningError(
      "idempotency-conflict",
      "This idempotency key is already associated with a different workspace blueprint.",
      409
    );
  }

  if (!run) {
    run = await createRunAtomically(key, {
      actorId: prepared.actorId,
      blueprint: prepared.blueprint,
      blueprintFingerprint: prepared.blueprintFingerprint,
      draftContextId: prepared.draftContextId,
      expectedKnowledgeGenerationId: prepared.expectedKnowledgeGenerationId
    });
  } else if (isTerminal(run.state) && run.state !== "ready") {
    run = await updateStoredRun(key, run, {
      state: "pending",
      error: null,
      progress: null,
      attempt: run.attempt + 1,
      updatedAt: new Date().toISOString()
    });
  }

  const existing = inFlight.get(key);
  if (!existing && !isTerminal(run.state)) {
    const execution = executeWorkspaceProvisioning(key, prepared, input.signal)
      .catch((error) => recoverUnexpectedProvisioningFailure(key, error))
      .finally(() => {
        if (inFlight.get(key) === execution) inFlight.delete(key);
      });
    inFlight.set(key, execution);
  }

  const active = inFlight.get(key);
  if (active && run.state !== "ready" && run.state !== "partial" && run.state !== "failed" && run.state !== "cancelled") {
    return publicRun(await readStoredRun(key) ?? run);
  }
  return publicRun(await readStoredRun(key) ?? run);
}

export async function provisionWorkspaceFromBlueprint(
  input: ProvisionWorkspaceFromBlueprintInput
): Promise<WorkspaceProvisioningRun> {
  return startWorkspaceProvisioning(input);
}

export async function waitForWorkspaceProvisioning(
  input: ProvisionWorkspaceFromBlueprintInput
): Promise<WorkspaceProvisioningRun> {
  const key = runKey(input.actorId, input.idempotencyKey);
  await startWorkspaceProvisioning(input);

  for (;;) {
    const run = await readStoredRun(key);
    if (!run) throw new WorkspaceProvisioningError("run-unavailable", "Workspace provisioning run is unavailable.", 500);
    if (isTerminal(run.state)) return publicRun(run);
    await delay(POLL_INTERVAL_MS);
  }
}

export async function getWorkspaceProvisioningRun(input: {
  actorId: string;
  runId: string;
}): Promise<WorkspaceProvisioningRun | null> {
  const runId = input.runId.trim();
  if (!RUN_ID_PATTERN.test(runId)) return null;
  const expectedActorHash = actorHash(input.actorId);
  const files = await readdir(WORKSPACE_PROVISIONING_ROOT).catch(() => []);
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const run = await readStoredRunFile(path.join(WORKSPACE_PROVISIONING_ROOT, fileName));
    if (run?.actorHash === expectedActorHash && run.runId === runId) return publicRun(run);
  }
  return null;
}

async function prepareProvisioning(input: ProvisionWorkspaceFromBlueprintInput): Promise<PreparedProvisioning> {
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
  const context = draftContextId
    ? await readWorkspaceCreationContext({ actorId, draftContextId })
    : null;
  const expectedKnowledgeGenerationId = input.expectedKnowledgeGenerationId?.trim() || null;
  if (expectedKnowledgeGenerationId !== (context?.generationId ?? null)) {
    throw new WorkspaceProvisioningError("knowledge-generation-mismatch", "The staged project context changed; review the blueprint again.", 409);
  }
  validateKnowledgeFreshness(blueprint, context);

  const blueprintFingerprint = fingerprintBlueprint(blueprint);
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

async function executeWorkspaceProvisioning(key: string, prepared: PreparedProvisioning, signal?: AbortSignal): Promise<WorkspaceProvisioningRun> {
  return withDurableRunLock(key, async () => {
    let run = await readStoredRun(key);
    if (!run) throw new WorkspaceProvisioningError("run-unavailable", "Workspace provisioning run is unavailable.", 500);
    if (run.state === "ready") return publicRun(run);

    try {
      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "validating", "Validating the blueprint and staged project context.");
      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "materializing", "Creating the workspace folder through the canonical OpenClaw workspace service.");
      const created = await createWorkspaceProject(prepared.createInput, {
        onProgress: async () => {
          await updateProgress(key, "Creating the workspace", "OpenClaw is materializing the selected workspace and bootstrap files.");
        }
      });
      throwIfProvisioningAborted(signal);
      run = await updateStoredRun(key, run, {
        workspaceId: created.workspaceId,
        workspacePath: created.workspacePath,
        result: created,
        updatedAt: new Date().toISOString()
      });
      run = await transition(key, run, "bootstrapping", "Verifying the canonical AgentOS/OpenClaw workspace bootstrap.");

      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "promoting-knowledge", "Promoting the accepted staged knowledge generation.");
      if (!run.knowledge && prepared.context?.generationId && prepared.draftContextId) {
        const promoted = await promoteWorkspaceCreationKnowledge({
          actorId: prepared.actorId,
          draftContextId: prepared.draftContextId,
          targetWorkspacePath: created.workspacePath,
          expectedGenerationId: prepared.context.generationId
        });
        run = await updateStoredRun(key, run, {
          knowledge: {
            stagedGenerationId: promoted.stagedGenerationId,
            promotedGenerationId: promoted.generationId,
            sourceIds: promoted.sourceIds,
            documentCount: promoted.documentCount
          },
          updatedAt: new Date().toISOString()
        });
      } else if (!run.knowledge) {
        run = await updateStoredRun(key, run, {
          knowledge: {
            stagedGenerationId: null,
            promotedGenerationId: null,
            sourceIds: prepared.blueprint.knowledge.sourceIds,
            documentCount: 0
          },
          updatedAt: new Date().toISOString()
        });
      }

      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "provisioning-agents", "Confirming the primary agent and selected specialists.");
      run = await transition(key, run, "binding-knowledge", "Binding workspace knowledge through OpenClaw native memory.");
      const nativeBinding = await bindNativeKnowledge(created, prepared);
      run = await updateStoredRun(key, run, {
        nativeKnowledge: nativeBinding
          ? {
              status: normalizeNativeKnowledgeStatus(nativeBinding.status),
              indexActionRequired: nativeBinding.indexRefresh.some((entry) => entry.action === "unavailable" || entry.action === "failed")
                ? "unknown"
                : "not-required",
              restartRequired: nativeBinding.restartRequired
            }
          : { status: "not-applicable", indexActionRequired: "not-required", restartRequired: null },
        warnings: uniqueStrings([...run.warnings, ...(nativeBinding?.warnings ?? []), ...(nativeBinding?.errors ?? [])]),
        updatedAt: new Date().toISOString()
      });

      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "applying-capabilities", "Applying the selected skills and tools through the canonical AgentOS agent boundary.");
      const capabilityWarnings = await applyAgentCapabilities(created, prepared.blueprint);
      run = await updateStoredRun(key, run, {
        warnings: uniqueStrings([...run.warnings, ...capabilityWarnings]),
        updatedAt: new Date().toISOString()
      });

      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "recording-declarations", "Recording pending channel, connection, and automation setup.");
      const pendingSetup = buildPendingSetup(prepared.blueprint);
      await writeProvisioningManifest(created.workspacePath, run, prepared.blueprint, pendingSetup);
      await writeCuratedMemory(created.workspacePath, prepared.blueprint.memory.durableFacts);
      run = await updateStoredRun(key, run, { pendingSetup, updatedAt: new Date().toISOString() });

      throwIfProvisioningAborted(signal);
      run = await transition(key, run, "verifying", "Verifying the physical workspace, agents, bootstrap files, and native bindings.");
      const verification = await verifyProvisionedWorkspace(created, prepared.blueprint, nativeBinding);
      const warnings = uniqueStrings([...run.warnings, ...verification.warnings]);
      const finalState: WorkspaceProvisioningState = verification.coreErrors.length > 0
        ? "failed"
        : warnings.length > 0 || pendingSetup.channels.length > 0 || pendingSetup.connections.length > 0 || pendingSetup.automations.length > 0
          ? "partial"
          : "ready";
      run = await updateStoredRun(key, run, {
        state: finalState,
        warnings,
        error: verification.coreErrors.length > 0
          ? { code: "verification-failed", message: verification.coreErrors[0] }
          : null,
        verifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await writeProvisioningManifest(created.workspacePath, run, prepared.blueprint, pendingSetup);
      return publicRun(run);
    } catch (error) {
      const message = redactErrorMessage(error, "Workspace provisioning did not complete.");
      const cancelled = isAbortError(error);
      run = await updateStoredRun(key, run, {
        state: cancelled ? "cancelled" : "failed",
        error: {
          code: cancelled ? "cancelled" : error instanceof WorkspaceProvisioningError ? error.code : "provisioning-failed",
          message: cancelled ? "Provisioning stopped; the workspace may be incomplete and can be resumed." : message
        },
        warnings: uniqueStrings([...run.warnings, cancelled ? "Provisioning stopped; the workspace may be incomplete and can be resumed." : message]),
        updatedAt: new Date().toISOString()
      });
      return publicRun(run);
    }
  });
}

async function bindNativeKnowledge(
  created: WorkspaceCreateResult,
  prepared: PreparedProvisioning
): Promise<WorkspaceNativeKnowledgeBindingResult | null> {
  if (!prepared.context?.generationId || !prepared.draftContextId) return null;
  return ensureWorkspaceNativeKnowledge({
    workspacePath: created.workspacePath,
    agentIds: created.agentIds
  });
}

async function applyAgentCapabilities(created: WorkspaceCreateResult, blueprint: WorkspaceBlueprint) {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
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
    try {
      await updateAgent({
        id: agentId,
        workspaceId: created.workspaceId,
        workspacePath: created.workspacePath,
        skills: filterKnownOpenClawSkillIds(desired.skillIds),
        tools: filterKnownOpenClawToolIds(desired.toolIds),
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
  nativeBinding: WorkspaceNativeKnowledgeBindingResult | null
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
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
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
  await writeTextFileEnsured(manifestPath, `${JSON.stringify({
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
      verifiedAt: run.verifiedAt
    }
  }, null, 2)}\n`);
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
    workspaceId: run.workspaceId,
    result: run.result,
    warnings: run.warnings.slice(0, 24),
    error: run.error,
    progress: run.progress,
    steps: buildSteps(run.state),
    signals: buildSignals(run),
    knowledge: run.knowledge,
    nativeKnowledge: run.nativeKnowledge,
    pendingSetup: run.pendingSetup,
    verifiedAt: run.verifiedAt
  };
}

function buildSteps(state: WorkspaceProvisioningState) {
  const order: WorkspaceProvisioningState[] = ["validating", "materializing", "bootstrapping", "promoting-knowledge", "provisioning-agents", "binding-knowledge", "applying-capabilities", "recording-declarations", "verifying"];
  const index = order.indexOf(state);
  return order.map((id, position) => ({
    id,
    label: provisioningLabel(id),
    status: state === "failed" && position >= Math.max(index, 0) ? "failed" as const : position < index || state === "ready" || state === "partial" ? "complete" as const : position === index ? "active" as const : "pending" as const
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

async function transition(key: string, run: StoredWorkspaceProvisioningRun, state: WorkspaceProvisioningState, detail: string) {
  const next = await updateStoredRun(key, run, {
    state,
    progress: { label: provisioningLabel(state), detail },
    updatedAt: new Date().toISOString(),
    checkpoints: {
      ...run.checkpoints,
      [state]: { state, completedAt: new Date().toISOString() }
    }
  });
  return next;
}

async function updateProgress(key: string, label: string, detail: string) {
  const run = await readStoredRun(key);
  if (!run || isTerminal(run.state)) return;
  await updateStoredRun(key, run, { progress: { label, detail }, updatedAt: new Date().toISOString() });
}

async function createRunAtomically(key: string, input: {
  actorId: string;
  blueprint: WorkspaceBlueprint;
  blueprintFingerprint: string;
  draftContextId: string | null;
  expectedKnowledgeGenerationId: string | null;
}) {
  await mkdir(WORKSPACE_PROVISIONING_ROOT, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const run: StoredWorkspaceProvisioningRun = {
    schemaVersion: WORKSPACE_PROVISIONING_SCHEMA_VERSION,
    runId: randomUUID(),
    actorHash: actorHash(input.actorId),
    idempotencyKeyHash: sha256(key),
    blueprintId: input.blueprint.id,
    blueprintFingerprint: input.blueprintFingerprint,
    draftContextId: input.draftContextId,
    expectedKnowledgeGenerationId: input.expectedKnowledgeGenerationId,
    state: "pending",
    createdAt: now,
    updatedAt: now,
    attempt: 1,
    workspaceId: null,
    workspacePath: null,
    result: null,
    checkpoints: {},
    warnings: [],
    error: null,
    progress: { label: "Preparing workspace", detail: "Provisioning is queued." },
    knowledge: null,
    nativeKnowledge: null,
    pendingSetup: { channels: [], connections: [], automations: [] },
    verifiedAt: null
  };
  const filePath = runPath(key);
  try {
    const handle = await open(filePath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(run, null, 2)}\n`, "utf8");
    await handle.close();
    return run;
  } catch (error) {
    if (isFileExistsError(error)) return (await readStoredRun(key)) as StoredWorkspaceProvisioningRun;
    throw error;
  }
}

async function withDurableRunLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const lockPath = `${runPath(key)}.lock`;
  await mkdir(WORKSPACE_PROVISIONING_ROOT, { recursive: true, mode: 0o700 });
  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeFile(path.join(lockPath, "owner"), `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
      break;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const lockAge = await stat(lockPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
      if (lockAge > LOCK_STALE_AFTER_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await delay(POLL_INTERVAL_MS);
    }
  }
  try {
    return await task();
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readStoredRun(key: string) {
  return readStoredRunFile(runPath(key));
}

async function readStoredRunFile(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredWorkspaceProvisioningRun;
    if (parsed.schemaVersion !== WORKSPACE_PROVISIONING_SCHEMA_VERSION || !RUN_ID_PATTERN.test(parsed.runId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function updateStoredRun(key: string, run: StoredWorkspaceProvisioningRun, updates: Partial<StoredWorkspaceProvisioningRun>) {
  const next = { ...run, ...updates };
  const targetPath = runPath(key);
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return next;
}

function runKey(actorId: string, idempotencyKey: string) {
  return `${actorHash(actorId)}:${sha256(idempotencyKey.trim())}`;
}

function runPath(key: string) {
  return path.join(WORKSPACE_PROVISIONING_ROOT, `${sha256(key)}.json`);
}

function actorHash(actorId: string) {
  return sha256(actorId.trim()).slice(0, 32);
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

function isFileExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

async function recoverUnexpectedProvisioningFailure(key: string, error: unknown) {
  const run = await readStoredRun(key);
  if (!run) throw error;
  const message = redactErrorMessage(error, "Workspace provisioning did not complete.");
  const failed = await updateStoredRun(key, run, {
    state: "failed",
    error: { code: "provisioning-failed", message },
    warnings: uniqueStrings([...run.warnings, message]),
    updatedAt: new Date().toISOString()
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
