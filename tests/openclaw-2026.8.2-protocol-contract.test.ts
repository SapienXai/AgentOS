import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentsCreateParamsSchema,
  ChatSendParamsSchema,
  HelloOkSchema,
  SessionsAbortParamsSchema
} from "@openclaw/gateway-protocol/schema";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES
} from "@openclaw/gateway-protocol/client-info";

import {
  buildDeviceAuthPayloadV3,
  normalizeDeviceMetadataForAuth
} from "@/lib/openclaw/client/gateway-device-auth";
import { resolveGatewayClientId } from "@/lib/openclaw/client/openclaw-protocol";
import {
  getOpenClawGatewayCompatibilityOperation,
  OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS,
  type OpenClawGatewayCompatibilityOperationId
} from "@/lib/openclaw/client/gateway-compatibility";
import { NativeGatewayRequestError, normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  resolveGatewayEventSupportState,
  resolveGatewayMethodSupportState,
  supportsGatewayMethod
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import {
  buildChatInjectParams,
  buildSessionSteerParams
} from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION
} from "@/lib/openclaw/client/native-ws-gateway-types";

test("AgentOS derives the supported control range and roster capability from the official 9.1 package", () => {
  assert.equal(MIN_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(MAX_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(GATEWAY_CLIENT_CAPS.AGENT_KIND, "agent-kind");
  assert.equal(GATEWAY_CLIENT_CAPS.TOOL_EVENTS, "tool-events");
  assert.equal(GATEWAY_CLIENT_CAPS.TERMINAL_SESSION_METADATA, "terminal-session-metadata");
});

test("official 9.1 schemas keep AgentOS native payloads closed and exact", () => {
  assert.deepEqual(HelloOkSchema.required, ["type", "protocol", "server", "features", "snapshot", "auth", "policy"]);
  assert.deepEqual(AgentsCreateParamsSchema.required, ["name"]);
  assert.equal((AgentsCreateParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(SessionsAbortParamsSchema.required, undefined);
  assert.equal((SessionsAbortParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(ChatSendParamsSchema.required, ["sessionKey", "message", "idempotencyKey"]);
  assert.equal((ChatSendParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
});

test("modern steering and injection builders match their distinct 9.1 identities", () => {
  const steer = buildSessionSteerParams({
    key: "agent:worker-a:main",
    message: "Continue",
    idempotencyKey: "submission-1"
  });
  const inject = buildChatInjectParams({
    sessionKey: "agent:worker-a:main",
    message: "Reference only",
    label: "operator-context"
  });

  assert.deepEqual(steer, {
    sessionKey: "agent:worker-a:main",
    agentId: undefined,
    sessionId: undefined,
    message: "Continue",
    queueMode: "steer",
    idempotencyKey: "submission-1"
  });
  assert.deepEqual(inject, {
    sessionKey: "agent:worker-a:main",
    agentId: undefined,
    message: "Reference only",
    label: "operator-context"
  });
  assert.throws(
    () => buildSessionSteerParams({ message: "No target" }),
    /exact session key/
  );
  assert.throws(
    () => buildChatInjectParams({ message: "No target" }),
    /exact session key/
  );
});

test("AgentOS uses the official client registry and only implemented capabilities", () => {
  assert.equal(GATEWAY_CLIENT_IDS.GATEWAY_CLIENT, "gateway-client");
  assert.equal(GATEWAY_CLIENT_MODES.BACKEND, "backend");
  assert.deepEqual([GATEWAY_CLIENT_CAPS.AGENT_KIND, GATEWAY_CLIENT_CAPS.TOOL_EVENTS], ["agent-kind", "tool-events"]);
  assert.throws(
    () => resolveGatewayClientId("not-a-registered-client"),
    /Unsupported OpenClaw Gateway client id/
  );
});

test("AgentOS device-auth metadata normalization matches the official 9.1 helper", () => {
  const vectors: Array<[string | null | undefined, string]> = [
    [undefined, ""],
    [null, ""],
    ["", ""],
    ["   ", ""],
    ["  DARWIN  ", "darwin"],
    [process.platform, process.platform.toLowerCase()],
    [" MacBookPro18,3 ", "macbookpro18,3"],
    [" Darwin|ARM64 ", "darwin|arm64"]
  ];

  for (const [input, expected] of vectors) {
    assert.equal(normalizeDeviceMetadataForAuth(input), expected, input ?? "missing");
  }

  assert.equal(
    buildDeviceAuthPayloadV3({
      deviceId: "device-1",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.read"],
      signedAtMs: 42,
      token: "token",
      nonce: "nonce",
      platform: " Darwin|ARM64 ",
      deviceFamily: " MacBookPro18,3 "
    }),
    "v3|device-1|gateway-client|backend|operator|operator.read|42|token|nonce|darwin|arm64|macbookpro18,3"
  );
});

test("the 9.1 task contract uses snapshot RPCs plus the raw task event", () => {
  const taskEvents = getOpenClawGatewayCompatibilityOperation("taskEvents");

  assert.deepEqual(taskEvents?.methods, ["tasks.list", "tasks.get"]);
  assert.deepEqual(taskEvents?.events, ["task"]);
});

test("9.1 discovery-only capability families preserve OpenClaw ownership", () => {
  const expected: Record<string, { methods: string[]; events: string[] }> = {
    taskSuggestions: {
      methods: [
        "taskSuggestions.list",
        "taskSuggestions.create",
        "taskSuggestions.accept",
        "taskSuggestions.dismiss"
      ],
      events: ["task.suggestion"]
    },
    worktrees: {
      methods: [
        "worktrees.list",
        "worktrees.create",
        "worktrees.remove",
        "worktrees.restore",
        "worktrees.gc",
        "worktrees.branches"
      ],
      events: []
    },
    skillsLibrary: {
      methods: [
        "skills.library.list",
        "skills.library.read",
        "skills.library.save",
        "skills.library.mutate",
        "skills.library.activate",
        "skills.library.import",
        "skills.library.upload"
      ],
      events: ["skills.changed"]
    },
    sessionCollaboration: {
      methods: [
        "session.visibility.set",
        "session.members.list",
        "session.members.add",
        "session.members.remove",
        "session.members.listEvidence",
        "session.suggestions.add",
        "session.suggestions.list",
        "session.suggestions.resolve",
        "session.typing",
        "session.discussion.info",
        "session.discussion.open",
        "sessions.assignOwner"
      ],
      events: ["session.sharing", "session.sharing.evidence", "session.typing"]
    }
  };

  for (const [operationId, contract] of Object.entries(expected)) {
    const operation = getOpenClawGatewayCompatibilityOperation(operationId as OpenClawGatewayCompatibilityOperationId);
    assert.deepEqual(operation.methods, contract.methods, operationId);
    assert.deepEqual(operation.events ?? [], contract.events, operationId);
    assert.equal(operation.productIntegration, "discovery-only", operationId);
    if (operationId === "skillsLibrary") {
      assert.deepEqual(operation.productIntegratedMethods, [
        "skills.library.list",
        "skills.library.read",
        "skills.library.activate"
      ]);
    }
    if (operationId === "tools") {
      assert.deepEqual(operation.productIntegratedMethods, ["tools.catalog", "tools.effective"]);
    }
    for (const method of contract.methods) {
      assert.equal(OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.includes(method), true, method);
    }
  }
});

test("official Gateway discovery omission remains unknown rather than unsupported", () => {
  const hello = { features: { methods: ["status"], events: ["sessions.changed"] } };

  assert.equal(resolveGatewayMethodSupportState(hello, "models.list"), "known-by-contract");
  assert.equal(resolveGatewayMethodSupportState(hello, "future.method"), "unknown-not-advertised");
  assert.equal(resolveGatewayEventSupportState(hello, "session.message"), "unknown-not-advertised");
  assert.equal(supportsGatewayMethod(hello, "models.list"), true);
  assert.equal(resolveGatewayMethodSupportState(hello, "models.list", { kind: "unsupported" }), "proven-unsupported");
});

test("structured Gateway errors keep unsupported and scope denial distinct", () => {
  const scopeError = new NativeGatewayRequestError(
    "FORBIDDEN: missing scope",
    "config.patch",
    true,
    {
      cause: {
        type: "res",
        id: "request-1",
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "missing scope",
          details: { code: "MISSING_SCOPE", missingScope: "operator.admin", requiredScopes: ["operator.admin"] }
        }
      }
    }
  );
  const unsupportedError = new NativeGatewayRequestError(
    "INVALID_REQUEST: unknown method",
    "future.method",
    true,
    {
      cause: {
        type: "res",
        id: "request-2",
        ok: false,
        error: { code: "INVALID_REQUEST", message: "unknown method: future.method" }
      }
    }
  );

  assert.equal(normalizeClientError(scopeError).kind, "scope-limited");
  assert.equal(normalizeClientError(unsupportedError).kind, "unsupported");
});
