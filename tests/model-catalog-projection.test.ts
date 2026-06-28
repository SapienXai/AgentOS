import assert from "node:assert/strict";
import { test } from "node:test";

import type { AddModelsCatalogModel, ModelRecord } from "@/lib/agentos/contracts";
import {
  enrichCatalogModels,
  mergeCatalogWithConfiguredModels
} from "@/lib/openclaw/domains/model-catalog-projection";

const catalogModel: AddModelsCatalogModel = {
  id: "openai/o4-mini",
  name: "o4 mini",
  provider: "openai",
  input: "text",
  contextWindow: 200_000,
  local: false,
  available: false,
  missing: false,
  alreadyAdded: true,
  recommended: false,
  supportsTools: true,
  isFree: false,
  tags: ["catalog"]
};

test("configured model projection removes stale catalog configuration state", () => {
  const models = mergeCatalogWithConfiguredModels([catalogModel], []);

  assert.equal(models[0]?.alreadyAdded, false);
});

test("configured model projection combines catalog metadata with snapshot readiness", () => {
  const configuredModel: ModelRecord = {
    id: "openai/o4-mini",
    name: "openai/o4-mini",
    provider: "openai",
    input: "text",
    contextWindow: null,
    local: false,
    available: true,
    missing: false,
    tags: ["configured"],
    usageCount: 1
  };

  const models = mergeCatalogWithConfiguredModels([catalogModel], [configuredModel]);

  assert.deepEqual(models[0], {
    ...catalogModel,
    available: true,
    alreadyAdded: true,
    tags: ["catalog", "configured"]
  });
});

test("provider discovery models use shared catalog presentation metadata", () => {
  const discoveredModel: AddModelsCatalogModel = {
    ...catalogModel,
    name: "openai/o4-mini",
    contextWindow: null,
    available: true,
    alreadyAdded: false,
    tags: ["discovered"]
  };

  const models = enrichCatalogModels([discoveredModel], [catalogModel]);

  assert.equal(models[0]?.name, "o4 mini");
  assert.equal(models[0]?.contextWindow, 200_000);
  assert.equal(models[0]?.available, true);
  assert.equal(models[0]?.alreadyAdded, false);
  assert.deepEqual(models[0]?.tags, ["catalog", "discovered"]);
});
