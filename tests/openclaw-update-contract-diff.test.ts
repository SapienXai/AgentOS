import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareOpenClawCoreMethodSpecs,
  getOpenClawServerMethodContractDiff,
  parseOpenClawCoreMethodSpecs,
  resetOpenClawServerMethodContractDiffCache
} from "@/lib/openclaw/application/update-contract-diff-service";
import { getOpenClawReleaseContractDiff } from "@/lib/openclaw/upstream/contract-diff";
import { OPENCLAW_2026_9_7_CORE_DESCRIPTOR_FIXTURE } from "./fixtures/openclaw-2026.9.7-core-descriptors";

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

const tupleDescriptor = `
const CORE_GATEWAY_METHOD_SPECS = [
  ["health", "health", "operator.read", "<=2026.7"],
  [
    "device.pair.setupCode",
    "device-pair-setup",
    "operator.admin",
    "2026.8",
    { advertise: false, compatibilityRestored: true, description: "setup code" },
  ],
  ["sessions.create", "sessions-create", "dynamic", "<=2026.7", { startup: true }],
  ["question.request", "questions", "operator.questions", "2026.8"],
] as const satisfies readonly CoreGatewayMethodSpecRow[];
`;

const upstreamSharedPolicyDescriptor = `
const CONTROL_PLANE_WRITE = { controlPlaneWrite: true };
const CORE_GATEWAY_METHOD_SPECS = [
  ["config.apply", "config", "operator.admin", "<=2026.7", CONTROL_PLANE_WRITE],
] as const;
`;

test("core Gateway descriptors are parsed without executing OpenClaw source", () => {
  const methods = parseOpenClawCoreMethodSpecs(currentDescriptor);

  assert.deepEqual(methods.map((method) => method.name), ["health", "models.list", "agents.update"]);
  assert.equal(methods[2]?.controlPlaneWrite, true);
  assert.equal(methods[0]?.advertise, true);
});

test("v8 tuple descriptors preserve scopes and policy metadata", () => {
  const methods = parseOpenClawCoreMethodSpecs(tupleDescriptor);

  assert.deepEqual(methods.map((method) => method.name), [
    "health",
    "device.pair.setupCode",
    "sessions.create",
    "question.request"
  ]);
  assert.equal(methods[1]?.family, "device-pair-setup");
  assert.equal(methods[1]?.since, "2026.8");
  assert.equal(methods[1]?.advertise, false);
  assert.equal(methods[1]?.compatibilityRestored, true);
  assert.equal(methods[2]?.scope, "dynamic");
  assert.equal(methods[3]?.scope, "operator.questions");
});

test("tuple descriptors accept the pinned OpenClaw shared mutation policy constant", () => {
  const methods = parseOpenClawCoreMethodSpecs(upstreamSharedPolicyDescriptor);

  assert.equal(methods[0]?.name, "config.apply");
  assert.equal(methods[0]?.controlPlaneWrite, true);
});

test("OpenClaw 2026.9.7 observation lifetimes are preserved in compatibility evidence", () => {
  const current = parseOpenClawCoreMethodSpecs(`const CORE_GATEWAY_METHOD_SPECS = [
    ["agent.wait", "agent", "operator.write", "<=2026.7", { startup: true }],
  ] as const;`);
  const target = parseOpenClawCoreMethodSpecs(OPENCLAW_2026_9_7_CORE_DESCRIPTOR_FIXTURE);
  const wait = target.find((method) => method.name === "agent.wait");

  assert.equal(wait?.lifetime, "observation");
  assert.equal(target.filter((method) => method.lifetime === "observation").length, 5);
  assert.deepEqual(target.find((method) => method.name === "portal.session.list")?.sessionAccess, {
    mode: "write",
    allowOwnSessionScope: true,
    requiredTool: "portal"
  });

  const change = compareOpenClawCoreMethodSpecs(current, target).find(
    (entry) => entry.method === "agent.wait" && entry.message.includes("lifetime")
  );
  assert.equal(change?.status, "warning");
  assert.equal(change?.currentLifetime, null);
  assert.equal(change?.targetLifetime, "observation");
  assert.match(change?.message ?? "", /requester disconnects or restart drain/);
});

test("session-scoped Gateway access policy remains structured compatibility evidence", () => {
  const target = parseOpenClawCoreMethodSpecs(OPENCLAW_2026_9_7_CORE_DESCRIPTOR_FIXTURE);
  const added = compareOpenClawCoreMethodSpecs([], target).find((entry) => entry.method === "portal.session.open");

  assert.equal(added?.targetSessionAccess?.mode, "write");
  assert.equal(added?.targetSessionAccess?.allowOwnSessionScope, true);
  assert.equal(added?.targetSessionAccess?.requiredTool, "portal");
  assert.throws(
    () => parseOpenClawCoreMethodSpecs(`const CORE_GATEWAY_METHOD_SPECS = [
      ["portal.session.open", "portals", "operator.write", "2026.9", { sessionAccess: { mode: "write", newFutureRule: true } }],
    ] as const;`),
    /unsupported field newFutureRule/
  );
  assert.throws(
    () => parseOpenClawCoreMethodSpecs(`const CORE_GATEWAY_METHOD_SPECS = [
      ["portal.session.open", "portals", "operator.write", "2026.9", { sessionAccess: { mode: "admin" } }],
    ] as const;`),
    /unsupported sessionAccess mode/
  );
});

test("unknown descriptor lifetime values remain visible as unknown evidence", () => {
  const unknownTarget = parseOpenClawCoreMethodSpecs(`const CORE_GATEWAY_METHOD_SPECS = [
    ["agent.wait", "agent", "operator.write", "<=2026.7", { lifetime: "durable-observation" }],
  ] as const;`);
  const change = compareOpenClawCoreMethodSpecs(
    [{
      name: "agent.wait",
      family: "agent",
      scope: "operator.write",
      since: "<=2026.7",
      advertise: true,
      startup: true,
      controlPlaneWrite: false,
      compatibilityRestored: false,
      description: null,
      lifetime: null
    }],
    unknownTarget
  ).find((entry) => entry.method === "agent.wait" && entry.targetLifetime === "durable-observation");

  assert.equal(unknownTarget[0]?.lifetime, "durable-observation");
  assert.equal(change?.status, "unknown");
  assert.equal(change?.targetLifetime, "durable-observation");
  assert.throws(
    () => parseOpenClawCoreMethodSpecs(`const CORE_GATEWAY_METHOD_SPECS = [
      ["agent.wait", "agent", "operator.write", "<=2026.7", { lifetime: { kind: "observation" } }],
    ] as const;`),
    /invalid lifetime string/
  );
});

test("malformed or unsupported descriptor rows fail closed", () => {
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [{ name: \"health\", scope: \"operator.read\" }, { nope: true }] as const;"),
    /unsupported field/
  );
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [[\"health\", \"health\", \"operator.read\"]] as const;"),
    /invalid tuple length/
  );
  assert.throws(
    () => parseOpenClawCoreMethodSpecs("const CORE_GATEWAY_METHOD_SPECS = [{ name: \"health\", scope: \"operator.read\" }, { name: \"health\", scope: \"operator.read\" }] as const;"),
    /duplicate method/
  );
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

test("scope changes use warning and unknown evidence instead of a privilege ladder", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({ files: [] });
        }
        return new Response(url.includes("v2026.6.8")
          ? `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "sessions.create", scope: "operator.write" },
              { name: "talk.session.create", scope: "operator.write" },
              { name: "config.schema", scope: "operator.admin" },
            ] as const;`
          : `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "sessions.create", scope: "dynamic" },
              { name: "talk.session.create", scope: "operator.talk" },
              { name: "config.schema", scope: "operator.read" },
            ] as const;`);
      }
    }
  );

  assert.equal(report.status, "warning");
  assert.equal(report.unknownCount, 1);
  assert.equal(report.changes.find((change) => change.method === "sessions.create")?.status, "unknown");
  assert.equal(report.changes.find((change) => change.method === "sessions.create")?.authorizationEvidence, "runtime-required");
  assert.match(report.changes.find((change) => change.method === "sessions.create")?.message ?? "", /does not prove|runtime verification/i);
  assert.equal(report.changes.find((change) => change.method === "talk.session.create")?.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "config.schema")?.status, "warning");
  assert.equal(report.changes.some((change) => change.status === "blocker"), false);
});

test("dynamic target descriptors never certify authorization from advertisement alone", () => {
  const methods = ["sessions.create", "sessions.patch", "sessions.delete", "node.invoke", "agent", "talk.config"];
  const changes = compareOpenClawCoreMethodSpecs(
    methods.map((name) => ({
      name,
      family: null,
      scope: "operator.write",
      since: null,
      advertise: true,
      startup: false,
      controlPlaneWrite: false,
      compatibilityRestored: false,
      description: null
    })),
    methods.map((name) => ({
      name,
      family: null,
      scope: "dynamic",
      since: null,
      advertise: true,
      startup: false,
      controlPlaneWrite: false,
      compatibilityRestored: false,
      description: null
    }))
  );

  for (const method of methods) {
    const change = changes.find((candidate) => candidate.method === method);
    assert.equal(change?.status, "unknown");
    assert.equal(change?.authorizationEvidence, "runtime-required");
    assert.match(change?.message ?? "", /runtime verification/i);
  }
});

test("optional loss with a disabled fallback is warning evidence, and operation siblings are not replacements", async () => {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({ files: [] });
        }
        return new Response(url.includes("v2026.6.8")
          ? `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "tools.catalog", scope: "operator.read" },
              { name: "talk.session.join", scope: "operator.write" },
            ] as const;`
          : `export const CORE_GATEWAY_METHOD_SPECS = [
              { name: "talk.session.create", scope: "operator.talk" },
            ] as const;`);
      }
    }
  );

  assert.equal(report.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "tools.catalog")?.status, "warning");
  assert.equal(report.changes.find((change) => change.method === "talk.session.join")?.kind, "removed");
  assert.equal(report.replacedCount, 0);
});

test("required loss blocks when an unrelated operation sibling survives", () => {
  const changes = compareOpenClawCoreMethodSpecs(
    [
      { name: "required.primary", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null },
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [{ id: "health", label: "Required composite", methods: ["required.primary", "required.sibling"], baseline: "required" }]
  );

  assert.equal(changes.find((change) => change.method === "required.primary")?.kind, "removed");
  assert.equal(changes.find((change) => change.method === "required.primary")?.status, "blocker");
});

test("explicit replacement evidence prevents a required-loss blocker", () => {
  const changes = compareOpenClawCoreMethodSpecs(
    [
      { name: "required.primary", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null },
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [
      { name: "required.sibling", family: null, scope: "operator.read", since: null, advertise: true, startup: false, controlPlaneWrite: false, compatibilityRestored: false, description: null }
    ],
    [{
      id: "health",
      label: "Required composite",
      methods: ["required.primary", "required.sibling"],
      replacementEvidence: [{
        removedMethod: "required.primary",
        replacementMethods: ["required.sibling"],
        rationale: "The contract explicitly declares these two method names as aliases."
      }],
      baseline: "required"
    }]
  );

  assert.equal(changes.find((change) => change.method === "required.primary")?.kind, "replaced");
  assert.equal(changes.find((change) => change.method === "required.primary")?.status, "warning");
});

test("truncated compare evidence is completed from immutable release tag trees", async () => {
  resetOpenClawServerMethodContractDiffCache();
  const oldSha = "1".repeat(40);
  const sharedSha = "2".repeat(40);
  const newSha = "3".repeat(40);
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          return jsonResponse({
            status: "ahead",
            total_commits: 10_000,
            files: Array.from({ length: 300 }, (_, index) => ({ filename: `partial/file-${index}` }))
          });
        }
        if (url.includes("/commits/v2026.6.8")) {
          return jsonResponse({ commit: { tree: { sha: "a".repeat(40) } } });
        }
        if (url.includes("/commits/v2026.7.1")) {
          return jsonResponse({ commit: { tree: { sha: "b".repeat(40) } } });
        }
        if (url.includes("/git/trees/")) {
          const isCurrent = url.includes("a".repeat(40));
          const entries = isCurrent
            ? [
                { path: "src/gateway/server-methods/old.ts", type: "blob", sha: oldSha, mode: "100644" },
                { path: "src/gateway/server-methods/shared.ts", type: "blob", sha: sharedSha, mode: "100644" },
                { path: "package.json", type: "blob", sha: oldSha, mode: "100644" }
              ]
            : [
                { path: "src/gateway/server-methods/shared.ts", type: "blob", sha: sharedSha, mode: "100644" },
                { path: "src/gateway/server-methods/new.ts", type: "blob", sha: newSha, mode: "100644" },
                { path: "package.json", type: "blob", sha: newSha, mode: "100644" }
              ];
          return jsonResponse({ tree: entries, truncated: false });
        }
        if (url.includes("v2026.6.8")) return new Response(currentDescriptor);
        return new Response(currentDescriptor);
      }
    }
  );

  assert.equal(report.status, "warning");
  assert.deepEqual(report.changedFiles, [
    "package.json",
    "src/gateway/server-methods/new.ts",
    "src/gateway/server-methods/old.ts"
  ]);
  assert.deepEqual(report.changedServerMethodFiles, [
    "src/gateway/server-methods/new.ts",
    "src/gateway/server-methods/old.ts"
  ]);
  assert.equal(report.changes.some((change) => change.method === "__comparison_truncated__"), false);
  assert.equal(report.unknownCount, 0);
});

test("live release contract evidence keeps its upstream-diff provenance", async () => {
  resetOpenClawServerMethodContractDiffCache();
  const report = await getOpenClawReleaseContractDiff({
    fromVersion: "2026.6.8",
    targetVersion: "2026.7.1",
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes("/compare/")) {
        return jsonResponse({ status: "ahead", total_commits: 1, files: [] });
      }
      return new Response(url.includes("v2026.6.8") ? currentDescriptor : targetDescriptor);
    }
  });

  assert.equal(report.source, "agentos-server-method-diff");
  assert.deepEqual(report.evidenceGaps, []);
});

test("diverged compare evidence remains incomplete when complete tag trees are unavailable", async () => {
  const comparePages: number[] = [];
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: "2026.6.8", targetVersion: "2026.7.1" },
    {
      bypassCache: true,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/compare/")) {
          const page = Number(new URL(url).searchParams.get("page"));
          comparePages.push(page);
          return jsonResponse({
            status: "diverged",
            total_commits: 10_000,
            files: page === 1
              ? Array.from({ length: 300 }, (_, index) => ({ filename: `docs/file-${index}` }))
              : []
          });
        }
        return new Response(url.includes("v2026.6.8") ? currentDescriptor : currentDescriptor);
      }
    }
  );

  assert.deepEqual(comparePages, [1]);
  assert.deepEqual(report.changedServerMethodFiles, []);
  assert.deepEqual(report.changedProtocolFiles, []);
  assert.equal(report.changes.some((change) => change.method === "__comparison_truncated__" && change.status === "unknown"), true);
  assert.equal(report.unknownCount, 1);
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
