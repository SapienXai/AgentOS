import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import type { WorkspaceNativeKnowledgeStatus } from "@/lib/agentos/application/workspace-native-knowledge-service";
import type { WorkspaceCreateResult } from "@/lib/openclaw/types";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const WORKSPACE_PROVISIONING_SCHEMA_VERSION = 2 as const;
export const WORKSPACE_PROVISIONING_ROOT = path.join(missionControlRootPath, "workspace-provisioning-runs");
export const WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH = ".openclaw/agentos-provisioning.json";

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

export const provisioningCompletedStepIds = [
  "validated",
  "workspace-materialized",
  "bootstrap-verified",
  "knowledge-promoted",
  "agents-verified",
  "knowledge-bound",
  "capabilities-applied",
  "declarations-recorded",
  "final-verification-complete"
] as const;

export type ProvisioningCompletedStepId = (typeof provisioningCompletedStepIds)[number];

export type ProvisioningCheckpoint = {
  completedAt: string;
  evidence: Record<string, string>;
};

export type StoredWorkspaceProvisioningRun = {
  schemaVersion: typeof WORKSPACE_PROVISIONING_SCHEMA_VERSION;
  runId: string;
  actorHash: string;
  idempotencyKeyHash: string;
  blueprintId: string;
  blueprintFingerprint: string;
  /** Exact validated input snapshot required for process-restart recovery. */
  blueprint: unknown;
  draftContextId: string | null;
  expectedKnowledgeGenerationId: string | null;
  state: WorkspaceProvisioningState;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  workspaceId: string | null;
  workspacePath: string | null;
  result: WorkspaceCreateResult | null;
  completedSteps: Partial<Record<ProvisioningCompletedStepId, ProvisioningCheckpoint>>;
  warnings: string[];
  error: { code: string; message: string } | null;
  progress: { label: string; detail: string } | null;
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

export type StoredRunLocator = {
  run: StoredWorkspaceProvisioningRun;
  filePath: string;
};

const RUN_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export function resolveProvisioningRoot(rootPath = WORKSPACE_PROVISIONING_ROOT) {
  return path.resolve(rootPath);
}

export function actorHash(actorId: string) {
  return sha256(actorId.trim()).slice(0, 32);
}

export function buildProvisioningStorageKey(actorId: string, idempotencyKey: string) {
  return `${actorHash(actorId)}:${sha256(idempotencyKey.trim())}`;
}

export function runPath(rootPath: string, storageKey: string) {
  return path.join(resolveProvisioningRoot(rootPath), `${sha256(storageKey)}.json`);
}

export function runPathFromStoredRun(rootPath: string, run: StoredWorkspaceProvisioningRun) {
  return path.join(resolveProvisioningRoot(rootPath), `${run.idempotencyKeyHash}.json`);
}

export async function createRunAtomically(rootPath: string, storageKey: string, input: {
  actorId: string;
  blueprint: WorkspaceBlueprint;
  blueprintFingerprint: string;
  draftContextId: string | null;
  expectedKnowledgeGenerationId: string | null;
}) {
  const root = resolveProvisioningRoot(rootPath);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const run: StoredWorkspaceProvisioningRun = {
    schemaVersion: WORKSPACE_PROVISIONING_SCHEMA_VERSION,
    runId: randomUUID(),
    actorHash: actorHash(input.actorId),
    idempotencyKeyHash: sha256(storageKey),
    blueprintId: input.blueprint.id,
    blueprintFingerprint: input.blueprintFingerprint,
    blueprint: input.blueprint,
    draftContextId: input.draftContextId,
    expectedKnowledgeGenerationId: input.expectedKnowledgeGenerationId,
    state: "pending",
    createdAt: now,
    updatedAt: now,
    attempt: 1,
    workspaceId: null,
    workspacePath: null,
    result: null,
    completedSteps: {},
    warnings: [],
    error: null,
    progress: { label: "Preparing workspace", detail: "Provisioning is queued." },
    knowledge: null,
    nativeKnowledge: null,
    pendingSetup: { channels: [], connections: [], automations: [] },
    verifiedAt: null
  };
  const filePath = runPath(root, storageKey);
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(run, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return run;
  } catch (error) {
    if (isFileExistsError(error)) {
      const existing = await readStoredRun(root, storageKey);
      if (!existing) throw new Error("Workspace provisioning run is unavailable or malformed.");
      return existing;
    }
    throw error;
  }
}

export async function readStoredRun(rootPath: string, storageKey: string) {
  return readStoredRunFile(runPath(rootPath, storageKey));
}

export async function readStoredRunFile(filePath: string): Promise<StoredWorkspaceProvisioningRun | null> {
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

export async function findRunById(rootPath: string, actorId: string, runId: string): Promise<StoredRunLocator | null> {
  const expectedActorHash = actorHash(actorId);
  const files = await readdir(resolveProvisioningRoot(rootPath)).catch(() => []);
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = path.join(resolveProvisioningRoot(rootPath), fileName);
    const run = await readStoredRunFile(filePath);
    if (run?.actorHash === expectedActorHash && run.runId === runId) return { run, filePath };
  }
  return null;
}

export async function updateStoredRun(
  filePath: string,
  run: StoredWorkspaceProvisioningRun,
  updates: Partial<StoredWorkspaceProvisioningRun>
) {
  const next = { ...run, ...updates };
  await writeAtomicJson(filePath, next);
  return next;
}

export async function writeAtomicJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isFileExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
