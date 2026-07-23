import { createServer, request as httpRequest } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

const liveViewPathPattern =
  /^\/api\/accounts\/browser-live\/ws\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?.*)?$/i;
const browserLiveCsp = [
  "default-src 'self'",
  "script-src 'self'",
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
  const browserWorkerPort = input.browserWorkerPort;
  const browserProxyToken = input.browserProxyToken;
  const browserWorkerToken = input.browserWorkerToken;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 2 * 1024 * 1024
  });

  const server = createServer((request, response) => {
    proxyHttpRequest({ request, response, nextPort });
  });

  server.on("upgrade", (request, socket, head) => {
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
      browserWorkerPort,
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
      `ws://127.0.0.1:${input.browserWorkerPort}/session/${input.sessionId}`,
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
