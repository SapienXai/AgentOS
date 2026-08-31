import type { OpenClawMigrationRun, OpenClawMigrationState } from "@/lib/openclaw/migration-engine/types";

const TRANSITIONS: Record<OpenClawMigrationState, readonly OpenClawMigrationState[]> = {
  planned: ["planned", "preflight", "snapshotting", "staging", "target-validating", "state-migrating", "target-starting", "postflight", "certifying", "committing", "blocked", "failed", "rollback-required", "interrupted", "recovery-required"],
  preflight: ["preflight", "planned", "snapshotting", "blocked", "failed", "interrupted", "recovery-required"],
  snapshotting: ["snapshotting", "staging", "blocked", "failed", "rollback-required", "interrupted", "recovery-required"],
  staging: ["staging", "target-validating", "failed", "rollback-required", "interrupted", "recovery-required"],
  "target-validating": ["target-validating", "state-migrating", "failed", "rollback-required", "interrupted", "recovery-required"],
  "state-migrating": ["state-migrating", "target-starting", "failed", "rollback-required", "interrupted", "recovery-required"],
  "target-starting": ["target-starting", "postflight", "certifying", "failed", "rollback-required", "interrupted", "recovery-required"],
  postflight: ["postflight", "certifying", "failed", "rollback-required", "interrupted", "recovery-required"],
  certifying: ["certifying", "committing", "target-starting", "failed", "rollback-required", "interrupted", "recovery-required"],
  committing: ["committing", "target-starting", "certifying", "completed", "failed", "rollback-required", "recovery-required"],
  completed: ["completed", "rolling-back", "recovery-required"],
  blocked: ["blocked", "rolling-back"],
  failed: ["failed", "rolling-back", "rollback-required", "recovery-required"],
  "rollback-required": ["rollback-required", "rolling-back", "interrupted", "recovery-required"],
  "rolling-back": ["rolling-back", "rolled-back", "recovery-required"],
  "rolled-back": ["rolled-back"],
  interrupted: ["interrupted", "planned", "rolling-back", "recovery-required"],
  "recovery-required": ["recovery-required", "rolling-back"]
};

export function assertOpenClawMigrationTransition(from: OpenClawMigrationState, to: OpenClawMigrationState) {
  if (!TRANSITIONS[from]?.includes(to)) throw new Error(`Illegal OpenClaw migration state transition: ${from} -> ${to}.`);
}

export function transitionMigrationRun(run: OpenClawMigrationRun, state: OpenClawMigrationState) {
  assertOpenClawMigrationTransition(run.state, state);
  return { ...run, state, updatedAt: new Date().toISOString() };
}

export function migrationStateTransitions() {
  return TRANSITIONS;
}
