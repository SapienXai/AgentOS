import "server-only";

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
}) {
  const workspaceId = input.workspaceId.trim();
  const provisioningRunId = input.provisioningRunId.trim();
  if (!workspaceId || !provisioningRunId) throw new Error("Workspace intelligence binding identity is required.");
  const now = input.now ?? new Date().toISOString();
  const binding: WorkspaceIntelligenceBinding = {
    schemaVersion: WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION,
    workspaceId,
    actorHash: actorHash(input.actorId),
    sourceGenerationId: input.sourceGenerationId,
    projectIntelligencePackId: input.projectIntelligencePackId,
    projectIntelligenceGenerationId: input.projectIntelligenceGenerationId,
    blueprintId: input.blueprintId,
    blueprintFingerprint: input.blueprintFingerprint,
    compositionPlanId: input.compositionPlan?.planId ?? null,
    compositionPlanFingerprint: input.compositionPlan?.inputFingerprint ?? null,
    provisioningRunId,
    status: input.status,
    createdAt: now,
    updatedAt: now
  };
  const root = path.resolve(input.rootPath ?? WORKSPACE_INTELLIGENCE_BINDING_ROOT);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, `${actorHash(input.actorId)}-${safeFilePart(workspaceId)}.json`);
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
}

export async function readWorkspaceIntelligenceBinding(input: { actorId: string; workspaceId: string; rootPath?: string }) {
  const target = path.join(path.resolve(input.rootPath ?? WORKSPACE_INTELLIGENCE_BINDING_ROOT), `${actorHash(input.actorId)}-${safeFilePart(input.workspaceId)}.json`);
  const raw = await readFile(target, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateWorkspaceIntelligenceBinding(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function validateWorkspaceIntelligenceBinding(value: unknown): value is WorkspaceIntelligenceBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).every((key) => ["schemaVersion", "workspaceId", "actorHash", "sourceGenerationId", "projectIntelligencePackId", "projectIntelligenceGenerationId", "blueprintId", "blueprintFingerprint", "compositionPlanId", "compositionPlanFingerprint", "provisioningRunId", "status", "createdAt", "updatedAt"].includes(key))
    && entry.schemaVersion === WORKSPACE_INTELLIGENCE_BINDING_SCHEMA_VERSION
    && ["workspaceId", "actorHash", "blueprintId", "blueprintFingerprint", "provisioningRunId", "createdAt", "updatedAt"].every((key) => typeof entry[key] === "string" && Boolean(entry[key]))
    && ["sourceGenerationId", "projectIntelligencePackId", "projectIntelligenceGenerationId", "compositionPlanId", "compositionPlanFingerprint"].every((key) => entry[key] === null || typeof entry[key] === "string")
    && ["current", "partial"].includes(entry.status as string);
}

function actorHash(actorId: string) {
  let hash = 2166136261;
  for (const character of actorId.trim()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "workspace";
}
