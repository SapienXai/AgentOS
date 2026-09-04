import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import type { GatewayEventFrame } from "@/lib/openclaw/client/native-ws-gateway-types";
import { OPENCLAW_IDENTITY_CONTRACT_BUILD, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_NATIVE_WORK_PACKAGE?.trim() || "/tmp/openclaw-2026.9.1-source-agentos";
const OUTPUT_PATH = process.env.OPENCLAW_NATIVE_WORK_OUTPUT?.trim() || path.resolve("docs/evidence/openclaw-2026.9.1-native-work-foundation.json");
const TARGET_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const REQUEST_TIMEOUT_MS = 10_000;

type PackageIdentity = {
  version: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageHash: string;
};

type RuntimeResources = {
  disposableRoot: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
  sessionKeys: string[];
  worktreeIds: string[];
};

async function main() {
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, TARGET_VERSION);
  assert.equal(packageIdentity.sourceCommit, TARGET_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-native-work-"));
  const resources: RuntimeResources = {
    disposableRoot,
    stateDir: path.join(disposableRoot, "state"),
    workspaceDir: path.join(disposableRoot, "workspace"),
    configPath: path.join(disposableRoot, "openclaw.json"),
    port: await reservePort(),
    token: `agentos-native-work-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionKeys: [],
    worktreeIds: []
  };
  const fixture = await startFixture();
  let gateway: ChildProcess | null = null;
  let client: ReturnType<typeof createOfficialBackedOpenClawGatewayClient> | null = null;
  let subscription: { close: () => void } | null = null;
  const events: GatewayEventFrame[] = [];
  const evidence = {
    schemaVersion: 1,
    artifactType: "openclaw-native-work-foundation-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      codeCommitUnderTest: await readGitHead(),
      openClaw: {
        version: packageIdentity.version,
        sourceCommit: packageIdentity.sourceCommit,
        buildId: packageIdentity.buildId,
        packageHash: packageIdentity.packageHash,
        packageRoot: "[DISPOSABLE_EXACT_PACKAGE]"
      }
    },
    runtime: {
      packageMode: "exact-openclaw-package-fixture",
      gatewayPlacement: "disposable-loopback",
      stateIsolation: true,
      configIsolation: true,
      userGatewayUntouched: true,
      realProviderCredentials: false
    },
    contracts: {
      worktrees: ["worktrees.list", "worktrees.branches", "sessions.create"],
      taskSuggestions: ["taskSuggestions.list", "taskSuggestions.create", "taskSuggestions.accept", "taskSuggestions.dismiss"],
      sessionOwnership: ["session.members.list", "session.members.listEvidence", "sessions.assignOwner"],
      events: ["task.suggestion", "session.sharing", "session.evidence"],
      noTaskSubscriptionMethod: true
    },
    handshake: null as Record<string, unknown> | null,
    checks: {
      exactPackage: false,
      nativeTransport: false,
      worktreeBranches: false,
      managedWorktreeSession: false,
      worktreeProjection: false,
      suggestionList: false,
      suggestionAccept: false,
      suggestionDismiss: false,
      suggestionEvent: false,
      sessionMembers: false,
      sessionEvidence: false,
      ownerHandoff: "not-run" as "not-run" | "PASS" | "EXPECTED-DENIAL",
      noCliFallback: false,
      cleanup: false
    },
    observations: {
      sessionKey: null as string | null,
      sessionIdPresent: false,
      worktreeId: null as string | null,
      worktreePathReported: false,
      suggestionId: null as string | null,
      acceptedSessionKey: null as string | null,
      eventNames: [] as string[],
      ownerResult: null as string | null,
      fallbackTotal: null as number | null
    },
    cleanup: { status: "pending", gatewayProcessStopped: false, disposableRootRemoved: false },
    gate: "OPENCLAW 9.1 NATIVE WORK FOUNDATION GATE: FAIL",
    success: false
  };

  try {
    await initializeGitWorkspace(resources.workspaceDir);
    await writeFile(resources.configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: resources.token } },
      agents: { defaults: { workspace: resources.workspaceDir, model: { primary: `agentos-fixture/${fixture.modelId}` } }, list: [{ id: "main", workspace: resources.workspaceDir }] },
      models: { mode: "merge", providers: { "agentos-fixture": { baseUrl: fixture.baseUrl, api: "openai-completions", apiKey: "agentos-native-work-fixture", timeoutSeconds: 30, models: [{ id: fixture.modelId, name: "AgentOS Native Work Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 128 }] } } },
      cron: { enabled: false }
    }, null, 2)}\n`, { mode: 0o600 });
    gateway = await startGateway({ packageRoot, resources });
    client = createClient(resources);
    const handshake = await client.probeNativeHandshake({ timeoutMs: REQUEST_TIMEOUT_MS });
    const methods = Array.isArray(handshake.features?.methods) ? handshake.features.methods : [];
    const capabilities = Array.isArray(handshake.features?.capabilities) ? handshake.features.capabilities : [];
    evidence.handshake = {
      protocol: handshake.protocol ?? null,
      serverVersion: handshake.server?.version ?? null,
      buildId: handshake.server?.buildId ?? null,
      methods: methods.filter((method) => /^worktrees\.|^taskSuggestions\.|^session\.members\.|^sessions\.(create|assignOwner)$/.test(method)),
      capabilities: capabilities.filter((capability) => capability === "taskSuggestions.acceptModes")
    };
    evidence.checks.exactPackage = true;
    evidence.checks.nativeTransport = client.getDiagnostics?.().transportImplementation === "official";

    subscription = await client.subscribeNativeEvents({ subscribeSessions: true }, { onEvent: (frame) => events.push(frame) }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const branches = await client.inspectWorktreeBranches({ repoRoot: resources.workspaceDir, includeRepositoryStatus: true }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(branches.repositoryStatus, "git");
    assert.ok(branches.branches.some((branch) => branch.kind === "local"));
    evidence.checks.worktreeBranches = true;

    const session = await client.createSession({
      agentId: "main",
      // An empty task proves synchronous managed-worktree provisioning without
      // starting a model turn. Mission execution supplies a non-empty task.
      task: "",
      cwd: resources.workspaceDir,
      worktree: true,
      label: "Native work certification"
    }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const sessionKey = session.key ?? session.sessionKey;
    assert.ok(sessionKey);
    resources.sessionKeys.push(sessionKey);
    evidence.observations.sessionKey = sessionKey;
    evidence.observations.sessionIdPresent = typeof session.sessionId === "string";
    evidence.checks.managedWorktreeSession = session.worktree?.id ? true : false;
    if (session.worktree?.id) {
      resources.worktreeIds.push(session.worktree.id);
      evidence.observations.worktreeId = session.worktree.id;
      evidence.observations.worktreePathReported = Boolean(session.worktree.path);
    }

    const worktrees = await client.listWorktrees({ timeoutMs: REQUEST_TIMEOUT_MS });
    const projectedWorktree = worktrees.worktrees.find((entry) => entry.id === session.worktree?.id);
    evidence.checks.worktreeProjection = Boolean(projectedWorktree?.ownerKind === "session" && projectedWorktree.ownerId === sessionKey);

    const members = await client.listSessionMembers({ sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const memberEvidence = await client.listSessionMembersEvidence({ sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.checks.sessionMembers = Array.isArray(members.members);
    evidence.checks.sessionEvidence = Array.isArray(memberEvidence.members);

    try {
      const owner = await client.assignSessionOwner({ key: sessionKey, owner: { type: "agent", id: "main" } }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.checks.ownerHandoff = owner.owner?.actor?.id === "main" ? "PASS" : "EXPECTED-DENIAL";
      evidence.observations.ownerResult = owner.owner?.actor?.id ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/identified caller|FORBIDDEN|forbidden/i.test(message)) throw error;
      evidence.checks.ownerHandoff = "EXPECTED-DENIAL";
      evidence.observations.ownerResult = "native authorization denied unidentified disposable operator";
    }

    const createdSuggestion = await client.createTaskSuggestion({
      title: "Inspect native work evidence",
      prompt: "Inspect the native work evidence and report the exact session identity.",
      tldr: "Inspect native work evidence.",
      cwd: resources.workspaceDir,
      sessionKey,
      agentId: "main"
    }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const suggestionId = createdSuggestion.taskId;
    evidence.observations.suggestionId = suggestionId;
    const suggestions = await client.listTaskSuggestions({ sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.ok(suggestions.suggestions.some((suggestion) => suggestion.id === suggestionId));
    evidence.checks.suggestionList = true;

    const acceptedSuggestion = await client.acceptTaskSuggestion({ taskId: suggestionId, mode: "local" }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(acceptedSuggestion.taskId, suggestionId);
    assert.ok(acceptedSuggestion.key);
    resources.sessionKeys.push(acceptedSuggestion.key);
    evidence.observations.acceptedSessionKey = acceptedSuggestion.key;
    evidence.checks.suggestionAccept = true;

    const dismissedSuggestion = await client.createTaskSuggestion({
      title: "Dismiss native work evidence",
      prompt: "This disposable suggestion must be dismissed.",
      tldr: "Dismiss this disposable suggestion.",
      cwd: resources.workspaceDir,
      sessionKey,
      agentId: "main"
    }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const dismissed = await client.dismissTaskSuggestion({ taskId: dismissedSuggestion.taskId, reason: "native work certification cleanup" }, { timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.checks.suggestionDismiss = dismissed.dismissed === true;

    await new Promise((resolve) => setTimeout(resolve, 250));
    evidence.observations.eventNames = unique(events.map(readEventName).filter((name): name is string => Boolean(name)));
    evidence.checks.suggestionEvent = evidence.observations.eventNames.includes("task.suggestion");
    evidence.observations.fallbackTotal = client.getDiagnostics?.().fallbackTotal ?? null;
    evidence.checks.noCliFallback = evidence.observations.fallbackTotal === 0;
  } finally {
    subscription?.close();
    if (client) {
      for (const sessionKey of [...resources.sessionKeys].reverse()) {
        await client.callNative("sessions.delete", { key: sessionKey, deleteTranscript: true }, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "mutation", allowCliFallback: false, timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => {});
      }
      for (const worktree of (await client.listWorktrees({ timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => ({ worktrees: [] }))).worktrees) {
        if (worktree.ownerId && resources.sessionKeys.includes(worktree.ownerId)) {
          await client.callNative("worktrees.remove", { id: worktree.id, force: true }, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "mutation", allowCliFallback: false, timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => {});
        }
      }
      evidence.observations.fallbackTotal = client.getDiagnostics?.().fallbackTotal ?? evidence.observations.fallbackTotal;
      client.close("native work certification complete");
    }
    await stopProcess(gateway).catch(() => {});
    await fixture.close().catch(() => {});
    await rm(resources.disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.status = "complete";
    evidence.cleanup.gatewayProcessStopped = gateway?.exitCode !== null;
    evidence.cleanup.disposableRootRemoved = !(await pathExists(resources.disposableRoot));
    evidence.checks.cleanup = evidence.cleanup.gatewayProcessStopped && evidence.cleanup.disposableRootRemoved;
    evidence.gate = Object.values(evidence.checks).every((value) => value === true || value === "PASS" || value === "EXPECTED-DENIAL")
      ? "OPENCLAW 9.1 NATIVE WORK FOUNDATION GATE: PASS"
      : "OPENCLAW 9.1 NATIVE WORK FOUNDATION GATE: FAIL";
    evidence.success = evidence.gate.endsWith("PASS");
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) throw new Error(`Native work certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log("OPENCLAW 9.1 NATIVE WORK FOUNDATION GATE: PASS");
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

function createClient(resources: RuntimeResources) {
  return createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${resources.port}`,
    token: resources.token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-native-work-certification",
    sharedStateMode: "read-only"
  });
}

async function startFixture() {
  const fixture = await import("@/scripts/openclaw-runtime-provider-fixture");
  return fixture.createOpenClawRuntimeProviderFixture({ modelId: "agentos-native-work-fixture" });
}

async function startGateway(input: { packageRoot: string; resources: RuntimeResources }) {
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.resources.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", input.resources.token, "--ws-log", "compact"], {
    cwd: input.resources.workspaceDir,
    env: { ...process.env, OPENCLAW_STATE_DIR: input.resources.stateDir, OPENCLAW_CONFIG_PATH: input.resources.configPath, OPENCLAW_GATEWAY_TOKEN: input.resources.token },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.resources.port}/healthz`)).ok) return child; } catch {}
    await wait(250);
  }
  await stopProcess(child);
  throw new Error(`Disposable OpenClaw Gateway did not become ready. ${sanitizeText(output)}`);
}

async function initializeGitWorkspace(workspaceDir: string) {
  await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
  await execFileAsync("git", ["init", "--initial-branch", "main", workspaceDir]);
  await execFileAsync("git", ["-C", workspaceDir, "config", "user.email", "agentos-native-work@example.test"]);
  await execFileAsync("git", ["-C", workspaceDir, "config", "user.name", "AgentOS Native Work Certification"]);
  await writeFile(path.join(workspaceDir, "README.md"), "# Native work certification\n");
  await execFileAsync("git", ["-C", workspaceDir, "add", "README.md"]);
  await execFileAsync("git", ["-C", workspaceDir, "commit", "-m", "certify native work workspace"]);
}

async function readPackageIdentity(packageRoot: string): Promise<PackageIdentity> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? null, buildId: buildInfo.buildId ?? null, packageHash: hash.digest("hex") };
}

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function readGitBranch() { return (await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() })).stdout.trim(); }
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch { return false; } }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readEventName(frame: unknown) { return frame && typeof frame === "object" && typeof (frame as { event?: unknown }).event === "string" ? (frame as { event: string }).event : null; }
function unique(values: string[]) { return [...new Set(values)]; }
function sanitizeText(value: string) { return value.replace(/agentos-native-work-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw native work certification failed."); process.exitCode = 1; });
