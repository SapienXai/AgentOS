import "server-only";

import { readMigrationRun } from "@/lib/openclaw/migration-engine/journal";
import { OpenClawMigrationEngine } from "@/lib/openclaw/migration-engine/engine";
import type {
  OpenClawMigrationEngineInput,
  OpenClawMigrationInspectResult,
  OpenClawMigrationPlan,
  OpenClawMigrationRun,
  OpenClawMigrationRuntimeHooks
} from "@/lib/openclaw/migration-engine/types";

export type OpenClawMigrationServiceInput = OpenClawMigrationEngineInput & {
  hooks?: OpenClawMigrationRuntimeHooks;
};

export async function inspectOpenClawMigration(input: OpenClawMigrationServiceInput): Promise<OpenClawMigrationInspectResult> {
  return new OpenClawMigrationEngine(input, input.hooks).inspect();
}

export async function planOpenClawMigration(input: OpenClawMigrationServiceInput): Promise<OpenClawMigrationPlan> {
  return new OpenClawMigrationEngine(input, input.hooks).createPlan();
}

export async function dryRunOpenClawMigration(input: OpenClawMigrationServiceInput) {
  return new OpenClawMigrationEngine({ ...input, mode: "dry-run" }, input.hooks).dryRun();
}

export async function beginOpenClawMigration(input: OpenClawMigrationServiceInput, plan?: OpenClawMigrationPlan): Promise<OpenClawMigrationRun> {
  const engine = new OpenClawMigrationEngine(input, input.hooks);
  return engine.execute(plan ?? await engine.createPlan());
}

export async function resumeOpenClawMigration(input: OpenClawMigrationServiceInput, journalPath: string): Promise<OpenClawMigrationRun> {
  return new OpenClawMigrationEngine(input, input.hooks).resume(journalPath);
}

export async function rollbackOpenClawMigration(input: OpenClawMigrationServiceInput, journalPath: string): Promise<OpenClawMigrationRun> {
  return new OpenClawMigrationEngine(input, input.hooks).rollback(journalPath);
}

export async function getOpenClawMigrationProgress(journalPath: string) {
  return readMigrationRun(journalPath);
}

export async function getOpenClawMigrationFinalReport(journalPath: string) {
  const engine = new OpenClawMigrationEngine({
    sourceBinaryPath: "/dev/null",
    targetBinaryPath: "/dev/null",
    sourceStateDir: "/dev/null",
    sourceConfigPath: "/dev/null",
    workRoot: "/tmp"
  });
  return engine.finalReport(journalPath);
}
