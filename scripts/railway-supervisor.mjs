import { chmod, unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

import { bootstrapRailwayOpenClawConfig } from "./railway-openclaw-bootstrap.mjs";
import { startRailwayPublicProxy } from "./railway-public-proxy.mjs";

const gatewayPort = 18789;
const gatewayLivenessUrl = `http://127.0.0.1:${gatewayPort}/healthz`;
const publicPort = Number.parseInt(process.env.PORT || "3000", 10);
const agentosPort = 3001;
const browserWorkerPort = 18794;
const remoteBrowserWorkerUrl = normalizeBrowserWorkerUrl(
  process.env.AGENTOS_BROWSER_WORKER_URL
);
const browserWorkerUrl =
  remoteBrowserWorkerUrl || `http://127.0.0.1:${browserWorkerPort}`;
const browserWorkerLivenessUrl = `${browserWorkerUrl}/healthz`;
const browserWorkerSocketPath =
  process.env.AGENTOS_BROWSER_WORKER_SOCKET_PATH?.trim() ||
  "/tmp/agentos-browser-worker.sock";
const browserPolicyReadyPath =
  process.env.AGENTOS_BROWSER_POLICY_READY_PATH?.trim() ||
  "/tmp/agentos-browser-policy.ready";
const supervisorSocketPath = process.env.AGENTOS_SUPERVISOR_SOCKET_PATH?.trim() || "/tmp/agentos-supervisor.sock";
const gatewayHealthIntervalMs = 5_000;
const gatewayHealthFailureThreshold = 3;
const browserWorkerHealthFailureThreshold = 3;
const gatewayStopTimeoutMs = 10_000;
const gatewayRestartFailureLimit = 3;
const browserWorkerRestartFailureLimit = 3;
const manualRestartCooldownMs = 10_000;
const browserPolicyToken = randomBytes(32).toString("base64url");
const gatewayEnv = { ...process.env };
delete gatewayEnv.AGENTOS_INITIAL_ADMIN_PASSWORD;
gatewayEnv.AGENTOS_BROWSER_POLICY_READY_PATH = browserPolicyReadyPath;
gatewayEnv.AGENTOS_MISSION_CONTROL_ROOT = "/agentos/.mission-control";
gatewayEnv.AGENTOS_BROWSER_POLICY_TOKEN = browserPolicyToken;
gatewayEnv.AGENTOS_BROWSER_POLICY_HEARTBEAT_URL =
  `http://127.0.0.1:${agentosPort}/api/internal/browser-policy/heartbeat`;
const browserProxyToken = randomBytes(32).toString("base64url");
const browserWorkerToken = remoteBrowserWorkerUrl
  ? requireBrowserWorkerToken(process.env.AGENTOS_BROWSER_WORKER_TOKEN)
  : randomBytes(32).toString("base64url");

await bootstrapRailwayOpenClawConfig(gatewayEnv);
await unlink(browserPolicyReadyPath).catch((error) => {
  if (error?.code !== "ENOENT") throw error;
});

let gateway = startGateway();
let browserWorker = remoteBrowserWorkerUrl ? null : startBrowserWorker();
let agentos = null;
let publicProxy = null;
let stopping = false;
let consecutiveRestartFailures = 0;
let consecutiveBrowserWorkerRestartFailures = 0;
let manualRestart = null;
let lastManualRestartCompletedAt = 0;
let gatewayTransitionInProgress = false;

const controlServer = await startControlServer();

const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  manualRestart?.reject(new Error("The Railway service is stopping."));
  manualRestart = null;
  controlServer.close();
  publicProxy?.close();
  agentos?.kill(signal);
  browserWorker?.kill(signal);
  gateway.kill(signal);
};

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

try {
  await Promise.all([
    waitForGatewayLiveness(),
    waitForBrowserWorkerLiveness()
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : "A required managed service did not become ready.");
  stop();
  process.exit(1);
}

if (
  gateway.exitCode !== null ||
  (browserWorker && browserWorker.exitCode !== null)
) {
  console.error("A required managed service exited before AgentOS started.");
  process.exit(1);
}

const agentosEnv = {
  ...process.env,
  PORT: String(agentosPort),
  HOSTNAME: "127.0.0.1",
  AGENTOS_BROWSER_PROXY_TOKEN: browserProxyToken,
  AGENTOS_BROWSER_WORKER_SOCKET_PATH: browserWorkerSocketPath,
  AGENTOS_BROWSER_WORKER_URL: remoteBrowserWorkerUrl || "",
  AGENTOS_BROWSER_WORKER_TOKEN: browserWorkerToken,
  AGENTOS_BROWSER_CDP_RELAY_URL:
    `http://127.0.0.1:${publicPort}/_agentos/browser-cdp`,
  AGENTOS_BROWSER_POLICY_READY_PATH: browserPolicyReadyPath,
  AGENTOS_BROWSER_POLICY_TOKEN: browserPolicyToken
};
agentos = spawn(process.execPath, ["/agentos/server.js"], {
  env: agentosEnv,
  stdio: "inherit"
});

agentos.once("error", (error) => {
  console.error(`AgentOS could not start: ${error.message}`);
  process.exitCode = 1;
  stop();
});

const agentosExit = childExit(agentos, "AgentOS");
publicProxy = await startRailwayPublicProxy({
  publicPort,
  nextPort: agentosPort,
  browserWorkerUrl,
  browserProxyToken,
  browserWorkerToken
});
console.error("AgentOS same-origin public proxy is ready.");

while (!stopping) {
  const healthMonitor = new AbortController();
  const browserHealthMonitor = new AbortController();
  const exit = await Promise.race([
    childExit(gateway, "OpenClaw Gateway"),
    browserWorker
      ? childExit(browserWorker, "Secure browser worker")
      : new Promise(() => {}),
    agentosExit,
    waitForGatewayLivenessFailure(gateway, healthMonitor.signal),
    waitForBrowserWorkerLivenessFailure(browserWorker, browserHealthMonitor.signal)
  ]);
  healthMonitor.abort();
  browserHealthMonitor.abort();

  if (stopping) break;

  if (exit.label === "AgentOS") {
    console.error(`AgentOS stopped unexpectedly (code ${exit.code ?? "unknown"}).`);
    process.exitCode = 1;
    stop();
    break;
  }

  if (exit.label === "Secure browser worker" || exit.label === "Secure browser worker health") {
    await notifyBrowserWorkerRestart();
    if (remoteBrowserWorkerUrl) {
      console.error(
        "Private Secure browser worker is unavailable. AgentOS remains online while the worker service recovers."
      );
      try {
        await waitForBrowserWorkerLiveness();
        console.error("Private Secure browser worker recovered and passed liveness checks.");
      } catch (error) {
        console.error(
          error instanceof Error
            ? error.message
            : "Private Secure browser worker did not recover."
        );
      }
      continue;
    }
    if (exit.label === "Secure browser worker health" && browserWorker.exitCode === null) {
      console.error("Secure browser worker became unhealthy. Stopping the managed process.");
      await stopManagedProcess(browserWorker, "Secure browser worker");
    }
    await terminateBrowserWorkerProcessGroup(browserWorker.pid);
    consecutiveBrowserWorkerRestartFailures += 1;
    if (consecutiveBrowserWorkerRestartFailures > browserWorkerRestartFailureLimit) {
      console.error("Secure browser worker restart attempts exhausted. Exiting so Railway can restart the service.");
      process.exitCode = 1;
      stop();
      break;
    }
    const delayMs = gatewayRestartDelayMs(consecutiveBrowserWorkerRestartFailures);
    console.error(
      `Secure browser worker stopped or became unavailable. Restart attempt ${consecutiveBrowserWorkerRestartFailures}/${browserWorkerRestartFailureLimit} in ${delayMs}ms.`
    );
    await wait(delayMs);
    browserWorker = startBrowserWorker();
    try {
      await waitForBrowserWorkerLiveness();
      console.error("Secure browser worker restarted successfully and passed liveness checks.");
      consecutiveBrowserWorkerRestartFailures = 0;
    } catch (error) {
      console.error(
        error instanceof Error
          ? error.message
          : "Secure browser worker restart did not become ready."
      );
      await stopManagedProcess(browserWorker, "Secure browser worker");
    }
    continue;
  }

  const requestedRestart = manualRestart;
  gatewayTransitionInProgress = true;
  const restartReason = requestedRestart
    ? "manual operator request"
    : exit.label === "OpenClaw Gateway health"
      ? "liveness checks failed"
      : formatChildExit(exit);

  if (exit.label === "OpenClaw Gateway health" && gateway.exitCode === null) {
    console.error(`OpenClaw Gateway became unhealthy (${restartReason}). Stopping the managed process.`);
    await stopGatewayProcess(gateway);
  }

  const restartAttempt = consecutiveRestartFailures + 1;
  const delayMs = requestedRestart ? 0 : gatewayRestartDelayMs(restartAttempt);
  console.error(
    `OpenClaw Gateway stopped or became unavailable (${restartReason}). Restart attempt ${restartAttempt}/${gatewayRestartFailureLimit} in ${delayMs}ms.`
  );

  if (delayMs > 0) {
    await wait(delayMs);
  }
  gateway = startGateway();

  try {
    await waitForGatewayLiveness();
    console.error("OpenClaw Gateway restarted successfully and passed liveness checks.");
    consecutiveRestartFailures = 0;
    gatewayTransitionInProgress = false;
    if (requestedRestart && manualRestart === requestedRestart) {
      lastManualRestartCompletedAt = Date.now();
      manualRestart = null;
      requestedRestart.resolve({
        ok: true,
        message: "Managed OpenClaw Gateway restarted and is live."
      });
    }
  } catch (error) {
    consecutiveRestartFailures += 1;
    const message = error instanceof Error ? error.message : "OpenClaw Gateway restart did not become ready.";
    console.error(`OpenClaw Gateway restart attempt ${consecutiveRestartFailures}/${gatewayRestartFailureLimit} failed: ${message}`);

    if (requestedRestart && manualRestart === requestedRestart) {
      lastManualRestartCompletedAt = Date.now();
      manualRestart = null;
      requestedRestart.reject(new Error(message));
    }

    await stopGatewayProcess(gateway);
    if (consecutiveRestartFailures >= gatewayRestartFailureLimit) {
      console.error("OpenClaw Gateway restart attempts exhausted. Exiting so Railway can restart the service.");
      process.exitCode = 1;
      stop();
      break;
    }
  }
}

await Promise.allSettled([
  childExit(gateway, "OpenClaw Gateway"),
  browserWorker
    ? childExit(browserWorker, "Secure browser worker")
    : Promise.resolve(),
  agentosExit,
  closeServer(publicProxy),
  removeControlSocket()
]);
process.exit(process.exitCode ?? 0);

function startGateway() {
  try {
    unlinkSync(browserPolicyReadyPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("Browser policy readiness marker could not be cleared.");
    }
  }
  const child = spawn("openclaw", [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--auth",
    "token",
    "--compact",
    "--port",
    String(gatewayPort)
  ], {
    env: gatewayEnv,
    stdio: "inherit"
  });

  child.once("error", (error) => {
    console.error(`OpenClaw Gateway could not start: ${error.message}`);
  });

  return child;
}

function startBrowserWorker() {
  const child = spawn(process.execPath, ["/agentos/scripts/secure-browser-worker.mjs"], {
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CHROME_BIN: process.env.CHROME_BIN,
      AGENTOS_BROWSER_PROFILE_ROOT:
        process.env.AGENTOS_BROWSER_PROFILE_ROOT || "/data/browser-profiles",
      AGENTOS_BROWSER_WORKER_SOCKET_PATH: browserWorkerSocketPath,
      AGENTOS_BROWSER_WORKER_PORT: String(browserWorkerPort),
      AGENTOS_BROWSER_SESSION_TTL_MS: String(20 * 60_000),
      AGENTOS_BROWSER_WORKER_TOKEN: browserWorkerToken,
      AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX:
        process.env.AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX === "1" ? "1" : "0"
    },
    stdio: "inherit",
    detached: true
  });
  child.once("error", (error) => {
    console.error(`Secure browser worker could not start: ${error.message}`);
  });
  return child;
}

async function terminateBrowserWorkerProcessGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error("Secure browser process-group cleanup could not send SIGTERM.");
    }
    return;
  }
  await wait(500);
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error("Secure browser process-group cleanup could not send SIGKILL.");
    }
  }
}

async function waitForGatewayLiveness() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) {
      throw new Error(`OpenClaw Gateway exited during startup (code ${gateway.exitCode}).`);
    }

    if (await isGatewayLive()) return;
    await wait(500);
  }

  throw new Error("OpenClaw Gateway did not become live within 120 seconds.");
}

async function waitForGatewayLivenessFailure(child, signal) {
  let consecutiveFailures = 0;

  while (!signal.aborted && child.exitCode === null) {
    await wait(gatewayHealthIntervalMs, signal);
    if (signal.aborted || child.exitCode !== null) break;

    if (await isGatewayLive()) {
      consecutiveFailures = 0;
      continue;
    }

    consecutiveFailures += 1;
    console.error(`OpenClaw Gateway liveness probe failed (${consecutiveFailures}/${gatewayHealthFailureThreshold}).`);
    if (consecutiveFailures >= gatewayHealthFailureThreshold) {
      return { label: "OpenClaw Gateway health", code: null, signal: null };
    }
  }

  return new Promise(() => {});
}

async function isGatewayLive() {
  try {
    const response = await fetch(gatewayLivenessUrl, {
      signal: AbortSignal.timeout(1_500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBrowserWorkerLiveness() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (browserWorker && browserWorker.exitCode !== null) {
      throw new Error("Secure browser worker exited during startup.");
    }
    if (await isBrowserWorkerLive()) return;
    await wait(250);
  }
  throw new Error("Secure browser worker did not become live within 60 seconds.");
}

async function waitForBrowserWorkerLivenessFailure(child, signal) {
  let consecutiveFailures = 0;
  while (!signal.aborted && (!child || child.exitCode === null)) {
    await wait(gatewayHealthIntervalMs, signal);
    if (signal.aborted || (child && child.exitCode !== null)) break;
    if (await isBrowserWorkerLive()) {
      consecutiveFailures = 0;
      continue;
    }
    consecutiveFailures += 1;
    console.error(
      `Secure browser worker liveness probe failed (${consecutiveFailures}/${browserWorkerHealthFailureThreshold}).`
    );
    if (consecutiveFailures >= browserWorkerHealthFailureThreshold) {
      return { label: "Secure browser worker health", code: null, signal: null };
    }
  }
  return new Promise(() => {});
}

async function isBrowserWorkerLive() {
  try {
    const response = await fetch(browserWorkerLivenessUrl, {
      signal: AbortSignal.timeout(1_500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function notifyBrowserWorkerRestart() {
  try {
    const response = await fetch(
      `http://127.0.0.1:${agentosPort}/api/internal/browser-policy/worker-event`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentOS-Browser-Policy-Token": browserPolicyToken
        },
        body: JSON.stringify({ event: "worker-restarting" }),
        signal: AbortSignal.timeout(2_500)
      }
    );
    if (!response.ok) {
      console.error("AgentOS could not fence active browser sessions before worker restart.");
    }
  } catch {
    console.error("AgentOS browser session fencing was unavailable during worker restart.");
  }
}

async function stopGatewayProcess(child) {
  if (child.exitCode !== null) return;

  child.kill("SIGTERM");
  const exited = await Promise.race([
    childExit(child, "OpenClaw Gateway").then(() => true),
    wait(gatewayStopTimeoutMs).then(() => false)
  ]);

  if (!exited && child.exitCode === null) {
    console.error("OpenClaw Gateway did not stop after SIGTERM; sending SIGKILL.");
    child.kill("SIGKILL");
    await childExit(child, "OpenClaw Gateway");
  }
}

async function stopManagedProcess(child, label) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    childExit(child, label).then(() => true),
    wait(gatewayStopTimeoutMs).then(() => false)
  ]);
  if (!exited && child.exitCode === null) {
    console.error(`${label} did not stop after SIGTERM; sending SIGKILL.`);
    child.kill("SIGKILL");
    await childExit(child, label);
  }
}

async function startControlServer() {
  await removeControlSocket();

  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4_096) {
        writeControlResponse(socket, { ok: false, error: "Supervisor request is too large." });
        return;
      }

      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      buffer = "";
      void handleControlRequest(socket, line);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(supervisorSocketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await chmod(supervisorSocketPath, 0o600);
  console.error("Railway supervisor control channel is ready.");
  return server;
}

async function handleControlRequest(socket, line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    writeControlResponse(socket, { ok: false, error: "Invalid supervisor request." });
    return;
  }

  if (!request || request.action !== "restart-gateway") {
    writeControlResponse(socket, { ok: false, error: "Unsupported supervisor action." });
    return;
  }

  if (stopping) {
    writeControlResponse(socket, { ok: false, error: "The Railway service is stopping." });
    return;
  }

  if (manualRestart) {
    writeControlResponse(socket, { ok: false, error: "A managed Gateway restart is already in progress." });
    return;
  }

  if (gatewayTransitionInProgress) {
    writeControlResponse(socket, { ok: false, error: "The managed Gateway is already recovering." });
    return;
  }

  const cooldownRemainingMs = manualRestartCooldownMs - (Date.now() - lastManualRestartCompletedAt);
  if (cooldownRemainingMs > 0) {
    writeControlResponse(socket, {
      ok: false,
      error: `Wait ${Math.ceil(cooldownRemainingMs / 1_000)} seconds before requesting another Gateway restart.`
    });
    return;
  }

  console.error("Manual managed Gateway restart requested by AgentOS.");
  try {
    const result = await new Promise((resolve, reject) => {
      manualRestart = { resolve, reject };
      void stopGatewayProcess(gateway);
    });
    writeControlResponse(socket, result);
  } catch (error) {
    writeControlResponse(socket, {
      ok: false,
      error: error instanceof Error ? error.message : "Managed Gateway restart failed."
    });
  }
}

function writeControlResponse(socket, response) {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(response)}\n`);
}

function childExit(child, label) {
  if (child.exitCode !== null) {
    return Promise.resolve({ label, code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ label, code, signal }));
  });
}

function formatChildExit(exit) {
  if (exit.code !== null && exit.code !== undefined) {
    return `code ${exit.code}`;
  }

  return exit.signal ? `signal ${exit.signal}` : "code unknown";
}

function gatewayRestartDelayMs(attempt) {
  return Math.min(Math.max(attempt, 1) * 1_000, 30_000);
}

function wait(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function removeControlSocket() {
  await unlink(supervisorSocketPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function normalizeBrowserWorkerUrl(value) {
  if (!value?.trim()) return null;
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("AGENTOS_BROWSER_WORKER_URL must be an HTTP(S) service origin.");
  }
  if (
    process.env.AGENTOS_DEPLOYMENT_PLATFORM === "railway" &&
    url.hostname !== "127.0.0.1" &&
    !url.hostname.endsWith(".railway.internal")
  ) {
    throw new Error(
      "Railway Secure Browser workers must use a private .railway.internal hostname."
    );
  }
  return url.origin;
}

function requireBrowserWorkerToken(value) {
  const token = value?.trim();
  if (!token || token.length < 32) {
    throw new Error(
      "AGENTOS_BROWSER_WORKER_TOKEN must contain at least 32 characters for a private browser worker."
    );
  }
  return token;
}
