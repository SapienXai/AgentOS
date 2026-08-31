import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";
import { redactSecretText, redactSecrets } from "@/lib/security/redaction";
import { captureStatePreservation, compareStatePreservation } from "@/lib/openclaw/migration-engine/preservation";
import { createMigrationSnapshot, copySnapshotState, restoreMigrationSnapshot } from "@/lib/openclaw/migration-engine/snapshot";
import { createDefaultMigrationRuntimeHooks, DEFAULT_MIGRATION_COMMAND_TIMEOUT_MS } from "@/lib/openclaw/migration-engine/runtime";
import { addMigrationEvidence, beginMigrationStep, completeMigrationStep, createMigrationRun, failMigrationRun, readMigrationRun, saveMigrationRun } from "@/lib/openclaw/migration-engine/journal";
import { compareOpenClawVersions, pathExists, readOpenClawRuntimeIdentity, resolveMigrationPaths } from "@/lib/openclaw/migration-engine/paths";
import type {
  OpenClawMigrationCommandResult,
  OpenClawMigrationEngineInput,
  OpenClawMigrationEvidence,
  OpenClawMigrationInspectResult,
  OpenClawMigrationPlan,
  OpenClawMigrationRollbackPlan,
  OpenClawMigrationRun,
  OpenClawMigrationRuntimeHooks,
  OpenClawMigrationStep,
  OpenClawMigrationStepId,
  OpenClawMigrationSuccessGate
} from "@/lib/openclaw/migration-engine/types";

export const OPENCLAW_PHASE_2B_SOURCE_VERSION = "2026.6.11";
export const OPENCLAW_PHASE_2B_TARGET_VERSION = "2026.8.1";
export const OPENCLAW_PHASE_2B_TARGET_COMMIT = "ea806575e6450e4d1efdfc72c19f04be982a1b9b";

const STEP_DEFINITIONS: Array<Omit<OpenClawMigrationStep, "status">> = [
  { id: "inspect", state: "preflight", description: "Inspect source state, config, runtime identity, and mutation ownership.", mutation: false, retryable: true },
  { id: "preflight", state: "preflight", description: "Check exact source-to-target compatibility and external supervisor boundaries.", mutation: false, retryable: true },
  { id: "plan", state: "planned", description: "Persist the deterministic migration plan and its explicit mutation boundary.", mutation: false, retryable: true },
  { id: "snapshot", state: "snapshotting", description: "Create and verify a WAL-aware state, SQLite, config, and runtime snapshot.", mutation: true, retryable: true },
  { id: "stage-target", state: "staging", description: "Stage the exact target package and copy the source state into an isolated target root.", mutation: true, retryable: true },
  { id: "validate-target", state: "target-validating", description: "Run target read-only doctor and SQLite preflight checks before repair.", mutation: false, retryable: true },
  { id: "migrate-state", state: "state-migrating", description: "Run the target's explicit non-interactive state/config migration in isolation.", mutation: true, retryable: true },
  { id: "start-target", state: "target-starting", description: "Start the target Gateway only against the isolated migrated state.", mutation: true, retryable: true },
  { id: "post-upgrade-doctor", state: "postflight", description: "Run target post-upgrade doctor checks and record machine-readable findings.", mutation: false, retryable: true },
  { id: "runtime-certification", state: "certifying", description: "Certify native Gateway, model, streaming, restart, and cron behavior.", mutation: false, retryable: true },
  { id: "preservation", state: "certifying", description: "Compare source and target agent, session, transcript, automation, model, and workspace evidence.", mutation: false, retryable: true },
  { id: "commit", state: "committing", description: "Replace the managed runtime and live state after every required gate passes.", mutation: true, retryable: false },
  { id: "cleanup", state: "completed", description: "Remove disposable staging material while retaining verified rollback evidence.", mutation: true, retryable: true }
];

export class OpenClawMigrationEngine {
  private readonly hooks: Required<Pick<OpenClawMigrationRuntimeHooks, "runCommand">> & OpenClawMigrationRuntimeHooks;
  private readonly gatewayHandles = new Map<string, { stop: () => Promise<void> }>();
  private readonly injectedFailureUsed = new Set<OpenClawMigrationStepId>();

  constructor(
    private readonly input: OpenClawMigrationEngineInput,
    hooks: OpenClawMigrationRuntimeHooks = createDefaultMigrationRuntimeHooks()
  ) {
    this.hooks = { ...hooks, runCommand: hooks.runCommand ?? createDefaultMigrationRuntimeHooks().runCommand! };
  }

  async inspect(): Promise<OpenClawMigrationInspectResult> {
    const plan = await this.createPlan();
    const stateFiles = await countStateFiles(plan.paths.sourceStateDir);
    return {
      plan,
      sourceState: {
        exists: await pathExists(plan.paths.sourceStateDir),
        fileCount: stateFiles.fileCount,
        sqliteCount: stateFiles.sqliteCount,
        configExists: await pathExists(plan.paths.sourceConfigPath)
      }
    };
  }

  async createPlan(): Promise<OpenClawMigrationPlan> {
    const planId = randomUUID();
    const source = await readOpenClawRuntimeIdentity({ binaryPath: this.input.sourceBinaryPath, packageRoot: this.input.sourcePackageRoot });
    const target = await readOpenClawRuntimeIdentity({ binaryPath: this.input.targetBinaryPath, packageRoot: this.input.targetPackageRoot });
    const paths = await resolveMigrationPaths(this.input, planId);
    const blockers = [] as OpenClawMigrationPlan["blockers"];
    const warnings: string[] = [];
    const supervisorMode = resolveSupervisorMode(this.input.supervisorMode);
    const versionOrder = compareOpenClawVersions(source.version, target.version);

    if (source.version !== OPENCLAW_PHASE_2B_SOURCE_VERSION) {
      blockers.push({ code: "wrong-version", message: `Phase 2B requires source OpenClaw ${OPENCLAW_PHASE_2B_SOURCE_VERSION}; found ${source.version}.` });
    }
    if (target.version !== OPENCLAW_PHASE_2B_TARGET_VERSION || target.sourceCommit !== OPENCLAW_PHASE_2B_TARGET_COMMIT) {
      blockers.push({ code: "wrong-version", message: `Phase 2B requires target OpenClaw ${OPENCLAW_PHASE_2B_TARGET_VERSION} at ${OPENCLAW_PHASE_2B_TARGET_COMMIT}.` });
    }
    if (versionOrder === null) blockers.push({ code: "invalid-target", message: "Source and target OpenClaw versions are not comparable semantic versions." });
    else if (versionOrder >= 0) blockers.push({ code: "downgrade", message: "Migration engine accepts only a strict source-to-newer-target upgrade." });
    if (!(await pathExists(paths.sourceStateDir))) blockers.push({ code: "missing-path", message: "Source OpenClaw state directory does not exist." });
    if (!(await pathExists(source.packageRoot))) blockers.push({ code: "missing-path", message: "Source OpenClaw package root does not exist." });
    if (this.input.activeOwnerDetected) blockers.push({ code: "active-owner", message: "OpenClaw state ownership is live; stop the current Gateway before migration." });
    if (supervisorMode === "external") blockers.push({ code: "external-supervisor", message: "External supervisor owns Gateway replacement; AgentOS will not replace its runtime or process." });
    if (!this.input.installPackageRoot) warnings.push("No managed install package root was supplied; this plan can validate and certify but has no runtime replacement target.");
    if (!(await pathExists(paths.sourceConfigPath))) warnings.push("Source config was not found; target migration will decide whether a default config is safe.");

    return {
      schemaVersion: 1,
      planId,
      createdAt: new Date().toISOString(),
      mode: this.input.mode ?? "execute",
      source,
      target,
      paths,
      supervisor: {
        mode: supervisorMode,
        replacementAllowed: supervisorMode === "agentos-managed" && blockers.every((blocker) => blocker.code !== "external-supervisor"),
        reason: supervisorMode === "external"
          ? "External supervisor boundary is active; only analysis, plan, and snapshot are allowed."
          : "AgentOS-managed lifecycle permits replacement after certification and explicit commit."
      },
      steps: STEP_DEFINITIONS.map((step) => ({ ...step, status: "pending" })),
      blockers,
      warnings,
      mutationBoundary: {
        snapshotBeforeMutation: true,
        commitAfterCertification: true,
        targetStateIsolatedUntilCommit: true
      }
    };
  }

  async dryRun(): Promise<OpenClawMigrationInspectResult & { mutationCount: number; mutations: string[] }> {
    const inspected = await new OpenClawMigrationEngine({ ...this.input, mode: "dry-run" }, this.hooks).inspect();
    return {
      ...inspected,
      mutationCount: inspected.plan.steps.filter((step) => step.mutation).length,
      mutations: inspected.plan.steps.filter((step) => step.mutation).map((step) => step.description)
    };
  }

  async execute(plan: OpenClawMigrationPlan): Promise<OpenClawMigrationRun> {
    const runRoot = path.join(plan.paths.workRoot, "runs", plan.planId);
    await mkdir(runRoot, { recursive: true, mode: 0o700 });
    await writeFile(path.join(runRoot, "plan.json"), `${JSON.stringify(redactSecrets(plan), null, 2)}\n`, { mode: 0o600 });
    let run = await readExistingRun(path.join(runRoot, "migration-journal.json"));
    if (!run) run = await createMigrationRun({ plan, runId: plan.planId, root: runRoot });

    if (plan.mode === "dry-run") {
      return run;
    }
    const onlyExternalSupervisorBlocker = plan.blockers.length > 0 && plan.blockers.every((blocker) => blocker.code === "external-supervisor");
    if (onlyExternalSupervisorBlocker) {
      try {
        for (const step of plan.steps.slice(0, 4)) {
          if (!run.completedSteps.includes(step.id)) run = await this.executeStep(plan, run, step, runRoot);
        }
        return await saveMigrationRun({
          ...run,
          state: "blocked",
          currentStep: null,
          recoveryRequired: false,
          evidence: [...run.evidence, this.evidence("preflight", "supervisor", "blocked", "Snapshot completed, but external supervisor still blocks runtime replacement.")]
        });
      } catch (error) {
        return await saveMigrationRun(failMigrationRun(run, error));
      }
    }
    if (plan.blockers.length > 0) {
      run = await saveMigrationRun({
        ...run,
        state: "blocked",
        recoveryRequired: false,
        evidence: [...run.evidence, this.evidence("preflight", "supervisor", "blocked", "Migration is blocked before state mutation.", { blockers: plan.blockers })]
      });
      return run;
    }

    try {
      for (const step of plan.steps) {
        if (run.completedSteps.includes(step.id)) continue;
        run = await this.executeStep(plan, run, step, runRoot);
      }
      run = await saveMigrationRun({ ...run, state: "completed", currentStep: null, recoveryRequired: false });
    } catch (error) {
      const state = run.snapshot ? "rollback-required" : "failed";
      run = await saveMigrationRun(failMigrationRun(run, error, state));
    } finally {
      await this.stopGateway(plan.planId);
    }
    return run;
  }

  async resume(journalPath: string) {
    let run = await readMigrationRun(journalPath);
    const plan = JSON.parse(await readFile(path.join(path.dirname(journalPath), "plan.json"), "utf8")) as OpenClawMigrationPlan;
    if (run.commitPointReached) throw new Error("Committed migration cannot be resumed automatically; use rollback or recovery review.");
    if (run.state === "interrupted") {
      const restartFrom = new Set<OpenClawMigrationStepId>(["start-target", "post-upgrade-doctor", "runtime-certification", "preservation", "commit", "cleanup"]);
      run = await saveMigrationRun({
        ...run,
        state: "planned",
        currentStep: null,
        recoveryRequired: false,
        completedSteps: run.completedSteps.filter((step) => !restartFrom.has(step))
      });
    }
    return this.execute(plan);
  }

  async markInterrupted(journalPath: string) {
    const run = await readMigrationRun(journalPath);
    if (run.commitPointReached) throw new Error("A committed migration cannot be marked interrupted.");
    return saveMigrationRun({ ...run, state: "interrupted", currentStep: null, recoveryRequired: true });
  }

  async rollback(journalPath: string): Promise<OpenClawMigrationRun> {
    let run = await readMigrationRun(journalPath);
    const plan = JSON.parse(await readFile(path.join(path.dirname(journalPath), "plan.json"), "utf8")) as OpenClawMigrationPlan;
    if (!run.snapshot) throw new Error("Migration rollback requires a verified snapshot.");
    if (plan.supervisor.mode === "external") throw new Error("External supervisor owns runtime replacement; AgentOS cannot perform rollback.");
    if (this.input.activeOwnerDetected) throw new Error("Rollback is blocked while OpenClaw state ownership is live.");

    const snapshot = run.snapshot;
    run = await saveMigrationRun({ ...run, state: "rolling-back", currentStep: null, recoveryRequired: true });
    try {
      await this.stopGateway(plan.planId);
      await restoreMigrationSnapshot({ snapshot, stateDir: plan.paths.sourceStateDir, configPath: plan.paths.sourceConfigPath });
      if (plan.paths.installPackageRoot && run.rollback?.restorePackageRoot) {
        await replaceDirectory(run.rollback.restorePackageRoot, plan.paths.installPackageRoot);
      }
      run = addMigrationEvidence(run, this.evidence("commit", "rollback", "pass", "Verified pre-upgrade state, config, and managed runtime were restored."));
      return await saveMigrationRun({ ...run, state: "rolled-back", recoveryRequired: false, commitPointReached: false, errors: [] });
    } catch (error) {
      return await saveMigrationRun(failMigrationRun(run, error, "recovery-required"));
    }
  }

  async finalReport(journalPath: string) {
    const run = await readMigrationRun(journalPath);
    const gate = buildSuccessGate(run);
    return { run, successGate: gate };
  }

  private async executeStep(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, step: OpenClawMigrationStep, runRoot: string) {
    if (this.shouldInjectFailure(step.id)) throw new Error(`Deterministic failure injection at migration step ${step.id}.`);
    run = await saveMigrationRun({ ...beginMigrationStep(run, step.id), state: step.state });
    switch (step.id) {
      case "inspect":
        run = await this.stepInspect(plan, run);
        break;
      case "preflight":
        run = await this.stepPreflight(plan, run);
        break;
      case "plan":
        run = this.addEvidence(run, this.evidence("plan", "journal", "pass", "Deterministic migration plan persisted before mutation."));
        break;
      case "snapshot":
        run = await this.stepSnapshot(plan, run, runRoot);
        break;
      case "stage-target":
        run = await this.stepStageTarget(plan, run, runRoot);
        break;
      case "validate-target":
        run = await this.stepValidateTarget(plan, run);
        break;
      case "migrate-state":
        run = await this.stepMigrateState(plan, run);
        break;
      case "start-target":
        run = await this.stepStartTarget(plan, run);
        break;
      case "post-upgrade-doctor":
        run = await this.stepPostUpgradeDoctor(plan, run);
        break;
      case "runtime-certification":
        run = await this.stepRuntimeCertification(plan, run);
        break;
      case "preservation":
        run = await this.stepPreservation(plan, run, runRoot);
        break;
      case "commit":
        run = await this.stepCommit(plan, run, runRoot);
        break;
      case "cleanup":
        run = await this.stepCleanup(plan, run, runRoot);
        break;
    }
    return saveMigrationRun(completeMigrationStep(run, step.id));
  }

  private async stepInspect(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    const sourceState = await countStateFiles(plan.paths.sourceStateDir);
    return this.addEvidence(run, this.evidence("inspect", "identity", "pass", "Source and target runtime identities and state inventory were inspected.", {
      sourceVersion: plan.source.version,
      sourceCommit: plan.source.sourceCommit,
      targetVersion: plan.target.version,
      targetCommit: plan.target.sourceCommit,
      sourceFileCount: sourceState.fileCount,
      sourceSqliteCount: sourceState.sqliteCount
    }));
  }

  private async stepPreflight(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    return this.addEvidence(run, this.evidence("preflight", "supervisor", "pass", plan.supervisor.reason, {
      replacementAllowed: plan.supervisor.replacementAllowed,
      stateOwner: this.input.activeOwnerDetected ? "live" : "not-detected"
    }));
  }

  private async stepSnapshot(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, runRoot: string) {
    if (run.snapshot) return run;
    const snapshot = await createMigrationSnapshot({
      snapshotId: `snapshot-${plan.planId}`,
      sourceVersion: plan.source.version,
      sourceCommit: plan.source.sourceCommit,
      stateDir: plan.paths.sourceStateDir,
      configPath: plan.paths.sourceConfigPath,
      destinationRoot: path.join(runRoot, "snapshot")
    });
    const sourcePreservation = await captureStatePreservation({ stateDir: plan.paths.sourceStateDir, configPath: plan.paths.sourceConfigPath, workspaceRelativePrefix: "workspace" });
    await writeFile(path.join(runRoot, "source-preservation.json"), `${JSON.stringify(sourcePreservation, null, 2)}\n`, { mode: 0o600 });
    let restorePackageRoot: string | null = null;
    if (plan.paths.installPackageRoot && await pathExists(plan.paths.installPackageRoot)) {
      restorePackageRoot = path.join(runRoot, "source-runtime");
      if (!(await pathExists(restorePackageRoot))) await cp(plan.paths.installPackageRoot, restorePackageRoot, { recursive: true, force: false, errorOnExist: true });
    }
    const rollback: OpenClawMigrationRollbackPlan = {
      snapshotId: snapshot.snapshotId,
      snapshotRoot: snapshot.root,
      source: plan.source,
      target: plan.target,
      restoreStateDir: plan.paths.sourceStateDir,
      restoreConfigPath: plan.paths.sourceConfigPath,
      restorePackageRoot,
      safe: snapshot.verified,
      reasons: snapshot.verified ? ["Snapshot integrity and SQLite checks passed before mutation."] : ["Snapshot verification did not pass."]
    };
    return this.addEvidence({ ...run, snapshot, rollback }, this.evidence("snapshot", "sqlite", "pass", "State, config, runtime, and WAL-aware SQLite snapshot verified before mutation.", {
      snapshotId: snapshot.snapshotId,
      files: snapshot.files.length,
      sqlite: snapshot.sqlite.length,
      config: Boolean(snapshot.config)
    }));
  }

  private async stepStageTarget(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, runRoot: string) {
    const stagedPackageRoot = path.join(runRoot, "staged-target");
    if (!(await pathExists(stagedPackageRoot))) {
      await cp(plan.target.packageRoot, stagedPackageRoot, { recursive: true, force: false, errorOnExist: true });
    }
    const stagedBinaryPath = resolveStagedBinary(plan, stagedPackageRoot);
    const stagedIdentity = await readOpenClawRuntimeIdentity({ binaryPath: stagedBinaryPath, packageRoot: stagedPackageRoot });
    if (stagedIdentity.version !== plan.target.version || stagedIdentity.sourceCommit !== plan.target.sourceCommit) throw new Error("Staged target identity does not match the planned OpenClaw target.");
    if (!run.snapshot) throw new Error("Target staging requires a verified snapshot.");
    await copySnapshotState({ snapshot: run.snapshot, destinationStateDir: plan.paths.targetStateDir });
    if (run.snapshot.config) {
      await mkdir(path.dirname(plan.paths.targetConfigPath), { recursive: true, mode: 0o700 });
      await cp(path.join(run.snapshot.root, run.snapshot.config.relativePath), plan.paths.targetConfigPath, { force: true });
    }
    return this.addEvidence(run, this.evidence("stage-target", "identity", "pass", "Exact target package and isolated source state staged side by side.", { stagedPackageRoot }));
  }

  private async stepValidateTarget(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    const binaryPath = resolveStagedBinary(plan, path.join(plan.paths.workRoot, "runs", plan.planId, "staged-target"));
    const result = await this.command(binaryPath, ["doctor", "--lint", "--json", "--no-workspace-suggestions"], plan);
    const parsed = parseCommandJson(result);
    if (result.exitCode !== 0 && !parsed) throw new Error(`Target doctor lint preflight failed: ${result.stderr || result.stdout || "no diagnostic"}`);
    if (parsed && readString(parsed.status) === "incompatible") throw new Error("Target doctor reported an incompatible preflight state.");
    let next = this.addEvidence(run, this.commandEvidence("validate-target", result, "doctor", parsed ? "Target read-only doctor lint completed with structured output." : "Target doctor lint emitted a non-JSON advisory result."));
    const sqlitePaths = await findSqlitePaths(plan.paths.targetStateDir);
    for (const sqlitePath of sqlitePaths) {
      const preflight = await this.command(binaryPath, ["database", "preflight", "--json", sqlitePath], plan);
      const preflightJson = parseCommandJson(preflight);
      if (preflight.exitCode !== 0 && !preflightJson) throw new Error(`Target SQLite preflight failed for ${sqlitePath}.`);
      next = this.addEvidence(next, this.commandEvidence("validate-target", preflight, "sqlite", "Target SQLite schema preflight completed.", { path: path.relative(plan.paths.targetStateDir, sqlitePath) }));
    }
    return next;
  }

  private async stepMigrateState(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    const binaryPath = resolveStagedBinary(plan, path.join(plan.paths.workRoot, "runs", plan.planId, "staged-target"));
    const result = await this.command(binaryPath, ["doctor", "--fix", "--non-interactive", "--yes", "--no-workspace-suggestions"], plan);
    if (result.exitCode !== 0) throw new Error(`Target state migration failed: ${result.stderr || result.stdout || "no diagnostic"}`);
    let next = this.addEvidence(run, this.commandEvidence("migrate-state", result, "command", "Target explicit doctor repair completed in isolated state."));
    const lint = await this.command(binaryPath, ["doctor", "--lint", "--json", "--no-workspace-suggestions"], plan);
    if (lint.exitCode !== 0 && !parseCommandJson(lint)) throw new Error("Target doctor lint failed after state migration.");
    next = this.addEvidence(next, this.commandEvidence("migrate-state", lint, "doctor", "Post-migration read-only doctor lint completed."));
    return next;
  }

  private async stepStartTarget(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    if (!this.hooks.gateway) throw new Error("Runtime certification requires a Gateway start adapter; refusing to run an unobserved migration.");
    const token = requireMigrationGatewayToken(this.input.gatewayToken);
    const port = this.input.gatewayPort ?? 28789;
    const handle = await this.hooks.gateway.start({
      binaryPath: resolveStagedBinary(plan, path.join(plan.paths.workRoot, "runs", plan.planId, "staged-target")),
      stateDir: plan.paths.targetStateDir,
      configPath: plan.paths.targetConfigPath,
      port,
      token
    });
    this.gatewayHandles.set(plan.planId, { stop: handle.stop });
    return this.addEvidence(run, this.evidence("start-target", "runtime", "pass", "Target Gateway started against isolated migrated state.", { pid: handle.pid, port }));
  }

  private async stepPostUpgradeDoctor(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    const binaryPath = resolveStagedBinary(plan, path.join(plan.paths.workRoot, "runs", plan.planId, "staged-target"));
    const result = await this.command(binaryPath, ["doctor", "--post-upgrade", "--json", "--no-workspace-suggestions"], plan);
    const parsed = parseCommandJson(result);
    if (result.exitCode !== 0 && !parsed) throw new Error(`Target post-upgrade doctor failed: ${result.stderr || result.stdout || "no diagnostic"}`);
    return this.addEvidence(run, this.commandEvidence("post-upgrade-doctor", result, "doctor", "Target post-upgrade doctor completed with machine-readable evidence."));
  }

  private async stepRuntimeCertification(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun) {
    if (!this.hooks.certify) throw new Error("Runtime certification adapter is not configured; refusing to cross the migration commit point.");
    const token = requireMigrationGatewayToken(this.input.gatewayToken);
    const evidence = await this.hooks.certify({
      binaryPath: resolveStagedBinary(plan, path.join(plan.paths.workRoot, "runs", plan.planId, "staged-target")),
      stateDir: plan.paths.targetStateDir,
      configPath: plan.paths.targetConfigPath,
      gatewayUrl: `ws://127.0.0.1:${this.input.gatewayPort ?? 28789}`,
      token
    });
    if (evidence.status !== "pass") throw new Error(`Runtime certification did not pass: ${evidence.summary}`);
    return this.addEvidence(run, evidence);
  }

  private async stepPreservation(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, runRoot: string) {
    const sourceRaw = await readFile(path.join(runRoot, "source-preservation.json"), "utf8");
    const source = JSON.parse(sourceRaw) as Awaited<ReturnType<typeof captureStatePreservation>>;
    const target = await captureStatePreservation({ stateDir: plan.paths.targetStateDir, configPath: plan.paths.targetConfigPath, workspaceRelativePrefix: "workspace" });
    const comparison = compareStatePreservation(source, target);
    await writeFile(path.join(runRoot, "preservation-report.json"), `${JSON.stringify(redactSecrets(comparison), null, 2)}\n`, { mode: 0o600 });
    if (!comparison.pass) throw new Error(`State preservation failed: ${comparison.checks.filter((check) => !check.pass).map((check) => check.detail).join(" ")}`);
    return this.addEvidence(run, this.evidence("preservation", "preservation", "pass", "Source state preservation checks passed.", { checks: comparison.checks }));
  }

  private async stepCommit(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, runRoot: string) {
    if (!plan.paths.installPackageRoot) throw new Error("Migration commit requires an explicit managed install package root.");
    if (!run.snapshot || !run.rollback) throw new Error("Migration commit requires a verified snapshot and rollback plan.");
    const stagedPackageRoot = path.join(runRoot, "staged-target");
    const packageBackup = path.join(runRoot, "managed-package-before-commit");
    const stateBackup = path.join(runRoot, "live-state-before-commit");
    const configBackup = path.join(runRoot, "live-config-before-commit.json");
    if (await pathExists(plan.paths.installPackageRoot)) await rename(plan.paths.installPackageRoot, packageBackup);
    try {
      await rename(stagedPackageRoot, plan.paths.installPackageRoot);
      if (await pathExists(plan.paths.sourceStateDir)) await rename(plan.paths.sourceStateDir, stateBackup);
      await rename(plan.paths.targetStateDir, plan.paths.sourceStateDir);
      if (await pathExists(plan.paths.sourceConfigPath)) await rename(plan.paths.sourceConfigPath, configBackup);
      if (await pathExists(plan.paths.targetConfigPath)) {
        await mkdir(path.dirname(plan.paths.sourceConfigPath), { recursive: true, mode: 0o700 });
        await rename(plan.paths.targetConfigPath, plan.paths.sourceConfigPath);
      }
    } catch (error) {
      await restoreCommitBackups({ plan, packageBackup, stateBackup, configBackup });
      throw error;
    }
    const nextRollback = { ...run.rollback, restorePackageRoot: packageBackup };
    return this.addEvidence({ ...run, rollback: nextRollback, commitPointReached: true }, this.evidence("commit", "journal", "pass", "Explicit migration commit point reached after all required gates passed.", { packageRoot: plan.paths.installPackageRoot }));
  }

  private async stepCleanup(plan: OpenClawMigrationPlan, run: OpenClawMigrationRun, runRoot: string) {
    await rm(path.join(runRoot, "staged-target"), { recursive: true, force: true });
    await rm(plan.paths.targetStateDir, { recursive: true, force: true });
    await rm(path.dirname(plan.paths.targetConfigPath), { recursive: true, force: true });
    return this.addEvidence(run, this.evidence("cleanup", "journal", "pass", "Disposable staging paths were cleaned; verified snapshot and journal were retained."));
  }

  private async command(binaryPath: string, args: string[], plan: OpenClawMigrationPlan) {
    const result = await this.hooks.runCommand({
      binaryPath,
      args,
      env: {
        OPENCLAW_STATE_DIR: plan.paths.targetStateDir,
        OPENCLAW_CONFIG_PATH: plan.paths.targetConfigPath,
        OPENCLAW_GATEWAY_TOKEN: this.input.gatewayToken
      },
      cwd: plan.paths.workRoot,
      timeoutMs: this.input.commandTimeoutMs ?? DEFAULT_MIGRATION_COMMAND_TIMEOUT_MS
    });
    return { ...result, stdout: redactSecretText(result.stdout), stderr: redactSecretText(result.stderr) };
  }

  private addEvidence(run: OpenClawMigrationRun, evidence: OpenClawMigrationEvidence) {
    return addMigrationEvidence(run, evidence);
  }

  private evidence(step: OpenClawMigrationStepId, kind: OpenClawMigrationEvidence["kind"], status: OpenClawMigrationEvidence["status"], summary: string, details?: Record<string, unknown>): OpenClawMigrationEvidence {
    return { id: `evidence-${randomUUID()}`, step, kind, status, summary, details, createdAt: new Date().toISOString() };
  }

  private commandEvidence(step: OpenClawMigrationStepId, result: OpenClawMigrationCommandResult, kind: OpenClawMigrationEvidence["kind"], summary: string, details?: Record<string, unknown>) {
    return this.evidence(step, kind, result.exitCode === 0 ? "pass" : "warning", summary, {
      ...details,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout.slice(-4_000),
      stderr: result.stderr.slice(-4_000)
    });
  }

  private shouldInjectFailure(step: OpenClawMigrationStepId) {
    const injection = this.input.failureInjection;
    if (!injection || injection.step !== step) return false;
    if (injection.once !== false && this.injectedFailureUsed.has(step)) return false;
    this.injectedFailureUsed.add(step);
    return true;
  }

  private async stopGateway(planId: string) {
    const handle = this.gatewayHandles.get(planId);
    if (!handle) return;
    this.gatewayHandles.delete(planId);
    await handle.stop().catch(() => {});
  }
}

export function buildSuccessGate(run: OpenClawMigrationRun): OpenClawMigrationSuccessGate {
  const evidence = run.evidence;
  const has = (step: OpenClawMigrationStepId, kind?: OpenClawMigrationEvidence["kind"]) => evidence.some((entry) => entry.step === step && entry.status === "pass" && (!kind || entry.kind === kind));
  const runtimeEvidence = evidence.find((entry) => entry.step === "runtime-certification" && entry.status === "pass");
  const runtimeChecks = new Set(Array.isArray(runtimeEvidence?.details?.checks) ? runtimeEvidence.details.checks.filter((value): value is string => typeof value === "string") : []);
  const checks = [
    { id: "source-version", pass: evidence.some((entry) => entry.step === "inspect" && entry.status === "pass" && entry.details?.sourceVersion === OPENCLAW_PHASE_2B_SOURCE_VERSION), required: true, detail: `Source version must be ${OPENCLAW_PHASE_2B_SOURCE_VERSION}.` },
    { id: "exact-target", pass: evidence.some((entry) => entry.step === "inspect" && entry.status === "pass" && entry.details?.targetCommit === OPENCLAW_PHASE_2B_TARGET_COMMIT), required: true, detail: `Target commit must be ${OPENCLAW_PHASE_2B_TARGET_COMMIT}.` },
    { id: "snapshot", pass: Boolean(run.snapshot?.verified) && has("snapshot", "sqlite"), required: true, detail: "Verified snapshot was recorded before mutation." },
    { id: "sqlite", pass: Boolean(run.snapshot?.sqlite.length), required: true, detail: "At least one WAL-aware SQLite snapshot was verified." },
    { id: "state-migration", pass: has("migrate-state"), required: true, detail: "Explicit target state migration completed." },
    { id: "doctor", pass: has("post-upgrade-doctor", "doctor"), required: true, detail: "Post-upgrade doctor evidence passed." },
    { id: "runtime-certification", pass: has("runtime-certification", "runtime") && runtimeChecks.has("gateway.health"), required: true, detail: "Runtime certification passed." },
    { id: "model", pass: runtimeChecks.has("model"), required: true, detail: "Model execution was certified." },
    { id: "streaming", pass: runtimeChecks.has("streaming"), required: true, detail: "Streaming execution was certified." },
    { id: "restart", pass: runtimeChecks.has("gateway.restart"), required: true, detail: "Gateway restart behavior was certified." },
    { id: "cron", pass: runtimeChecks.has("cron.run"), required: true, detail: "cron.run and run-history polling were certified." },
    { id: "preservation", pass: has("preservation", "preservation"), required: true, detail: "State preservation passed." },
    { id: "commit", pass: run.commitPointReached && has("commit", "journal"), required: true, detail: "Explicit migration commit point was reached." },
    { id: "journal", pass: Boolean(run.journalHash) && ["completed", "rolled-back"].includes(run.state), required: true, detail: "Migration journal is integrity-protected and reached a terminal state." },
    { id: "cleanup", pass: has("cleanup", "journal"), required: true, detail: "Disposable staging was cleaned while rollback evidence remained." }
  ];
  return { pass: run.state === "completed" && checks.every((check) => !check.required || check.pass), checks };
}

function resolveSupervisorMode(input: OpenClawMigrationEngineInput["supervisorMode"]): "agentos-managed" | "external" | "unknown" {
  if (input === "external") return "external";
  if (input === "agentos-managed") return "agentos-managed";
  if (process.env.OPENCLAW_SUPERVISOR_MODE?.trim().toLowerCase() === "external") return "external";
  const deployment = resolveAgentOsDeploymentCapabilities();
  if (deployment.gatewayLifecycle === "supervisor-managed") return "external";
  if (deployment.gatewayLifecycle === "agentos-managed") return "agentos-managed";
  return "unknown";
}

function resolveStagedBinary(plan: OpenClawMigrationPlan, stagedPackageRoot: string) {
  const relativePath = path.relative(plan.target.packageRoot, plan.target.binaryPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) throw new Error("Target binary is outside its declared package root.");
  return path.join(stagedPackageRoot, relativePath);
}

function parseCommandJson(result: OpenClawMigrationCommandResult) {
  const outputs = [result.stdout, result.stderr];
  for (const output of outputs) {
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {}
    }
  }
  return null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requireMigrationGatewayToken(inputToken: string | undefined) {
  const token = inputToken?.trim() || process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token) throw new Error("A Gateway token is required for migration runtime certification.");
  return token;
}

async function countStateFiles(root: string) {
  let fileCount = 0;
  let sqliteCount = 0;
  const visit = async (current: string): Promise<void> => {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(current, { withFileTypes: true }));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && !entry.name.endsWith("-wal") && !entry.name.endsWith("-shm") && !entry.name.endsWith("-journal")) {
        fileCount += 1;
        if (entry.name.endsWith(".sqlite") || entry.name.endsWith(".db")) sqliteCount += 1;
      }
    }
  };
  if (await pathExists(root)) await visit(root);
  return { fileCount, sqliteCount };
}

async function findSqlitePaths(root: string) {
  const result: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(current, { withFileTypes: true }));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && (entry.name.endsWith(".sqlite") || entry.name.endsWith(".db"))) result.push(child);
    }
  };
  if (await pathExists(root)) await visit(root);
  return result.sort();
}

async function readExistingRun(journalPath: string) {
  return await pathExists(journalPath) ? readMigrationRun(journalPath) : null;
}

async function replaceDirectory(source: string, destination: string) {
  const backup = `${destination}.rollback-${randomUUID()}`;
  if (await pathExists(destination)) await rename(destination, backup);
  try {
    await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    if (await pathExists(backup)) await rename(backup, destination);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function restoreCommitBackups(input: { plan: OpenClawMigrationPlan; packageBackup: string; stateBackup: string; configBackup: string }) {
  if (input.plan.paths.installPackageRoot && await pathExists(input.packageBackup)) {
    await rm(input.plan.paths.installPackageRoot, { recursive: true, force: true });
    await rename(input.packageBackup, input.plan.paths.installPackageRoot);
  }
  if (await pathExists(input.stateBackup)) {
    await rm(input.plan.paths.sourceStateDir, { recursive: true, force: true });
    await rename(input.stateBackup, input.plan.paths.sourceStateDir);
  }
  if (await pathExists(input.configBackup)) {
    await rm(input.plan.paths.sourceConfigPath, { force: true });
    await mkdir(path.dirname(input.plan.paths.sourceConfigPath), { recursive: true, mode: 0o700 });
    await rename(input.configBackup, input.plan.paths.sourceConfigPath);
  }
}
