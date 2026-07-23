import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

// @ts-expect-error The deployment proxy is intentionally shipped as native ESM JavaScript.
import { isBrowserLiveExchangeRequest, isLoopbackAddress, rewriteCdpRelayPath, rewriteRelayedCdpJson, startRailwayPublicProxy } from "../scripts/railway-public-proxy.mjs";

test("Railway CDP relay stays loopback and rewrites worker WebSocket endpoints", () => {
  assert.equal(
    rewriteCdpRelayPath(
      "/_agentos/browser-cdp/cdp/profile/acct-test/devtools/browser/version"
    ),
    "/cdp/profile/acct-test/devtools/browser/version"
  );
  assert.equal(
    rewriteCdpRelayPath("/_agentos/browser-cdp/profile/acct-test"),
    null
  );
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("10.0.0.8"), false);

  const response = rewriteRelayedCdpJson(
    Buffer.from(JSON.stringify({
      webSocketDebuggerUrl:
        "ws://127.0.0.1:18794/cdp/profile/acct-test/devtools/browser/abc"
    })),
    3000
  );
  assert.deepEqual(JSON.parse(response.toString("utf8")), {
    webSocketDebuggerUrl:
      "ws://127.0.0.1:3000/_agentos/browser-cdp/cdp/profile/acct-test/devtools/browser/abc"
  });
});

test("Live View exchange buffering is limited to the exact same-origin API path", () => {
  assert.equal(
    isBrowserLiveExchangeRequest("/api/accounts/browser-live/exchange"),
    true
  );
  assert.equal(
    isBrowserLiveExchangeRequest("/api/accounts/browser-live/exchange?attempt=1"),
    true
  );
  assert.equal(
    isBrowserLiveExchangeRequest("/api/accounts/browser-live/ws/session"),
    false
  );
  assert.equal(
    isBrowserLiveExchangeRequest("/api/accounts/browser-live/exchange/extra"),
    false
  );
});

test("Live View exchange proxy completes a chunked request with an explicit body length", async () => {
  let receivedBody = "";
  let receivedLength = "";
  const upstream = createServer((request, response) => {
    receivedLength = String(request.headers["content-length"] ?? "");
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      receivedBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    });
  });
  await listen(upstream);

  const proxy = await startRailwayPublicProxy({
    publicPort: 0,
    nextPort: portOf(upstream),
    browserWorkerUrl: "http://127.0.0.1:18794",
    browserProxyToken: "proxy-token",
    browserWorkerToken: "worker-token"
  });

  try {
    const payload = '{"capability":"test-value"}';
    const result = await new Promise<{ body: string; status: number }>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port: portOf(proxy),
        method: "POST",
        path: "/api/accounts/browser-live/exchange",
        headers: {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked"
        }
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ body, status: response.statusCode ?? 0 });
        });
      });
      request.once("error", reject);
      request.write(payload.slice(0, 8));
      request.end(payload.slice(8));
    });

    assert.equal(result.status, 200);
    assert.equal(result.body, '{"ok":true}');
    assert.equal(receivedBody, payload);
    assert.equal(receivedLength, String(Buffer.byteLength(payload)));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function portOf(server: ReturnType<typeof createServer>) {
  return (server.address() as AddressInfo).port;
}
