import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAgentOsActorUseProductPermission,
  getAgentOsProductPermissionMatrix
} from "@/lib/security/agentos-product-authorization";
import type { AgentOsActorContext } from "@/lib/security/agentos-actor";

const owner: AgentOsActorContext = {
  actorId: "00000000-0000-4000-8000-000000000001",
  kind: "instance-operator",
  username: "owner",
  displayName: "Owner",
  authenticationMethod: "instance-session",
  authenticated: true,
  agentOsRole: "owner"
};
const member: AgentOsActorContext = { ...owner, actorId: "00000000-0000-4000-8000-000000000002", username: "member", agentOsRole: "member" };
const service: AgentOsActorContext = { ...owner, actorId: "service:agentos-api-token", kind: "service", username: null, displayName: null, authenticationMethod: "api-token" };

test("central product policy separates owner controls from member runtime access", () => {
  assert.equal(canAgentOsActorUseProductPermission(owner, "users.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(owner, "gateway.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "runtime.use"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "sessions.use"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "users.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "gateway.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "secrets.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "users.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "gateway.manage"), true);
});

test("permission matrix is bounded and explicit for service/internal actors", () => {
  const matrix = getAgentOsProductPermissionMatrix();
  assert.ok(matrix.owner.includes("users.manage"));
  assert.ok(matrix.member.includes("runtime.use"));
  assert.ok(!matrix.member.includes("lifecycle.manage"));
  assert.ok(!matrix.service.includes("users.manage"));
});
