import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactSecrets, redactSecretText } from "@/lib/security/redaction";
import {
  OPENCLAW_MIGRATION_SCHEMA_VERSION,
  type OpenClawMigrationEvidence,
  type OpenClawMigrationPlan,
  type OpenClawMigrationRun,
  type OpenClawMigrationStepId
} from "@/lib/openclaw/migration-engine/types";

export async function createMigrationRun(input: {
  plan: OpenClawMigrationPlan;
  runId: string;
  root: string;
}): Promise<OpenClawMigrationRun> {
  const now = new Date().toISOString();
  const run: OpenClawMigrationRun = {
    schemaVersion: OPENCLAW_MIGRATION_SCHEMA_VERSION,
    runId: input.runId,
    planId: input.plan.planId,
    startedAt: now,
    updatedAt: now,
    mode: input.plan.mode,
    state: "planned",
    currentStep: null,
    completedSteps: [],
    journalPath: path.join(input.root, "migration-journal.json"),
    journalHash: "",
    snapshot: null,
    rollback: null,
    evidence: [],
    errors: [],
    commitPointReached: false,
    recoveryRequired: false
  };
  return saveMigrationRun(run);
}

export async function saveMigrationRun(run: OpenClawMigrationRun): Promise<OpenClawMigrationRun> {
  const sanitized = sanitizeRun(run);
  const journalHash = hashRun(sanitized);
  const persisted = { ...sanitized, journalHash } satisfies OpenClawMigrationRun;
  await mkdir(path.dirname(persisted.journalPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${persisted.journalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600).catch(() => {});
  await rename(temporaryPath, persisted.journalPath);
  return persisted;
}

export async function readMigrationRun(journalPath: string): Promise<OpenClawMigrationRun> {
  const parsed = JSON.parse(await readFile(journalPath, "utf8")) as Partial<OpenClawMigrationRun>;
  if (
    parsed.schemaVersion !== OPENCLAW_MIGRATION_SCHEMA_VERSION ||
    typeof parsed.runId !== "string" ||
    typeof parsed.planId !== "string" ||
    typeof parsed.journalHash !== "string" ||
    !Array.isArray(parsed.completedSteps)
  ) {
    throw new Error("OpenClaw migration journal is invalid or unsupported.");
  }
  const run = parsed as OpenClawMigrationRun;
  if (hashRun(sanitizeRun(run)) !== run.journalHash) throw new Error("OpenClaw migration journal integrity check failed.");
  return run;
}

export function addMigrationEvidence(run: OpenClawMigrationRun, evidence: Omit<OpenClawMigrationEvidence, "createdAt">) {
  return {
    ...run,
    evidence: [
      ...run.evidence,
      {
        ...evidence,
        summary: redactSecretText(evidence.summary),
        details: evidence.details ? redactSecrets(evidence.details) : undefined,
        createdAt: new Date().toISOString()
      }
    ]
  } satisfies OpenClawMigrationRun;
}

export function completeMigrationStep(run: OpenClawMigrationRun, step: OpenClawMigrationStepId) {
  return {
    ...run,
    completedSteps: run.completedSteps.includes(step) ? run.completedSteps : [...run.completedSteps, step],
    currentStep: null,
    updatedAt: new Date().toISOString()
  } satisfies OpenClawMigrationRun;
}

export function beginMigrationStep(run: OpenClawMigrationRun, step: OpenClawMigrationStepId) {
  return { ...run, currentStep: step, updatedAt: new Date().toISOString() } satisfies OpenClawMigrationRun;
}

export function failMigrationRun(run: OpenClawMigrationRun, error: unknown, state: "failed" | "rollback-required" | "recovery-required" = "failed") {
  const message = redactSecretText(error instanceof Error ? error.message : String(error));
  return {
    ...run,
    state,
    errors: [...run.errors, message],
    updatedAt: new Date().toISOString(),
    recoveryRequired: state === "rollback-required" || state === "recovery-required"
  } satisfies OpenClawMigrationRun;
}

function sanitizeRun(run: OpenClawMigrationRun): OpenClawMigrationRun {
  return redactSecrets({ ...run, journalHash: "" });
}

function hashRun(run: OpenClawMigrationRun) {
  return createHash("sha256").update(JSON.stringify(run)).digest("hex");
}
