import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error The deployment proxy is intentionally shipped as native ESM JavaScript.
import { isLoopbackAddress, rewriteCdpRelayPath, rewriteRelayedCdpJson } from "../scripts/railway-public-proxy.mjs";

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
