import "server-only";

import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentOsAuthenticationMethod, AgentOsActorContext } from "@/lib/security/agentos-actor";
import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";

export const AGENTOS_AUDIT_FILE = "agentos-audit.jsonl";

export type AgentOsAuditResult = "started" | "succeeded" | "denied" | "failed" | "unknown";

export type AgentOsAuditEvent = {
  schemaVersion: 1;
  actorId: string;
  authenticationMethod: AgentOsAuthenticationMethod;
  operation: string;
  targetKind: string;
  targetId?: string;
  result: AgentOsAuditResult;
  timestamp: string;
};

export function resolveAgentOsAuditPath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveAgentOsRuntimeDir(env), AGENTOS_AUDIT_FILE);
}

/** Append only non-sensitive mutation metadata. Secrets and request bodies never enter this envelope. */
export async function recordAgentOsAuditEvent(input: {
  actor: Pick<AgentOsActorContext, "actorId" | "authenticationMethod">;
  operation: string;
  targetKind: string;
  targetId?: string | null;
  result: AgentOsAuditResult;
  env?: NodeJS.ProcessEnv;
  timestamp?: string;
}) {
  const env = input.env ?? process.env;
  const event: AgentOsAuditEvent = {
    schemaVersion: 1,
    actorId: input.actor.actorId,
    authenticationMethod: input.actor.authenticationMethod,
    operation: input.operation,
    targetKind: input.targetKind,
    ...(safeTargetId(input.targetId) ? { targetId: safeTargetId(input.targetId)! } : {}),
    result: input.result,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
  const auditPath = resolveAgentOsAuditPath(env);
  await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  await appendFile(auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(auditPath, 0o600);
  return event;
}

export async function readAgentOsAuditEvents(env: NodeJS.ProcessEnv = process.env): Promise<AgentOsAuditEvent[]> {
  try {
    const raw = await readFile(resolveAgentOsAuditPath(env), "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as AgentOsAuditEvent);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new Error("AgentOS audit data is unavailable or invalid.");
  }
}

function safeTargetId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length <= 256 && !/[\r\n]/.test(normalized) ? normalized : null;
}
