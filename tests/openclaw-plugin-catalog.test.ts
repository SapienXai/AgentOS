import assert from "node:assert/strict";
import { test } from "node:test";

import { getOpenClawPluginCatalog } from "@/lib/openclaw/application/catalog-service";
import { OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS } from "@/lib/openclaw/client/gateway-compatibility";
import { checkOpenClawCompatibilityContracts } from "@/lib/openclaw/compat/contracts";
import {
  normalizePluginCatalogBrowsePayload,
  normalizePluginCatalogCategoriesPayload,
  normalizePluginCatalogGetPayload
} from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  createPluginCatalogContext,
  normalizePluginCatalogBrowseInput
} from "@/lib/openclaw/domains/plugin-catalog";

const entry = {
  id: "official_calendar",
  catalog: {
    name: "Calendar automation",
    packageName: "@openclaw/calendar",
    summary: "Connect calendar workflows to an agent.",
    family: "code-plugin" as const,
    author: "OpenClaw",
    official: true,
    categories: ["productivity"],
    latestVersion: "1.2.0",
    verificationTier: "verified",
    futureCatalogField: "preserve-me"
  },
  local: {
    present: true,
    installed: true,
    enabled: true,
    state: "enabled" as const,
    pluginId: "official.calendar",
    action: "manage" as const,
    futureLocalField: "preserve-me"
  }
};

test("native plugin catalog normalization preserves authoritative local facts and safe future fields", () => {
  const browse = normalizePluginCatalogBrowsePayload({
    items: [entry],
    nextCursor: "next-page",
    remoteError: "remote catalog partial",
    futureResponseField: { preserved: true }
  });
  const categories = normalizePluginCatalogCategoriesPayload({
    categories: [
      { slug: "z", label: "Zed", description: "z", icon: "z", order: 2 },
      { slug: "a", label: "Alpha", description: "a", icon: "a", order: 1 }
    ]
  });
  const detail = normalizePluginCatalogGetPayload({
    plugin: entry,
    detail: {
      origin: "local",
      topics: ["calendar"],
      configuration: [{ name: "CALENDAR_TOKEN", required: true, sensitive: true }],
      mcpServers: [],
      skills: [{ name: "calendar" }],
      versions: [{ version: "1.2.0", createdAt: 1, changelog: "Initial", tags: ["latest"] }],
      futureDetailField: "preserve-me"
    }
  });

  assert.equal(browse.items[0]?.local.state, "enabled");
  assert.equal(browse.items[0]?.local.enabled, true);
  assert.equal(browse.items[0]?.catalog.futureCatalogField, "preserve-me");
  assert.equal(browse.futureResponseField && typeof browse.futureResponseField, "object");
  assert.deepEqual(categories.categories.map((category) => category.slug), ["a", "z"]);
  assert.equal(detail.detail.configuration[0]?.sensitive, true);
  assert.equal(detail.detail.futureDetailField, "preserve-me");
});

test("plugin catalog input is bounded and workspace relevance stays unknown without evidence", () => {
  const normalized = normalizePluginCatalogBrowseInput({
    query: `  ${"x".repeat(300)}  `,
    category: " productivity ",
    pageSize: 999
  });
  assert.equal(normalized.query?.length, 200);
  assert.equal(normalized.category, "productivity");
  assert.equal(normalized.pageSize, 100);

  const context = createPluginCatalogContext(
    { name: "Calendar workspace", slug: "calendar-workspace" },
    { name: "Planner", profile: { purpose: "Plan calendar workflows", operatingInstructions: [], responseStyle: [], outputPreference: null, sourceFiles: [] } }
  );
  assert.equal(context?.workspaceName, "Calendar workspace");
});

test("catalog service uses only the native Gateway surface and projects relevance", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const result = await getOpenClawPluginCatalog({
    query: "calendar",
    pageSize: 999,
    pluginId: "official_calendar",
    version: "1.2.0",
    context: { workspaceName: "Calendar workspace" }
  }, {}, {
    canProbeNativeGateway: () => true,
    probeNativeGateway: async <TPayload>(method: string, params: Record<string, unknown> = {}): Promise<TPayload> => {
      calls.push({ method, params });
      const payload = method === "plugins.catalog.browse"
        ? { items: [entry], nextCursor: "cursor" }
        : method === "plugins.catalog.categories"
          ? { categories: [] }
          : {
        plugin: entry,
        detail: {
          origin: "local",
          topics: [],
          configuration: [],
          mcpServers: [],
          skills: [],
          versions: []
        }
      };
      return payload as TPayload;
    }
  });

  assert.equal(result.state, "ready");
  assert.equal(result.liveProof, false);
  assert.equal(result.items[0]?.local.state, "enabled");
  assert.equal(result.items[0]?.relevance.state, "relevant");
  assert.equal(result.nextCursor, "cursor");
  assert.deepEqual(calls.map((call) => call.method).sort(), ["plugins.catalog.browse", "plugins.catalog.categories", "plugins.catalog.get"]);
  assert.deepEqual(calls.find((call) => call.method === "plugins.catalog.browse")?.params, {
    query: "calendar",
    pageSize: 100
  });
  assert.deepEqual(calls.find((call) => call.method === "plugins.catalog.get")?.params, {
    id: "official_calendar",
    version: "1.2.0"
  });
  assert.equal(calls.some((call) => "context" in call.params), false);
});

test("catalog service exposes unsupported and authorization-denied states without fallback", async () => {
  const unsupported = await getOpenClawPluginCatalog({}, {}, {
    canProbeNativeGateway: () => false,
    probeNativeGateway: async <TPayload>(): Promise<TPayload> => ({}) as TPayload
  });
  assert.equal(unsupported.state, "unsupported");

  const denied = await getOpenClawPluginCatalog({}, {}, {
    canProbeNativeGateway: () => true,
    probeNativeGateway: async <TPayload>(): Promise<TPayload> => {
      throw new OpenClawGatewayClientError("operator.read is required", "scope-limited");
    }
  });
  assert.equal(denied.state, "denied");
  assert.ok(denied.failures.every((failure) => failure.state === "denied"));
});

test("malformed native catalog payloads fail honestly and redact native errors", async () => {
  assert.throws(
    () => normalizePluginCatalogBrowsePayload({ items: [{ id: "not-enough-data" }] }),
    /plugins\.catalog\.browse: OpenClaw Gateway returned a malformed response/
  );

  const failed = await getOpenClawPluginCatalog({}, {}, {
    canProbeNativeGateway: () => true,
    probeNativeGateway: async <TPayload>(): Promise<TPayload> => {
      throw new OpenClawGatewayClientError("Gateway token=secret-value malformed payload", "malformed-response");
    }
  });
  assert.equal(failed.state, "failed");
  assert.match(failed.failures[0]?.message ?? "", /token=\[redacted\]/);
  assert.doesNotMatch(failed.failures[0]?.message ?? "", /secret-value/);
});

test("plugin catalog compatibility is optional, native-only, and operator.read scoped", async () => {
  const operation = OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.find((candidate) => candidate.id === "pluginCatalog");
  assert.deepEqual(operation?.methods, ["plugins.catalog.browse", "plugins.catalog.categories", "plugins.catalog.get"]);
  assert.equal(operation?.fallbackAllowed, false);

  const checks = await checkOpenClawCompatibilityContracts({
    effectiveMethods: operation?.methods ?? [],
    effectiveEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const check = checks.find((candidate) => candidate.operation === "pluginCatalog");
  assert.deepEqual(check?.requiredScopes, ["operator.read"]);
  assert.equal(check?.nativeGatewaySupported, true);
  assert.equal(check?.cliFallbackAvailable, false);
});
