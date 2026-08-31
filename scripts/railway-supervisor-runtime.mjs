import { chmod, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 32_768;

export function createGatewaySupervisor(options) {
  const {
    binary = "openclaw",
    port,
    stateDir,
    configPath,
    token,
    socketPath,
    environment = process.env,
    allowUnconfigured = false,
    startupTimeoutMs = 120_000,
    readyTimeoutMs = 120_000,
    stopTimeoutMs = 10_000,
    healthIntervalMs = 5_000,
    healthFailureThreshold = 3,
    restartFailureLimit = 3,
    onCrashLoop
  } = options;

  const gatewayHealthUrl = `http://127.0.0.1:${port}/healthz`;
  const gatewayReadyUrl = `http://127.0.0.1:${port}/readyz`;
  let gateway = null;
  let server = null;
  let state = "stopped";
  let generation = 0;
  let consecutiveHealthFailures = 0;
  let consecutiveRestartFailures = 0;
  let crashRecoveryCycles = 0;
  let transition = Promise.resolve();
  let stopping = false;
  let monitorPromise = null;
  let recoveryPromise = null;
  let closeResolve;
  const closed = new Promise((resolve) => { closeResolve = resolve; });

  async function start() {
    if (stopping) throw new Error("The Gateway supervisor is stopping.");
    if (!server) server = await startControlServer();
    if (gateway && gateway.exitCode === null) {
      if (state === "ready") return statusPayload("Gateway is already ready.");
      await waitForReady();
      return statusPayload("Gateway became ready.");
    }
    state = "starting";
    gateway = spawnGateway();
    generation += 1;
    consecutiveHealthFailures = 0;
    crashRecoveryCycles = 0;
    await waitForReady(startupTimeoutMs);
    state = "ready";
    startMonitor();
    return statusPayload("Managed Gateway started and is ready.");
  }

  async function stop() {
    state = "stopping";
    const child = gateway;
    gateway = null;
    if (child) await stopProcess(child);
    state = "stopped";
    return statusPayload("Managed Gateway stopped.");
  }

  async function restart() {
    state = "restarting";
    const child = gateway;
    gateway = null;
    if (child) await stopProcess(child);
    if (stopping) throw new Error("The Gateway supervisor is stopping.");
    state = "starting";
    gateway = spawnGateway();
    generation += 1;
    await waitForReady();
    state = "ready";
    crashRecoveryCycles = 0;
    consecutiveRestartFailures = 0;
    startMonitor();
    return statusPayload("Managed Gateway restarted and is ready.");
  }

  async function recoverInternal() {
    if (stopping || state === "blocked") return;
    if (crashRecoveryCycles >= restartFailureLimit) {
      state = "blocked";
      await onCrashLoop?.({ state, generation, attempts: crashRecoveryCycles });
      return;
    }
    crashRecoveryCycles += 1;
    state = "recovering";
    const child = gateway;
    gateway = null;
    if (child) await stopProcess(child);

    for (let attempt = 1; attempt <= restartFailureLimit; attempt += 1) {
      if (stopping) return;
      const delayMs = Math.min(attempt * 1_000, 30_000);
      if (attempt > 1) await wait(delayMs);
      try {
        state = "starting";
        gateway = spawnGateway();
        generation += 1;
        await waitForReady();
        state = "ready";
        consecutiveRestartFailures = 0;
        consecutiveHealthFailures = 0;
        console.error(`OpenClaw Gateway recovered on attempt ${attempt}/${restartFailureLimit}.`);
        startMonitor();
        return;
      } catch (error) {
        consecutiveRestartFailures = attempt;
        console.error(`OpenClaw Gateway recovery attempt ${attempt}/${restartFailureLimit} failed: ${errorMessage(error)}.`);
        if (gateway) {
          await stopProcess(gateway).catch(() => {});
          gateway = null;
        }
      }
    }

    state = "blocked";
    const error = new Error("OpenClaw Gateway recovery attempts exhausted.");
    console.error(error.message);
    await onCrashLoop?.({ state, generation, attempts: consecutiveRestartFailures });
  }

  async function recover() {
    if (recoveryPromise) return recoveryPromise;
    recoveryPromise = recoverInternal().finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  }

  async function request(command) {
    if (command === "status") return statusPayload("Gateway supervisor status.");
    return enqueue(async () => {
      if (stopping) throw supervisorError("The Gateway supervisor is stopping.", "external-supervisor-unavailable", true);
      if (state === "recovering" || state === "restarting" || state === "starting" || state === "stopping") {
        throw supervisorError("A Gateway lifecycle operation is already in progress.", "operation-in-progress", true);
      }
      if (command === "start") return start();
      if (command === "stop") return stop();
      return restart();
    });
  }

  async function shutdown(signal = "SIGTERM") {
    if (stopping) return closed;
    stopping = true;
    state = "stopping";
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
    const child = gateway;
    gateway = null;
    if (child) await stopProcess(child, signal);
    state = "stopped";
    await unlink(socketPath).catch(() => {});
    closeResolve();
    return closed;
  }

  function startMonitor() {
    if (monitorPromise || stopping) return;
    monitorPromise = monitor().finally(() => {
      monitorPromise = null;
    });
  }

  async function monitor() {
    while (!stopping) {
      await wait(healthIntervalMs);
      if (stopping || !gateway || gateway.exitCode !== null) return;
      if (await isLive()) {
        consecutiveHealthFailures = 0;
        continue;
      }
      consecutiveHealthFailures += 1;
      console.error(`OpenClaw Gateway liveness probe failed (${consecutiveHealthFailures}/${healthFailureThreshold}).`);
      if (consecutiveHealthFailures >= healthFailureThreshold) {
        await recover();
        return;
      }
    }
  }

  async function waitForReady(timeoutMs = readyTimeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!gateway || gateway.exitCode !== null) {
        throw new Error(`OpenClaw Gateway exited during startup (code ${gateway?.exitCode ?? "unknown"}).`);
      }
      if (await isReady()) return;
      await wait(500);
    }
    throw new Error(`OpenClaw Gateway did not become ready within ${Math.round(timeoutMs / 1_000)} seconds.`);
  }

  async function isLive() {
    return fetchOk(gatewayHealthUrl);
  }

  async function isReady() {
    return fetchOk(gatewayReadyUrl);
  }

  function spawnGateway() {
    const args = [
      "gateway",
      "run",
      "--bind",
      "loopback",
      "--auth",
      "token",
      "--compact",
      "--port",
      String(port)
    ];
    if (allowUnconfigured) args.push("--allow-unconfigured");
    const invocation = binary.toLowerCase().endsWith(".mjs")
      ? { command: process.execPath, args: [binary, ...args] }
      : { command: binary, args };
    const childEnv = {
      ...environment,
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_SUPERVISOR_MODE: "external"
    };
    if (token) childEnv.OPENCLAW_GATEWAY_TOKEN = token;
    const child = spawn(invocation.command, invocation.args, {
      env: childEnv,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", (error) => console.error(`OpenClaw Gateway could not start: ${error.message}`));
    child.once("exit", (code, signal) => {
      if (stopping || gateway !== child) return;
      gateway = null;
      if (state === "ready" || state === "running") {
        console.error(`OpenClaw Gateway stopped unexpectedly (${code ?? signal ?? "unknown"}).`);
        void recover();
      }
    });
    return child;
  }

  async function startControlServer() {
    await unlink(socketPath).catch(() => {});
    const control = createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      let replied = false;
      socket.on("data", (chunk) => {
        if (replied) return;
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
          replied = true;
          writeResponse(socket, errorPayload("invalid", "Supervisor request is too large.", "invalid-request", false));
          return;
        }
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd < 0) return;
        replied = true;
        void handleRequest(socket, buffer.slice(0, lineEnd));
      });
    });
    await new Promise((resolve, reject) => {
      control.once("error", reject);
      control.listen(socketPath, () => {
        control.off("error", reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
    console.error("Railway supervisor control channel is ready.");
    return control;
  }

  async function handleRequest(socket, line) {
    let parsedRequest;
    try {
      parsedRequest = JSON.parse(line);
    } catch {
      writeResponse(socket, errorPayload("invalid", "Invalid supervisor request.", "invalid-request", false));
      return;
    }
    const requestId = typeof parsedRequest?.requestId === "string" && parsedRequest.requestId.length <= 128
      ? parsedRequest.requestId
      : "invalid";
    const command = parsedRequest?.command === "restart-gateway"
      ? "restart"
      : parsedRequest?.command;
    if (parsedRequest?.protocolVersion !== PROTOCOL_VERSION || !["status", "start", "stop", "restart"].includes(command) || requestId === "invalid") {
      writeResponse(socket, errorPayload(requestId, "Invalid supervisor request.", "invalid-request", false, command));
      return;
    }
    try {
      const result = await request(command);
      writeResponse(socket, {
        ...result,
        requestId,
        command
      });
    } catch (error) {
      writeResponse(socket, errorPayload(requestId, errorMessage(error), error?.code || "internal-error", Boolean(error?.retryable), command));
    }
  }

  function statusPayload(message) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "pending",
      ok: true,
      command: "status",
      owner: "external-supervisor",
      state,
      pid: gateway?.pid ?? null,
      generation: generation || null,
      gatewayUrl: `ws://127.0.0.1:${port}`,
      gatewayPort: port,
      ready: state === "ready",
      authenticated: false,
      health: state === "ready" || state === "running" ? "live" : "not-live",
      protocolVersionGateway: null,
      version: null,
      sourceCommit: null,
      message
    };
  }

  function errorPayload(requestId, message, code, retryable, command = "status") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ok: false,
      command,
      owner: "external-supervisor",
      state,
      pid: gateway?.pid ?? null,
      generation: generation || null,
      error: { code, message, retryable }
    };
  }

  function enqueue(task) {
    const next = transition.then(task, task);
    transition = next.catch(() => {});
    return next;
  }

  return {
    start,
    stop: shutdown,
    request,
    recover,
    getStatus: () => statusPayload("Gateway supervisor status."),
    closed,
    get state() { return state; },
    get generation() { return generation; }
  };

  async function stopProcess(child, signal = "SIGTERM") {
    if (!child || child.exitCode !== null) return;
    child.kill(signal);
    const exited = await Promise.race([
      childExit(child),
      wait(stopTimeoutMs).then(() => false)
    ]);
    if (!exited && child.exitCode === null) {
      child.kill("SIGKILL");
      await childExit(child);
    }
  }
}

function writeResponse(socket, payload) {
  if (socket.destroyed) return;
  const serialized = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    socket.end(`${JSON.stringify(errorPayload("invalid", "Supervisor response is too large.", "invalid-response", false))}\n`);
    return;
  }
  socket.end(serialized);
}

function childExit(child) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => child.once("exit", () => resolve(true)));
}

function fetchOk(url) {
  return fetch(url, { signal: AbortSignal.timeout(1_500), cache: "no-store" })
    .then((response) => response.ok)
    .catch(() => false);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Gateway supervisor operation failed.";
}

function supervisorError(message, code, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function errorPayload(requestId, message, code, retryable, command = "status") {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    ok: false,
    command,
    owner: "external-supervisor",
    state: "unknown",
    pid: null,
    generation: null,
    error: { code, message, retryable }
  };
}
