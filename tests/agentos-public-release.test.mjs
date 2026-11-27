import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { selectChannels, sha256, verifyCliArchive } from "../scripts/publish-agentos-release.mjs";

test("publication requires each platform's proof and separates desktop channels", () => {
  const windows = { target: "windows-x86_64-nsis", channel: "preview", verifyInstaller: true };
  const deb = { target: "linux-x86_64-deb", channel: "preview", verifyInstaller: true };
  const rpm = { target: "linux-x86_64-rpm", channel: "withheld" };
  const mac = { target: "darwin-aarch64-app", channel: "stable" };
  const plan = { cli: ["linux-x64", "win32-x64"], desktop: [windows, deb, rpm, mac] };
  const verifiedCli = new Set(["linux-x64"]);

  assert.deepEqual(selectChannels(plan, verifiedCli, new Map()), {
    stableCli: ["linux-x64"], stableDesktop: [mac], previewDesktop: []
  });
  const provenWindows = new Map([[windows.target, "installer proof"]]);
  assert.deepEqual(selectChannels(plan, verifiedCli, provenWindows).previewDesktop, [windows]);
  provenWindows.set(deb.target, "installer proof");
  assert.deepEqual(selectChannels(plan, verifiedCli, provenWindows).previewDesktop, [windows, deb]);
});

test("publication rejects an archive that differs from its SHA-256 sidecar", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentos-release-check-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const name = "agentos-linux-x64.tgz";
  const archive = path.join(directory, name);
  await writeFile(archive, "original");
  const digest = await sha256(archive);
  await writeFile(`${archive}.sha256`, `${digest}  ${name}\n`);
  assert.equal(await verifyCliArchive(directory, "linux-x64"), digest);
  await writeFile(archive, "tampered");
  await assert.rejects(verifyCliArchive(directory, "linux-x64"), /checksum mismatch/);
});
