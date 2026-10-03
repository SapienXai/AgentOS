import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareStableVersions,
  discoverLatestAgentOsVersion,
  fetchGithubLatest,
  fetchRegistryLatest,
  normalizeStableVersion,
  updateCacheIdentity
} from "@/packages/agentos/bin/update.js";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("stable version comparison accepts only complete versions and never offers equal or older targets", () => {
  assert.equal(normalizeStableVersion("0.8.1"), "0.8.1");
  assert.equal(normalizeStableVersion("v0.8.1"), null);
  assert.equal(normalizeStableVersion("0.8.1-rc.1"), null);
  assert.equal(normalizeStableVersion("0.8"), null);
  assert.equal(compareStableVersions("0.8.2", "0.8.1"), 1);
  assert.equal(compareStableVersions("0.8.1", "0.8.1"), 0);
  assert.equal(compareStableVersions("0.8.0", "0.8.1"), -1);
  assert.equal(compareStableVersions("0.8.1-rc.1", "0.8.0"), null);
  assert.equal(updateCacheIdentity({ owner: "desktop", currentVersion: "0.8.1", sourceId: "github:test/repo" }), "desktop:0.8.1:github:test/repo");
});

test("GitHub discovery requires the official stable tag and reports missing CLI platform assets", async () => {
  const release = {
    tag_name: "agentos-v0.9.0",
    draft: false,
    prerelease: false,
    assets: [{ name: "agentos-darwin-arm64.tgz" }]
  };
  const fetchImpl = async () => jsonResponse(release);
  const found = await discoverLatestAgentOsVersion({
    owner: "release-launcher",
    currentVersion: "0.8.0",
    platform: "linux",
    arch: "x64",
    fetchImpl
  });

  assert.equal(found.latestVersion, "0.9.0");
  assert.equal(found.newer, true);
  assert.equal(found.expectedAsset?.available, false);
  assert.equal(found.releaseUrl, "https://github.com/SapienXai/AgentOS/releases/tag/agentos-v0.9.0");
  await assert.rejects(
    () => fetchGithubLatest({ fetchImpl: async () => jsonResponse({ ...release, tag_name: "agentos-v0.9.0-rc.1", prerelease: true }) }),
    /stable AgentOS release/
  );
});

test("npm metadata rejects prereleases and non-version payloads", async () => {
  await assert.rejects(
    () => fetchRegistryLatest({ fetchImpl: async () => jsonResponse({ version: "0.9.0-beta.1" }) }),
    /stable version/
  );
  await assert.rejects(
    () => fetchRegistryLatest({ fetchImpl: async () => jsonResponse({ version: "latest" }) }),
    /stable version/
  );
});

test("update discovery bounds metadata size and honors its deadline", async () => {
  await assert.rejects(
    () => fetchGithubLatest({ fetchImpl: async () => new Response("x".repeat(300_000), { headers: { "Content-Length": "300000" } }) }),
    /exceeds the allowed size/
  );
  await assert.rejects(
    () => fetchGithubLatest({
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      })
    }),
    /aborted/
  );
});
