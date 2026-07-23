import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { WebSocket, WebSocketServer } from "ws";

const liveViewPathPattern =
  /^\/api\/accounts\/browser-live\/ws\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?.*)?$/i;
const browserLiveExchangePath = "/api/accounts/browser-live/exchange";
const maximumBrowserLiveExchangeBytes = 16 * 1024;
const cdpRelayPrefix = "/_agentos/browser-cdp";
const maximumCdpResponseBytes = 4 * 1024 * 1024;
const browserLiveCsp = [
  "default-src 'self'",
  // Next.js emits an inline hydration bootstrap. This isolated document renders
  // no provider or user-controlled HTML, while all remote script origins remain blocked.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "media-src 'none'"
].join("; ");

export async function startRailwayPublicProxy(input) {
  const publicPort = input.publicPort;
  const nextPort = input.nextPort;
  const browserWorkerUrl = normalizeWorkerUrl(input.browserWorkerUrl);
  const browserProxyToken = input.browserProxyToken;
  const browserWorkerToken = input.browserWorkerToken;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 2 * 1024 * 1024
  });

  const server = createServer((request, response) => {
    if (isCdpRelayRequest(request.url)) {
      void proxyPrivateCdpRequest({
        request,
        response,
        publicPort,
        browserWorkerUrl,
        browserWorkerToken
      });
      return;
    }
    if (isBrowserLiveExchangeRequest(request.url)) {
      void proxyBufferedBrowserLiveExchange({
        request,
        response,
        nextPort
      });
      return;
    }
    proxyHttpRequest({ request, response, nextPort });
  });

  server.on("upgrade", (request, socket, head) => {
    if (isCdpRelayRequest(request.url)) {
      void bridgePrivateCdpWebSocket({
        request,
        socket,
        head,
        browserWorkerUrl,
        browserWorkerToken,
        webSocketServer
      });
      return;
    }
    const match = liveViewPathPattern.exec(request.url || "");
    if (!match) {
      rejectUpgrade(socket, 404);
      return;
    }
    void authorizeAndBridgeLiveView({
      request,
      socket,
      head,
      sessionId: match[1].toLowerCase(),
      nextPort,
      browserWorkerUrl,
      browserProxyToken,
      browserWorkerToken,
      webSocketServer
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(publicPort, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

function proxyHttpRequest(input) {
  const headers = stripHopByHopHeaders(input.request.headers);
  const upstream = httpRequest({
    host: "127.0.0.1",
    port: input.nextPort,
    method: input.request.method,
    path: input.request.url,
    headers
  }, (upstreamResponse) => {
    const responseHeaders = {
      ...stripHopByHopHeaders(upstreamResponse.headers)
    };
    if (isBrowserLiveDocument(input.request.url)) {
      responseHeaders["cache-control"] = "no-store";
      responseHeaders["referrer-policy"] = "no-referrer";
      responseHeaders["content-security-policy"] = browserLiveCsp;
      responseHeaders["permissions-policy"] =
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), clipboard-read=(), clipboard-write=()";
      responseHeaders["x-content-type-options"] = "nosniff";
    }
    input.response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(input.response);
  });

  upstream.once("error", () => {
    if (input.response.headersSent) {
      input.response.destroy();
      return;
    }
    input.response.writeHead(502, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    });
    input.response.end("AgentOS is starting.");
  });
  input.request.pipe(upstream);
}

async function proxyBufferedBrowserLiveExchange(input) {
  try {
    const body = await readBoundedRequestBody(
      input.request,
      maximumBrowserLiveExchangeBytes
    );
    const headers = stripHopByHopHeaders(input.request.headers);
    delete headers["content-length"];
    headers["content-length"] = String(body.length);

    const upstream = httpRequest({
      host: "127.0.0.1",
      port: input.nextPort,
      method: input.request.method,
      path: input.request.url,
      headers
    }, (upstreamResponse) => {
      input.response.writeHead(
        upstreamResponse.statusCode || 502,
        stripHopByHopHeaders(upstreamResponse.headers)
      );
      upstreamResponse.pipe(input.response);
    });

    upstream.once("error", () => {
      if (input.response.headersSent) {
        input.response.destroy();
        return;
      }
      input.response.writeHead(502, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
      });
      input.response.end(JSON.stringify({
        error: "Live View capability exchange is temporarily unavailable."
      }));
    });
    upstream.end(body);
  } catch {
    if (input.response.headersSent) {
      input.response.destroy();
      return;
    }
    input.response.writeHead(413, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    input.response.end(JSON.stringify({
      error: "Live View capability exchange request is too large."
    }));
  }
}

async function readBoundedRequestBody(request, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new Error("Request body exceeded the allowed size.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function authorizeAndBridgeLiveView(input) {
  try {
    const authorization = await fetch(
      `http://127.0.0.1:${input.nextPort}/api/accounts/browser-live/authorize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentos-browser-proxy-token": input.browserProxyToken,
          "x-agentos-browser-origin": readHeader(input.request.headers.origin),
          "x-agentos-browser-host": readHeader(input.request.headers.host),
          "x-agentos-browser-proto":
            readHeader(input.request.headers["x-forwarded-proto"]) || "https",
          cookie: readHeader(input.request.headers.cookie)
        },
        body: JSON.stringify({ providerSessionId: input.sessionId }),
        signal: AbortSignal.timeout(3_000)
      }
    );
    if (authorization.status !== 204) {
      rejectUpgrade(input.socket, 403);
      return;
    }

    const workerWebSocket = new WebSocket(
      toWorkerWebSocketUrl(input.browserWorkerUrl, `/session/${input.sessionId}`),
      {
        headers: {
          "x-agentos-browser-worker-token": input.browserWorkerToken
        },
        perMessageDeflate: false,
        handshakeTimeout: 3_000,
        maxPayload: 2 * 1024 * 1024
      }
    );
    await waitForWebSocketOpen(workerWebSocket);

    input.webSocketServer.handleUpgrade(input.request, input.socket, input.head, (publicWebSocket) => {
      bridgeWebSockets(publicWebSocket, workerWebSocket);
    });
  } catch {
    rejectUpgrade(input.socket, 503);
  }
}

async function proxyPrivateCdpRequest(input) {
  if (!isLoopbackAddress(input.request.socket.remoteAddress)) {
    input.response.writeHead(404, { "Cache-Control": "no-store" });
    input.response.end();
    return;
  }

  const upstreamPath = rewriteCdpRelayPath(input.request.url);
  if (!upstreamPath) {
    input.response.writeHead(404, { "Cache-Control": "no-store" });
    input.response.end();
    return;
  }

  const upstreamUrl = new URL(upstreamPath, input.browserWorkerUrl);
  const requestImplementation =
    upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = requestImplementation({
    protocol: upstreamUrl.protocol,
    hostname: upstreamUrl.hostname,
    port: upstreamUrl.port,
    method: input.request.method,
    path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
    headers: {
      host: upstreamUrl.host,
      "content-type":
        readHeader(input.request.headers["content-type"]) || "application/json",
      "x-agentos-browser-worker-token": input.browserWorkerToken
    }
  }, (upstreamResponse) => {
    const chunks = [];
    let size = 0;
    upstreamResponse.on("data", (chunk) => {
      size += chunk.length;
      if (size <= maximumCdpResponseBytes) chunks.push(chunk);
    });
    upstreamResponse.on("end", () => {
      if (size > maximumCdpResponseBytes) {
        input.response.writeHead(502, { "Cache-Control": "no-store" });
        input.response.end();
        return;
      }
      const contentType = String(upstreamResponse.headers["content-type"] || "");
      const body = Buffer.concat(chunks);
      const responseBody = contentType.includes("json")
        ? rewriteRelayedCdpJson(body, input.publicPort)
        : body;
      input.response.writeHead(upstreamResponse.statusCode || 502, {
        "Cache-Control": "no-store",
        "Content-Type": contentType || "application/octet-stream"
      });
      input.response.end(responseBody);
    });
  });
  upstream.once("error", () => {
    if (input.response.headersSent) {
      input.response.destroy();
      return;
    }
    input.response.writeHead(502, { "Cache-Control": "no-store" });
    input.response.end();
  });
  input.request.pipe(upstream);
}

async function bridgePrivateCdpWebSocket(input) {
  if (!isLoopbackAddress(input.socket.remoteAddress)) {
    rejectUpgrade(input.socket, 404);
    return;
  }
  const upstreamPath = rewriteCdpRelayPath(input.request.url);
  if (!upstreamPath) {
    rejectUpgrade(input.socket, 404);
    return;
  }

  try {
    const workerWebSocket = new WebSocket(
      toWorkerWebSocketUrl(input.browserWorkerUrl, upstreamPath),
      {
        headers: {
          "x-agentos-browser-worker-token": input.browserWorkerToken
        },
        perMessageDeflate: false,
        handshakeTimeout: 3_000,
        maxPayload: 2 * 1024 * 1024
      }
    );
    await waitForWebSocketOpen(workerWebSocket);
    input.webSocketServer.handleUpgrade(
      input.request,
      input.socket,
      input.head,
      (loopbackWebSocket) => bridgeWebSockets(loopbackWebSocket, workerWebSocket)
    );
  } catch {
    rejectUpgrade(input.socket, 503);
  }
}

export function rewriteRelayedCdpJson(body, publicPort) {
  try {
    const value = JSON.parse(body.toString("utf8"));
    const rewrite = (entry) => {
      if (Array.isArray(entry)) return entry.map(rewrite);
      if (!entry || typeof entry !== "object") return entry;
      const next = {};
      for (const [key, child] of Object.entries(entry)) {
        if (key === "webSocketDebuggerUrl" && typeof child === "string") {
          const url = new URL(child);
          const cdpPath = url.pathname.startsWith("/cdp/")
            ? url.pathname
            : `/cdp${url.pathname}`;
          next[key] =
            `ws://127.0.0.1:${publicPort}${cdpRelayPrefix}${cdpPath}${url.search}`;
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

function bridgeWebSockets(left, right) {
  left.binaryType = "arraybuffer";
  right.binaryType = "arraybuffer";
  left.on("message", (data) => {
    if (right.readyState === WebSocket.OPEN) right.send(data);
  });
  right.on("message", (data) => {
    if (left.readyState === WebSocket.OPEN) left.send(data);
  });

  const close = () => {
    if (left.readyState === WebSocket.OPEN) left.close();
    if (right.readyState === WebSocket.OPEN) right.close();
  };
  left.once("close", close);
  left.once("error", close);
  right.once("close", close);
  right.once("error", close);
}

function waitForWebSocketOpen(webSocket) {
  return new Promise((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
    webSocket.once("unexpected-response", () => reject(new Error("Browser worker rejected the session.")));
  });
}

function isBrowserLiveDocument(value) {
  const pathname = (value || "").split("?")[0];
  return pathname === "/accounts/browser-live" || pathname.startsWith("/novnc/");
}

export function isBrowserLiveExchangeRequest(value) {
  const pathname = (value || "").split("?")[0];
  return pathname === browserLiveExchangePath;
}

function isCdpRelayRequest(value) {
  const pathname = (value || "").split("?")[0];
  return pathname === cdpRelayPrefix || pathname.startsWith(`${cdpRelayPrefix}/`);
}

export function rewriteCdpRelayPath(value) {
  try {
    const url = new URL(value || "/", "http://127.0.0.1");
    if (
      url.pathname !== cdpRelayPrefix &&
      !url.pathname.startsWith(`${cdpRelayPrefix}/`)
    ) {
      return null;
    }
    const suffix = url.pathname.slice(cdpRelayPrefix.length);
    if (!suffix.startsWith("/cdp/")) return null;
    return `${suffix}${url.search}`;
  } catch {
    return null;
  }
}

function normalizeWorkerUrl(value) {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("Secure browser worker URL is invalid.");
  }
  return url.origin;
}

function toWorkerWebSocketUrl(workerUrl, requestPath) {
  const url = new URL(requestPath, workerUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export function isLoopbackAddress(value) {
  return value === "127.0.0.1" ||
    value === "::1" ||
    value === "::ffff:127.0.0.1";
}

function stripHopByHopHeaders(headers) {
  const result = { ...headers };
  delete result.connection;
  delete result["proxy-connection"];
  delete result["keep-alive"];
  delete result["proxy-authenticate"];
  delete result["proxy-authorization"];
  delete result.te;
  delete result.trailer;
  delete result["transfer-encoding"];
  delete result.upgrade;
  return result;
}

function readHeader(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function rejectUpgrade(socket, status) {
  if (socket.destroyed) return;
  const label =
    status === 403 ? "Forbidden" :
    status === 404 ? "Not Found" :
    "Service Unavailable";
  socket.end(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n`);
}
