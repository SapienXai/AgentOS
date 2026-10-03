import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AgentOsProductUpdateReceipt } from "@/lib/agentos/domains/product-update";
import {
  AgentOsProductUpdateStoreError,
  prepareAgentOsUpdateReceipt,
  readCurrentAgentOsUpdateReceipt,
  writeAgentOsUpdateReceipt
} from "@/lib/agentos/application/product-update-store";

function createReceipt(overrides: Partial<AgentOsProductUpdateReceipt> = {}): AgentOsProductUpdateReceipt {
  const now = new Date();
  return {
    schemaVersion: 1,
    operationId: "4a68d3dc-0105-4ec1-9884-d0daaa2e7355",
    requestId: "89b6c46b-5a3f-4bf2-9d1c-3e628e66dcfd",
    actorId: "operator:agentos-desktop",
    authenticationMethod: "desktop-token",
    owner: "desktop",
    launchId: "0490a3c0-8fb7-4ef7-89ea-5363212e35ba",
    currentVersion: "0.8.0",
    targetVersion: "0.9.0",
    nativeCheckId: "72a5f86f-83a2-4e0c-a3f2-7eb76fb675a5",
    releaseIdentity: "a".repeat(64),
    state: "requested",
    phase: "checking",
    progress: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    failure: null,
    newLaunchId: null,
    nativeVersion: null,
    serverVersion: null,
    verification: "pending",
    ...overrides
  };
}

test("update receipts are durably prepared once and the active pointer resolves their private state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-update-store-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: root };
  const receipt = createReceipt();

  try {
    const prepared = await prepareAgentOsUpdateReceipt(receipt, env);
    assert.equal(prepared.operationId, receipt.operationId);
    assert.deepEqual(await readCurrentAgentOsUpdateReceipt(env), receipt);
    await assert.rejects(
      () => prepareAgentOsUpdateReceipt(createReceipt({
        operationId: "647f9fe3-025c-4c96-95a7-813b73f9483d",
        requestId: "3a35758f-6aa4-4b65-80d5-44c6a989cb12"
      }), env),
      (error: unknown) => error instanceof AgentOsProductUpdateStoreError && error.code === "conflict"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("request IDs remain consumed after a terminal operation and cannot replay", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-update-replay-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: root };
  const receipt = createReceipt();

  try {
    await prepareAgentOsUpdateReceipt(receipt, env);
    await writeAgentOsUpdateReceipt({ ...receipt, state: "failed", phase: "verify", verification: "unknown" }, env);
    await assert.rejects(
      () => prepareAgentOsUpdateReceipt(createReceipt({ operationId: "647f9fe3-025c-4c96-95a7-813b73f9483d" }), env),
      (error: unknown) => error instanceof AgentOsProductUpdateStoreError && error.code === "replay"
    );
    await assert.rejects(
      () => prepareAgentOsUpdateReceipt(createReceipt({ operationId: "647f9fe3-025c-4c96-95a7-813b73f9483d" }), env),
      (error: unknown) => error instanceof AgentOsProductUpdateStoreError && error.code === "replay"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update store rejects a symbolic-link updates root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-update-symlink-"));
  const runtime = path.join(root, "runtime");
  const outside = path.join(root, "outside");
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtime };

  try {
    await mkdir(outside, { recursive: true });
    await mkdir(runtime, { recursive: true });
    await symlink(outside, path.join(runtime, "updates"));
    await assert.rejects(
      () => prepareAgentOsUpdateReceipt(createReceipt(), env),
      (error: unknown) => error instanceof AgentOsProductUpdateStoreError && error.code === "unavailable"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
