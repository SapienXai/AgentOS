import "server-only";

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import type { AgentOsActorContext } from "@/lib/security/agentos-actor";
import { readInstanceSessionCookie } from "@/lib/security/instance-protection";
import type { ResetPreview, ResetTarget } from "@/lib/agentos/contracts";

export const AGENTOS_RESET_PLAN_DIRECTORY = "reset-plans";
export const RESET_PLAN_TTL_MS = 10 * 60_000;

export type ResetConfirmationTicket = {
  planId: string;
  expiresAt: string;
};

export type ConsumedResetConfirmation = ResetConfirmationTicket & {
  preview: ResetPreview;
  activePath: string;
};

type StoredResetConfirmation = ResetConfirmationTicket & {
  version: 1;
  target: ResetTarget;
  actorId: string;
  sessionBindingHash: string;
  previewHash: string;
  preview: ResetPreview;
};

export class ResetConfirmationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409,
    readonly code:
      | "reset-plan-invalid"
      | "reset-plan-expired"
      | "reset-plan-actor-mismatch"
      | "reset-plan-session-mismatch"
      | "reset-plan-target-mismatch"
      | "reset-plan-in-use"
  ) {
    super(message);
    this.name = "ResetConfirmationError";
  }
}

export async function createResetConfirmation(input: {
  preview: ResetPreview;
  actor: AgentOsActorContext;
  request: Request;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<ResetConfirmationTicket> {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const planId = randomUUID();
  const expiresAt = new Date(now.getTime() + RESET_PLAN_TTL_MS).toISOString();
  const stored: StoredResetConfirmation = {
    version: 1,
    planId,
    expiresAt,
    target: input.preview.target,
    actorId: input.actor.actorId,
    sessionBindingHash: hashSessionBinding(input.actor, input.request),
    previewHash: hashPreview(input.preview),
    preview: input.preview
  };
  const planPath = resolveResetPlanPath(planId, env);
  const temporaryPath = `${planPath}.${process.pid}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(planPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, planPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return { planId, expiresAt };
}

/**
 * Atomically consumes a plan. Renaming the plan before returning it prevents
 * a second request from replaying the same destructive operation.
 */
export async function consumeResetConfirmation(input: {
  planId: string;
  target: ResetTarget;
  actor: AgentOsActorContext;
  request: Request;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<ConsumedResetConfirmation> {
  const env = input.env ?? process.env;
  const planId = normalizePlanId(input.planId);
  const planPath = resolveResetPlanPath(planId, env);
  const stored = await readStoredPlan(planPath);
  validateStoredPlan(stored, { ...input, planId }, input.now ?? new Date());

  const activePath = resolveActiveResetPlanPath(planId, env);
  try {
    await rename(planPath, activePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ResetConfirmationError(
        "This reset preview is already being used. Refresh the preview before retrying.",
        409,
        "reset-plan-in-use"
      );
    }
    throw error;
  }

  const active = await readStoredPlan(activePath).catch(async (error) => {
    await rm(activePath, { force: true }).catch(() => undefined);
    throw error;
  });
  try {
    validateStoredPlan(active, { ...input, planId }, input.now ?? new Date());
  } catch (error) {
    await rm(activePath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    planId,
    expiresAt: active.expiresAt,
    preview: active.preview,
    activePath
  };
}

export async function releaseResetConfirmation(
  confirmation: Pick<ConsumedResetConfirmation, "activePath">,
  env: NodeJS.ProcessEnv = process.env
) {
  await rm(confirmation.activePath, { force: true });
  await removeDirectoryIfEmpty(path.dirname(confirmation.activePath));
  await removeDirectoryIfEmpty(resolveAgentOsRuntimeDir(env));
}

export function resolveResetPlanPath(planId: string, env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveAgentOsRuntimeDir(env), AGENTOS_RESET_PLAN_DIRECTORY, `${normalizePlanId(planId)}.json`);
}

export function isResetPlanId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveActiveResetPlanPath(planId: string, env: NodeJS.ProcessEnv) {
  return path.join(resolveAgentOsRuntimeDir(env), AGENTOS_RESET_PLAN_DIRECTORY, `${normalizePlanId(planId)}.active`);
}

async function readStoredPlan(planPath: string): Promise<StoredResetConfirmation> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(planPath, "utf8"));
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new ResetConfirmationError(
        "The reset preview is missing or has already been consumed. Refresh the preview before retrying.",
        409,
        "reset-plan-in-use"
      );
    }
    throw new ResetConfirmationError(
      "The reset preview could not be read. Refresh the preview before retrying.",
      400,
      "reset-plan-invalid"
    );
  }

  if (!isStoredResetConfirmation(parsed)) {
    throw new ResetConfirmationError(
      "The reset preview is invalid. Refresh the preview before retrying.",
      400,
      "reset-plan-invalid"
    );
  }

  return parsed;
}

function validateStoredPlan(
  stored: StoredResetConfirmation,
  input: {
    planId: string;
    target: ResetTarget;
    actor: AgentOsActorContext;
    request: Request;
  },
  now: Date
) {
  if (stored.planId !== input.planId) {
    throw new ResetConfirmationError("The reset preview does not match this plan id.", 400, "reset-plan-invalid");
  }
  if (Date.parse(stored.expiresAt) <= now.getTime()) {
    throw new ResetConfirmationError(
      "The reset preview has expired. Refresh the preview before retrying.",
      409,
      "reset-plan-expired"
    );
  }
  if (stored.actorId !== input.actor.actorId) {
    throw new ResetConfirmationError(
      "This reset preview belongs to a different AgentOS operator.",
      403,
      "reset-plan-actor-mismatch"
    );
  }
  if (stored.target !== input.target) {
    throw new ResetConfirmationError(
      "The reset target changed. Refresh the preview before retrying.",
      409,
      "reset-plan-target-mismatch"
    );
  }

  const expectedBinding = hashSessionBinding(input.actor, input.request);
  if (!constantTimeEqual(stored.sessionBindingHash, expectedBinding)) {
    throw new ResetConfirmationError(
      "The reset preview belongs to a different AgentOS session.",
      403,
      "reset-plan-session-mismatch"
    );
  }
  if (stored.preview.target !== stored.target || stored.previewHash !== hashPreview(stored.preview)) {
    throw new ResetConfirmationError(
      "The reset preview is invalid. Refresh the preview before retrying.",
      400,
      "reset-plan-invalid"
    );
  }
}

function isStoredResetConfirmation(value: unknown): value is StoredResetConfirmation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredResetConfirmation>;
  return (
    candidate.version === 1 &&
    typeof candidate.planId === "string" &&
    isResetPlanId(candidate.planId) &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.target === "string" &&
    (candidate.target === "mission-control" || candidate.target === "full-uninstall") &&
    typeof candidate.actorId === "string" &&
    typeof candidate.sessionBindingHash === "string" &&
    /^[0-9a-f]{64}$/i.test(candidate.sessionBindingHash) &&
    typeof candidate.previewHash === "string" &&
    /^[0-9a-f]{64}$/i.test(candidate.previewHash) &&
    Boolean(candidate.preview && typeof candidate.preview === "object")
  );
}

function normalizePlanId(value: string) {
  if (!isResetPlanId(value)) {
    throw new ResetConfirmationError("The reset plan id is invalid.", 400, "reset-plan-invalid");
  }
  return value.toLowerCase();
}

function hashPreview(preview: ResetPreview) {
  return createHash("sha256").update(JSON.stringify(preview)).digest("hex");
}

function hashSessionBinding(actor: AgentOsActorContext, request: Request) {
  const origin = new URL(request.url).origin;
  const binding = actor.authenticationMethod === "instance-session"
    ? readInstanceSessionCookie(request.headers) ?? ""
    : actor.authenticationMethod === "api-token" || actor.authenticationMethod === "desktop-token"
      ? readApiCredential(request.headers) ?? ""
      : `${origin}:${actor.actorId}`;

  return createHash("sha256")
    .update(`${actor.authenticationMethod}:${actor.actorId}:${origin}:${binding}`)
    .digest("hex");
}

function readApiCredential(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  if (authorization) return authorization;
  const headerToken = headers.get("x-agentos-api-token")?.trim();
  if (headerToken) return headerToken;
  const cookieHeader = headers.get("cookie") ?? "";
  for (const entry of cookieHeader.split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name === "agentos_api_token") return parts.join("=") || null;
  }
  return null;
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function removeDirectoryIfEmpty(targetPath: string) {
  try {
    await rmdir(targetPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT") || isNodeError(error, "ENOTEMPTY") || isNodeError(error, "EEXIST")) return;
  }
}

function isNodeError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
