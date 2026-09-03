import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentsCreateParamsSchema,
  ChatSendParamsSchema,
  HelloOkSchema,
  SessionsAbortParamsSchema
} from "@openclaw/gateway-protocol/schema";
import { GATEWAY_CLIENT_CAPS } from "@openclaw/gateway-protocol/client-info";

import {
  buildChatInjectParams,
  buildSessionSteerParams
} from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION
} from "@/lib/openclaw/client/native-ws-gateway-types";

test("AgentOS derives the supported control range and roster capability from the official 8.2 package", () => {
  assert.equal(MIN_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(MAX_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(GATEWAY_CLIENT_CAPS.AGENT_KIND, "agent-kind");
  assert.equal(GATEWAY_CLIENT_CAPS.TOOL_EVENTS, "tool-events");
});

test("official 8.2 schemas keep AgentOS native payloads closed and exact", () => {
  assert.deepEqual(HelloOkSchema.required, ["type", "protocol", "server", "features", "snapshot", "auth", "policy"]);
  assert.deepEqual(AgentsCreateParamsSchema.required, ["name"]);
  assert.equal((AgentsCreateParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(SessionsAbortParamsSchema.required, undefined);
  assert.equal((SessionsAbortParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(ChatSendParamsSchema.required, ["sessionKey", "message", "idempotencyKey"]);
  assert.equal((ChatSendParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
});

test("modern steering and injection builders match their distinct 8.2 identities", () => {
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
