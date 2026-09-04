import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  modelManagementModelToCatalogModel,
  presentModelProviderSetupHint,
  resolveModelAvailability
} from "@/lib/openclaw/domains/model-management";
import { normalizeModelsPayload } from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { formatModelProviderLabel, modelProviderPresentationRegistry } from "@/lib/openclaw/model-provider-registry";

const rootDir = process.cwd();

test("native model management preserves aliases, roles, and unavailable state without provider hardcoding", () => {
  assert.equal(modelProviderPresentationRegistry["new-provider"], undefined);
  assert.equal(formatModelProviderLabel("new-provider"), "New Provider");

  const model = modelManagementModelToCatalogModel({
    id: "new-provider/new-model",
    name: "New Model",
    provider: "new-provider",
    providerName: "New Provider",
    input: "text,image",
    contextWindow: 128000,
    available: false,
    availability: "needs-auth",
    unavailableReason: "missing-auth",
    reasoning: true,
    supportsTools: true,
    tags: ["configured", "recommended"],
    alias: "new",
    role: "fallback",
    fallbackPosition: 1,
    linkedAgents: 2,
    advanced: {
      rawId: "new-provider/new-model",
      providerId: "new-provider",
      deprecated: false,
      disabled: false
    }
  });

  assert.equal(model.provider, "new-provider");
  assert.equal(model.alreadyAdded, true);
  assert.equal(model.recommended, true);
  assert.equal(model.missing, true);
  assert.equal(model.available, false);
  assert.equal(model.supportsTools, true);
});

test("model projection preserves unknown native availability and capabilities", () => {
  const model = modelManagementModelToCatalogModel({
    id: "new-provider/opaque-model",
    name: "Opaque Model",
    provider: "new-provider",
    providerName: "New Provider",
    input: "text",
    contextWindow: null,
    available: null,
    availability: "unknown",
    reasoning: undefined,
    supportsTools: undefined,
    tags: ["catalog"],
    role: "available",
    linkedAgents: 0,
    advanced: {
      rawId: "new-provider/opaque-model",
      providerId: "new-provider",
      deprecated: false,
      disabled: false
    }
  });

  assert.equal(model.available, null);
  assert.equal(model.supportsTools, null);
  assert.equal(model.recommended, false);
});

test("provider setup hints do not expose terminal commands in normal connection UI", () => {
  assert.equal(
    presentModelProviderSetupHint("Token created by running 'claude setup-token' in your terminal"),
    "Requires a provider credential prepared outside AgentOS."
  );
  assert.equal(
    presentModelProviderSetupHint("Stored and validated by OpenClaw"),
    "Stored and validated by OpenClaw"
  );
});

test("model availability maps exact native evidence without treating catalog presence as readiness", () => {
  const cases = [
    [{ available: true }, "ready"],
    [{ available: false, unavailableReason: "missing-auth" }, "needs-auth"],
    [{ available: false, unavailableReason: "auth-failed" }, "auth-failed"],
    [{ available: false, unavailableReason: "cooldown" }, "cooldown"],
    [{ available: false }, "unavailable"],
    [{ available: null }, "unknown"],
    [{ available: null, missing: true }, "unavailable"],
    [{ available: null, disabled: true }, "unavailable"],
    [{ available: null, deprecated: true }, "unavailable"]
  ] as const;

  for (const [nativeModel, expected] of cases) {
    assert.equal(resolveModelAvailability(nativeModel), expected);
  }
});

test("models.list keeps the 9.1 provider and capability metadata", () => {
  const payload = normalizeModelsPayload({
    models: [{
      id: "reasoner",
      provider: "new-provider",
      name: "Reasoner",
      input: ["text", "image"],
      contextWindow: 200000,
      contextWindows: [{ id: "large", label: "Large", contextWindow: 200000 }],
      reasoning: true,
      supportsTools: true,
      unavailableReason: "cooldown",
      tags: ["featured"]
    }],
    providerOutcomes: [{ provider: "new-provider", status: "unavailable" }]
  });

  assert.deepEqual(payload.providerOutcomes, [{ provider: "new-provider", status: "unavailable" }]);
  assert.deepEqual(payload.models[0], {
    key: "new-provider/reasoner",
    name: "Reasoner",
    provider: "new-provider",
    input: "text,image",
    contextWindow: 200000,
    contextWindows: [{ id: "large", label: "Large", contextWindow: 200000 }],
    local: null,
    available: null,
    unavailableReason: "cooldown",
    reasoning: true,
    supportsTools: true,
    tags: ["featured"],
    missing: false
  });
});

test("post-onboarding management reads OpenClaw provider and auth metadata", () => {
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-management-service.ts"),
    "utf8"
  );
  const routeSource = readFileSync(
    path.join(rootDir, "app/api/models/management/route.ts"),
    "utf8"
  );
  const wizardServiceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-setup-wizard-service.ts"),
    "utf8"
  );

  assert.match(serviceSource, /listOpenClawModels\(/);
  assert.match(serviceSource, /models\.authStatus/);
  assert.match(serviceSource, /openclaw\.setup\.detect/);
  assert.match(serviceSource, /providerOutcomes/);
  assert.doesNotMatch(serviceSource, /modelProviderRegistry/);
  assert.match(wizardServiceSource, /wizard\.next/);
  assert.match(routeSource, /openclaw\.setup\.activate\.start/);
  assert.match(routeSource, /openclaw\.setup\.prepare\.start/);
  assert.match(serviceSource, /models\.authLogout/);
  assert.match(serviceSource, /agentId/);
  assert.match(serviceSource, /adapter\.listSessions/);
  assert.match(serviceSource, /native-session/);
  assert.match(routeSource, /models\.manage/);
  assert.match(routeSource, /secrets\.manage/);
  assert.match(routeSource, /wizard-status[\s\S]*runtime\.use/);
  assert.match(routeSource, /sessionKey/);
});

test("scoped model surfaces preserve native identity and keep unsupported scopes out of the product", () => {
  const agentRouteSource = readFileSync(path.join(rootDir, "app/api/agents/route.ts"), "utf8");
  const sessionRouteSource = readFileSync(path.join(rootDir, "app/api/sessions/model/route.ts"), "utf8");
  const sessionServiceSource = readFileSync(path.join(rootDir, "lib/openclaw/application/session-model-service.ts"), "utf8");
  const clientSource = readFileSync(path.join(rootDir, "lib/openclaw/client/native-ws-gateway-client.ts"), "utf8");

  assert.match(agentRouteSource, /modelId: z\.string\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(sessionRouteSource, /action: z\.literal\("set"\)/);
  assert.match(sessionRouteSource, /action: z\.literal\("inherit"\)/);
  assert.match(sessionServiceSource, /patchSessionModel/);
  assert.match(sessionServiceSource, /listSessions/);
  assert.doesNotMatch(sessionServiceSource, /setModelAuthOrder/);
  assert.match(clientSource, /models\.list[\s\S]*agentId/);
});

test("model compatibility keeps discovery-only auth-order and scan methods out of product integration", () => {
  const compatibilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/gateway-compatibility.ts"),
    "utf8"
  );

  const authOrder = compatibilitySource.match(/id: "modelAuthOrder"[\s\S]*?productIntegratedMethods: \[\]/);
  const scan = compatibilitySource.match(/id: "modelScan"[\s\S]*?productIntegratedMethods: \[\]/);
  assert.ok(authOrder);
  assert.ok(scan);
  assert.match(authOrder[0], /productIntegration: "discovery-only"/);
  assert.match(scan[0], /productIntegration: "discovery-only"/);
});

test("the global Models UX does not use agents.defaults.models as an allowlist", () => {
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-provider-state-service.ts"),
    "utf8"
  );
  const pageSource = readFileSync(
    path.join(rootDir, "components/operations/models/models-page-content.tsx"),
    "utf8"
  );

  assert.match(serviceSource, /reserved for the native[\s\S]*OpenClaw alias\/settings surface/);
  assert.match(pageSource, /Connect Provider/);
  assert.match(pageSource, /Fallbacks/);
  assert.match(pageSource, /Model access policy/);
  assert.doesNotMatch(pageSource, /Session Model Overrides/);
  assert.doesNotMatch(pageSource, /Add Model/);
});
