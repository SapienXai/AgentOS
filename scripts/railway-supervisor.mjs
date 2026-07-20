import { chmod, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

import { bootstrapRailwayOpenClawConfig } from "./railway-openclaw-bootstrap.mjs";

const gatewayPort = 18789;
const gatewayReadyUrl = `http://127.0.0.1:${gatewayPort}/readyz`;
const supervisorSocketPath = process.env.AGENTOS_SUPERVISOR_SOCKET_PATH?.trim() || "/tmp/agentos-supervisor.sock";
const gatewayHealthIntervalMs = 5_000;
const gatewayHealthFailureThreshold = 3;
const gatewayStopTimeoutMs = 10_000;
const gatewayRestartFailureLimit = 3;
const manualRestartCooldownMs = 10_000;
const gatewayEnv = { ...process.env };
delete gatewayEnv.AGENTOS_INITIAL_ADMIN_PASSWORD;

await bootstrapRailwayOpenClawConfig(gatewayEnv);

let gateway = startGateway();
let agentos = null;
let stopping = false;
let consecutiveRestartFailures = 0;
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
  agentos?.kill(signal);
  gateway.kill(signal);
};

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

try {
  await waitForGateway();
} catch (error) {
  console.error(error instanceof Error ? error.message : "OpenClaw Gateway did not become ready.");
  stop();
  process.exit(1);
}

if (gateway.exitCode !== null) {
  console.error(`OpenClaw Gateway exited before AgentOS started (code ${gateway.exitCode}).`);
  process.exit(1);
}

agentos = spawn(process.execPath, ["/agentos/server.js"], {
  env: process.env,
  stdio: "inherit"
});

agentos.once("error", (error) => {
  console.error(`AgentOS could not start: ${error.message}`);
  process.exitCode = 1;
  stop();
});

const agentosExit = childExit(agentos, "AgentOS");

while (!stopping) {
  const healthMonitor = new AbortController();
  const exit = await Promise.race([
    childExit(gateway, "OpenClaw Gateway"),
    agentosExit,
    waitForGatewayHealthFailure(gateway, healthMonitor.signal)
  ]);
  healthMonitor.abort();

  if (stopping) break;

  if (exit.label === "AgentOS") {
    console.error(`AgentOS stopped unexpectedly (code ${exit.code ?? "unknown"}).`);
    process.exitCode = 1;
    stop();
    break;
  }

  const requestedRestart = manualRestart;
  gatewayTransitionInProgress = true;
  const restartReason = requestedRestart
    ? "manual operator request"
    : exit.label === "OpenClaw Gateway health"
      ? "readiness checks failed"
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
    await waitForGateway();
    console.error("OpenClaw Gateway restarted successfully and passed readiness checks.");
    consecutiveRestartFailures = 0;
    gatewayTransitionInProgress = false;
    if (requestedRestart && manualRestart === requestedRestart) {
      lastManualRestartCompletedAt = Date.now();
      manualRestart = null;
      requestedRestart.resolve({
        ok: true,
        message: "Managed OpenClaw Gateway restarted and is ready."
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
  agentosExit,
  removeControlSocket()
]);
process.exit(process.exitCode ?? 0);

function startGateway() {
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

async function waitForGateway() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) {
      throw new Error(`OpenClaw Gateway exited during startup (code ${gateway.exitCode}).`);
    }

    if (await isGatewayReady()) return;
    await wait(500);
  }

  throw new Error("OpenClaw Gateway did not become ready within 120 seconds.");
}

async function waitForGatewayHealthFailure(child, signal) {
  let consecutiveFailures = 0;

  while (!signal.aborted && child.exitCode === null) {
    await wait(gatewayHealthIntervalMs, signal);
    if (signal.aborted || child.exitCode !== null) break;

    if (await isGatewayReady()) {
      consecutiveFailures = 0;
      continue;
    }

    consecutiveFailures += 1;
    console.error(`OpenClaw Gateway readiness probe failed (${consecutiveFailures}/${gatewayHealthFailureThreshold}).`);
    if (consecutiveFailures >= gatewayHealthFailureThreshold) {
      return { label: "OpenClaw Gateway health", code: null, signal: null };
    }
  }

  return new Promise(() => {});
}

async function isGatewayReady() {
  try {
    const response = await fetch(gatewayReadyUrl, {
      signal: AbortSignal.timeout(1_500)
    });
    return response.ok;
  } catch {
    return false;
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
