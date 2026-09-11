import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { workspaceCreationActorHash } from "@/lib/agentos/application/workspace-creation-run-store";
import type { WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_INTELLIGENCE_BINDING_ROOT = path.join(missionControlRootPath, "workspace-intelligence-bindings");

export type WorkspaceIntelligenceBinding = {
  schemaVersion: typeof WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION;
  workspaceId: string;
  actorHash: string;
  sourceGenerationId: string | null;
  projectIntelligencePackId: string | null;
  projectIntelligenceGenerationId: string | null;
  blueprintId: string;
  blueprintFingerprint: string;
  compositionPlanId: string | null;
  compositionPlanFingerprint: string | null;
  provisioningRunId: string;
  status: "current" | "partial";
  createdAt: string;
  updatedAt: string;
};

export async function persistWorkspaceIntelligenceBinding(input: {
  rootPath?: string;
  actorId: string;
  workspaceId: string;
  sourceGenerationId: string | null;
  projectIntelligencePackId: string | null;
  projectIntelligenceGenerationId: string | null;
  blueprintId: string;
  blueprintFingerprint: string;
  compositionPlan?: Pick<WorkspaceCompositionPlan, "planId" | "inputFingerprint"> | null;
  provisioningRunId: string;
  status: "current" | "partial";
  now?: string;
  expectedCurrentProvisioningRunId?: string | null;
}) {
  const workspaceId = input.workspaceId.trim();
  const provisioningRunId = input.provisioningRunId.trim();
  if (!workspaceId || !provisioningRunId) throw new Error("Workspace intelligence binding identity is required.");
  const root = path.resolve(input.rootPath ?? WORKSPACE_INTELLIGENCE_BINDING_ROOT);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = bindingPath(root, input.actorId, workspaceId);

  return withBindingLock(target, async () => {
    const current = await readWorkspaceIntelligenceBinding(input);
    if (
      input.expectedCurrentProvisioningRunId !== undefined
      && (current?.provisioningRunId ?? null) !== input.expectedCurrentProvisioningRunId
      && current?.provisioningRunId !== provisioningRunId
    ) {
      throw new Error("Workspace intelligence binding changed before this provisioning run could commit.");
    }

    const now = input.now ?? new Date().toISOString();
    const binding: WorkspaceIntelligenceBinding = {
      schemaVersion: WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION,
      workspaceId,
      actorHash: workspaceCreationActorHash(input.actorId),
      sourceGenerationId: input.sourceGenerationId,
      projectIntelligencePackId: input.projectIntelligencePackId,
      projectIntelligenceGenerationId: input.projectIntelligenceGenerationId,
      blueprintId: input.blueprintId,
      blueprintFingerprint: input.blueprintFingerprint,
      compositionPlanId: input.compositionPlan?.planId ?? null,
      compositionPlanFingerprint: input.compositionPlan?.inputFingerprint ?? null,
      provisioningRunId,
      status: input.status,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(binding, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return binding;
  });
}

export async function readWorkspaceIntelligenceBinding(input: { actorId: string; workspaceId: string; rootPath?: string }) {
  const root = path.resolve(input.rootPath ?? WORKSPACE_INTELLIGENCE_BINDING_ROOT);
  const target = bindingPath(root, input.actorId, input.workspaceId);
  const legacyTarget = path.join(root, `${workspaceCreationActorHash(input.actorId)}-${safeFilePart(input.workspaceId)}.json`);
  const raw = await readFile(target, "utf8").catch(() => readFile(legacyTarget, "utf8").catch(() => null));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateWorkspaceIntelligenceBinding(parsed)
      && parsed.actorHash === workspaceCreationActorHash(input.actorId)
      && parsed.workspaceId === input.workspaceId.trim()
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function validateWorkspaceIntelligenceBinding(value: unknown): value is WorkspaceIntelligenceBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).every((key) => ["schemaVersion", "workspaceId", "actorHash", "sourceGenerationId", "projectIntelligencePackId", "projectIntelligenceGenerationId", "blueprintId", "blueprintFingerprint", "compositionPlanId", "compositionPlanFingerprint", "provisioningRunId", "status", "createdAt", "updatedAt"].includes(key))
    && entry.schemaVersion === WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION
    && ["workspaceId", "blueprintId", "provisioningRunId", "createdAt", "updatedAt"].every((key) => typeof entry[key] === "string" && Boolean(entry[key]))
    && typeof entry.blueprintFingerprint === "string" && /^[a-f0-9]{64}$/i.test(entry.blueprintFingerprint)
    && typeof entry.actorHash === "string" && /^[a-f0-9]{32}$/i.test(entry.actorHash)
    && ["sourceGenerationId", "projectIntelligencePackId", "projectIntelligenceGenerationId", "compositionPlanId"].every((key) => entry[key] === null || typeof entry[key] === "string")
    && (entry.compositionPlanFingerprint === null || typeof entry.compositionPlanFingerprint === "string" && /^[a-f0-9]{64}$/i.test(entry.compositionPlanFingerprint))
    && ["current", "partial"].includes(entry.status as string);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bindingPath(root: string, actorId: string, workspaceId: string) {
  return path.join(root, `${workspaceCreationActorHash(actorId)}-${sha256(workspaceId.trim()).slice(0, 32)}.json`);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "workspace";
}

async function withBindingLock<T>(target: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${target}.lock`;
  const deadline = Date.now() + 5_000;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (!isExistsError(error) || Date.now() >= deadline) {
        throw new Error("Workspace intelligence binding is busy or unavailable.");
      }
      const lockStats = await stat(lockPath).catch(() => null);
      if (lockStats && Date.now() - lockStats.mtimeMs > 10_000) await rm(lockPath, { force: true }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function isExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST");
}
