import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";

import { bootstrapRailwayOpenClawConfig } from "./railway-openclaw-bootstrap.mjs";
import { startRailwayPublicProxy } from "./railway-public-proxy.mjs";
import { createGatewaySupervisor } from "./railway-supervisor-runtime.mjs";

const gatewayPort = parsePort(process.env.OPENCLAW_GATEWAY_PORT, 18789);
const publicPort = parsePort(process.env.PORT, 3000);
const agentosPort = 3001;
const browserWorkerPort = 18794;
const remoteBrowserWorkerUrl = normalizeBrowserWorkerUrl(process.env.AGENTOS_BROWSER_WORKER_URL);
const browserWorkerUrl = remoteBrowserWorkerUrl || `http://127.0.0.1:${browserWorkerPort}`;
const browserWorkerLivenessUrl = `${browserWorkerUrl}/healthz`;
const browserWorkerSocketPath = process.env.AGENTOS_BROWSER_WORKER_SOCKET_PATH?.trim() || "/tmp/agentos-browser-worker.sock";
const browserPolicyReadyPath = process.env.AGENTOS_BROWSER_POLICY_READY_PATH?.trim() || "/tmp/agentos-browser-policy.ready";
const supervisorSocketPath = process.env.AGENTOS_SUPERVISOR_SOCKET_PATH?.trim() || "/tmp/agentos-supervisor.sock";

if (process.env.AGENTOS_SUPERVISOR_TEST_MODE === "1") {
  await runDisposableSupervisor();
} else {
  await runRailwaySupervisor();
}

async function runDisposableSupervisor() {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  const configPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
  const binary = process.env.OPENCLAW_GATEWAY_BINARY?.trim() || process.env.OPENCLAW_BIN?.trim() || "openclaw";
  if (!stateDir || !configPath) throw new Error("OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH are required in supervisor test mode.");
  const supervisor = createGatewaySupervisor({
    binary,
    port: gatewayPort,
    stateDir,
    configPath,
    token: process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || "",
    socketPath: supervisorSocketPath,
    environment: process.env,
    allowUnconfigured: true,
    healthIntervalMs: 250,
    healthFailureThreshold: 2,
    restartFailureLimit: 3
  });
  process.once("SIGTERM", () => { void supervisor.stop("SIGTERM"); });
  process.once("SIGINT", () => { void supervisor.stop("SIGINT"); });
  try {
    await supervisor.start();
    console.error("Disposable Gateway supervisor is ready.");
    await supervisor.closed;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Disposable Gateway supervisor failed.");
    await supervisor.stop();
    process.exitCode = 1;
  }
}

async function runRailwaySupervisor() {
  const browserPolicyToken = randomBytes(32).toString("base64url");
  const gatewayEnv = { ...process.env };
  delete gatewayEnv.AGENTOS_INITIAL_ADMIN_PASSWORD;
  gatewayEnv.AGENTOS_BROWSER_POLICY_READY_PATH = browserPolicyReadyPath;
  gatewayEnv.AGENTOS_MISSION_CONTROL_ROOT = "/agentos/.mission-control";
  gatewayEnv.AGENTOS_BROWSER_POLICY_TOKEN = browserPolicyToken;
  gatewayEnv.AGENTOS_BROWSER_POLICY_HEARTBEAT_URL = `http://127.0.0.1:${agentosPort}/api/internal/browser-policy/heartbeat`;
  const browserProxyToken = randomBytes(32).toString("base64url");
  const browserWorkerToken = remoteBrowserWorkerUrl
    ? requireBrowserWorkerToken(process.env.AGENTOS_BROWSER_WORKER_TOKEN)
    : randomBytes(32).toString("base64url");
  const gatewayFailure = deferred();
  let browserWorker = null;
  let agentos = null;
  let publicProxy = null;
  let stopping = false;

  await bootstrapRailwayOpenClawConfig(gatewayEnv);
  await unlink(browserPolicyReadyPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });

  const gatewaySupervisor = createGatewaySupervisor({
    binary: process.env.OPENCLAW_GATEWAY_BINARY?.trim() || "openclaw",
    port: gatewayPort,
    stateDir: process.env.OPENCLAW_STATE_DIR?.trim() || "/data/openclaw",
    configPath: process.env.OPENCLAW_CONFIG_PATH?.trim() || "/data/openclaw/openclaw.json",
    token: process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || "",
    socketPath: supervisorSocketPath,
    environment: gatewayEnv,
    onCrashLoop: (details) => gatewayFailure.resolve({ label: "OpenClaw Gateway crash loop", details })
  });

  const stop = (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    publicProxy?.close();
    agentos?.kill(signal);
    browserWorker?.kill(signal);
    void gatewaySupervisor.stop(signal);
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  try {
    await gatewaySupervisor.start();
    browserWorker = remoteBrowserWorkerUrl ? null : startBrowserWorker(browserWorkerToken);
    await waitForBrowserWorkerLiveness(browserWorker);
    const agentosEnv = {
      ...process.env,
      PORT: String(agentosPort),
      HOSTNAME: "127.0.0.1",
      AGENTOS_BROWSER_PROXY_TOKEN: browserProxyToken,
      AGENTOS_BROWSER_WORKER_SOCKET_PATH: browserWorkerSocketPath,
      AGENTOS_BROWSER_WORKER_URL: remoteBrowserWorkerUrl || "",
      AGENTOS_BROWSER_WORKER_TOKEN: browserWorkerToken,
      AGENTOS_BROWSER_CDP_RELAY_URL: `http://127.0.0.1:${publicPort}/_agentos/browser-cdp`,
      AGENTOS_BROWSER_POLICY_READY_PATH: browserPolicyReadyPath,
      AGENTOS_BROWSER_POLICY_TOKEN: browserPolicyToken
    };
    agentos = spawn(process.execPath, ["/agentos/server.js"], { env: agentosEnv, stdio: "inherit" });
    const agentosExit = childExit(agentos, "AgentOS");
    agentos.once("error", (error) => {
      console.error(`AgentOS could not start: ${error.message}`);
      gatewayFailure.resolve({ label: "AgentOS", code: null, signal: null });
    });
    publicProxy = await startRailwayPublicProxy({ publicPort, nextPort: agentosPort, browserWorkerUrl, browserProxyToken, browserWorkerToken });
    console.error("AgentOS same-origin public proxy is ready.");

    while (!stopping) {
      const browserHealthMonitor = new AbortController();
      const exit = await Promise.race([
        agentosExit,
        gatewayFailure.promise,
        browserWorker ? childExit(browserWorker, "Secure browser worker") : new Promise(() => {}),
        waitForBrowserWorkerLivenessFailure(browserWorker, browserHealthMonitor.signal)
      ]);
      browserHealthMonitor.abort();
      if (stopping) break;
      if (exit.label === "OpenClaw Gateway crash loop") {
        console.error("OpenClaw Gateway recovery is blocked after bounded crash-loop protection.");
        process.exitCode = 1;
        stop();
        break;
      }
      if (exit.label === "AgentOS") {
        console.error(`AgentOS stopped unexpectedly (code ${exit.code ?? "unknown"}).`);
        process.exitCode = 1;
        stop();
        break;
      }
      if (exit.label === "Secure browser worker" || exit.label === "Secure browser worker health") {
        await notifyBrowserWorkerRestart();
        await recoverBrowserWorker({ browserWorker, remoteBrowserWorkerUrl, browserWorkerToken, setBrowserWorker: (value) => { browserWorker = value; } });
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "A required managed service did not become ready.");
    process.exitCode = 1;
    stop();
  }

  await gatewaySupervisor.stop();
  await closeServer(publicProxy);
  await unlink(supervisorSocketPath).catch(() => {});
  process.exit(process.exitCode ?? 0);
}

async function notifyBrowserWorkerRestart() {
  try {
    const response = await fetch(
      `http://127.0.0.1:${agentosPort}/api/internal/browser-policy/worker-event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentOS-Browser-Policy-Token": process.env.AGENTOS_BROWSER_POLICY_TOKEN?.trim() || ""
        },
        body: JSON.stringify({ event: "worker-restarting" }),
        signal: AbortSignal.timeout(2_500)
      }
    );
    if (!response.ok) console.error("AgentOS could not fence active browser sessions before worker restart.");
  } catch {
    console.error("AgentOS browser session fencing was unavailable during worker restart.");
  }
}

function startBrowserWorker(token) {
  const child = spawn(process.execPath, ["/agentos/scripts/secure-browser-worker.mjs"], {
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CHROME_BIN: process.env.CHROME_BIN,
      AGENTOS_BROWSER_PROFILE_ROOT: process.env.AGENTOS_BROWSER_PROFILE_ROOT || "/data/browser-profiles",
      AGENTOS_BROWSER_WORKER_SOCKET_PATH: browserWorkerSocketPath,
      AGENTOS_BROWSER_WORKER_PORT: String(browserWorkerPort),
      AGENTOS_BROWSER_SESSION_TTL_MS: String(20 * 60_000),
      AGENTOS_BROWSER_WORKER_TOKEN: token,
      AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX: process.env.AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX === "1" ? "1" : "0"
    },
    stdio: "inherit",
    detached: true
  });
  child.once("error", (error) => console.error(`Secure browser worker could not start: ${error.message}`));
  return child;
}

async function recoverBrowserWorker(input) {
  if (input.remoteBrowserWorkerUrl) {
    await waitForBrowserWorkerLiveness();
    return;
  }
  if (input.browserWorker?.pid) terminateProcessGroup(input.browserWorker.pid);
  const next = startBrowserWorker(input.browserWorkerToken);
  input.setBrowserWorker(next);
  await waitForBrowserWorkerLiveness(next);
  console.error("Secure browser worker recovered and passed liveness checks.");
}

async function waitForBrowserWorkerLiveness(child = null) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error("Secure browser worker exited during startup.");
    if (await isBrowserWorkerLive()) return;
    await wait(250);
  }
  throw new Error("Secure browser worker did not become live within 60 seconds.");
}

async function waitForBrowserWorkerLivenessFailure(child, signal) {
  let failures = 0;
  while (!signal.aborted && (!child || child.exitCode === null)) {
    await wait(5_000, signal);
    if (signal.aborted || (child && child.exitCode !== null)) break;
    if (await isBrowserWorkerLive()) { failures = 0; continue; }
    failures += 1;
    if (failures >= 3) return { label: "Secure browser worker health", code: null, signal: null };
  }
  return new Promise(() => {});
}

async function isBrowserWorkerLive() {
  return fetch(browserWorkerLivenessUrl, { signal: AbortSignal.timeout(1_500) }).then((response) => response.ok).catch(() => false);
}

function terminateProcessGroup(pid) {
  try { process.kill(-pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") console.error("Browser process cleanup failed."); }
  setTimeout(() => {
    try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") console.error("Browser process cleanup failed."); }
  }, 500).unref();
}

function childExit(child, label) {
  if (child.exitCode !== null) return Promise.resolve({ label, code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ label, code, signal })));
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function parsePort(value, fallback) {
  const port = Number.parseInt(value || "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : fallback;
}

function normalizeBrowserWorkerUrl(value) {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("AGENTOS_BROWSER_WORKER_URL must be an HTTP(S) service origin.");
  if (process.env.AGENTOS_DEPLOYMENT_PLATFORM === "railway" && url.hostname !== "127.0.0.1" && !url.hostname.endsWith(".railway.internal")) throw new Error("Railway Secure Browser workers must use a private .railway.internal hostname.");
  return url.origin;
}

function requireBrowserWorkerToken(value) {
  const token = value?.trim();
  if (!token || token.length < 32) throw new Error("AGENTOS_BROWSER_WORKER_TOKEN must contain at least 32 characters for a private browser worker.");
  return token;
}
