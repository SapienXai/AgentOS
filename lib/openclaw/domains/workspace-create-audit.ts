import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type {
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceCreationSource
} from "@/lib/openclaw/types";

const auditDirectoryPath = path.join(missionControlRootPath, "workspace-create-audits");

type WorkspaceCreateAudit = {
  id: string;
  createdAt: string;
  completedAt?: string;
  status: "started" | "succeeded" | "failed";
  source: WorkspaceCreationSource;
  planId?: string;
  idempotencyKeyHash?: string;
  request: {
    name: string;
    sourceMode?: string;
    template?: string;
    teamPreset?: string;
    agentListProvided: boolean;
    requestedAgentCount: number | null;
  };
  result?: WorkspaceCreateResult;
  error?: string;
};

export async function readCompletedWorkspaceCreateResult(input: WorkspaceCreateInput) {
  const auditPath = getIdempotentAuditPath(input);

  if (!auditPath) {
    return null;
  }

  try {
    const audit = JSON.parse(await readFile(auditPath, "utf8")) as WorkspaceCreateAudit;
    return audit.status === "succeeded" && audit.result ? audit.result : null;
  } catch {
    return null;
  }
}

export async function startWorkspaceCreateAudit(input: WorkspaceCreateInput) {
  const idempotentAuditPath = getIdempotentAuditPath(input);
  const id = idempotentAuditPath ? path.basename(idempotentAuditPath, ".json") : randomUUID();
  const auditPath = idempotentAuditPath ?? path.join(auditDirectoryPath, `${id}.json`);
  const audit: WorkspaceCreateAudit = {
    id,
    createdAt: new Date().toISOString(),
    status: "started",
    source: input.creation?.source ?? "api",
    planId: input.creation?.planId,
    idempotencyKeyHash: input.creation?.idempotencyKey ? hashValue(input.creation.idempotencyKey) : undefined,
    request: {
      name: input.name.trim(),
      sourceMode: input.sourceMode,
      template: input.template,
      teamPreset: input.teamPreset,
      agentListProvided: input.agents !== undefined,
      requestedAgentCount: input.agents?.length ?? null
    }
  };

  await writeAudit(auditPath, audit);

  return {
    auditPath,
    audit
  };
}

export async function completeWorkspaceCreateAudit(
  auditPath: string,
  audit: WorkspaceCreateAudit,
  result: WorkspaceCreateResult
) {
  await writeAudit(auditPath, redactSecrets({
    ...audit,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    result
  }));
}

export async function failWorkspaceCreateAudit(
  auditPath: string,
  audit: WorkspaceCreateAudit,
  error: unknown
) {
  await writeAudit(auditPath, redactSecrets({
    ...audit,
    status: "failed",
    completedAt: new Date().toISOString(),
    error: redactErrorMessage(error, "Workspace creation failed.")
  }));
}

function getIdempotentAuditPath(input: WorkspaceCreateInput) {
  const key = input.creation?.idempotencyKey?.trim();
  return key ? path.join(auditDirectoryPath, `${hashValue(key)}.json`) : null;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeAudit(auditPath: string, audit: WorkspaceCreateAudit) {
  await mkdir(path.dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
}
