import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  getOpenClawFallbackRegistrySummary,
  OPENCLAW_FALLBACK_REGISTRY
} from "@/lib/openclaw/fallback-registry";

const rootDir = process.cwd();

test("fallback registry covers audited production fallback sources with inspectable anchors", () => {
  const auditedSources = [
    "app/api/openclaw/compatibility-smoke/route.ts",
    "app/api/update/route.ts",
    "lib/openclaw/adapter/openclaw-adapter.ts",
    "lib/openclaw/application/channel-connect-service.ts",
    "lib/openclaw/application/chatgpt-provider-auth-service.ts",
    "lib/openclaw/application/compatibility-smoke-service.ts",
    "lib/openclaw/application/gateway-service.ts",
    "lib/openclaw/application/mission-control/diagnostics.ts",
    "lib/openclaw/application/mobile-pairing-service.ts",
    "lib/openclaw/application/task-health-service.ts",
    "lib/openclaw/cli.ts",
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/client/gateway-client-factory.ts",
    "lib/openclaw/client/gateway-client.ts",
    "lib/openclaw/client/native-ws-gateway-client.ts",
    "lib/openclaw/migration-engine/runtime.ts",
    "lib/openclaw/reset.ts",
    "lib/openclaw/runtime-certification/harness.ts",
    "scripts/openclaw-runtime-certification.ts"
  ];
  const registeredSources = new Set<string>(OPENCLAW_FALLBACK_REGISTRY.map((entry) => entry.sourcePath));

  for (const sourcePath of auditedSources) {
    assert.equal(registeredSources.has(sourcePath), true, `missing registry source: ${sourcePath}`);
  }

  for (const entry of OPENCLAW_FALLBACK_REGISTRY) {
    assert.ok(entry.id);
    assert.ok(entry.operation);
    assert.ok(entry.reason);
    assert.ok(entry.minimumSupportedOpenClaw);
    assert.ok(entry.owner);
    assert.ok(entry.removalCondition);
    assert.ok(entry.sourceAnchors.length > 0);
    assert.ok(entry.diagnostics.observable);
    const source = readFileSync(path.join(rootDir, entry.sourcePath), "utf8");
    for (const anchor of entry.sourceAnchors) {
      assert.equal(source.includes(anchor), true, `${entry.id} anchor is stale: ${anchor}`);
    }
  }
});

test("fallback registry preserves native-only plugin catalog and reports governed mode", () => {
  const pluginCatalog = OPENCLAW_FALLBACK_REGISTRY.find((entry) => entry.id === "plugin-catalog.native-only");
  const summary = getOpenClawFallbackRegistrySummary();

  assert.ok(pluginCatalog);
  assert.equal(pluginCatalog.fallbackAllowed, false);
  assert.equal(pluginCatalog.nativeMethodCandidate, "plugins.catalog.browse");
  assert.equal(summary.fallbackMode, "native-first-governed-cli-recovery");
  assert.equal(summary.fallbackAllowed, true);
  assert.equal(summary.disallowedOperationIds.includes("plugin-catalog.native-only"), true);
  assert.equal(summary.totalEntries, summary.allowedEntryCount + summary.disallowedEntryCount);
});
