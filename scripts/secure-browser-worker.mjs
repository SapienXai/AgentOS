import { randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, request as createHttpRequest } from "node:http";
import { createServer as createTcpServer, createConnection } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { WebSocket, WebSocketServer } from "ws";

const profileIdPattern = /^acct-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultProfileRoot = "/data/browser-profiles";
const defaultControlSocketPath = "/tmp/agentos-browser-worker.sock";
const defaultHttpPort = 18794;
const defaultSessionTtlMs = 30 * 60_000;
const maximumControlRequestBytes = 16_384;

export async function startSecureBrowserWorker(env = process.env) {
  const profileRoot = path.resolve(env.AGENTOS_BROWSER_PROFILE_ROOT?.trim() || defaultProfileRoot);
  const controlSocketPath = env.AGENTOS_BROWSER_WORKER_SOCKET_PATH?.trim() || defaultControlSocketPath;
  const internalToken = env.AGENTOS_BROWSER_WORKER_TOKEN?.trim();
  const chromeBinary = env.CHROME_BIN?.trim() || "/usr/bin/chromium";
  const httpPort = readPort(env.AGENTOS_BROWSER_WORKER_PORT, defaultHttpPort);
  const sessionTtlMs = readPositiveInteger(env.AGENTOS_BROWSER_SESSION_TTL_MS, defaultSessionTtlMs);
  const sessions = new Map();

  if (!internalToken || internalToken.length < 32) {
    throw new Error("Secure browser worker requires an internal authentication token.");
  }

  await mkdir(profileRoot, { recursive: true, mode: 0o700 });
  await chmod(profileRoot, 0o700);
  await unlink(controlSocketPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });

  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 2 * 1024 * 1024
  });
  const httpServer = createHttpServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
      });
      response.end(`${JSON.stringify({ ok: true, activeSessions: sessions.size })}\n`);
      return;
    }
    const cdpTarget = resolveCdpProxyTarget(request.url, sessions);
    if (cdpTarget) {
      void proxyCdpHttpRequest(request, response, cdpTarget, httpPort);
      return;
    }
    response.writeHead(404, { "Cache-Control": "no-store" });
    response.end();
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const cdpTarget = resolveCdpProxyTarget(request.url, sessions);
    if (cdpTarget?.upstreamPath.startsWith("/devtools/")) {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        bridgeWebSocketToCdp(webSocket, cdpTarget);
      });
      return;
    }

    const sessionId = readSessionIdFromWebSocketPath(request.url);
    if (
      !sessionId ||
      !constantTimeEqual(request.headers["x-agentos-browser-worker-token"], internalToken)
    ) {
      rejectUpgrade(socket, 403);
      return;
    }

    const session = sessions.get(sessionId);
    if (!session || session.state !== "active" || session.expiresAt <= Date.now()) {
      rejectUpgrade(socket, 410);
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      bridgeWebSocketToVnc(webSocket, session.vncPort);
    });
  });

  const controlServer = createTcpServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maximumControlRequestBytes) {
        writeControlResponse(socket, { ok: false, error: "Browser worker request is too large." });
        return;
      }
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      buffer = "";
      void handleControlRequest({
        socket,
        line,
        profileRoot,
        chromeBinary,
        httpPort,
        sessionTtlMs,
        sessions
      });
    });
  });

  await Promise.all([
    listenHttpServer(httpServer, httpPort),
    listenControlServer(controlServer, controlSocketPath)
  ]);
  await chmod(controlSocketPath, 0o600);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled([...sessions.values()].map((session) => stopBrowserSession(session)));
    sessions.clear();
    webSocketServer.close();
    await Promise.allSettled([
      closeServer(httpServer),
      closeServer(controlServer),
      unlink(controlSocketPath)
    ]);
  };

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.expiresAt <= now || session.processes.some((child) => child.exitCode !== null)) {
        sessions.delete(session.sessionId);
        void stopBrowserSession(session);
      }
    }
  }, 5_000);
  sweepTimer.unref();

  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));

  return {
    profileRoot,
    controlSocketPath,
    httpPort,
    stop
  };
}

async function handleControlRequest(input) {
  let request;
  try {
    request = JSON.parse(input.line);
  } catch {
    writeControlResponse(input.socket, { ok: false, error: "Invalid browser worker request." });
    return;
  }

  try {
    const result = request.action === "health"
      ? { ready: true, activeSessions: input.sessions.size }
      : request.action === "create-profile"
        ? await createProfile(input.profileRoot, request.profileId)
        : request.action === "start-session"
          ? await startBrowserSession({
              profileRoot: input.profileRoot,
              chromeBinary: input.chromeBinary,
              httpPort: input.httpPort,
              sessionTtlMs: input.sessionTtlMs,
              sessions: input.sessions,
              profileId: request.profileId,
              initialUrl: request.initialUrl
            })
          : request.action === "inspect-authentication"
            ? await inspectAuthentication({
                sessions: input.sessions,
                sessionId: request.sessionId,
                allowedDomains: request.allowedDomains,
                authenticatedSelector: request.authenticatedSelector,
                loginSelector: request.loginSelector
              })
          : request.action === "stop-session"
            ? await stopSessionById(input.sessions, request.sessionId)
            : request.action === "revoke-profile"
              ? await revokeProfile(input.profileRoot, input.sessions, request.profileId)
              : null;

    if (!result) {
      writeControlResponse(input.socket, { ok: false, error: "Unsupported browser worker action." });
      return;
    }
    writeControlResponse(input.socket, { ok: true, result });
  } catch (error) {
    writeControlResponse(input.socket, {
      ok: false,
      error: sanitizeWorkerError(error)
    });
  }
}

async function inspectAuthentication(input) {
  const sessionId = validateSessionId(input.sessionId);
  const session = input.sessions.get(sessionId);
  if (!session || session.state !== "active" || session.expiresAt <= Date.now()) {
    throw new Error("The browser session is unavailable.");
  }
  const allowedDomains = normalizeAllowedDomains(input.allowedDomains);
  const authenticatedSelector = validateInspectionSelector(input.authenticatedSelector);
  const loginSelector = validateInspectionSelector(input.loginSelector);
  const targets = await fetch(`http://127.0.0.1:${session.cdpPort}/json/list`, {
    signal: AbortSignal.timeout(2_000)
  }).then((response) => response.ok ? response.json() : []);
  const target = Array.isArray(targets)
    ? targets.find((entry) =>
        entry?.type === "page" &&
        typeof entry.url === "string" &&
        isAllowedAuthenticationUrl(entry.url, allowedDomains) &&
        isPrivateCdpWebSocket(entry.webSocketDebuggerUrl, session.cdpPort)
      )
    : null;
  if (!target) {
    return { state: "domain-mismatch", hostname: null };
  }

  const url = new URL(target.url);
  const result = await evaluateCdpExpression(
    target.webSocketDebuggerUrl,
    `(() => ({
      authenticated: Boolean(document.querySelector(${JSON.stringify(authenticatedSelector)})),
      loginVisible: Boolean(document.querySelector(${JSON.stringify(loginSelector)}))
    }))()`
  );
  const value = result?.result?.result?.value;
  return {
    state:
      value?.authenticated === true
        ? "matched"
        : value?.loginVisible === true
          ? "login-visible"
          : "unknown",
    hostname: url.hostname.toLowerCase()
  };
}

async function evaluateCdpExpression(webSocketUrl, expression) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl, {
      perMessageDeflate: false,
      maxPayload: 1024 * 1024
    });
    const requestId = 1;
    let settled = false;
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Browser authentication inspection timed out."));
    }, 3_000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
      if (error) reject(error);
      else resolve(value);
    };
    socket.once("open", () => {
      socket.send(JSON.stringify({
        id: requestId,
        method: "Runtime.evaluate",
        params: {
          expression,
          returnByValue: true,
          awaitPromise: false
        }
      }));
    });
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(Buffer.from(data).toString("utf8"));
        if (message.id !== requestId) return;
        if (message.error || message.result?.exceptionDetails) {
          finish(new Error("Browser authentication inspection failed."));
          return;
        }
        finish(null, message);
      } catch {
        finish(new Error("Browser authentication inspection returned invalid data."));
      }
    });
    socket.once("error", () => finish(new Error("Browser authentication inspection failed.")));
  });
}

async function createProfile(profileRoot, profileId) {
  const profilePath = resolveProfilePath(profileRoot, profileId);
  await mkdir(profilePath, { recursive: false, mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  await chmod(profilePath, 0o700);
  return { profileId, persistent: true };
}

async function startBrowserSession(input) {
  const profileId = validateProfileId(input.profileId);
  const current = [...input.sessions.values()].find((session) => session.profileId === profileId);
  if (current && current.state === "active" && current.expiresAt > Date.now()) {
    throw new Error("This browser profile already has an active session.");
  }
  if (current) {
    input.sessions.delete(current.sessionId);
    await stopBrowserSession(current);
  }

  const profilePath = resolveProfilePath(input.profileRoot, profileId);
  const profileState = await stat(profilePath).catch(() => null);
  if (!profileState?.isDirectory()) {
    throw new Error("The browser profile does not exist.");
  }

  const initialUrl = normalizeInitialUrl(input.initialUrl);
  await ensureSecureProfilePreferences(profilePath);
  const displayNumber = await allocateDisplayNumber();
  const [vncPort, cdpPort] = await Promise.all([allocateLoopbackPort(), allocateLoopbackPort()]);
  const sessionId = randomUUID();
  const session = {
    sessionId,
    profileId,
    displayNumber,
    vncPort,
    cdpPort,
    state: "starting",
    expiresAt: Date.now() + input.sessionTtlMs,
    processes: []
  };

  try {
    const display = `:${displayNumber}`;
    const childEnvironment = {
      ...process.env,
      DISPLAY: display,
      HOME: process.env.HOME || "/home/node"
    };
    const xvfb = spawnManaged("Xvfb", [
      display,
      "-screen",
      "0",
      "1440x900x24",
      "-nolisten",
      "tcp",
      "-noreset"
    ], childEnvironment);
    session.processes.push(xvfb);
    await waitForCondition(
      () => stat(`/tmp/.X11-unix/X${displayNumber}`).then(() => true).catch(() => false),
      10_000,
      "Virtual browser display did not become ready."
    );

    const windowManager = spawnManaged("openbox", ["--sm-disable"], childEnvironment);
    session.processes.push(windowManager);

    const chromium = spawnManaged(input.chromeBinary, [
      `--user-data-dir=${profilePath}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${cdpPort}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-features=Translate,OptimizationHints,MediaRouter,PasswordManagerOnboarding,PasswordLeakDetection",
      "--disable-save-password-bubble",
      "--disable-sync",
      "--password-store=basic",
      "--window-size=1440,900",
      "--start-maximized",
      initialUrl
    ], childEnvironment);
    session.processes.push(chromium);
    await waitForCondition(
      () => fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        signal: AbortSignal.timeout(750)
      }).then((response) => response.ok).catch(() => false),
      20_000,
      "Chromium did not become ready."
    );

    const vnc = spawnManaged("x11vnc", [
      "-display",
      display,
      "-localhost",
      "-no6",
      "-rfbport",
      String(vncPort),
      "-forever",
      "-shared",
      "-repeat",
      "-noxdamage",
      "-nopw",
      "-quiet"
    ], childEnvironment);
    session.processes.push(vnc);
    await waitForCondition(
      () => canConnect(vncPort),
      10_000,
      "Private browser display channel did not become ready."
    );

    session.state = "active";
    input.sessions.set(sessionId, session);
    return {
      sessionId,
      profileId,
      state: "active",
      expiresAt: new Date(session.expiresAt).toISOString(),
      // OpenClaw receives a stable loopback Browser Gateway URL rather than
      // Chromium's raw ephemeral DevTools endpoint.
      cdpUrl: `http://127.0.0.1:${input.httpPort}/cdp/profile/${profileId}`
    };
  } catch (error) {
    await stopBrowserSession(session);
    throw error;
  }
}

async function stopSessionById(sessions, sessionId) {
  const normalizedSessionId = validateSessionId(sessionId);
  const session = sessions.get(normalizedSessionId);
  if (!session) return { sessionId: normalizedSessionId, stopped: true };
  sessions.delete(normalizedSessionId);
  await stopBrowserSession(session);
  return { sessionId: normalizedSessionId, stopped: true };
}

async function revokeProfile(profileRoot, sessions, profileIdValue) {
  const profileId = validateProfileId(profileIdValue);
  for (const session of sessions.values()) {
    if (session.profileId !== profileId) continue;
    sessions.delete(session.sessionId);
    await stopBrowserSession(session);
  }
  const profilePath = resolveProfilePath(profileRoot, profileId);
  await rm(profilePath, { recursive: true, force: true });
  return { profileId, revoked: true };
}

async function stopBrowserSession(session) {
  if (session.state === "stopped") return;
  session.state = "stopping";
  for (const child of [...session.processes].reverse()) {
    await stopChild(child);
  }
  session.state = "stopped";
}

function spawnManaged(command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "ignore", "ignore"]
  });
  child.once("error", () => {
    // Health and lifecycle state report failure without exposing commands or paths.
  });
  return child;
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    childExit(child).then(() => true),
    wait(5_000).then(() => false)
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await childExit(child);
  }
}

function bridgeWebSocketToVnc(webSocket, port) {
  const vncSocket = createConnection({ host: "127.0.0.1", port });
  webSocket.binaryType = "arraybuffer";

  webSocket.on("message", (data) => {
    if (!vncSocket.destroyed) vncSocket.write(Buffer.from(data));
  });
  vncSocket.on("data", (data) => {
    if (webSocket.readyState === WebSocket.OPEN) webSocket.send(data);
  });
  const close = () => {
    if (!vncSocket.destroyed) vncSocket.destroy();
    if (webSocket.readyState === WebSocket.OPEN) webSocket.close();
  };
  webSocket.once("close", close);
  webSocket.once("error", close);
  vncSocket.once("close", close);
  vncSocket.once("error", close);
}

function bridgeWebSocketToCdp(webSocket, target) {
  const upstream = new WebSocket(
    `ws://127.0.0.1:${target.session.cdpPort}${target.upstreamPath}`
  );
  const pending = [];
  webSocket.binaryType = "arraybuffer";
  upstream.binaryType = "arraybuffer";

  webSocket.on("message", (data, isBinary) => {
    const payload = { data, isBinary };
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(payload.data, { binary: payload.isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push(payload);
    }
  });
  upstream.once("open", () => {
    for (const payload of pending.splice(0)) {
      upstream.send(payload.data, { binary: payload.isBinary });
    }
  });
  upstream.on("message", (data, isBinary) => {
    if (webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(data, { binary: isBinary });
    }
  });
  const close = () => {
    if (
      upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING
    ) {
      upstream.close();
    }
    if (webSocket.readyState === WebSocket.OPEN) webSocket.close();
  };
  webSocket.once("close", close);
  webSocket.once("error", close);
  upstream.once("close", close);
  upstream.once("error", close);
}

function resolveCdpProxyTarget(value, sessions) {
  try {
    const parsed = new URL(value || "/", "http://127.0.0.1");
    const match = /^\/cdp\/profile\/([^/]+)(\/.*)?$/.exec(parsed.pathname);
    if (!match) return null;
    const profileId = validateProfileId(match[1]);
    const session = [...sessions.values()].find(
      (entry) =>
        entry.profileId === profileId &&
        entry.state === "active" &&
        entry.expiresAt > Date.now()
    );
    if (!session) return null;
    const upstreamPath = `${match[2] || "/"}${parsed.search}`;
    return { profileId, session, upstreamPath };
  } catch {
    return null;
  }
}

async function proxyCdpHttpRequest(request, response, target, proxyPort) {
  await new Promise((resolve) => {
    const upstream = createHttpRequest(
      {
        host: "127.0.0.1",
        port: target.session.cdpPort,
        path: target.upstreamPath,
        method: request.method,
        headers: {
          "Content-Type": request.headers["content-type"] || "application/json"
        }
      },
      (upstreamResponse) => {
        const chunks = [];
        let size = 0;
        upstreamResponse.on("data", (chunk) => {
          size += chunk.length;
          if (size <= 4 * 1024 * 1024) chunks.push(chunk);
        });
        upstreamResponse.on("end", () => {
          if (size > 4 * 1024 * 1024) {
            response.writeHead(502, { "Cache-Control": "no-store" });
            response.end();
            resolve();
            return;
          }
          const body = Buffer.concat(chunks);
          const contentType = String(upstreamResponse.headers["content-type"] || "");
          const rewritten = contentType.includes("json")
            ? rewriteCdpJson(body, target.profileId, proxyPort)
            : body;
          response.writeHead(upstreamResponse.statusCode || 502, {
            "Cache-Control": "no-store",
            "Content-Type": contentType || "application/octet-stream"
          });
          response.end(rewritten);
          resolve();
        });
      }
    );
    upstream.once("error", () => {
      response.writeHead(502, { "Cache-Control": "no-store" });
      response.end();
      resolve();
    });
    request.pipe(upstream);
  });
}

function rewriteCdpJson(body, profileId, proxyPort) {
  try {
    const value = JSON.parse(body.toString("utf8"));
    const rewrite = (entry) => {
      if (Array.isArray(entry)) return entry.map(rewrite);
      if (!entry || typeof entry !== "object") return entry;
      const next = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === "webSocketDebuggerUrl" && typeof child === "string") {
          const url = new URL(child);
          next[key] = `ws://127.0.0.1:${proxyPort}/cdp/profile/${profileId}${url.pathname}${url.search}`;
        } else {
          next[key] = rewrite(child);
        }
      }
      return next;
    };
    return Buffer.from(JSON.stringify(rewrite(value)));
  } catch {
    return body;
  }
}

async function ensureSecureProfilePreferences(profilePath) {
  const defaultProfilePath = path.join(profilePath, "Default");
  const preferencesPath = path.join(defaultProfilePath, "Preferences");
  await mkdir(defaultProfilePath, { recursive: true, mode: 0o700 });
  const current = await readFile(preferencesPath, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
  const next = {
    ...current,
    credentials_enable_service: false,
    download_restrictions: 3,
    profile: {
      ...(current.profile && typeof current.profile === "object" ? current.profile : {}),
      password_manager_enabled: false
    },
    autofill: {
      ...(current.autofill && typeof current.autofill === "object" ? current.autofill : {}),
      credit_card_enabled: false
    }
  };
  await writeFile(preferencesPath, `${JSON.stringify(next)}\n`, { mode: 0o600 });
  await chmod(preferencesPath, 0o600);
}

function resolveProfilePath(profileRoot, profileIdValue) {
  const profileId = validateProfileId(profileIdValue);
  const candidate = path.resolve(profileRoot, profileId);
  if (path.dirname(candidate) !== profileRoot) {
    throw new Error("Browser profile path is invalid.");
  }
  return candidate;
}

function normalizeInitialUrl(value) {
  const parsed = new URL(typeof value === "string" ? value : "about:blank");
  if (parsed.protocol === "about:" && parsed.href === "about:blank") return parsed.href;
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Browser session URL must use HTTP or HTTPS.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function normalizeAllowedDomains(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new Error("Browser authentication domains are invalid.");
  }
  return [...new Set(values.map((value) => {
    const domain = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(domain)) {
      throw new Error("Browser authentication domains are invalid.");
    }
    return domain;
  }))];
}

function validateInspectionSelector(value) {
  const selector = typeof value === "string" ? value.trim() : "";
  if (!selector || selector.length > 256 || /[\u0000-\u001f\u007f]/.test(selector)) {
    throw new Error("Browser authentication rule is invalid.");
  }
  return selector;
}

function isAllowedAuthenticationUrl(value, allowedDomains) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return allowedDomains.some((entry) => {
      const domain = entry.startsWith("*.") ? entry.slice(2) : entry;
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

function isPrivateCdpWebSocket(value, port) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ws:" &&
      url.hostname === "127.0.0.1" &&
      url.port === String(port) &&
      url.pathname.startsWith("/devtools/")
    );
  } catch {
    return false;
  }
}

function validateProfileId(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!profileIdPattern.test(normalized)) throw new Error("Browser profile id is invalid.");
  return normalized;
}

function validateSessionId(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!sessionIdPattern.test(normalized)) throw new Error("Browser session id is invalid.");
  return normalized;
}

function readSessionIdFromWebSocketPath(value) {
  try {
    const parsed = new URL(value || "/", "http://127.0.0.1");
    const match = /^\/session\/([^/]+)$/.exec(parsed.pathname);
    return match ? validateSessionId(match[1]) : null;
  } catch {
    return null;
  }
}

async function allocateDisplayNumber() {
  for (let display = 100; display <= 199; display += 1) {
    const exists = await stat(`/tmp/.X11-unix/X${display}`).then(() => true).catch(() => false);
    if (!exists) return display;
  }
  throw new Error("No browser display slot is available.");
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
  if (!port) throw new Error("No private browser port is available.");
  return port;
}

async function canConnect(port) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForCondition(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(message);
}

function writeControlResponse(socket, response) {
  if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`);
}

function sanitizeWorkerError(error) {
  const message = error instanceof Error ? error.message : "Secure browser worker action failed.";
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\/(?:data|home|tmp)\/\S+/g, "[redacted-path]")
    .slice(0, 240);
}

function rejectUpgrade(socket, status) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Gone"}\r\nConnection: close\r\n\r\n`);
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readPort(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listenHttpServer(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function listenControlServer(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function childExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSecureBrowserWorker().then(() => {
    console.error("Secure browser worker is ready.");
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Secure browser worker failed to start.");
    process.exit(1);
  });
}
