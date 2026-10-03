import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CLI_ASSETS = [
  "agentos-darwin-arm64.tgz",
  "agentos-darwin-x64.tgz",
  "agentos-linux-x64.tgz",
  "agentos-win32-x64.tgz"
];

const DESKTOP_ARTIFACTS = [
  { target: "darwin-aarch64-app", directory: "macos", extension: ".app.tar.gz", output: "macos-arm64.app.tar.gz", signature: true },
  { target: "windows-x86_64-nsis", directory: "nsis", extension: ".exe", output: "windows-x64-setup.exe", signature: true, predicate: (name) => /setup\.exe$/i.test(name) },
  { target: "linux-x86_64-appimage", directory: "appimage", extension: ".AppImage", output: "linux-x64.AppImage", signature: true },
  { target: "linux-x86_64-deb", directory: "deb", extension: ".deb", output: "linux-x64.deb", signature: true },
  { target: "linux-x86_64-rpm", directory: "rpm", extension: ".rpm", output: "linux-x64.rpm", signature: true }
];

export async function finalizeReleaseAssets({ root, version, now = new Date() }) {
  if (!isStableVersion(version)) throw new Error(`Release version must be a stable semantic version: ${version}`);
  const releaseRoot = path.resolve(root);
  const entries = await walkFiles(releaseRoot);
  const byName = new Map();
  for (const entry of entries) {
    const names = byName.get(entry.name) ?? [];
    names.push(entry);
    byName.set(entry.name, names);
  }

  const outputNames = new Set();
  const desktopOutputMap = new Map();
  for (const name of CLI_ASSETS) {
    const tarball = requireUnique(byName.get(name) ?? [], `CLI release archive ${name}`);
    const checksum = requireUnique(byName.get(`${name}.sha256`) ?? [], `CLI checksum ${name}.sha256`);
    const expected = (await readFile(checksum.path, "utf8")).trim();
    const digest = createHash("sha256").update(await readFile(tarball.path)).digest("hex");
    if (expected !== `${digest}  ${name}`) throw new Error(`CLI checksum does not match ${name}.`);
    outputNames.add(name);
    outputNames.add(`${name}.sha256`);
    desktopOutputMap.set(name, tarball.path);
    desktopOutputMap.set(`${name}.sha256`, checksum.path);
  }

  const platforms = {};
  for (const artifact of DESKTOP_ARTIFACTS) {
    const candidates = entries.filter((entry) =>
      entry.relative.split(path.sep).includes(artifact.directory)
      && entry.name.toLowerCase().endsWith(artifact.extension.toLowerCase())
      && (!artifact.predicate || artifact.predicate(entry.name))
      && !entry.name.endsWith(".sig")
    );
    const bundle = requireUnique(candidates, `Desktop updater bundle for ${artifact.target}`);
    let signature = null;
    if (artifact.signature) {
      signature = requireUnique(byName.get(`${bundle.name}.sig`) ?? [], `signature for ${bundle.name}`);
      const signatureText = (await readFile(signature.path, "utf8")).trim();
      if (signatureText.length < 16 || signatureText.length > 16_384) {
        throw new Error(`Desktop updater signature for ${bundle.name} is empty or too large.`);
      }
    }

    const outputName = `AgentOS-${version}-${artifact.output}`;
    outputNames.add(outputName);
    if (signature) outputNames.add(`${outputName}.sig`);
    platforms[artifact.target] = {
      url: `https://github.com/SapienXai/AgentOS/releases/download/agentos-v${version}/${outputName}`,
      signature: signature ? (await readFile(signature.path, "utf8")).trim() : ""
    };
    desktopOutputMap.set(outputName, bundle.path);
    if (signature) desktopOutputMap.set(`${outputName}.sig`, signature.path);
  }

  const installerArtifacts = [
    { directory: "dmg", extension: ".dmg", output: `AgentOS-${version}-macos-arm64.dmg` },
    { directory: "nsis", extension: ".exe", output: `AgentOS-${version}-windows-x64-setup.exe`, predicate: (name) => /setup\.exe$/i.test(name) },
    { directory: "appimage", extension: ".AppImage", output: `AgentOS-${version}-linux-x64.AppImage` },
    { directory: "deb", extension: ".deb", output: `AgentOS-${version}-linux-x64.deb` },
    { directory: "rpm", extension: ".rpm", output: `AgentOS-${version}-linux-x64.rpm` }
  ];
  for (const artifact of installerArtifacts) {
    const candidates = entries.filter((entry) =>
      entry.relative.split(path.sep).includes(artifact.directory)
      && entry.name.toLowerCase().endsWith(artifact.extension.toLowerCase())
      && (!artifact.predicate || artifact.predicate(entry.name))
      && !entry.name.endsWith(".sig")
    );
    const source = requireUnique(candidates, `Desktop installer ${artifact.output}`);
    outputNames.add(artifact.output);
    desktopOutputMap.set(artifact.output, source.path);
  }

  const latest = {
    version,
    notes: `AgentOS Desktop ${version}`,
    pub_date: now.toISOString(),
    platforms
  };
  outputNames.add("latest.json");

  for (const [name, source] of desktopOutputMap) {
    const destination = path.join(releaseRoot, name);
    if (path.resolve(source) !== path.resolve(destination)) await copyFile(source, destination);
  }
  await writeFile(path.join(releaseRoot, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`, { mode: 0o644 });
  return { latest, assets: [...outputNames].sort() };
}

async function walkFiles(root) {
  const result = [];
  const visit = async (directory, relative) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Release artifacts may not contain symbolic links: ${childRelative}`);
      if (entry.isDirectory()) {
        await visit(absolute, childRelative);
      } else if (entry.isFile()) {
        result.push({ name: entry.name, path: absolute, relative: childRelative });
      }
    }
  };
  await visit(root, "");
  return result;
}

function requireUnique(values, label) {
  if (values.length !== 1) throw new Error(`Expected exactly one ${label}; found ${values.length}.`);
  return values[0];
}

function isStableVersion(value) {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const versionIndex = args.indexOf("--version");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : null;
  const version = versionIndex >= 0 ? args[versionIndex + 1] : null;
  if (!root || !version) throw new Error("Usage: node finalize-release-assets.mjs --root <artifact-directory> --version <stable-version>");
  const result = await finalizeReleaseAssets({ root, version });
  console.log(`Finalized AgentOS ${version} release assets (${result.assets.length} files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Release asset validation failed.");
    process.exitCode = 1;
  });
}
