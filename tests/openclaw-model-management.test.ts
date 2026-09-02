import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { modelManagementModelToCatalogModel } from "@/lib/openclaw/domains/model-management";
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

test("models.list keeps the 8.2 provider and capability metadata", () => {
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

  assert.match(serviceSource, /listOpenClawModels\(/);
  assert.match(serviceSource, /models\.authStatus/);
  assert.match(serviceSource, /openclaw\.setup\.detect/);
  assert.match(serviceSource, /providerOutcomes/);
  assert.doesNotMatch(serviceSource, /modelProviderRegistry/);
  assert.match(serviceSource, /openclaw\.setup\.activate/);
  assert.match(routeSource, /wizard\.next/);
  assert.match(serviceSource, /models\.authLogout/);
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
