import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  isSupportedAgentOsNodeVersion,
  MINIMUM_AGENTOS_NODE_VERSION,
  RECOMMENDED_AGENTOS_NODE_VERSION
} from "../packages/agentos/bin/node-runtime.js";

test("AgentOS accepts only patched Node 24 and Node 26 runtime floors", () => {
  assert.equal(MINIMUM_AGENTOS_NODE_VERSION, "24.22.1");
  assert.equal(RECOMMENDED_AGENTOS_NODE_VERSION, "26.12.1");
  assert.equal(isSupportedAgentOsNodeVersion("24.22.1"), true);
  assert.equal(isSupportedAgentOsNodeVersion("24.22.0"), false);
  assert.equal(isSupportedAgentOsNodeVersion("26.12.1"), true);
  assert.equal(isSupportedAgentOsNodeVersion("26.12.0"), false);
  assert.equal(isSupportedAgentOsNodeVersion("25.9.9"), false);
  assert.equal(isSupportedAgentOsNodeVersion("27.0.0"), true);
});

test("supported Node SQLite runtimes round-trip text after embedded NUL bytes", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE runtime_text (value TEXT NOT NULL)");
    const value = "before\u0000after";
    database.prepare("INSERT INTO runtime_text (value) VALUES (?)").run(value);
    assert.equal(database.prepare("SELECT value FROM runtime_text").get().value, value);
  } finally {
    database.close();
  }
});
