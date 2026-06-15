import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRuntimeIssues,
  parseScopeUpgradeRequestId
} from "@/lib/openclaw/runtime-issues";

test("runtime issue detector parses scope upgrade request ids", () => {
  const requestId = "5d037abd-5db8-444a-98f5-f49920c95338";

  assert.equal(
    parseScopeUpgradeRequestId(`unreachable (scope upgrade pending approval (requestId: ${requestId}))`),
    requestId
  );
});

test("runtime issue detector dedupes scope upgrade issues by type source and request id", () => {
  const requestId = "163fa71c-6476-4d48-964b-7c7c423b1238";
  const issues = buildRuntimeIssues({
    gatewayStatus: {
      rpc: {
        ok: false,
        error: `GatewayClientRequestError: scope upgrade pending approval (requestId: ${requestId})`
      }
    },
    issues: [
      `OpenClaw Gateway unreachable: scope upgrade pending approval (requestId: ${requestId})`
    ],
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.type, "scope_upgrade_pending");
  assert.equal(issues[0]?.source, "openclaw_gateway");
  assert.equal(issues[0]?.severity, "action_required");
  assert.equal(issues[0]?.requestId, requestId);
  assert.equal(issues[0]?.recoveryCommand, `openclaw devices approve ${requestId}`);
  assert.equal(issues[0]?.fallbackCommand, "openclaw devices approve --latest");
});

test("runtime issue detector exposes approve latest only when request id is missing", () => {
  const issues = buildRuntimeIssues({
    gatewayStatus: {
      rpc: {
        ok: false,
        error: "unreachable (scope upgrade pending approval)"
      }
    },
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.requestId, undefined);
  assert.equal(issues[0]?.recoveryCommand, undefined);
  assert.equal(issues[0]?.fallbackCommand, "openclaw devices approve --latest");
});

test("runtime issue detector reads scope upgrade from OpenClaw status gateway error", () => {
  const requestId = "b0bc4570-9b37-41ad-b858-737822a34e89";
  const issues = buildRuntimeIssues({
    status: {
      gateway: {
        reachable: false,
        error: `scope upgrade pending approval (requestId: ${requestId})`
      }
    },
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.type, "scope_upgrade_pending");
  assert.equal(issues[0]?.source, "openclaw_gateway");
  assert.equal(issues[0]?.requestId, requestId);
  assert.equal(issues[0]?.recoveryCommand, `openclaw devices approve ${requestId}`);
  assert.equal(issues[0]?.inspectCommand, "openclaw devices list");
});

test("runtime issue detector reads pending OpenClaw device access requests", () => {
  const requestId = "c94a107b-b28c-4a4f-8821-1c2f8060c0eb";
  const issues = buildRuntimeIssues({
    gatewayStatus: {
      service: { loaded: true },
      rpc: { ok: true }
    },
    deviceAccess: {
      pending: [{
        requestId,
        clientId: "cli",
        clientMode: "probe",
        role: "operator",
        scopes: ["operator.read"]
      }]
    },
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.type, "scope_upgrade_pending");
  assert.equal(issues[0]?.requestId, requestId);
  assert.deepEqual(issues[0]?.requestedScopes, ["operator.read"]);
  assert.equal(issues[0]?.recoveryCommand, `openclaw devices approve ${requestId}`);
});

test("runtime issue detector preserves dismissed active issues without duplicating them", () => {
  const requestId = "5d037abd-5db8-444a-98f5-f49920c95338";
  const id = `scope_upgrade_pending:openclaw_gateway:${requestId}`;
  const issues = buildRuntimeIssues({
    gatewayStatus: {
      rpc: {
        ok: false,
        error: `scope upgrade pending approval (requestId: ${requestId})`
      }
    },
    states: {
      [id]: {
        id,
        status: "dismissed",
        createdAt: "2026-06-14T09:00:00.000Z",
        updatedAt: "2026-06-14T09:01:00.000Z"
      }
    },
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.id, id);
  assert.equal(issues[0]?.status, "dismissed");
});

test("runtime issue detector restores failed OpenClaw update issues from state", () => {
  const id = "openclaw_postflight_failed:openclaw_cli:2026.6.1";
  const issues = buildRuntimeIssues({
    states: {
      [id]: {
        id,
        type: "openclaw_postflight_failed",
        source: "openclaw_cli",
        severity: "blocked",
        title: "OpenClaw postflight failed",
        message: "Gateway did not become healthy after update.",
        status: "failed",
        createdAt: "2026-06-14T09:00:00.000Z",
        updatedAt: "2026-06-14T09:01:00.000Z",
        rawOutput: "token=[redacted]"
      }
    },
    now: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.type, "openclaw_postflight_failed");
  assert.equal(issues[0]?.source, "openclaw_cli");
  assert.equal(issues[0]?.severity, "blocked");
  assert.equal(issues[0]?.status, "failed");
});
