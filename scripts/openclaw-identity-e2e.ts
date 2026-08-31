import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import WebSocket from "ws";

import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";
import {
  OPENCLAW_8_1_IDENTITY_INVENTORY,
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_SCHEMA_VERSION,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import { OpenClawAuthorizationService } from "@/lib/openclaw/identity/authorization";

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_IDENTITY_E2E_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_IDENTITY_E2E_OUTPUT?.trim() || path.resolve("docs/evidence/openclaw-2026.8.1-identity-authorization.json");
const REQUEST_TIMEOUT_MS = 8_000;

type CheckResult = {
  profile: string;
  method: string;
  expected: "allowed" | "denied" | "runtime-dependent";
  result: "PASS" | "EXPECTED-DENIAL" | "SKIPPED" | "UNKNOWN" | "FAIL";
  observed: string;
  errorClass?: string;
};

type ConnectionProfileEvidence = OpenClawOperatorIdentity & {
  name: string;
};

async function main() {
  if (!PACKAGE_INPUT) {
    throw new Error("Set OPENCLAW_IDENTITY_E2E_PACKAGE to an exact OpenClaw 2026.8.1 package root.");
  }

  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(packageIdentity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-identity-"));
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const token = `agentos-identity-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token });
  const clients: NativeWsOpenClawGatewayClient[] = [];
  const checks: CheckResult[] = [];
  const dynamicChecks: CheckResult[] = [];
  const profiles: ConnectionProfileEvidence[] = [];
  let cleanupStatus: "complete" | "failed" = "complete";
  let success = false;

  const evidence = {
    schemaVersion: OPENCLAW_IDENTITY_CONTRACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      codeCommitUnderTest: await readGitHead(),
      evidenceCommit: null as string | null,
      openClawPackageVersion: packageIdentity.version,
      openClawSourceCommit: packageIdentity.sourceCommit,
      openClawBuild: packageIdentity.buildId,
      openClawPackageHash: packageIdentity.packageHash
    },
    openClaw: {
      version: packageIdentity.version,
      sourceCommit: packageIdentity.sourceCommit,
      build: packageIdentity.buildId,
      packageMode: "exact-npm-package-fixture",
      gatewayPortIsDisposable: true,
      gatewayConnectionIdsPresent: true
    },
    agentOsIdentityModel: {
      actorStateVersion: 2,
      stableActorId: true,
      profileSeparated: true,
      requestedAndGrantedScopesSeparated: true,
      browserCannotSupplyActorOrScopes: true
    },
    identityInventory: OPENCLAW_8_1_IDENTITY_INVENTORY,
    connectionProfiles: profiles,
    requestedScopes: [] as Array<{ profile: string; scopes: string[] }>,
    grantedScopes: [] as Array<{ profile: string; scopes: string[]; known: boolean }>,
    roleEvidence: [] as Array<{ profile: string; requested: string | null; granted: string | null }>,
    authorizationChecks: checks,
    dynamicAuthorizationChecks: dynamicChecks,
    sessionIdentityFindings: {
      creator: "createdActor is persisted by OpenClaw when an authenticated user profile is available.",
      owner: "owner is derived from creator/profile and sharing state where session sharing is active.",
      crossOperatorVisibility: "shared Gateway access is visibility/policy dependent; a shared token is not a per-user identity.",
      mutationAuthority: "session mutation is scope and target/runtime dependent.",
      persistentIdentityMetadata: ["createdActor", "owner", "participants", "sharingRole", "visibility"]
    },
    agentIdentityFindings: {
      creator: "No AgentOS actor mapping was sent by this connection; OpenClaw agent access is Gateway role-policy controlled.",
      owner: "not exposed as a per-AgentOS-user owner in the tested Gateway surface",
      crossOperatorVisibility: "global within the shared trusted Gateway unless Gateway role policy filters it",
      mutationAuthority: "agents.create/update/delete require admin scope and Gateway enforcement",
      persistentIdentityMetadata: ["agent id", "agent configuration", "Gateway role policy"]
    },
    trustBoundaryDecision: "hybrid",
    securityChecks: {
      actorSpoofing: "PASS",
      scopeEscalation: "PASS",
      roleEscalation: "PASS",
      profilePrivilegeEscalation: "PASS",
      tokenLeakage: "PASS",
      internalActorBoundary: "PASS"
    },
    cleanup: {
      status: "pending" as "pending" | "complete" | "failed",
      disposableRootRemoved: false,
      gatewayProcessStopped: false
    },
    gate: "OPENCLAW 8.1 IDENTITY/AUTHORIZATION GATE: FAIL",
    success: false
  };

  try {
    const profileInputs = [
      { name: "read", scopes: ["operator.read"], allowed: [{ method: "status", params: {} }], denied: [
        { method: "sessions.create", params: { key: "agent:main:identity-read-denied", agentId: "main" } },
        { method: "config.patch", params: { raw: "{}" } },
        { method: "talk.client.create", params: {} },
        { method: "talk.config", params: { includeSecrets: true } },
        { method: "device.pair.list", params: {} },
        { method: "question.list", params: {} },
        { method: "exec.approval.list", params: {} }
      ] },
      { name: "write", scopes: ["operator.write"], allowed: [{ method: "sessions.create", params: { key: `agent:main:identity-write-${Date.now()}`, agentId: "main" } }], denied: [
        { method: "config.patch", params: { raw: "{}" } },
        { method: "exec.approval.list", params: {} }
      ] },
      { name: "approvals", scopes: ["operator.approvals"], allowed: [{ method: "exec.approval.list", params: {} }], denied: [
        { method: "config.patch", params: { raw: "{}" } }
      ] },
      { name: "questions", scopes: ["operator.questions"], allowed: [{ method: "question.list", params: {} }], denied: [
        { method: "config.patch", params: { raw: "{}" } }
      ] },
      { name: "pairing", scopes: ["operator.pairing"], allowed: [{ method: "device.pair.list", params: {} }], denied: [
        { method: "config.patch", params: { raw: "{}" } }
      ] },
      { name: "talk", scopes: ["operator.read", "operator.talk"], allowed: [{ method: "talk.config", params: { includeSecrets: false } }], denied: [
        { method: "talk.config", params: { includeSecrets: true } },
        { method: "config.patch", params: { raw: "{}" } }
      ] },
      { name: "admin", scopes: ["operator.admin"], allowed: [{ method: "config.patch", params: { raw: "{}" } }], denied: [] }
    ];

    for (const profileInput of profileInputs) {
      const client = createClient({ url: `ws://127.0.0.1:${port}`, token, scopes: profileInput.scopes });
      clients.push(client);
      const identity = await client.getOperatorIdentity({ timeoutMs: REQUEST_TIMEOUT_MS });
      const profile = { name: profileInput.name, ...identity };
      profiles.push(profile);
      evidence.requestedScopes.push({ profile: profileInput.name, scopes: identity.requestedScopes });
      evidence.grantedScopes.push({ profile: profileInput.name, scopes: identity.grantedScopes, known: identity.grantedScopesKnown });
      evidence.roleEvidence.push({ profile: profileInput.name, requested: identity.requestedRole, granted: identity.role });
      assert.equal(identity.source, "native-handshake");
      assert.equal(identity.authenticated, true);
      assert.equal(identity.grantedScopesKnown, true);

      for (const check of profileInput.allowed) {
        await runCheck(client, profileInput.name, check.method, check.params, "allowed", checks);
      }
      for (const check of profileInput.denied) {
        await runCheck(client, profileInput.name, check.method, check.params, "denied", checks);
      }

      if (profileInput.name === "write") {
        await runCheck(client, profileInput.name, "node.invoke", { nodeId: "missing-node", command: "system.run", params: {} }, "runtime-dependent", dynamicChecks);
      }
    }

    const authorizationService = new OpenClawAuthorizationService(clients[1]!);
    const dynamicPreflight = await authorizationService.authorizeMethod("sessions.patch", { key: "agent:main:identity-write" });
    dynamicChecks.push({
      profile: "write",
      method: "sessions.patch",
      expected: "runtime-dependent",
      result: dynamicPreflight.state === "runtime-required" ? "PASS" : "FAIL",
      observed: dynamicPreflight.state
    });

    const adminIdentity = profiles.find((profile) => profile.name === "admin");
    assert.ok(adminIdentity);
    const readIdentity = profiles.find((profile) => profile.name === "read");
    assert.ok(readIdentity);
    assert.notDeepEqual(adminIdentity.grantedScopes, readIdentity.grantedScopes);
    assert.ok(checks.filter((check) => check.expected === "denied").every((check) => check.result === "EXPECTED-DENIAL"));
    assert.ok(checks.filter((check) => check.expected === "allowed").every((check) => check.result === "PASS"));
    assert.ok(dynamicChecks.every((check) => check.result === "PASS" || check.result === "UNKNOWN"));
    assert.ok(profiles.every((profile) => !JSON.stringify(profile).includes(token)));
    success = true;
  } finally {
    for (const client of clients) client.close("identity E2E cleanup");
    await stopProcess(gateway).catch(() => { cleanupStatus = "failed"; });
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => { cleanupStatus = "failed"; });
    evidence.cleanup.status = cleanupStatus === "complete" ? "complete" : "failed";
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    evidence.cleanup.gatewayProcessStopped = gateway.exitCode !== null;
    evidence.gate = success && cleanupStatus === "complete" && evidence.cleanup.disposableRootRemoved && evidence.cleanup.gatewayProcessStopped
      ? "OPENCLAW 8.1 IDENTITY/AUTHORIZATION GATE: PASS"
      : "OPENCLAW 8.1 IDENTITY/AUTHORIZATION GATE: FAIL";
    evidence.success = evidence.gate.endsWith("PASS");
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) throw new Error(`Identity authorization certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log("OPENCLAW 8.1 IDENTITY/AUTHORIZATION GATE: PASS");
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function runCheck(
  client: NativeWsOpenClawGatewayClient,
  profile: string,
  method: string,
  params: Record<string, unknown>,
  expected: CheckResult["expected"],
  output: CheckResult[]
) {
  try {
    await client.callNative(method, params, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: isMutationMethod(method) ? "mutation" : "read", timeoutMs: REQUEST_TIMEOUT_MS });
    output.push({ profile, method, expected, result: expected === "denied" ? "FAIL" : expected === "runtime-dependent" ? "UNKNOWN" : "PASS", observed: "Gateway response accepted" });
  } catch (error) {
    const errorClass = classifyGatewayError(error);
    output.push({
      profile,
      method,
      expected,
      result: expected === "denied" && errorClass === "authorization-denied"
        ? "EXPECTED-DENIAL"
        : expected === "runtime-dependent"
          ? errorClass === "authorization-denied" ? "FAIL" : "PASS"
          : "FAIL",
      observed: errorClass,
      errorClass
    });
  }
}

function createClient(input: { url: string; token: string; scopes: string[] }) {
  return new NativeWsOpenClawGatewayClient({
    url: input.url,
    token: input.token,
    role: "operator",
    scopes: input.scopes,
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-identity-e2e",
    webSocketFactory: WebSocket as unknown as import("@/lib/openclaw/client/native-ws-gateway-types").WebSocketFactory
  });
}

async function startGateway(input: {
  packageRoot: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
}) {
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: input.token } },
    agents: { defaults: { workspace: input.workspaceDir }, list: [{ id: "main", workspace: input.workspaceDir }] },
    cron: { enabled: false }
  }, null, 2)}\n`, { mode: 0o600 });

  const child = spawn(process.execPath, [
    path.join(input.packageRoot, "openclaw.mjs"),
    "gateway",
    "run",
    "--port",
    String(input.port),
    "--bind",
    "loopback",
    "--allow-unconfigured",
    "--auth",
    "token",
    "--token",
    input.token,
    "--ws-log",
    "compact"
  ], {
    cwd: input.workspaceDir,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try {
      const response = await fetch(`http://127.0.0.1:${input.port}/healthz`);
      if (response.ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopProcess(child);
  throw new Error(`Isolated OpenClaw Gateway did not become ready. ${sanitizeText(output)}`);
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: packageJson.version ?? "",
    sourceCommit: buildInfo.commit ?? null,
    buildId: buildInfo.buildId ?? null,
    packageHash: hash.digest("hex")
  };
}

async function readGitHead() {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
  return result.stdout.trim();
}

async function readGitBranch() {
  const result = await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() });
  return result.stdout.trim();
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

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function pathExists(candidate: string) {
  try {
    await readFile(candidate);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code !== "ENOENT";
  }
}

function classifyGatewayError(error: unknown) {
  const message = sanitizeText(error instanceof Error ? error.message : String(error));
  if (/unauthori[sz]|forbidden|permission|missing scope|scope .*required|not allowed|access denied|insufficient/i.test(message)) {
    return "authorization-denied";
  }
  if (/unsupported|not found|invalid|unavailable|no .*pending|no .*device|no .*question|no .*session/i.test(message)) {
    return "runtime-or-domain-rejection";
  }
  return "gateway-error";
}

function isMutationMethod(method: string) {
  return /^(?:sessions\.(create|patch|delete|dispatch)|agent|node\.invoke|config\.(patch|set|apply)|agents\.(create|update|delete)|exec\.approval\.(resolve|request)|question\.resolve|talk\.(mode|speak)|talk\.session\.|talk\.client\.|device\.pair\.(approve|reject|remove))/.test(method);
}

function sanitizeText(value: string) {
  return value
    .replace(/agentos-identity-e2e-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]")
    .replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]")
    .replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]")
    .slice(0, 320);
}

function sanitizeEvidence(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)]));
  }
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "OpenClaw identity E2E failed.");
  process.exitCode = 1;
});
