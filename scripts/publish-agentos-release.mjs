import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repository = "SapienXai/AgentOS";

export async function sha256(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export async function verifyCliArchive(root, platform) {
  if (!/^(darwin-arm64|darwin-x64|linux-x64|win32-x64)$/.test(platform)) {
    throw new Error("Unknown CLI platform.");
  }
  const name = `agentos-${platform}.tgz`;
  const expected = (await readFile(path.join(root, `${name}.sha256`), "utf8")).trim();
  const digest = await sha256(path.join(root, name));
  if (expected !== `${digest}  ${name}`) throw new Error(`CLI checksum mismatch for ${name}.`);
  return digest;
}

export function selectChannels(plan, verified, windowsInstallerDigest) {
  const stableCli = plan.cli.filter((target) => verified.has(target));
  const desktop = plan.desktop.filter((item) => item.channel !== "withheld" && (!item.verifyInstaller || windowsInstallerDigest));
  return {
    stableCli,
    stableDesktop: desktop.filter((item) => item.channel === "stable"),
    previewDesktop: desktop.filter((item) => item.channel === "preview")
  };
}

function gh(args, options = {}) {
  return execFileSync("gh", args, { encoding: "utf8", ...options });
}

function checkReleaseTag(tag, commit) {
  const refs = execFileSync("git", ["ls-remote", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: "utf8" }).trim();
  const lines = refs ? refs.split("\n") : [];
  if (lines.length && lines.at(-1).split("\t")[0] !== commit) {
    throw new Error(`Existing tag ${tag} does not point to the certified commit.`);
  }
}

async function publishChannel({ tag, commit, title, notes, files, preview }) {
  if (!files.length) return;
  checkReleaseTag(tag, commit);
  const notesPath = path.join(path.dirname(files[0]), "release-notes.md");
  await writeFile(notesPath, notes);
  const existing = JSON.parse(gh(["release", "list", "--repo", repository, "--limit", "100", "--json", "tagName"]).trim())
    .some((release) => release.tagName === tag);
  if (existing) {
    const release = JSON.parse(gh(["release", "view", tag, "--repo", repository, "--json", "assets,isPrerelease,isDraft"]));
    const digests = new Map(release.assets.map((asset) => [asset.name, asset.digest]));
    const expected = await Promise.all(files.map(async (file) => [path.basename(file), `sha256:${await sha256(file)}`]));
    if (release.isDraft || release.isPrerelease !== preview || expected.length !== digests.size ||
        expected.some(([name, digest]) => digests.get(name) !== digest)) {
      throw new Error(`Existing release ${tag} differs from the verified publication plan.`);
    }
    console.log(`Verified already published release ${tag}.`);
    return;
  }
  gh(["release", "create", tag, ...files, "--repo", repository, "--target", commit, "--title", title, "--notes-file", notesPath,
    ...(preview ? ["--prerelease", "--latest=false"] : ["--latest"])], { stdio: "inherit" });
}

async function publish(plan, root, proofRoot) {
  const files = await readdir(proofRoot);
  const verified = new Map();
  for (const item of plan.cli) {
    const name = `cli-${item}.txt`;
    const digest = files.includes(name)
      ? (await readFile(path.join(proofRoot, name), "utf8")).trim()
      : plan.cliProofs[item];
    if (!digest) continue;
    if (digest !== await verifyCliArchive(root, item)) throw new Error(`CLI smoke proof does not match ${item}.`);
    verified.set(item, digest);
  }

  const windowsDigest = files.includes("windows-desktop.txt") ? (await readFile(path.join(proofRoot, "windows-desktop.txt"), "utf8")).trim() : null;
  const { stableCli, stableDesktop, previewDesktop } = selectChannels(plan, verified, windowsDigest);
  const stage = await mkdtemp(path.join(os.tmpdir(), "agentos-publish-"));
  try {
    const stableRoot = path.join(stage, "stable");
    const previewRoot = path.join(stage, "preview");
    await mkdir(stableRoot);
    await mkdir(previewRoot);
    const stableFiles = [];
    const previewFiles = [];
    const copy = async (name, destination, selection, source = root) => {
      const file = path.join(destination, name);
      if (!selection.includes(file)) {
        await copyFile(path.join(source, name), file);
        selection.push(file);
      }
    };
    const updaterKey = JSON.parse(await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8")).plugins.updater.pubkey;
    const publicKeyPath = path.join(stage, "updater.pub");
    const signaturePath = path.join(stage, "updater.minisig");
    await writeFile(publicKeyPath, Buffer.from(updaterKey, "base64"));
    const upstreamFeed = JSON.parse(await readFile(path.join(root, "latest.json"), "utf8"));
    if (upstreamFeed.version !== plan.version) throw new Error("Updater version does not match the certified release.");
    const stablePlatforms = {};
    for (const item of [...stableDesktop, ...previewDesktop]) {
      const entry = upstreamFeed.platforms[item.target];
      const expectedUrl = `https://github.com/${repository}/releases/download/agentos-v${plan.version}/${item.update}`;
      const signature = (await readFile(path.join(root, `${item.update}.sig`), "utf8")).trim();
      if (entry?.url !== expectedUrl || entry.signature !== signature) throw new Error(`Updater metadata mismatch for ${item.target}.`);
      if (item.verifyInstaller && windowsDigest !== await sha256(path.join(root, item.name))) {
        throw new Error("Windows installation proof does not match the candidate installer.");
      }
      await writeFile(signaturePath, Buffer.from(signature, "base64"));
      execFileSync("minisign", ["-Vm", path.join(root, item.update), "-p", publicKeyPath, "-x", signaturePath], { stdio: "inherit" });
      if (item.channel === "stable") {
        stablePlatforms[item.target] = entry;
        for (const name of [item.name, item.update, `${item.update}.sig`]) await copy(name, stableRoot, stableFiles);
      } else {
        await copy(item.name, previewRoot, previewFiles);
        if (item.name === item.update) await copy(`${item.update}.sig`, previewRoot, previewFiles);
      }
    }
    for (const target of stableCli) {
      await copy(`agentos-${target}.tgz`, stableRoot, stableFiles);
      await copy(`agentos-${target}.tgz.sha256`, stableRoot, stableFiles);
    }
    if (stableCli.some((target) => target !== "win32-x64")) await copy("install.sh", stableRoot, stableFiles, process.cwd());
    if (stableCli.includes("win32-x64")) await copy("install.ps1", stableRoot, stableFiles, process.cwd());
    if (Object.keys(stablePlatforms).length) {
      const feed = path.join(stableRoot, "latest.json");
      await writeFile(feed, JSON.stringify({ ...upstreamFeed, platforms: stablePlatforms }, null, 2) + "\n");
      stableFiles.push(feed);
    }
    if (previewFiles.length) {
      const checksumFile = path.join(previewRoot, "SHA256SUMS");
      await writeFile(checksumFile, (await Promise.all(previewFiles.map(async (file) => `${await sha256(file)}  ${path.basename(file)}`))).join("\n") + "\n");
      previewFiles.push(checksumFile);
    }
    const notes = await readFile(`docs/release-notes-agentos-${plan.version}.md`, "utf8");
    const list = (items) => items.map((file) => `- \`${path.basename(file)}\``).join("\n");
    const tag = `agentos-v${plan.version}`;
    if (!stableFiles.length && !previewFiles.length) throw new Error("No platform met its publication gate.");
    await publishChannel({ tag, commit: plan.commit, title: `AgentOS ${plan.version}`,
      notes: `${notes}\n## Published assets\n\n${list(stableFiles)}\n`, files: stableFiles, preview: false });
    await publishChannel({ tag: `${tag}-desktop-preview`, commit: plan.commit, title: `AgentOS ${plan.version} Desktop Public Preview`,
      notes: `# Desktop Public Preview\n\nThese installers are distributed manually. Production signing and Desktop update acceptance are pending. Windows Authenticode signing is unavailable. Preview assets are excluded from the stable Desktop updater feed.\n\n[Release notes](https://github.com/${repository}/releases/tag/${tag})\n\n${list(previewFiles)}\n`, files: previewFiles, preview: true });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [command, input, target, output] = process.argv.slice(2);
  if (command === "verify-cli") {
    const digest = await verifyCliArchive(input, target);
    if (output) await writeFile(output, digest + "\n");
  } else if (command === "publish") {
    await publish(JSON.parse(await readFile(input, "utf8")), target, output);
  } else {
    throw new Error("Use verify-cli or publish.");
  }
}
