import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { finalizeReleaseAssets } from "@/scripts/desktop/finalize-release-assets.mjs";

test("release finalization validates complete CLI and signed Desktop assets before writing the feed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-release-assets-"));
  const stableNow = new Date("2026-10-03T12:00:00.000Z");
  try {
    await writeCliAssets(root);
    await writeSigned(root, "macos", "AgentOS.app.tar.gz", "mac bundle");
    await mkdir(path.join(root, "dmg"), { recursive: true });
    await writeFile(path.join(root, "dmg", "AgentOS_0.8.1_aarch64.dmg"), "mac installer");
    await writeSigned(root, "nsis", "AgentOS_0.8.1_x64-setup.exe", "windows installer");
    await writeSigned(root, "appimage", "AgentOS_0.8.1_amd64.AppImage", "linux appimage");
    await writeSigned(root, "deb", "AgentOS_0.8.1_amd64.deb", "linux deb");
    await writeSigned(root, "rpm", "AgentOS-0.8.1-1.x86_64.rpm", "linux rpm");

    const result = await finalizeReleaseAssets({ root, version: "0.8.1", now: stableNow });
    const latest = JSON.parse(await readFile(path.join(root, "latest.json"), "utf8")) as {
      version: string;
      pub_date: string;
      platforms: Record<string, { url: string; signature: string }>;
    };

    assert.equal(latest.version, "0.8.1");
    assert.equal(latest.pub_date, stableNow.toISOString());
    assert.deepEqual(Object.keys(latest.platforms).sort(), [
      "darwin-aarch64-app",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-x86_64-nsis"
    ]);
    assert.equal(latest.platforms["darwin-aarch64-app"].url, "https://github.com/SapienXai/AgentOS/releases/download/agentos-v0.8.1/AgentOS-0.8.1-macos-arm64.app.tar.gz");
    assert.match(latest.platforms["linux-x86_64-deb"].signature, /signed-release-artifact/);
    assert.ok(result.assets.includes("agentos-darwin-arm64.tgz.sha256"));
    assert.ok(result.assets.includes("AgentOS-0.8.1-linux-x64.rpm.sig"));
    assert.equal((await readFile(path.join(root, "agentos-linux-x64.tgz"), "utf8")).trim(), "linux cli archive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release finalization rejects missing signed platform artifacts and prerelease targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-release-assets-incomplete-"));
  try {
    await writeCliAssets(root);
    await assert.rejects(
      () => finalizeReleaseAssets({ root, version: "0.8.1-rc.1" }),
      /stable semantic version/
    );
    await assert.rejects(
      () => finalizeReleaseAssets({ root, version: "0.8.1" }),
      /Desktop updater bundle for darwin-aarch64-app/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeCliAssets(root: string) {
  for (const name of [
    "agentos-darwin-arm64.tgz",
    "agentos-darwin-x64.tgz",
    "agentos-linux-x64.tgz",
    "agentos-win32-x64.tgz"
  ]) {
    const contents = `${name === "agentos-linux-x64.tgz" ? "linux cli archive" : name}\n`;
    await writeFile(path.join(root, name), contents);
    const digest = createHash("sha256").update(contents).digest("hex");
    await writeFile(path.join(root, `${name}.sha256`), `${digest}  ${name}\n`);
  }
}

async function writeSigned(root: string, directory: string, name: string, contents: string) {
  const bundleDirectory = path.join(root, directory);
  await mkdir(bundleDirectory, { recursive: true });
  await writeFile(path.join(bundleDirectory, name), contents);
  await writeFile(path.join(bundleDirectory, `${name}.sig`), `signed-release-artifact-${contents}\n`);
}
