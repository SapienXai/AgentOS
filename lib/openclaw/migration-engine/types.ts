export const OPENCLAW_MIGRATION_SCHEMA_VERSION = 1 as const;

export const OPENCLAW_MIGRATION_STATES = [
  "planned",
  "preflight",
  "snapshotting",
  "staging",
  "target-validating",
  "state-migrating",
  "target-starting",
  "postflight",
  "certifying",
  "committing",
  "completed",
  "blocked",
  "failed",
  "rollback-required",
  "rolling-back",
  "rolled-back",
  "interrupted",
  "recovery-required"
] as const;

export type OpenClawMigrationState = typeof OPENCLAW_MIGRATION_STATES[number];

export const OPENCLAW_MIGRATION_STEP_IDS = [
  "inspect",
  "preflight",
  "plan",
  "snapshot",
  "stage-target",
  "validate-target",
  "migrate-state",
  "start-target",
  "post-upgrade-doctor",
  "runtime-certification",
  "preservation",
  "commit",
  "cleanup"
] as const;

export type OpenClawMigrationStepId = typeof OPENCLAW_MIGRATION_STEP_IDS[number];
export type OpenClawMigrationStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type OpenClawMigrationRunMode = "dry-run" | "execute";

export type OpenClawRuntimeIdentity = {
  packageRoot: string;
  binaryPath: string;
  version: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageHash: string;
};

export type OpenClawMigrationPaths = {
  sourceStateDir: string;
  sourceConfigPath: string;
  targetStateDir: string;
  targetConfigPath: string;
  runtimePackageRoot: string;
  installPackageRoot: string | null;
  workRoot: string;
  snapshotRoot: string;
};

export type OpenClawMigrationBlocker = {
  code:
    | "invalid-source"
    | "invalid-target"
    | "wrong-version"
    | "downgrade"
    | "active-owner"
    | "external-supervisor"
    | "missing-path"
    | "unsafe-path"
    | "unsupported"
    | "unknown";
  message: string;
};

export type OpenClawMigrationPlan = {
  schemaVersion: typeof OPENCLAW_MIGRATION_SCHEMA_VERSION;
  planId: string;
  createdAt: string;
  mode: OpenClawMigrationRunMode;
  source: OpenClawRuntimeIdentity;
  target: OpenClawRuntimeIdentity;
  paths: OpenClawMigrationPaths;
  supervisor: {
    mode: "agentos-managed" | "external" | "unknown";
    replacementAllowed: boolean;
    reason: string;
  };
  steps: OpenClawMigrationStep[];
  blockers: OpenClawMigrationBlocker[];
  warnings: string[];
  mutationBoundary: {
    snapshotBeforeMutation: true;
    commitAfterCertification: true;
    targetStateIsolatedUntilCommit: true;
  };
};

export type OpenClawMigrationStep = {
  id: OpenClawMigrationStepId;
  state: OpenClawMigrationState;
  description: string;
  status: OpenClawMigrationStepStatus;
  mutation: boolean;
  retryable: boolean;
};

export type OpenClawMigrationSnapshotFile = {
  relativePath: string;
  kind: "file" | "directory" | "sqlite" | "symlink";
  bytes: number;
  sha256: string | null;
  linkTarget?: string;
};

export type OpenClawMigrationSnapshotSqlite = {
  relativePath: string;
  snapshotPath: string;
  userVersion: number | null;
  integrity: "ok" | "failed" | "unknown";
  sourceSidecars: string[];
  sha256: string;
};

export type OpenClawMigrationSnapshot = {
  schemaVersion: typeof OPENCLAW_MIGRATION_SCHEMA_VERSION;
  snapshotId: string;
  createdAt: string;
  sourceVersion: string;
  sourceCommit: string | null;
  stateDir: string;
  configPath: string;
  root: string;
  files: OpenClawMigrationSnapshotFile[];
  sqlite: OpenClawMigrationSnapshotSqlite[];
  config: {
    relativePath: string;
    sha256: string;
    bytes: number;
  } | null;
  verified: boolean;
};

export type OpenClawMigrationEvidence = {
  id: string;
  step: OpenClawMigrationStepId;
  kind:
    | "identity"
    | "command"
    | "sqlite"
    | "doctor"
    | "runtime"
    | "preservation"
    | "journal"
    | "rollback"
    | "supervisor";
  status: "pass" | "warning" | "fail" | "blocked";
  summary: string;
  details?: Record<string, unknown>;
  createdAt: string;
};

export type OpenClawMigrationRollbackPlan = {
  snapshotId: string;
  snapshotRoot: string;
  source: OpenClawRuntimeIdentity;
  target: OpenClawRuntimeIdentity;
  restoreStateDir: string;
  restoreConfigPath: string;
  restorePackageRoot: string | null;
  safe: boolean;
  reasons: string[];
};

export type OpenClawMigrationRun = {
  schemaVersion: typeof OPENCLAW_MIGRATION_SCHEMA_VERSION;
  runId: string;
  planId: string;
  startedAt: string;
  updatedAt: string;
  mode: OpenClawMigrationRunMode;
  state: OpenClawMigrationState;
  currentStep: OpenClawMigrationStepId | null;
  completedSteps: OpenClawMigrationStepId[];
  journalPath: string;
  journalHash: string;
  snapshot: OpenClawMigrationSnapshot | null;
  rollback: OpenClawMigrationRollbackPlan | null;
  evidence: OpenClawMigrationEvidence[];
  errors: string[];
  commitPointReached: boolean;
  recoveryRequired: boolean;
};

export type OpenClawMigrationFailureInjection = {
  step: OpenClawMigrationStepId;
  once?: boolean;
};

export type OpenClawMigrationEngineInput = {
  sourceBinaryPath: string;
  targetBinaryPath: string;
  sourcePackageRoot?: string;
  targetPackageRoot?: string;
  sourceStateDir: string;
  sourceConfigPath: string;
  targetStateDir?: string;
  targetConfigPath?: string;
  runtimePackageRoot?: string;
  installPackageRoot?: string | null;
  workRoot: string;
  snapshotRoot?: string;
  mode?: OpenClawMigrationRunMode;
  supervisorMode?: "agentos-managed" | "external" | "unknown";
  activeOwnerDetected?: boolean;
  failureInjection?: OpenClawMigrationFailureInjection;
  commandTimeoutMs?: number;
  gatewayPort?: number;
  gatewayToken?: string;
};

export type OpenClawMigrationCommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type OpenClawMigrationRuntimeHooks = {
  runCommand?: (input: {
    binaryPath: string;
    args: string[];
    env: Record<string, string | undefined>;
    cwd?: string;
    timeoutMs: number;
  }) => Promise<OpenClawMigrationCommandResult>;
  certify?: (input: {
    binaryPath: string;
    stateDir: string;
    configPath: string;
    gatewayUrl: string;
    token: string | null;
  }) => Promise<OpenClawMigrationEvidence>;
  gateway?: {
    start: (input: {
      binaryPath: string;
      stateDir: string;
      configPath: string;
      port: number;
      token: string;
    }) => Promise<{ pid: number; stop: () => Promise<void> }>;
  };
};

export type OpenClawMigrationInspectResult = {
  plan: OpenClawMigrationPlan;
  sourceState: {
    exists: boolean;
    fileCount: number;
    sqliteCount: number;
    configExists: boolean;
  };
};

export type OpenClawMigrationSuccessGate = {
  pass: boolean;
  checks: Array<{
    id: string;
    pass: boolean;
    required: boolean;
    detail: string;
  }>;
};
