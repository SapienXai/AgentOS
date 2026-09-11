import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { diffProtocolSchemas, SOURCE, TARGET } from "../scripts/openclaw-2026-9-3-to-9-4-contract-audit.mjs";

const audit = JSON.parse(readFileSync("docs/evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json", "utf8"));
const migration = JSON.parse(readFileSync("docs/evidence/openclaw-2026.9.3-to-2026.9.4-migration.json", "utf8"));

test("the 9.4 contract audit proves exact upstream identity and additive method inventory", () => {
  assert.equal(audit.success, true);
  assert.deepEqual(audit.checks, {
    sourcePackageExact: true,
    targetPackageExact: true,
    clientAndProtocolExact: true,
    sourceAndTargetTagIdentityExact: true,
    targetProtocolV4: true,
    stateSchema16To17: true,
    agentSchemaRemains19: true,
    methodsOnlyAdditive: true,
    definitionsOnlyAdditiveOrChanged: true,
    archiveIntegrityExact: true
  });
  assert.equal(audit.protocolDiff.methodInventory.sourceCount, 440);
  assert.equal(audit.protocolDiff.methodInventory.targetCount, 445);
  assert.deepEqual(audit.protocolDiff.methodInventory.removed, []);
  assert.deepEqual(audit.protocolDiff.methodInventory.added, [
    "environments.prepare",
    "plugins.catalog.browse",
    "plugins.catalog.categories",
    "plugins.catalog.get",
    "tasks.history"
  ]);
  assert.equal(audit.provenance.target.sourceCommit, TARGET.sourceCommit);
  assert.equal(audit.provenance.target.signedTagObject, TARGET.signedTagObject);
  assert.equal(audit.provenance.source.sourceCommit, SOURCE.sourceCommit);
});

test("the migration evidence proves schema 16 to 17 and native recovery continuity", () => {
  assert.equal(migration.success, true);
  assert.equal(migration.checks.stateSchema16To17, true);
  assert.equal(migration.checks.agentSchema19, true);
  assert.equal(migration.checks.targetRuntime94, true);
  assert.equal(migration.checks.gatewayReconnect, true);
  assert.equal(migration.checks.recoveryIdempotent, true);
  assert.equal(migration.checks.noProductionMutation, true);
  assert.equal(migration.cleanup.disposableRootRemoved, true);
  assert.equal(migration.cleanup.gatewayProcessesStopped, true);
});

test("the contract diff helper reports removed fields and methods without false positives", () => {
  const diff = diffProtocolSchemas(
    { methods: { stable: { scope: "operator.read" }, removed: {} }, definitions: { Shape: { required: ["old"] } } },
    { methods: { stable: { scope: "operator.write" }, added: {} }, definitions: { Shape: { required: ["old", "new"] } } }
  );
  assert.deepEqual(diff.methodInventory.added, ["added"]);
  assert.deepEqual(diff.methodInventory.removed, ["removed"]);
  assert.deepEqual(diff.methodInventory.changed, ["stable"]);
  assert.deepEqual(diff.requiredFieldChanges, [{ name: "Shape", added: ["new"], removed: [] }]);
});
