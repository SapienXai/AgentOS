const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: wait } = require("node:timers/promises");
const { createOfficialBackedOpenClawGatewayClient } = require("../lib/openclaw/client/official-gateway-factory.ts");
const { createManagedAgentOsUser } = require("../lib/agentos/application/agentos-account-service.ts");
const { resolveAgentOsActorContext } = require("../lib/security/agentos-actor.ts");
const { invalidateAgentOsUserSessions } = require("../lib/security/agentos-user-store.ts");
const { enableInstanceProtection } = require("../lib/security/instance-protection.ts");
const { createDisposableOpenClawEnvironment } = require("./lib/disposable-openclaw-env.ts");

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  return new Promise((resolve) => {
    const deadline = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => { clearTimeout(deadline); resolve(); });
    child.kill("SIGTERM");
  });
}

async function ready(url, child) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Disposable process exited during startup.");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Disposable endpoint failed readiness.");
}

function openStream(origin, headers, signal) {
  return fetch(origin + "/api/stream?delta=1", { headers, signal }).then((response) => {
    assert.equal(response.status, 200);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    return async (matches) => {
      for (;;) {
        const end = pending.indexOf("\n\n");
        if (end >= 0) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (matches(frame)) return frame;
          continue;
        }
        const result = await reader.read();
        if (result.done) return null;
        pending += result.value;
      }
    };
  });
}

async function main() {
  const [packageRoot, buildRoot] = process.argv.slice(2).map((value) => path.resolve(value));
  if (!packageRoot || !buildRoot) throw new Error("Usage: agentos-dashboard-access-e2e.cjs OPENCLAW_PACKAGE CLEAN_BUILD");
  const version = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
  assert.equal(version, "2026.11.10");
  await readFile(path.join(buildRoot, ".next", "BUILD_ID"));
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    const exists = await readFile(path.join(buildRoot, name)).then(() => true, (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    assert.ok(!exists, "Use a clean production build without dotenv files.");
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-dashboard-access-"));
  const children = [];
  let native;
  const streamLifetime = new AbortController();
  try {
    const [gatewayPort, appPort] = await Promise.all([reservePort(), reservePort()]);
    const workspaceMarker = "DASHBOARD_PRIVATE_WORKSPACE";
    const sessionMarker = "DASHBOARD_PRIVATE_SESSION";
    const workspace = path.join(root, workspaceMarker);
    const stateDir = path.join(root, "openclaw");
    const config = path.join(stateDir, "openclaw.json");
    const origin = "http://127.0.0.1:" + appPort;
    const gatewayUrl = "ws://127.0.0.1:" + gatewayPort;
    const gatewayToken = randomUUID();
    const apiToken = randomUUID();
    const runtime = path.join(packageRoot, "openclaw.mjs");
    await Promise.all([mkdir(stateDir), mkdir(workspace)]);
    await writeFile(path.join(workspace, "AGENTS.md"), workspaceMarker);
    await writeFile(config, JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: gatewayToken } },
      agents: { defaults: { workspace }, entries: { main: { workspace, name: workspaceMarker } } },
      cron: { enabled: false }
    }), { mode: 0o600 });

    const env = createDisposableOpenClawEnvironment({ homeDir: root, overrides: {
      TMPDIR: root, NODE_ENV: "production", OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: config,
      OPENCLAW_GATEWAY_PORT: String(gatewayPort), OPENCLAW_GATEWAY_TOKEN: gatewayToken, OPENCLAW_BIN: runtime,
      AGENTOS_RUNTIME_DIR: path.join(root, "agentos"), AGENTOS_OPENCLAW_GATEWAY_URL: gatewayUrl,
      AGENTOS_OPENCLAW_GATEWAY_TOKEN: gatewayToken, AGENTOS_API_TOKEN: apiToken
    } });
    const launch = (cwd, ...args) => {
      const child = spawn(process.execPath, args, { cwd, env, stdio: "ignore" });
      children.push(child);
      return child;
    };
    const gateway = launch(root, runtime, "gateway", "run", "--bind", "loopback", "--port", String(gatewayPort));
    await ready("http://127.0.0.1:" + gatewayPort + "/healthz", gateway);
    const next = path.join(buildRoot, "node_modules", "next", "dist", "bin", "next");
    const app = launch(buildRoot, next, "start", "--hostname", "127.0.0.1", "--port", String(appPort));
    await ready(origin + "/api/auth/status", app);
    const request = (route, options = {}) => fetch(origin + route, {
      redirect: "manual", signal: AbortSignal.timeout(25000), ...options
    });
    assert.equal((await request("/api/snapshot", { headers: { Authorization: "Bearer " + apiToken } })).status, 200);

    const ownerInput = { username: "fixture-owner", password: randomUUID() };
    const memberInput = { username: "fixture-member", password: randomUUID() };
    await enableInstanceProtection(ownerInput, env);
    await createManagedAgentOsUser(memberInput, env);
    const login = async (input) => {
      const response = await request("/api/auth/login", {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(input)
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie);
      return { Cookie: cookie.split(";", 1)[0] };
    };
    const [owner, member] = await Promise.all([login(ownerInput), login(memberInput)]);
    native = createOfficialBackedOpenClawGatewayClient({
      url: gatewayUrl, token: gatewayToken, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write"],
      stateDir, ensureDeviceIdentity: true, includeDeviceIdentityWithExplicitAuth: true, sharedStateMode: "read-only",
      clientName: "gateway-client", clientVersion: version
    });
    const mutate = (method, params) => native.callNative(method, params, { safety: "mutation", timeoutMs: 12000 });
    const key = "agent:main:dashboard-access-fixture";
    await mutate("sessions.create", { key });
    await mutate("sessions.patch", { key, label: sessionMarker });

    const dashboard = await request("/api/snapshot?force=true", { headers: owner });
    assert.equal(dashboard.status, 200);
    const body = await dashboard.json();
    const targetWorkspace = body.workspaces.find(({ path: value }) => value?.includes(workspaceMarker));
    assert.ok(targetWorkspace);
    const signal = AbortSignal.any([streamLifetime.signal, AbortSignal.timeout(50000)]);
    const ownerEvent = await openStream(origin, owner, signal);
    const initial = await ownerEvent((frame) => frame.startsWith("event: snapshot\n"));
    assert.ok(initial?.includes(workspaceMarker));
    for (const route of [
      "/api/snapshot", "/api/stream?delta=1", "/api/diagnostics", "/api/agents/main/chat",
      "/api/workspaces/" + encodeURIComponent(targetWorkspace.id) + "/files"
    ]) {
      const response = await request(route, { headers: member });
      assert.equal(response.status, 403, route);
      const denied = await response.text();
      assert.ok(!denied.includes(workspaceMarker) && !denied.includes(sessionMarker));
    }
    for (const route of ["/mission-control", "/settings"]) {
      const response = await request(route, { headers: member });
      assert.equal(response.status, 307, route);
      assert.equal(new URL(response.headers.get("location"), origin).pathname, "/operator-access");
      const denied = await response.text();
      assert.ok(!denied.includes(workspaceMarker) && !denied.includes(sessionMarker));
    }
    const nextName = workspaceMarker + "_UPDATED";
    await mutate("agents.update", { agentId: "main", name: nextName });
    await mutate("sessions.patch", { key, label: sessionMarker + "_UPDATED" });
    assert.ok(await ownerEvent((frame) => frame.startsWith("event: snapshot-delta\n") && frame.includes(nextName)));
    const actor = await resolveAgentOsActorContext(new Request(origin, { headers: owner }), env);
    assert.ok(actor?.actorId);
    await invalidateAgentOsUserSessions(actor.actorId, env);
    assert.equal((await request("/api/snapshot", { headers: owner })).status, 401);
    assert.equal(await ownerEvent(() => false), null);
    console.log("PASS dashboard access: owner and service snapshots, member HTTP and SSR denial, authorized SSE deltas, and stream revocation.");
  } finally {
    streamLifetime.abort();
    native?.close("dashboard access fixture complete");
    await Promise.all(children.map(stop));
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
