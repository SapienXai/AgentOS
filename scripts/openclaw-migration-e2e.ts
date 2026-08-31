import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import WebSocket from "ws";

import { createDefaultMigrationRuntimeHooks } from "@/lib/openclaw/migration-engine/runtime";
import { OpenClawMigrationEngine, OPENCLAW_PHASE_2B_SOURCE_VERSION, OPENCLAW_PHASE_2B_TARGET_COMMIT, OPENCLAW_PHASE_2B_TARGET_VERSION, buildRollbackGate, buildSuccessGate } from "@/lib/openclaw/migration-engine/engine";
import { readOpenClawRuntimeIdentity } from "@/lib/openclaw/migration-engine/paths";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import { DEFAULT_NATIVE_TIMEOUT_MS, type WebSocketFactory } from "@/lib/openclaw/client/native-ws-gateway-types";
import { redactSecrets } from "@/lib/security/redaction";

const TARGET_PACKAGE_ROOT = process.env.OPENCLAW_MIGRATION_TARGET_PACKAGE?.trim() || "/tmp/agentos-openclaw-2026.8.1-runtime.3O13Q3/package";
const SOURCE_PACKAGE_INPUT = process.env.OPENCLAW_MIGRATION_SOURCE_PACKAGE?.trim() || "/tmp/agentos-openclaw-source-X2592F/openclaw-2026.6.11/package";
const OUTPUT_PATH = process.env.OPENCLAW_MIGRATION_E2E_OUTPUT?.trim() || "docs/evidence/openclaw-2026.6.11-to-2026.8.1-migration.json";
const KEEP_FIXTURE = process.env.OPENCLAW_MIGRATION_KEEP_FIXTURE === "1";

async function main() {
  const targetIdentity = await readOpenClawRuntimeIdentity({ binaryPath: path.join(TARGET_PACKAGE_ROOT, "openclaw.mjs"), packageRoot: TARGET_PACKAGE_ROOT });
  if (targetIdentity.version !== OPENCLAW_PHASE_2B_TARGET_VERSION || targetIdentity.sourceCommit !== OPENCLAW_PHASE_2B_TARGET_COMMIT) {
    throw new Error("The configured target package is not the exact OpenClaw 2026.8.1 target.");
  }

  const dependencyRoot = await createSourceDependencyRoot();
  let migration: Awaited<ReturnType<typeof runScenario>>;
  let rollback: Awaited<ReturnType<typeof runScenario>>;
  try {
    migration = await runScenario({ failureInjection: undefined, dependencyRoot });
    rollback = await runScenario({ failureInjection: { step: "post-commit-certification", once: true }, dependencyRoot });
  } finally {
    await rm(dependencyRoot, { recursive: true, force: true });
  }
  const migrationGate = buildSuccessGate(migration.run);
  const rollbackGate = buildRollbackGate(rollback.run);
  const rollbackPassed = rollbackGate.pass && rollback.sourceVersionRestored && rollback.stateRestored;
  const output = redactSecrets({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    provenance: {
      sourceVersion: OPENCLAW_PHASE_2B_SOURCE_VERSION,
      sourceCommit: "e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2",
      sourceTag: "v2026.6.11",
      targetVersion: OPENCLAW_PHASE_2B_TARGET_VERSION,
      targetCommit: OPENCLAW_PHASE_2B_TARGET_COMMIT,
      targetBuildId: targetIdentity.buildId,
      agentosRecommendedVersion: "2026.6.11",
      agentosSupportedBaseline: "2026.6.8"
    },
    fixture: {
      kind: "disposable-exact-source-runtime",
      provider: "loopback-http-fixture",
      externalCredentialRequired: false,
      externalCredentialUsed: false,
      isolatedGatewayPorts: [migration.port, rollback.port],
      cleanup: { migration: migration.cleaned, rollback: rollback.cleaned }
    },
    dryRun: sanitizeValue(migration.dryRun, migration.root),
    migration: sanitizeRun(migration.run, migration.root),
    successGate: migrationGate,
    rollback: {
      failedRun: sanitizeRun(rollback.failedRun, rollback.root),
      run: sanitizeRun(rollback.run, rollback.root),
      successGate: rollbackGate,
      pass: rollbackPassed,
      sourceVersionRestored: rollback.sourceVersionRestored,
      stateRestored: rollback.stateRestored
    },
    success: migrationGate.pass && rollbackPassed
  });
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(`MIGRATION SUCCESS GATE: ${migrationGate.pass ? "PASS" : "FAIL"}`);
  console.log(`ROLLBACK SUCCESS GATE: ${rollbackPassed ? "PASS" : "FAIL"}`);
  console.log(`Migration state: ${migration.run.state}; rollback state: ${rollback.run.state}.`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  return migrationGate.pass && rollbackPassed ? 0 : 1;
}

async function runScenario(options: { failureInjection?: { step: "post-commit-certification"; once: true }; dependencyRoot: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-migration-e2e-"));
  const provider = await createOpenClawRuntimeProviderFixture();
  const gatewayToken = randomBytes(24).toString("hex");
  const providerApiKey = randomBytes(24).toString("hex");
  let sourceGateway: { stop: () => Promise<void> } | null = null;
  let sourceDatabase: import("node:sqlite").DatabaseSync | null = null;
  try {
    const sourcePackage = path.join(root, "source-runtime");
    await cp(SOURCE_PACKAGE_INPUT, sourcePackage, { recursive: true, dereference: false });
    await rm(path.join(sourcePackage, "node_modules"), { recursive: true, force: true });
    await symlink(path.join(options.dependencyRoot, "node_modules"), path.join(sourcePackage, "node_modules"), "dir");
    const installRoot = path.join(root, "managed-package");
    await cp(sourcePackage, installRoot, { recursive: true, dereference: false });
    const stateDir = path.join(root, "live-state");
    const workspace = path.join(stateDir, "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await writeFile(path.join(workspace, "AGENTS.md"), "# Disposable Agent\n\nThis is an exact OpenClaw 6.11 migration fixture.\n");
    await writeFile(path.join(workspace, "preserved-marker.md"), "source-workspace-preserved\n");
    await writeFile(path.join(stateDir, "sessions.json"), JSON.stringify({ sessions: [{ id: "legacy-session-fixture", agentId: "dev", model: provider.modelId }] }));
    await writeFile(path.join(stateDir, "legacy-session-fixture.jsonl"), '{"role":"user","content":"fixture-before-migration"}\n');
    sourceDatabase = await createFixtureDatabase(path.join(stateDir, "migration-fixture.sqlite"));
    const configPath = path.join(root, "live-config", "openclaw.json");
    await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback" },
      agents: { defaults: { workspace, model: { primary: `agentos-fixture/${provider.modelId}` } }, list: [{ id: "dev", workspace }] },
      models: { mode: "merge", providers: { "agentos-fixture": { baseUrl: provider.baseUrl, api: "openai-completions", apiKey: providerApiKey, timeoutSeconds: 30, models: [{ id: provider.modelId, name: "AgentOS Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 128 }] } } },
      cron: { enabled: true }
    }, null, 2)}\n`);

    const sourcePort = await reservePort();
    const defaultHooks = createDefaultMigrationRuntimeHooks();
    if (!defaultHooks.gateway) throw new Error("Default Gateway adapter is unavailable.");
    sourceGateway = await defaultHooks.gateway.start({ binaryPath: path.join(installRoot, "openclaw.mjs"), stateDir, configPath, port: sourcePort, token: gatewayToken, phase: "rollback" });
    const seededSession = await seedRealSourceState(`ws://127.0.0.1:${sourcePort}`, provider.modelId, gatewayToken);
    await sourceGateway.stop();
    sourceGateway = null;
    await writeLegacySessionTranscript(stateDir, workspace, seededSession.sessionId);

    const input = {
      sourceBinaryPath: path.join(sourcePackage, "openclaw.mjs"),
      sourcePackageRoot: sourcePackage,
      targetBinaryPath: path.join(TARGET_PACKAGE_ROOT, "openclaw.mjs"),
      targetPackageRoot: TARGET_PACKAGE_ROOT,
      sourceStateDir: stateDir,
      sourceConfigPath: configPath,
      installPackageRoot: installRoot,
      workRoot: path.join(root, "engine-work"),
      gatewayPort: await reservePort(),
      gatewayToken,
      preservationSessionKey: "agent:dev:legacy-migration-fixture",
      failureInjection: options.failureInjection
    };
    const engine = new OpenClawMigrationEngine(input, defaultHooks);
    const plan = await engine.createPlan();
    const dryRun = await engine.dryRun();
    const run = await engine.execute(plan);
    let sourceVersionRestored = false;
    let stateRestored = false;
    if (options.failureInjection) {
      if (!run.snapshot) return { root, port: input.gatewayPort, run, failedRun: run, dryRun, sourceVersionRestored, stateRestored, cleaned: true };
      const rolledBack = await engine.rollback(run.journalPath);
      sourceVersionRestored = (await readPackageVersion(installRoot)) === OPENCLAW_PHASE_2B_SOURCE_VERSION;
      stateRestored = (await readFile(path.join(stateDir, "workspace", "preserved-marker.md"), "utf8")) === "source-workspace-preserved\n";
      return { root, port: input.gatewayPort, run: rolledBack, failedRun: run, dryRun, sourceVersionRestored, stateRestored, cleaned: true };
    }
    return { root, port: input.gatewayPort, run, failedRun: null, dryRun, sourceVersionRestored, stateRestored, cleaned: true };
  } finally {
    if (sourceGateway) await sourceGateway.stop().catch(() => {});
    sourceDatabase?.close();
    await provider.close().catch(() => {});
    if (!KEEP_FIXTURE) await rm(root, { recursive: true, force: true });
  }
}

async function seedRealSourceState(gatewayUrl: string, modelId: string, token: string) {
  const client = new NativeWsOpenClawGatewayClient({ url: gatewayUrl, token, scopes: ["operator.admin", "operator.read", "operator.write"], timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS, clientName: "gateway-client", clientVersion: "0.1.0-migration-fixture", webSocketFactory: WebSocket as unknown as WebSocketFactory });
  try {
    const handshake = await retryHandshake(client);
    if (handshake.server?.version !== OPENCLAW_PHASE_2B_SOURCE_VERSION) throw new Error(`Source fixture Gateway reported ${handshake.server?.version ?? "unknown"}.`);
    const session = await retryNativeCall<Record<string, unknown>>(client, "sessions.create", { key: "agent:dev:legacy-migration-fixture", agentId: "dev", label: "Legacy migration fixture" }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    const sessionKey = typeof session.key === "string" ? session.key : "agent:dev:legacy-migration-fixture";
    const history = await retryNativeCall<Record<string, unknown>>(client, "chat.history", { sessionKey, limit: 10 }, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
    if (!history || typeof history !== "object") throw new Error(`Source fixture session history was not readable for ${modelId}.`);
    await retryNativeCall<Record<string, unknown>>(client, "chat.send", { sessionKey, message: "AGENTOS_SYNTHETIC_SOURCE_FIXTURE_PROMPT", idempotencyKey: `agentos-source-fixture-${Date.now()}` }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const cron = await retryNativeCall<Record<string, unknown>>(client, "cron.add", { name: "Legacy migration fixture cron", agentId: "dev", schedule: { kind: "every", everyMs: 3_600_000 }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "AGENTOS_SYNTHETIC_CRON_PROMPT" }, delivery: { mode: "none" }, enabled: true, deleteAfterRun: false }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    if (!cron.id && !(cron.job && typeof cron.job === "object")) throw new Error("Source fixture cron was not persisted.");
    return { sessionId: typeof session.sessionId === "string" ? session.sessionId : typeof session.id === "string" ? session.id : "" };
  } finally {
    client.close("source fixture seeded");
  }
}

async function writeLegacySessionTranscript(stateDir: string, workspace: string, sessionId: string) {
  if (!sessionId) throw new Error("Source fixture session did not return a session id.");
  const sessionPath = path.join(stateDir, "agents", "dev", "sessions", `${sessionId}.jsonl`);
  const timestamp = new Date().toISOString();
  await mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  const userId = randomUUID();
  await writeFile(sessionPath, [
    { type: "session", version: 3, id: sessionId, timestamp, cwd: workspace },
    { type: "message", id: userId, parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text: "AGENTOS_SYNTHETIC_LEGACY_HISTORY" }] } },
    { type: "message", id: randomUUID(), parentId: userId, timestamp, message: { role: "assistant", content: [{ type: "text", text: "AGENTOS_LEGACY_HISTORY_REPLY" }] } }
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

async function createFixtureDatabase(filePath: string) {
  const db = new (await import("node:sqlite")).DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE migration_fixture (id TEXT PRIMARY KEY, value TEXT); INSERT INTO migration_fixture VALUES ('legacy-session-fixture', 'preserve');");
  if (!(await pathExists(`${filePath}-wal`))) throw new Error("WAL fixture did not create a sidecar.");
  return db;
}

async function createSourceDependencyRoot() {
  const dependencyRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-source-deps-"));
  const packageJson = JSON.parse(await readFile(path.join(SOURCE_PACKAGE_INPUT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  await writeFile(path.join(dependencyRoot, "package.json"), JSON.stringify({ private: true, dependencies: packageJson.dependencies ?? {} }));
  await runProcess("npm", ["install", "--prefix", dependencyRoot, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]);
  return dependencyRoot;
}

async function runProcess(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false", npm_config_loglevel: "error" } });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} dependency install failed (${code}): ${stderr.slice(-2000)}`)));
  });
}

async function retryNativeCall<T>(client: NativeWsOpenClawGatewayClient, method: string, params: Record<string, unknown>, options: { timeoutMs: number }, policy: { safety: "read" | "mutation"; timeoutMs: number }) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await client.callNative<T>(method, params, options, policy);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method} remained unavailable.`);
}

async function retryHandshake(client: NativeWsOpenClawGatewayClient) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await client.probeNativeHandshake({ timeoutMs: 4_000 });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gateway handshake remained unavailable.");
}

function sanitizeRun(run: unknown, root: string) {
  return sanitizeValue(run, root);
}

function sanitizeValue(value: unknown, root: string) {
  return JSON.parse(JSON.stringify(value).replaceAll(root, "[disposable-fixture]").replaceAll(TARGET_PACKAGE_ROOT, "[exact-target-package]"));
}

async function readPackageVersion(packageRoot: string) {
  return JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version as string;
}

async function reservePort() {
  const server = await import("node:net").then(({ createServer }) => createServer());
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not reserve a loopback port.");
  return port;
}

async function pathExists(filePath: string) {
  return stat(filePath).then(() => true).catch(() => false);
}

void main().then((exitCode) => { process.exitCode = exitCode; }).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
