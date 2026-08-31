import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildSuccessGate,
  OpenClawMigrationEngine,
  OPENCLAW_PHASE_2B_TARGET_COMMIT,
  OPENCLAW_PHASE_2B_TARGET_VERSION
} from "@/lib/openclaw/migration-engine/engine";
import { readMigrationRun } from "@/lib/openclaw/migration-engine/journal";
import type { OpenClawMigrationCommandResult, OpenClawMigrationRuntimeHooks } from "@/lib/openclaw/migration-engine/types";

test("OpenClaw migration dry-run is structured and mutation-free", async () => {
  const fixture = await createFixture();
  try {
    const workRoot = path.join(fixture.root, "dry-run-work");
    const result = await new OpenClawMigrationEngine({ ...fixture.input, workRoot, mode: "dry-run" }, createHooks()).dryRun();
    assert.equal(result.plan.mode, "dry-run");
    assert.equal(result.mutationCount > 0, true);
    assert.equal(await pathExists(workRoot), false);
    assert.equal(result.plan.target.sourceCommit, OPENCLAW_PHASE_2B_TARGET_COMMIT);
  } finally {
    await fixture.close();
  }
});

test("OpenClaw migration creates a verified WAL-aware snapshot and commits only after gates", async () => {
  const fixture = await createFixture();
  try {
    const engine = new OpenClawMigrationEngine(fixture.input, createHooks());
    const plan = await engine.createPlan();
    const run = await engine.execute(plan);
    assert.equal(run.state, "completed", JSON.stringify({ errors: run.errors, currentStep: run.currentStep, completedSteps: run.completedSteps }));
    assert.equal(run.commitPointReached, true);
    assert.equal(run.snapshot?.verified, true);
    assert.equal(run.snapshot?.sqlite.length, 1);
    assert.equal(await readFile(path.join(fixture.installRoot, "package.json"), "utf8").then((value) => JSON.parse(value).version), OPENCLAW_PHASE_2B_TARGET_VERSION);
    assert.equal(await readFile(path.join(fixture.stateDir, "workspace", "marker.md"), "utf8"), "preserved\n");
    const gate = buildSuccessGate(run);
    assert.equal(gate.pass, true);
    assert.equal((await readMigrationRun(run.journalPath)).journalHash, run.journalHash);
  } finally {
    await fixture.close();
  }
});

test("OpenClaw migration blocks external supervisor replacement while allowing planning", async () => {
  const fixture = await createFixture();
  try {
    const input = { ...fixture.input, supervisorMode: "external" as const, workRoot: path.join(fixture.root, "external-work") };
    const engine = new OpenClawMigrationEngine(input, createHooks());
    const plan = await engine.createPlan();
    assert.equal(plan.blockers.some((blocker) => blocker.code === "external-supervisor"), true);
    const run = await engine.execute(plan);
    assert.equal(run.state, "blocked");
    assert.equal(run.snapshot?.verified, true);
    assert.equal(await readFile(path.join(fixture.installRoot, "package.json"), "utf8").then((value) => JSON.parse(value).version), "2026.6.11");
  } finally {
    await fixture.close();
  }
});

test("OpenClaw migration failure is journaled and rollback restores source package and state", async () => {
  const fixture = await createFixture();
  try {
    const input = { ...fixture.input, failureInjection: { step: "runtime-certification" as const, once: true } };
    const engine = new OpenClawMigrationEngine(input, createHooks());
    const plan = await engine.createPlan();
    const failed = await engine.execute(plan);
    assert.equal(failed.state, "rollback-required", JSON.stringify({ errors: failed.errors, currentStep: failed.currentStep, completedSteps: failed.completedSteps }));
    assert.equal(failed.recoveryRequired, true);
    assert.equal(await readFile(path.join(fixture.installRoot, "package.json"), "utf8").then((value) => JSON.parse(value).version), "2026.6.11");
    const restored = await engine.rollback(failed.journalPath);
    assert.equal(restored.state, "rolled-back");
    assert.equal(restored.recoveryRequired, false);
    assert.equal(await readFile(path.join(fixture.stateDir, "workspace", "marker.md"), "utf8"), "preserved\n");
  } finally {
    await fixture.close();
  }
});

test("OpenClaw migration resumes an interrupted run from its durable journal", async () => {
  const fixture = await createFixture();
  try {
    const input = { ...fixture.input, failureInjection: { step: "start-target" as const, once: true } };
    const engine = new OpenClawMigrationEngine(input, createHooks());
    const plan = await engine.createPlan();
    const failed = await engine.execute(plan);
    assert.equal(failed.state, "rollback-required");
    const interrupted = await engine.markInterrupted(failed.journalPath);
    assert.equal(interrupted.state, "interrupted");
    const resumed = await engine.resume(failed.journalPath);
    assert.equal(resumed.state, "completed");
    assert.equal(buildSuccessGate(resumed).pass, true, JSON.stringify(buildSuccessGate(resumed).checks.filter((check) => !check.pass)));
  } finally {
    await fixture.close();
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-migration-test-"));
  const sourcePackage = await createPackage(root, "source-package", "2026.6.11", "e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2");
  const targetPackage = await createPackage(root, "target-package", OPENCLAW_PHASE_2B_TARGET_VERSION, OPENCLAW_PHASE_2B_TARGET_COMMIT);
  const installRoot = path.join(root, "managed-package");
  await copyDirectory(sourcePackage, installRoot);
  const stateDir = path.join(root, "live-state");
  await mkdir(path.join(stateDir, "workspace"), { recursive: true });
  await writeFile(path.join(stateDir, "workspace", "marker.md"), "preserved\n");
  await writeFile(path.join(stateDir, "sessions.json"), JSON.stringify({ sessions: [{ id: "legacy-session-1", agentId: "dev" }] }));
  await writeFile(path.join(stateDir, "session-legacy.jsonl"), '{"role":"user","content":"before"}\n{"role":"assistant","content":"after"}\n');
  const sqlite = new DatabaseSync(path.join(stateDir, "openclaw.sqlite"));
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE cron_jobs (id TEXT PRIMARY KEY, name TEXT); INSERT INTO cron_jobs VALUES ('cron-fixture-1', 'Fixture cron');");
  assert.equal((await stat(`${path.join(stateDir, "openclaw.sqlite")}-wal`)).isFile(), true);
  const configDir = path.join(root, "live-config");
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "openclaw.json");
  await writeFile(configPath, `${JSON.stringify({ gateway: { mode: "local" }, agents: { list: [{ id: "dev", model: "agentos-runtime-fixture" }] }, models: { providers: { fixture: { baseUrl: "http://127.0.0.1" } } } }, null, 2)}\n`);
  return {
    root,
    stateDir,
    installRoot,
    input: {
      sourceBinaryPath: path.join(sourcePackage, "openclaw.mjs"),
      sourcePackageRoot: sourcePackage,
      targetBinaryPath: path.join(targetPackage, "openclaw.mjs"),
      targetPackageRoot: targetPackage,
      sourceStateDir: stateDir,
      sourceConfigPath: configPath,
      installPackageRoot: installRoot,
      workRoot: path.join(root, "work"),
      gatewayToken: "unit-test-token"
    },
    close: async () => {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function createPackage(root: string, name: string, version: string, commit: string) {
  const packageRoot = path.join(root, name);
  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(path.join(packageRoot, "openclaw.mjs"), "#!/usr/bin/env node\n");
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "openclaw", version, bin: { openclaw: "openclaw.mjs" } }));
  await writeFile(path.join(packageRoot, "dist", "build-info.json"), JSON.stringify({ version, commit, buildId: `${version}-${commit.slice(0, 12)}` }));
  return packageRoot;
}

function createHooks(): OpenClawMigrationRuntimeHooks {
  return {
    runCommand: async (input): Promise<OpenClawMigrationCommandResult> => ({
      command: "fixture-openclaw",
      args: [input.binaryPath, ...input.args],
      exitCode: 0,
      signal: null,
      stdout: input.args.includes("--post-upgrade")
        ? JSON.stringify({ probesRun: ["plugins"], findings: [] })
        : input.args.includes("database")
          ? JSON.stringify({ status: "exact", schemaVersion: 15 })
          : JSON.stringify({ ok: true, status: "ok" }),
      stderr: "",
      durationMs: 1
    }),
    gateway: {
      start: async () => ({ pid: 4242, stop: async () => {} })
    },
    certify: async () => ({
      id: "runtime-certification",
      step: "runtime-certification",
      kind: "runtime",
      status: "pass",
      summary: "Fixture runtime certification passed.",
      details: { checks: ["gateway.health", "model", "streaming", "gateway.restart", "cron.run"] },
      createdAt: new Date().toISOString()
    })
  };
}

async function copyDirectory(source: string, destination: string) {
  await cp(source, destination, { recursive: true });
}

async function pathExists(filePath: string) {
  return stat(filePath).then(() => true).catch(() => false);
}
