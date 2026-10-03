import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getAgentOsProductUpdateSnapshot } from "@/lib/agentos/application/product-update-service";
import { writeProductUpdateDiscoveryCache } from "@/lib/agentos/application/product-update-store";
import { prepareAgentOsRuntimeStorage } from "@/lib/agentos/runtime-storage";

function githubResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

function makeEnv(runtimeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    AGENTOS_PACKAGE_RUNTIME: "1",
    AGENTOS_LAUNCHER_PID: "1234",
    AGENTOS_INSTALLATION_OWNER: "release-launcher"
  };
}

test("release launcher reports missing platform archives without advertising browser installation", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-update-release-"));
  const originalFetch = globalThis.fetch;
  const env = makeEnv(runtimeDir);
  globalThis.fetch = async () => githubResponse({
    tag_name: "agentos-v0.9.0",
    draft: false,
    prerelease: false,
    assets: [{ name: "agentos-darwin-arm64.tgz" }]
  });

  try {
    const snapshot = await getAgentOsProductUpdateSnapshot({
      canManageUpdates: true,
      forceRefresh: true,
      env,
      platform: "linux"
    });
    assert.equal(snapshot.owner, "release-launcher");
    assert.equal(snapshot.availability, "available");
    assert.equal(snapshot.cliAssetAvailable, false);
    assert.equal(snapshot.canInstall, false);
    assert.equal(snapshot.action, "release-guidance");
    assert.match(snapshot.ownerReason, /CLI archive.*missing.*automatic application handoff is unavailable/i);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("failed refresh retains stale release evidence and marks the check unavailable", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-update-stale-"));
  const env = makeEnv(runtimeDir);
  await writeProductUpdateDiscoveryCache({
    schemaVersion: 1,
    cacheKey: "release-launcher:0.8.0:github:SapienXai/AgentOS",
    sourceId: "github:SapienXai/AgentOS",
    currentVersion: "0.8.0",
    latestVersion: "0.9.0",
    releaseUrl: "https://github.com/SapienXai/AgentOS/releases/tag/agentos-v0.9.0",
    cliAssetAvailable: false,
    checkedAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString()
  }, env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  try {
    const snapshot = await getAgentOsProductUpdateSnapshot({
      canManageUpdates: true,
      forceRefresh: true,
      env,
      platform: "linux"
    });
    assert.equal(snapshot.latestVersion, "0.9.0");
    assert.equal(snapshot.availability, "available");
    assert.equal(snapshot.evidence, "stale");
    assert.match(snapshot.checkError ?? "", /could not be checked/i);
    assert.equal(snapshot.cliAssetAvailable, false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("Railway ownership takes precedence over package layout and update requests stay owner-bound", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-update-railway-"));
  const env = {
    ...makeEnv(runtimeDir),
    AGENTOS_DEPLOYMENT_PLATFORM: "railway"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => githubResponse({
    tag_name: "agentos-v0.9.0",
    draft: false,
    prerelease: false,
    assets: []
  });

  try {
    const snapshot = await getAgentOsProductUpdateSnapshot({
      canManageUpdates: true,
      forceRefresh: true,
      env,
      platform: "linux"
    });
    assert.equal(snapshot.owner, "deployment");
    assert.equal(snapshot.action, "deployment-guidance");
    assert.equal(snapshot.canInstall, false);
    assert.match(snapshot.ownerReason, /deployment platform owns this application image/i);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("Desktop installation requires fresh native evidence bound to the embedded server version", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-update-desktop-"));
  const launchId = "00000000-0000-4000-8000-000000000011";
  const env = {
    ...makeEnv(runtimeDir),
    AGENTOS_DESKTOP: "1",
    AGENTOS_DESKTOP_BUNDLE: "macos",
    AGENTOS_DESKTOP_LAUNCH_ID: launchId,
    AGENTOS_DESKTOP_VERSION: "0.8.0"
  };
  await prepareAgentOsRuntimeStorage({ env, cwd: runtimeDir });
  const updatesDir = path.join(runtimeDir, "updates");
  await mkdir(updatesDir, { recursive: true, mode: 0o700 });
  const nativeCheck = {
    schemaVersion: 1,
    checkId: "00000000-0000-4000-8000-000000000012",
    launchId,
    currentVersion: "0.8.0",
    latestVersion: "0.9.0",
    updateAvailable: true,
    releaseIdentity: "a".repeat(64),
    checkedAt: new Date().toISOString(),
    status: "available",
    error: null
  };
  await writeFile(path.join(updatesDir, "native-check.json"), `${JSON.stringify(nativeCheck)}\n`, { mode: 0o600 });

  try {
    const ready = await getAgentOsProductUpdateSnapshot({ canManageUpdates: true, env, platform: "darwin" });
    assert.equal(ready.owner, "desktop");
    assert.equal(ready.availability, "available");
    assert.equal(ready.canInstall, true);

    await writeFile(path.join(updatesDir, "native-check.json"), `${JSON.stringify({ ...nativeCheck, currentVersion: "0.7.9" })}\n`, { mode: 0o600 });
    const mismatch = await getAgentOsProductUpdateSnapshot({ canManageUpdates: true, env, platform: "darwin" });
    assert.equal(mismatch.availability, "unavailable");
    assert.equal(mismatch.evidence, "unavailable");
    assert.equal(mismatch.canInstall, false);
    assert.match(mismatch.checkError ?? "", /versions do not match/i);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
