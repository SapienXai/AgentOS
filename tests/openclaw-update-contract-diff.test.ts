import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getOpenClawServerMethodContractDiff,
  parseOpenClawCoreMethodSpecs,
  resetOpenClawServerMethodContractDiffCache
} from "@/lib/openclaw/application/update-contract-diff-service";

const currentDescriptor = `
export const CORE_GATEWAY_METHOD_SPECS = [
  { name: "health", scope: "operator.read" },
  { name: "models.list", scope: "operator.read" },
  { name: "agents.update", scope: "operator.write", controlPlaneWrite: true },
] as const;
`;

const targetDescriptor = `
export const CORE_GATEWAY_METHOD_SPECS = [
  { name: "models.list", scope: "operator.admin" },
  { name: "agents.update", scope: "operator.write", controlPlaneWrite: true },
  { name: "gateway.identity.get", scope: "operator.read" },
] as const;
`;

test("core Gateway descriptors are parsed without executing OpenClaw source", () => {
  const methods = parseOpenClawCoreMethodSpecs(currentDescriptor);

  assert.deepEqual(methods.map((method) => method.name), ["health", "models.list", "agents.update"]);
  assert.equal(methods[2]?.controlPlaneWrite, true);
  assert.equal(methods[0]?.advertise, true);
});

test("required method removal and privilege escalation block update preflight evidence", async () => {
  resetOpenClawServerMethodContractDiffCache();
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      now: () => new Date("2026-07-01T10:00:00.000Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({
            files: [
              { filename: "src/gateway/server-methods/models.ts" },
              { filename: "packages/gateway-protocol/src/schema/models.ts" }
            ]
          });
        }

        return new Response(url.includes("v2026.6.8") ? currentDescriptor : targetDescriptor);
      }
    }
  );

  assert.equal(report.status, "blocker");
  assert.equal(report.source, "github-static");
  assert.equal(report.currentMethodCount, 3);
  assert.equal(report.targetMethodCount, 3);
  assert.equal(report.changedServerMethodFiles.length, 1);
  assert.equal(report.changedProtocolFiles.length, 1);
  assert.equal(report.changes.some((change) => change.method === "health" && change.status === "blocker"), true);
  assert.equal(report.changes.some((change) => change.method === "models.list" && change.kind === "scope-changed"), true);
});

test("unavailable target source produces bounded unknown evidence instead of throwing", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.2" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        return new Response(url.includes("v2026.7.2") ? "Not found" : currentDescriptor, {
          status: url.includes("v2026.7.2") ? 404 : 200
        });
      }
    }
  );

  assert.equal(report.status, "unknown");
  assert.equal(report.source, "unavailable");
  assert.match(report.error ?? "", /HTTP 404/);
});

test("invalid versions never reach the network", async () => {
  let fetchCalls = 0;
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "../../main", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("");
      }
    }
  );

  assert.equal(report.status, "unknown");
  assert.equal(fetchCalls, 0);
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" }
  });
}
