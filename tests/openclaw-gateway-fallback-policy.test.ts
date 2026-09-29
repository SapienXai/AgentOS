import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyGatewayFallbackImpact,
  isGatewayFallbackDiagnosticCurrent
} from "@/lib/openclaw/diagnostics/gateway-fallback-policy";

test("read-only update, discovery, and compatibility helpers are informational", () => {
  for (const operation of [
    "update.status",
    "models.scan",
    "pluginCatalog",
    "rpc.discover",
    "usage.status"
  ]) {
    assert.equal(classifyGatewayFallbackImpact({ operation, kind: "unsupported" }), "informational", operation);
  }

  assert.equal(classifyGatewayFallbackImpact({
    operation: "models.list",
    kind: "malformed-response",
    issue: "OpenClaw Gateway models.list returned an incomplete Google catalog while provider-scoped discovery was requested."
  }), "informational");
});

test("core and unknown operations degrade, while explicit auth and permission failures block", () => {
  assert.equal(classifyGatewayFallbackImpact({ operation: "chat.send", kind: "unsupported" }), "degrading");
  assert.equal(classifyGatewayFallbackImpact({ operation: "models.authStatus", kind: "malformed-response" }), "degrading");
  assert.equal(classifyGatewayFallbackImpact({ operation: "new.runtime.operation", kind: "unknown" }), "degrading");
  assert.equal(classifyGatewayFallbackImpact({ operation: "update.status", kind: "auth" }), "blocking");
  assert.equal(classifyGatewayFallbackImpact({
    operation: "models.scan",
    kind: "unknown",
    issue: "Gateway rejected the request: permission denied."
  }), "blocking");
});

test("fallback freshness is scoped to the current native connection", () => {
  assert.equal(isGatewayFallbackDiagnosticCurrent({ at: "2026-09-29T12:00:01.000Z" }, "2026-09-29T12:00:00.000Z"), true);
  assert.equal(isGatewayFallbackDiagnosticCurrent({ at: "2026-09-29T11:59:59.000Z" }, "2026-09-29T12:00:00.000Z"), false);
  assert.equal(isGatewayFallbackDiagnosticCurrent({ at: "not-a-date" }, "2026-09-29T12:00:00.000Z"), true);
});
