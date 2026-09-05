import assert from "node:assert/strict";
import { test } from "node:test";

import {
  comparePinnedMethodScopes,
  parsePinnedCoreDescriptorScopes
} from "@/lib/openclaw/certification/upstream-scope";

const DESCRIPTORS = `
  ["health", "health", "operator.read", "<=2026.7"],
  ["update.status", "update", "operator.admin", "<=2026.7"],
`;

test("pinned descriptor parsing is independent from the AgentOS scope mirror", () => {
  const upstream = parsePinnedCoreDescriptorScopes(DESCRIPTORS, ["health", "update.status"]);

  assert.equal(comparePinnedMethodScopes({
    health: ["operator.read"],
    "update.status": ["operator.read"]
  }, upstream, ["health", "update.status"]), false);
  assert.equal(comparePinnedMethodScopes({
    health: ["operator.read"],
    "update.status": ["operator.admin"]
  }, upstream, ["health", "update.status"]), true);
});

test("ambiguous or missing pinned descriptor rows fail closed", () => {
  assert.throws(
    () => parsePinnedCoreDescriptorScopes(`${DESCRIPTORS}\n  ["update.status", "update", "operator.admin", "<=2026.7"],`, ["update.status"]),
    /missing or ambiguous/
  );
  assert.throws(
    () => parsePinnedCoreDescriptorScopes(DESCRIPTORS, ["gateway.restart.request"]),
    /missing or ambiguous/
  );
});
