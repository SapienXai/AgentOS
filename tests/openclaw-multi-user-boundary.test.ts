import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Phase 4B uses exact native OpenClaw users methods and no fabricated users.create", async () => {
  const source = await readFile("lib/openclaw/client/native-ws-gateway-client.ts", "utf8");
  const contract = await readFile("lib/openclaw/identity/contract.ts", "utf8");
  assert.match(source, /"users\.list"/);
  assert.match(source, /"users\.self"/);
  assert.match(source, /"users\.setDisplayName"/);
  assert.match(source, /"users\.setAvatar"/);
  assert.match(source, /"users\.linkEmail"/);
  assert.match(source, /"users\.setRole"/);
  assert.doesNotMatch(source, /"users\.create"/);
  assert.match(contract, /users\.setRole/);
});

test("high-value mutation routes carry a central AgentOS product permission", async () => {
  const routeSources = await Promise.all([
    "app/api/agents/route.ts",
    "app/api/gateway/control/route.ts",
    "app/api/settings/gateway/route.ts",
    "app/api/openclaw/migrations/route.ts",
    "app/api/update/route.ts",
    "app/api/users/route.ts",
    "app/api/users/openclaw/route.ts"
  ].map((file) => readFile(file, "utf8")));
  for (const source of routeSources) assert.match(source, /requireAgentOsProductPermission|productPermission/);
  const agentRoute = routeSources[0]!;
  assert.match(agentRoute, /productPermission: "agents\.manage"/);
  assert.match(await readFile("app/api/gateway/control/route.ts", "utf8"), /"lifecycle\.manage"/);
  assert.match(await readFile("app/api/users/route.ts", "utf8"), /"users\.manage"/);
});

test("shared transport boundary is encoded before OpenClaw preflight", async () => {
  const source = await readFile("lib/security/agentos-openclaw-request.ts", "utf8");
  const productSource = await readFile("lib/security/agentos-product-authorization.ts", "utf8");
  assert.match(source, /input\.productPermission/);
  assert.match(source, /canAgentOsActorUseProductPermission/);
  assert.match(source, /OpenClawAuthorizationService/);
  assert.ok(source.indexOf("canAgentOsActorUseProductPermission") < source.indexOf("new OpenClawAuthorizationService"));
  assert.match(productSource, /agentOsRole === "member"/);
  assert.match(productSource, /SERVICE_PERMISSIONS/);
});
