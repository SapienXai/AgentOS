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
const productRoot = process.env.AGENTOS_BENCH_APP_ROOT || process.cwd();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mutationCount = Number(process.env.AGENTOS_BENCH_MUTATIONS || 10);
const browserUpdateCount = Number(process.env.AGENTOS_BENCH_DOM_SAMPLES || 5);
const coldPairs = Number(process.env.AGENTOS_BENCH_COLD_PAIRS || 1);
const settleMs = Number(process.env.AGENTOS_BENCH_SETTLE_MS || 0);
const rawStreams = process.env.AGENTOS_BENCH_NO_RAW_SSE === "1" ? [] : ["", "?delta=1"];

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
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`A disposable benchmark process exited before ${new URL(url).pathname}: ${child.diagnostic()}`);
    }
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
          const payload = JSON.parse(frame.split("\n")[1].slice(6));
          metrics.largestFields = Object.entries(payload)
            .map(([key, value]) => [key, encoder.encode(JSON.stringify(value)).byteLength])
            .sort((a, b) => b[1] - a[1]).slice(0, 5);
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
  const [rss, cpuTime] = execFileSync("ps", ["-p", String(child.pid), "-o", "rss=,time="], { encoding: "utf8" })
    .trim().split(/\s+/);
  return { rssKiB: Number(rss), cpuSeconds: cpuTime.split(":").reduce((total, part) => total * 60 + Number(part), 0) };
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
      agents: { ownership: "explicit", defaults: { systemAgent: { agentId: "main" } }, entries: Object.fromEntries(ids.map((id, index) =>
        [id, { name: `Benchmark agent ${index + 1}`, workspace: path.join(workspaces, id) }]
      )) }
    }), { mode: 0o600 });
    const env = {
      PATH: process.env.PATH, HOME: root, USERPROFILE: root, TMPDIR: root,
      OPENCLAW_CONFIG_PATH: config, OPENCLAW_STATE_DIR: state, OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_GATEWAY_PORT: String(gatewayPort), OPENCLAW_BIN: openclaw,
      AGENTOS_OPENCLAW_GATEWAY_URL: gatewayUrl, AGENTOS_OPENCLAW_GATEWAY_TOKEN: token,
      AGENTOS_RUNTIME_DIR: path.join(root, "agentos"), AGENTOS_MISSION_CONTROL_ROOT: path.join(root, "mission-control"),
      AGENTOS_API_TOKEN: apiToken, NODE_ENV: "production"
    };
    const nativeRpcCounts = {};
    const launch = (args, observeOutput, cwd, overrides = {}) => {
      const child = spawn(process.execPath, args, { env: { ...env, ...overrides }, cwd, stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
        observeOutput?.(chunk.toString());
        log = (log + chunk).replaceAll(token, "[credential]").replaceAll(apiToken, "[credential]")
          .replaceAll(root, "[disposable-root]").slice(-2000);
      });
      child.diagnostic = () => log;
      children.push(child);
      return child;
    };
    let gatewayLogRemainder = "";
    const gateway = launch([openclaw, "gateway", "run", "--port", String(gatewayPort), "--allow-unconfigured",
      "--verbose", "--ws-log", "compact"], (chunk) => {
      const lines = (gatewayLogRemainder + chunk).split("\n");
      gatewayLogRemainder = lines.pop() ?? "";
      for (const line of lines) {
        const method = line.match(/\bres\s+[✓✗]\s+([a-zA-Z][\w.]+)/)?.[1];
        if (method) nativeRpcCounts[method] = (nativeRpcCounts[method] ?? 0) + 1;
      }
    });
    await waitReady(`http://127.0.0.1:${gatewayPort}/healthz`, gateway);
    client = createOfficialBackedOpenClawGatewayClient({
      url: gatewayUrl, token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write"],
      stateDir: state, ensureDeviceIdentity: true, includeDeviceIdentityWithExplicitAuth: true, sharedStateMode: "read-only",
      clientName: "gateway-client", clientVersion: "2026.11.10"
    });
    const gatewayRssBeforeSeedKiB = processSample(gateway).rssKiB;
    const keys = Array.from({ length: sessionCount }, (_, index) => `agent:${ids[index % ids.length]}:benchmark-${index}`);
    for (let index = 0; index < keys.length; index += 10) {
      await Promise.all(keys.slice(index, index + 10).map((key) =>
        client.callNative("sessions.create", { key }, { safety: "mutation", timeoutMs: 12_000 })
      ));
    }
    const gatewayRssAfterSeedKiB = processSample(gateway).rssKiB;
    const launchProduct = async (trial) => {
      const child = launch([app, "start", "--hostname", "127.0.0.1", "--port", String(appPort)], undefined, productRoot, {
        AGENTOS_RUNTIME_DIR: path.join(root, "agentos-" + trial),
        AGENTOS_MISSION_CONTROL_ROOT: path.join(root, "mission-control-" + trial)
      });
      await waitReady(appUrl + "/api/auth/status", child);
      return child;
    };
    const headers = { Authorization: `Bearer ${apiToken}` };
    const render = async (context) => {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const marks = { canvasMs: null, firstNodeMs: null, nodeReadyMs: null, longTasks: [], stream: [], route: [] };
        window.agentOsBenchmark = marks;
        const native = window.EventSource;
        window.EventSource = class extends native {
          constructor(url, options) {
            super(url, options);
            if (!String(url).includes("/api/stream")) return;
            for (const kind of ["ready", "snapshot", "snapshot-delta"]) {
              this.addEventListener(kind, event => {
                if (marks.stream.length >= 16) return;
                let payload;
                try { payload = JSON.parse(event.data); } catch {}
                marks.stream.push({ kind, ms: Math.round(performance.now()), mode: payload?.mode ?? null,
                  employees: Array.isArray(payload?.agents) ? payload.agents.length : null });
              });
            }
          }
        };
        function inspectNode() {
          const nodes = document.querySelectorAll(".react-flow__node-agent");
          // The animated visible label uses non-breaking spaces between glyphs. Its
          // accessible name is stable and exact, including while an old name exits.
          const node = document.querySelector('.react-flow__node-agent [aria-label="Benchmark agent 1"]')?.closest(".react-flow__node-agent");
          const rect = node?.getBoundingClientRect();
          const label = node?.querySelector('[aria-label="Benchmark agent 1"]');
          const action = node?.querySelector('button[aria-label="Message Benchmark agent 1"]');
          return { count: nodes.length, correctName: !!node, nodeId: node?.getAttribute("data-id") ?? null,
            onscreen: !!rect && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight,
            labelShows: !!label && Number(getComputedStyle(label).opacity) > 0,
            actionEnabled: !!action && !action.disabled };
        }
        const dom = new MutationObserver(() => {
          if (marks.canvasMs === null && document.querySelector(".react-flow")) marks.canvasMs = performance.now();
          if (marks.firstNodeMs === null && document.querySelector(".react-flow__node-agent")) marks.firstNodeMs = performance.now();
          const result = inspectNode();
          if (marks.nodeReadyMs === null && result.correctName && result.onscreen && result.labelShows && result.actionEnabled) {
            marks.nodeReadyMs = performance.now();
            marks.route.push(result);
            dom.disconnect();
          }
        });
        dom.observe(document, { childList: true, attributes: true, attributeFilter: ["style", "class", "aria-label", "disabled"], subtree: true });
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          new PerformanceObserver(list => {
            marks.longTasks.push(...list.getEntries().slice(0, 24).map(entry => Math.round(entry.duration)));
          }).observe({ type: "longtask", buffered: true });
        }
      });
      const started = performance.now();
      const navigation = await page.goto(appUrl + "/mission-control", { timeout: 45000, waitUntil: "domcontentloaded" });
      await page.getByText("Benchmark agent 1", { exact: true }).first().waitFor({ timeout: 45000 });
      const renderMs = Number((performance.now() - started).toFixed(1));
      const html = await navigation.text();
      const nav = await page.evaluate(() => {
        const entry = performance.getEntriesByType("navigation")[0];
        const marks = window.agentOsBenchmark;
        return {
          ttfbMs: Math.round(entry.responseStart),
          domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
          canvasMs: marks?.canvasMs == null ? null : Math.round(marks.canvasMs),
          firstNodeMs: marks?.firstNodeMs == null ? null : Math.round(marks.firstNodeMs),
          nodeReadyMs: marks?.nodeReadyMs == null ? null : Math.round(marks.nodeReadyMs),
          observedNativeNode: marks?.route.at(0) ?? null, stream: marks?.stream ?? [],
          longTaskMs: marks?.longTasks.reduce((total, value) => total + value, 0) ?? null,
          maxLongTaskMs: marks?.longTasks.length ? Math.max(...marks.longTasks) : null
        };
      });
      return {
        page,
        timings: { renderMs, ...nav, htmlBytes: Buffer.byteLength(html), rosterInInitialHtml: html.includes("Benchmark agent 1") }
      };
    };
    let browserContexts = [];
    let product;
    const countDelta = (before, after) => Object.fromEntries(Object.entries(after)
      .map(([method, count]) => [method, count - (before[method] ?? 0)]).filter(([, count]) => count > 0));
    const cold = [];
    const coldRpcCountsByPair = [];
    for (let trial = 0; trial < coldPairs; trial++) {
      product = await launchProduct(trial);
      browserContexts = await Promise.all([1, 2].map(() => browser.newContext({
        extraHTTPHeaders: headers, viewport: { width: 1440, height: 900 }
      })));
      contexts.push(...browserContexts);
      const beforeCold = { ...nativeRpcCounts };
      const pair = await Promise.all(browserContexts.map(render));
      const calls = countDelta(beforeCold, nativeRpcCounts);
      coldRpcCountsByPair.push(calls);
      cold.push(...pair.map(record => record.timings));
      await Promise.all(pair.map(({ page }) => page.close()));
      if (trial < coldPairs - 1) {
        await Promise.all(browserContexts.map(context => context.close()));
        await stop(product);
      }
    }
    const coldRpcCounts = coldRpcCountsByPair.at(-1);
    const warm = await Promise.all(browserContexts.map(render));
    const calculateDomUpdates = async () => {
      const samples = [];
      const admission = [];
      let missed = 0;
      for (let index = 0; index < browserUpdateCount; index++) {
        const label = `Benchmark agent update ${index + 1}`;
        await Promise.all(warm.map(({ page }) => page.evaluate(expected => {
          window.agentOsUpdate?.observer.disconnect();
          const update = { observedAt: null, observer: null };
          const inspect = () => {
            const node = document.querySelector(`.react-flow__node-agent [aria-label="${expected}"]`)?.closest(".react-flow__node-agent");
            const action = node?.querySelector(`button[aria-label="Message ${expected}"]`);
            const bounds = node?.getBoundingClientRect();
            if (!action || action.disabled || !bounds || bounds.right <= 0 || bounds.bottom <= 0 ||
              bounds.top >= innerHeight || bounds.left >= innerWidth) return;
            update.observedAt = performance.timeOrigin + performance.now();
            update.observer.disconnect();
          };
          update.observer = new MutationObserver(inspect);
          update.observer.observe(document, { childList: true, attributes: true, attributeFilter: ["aria-label", "disabled"], subtree: true });
          window.agentOsUpdate = update;
        }, label)));
        const started = performance.now();
        await client.callNative("agents.update", { agentId: "main", name: label }, { safety: "mutation", timeoutMs: 12_000 });
        const agentAck = performance.now();
        // Wake the existing snapshot subscription with the same native session
        // event used in the stream workload. Observe the new roster name in the DOM.
        await client.callNative("sessions.patch", { key: keys[0], label }, { safety: "mutation", timeoutMs: 12_000 });
        const eventAck = performance.now();
        const both = Promise.allSettled(warm.map(({ page }) =>
          page.getByText(label, { exact: true }).first().waitFor({ timeout: 5000 })
        )).then(visible => {
          if (visible.every(({ status }) => status === "fulfilled")) samples.push(performance.now() - started);
          else missed++;
        });
        const actionable = await Promise.all(warm.map(async ({ page }) => {
          try {
            const mark = await page.waitForFunction(() => window.agentOsUpdate?.observedAt, undefined, { timeout: 5000 });
            return (await mark.jsonValue()) - performance.timeOrigin;
          } catch { return null; }
        }));
        await both;
        admission.push({
          agentRpcMs: Number((agentAck - started).toFixed(1)),
          eventRpcMs: Number((eventAck - agentAck).toFixed(1)),
          actionableMs: actionable.map(time => time === null ? null : Number((time - started).toFixed(1))),
          postRpcActionableMs: actionable.map(time => time === null ? null : Number((time - eventAck).toFixed(1)))
        });
      }
      return { samples: samples.length, missed, medianMs: percentile(samples, .50), p95Ms: percentile(samples, 0.95),
        worstMs: samples.length ? Math.max(...samples) : null, timingsMs: samples.map((value) => Number(value.toFixed(1))), admission };
    };
    const streams = await Promise.all(rawStreams.map((query) =>
      watchStream(appUrl + "/api/stream" + query, headers, signal.signal)
    ));
    if (streams.length > 0) {
      const initialTimeout = setTimeout(() => signal.abort(), 30000);
      await Promise.race([Promise.all(streams.map(({ initial }) => initial)), Promise.race(streams.map(({ completion }) => completion))]);
      clearTimeout(initialTimeout);
      assert.ok(streams.every(({ metrics }) => metrics.initialSnapshotBytes > 0));
    }
    if (settleMs > 0) await delay(settleMs);
    const measuredStarted = performance.now();
    const cpuStart = { agentos: processSample(product), gateway: processSample(gateway) };
    const beforeMutations = { ...nativeRpcCounts };
    const mutations = [];
    for (let index = 0; index < mutationCount; index++) {
      mutations.push(performance.now());
      await client.callNative("sessions.patch", {
        key: keys[index % keys.length], label: `Benchmark update ${index + 1}`
      }, { safety: "mutation", timeoutMs: 12_000 });
      await delay(500);
    }
    await delay(3500);
    signal.abort();
    await Promise.all(streams.map(({ completion }) => completion));
    const measuredSeconds = (performance.now() - measuredStarted) / 1000;
    const sampleWorkload = (child, initial) => {
      const sample = processSample(child);
      return { rssKiB: sample.rssKiB, cpuAveragePercent: Number((100 * (sample.cpuSeconds - initial.cpuSeconds) / measuredSeconds).toFixed(1)) };
    };
    const processSamples = { agentos: sampleWorkload(product, cpuStart.agentos), gateway: sampleWorkload(gateway, cpuStart.gateway) };
    const mutationRpcCounts = countDelta(beforeMutations, nativeRpcCounts);
    const visibleUpdate = await calculateDomUpdates();
    const summarize = ({ metrics, arrivals }) => ({
      ...metrics,
      eventToWireApproxP95Ms: percentile(arrivals.flatMap((arrival) => {
        const last = mutations.findLast((mutation) => mutation <= arrival);
        return last === undefined ? [] : [arrival - last];
      }), 0.95)
    });
    const coldSamples = cold.map(sample => sample.renderMs);
    return {
      agents: agentCount, nativeSessionsCreated: keys.length, browserClients: browserContexts.length, rawSseClients: streams.length,
      cold, warm: warm.map(({ timings }) => timings),
      coldDistribution: { medianMs: percentile(coldSamples, .50), p95Ms: percentile(coldSamples, .95), worstMs: Math.max(...coldSamples) },
      coldRpcCounts, coldRpcCountsByPair, mutationRpcCounts, visibleUpdate, nativeMutations: mutations.length, settleMs,
      fullStream: streams[0] && summarize(streams[0]), deltaStream: streams[1] && summarize(streams[1]),
      processSamples, gatewayRssBeforeSeedKiB, gatewayRssAfterSeedKiB
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
  assert.ok(Number.isSafeInteger(mutationCount) && mutationCount > 0);
  assert.ok(Number.isSafeInteger(browserUpdateCount) && browserUpdateCount > 0);
  assert.ok(Number.isSafeInteger(coldPairs) && coldPairs >= 1 && coldPairs <= 20);
  assert.ok(Number.isSafeInteger(settleMs) && settleMs >= 0);
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.version, "2026.11.10");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [agents, sessions] of [[1, 1], [10, 100], [50, 500]]) {
      if (process.env.AGENTOS_BENCH_AGENT_COUNT && String(agents) !== process.env.AGENTOS_BENCH_AGENT_COUNT) continue;
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
