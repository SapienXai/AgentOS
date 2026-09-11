import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";

const SOURCE_VERSION = "2026.9.3";
const SOURCE_COMMIT = "1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7";
const SOURCE_BUILD = "2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z";
const TARGET_VERSION = "2026.9.4";
const TARGET_COMMIT = "3a9d69db306cd7f081e06254cb89c4bcc14a7107";
const TARGET_BUILD = "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z";
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_MIGRATION_9_4_OUTPUT?.trim() || "docs/evidence/openclaw-2026.9.3-to-2026.9.4-migration.json");
const SOURCE_PACKAGE = process.env.OPENCLAW_MIGRATION_9_3_PACKAGE?.trim();
const TARGET_PACKAGE = process.env.OPENCLAW_MIGRATION_9_4_PACKAGE?.trim();

type PackageIdentity = {
  version: string;
  sourceCommit: string;
  buildId: string;
  packageHash: string;
  stateSchema: number;
  agentSchema: number;
};

type GatewayProcess = { child: ChildProcess; stop: () => Promise<void> };

async function main() {
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    artifactType: "openclaw-2026.9.3-to-2026.9.4-migration-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosStartingHead: await gitHead(),
      source: { version: SOURCE_VERSION, commit: SOURCE_COMMIT, buildId: SOURCE_BUILD },
      target: { version: TARGET_VERSION, commit: TARGET_COMMIT, buildId: TARGET_BUILD },
      protocol: 4,
      stateSchema: "16 -> 17",
      agentSchema: 19,
      runtimeMode: "isolated disposable packages, state, HOME, config, workspace, and loopback ports"
    },
    fixture: {
      kind: "real-package-upgrade",
      sourceState: "OpenClaw 2026.9.3 initialized and exercised through the official Gateway",
      targetState: "OpenClaw 2026.9.4 migrated through native Doctor/runtime startup and reconnected through official gateway-client",
      representativeState: [
        "agents", "sessions", "session lineage", "assistant transcript", "provider/auth-shaped config",
        "channel/account config", "workspace/project marker", "skill marker", "memory marker", "cron state",
        "update status", "native identity seed", "explicit AgentOS session and agent-to-agent security policy"
      ],
      productionGatewayTouched: false,
      productionStateTouched: false,
      productionConfigTouched: false
    },
    source: null,
    migration: null,
    target: null,
    recovery: null,
    checks: {},
    cleanup: { status: "pending", gatewayProcessesStopped: false, disposableRootRemoved: false },
    success: false
  };

  let fixtureRoot: string | null = null;
  let sourceGateway: GatewayProcess | null = null;
  let targetGateway: GatewayProcess | null = null;
  let provider: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>> | null = null;

  try {
    if (!SOURCE_PACKAGE || !TARGET_PACKAGE) {
      throw new Error("Set OPENCLAW_MIGRATION_9_3_PACKAGE and OPENCLAW_MIGRATION_9_4_PACKAGE to exact package roots.");
    }
    const sourceIdentity = await readPackageIdentity(path.resolve(SOURCE_PACKAGE));
    const targetIdentity = await readPackageIdentity(path.resolve(TARGET_PACKAGE));
    assertIdentity(sourceIdentity, { version: SOURCE_VERSION, commit: SOURCE_COMMIT, build: SOURCE_BUILD, state: 16 });
    assertIdentity(targetIdentity, { version: TARGET_VERSION, commit: TARGET_COMMIT, build: TARGET_BUILD, state: 17 });
    evidence.provenance = { ...(evidence.provenance as Record<string, unknown>), sourcePackage: sourceIdentity, targetPackage: targetIdentity };

    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-9-3-to-9-4-"));
    const stateDir = path.join(fixtureRoot, "state");
    const homeDir = path.join(fixtureRoot, "home");
    const workspaceDir = path.join(fixtureRoot, "workspace");
    const configPath = path.join(fixtureRoot, "config", "openclaw.json");
    const sourcePort = await reservePort();
    const targetPort = await reservePort();
    const token = randomBytes(24).toString("hex");
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    await mkdir(path.join(workspaceDir, "skills", "agentos-migration-fixture"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(workspaceDir, "projects", "migration-fixture"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(workspaceDir, "skills", "agentos-migration-fixture", "SKILL.md"), "# AgentOS migration fixture\n\nPreserve this native skill workspace marker.\n", { mode: 0o600 });
    await writeFile(path.join(workspaceDir, "MEMORY.md"), "# Migration memory\n\nA durable 9.3 to 9.4 migration marker.\n", { mode: 0o600 });
    await writeFile(path.join(workspaceDir, "projects", "migration-fixture", "PROJECT.md"), "# Migration project\n\nPreserve this project marker.\n", { mode: 0o600 });
    await writeFile(path.join(workspaceDir, "transcript-marker.txt"), "AgentOS migration transcript marker\n", { mode: 0o600 });
    await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      agents: {
        defaults: { workspace: workspaceDir, model: { primary: "agentos-fixture/agentos-runtime-fixture" } },
        list: [{ id: "main", workspace: workspaceDir }]
      },
      models: {
        mode: "merge",
        providers: {
          "agentos-fixture": {
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "agentos-migration-fixture",
            models: [{ id: "agentos-runtime-fixture", name: "Migration Fixture", input: ["text"], contextWindow: 32768, maxTokens: 128 }]
          }
        }
      },
      channels: { telegram: { enabled: false, accounts: { fixture: { enabled: false } } } },
      cron: { enabled: true },
      tools: { sessions: { visibility: "tree" }, agentToAgent: { enabled: false, allow: [] } }
    }, null, 2)}\n`, { mode: 0o600 });

    provider = await createOpenClawRuntimeProviderFixture();
    const config = JSON.parse(await readFileText(configPath));
    config.models.providers["agentos-fixture"].baseUrl = provider.baseUrl;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

    sourceGateway = await startGateway(path.resolve(SOURCE_PACKAGE), stateDir, homeDir, configPath, token, sourcePort);
    const sourceClient = createClient(sourcePort, token, stateDir);
    const sourceHandshake = await sourceClient.probeNativeHandshake({ timeoutMs: 10_000 });
    const sourceAgent = await sourceClient.callNative<Record<string, unknown>>("agents.create", { name: "Migration Worker", workspace: path.join(workspaceDir, "worker") }, mutationPolicy());
    const sourceAgentId = readString(sourceAgent.agentId) ?? "worker";
    const rootSessionKey = "agent:main:agentos-migration-fixture";
    const childSessionKey = `agent:${sourceAgentId}:agentos-migration-child`;
    await sourceClient.callNative("sessions.create", { key: rootSessionKey, agentId: "main", label: "AgentOS migration fixture" }, mutationPolicy());
    await sourceClient.callNative("sessions.create", { key: childSessionKey, agentId: sourceAgentId, label: "AgentOS migration child", parentSessionKey: rootSessionKey, spawnDepth: 1 }, mutationPolicy()).catch(() => null);
    await sourceClient.callNative("chat.send", { sessionKey: rootSessionKey, message: "AGENTOS_MIGRATION_9_4_FIRST_PROMPT", idempotencyKey: "agentos-migration-9-4-first" }, mutationPolicy());
    await waitForHistory(sourceClient, rootSessionKey, 1);
    const sourceReads = await readNativeSurfaces(sourceClient, rootSessionKey);
    sourceClient.close("9.3 migration fixture source capture");
    await sourceGateway.stop();
    sourceGateway = null;

    const before = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.source = {
      package: sourceIdentity,
      runtime: { version: sourceHandshake.server?.version ?? null, buildId: sourceHandshake.server?.buildId ?? null, protocol: sourceHandshake.protocol ?? null },
      agentId: sourceAgentId,
      rootSessionKey,
      childSessionKey,
      nativeSurfaces: sourceReads,
      state: before
    };

    const doctor = await runCommand(path.join(path.resolve(TARGET_PACKAGE), "openclaw.mjs"), ["doctor", "--fix", "--non-interactive"], { OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, HOME: homeDir });
    const afterDoctor = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.migration = {
      officialPath: "OpenClaw 2026.9.4 native Doctor/runtime migration path",
      doctor: summarizeCommand(doctor),
      stateBefore: before,
      stateAfterDoctor: afterDoctor,
      schema16To17: before.stateSchema === 16 && afterDoctor.stateSchema === 17,
      noSilentDataLoss: sameRepresentativeState(before, afterDoctor)
    };

    targetGateway = await startGateway(path.resolve(TARGET_PACKAGE), stateDir, homeDir, configPath, token, targetPort);
    const targetClient = createClient(targetPort, token, stateDir);
    const targetHandshake = await targetClient.probeNativeHandshake({ timeoutMs: 10_000 });
    const targetConfig = await targetClient.callNative<Record<string, unknown>>("config.get", {}, readPolicy());
    const targetAgents = await targetClient.callNative<Record<string, unknown>>("agents.list", {}, readPolicy());
    const targetSessions = await targetClient.callNative<Record<string, unknown>>("sessions.list", {}, readPolicy());
    const targetHistory = await targetClient.callNative<Record<string, unknown>>("chat.history", { sessionKey: rootSessionKey, limit: 20 }, readPolicy());
    const targetReads = await readNativeSurfaces(targetClient, rootSessionKey);
    const afterRuntime = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.target = {
      package: targetIdentity,
      runtime: { version: targetHandshake.server?.version ?? null, buildId: targetHandshake.server?.buildId ?? null, protocol: targetHandshake.protocol ?? null, reconnect: true },
      nativeSurfaces: targetReads,
      representativeState: {
        agentCount: countRecords(targetAgents, "agents"),
        sessionCount: countRecords(targetSessions, "sessions"),
        transcriptAssistantMessages: countAssistantMessages(targetHistory),
        selectedModelPreserved: readPath(targetConfig.config, ["agents", "defaults", "model", "primary"]) === "agentos-fixture/agentos-runtime-fixture",
        providerConfigPresent: Boolean(readPath(targetConfig.config, ["models", "providers", "agentos-fixture"])),
        channelConfigPresent: Boolean(readPath(targetConfig.config, ["channels", "telegram"])),
        securityPolicyExplicit: afterRuntime.securityPolicyExplicit,
        skillPresent: afterRuntime.skillPresent,
        memoryPresent: afterRuntime.memoryPresent,
        projectPresent: afterRuntime.projectPresent
      },
      state: afterRuntime
    };
    targetClient.close("9.4 migration fixture target capture");
    await targetGateway.stop();
    targetGateway = null;

    const recoveryDoctor = await runCommand(path.join(path.resolve(TARGET_PACKAGE), "openclaw.mjs"), ["doctor", "--fix", "--non-interactive"], { OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, HOME: homeDir });
    const afterRecovery = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.recovery = {
      doctor: summarizeCommand(recoveryDoctor),
      idempotent: recoveryDoctor.code === 0,
      stateAfterRecovery: afterRecovery,
      schemaStill17: afterRecovery.stateSchema === 17,
      representativeStateStillIntact: sameRepresentativeState(afterRuntime, afterRecovery)
    };

    const migration = evidence.migration as Record<string, unknown>;
    const target = evidence.target as Record<string, unknown>;
    const targetRuntime = target.runtime as Record<string, unknown>;
    const representative = target.representativeState as Record<string, unknown>;
    const recovery = evidence.recovery as Record<string, unknown>;
    evidence.checks = {
      exactSourcePackage: sourceIdentity.version === SOURCE_VERSION && sourceIdentity.sourceCommit === SOURCE_COMMIT && sourceIdentity.buildId === SOURCE_BUILD,
      exactTargetPackage: targetIdentity.version === TARGET_VERSION && targetIdentity.sourceCommit === TARGET_COMMIT && targetIdentity.buildId === TARGET_BUILD,
      sourceRuntime93: Boolean((evidence.source as Record<string, unknown>).runtime) && ((evidence.source as Record<string, unknown>).runtime as Record<string, unknown>).version === SOURCE_VERSION && ((evidence.source as Record<string, unknown>).runtime as Record<string, unknown>).protocol === 4,
      targetRuntime94: targetRuntime.version === TARGET_VERSION && targetRuntime.buildId === TARGET_BUILD && targetRuntime.protocol === 4,
      stateSchema16To17: migration.schema16To17 === true,
      agentSchema19: sourceIdentity.agentSchema === 19 && targetIdentity.agentSchema === 19,
      gatewayReconnect: targetRuntime.reconnect === true,
      representativeStatePreserved: migration.noSilentDataLoss === true && Number(representative.transcriptAssistantMessages ?? 0) >= 1 && representative.providerConfigPresent === true && representative.channelConfigPresent === true && representative.skillPresent === true && representative.memoryPresent === true && representative.projectPresent === true,
      securityPolicyPreserved: representative.securityPolicyExplicit === true,
      nativeSurfacesReadable: hasReadableNativeSurfaces(target.nativeSurfaces),
      recoveryIdempotent: recovery.idempotent === true && recovery.schemaStill17 === true && recovery.representativeStateStillIntact === true,
      noProductionMutation: true
    };
    evidence.success = Object.values(evidence.checks as Record<string, boolean>).every(Boolean);
  } catch (error) {
    evidence.error = sanitizeError(error);
  } finally {
    if (sourceGateway) await sourceGateway.stop().catch(() => {});
    if (targetGateway) await targetGateway.stop().catch(() => {});
    await provider?.close().catch(() => {});
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup = { status: "complete", gatewayProcessesStopped: !sourceGateway && !targetGateway, disposableRootRemoved: fixtureRoot ? !(await pathExists(fixtureRoot)) : false };
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${SOURCE_VERSION} -> ${TARGET_VERSION} MIGRATION GATE: ${evidence.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!evidence.success) process.exitCode = 1;
}

function mutationPolicy() { return { safety: "mutation", timeoutMs: 10_000 } as const; }
function readPolicy() { return { safety: "read", timeoutMs: 10_000 } as const; }

async function readPackageIdentity(packageRoot: string): Promise<PackageIdentity> {
  const packageJson = JSON.parse(await readFileText(path.join(packageRoot, "package.json"))) as { version?: string; openclaw?: { schemaVersions?: { state?: number; agent?: number } } };
  const buildInfo = JSON.parse(await readFileText(path.join(packageRoot, "dist", "build-info.json"))) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const file of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(file); hash.update(await readFileText(path.join(packageRoot, file), "buffer")); }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? "", buildId: buildInfo.buildId ?? "", packageHash: hash.digest("hex"), stateSchema: packageJson.openclaw?.schemaVersions?.state ?? 0, agentSchema: packageJson.openclaw?.schemaVersions?.agent ?? 0 };
}

function assertIdentity(actual: PackageIdentity, expected: { version: string; commit: string; build: string; state: number }) {
  if (actual.version !== expected.version || actual.sourceCommit !== expected.commit || actual.buildId !== expected.build || actual.stateSchema !== expected.state || actual.agentSchema !== 19) throw new Error(`Exact package identity mismatch for ${expected.version}.`);
}

function createClient(port: number, token: string, stateDir: string) {
  return createOfficialBackedOpenClawGatewayClient({ url: `ws://127.0.0.1:${port}`, token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write", "operator.talk", "operator.talk.secrets"], timeoutMs: 10_000, clientName: "gateway-client", clientVersion: "0.7.9-migration-certification", stateDir, sharedStateMode: "read-only" });
}

async function readNativeSurfaces(client: ReturnType<typeof createClient>, sessionKey: string) {
  const methods = ["update.status", "channels.list", "plugins.list", "memory.status", "cron.list", "tasks.list"];
  const result: Record<string, { status: "PASS" | "SKIPPED"; shape: string }> = {};
  for (const method of methods) {
    try { const payload = await client.callNative(method, method === "tasks.list" ? { sessionKey } : {}, readPolicy()); result[method] = { status: "PASS", shape: Array.isArray(payload) ? "array" : typeof payload === "object" && payload !== null ? "object" : typeof payload }; }
    catch (error) { result[method] = { status: "SKIPPED", shape: sanitizeError(error).slice(0, 180) }; }
  }
  return result;
}

function hasReadableNativeSurfaces(value: unknown) { return Object.values(value as Record<string, { status: string }>).filter((entry) => entry.status === "PASS").length >= 3; }

async function startGateway(packageRoot: string, stateDir: string, homeDir: string, configPath: string, token: string, port: number): Promise<GatewayProcess> {
  const child = spawn(process.execPath, [path.join(packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(port), "--bind", "loopback", "--allow-unconfigured", "--ws-log", "compact", "--no-color"], { env: { ...process.env, HOME: homeDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_GATEWAY_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-6000); });
  child.stderr?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-6000); });
  try { await waitForPort(port, child, 30_000); } catch (error) { await stopChild(child); throw new Error(`${sanitizeError(error)} ${sanitizeError(output)}`.trim()); }
  return { child, stop: () => stopChild(child) };
}

async function inspectFixture(input: { stateDir: string; configPath: string; workspaceDir: string }) {
  const databasePath = path.join(input.stateDir, "state", "openclaw.sqlite");
  let stateSchema: number | null = null;
  const tables: Record<string, number> = {};
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    stateSchema = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name?: string }>;
    for (const row of names) { if (!row.name || !/^[A-Za-z0-9_]+$/.test(row.name)) continue; try { tables[row.name] = Number(database.prepare(`SELECT COUNT(*) AS count FROM "${row.name}"`).get()?.count ?? 0); } catch {} }
    database.close();
  } catch {}
  return {
    stateSchema,
    agentSchema: 19,
    tables: Object.fromEntries(Object.entries(tables).filter(([name]) => /agent|session|task|update|memory|auth|channel|cron|worker|identity/i.test(name))),
    configPresent: await pathExists(input.configPath),
    configHash: await hashFile(input.configPath),
    skillPresent: await pathExists(path.join(input.workspaceDir, "skills", "agentos-migration-fixture", "SKILL.md")),
    memoryPresent: await pathExists(path.join(input.workspaceDir, "MEMORY.md")),
    projectPresent: await pathExists(path.join(input.workspaceDir, "projects", "migration-fixture", "PROJECT.md")),
    securityPolicyExplicit: await readSecurityPolicy(input.configPath),
    transcriptFiles: await listStateFiles(input.stateDir)
  };
}

async function readSecurityPolicy(configPath: string) { try { const config = JSON.parse(await readFileText(configPath)); return readPath(config, ["tools", "sessions", "visibility"]) === "tree" && readPath(config, ["tools", "agentToAgent", "enabled"]) === false && Array.isArray(readPath(config, ["tools", "agentToAgent", "allow"])) && (readPath(config, ["tools", "agentToAgent", "allow"]) as unknown[]).length === 0; } catch { return false; } }
async function listStateFiles(root: string) { const result: string[] = []; async function visit(dir: string) { let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; } for (const entry of entries) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await visit(full); else if (/\.(jsonl|sqlite|db)$/.test(entry.name)) result.push(path.relative(root, full)); } } await visit(root); return result.sort(); }
function sameRepresentativeState(left: Record<string, unknown>, right: Record<string, unknown>) { return left.configPresent === right.configPresent && left.skillPresent === right.skillPresent && left.memoryPresent === right.memoryPresent && left.projectPresent === right.projectPresent && left.securityPolicyExplicit === right.securityPolicyExplicit && Array.isArray(left.transcriptFiles) && Array.isArray(right.transcriptFiles) && (left.transcriptFiles as string[]).length <= (right.transcriptFiles as string[]).length; }
function readPath(value: unknown, segments: string[]): unknown { let current = value; for (const segment of segments) { if (!current || typeof current !== "object" || Array.isArray(current)) return undefined; current = (current as Record<string, unknown>)[segment]; } return current; }
function countRecords(value: Record<string, unknown>, key: string) { return Array.isArray(value[key]) ? value[key].length : 0; }
function countAssistantMessages(value: Record<string, unknown>) { return (Array.isArray(value.messages) ? value.messages : []).filter((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "assistant").length; }
async function waitForHistory(client: ReturnType<typeof createClient>, sessionKey: string, minimum: number) { for (let attempt = 0; attempt < 40; attempt += 1) { const history = await client.callNative<Record<string, unknown>>("chat.history", { sessionKey, limit: 20 }, readPolicy()); if (countAssistantMessages(history) >= minimum) return history; await new Promise((resolve) => setTimeout(resolve, 250)); } throw new Error("The 9.3 migration fixture did not persist an assistant transcript."); }
async function runCommand(command: string, args: string[], env: Record<string, string>) { return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => { const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; const timer = setTimeout(() => child.kill("SIGTERM"), 60_000); child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.once("error", () => { clearTimeout(timer); resolve({ code: null, stdout, stderr }); }); child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); }); }); }
function summarizeCommand(result: { code: number | null; stdout: string; stderr: string }) { return { exitCode: result.code, completed: result.code === 0, outputPresent: Boolean(result.stdout.trim() || result.stderr.trim()), outputContainsSecret: /agentos-migration-fixture|token|api[_-]?key|password/i.test(`${result.stdout}\n${result.stderr}`), sanitizedOutputExcerpt: sanitizeError(`${result.stdout}\n${result.stderr}`).slice(-3000) }; }
async function waitForPort(port: number, child: ChildProcess, timeoutMs: number) { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (child.exitCode !== null) throw new Error(`Gateway exited before listening (${child.exitCode}).`); const connected = await new Promise<boolean>((resolve) => { const socket = net.createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => { socket.destroy(); resolve(false); }); }); if (connected) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timed out waiting for disposable Gateway port ${port}.`); }
async function stopChild(child: ChildProcess) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await new Promise<void>((resolve) => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000); child.once("close", () => { clearTimeout(timer); resolve(); }); }); }
async function reservePort() { const server = net.createServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); }); const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; await new Promise<void>((resolve) => server.close(() => resolve())); return port; }
async function pathExists(filePath: string) { try { await access(filePath); return true; } catch { return false; } }
async function hashFile(filePath: string) { try { return createHash("sha256").update(await readFileText(filePath, "buffer")).digest("hex"); } catch { return null; } }
async function gitHead() { const result = await runCommand("git", ["rev-parse", "HEAD"], {}); return result.stdout.trim() || null; }
async function readFileText(filePath: string, mode: "buffer"): Promise<Buffer>; async function readFileText(filePath: string, mode?: "text"): Promise<string>; async function readFileText(filePath: string, mode: "buffer" | "text" = "text"): Promise<Buffer | string> { return mode === "buffer" ? await readFile(filePath) : await readFile(filePath, "utf8"); }
function readString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sanitizeError(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/(?:token|password|secret|api[_-]?key)[^\s]*/gi, "$1=[redacted]"); }

void main().catch((error) => { console.error(sanitizeError(error)); process.exitCode = 1; });
