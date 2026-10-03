import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeExecutableName, resolveTargetPlatform } from "./runtime.mjs";
import { auditTree } from "./audit.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const configPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");
const capabilityPath = path.join(desktopRoot, "src-tauri", "capabilities", "default.json");
const cargoPath = path.join(desktopRoot, "src-tauri", "Cargo.toml");
const buildPath = path.join(desktopRoot, "src-tauri", "build.rs");
const packagePath = path.join(repoRoot, "packages", "agentos", "package.json");
const targetPlatform = resolveTargetPlatform();
const nodeBinaryPath = targetPlatform === "win32"
  ? path.join(runtimeRoot, "node", nodeExecutableName(targetPlatform))
  : path.join(runtimeRoot, "node", "bin", nodeExecutableName(targetPlatform));

const config = JSON.parse(await readFile(configPath, "utf8"));
const capabilities = JSON.parse(await readFile(capabilityPath, "utf8"));
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const cargoManifest = await readFile(cargoPath, "utf8");
const buildManifest = await readFile(buildPath, "utf8");
const bootstrapHtml = await readFile(path.join(desktopRoot, "bootstrap", "index.html"), "utf8");
if (!bootstrapHtml.includes("agentos-splash.mp4") || bootstrapHtml.includes("pikoLoader")) {
  throw new Error("Desktop bootstrap must use the AgentOS splash video and must not reference Piko loader assets.");
}
const runtimeMetadata = JSON.parse(await readFile(path.join(runtimeRoot, "metadata.json"), "utf8"));
const requiredPaths = [
  path.join(desktopRoot, "bootstrap", "index.html"),
  path.join(desktopRoot, "bootstrap", "assets", "agentos-splash.mp4"),
  path.join(desktopRoot, "bootstrap", "assets", "agentos-splash-poster.jpg"),
  path.join(desktopRoot, "bootstrap", "assets", "logo.webp"),
  path.join(desktopRoot, "src-tauri", "Cargo.toml"),
  path.join(desktopRoot, "src-tauri", "src", "main.rs"),
  path.join(runtimeRoot, "agentos", "server.js"),
  path.join(runtimeRoot, "agentos", "agentos-desktop-server.cjs"),
  path.join(runtimeRoot, "agentos", "agentos-build.json"),
  path.join(runtimeRoot, "agentos", ".next", "static"),
  path.join(runtimeRoot, "agentos", "public"),
  nodeBinaryPath
];

for (const filePath of requiredPaths) {
  await access(filePath).catch(() => {
    throw new Error(`Desktop runtime is incomplete; missing ${filePath}. Run pnpm desktop:prepare first.`);
  });
}

const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1];
if (!cargoVersion || cargoVersion !== packageMetadata.version || config.version !== packageMetadata.version) {
  throw new Error(
    `Desktop version drift detected: package=${packageMetadata.version}, Cargo=${cargoVersion ?? "missing"}, Tauri=${config.version ?? "missing"}.`
  );
}

const packagedAgentOsBuild = JSON.parse(await readFile(path.join(runtimeRoot, "agentos", "agentos-build.json"), "utf8"));
if (
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(packageMetadata.version)
  || packagedAgentOsBuild.version !== packageMetadata.version
  || runtimeMetadata.agentosVersion !== packageMetadata.version
) {
  throw new Error(
    `Desktop AgentOS build metadata is missing or stale: package=${packageMetadata.version}, payload=${packagedAgentOsBuild.version ?? "missing"}, runtime=${runtimeMetadata.agentosVersion ?? "missing"}.`
  );
}

if (runtimeMetadata.nodeSource === "official" && !/^[0-9a-f]{64}$/i.test(runtimeMetadata.nodeSha256 ?? "")) {
  throw new Error("Official packaged Node runtime is missing its verified SHA-256 metadata.");
}

const permissions = config.app?.security?.permissions ?? config.app?.security?.capabilities ?? [];
if (JSON.stringify(permissions).match(/shell|fs|process/i)) {
  throw new Error("Desktop security configuration must not grant shell, filesystem, or process permissions to the WebView.");
}

const allowedCapabilityPermissions = [
  "core:window:allow-start-dragging",
  "core:window:allow-internal-toggle-maximize"
];
if (
  !Array.isArray(capabilities.permissions)
  || JSON.stringify(capabilities.permissions) !== JSON.stringify(allowedCapabilityPermissions)
) {
  throw new Error(
    "The AgentOS desktop WebView may only keep the native window interaction permissions enabled."
  );
}

for (const command of ["open_external_auth_url", "check_agentos_update", "install_agentos_update"]) {
  if (!buildManifest.includes(`"${command}"`)) {
    throw new Error(`Desktop application command ${command} is missing from the generated-command manifest.`);
  }
}
if (!buildManifest.includes("tauri_build::AppManifest::new().commands") || !buildManifest.includes("tauri_build::Attributes::new().app_manifest")) {
  throw new Error("Desktop native commands must be explicitly permissioned through the Tauri application manifest.");
}

const mainSource = await readFile(path.join(desktopRoot, "src-tauri", "src", "main.rs"), "utf8");
for (const required of [
  '.windows(["main"])',
  '.remote(format!("http://127.0.0.1:{port}/*"))',
  '.permission("allow-check-agentos-update")',
  '.permission("allow-install-agentos-update")'
]) {
  if (!mainSource.includes(required)) throw new Error(`Desktop update capability is missing its narrow scope: ${required}`);
}
if (mainSource.match(/\.permission\("(?:updater|shell|fs|process):/)) {
  throw new Error("Desktop update capability must not grant broad updater, shell, filesystem, or process permissions.");
}

await auditTree(runtimeRoot);

if (config.bundle?.createUpdaterArtifacts !== true) {
  throw new Error("Production desktop configuration must generate signed updater artifacts.");
}

if (!config.plugins?.updater?.pubkey || !config.plugins?.updater?.endpoints?.some((endpoint) => endpoint.includes("latest.json"))) {
  throw new Error("Updater configuration must contain a public key and the release latest.json endpoint.");
}

if (!JSON.stringify(config.bundle?.resources ?? {}).includes("agentos-runtime")) {
  throw new Error("Tauri resources do not include the packaged AgentOS runtime.");
}

console.log("Desktop shell checks passed: bootstrap, standalone payload, Node runtime, and least-privilege configuration are present.");
