import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readGatewayRuntimeRecords,
  writeGatewayRuntimeRecord
} from "@/lib/openclaw/application/gateway-event-store";
import type { RuntimeRecord } from "@/lib/openclaw/types";

test("concurrent Gateway event writes preserve the newest runtime record atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-gateway-event-store-"));

  try {
    await Promise.all([
      writeGatewayRuntimeRecord(root, runtimeRecord(100, "running")),
      writeGatewayRuntimeRecord(root, runtimeRecord(200, "completed")),
      writeGatewayRuntimeRecord(root, runtimeRecord(150, "queued"))
    ]);

    const records = await readGatewayRuntimeRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.updatedAt, 200);
    assert.equal(records[0]?.status, "completed");
    assert.deepEqual(await readdir(root), ["runtime-one.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runtimeRecord(updatedAt: number, status: RuntimeRecord["status"]): RuntimeRecord {
  return {
    id: "runtime/one",
    source: "session",
    key: "agent:worker:session-1",
    title: "Gateway runtime",
    subtitle: "OpenClaw event",
    status,
    updatedAt,
    ageMs: 0,
    metadata: {}
  };
}
