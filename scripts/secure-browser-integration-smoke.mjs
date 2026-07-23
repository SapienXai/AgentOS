import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection, createServer as createTcpServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

const workerScript = path.join(process.cwd(), "scripts/secure-browser-worker.mjs");
const chromeBinary = process.env.CHROME_BIN?.trim() || "/usr/bin/chromium";
const requiredBinaries = [
  chromeBinary,
  ...(await Promise.all(["Xvfb", "openbox", "x11vnc"].map(resolvePathBinary)))
];

for (const binary of requiredBinaries) {
  if (!binary || !(await isExecutable(binary))) {
    throw new Error(
      "Secure Browser integration smoke requires Chromium, Xvfb, openbox, and x11vnc. Run it inside the Railway image."
    );
  }
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-browser-smoke-"));
const profileRoot = path.join(temporaryRoot, "profiles");
const socketPath = path.join(temporaryRoot, "worker.sock");
const workerPort = await allocateLoopbackPort();
const workerToken = randomBytes(32).toString("base64url");
const profileId = "acct-integration-smoke";
let worker = null;
const fixtureServer = createServer((request, response) => {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end("<!doctype html><title>AgentOS Browser Smoke</title><main>fixture</main>");
});

try {
  await listen(fixtureServer);
  const fixtureAddress = fixtureServer.address();
  if (!fixtureAddress || typeof fixtureAddress === "string") {
    throw new Error("The browser smoke fixture did not start.");
  }
  const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/`;

  worker = startWorker();
  await waitForWorker();
  await control({ action: "create-profile", profileId });
  const first = await control({ action: "start-session", profileId, initialUrl: fixtureUrl });
  await evaluate(first.cdpUrl, `
    document.cookie = "agentos_smoke=present; path=/";
    localStorage.setItem("agentos-smoke", "present");
    true
  `);
  await control({ action: "stop-session", sessionId: first.sessionId });

  const second = await control({ action: "start-session", profileId, initialUrl: fixtureUrl });
  await assertPersisted(second.cdpUrl);

  await stopWorkerProcessGroup(worker);
  worker = startWorker();
  await waitForWorker();
  const third = await control({ action: "start-session", profileId, initialUrl: fixtureUrl });
  await assertPersisted(third.cdpUrl);
  await control({ action: "stop-session", sessionId: third.sessionId });
  await control({ action: "revoke-profile", profileId });
  if (await stat(path.join(profileRoot, profileId)).then(() => true).catch(() => false)) {
    throw new Error("Revoked browser profile data still exists.");
  }

  console.log("Secure Browser integration smoke passed: persistence, crash restart, and revoke.");
} finally {
  if (worker) await stopWorkerProcessGroup(worker).catch(() => null);
  await closeServer(fixtureServer);
  await rm(temporaryRoot, { recursive: true, force: true });
}

function startWorker() {
  return spawn(process.execPath, [workerScript], {
    env: {
      ...process.env,
      CHROME_BIN: chromeBinary,
      AGENTOS_BROWSER_PROFILE_ROOT: profileRoot,
      AGENTOS_BROWSER_WORKER_SOCKET_PATH: socketPath,
      AGENTOS_BROWSER_WORKER_PORT: String(workerPort),
      AGENTOS_BROWSER_WORKER_TOKEN: workerToken,
      AGENTOS_BROWSER_SESSION_TTL_MS: String(5 * 60_000)
    },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true
  });
}

async function assertPersisted(cdpUrl) {
  const value = await evaluate(cdpUrl, `({
    cookiePresent: document.cookie.split("; ").includes("agentos_smoke=present"),
    localStoragePresent: localStorage.getItem("agentos-smoke") === "present"
  })`);
  if (value?.cookiePresent !== true || value?.localStoragePresent !== true) {
    throw new Error("Authenticated browser profile state did not survive restart.");
  }
}

async function evaluate(cdpUrl, expression) {
  const targets = await fetch(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(3_000)
  }).then((response) => response.json());
  const target = Array.isArray(targets)
    ? targets.find((entry) => entry?.type === "page" && typeof entry.webSocketDebuggerUrl === "string")
    : null;
  if (!target) throw new Error("Chromium did not expose a page target.");
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => finish(new Error("CDP smoke command timed out.")), 5_000);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      if (error) reject(error);
      else resolve(value);
    };
    socket.once("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true }
      }));
    });
    socket.on("message", (data) => {
      const message = JSON.parse(Buffer.from(data).toString("utf8"));
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails) {
        finish(new Error("CDP smoke command failed."));
        return;
      }
      finish(null, message.result?.result?.value);
    });
    socket.once("error", () => finish(new Error("CDP smoke connection failed.")));
  });
}

async function control(request) {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const response = JSON.parse(buffer.slice(0, lineEnd));
      socket.destroy();
      if (response.ok !== true) {
        reject(new Error("Secure Browser worker rejected the smoke operation."));
        return;
      }
      resolve(response.result);
    });
    socket.once("error", () => reject(new Error("Secure Browser worker is unavailable.")));
  });
}

async function waitForWorker() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (worker?.exitCode !== null) throw new Error("Secure Browser worker exited during smoke startup.");
    const healthy = await fetch(`http://127.0.0.1:${workerPort}/healthz`, {
      signal: AbortSignal.timeout(500)
    }).then((response) => response.ok).catch(() => false);
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Secure Browser worker did not become healthy.");
}

async function stopWorkerProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
  ]);
  if (exited === false && child.exitCode === null) {
    process.kill(-child.pid, "SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function resolvePathBinary(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) {
      const candidate = path.join(directory, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

async function isExecutable(filePath) {
  return await access(filePath).then(() => true).catch(() => false);
}

async function allocateLoopbackPort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await closeServer(server);
  if (!port) throw new Error("No loopback port is available.");
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function closeServer(server) {
  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}
