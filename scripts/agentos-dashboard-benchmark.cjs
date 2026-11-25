const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { createOfficialBackedOpenClawGatewayClient } = require("../lib/openclaw/client/official-gateway-factory.ts");

const packageRoot = process.env.AGENTOS_BENCH_OPENCLAW_PACKAGE;
if (!packageRoot) throw new Error("Set AGENTOS_BENCH_OPENCLAW_PACKAGE to the exact OpenClaw package root.");
const openclaw = path.join(path.resolve(packageRoot), "openclaw.mjs");
const app = require.resolve("next/dist/bin/next");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reservePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
  await exited;
  clearTimeout(timer);
}

async function waitReady(url, child) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (child.exitCode !== null) throw new Error("A disposable benchmark process exited before readiness.");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Readiness timed out for ${new URL(url).pathname}.`);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(values.length * fraction) - 1].toFixed(1));
}

async function watchStream(url, headers, signal) {
  const response = await fetch(url, { headers, signal });
  assert.equal(response.status, 200);
  const metrics = { initialSnapshotBytes: 0, updateBytes: 0, updates: 0, deltas: 0 };
  const arrivals = [];
  const encoder = new TextEncoder();
  let resolveInitial;
  const initial = new Promise((resolve) => { resolveInitial = resolve; });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const completion = (async () => {
    let pending = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      pending += value;
      for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
        const frame = pending.slice(0, end + 2);
        pending = pending.slice(end + 2);
        if (!/^event: snapshot(?:-delta)?\n/.test(frame)) continue;
        const bytes = encoder.encode(frame).byteLength;
        if (!metrics.initialSnapshotBytes) {
          metrics.initialSnapshotBytes = bytes;
          resolveInitial();
          continue;
        }
        metrics.updates++;
        metrics.updateBytes += bytes;
        if (frame.startsWith("event: snapshot-delta\n")) metrics.deltas++;
        arrivals.push(performance.now());
      }
    }
  })().catch((error) => { if (!signal.aborted) throw error; });
  return { initial, completion, metrics, arrivals };
}

function processSample(child) {
  const [rss, cpu] = execFileSync("ps", ["-p", String(child.pid), "-o", "rss=,%cpu="], { encoding: "utf8" })
    .trim().split(/\s+/).map(Number);
  return { rssKiB: rss, cpuPercent: cpu };
}

async function runScale(agentCount, sessionCount, browser) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-dashboard-bench-"));
  const children = [];
  const contexts = [];
  const signal = new AbortController();
  let client;
  try {
    const [gatewayPort, appPort] = await Promise.all([reservePort(), reservePort()]);
    const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
    const appUrl = `http://127.0.0.1:${appPort}`;
    const token = randomUUID();
    const apiToken = randomUUID();
    const state = path.join(root, "state");
    const config = path.join(root, "openclaw.json");
    const workspaces = path.join(root, "workspaces");
    const ids = Array.from({ length: agentCount }, (_, index) => index ? `worker-${index + 1}` : "main");
    await Promise.all([mkdir(state), mkdir(workspaces)]);
    await Promise.all(ids.map((id) => mkdir(path.join(workspaces, id))));
    await writeFile(config, JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      cron: { enabled: false },
      agents: { entries: Object.fromEntries(ids.map((id, index) =>
        [id, { name: `Benchmark agent ${index + 1}`, workspace: path.join(workspaces, id) }]
      )) }
    }), { mode: 0o600 });
    const env = {
      PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root,
      OPENCLAW_CONFIG_PATH: config, OPENCLAW_STATE_DIR: state, OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_GATEWAY_PORT: String(gatewayPort), OPENCLAW_BIN: openclaw,
      AGENTOS_OPENCLAW_GATEWAY_URL: gatewayUrl, AGENTOS_OPENCLAW_GATEWAY_TOKEN: token,
      AGENTOS_RUNTIME_DIR: path.join(root, "agentos"), AGENTOS_API_TOKEN: apiToken, NODE_ENV: "production"
    };
    const launch = (args) => {
      const child = spawn(process.execPath, args, { env, stdio: "ignore" });
      children.push(child);
      return child;
    };
    const gateway = launch([openclaw, "gateway", "run", "--port", String(gatewayPort), "--allow-unconfigured"]);
    await waitReady(`http://127.0.0.1:${gatewayPort}/healthz`, gateway);
    client = createOfficialBackedOpenClawGatewayClient({
      url: gatewayUrl, token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write"],
      stateDir: state, ensureDeviceIdentity: true, includeDeviceIdentityWithExplicitAuth: true, sharedStateMode: "read-only",
      clientName: "gateway-client", clientVersion: "2026.11.10"
    });
    const keys = Array.from({ length: sessionCount }, (_, index) => `agent:${ids[index % ids.length]}:benchmark-${index}`);
    for (let index = 0; index < keys.length; index += 10) {
      await Promise.all(keys.slice(index, index + 10).map((key) =>
        client.callNative("sessions.create", { key }, { safety: "mutation", timeoutMs: 12_000 })
      ));
    }
    const product = launch([app, "start", "--hostname", "127.0.0.1", "--port", String(appPort)]);
    await waitReady(appUrl + "/api/health", product);
    const headers = { Authorization: `Bearer ${apiToken}` };
    const render = async (context) => {
      const page = await context.newPage();
      const started = performance.now();
      await page.goto(appUrl + "/mission-control", { timeout: 45000 });
      await page.getByText("Benchmark agent 1", { exact: true }).first().waitFor({ timeout: 45000 });
      const renderMs = Number((performance.now() - started).toFixed(1));
      await page.close();
      return renderMs;
    };
    const browserContexts = await Promise.all([1, 2].map(() => browser.newContext({ extraHTTPHeaders: headers })));
    contexts.push(...browserContexts);
    const coldRenderMs = await Promise.all(browserContexts.map(render));
    const warmRenderMs = await Promise.all(browserContexts.map(render));
    const streams = await Promise.all(["", "?delta=1"].map((query) =>
      watchStream(appUrl + "/api/stream" + query, headers, signal.signal)
    ));
    const initialTimeout = setTimeout(() => signal.abort(), 30000);
    await Promise.race([Promise.all(streams.map(({ initial }) => initial)), Promise.race(streams.map(({ completion }) => completion))]);
    clearTimeout(initialTimeout);
    assert.ok(streams.every(({ metrics }) => metrics.initialSnapshotBytes > 0));
    const mutations = [];
    for (let index = 0; index < 10; index++) {
      mutations.push(performance.now());
      await client.callNative("sessions.patch", {
        key: keys[index % keys.length], label: `Benchmark update ${index + 1}`
      }, { safety: "mutation", timeoutMs: 12_000 });
      await delay(500);
    }
    await delay(3500);
    signal.abort();
    await Promise.all(streams.map(({ completion }) => completion));
    const summarize = ({ metrics, arrivals }) => ({
      ...metrics,
      eventToWireApproxP95Ms: percentile(arrivals.flatMap((arrival) => {
        const last = mutations.findLast((mutation) => mutation <= arrival);
        return last === undefined ? [] : [arrival - last];
      }), 0.95)
    });
    return {
      agents: agentCount, nativeSessionsCreated: keys.length, browserClients: browserContexts.length,
      coldRenderMs, warmRenderMs, nativeMutations: mutations.length,
      fullStream: summarize(streams[0]), deltaStream: summarize(streams[1]),
      processSamples: { agentos: processSample(product), gateway: processSample(gateway) }
    };
  } finally {
    signal.abort();
    await Promise.all(contexts.map((context) => context.close()));
    client?.close("dashboard benchmark complete");
    await Promise.all(children.map(stop));
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.version, "2026.11.10");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [agents, sessions] of [[1, 1], [10, 100], [50, 500]]) {
      console.log(JSON.stringify(await runScale(agents, sessions, browser)));
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
