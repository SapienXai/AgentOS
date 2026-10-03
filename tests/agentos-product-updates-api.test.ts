import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const route = readFileSync(path.join(process.cwd(), "app/api/agentos/updates/route.ts"), "utf8");

test("AgentOS update reads require runtime access and never use shared caches", () => {
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.match(getHandler, /requireAgentOsProductPermission\(request, "runtime\.use"\)/);
  assert.match(getHandler, /canAgentOsActorUseProductPermission\(authorization\.actor, "updates\.manage"\)/);
  assert.match(getHandler, /"Cache-Control": "no-store"/);
});

test("AgentOS update preparation is same-origin, privileged, strict, and durable before acceptance", () => {
  assert.match(route, /const prepareSchema = z\.strictObject\(/);
  assert.match(route, /targetVersion: z\.string\(\)\.regex\(/);
  const postHandler = route.slice(route.indexOf("export async function POST"));
  assert.match(postHandler, /requireSameOriginMutation\(request\)/);
  assert.match(postHandler, /requireAgentOsProductPermission\(request, "updates\.manage"\)/);
  assert.match(route, /nativeCheckId: z\.string\(\)\.uuid\(\)/);
  assert.ok(postHandler.indexOf("await prepareAgentOsProductUpdate(") < postHandler.indexOf("status: 202"));
  assert.match(postHandler, /error\.code === "conflict" \|\| error\.code === "replay" \? 409/);
  assert.match(postHandler, /error\.code === "unsupported" \? 501/);
});
