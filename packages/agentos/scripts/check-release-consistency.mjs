#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultRepoRoot = path.resolve(scriptDir, "..", "..", "..");

const AGENTOS_PACKAGE_NAME = "@sapienx/agentos";
const AGENTOS_PACKAGE_DIR = "packages/agentos";
const AGENTOS_PACKAGE_JSON = `${AGENTOS_PACKAGE_DIR}/package.json`;
const AGENTOS_BIN_ENTRY = "bin/agentos.js";
const CHECK_SCRIPT = `${AGENTOS_PACKAGE_DIR}/scripts/check-release-consistency.mjs`;
const RELEASE_TAG_PREFIX = "agentos-v";
const INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.sh | bash";
const WINDOWS_INSTALL_COMMAND = "iwr https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.ps1 | iex";
const REQUIRED_NODE_ENGINE = ">=24.0.0";
const REQUIRED_NODE_MAJOR = "24";
const RELEASE_ASSETS = [
  "agentos-darwin-arm64.tgz",
  "agentos-darwin-x64.tgz",
  "agentos-linux-x64.tgz",
  "agentos-win32-x64.tgz"
];

const SEMVER_SOURCE = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const SEMVER_PATTERN = new RegExp(`^${SEMVER_SOURCE}$`);

export function checkReleaseConsistency(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : defaultRepoRoot;
  const overrides = normalizeOverrides(options.overrides);
  const context = {
    repoRoot,
    overrides,
    issues: [],
    notes: []
  };

  const rootPackage = readJson(context, "package.json");
  const agentosPackage = readJson(context, AGENTOS_PACKAGE_JSON);
  const readme = readText(context, "README.md");
  const packageReadme = readText(context, `${AGENTOS_PACKAGE_DIR}/README.md`);
  const installSh = readText(context, "install.sh");
  const installPs1 = readText(context, "install.ps1");
  const ciWorkflow = readText(context, ".github/workflows/ci.yml");
  const workflow = readText(context, ".github/workflows/release-agentos.yml");
  const launcher = readText(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`);
  const prepareBundle = readText(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`);
  const runPrepack = readText(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`);

  if (!rootPackage || !agentosPackage) {
    return buildResult(context, agentosPackage);
  }

  validateRootPackage(context, rootPackage, agentosPackage);
  validateAgentosPackage(context, agentosPackage);
  validateLauncher(context, launcher, agentosPackage);
  validateInstallers(context, installSh, installPs1);
  validateReadmes(context, readme, packageReadme, agentosPackage);
  validateBuildScripts(context, rootPackage, agentosPackage, prepareBundle, runPrepack);
  validateCiWorkflow(context, ciWorkflow);
  validateReleaseWorkflow(context, workflow, agentosPackage);

  return buildResult(context, agentosPackage);
}

export function formatReleaseConsistencyResult(result) {
  if (result.ok) {
    const lines = [`AgentOS release consistency check passed for ${result.packageName}@${result.version}.`];

    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }

    return lines.join("\n");
  }

  return [
    "AgentOS release consistency check failed:",
    ...result.issues.map((issue) => `- ${issue.file}: ${issue.message}`)
  ].join("\n");
}

function validateRootPackage(context, rootPackage, agentosPackage) {
  if (rootPackage.private !== true) {
    addIssue(context, "package.json", "Root package must remain private because published release metadata lives in packages/agentos/package.json.");
  }

  expectEqual(context, "package.json", "engines.node", rootPackage.engines?.node, REQUIRED_NODE_ENGINE);

  if (rootPackage.version !== agentosPackage.version) {
    if (rootPackage.private === true) {
      context.notes.push(
        `Root package is private (${rootPackage.name}@${rootPackage.version}); published CLI version source is ${AGENTOS_PACKAGE_JSON} (${agentosPackage.version}).`
      );
    } else {
      addIssue(
        context,
        "package.json",
        `Root package version ${rootPackage.version} differs from published ${AGENTOS_PACKAGE_NAME} version ${agentosPackage.version}, but the root package is not private.`
      );
    }
  }
}

function validateAgentosPackage(context, agentosPackage) {
  expectEqual(context, AGENTOS_PACKAGE_JSON, "name", agentosPackage.name, AGENTOS_PACKAGE_NAME);

  if (!isSemver(agentosPackage.version)) {
    addIssue(context, AGENTOS_PACKAGE_JSON, `version must be a valid semver string; found ${JSON.stringify(agentosPackage.version)}.`);
  }

  expectEqual(context, AGENTOS_PACKAGE_JSON, "type", agentosPackage.type, "module");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "license", agentosPackage.license, "MIT");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "bin.agentos", agentosPackage.bin?.agentos, AGENTOS_BIN_ENTRY);
  expectEqual(context, AGENTOS_PACKAGE_JSON, "engines.node", agentosPackage.engines?.node, REQUIRED_NODE_ENGINE);
  expectEqual(context, AGENTOS_PACKAGE_JSON, "publishConfig.access", agentosPackage.publishConfig?.access, "public");

  for (const fileEntry of ["README.md", "bin", "bundle"]) {
    if (!Array.isArray(agentosPackage.files) || !agentosPackage.files.includes(fileEntry)) {
      addIssue(context, AGENTOS_PACKAGE_JSON, `files must include ${JSON.stringify(fileEntry)} for the published package.`);
    }
  }

  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.check:release",
    agentosPackage.scripts?.["check:release"],
    "node scripts/check-release-consistency.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepare:bundle",
    agentosPackage.scripts?.["prepare:bundle"],
    "node scripts/prepare-bundle.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepack",
    agentosPackage.scripts?.prepack,
    "node scripts/check-release-consistency.mjs && node scripts/run-prepack.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepublishOnly",
    agentosPackage.scripts?.prepublishOnly,
    "node scripts/check-release-consistency.mjs"
  );
}

function validateLauncher(context, launcher, agentosPackage) {
  if (!launcher) {
    return;
  }

  expectFileExists(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`);
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "#!/usr/bin/env node");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, 'const packageJsonPath = path.join(packageRoot, "package.json");');
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "console.log(packageJson.version);");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "${packageJson.name}@${packageJson.version}");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "registry.npmjs.org");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "releases/download/agentos-v${latestVersion}");

  if (launcher.includes(`${AGENTOS_PACKAGE_NAME}@${agentosPackage.version}`)) {
    addIssue(
      context,
      `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`,
      "Launcher must read package name/version from package.json instead of hard-coding the current published version."
    );
  }
}

function validateInstallers(context, installSh, installPs1) {
  if (installSh) {
    expectIncludes(context, "install.sh", installSh, 'REQUESTED_VERSION="${AGENTOS_VERSION:-latest}"');
    expectIncludes(context, "install.sh", installSh, 'RELEASE_PATH="latest/download"');
    expectIncludes(context, "install.sh", installSh, 'RELEASE_PATH="download/agentos-v${REQUESTED_VERSION}"');
    expectIncludes(context, "install.sh", installSh, 'ARTIFACT_NAME="agentos-${ASSET_PLATFORM}-${ASSET_ARCH}.tgz"');
    expectIncludes(context, "install.sh", installSh, 'CHECKSUM_NAME="${ARTIFACT_NAME}.sha256"');
    expectIncludes(context, "install.sh", installSh, 'REPO="${AGENTOS_REPO:-SapienXai/AgentOS}"');
    expectIncludes(context, "install.sh", installSh, `major >= ${REQUIRED_NODE_MAJOR}`);
    expectIncludes(context, "install.sh", installSh, `AgentOS requires Node.js ${REQUIRED_NODE_MAJOR} or newer.`);
  }

  if (installPs1) {
    expectIncludes(context, "install.ps1", installPs1, '$requestedVersion = if ($env:AGENTOS_VERSION) { $env:AGENTOS_VERSION } else { "latest" }');
    expectIncludes(context, "install.ps1", installPs1, '$releasePath = "latest/download"');
    expectIncludes(context, "install.ps1", installPs1, '$releasePath = "download/agentos-v$requestedVersion"');
    expectIncludes(context, "install.ps1", installPs1, '$artifactName = "agentos-$assetPlatform-$assetArch.tgz"');
    expectIncludes(context, "install.ps1", installPs1, '$checksumUrl = "$artifactUrl.sha256"');
    expectIncludes(context, "install.ps1", installPs1, '"SapienXai/AgentOS"');
    expectIncludes(context, "install.ps1", installPs1, `major >= ${REQUIRED_NODE_MAJOR}`);
    expectIncludes(context, "install.ps1", installPs1, `AgentOS requires Node.js ${REQUIRED_NODE_MAJOR} or newer.`);
  }
}

function validateReadmes(context, readme, packageReadme, agentosPackage) {
  if (readme) {
    expectIncludes(context, "README.md", readme, INSTALL_COMMAND);
    expectIncludes(context, "README.md", readme, WINDOWS_INSTALL_COMMAND);
    expectIncludes(context, "README.md", readme, "pnpm add -g @sapienx/agentos");
    expectIncludes(context, "README.md", readme, "npm install -g @sapienx/agentos");
    expectIncludes(context, "README.md", readme, "pnpm check:release");
    expectIncludes(context, "README.md", readme, "packages/agentos/package.json");
    expectIncludes(context, "README.md", readme, `Node.js ${REQUIRED_NODE_MAJOR} or newer`);
    expectIncludes(context, "README.md", readme, `- Node.js ${REQUIRED_NODE_MAJOR} or newer`);

    expectVersionReferences(context, "README.md", readme, agentosPackage.version, [
      {
        label: "macOS/Linux AGENTOS_VERSION example",
        pattern: new RegExp(`AGENTOS_VERSION=(${SEMVER_SOURCE})\\s+bash`, "g")
      },
      {
        label: "Windows AGENTOS_VERSION example",
        pattern: new RegExp(`AGENTOS_VERSION='(${SEMVER_SOURCE})'`, "g")
      },
      {
        label: "release tag example",
        pattern: new RegExp(`git tag ${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g")
      },
      {
        label: "release tag push example",
        pattern: new RegExp(`git push origin ${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g")
      },
      {
        label: "versioned package manager install",
        pattern: new RegExp(`@sapienx/agentos@(${SEMVER_SOURCE})`, "g"),
        optional: true
      }
    ]);
  }

  if (packageReadme) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "pnpm add -g @sapienx/agentos");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "agentos update --check");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, `Node.js ${REQUIRED_NODE_MAJOR} or newer`);
  }
}

function validateBuildScripts(context, rootPackage, agentosPackage, prepareBundle, runPrepack) {
  expectEqual(
    context,
    "package.json",
    "scripts.check:release",
    rootPackage.scripts?.["check:release"],
    `node ${CHECK_SCRIPT}`
  );
  expectEqual(
    context,
    "package.json",
    "scripts.build:agentos-package",
    rootPackage.scripts?.["build:agentos-package"],
    `pnpm check:release && node ${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`
  );
  expectEqual(
    context,
    "package.json",
    "scripts.pack:agentos",
    rootPackage.scripts?.["pack:agentos"],
    "pnpm check:release && npm pack ./packages/agentos --pack-destination /tmp --cache /tmp/agentos-npm-cache"
  );
  expectEqual(
    context,
    "package.json",
    "scripts.publish:agentos",
    rootPackage.scripts?.["publish:agentos"],
    "pnpm check:release && npm publish ./packages/agentos --access public --cache /tmp/agentos-npm-cache"
  );

  if (prepareBundle) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const packageDir = path.resolve(scriptDir, "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const repoRoot = path.resolve(packageDir, "..", "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const bundleDir = path.join(packageDir, "bundle");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'await rm(path.join(dir, ".env.local"), { force: true });');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, "Prepared AgentOS bundle");
  }

  if (runPrepack) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'const repoRoot = path.resolve(packageDir, "..", "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'cleanNextBuildOutput();');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'fs.rmSync(path.join(repoRoot, ".next"),');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'resolveNextCliPath(), "build", "--webpack"');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'path.join(scriptDir, "prepare-bundle.mjs")');
  }

  if (agentosPackage.bin?.agentos !== AGENTOS_BIN_ENTRY) {
    addIssue(context, AGENTOS_PACKAGE_JSON, `bin.agentos must target ${AGENTOS_BIN_ENTRY} before build, pack, or publish.`);
  }
}

function validateCiWorkflow(context, workflow) {
  if (!workflow) {
    return;
  }

  expectIncludes(context, ".github/workflows/ci.yml", workflow, "name: CI");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pull_request:");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "branches:");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "- main");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, `node-version: ${REQUIRED_NODE_MAJOR}`);
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm install --frozen-lockfile");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm lint");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm typecheck");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm test");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm build");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm check:release");
}

function validateReleaseWorkflow(context, workflow, agentosPackage) {
  if (!workflow) {
    return;
  }

  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, '- "agentos-v*"');
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm install --frozen-lockfile");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm lint");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm typecheck");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm test");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm build");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm check:release");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "require('./packages/agentos/package.json').version");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "Ensure tag matches package version");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "npm pack ./packages/agentos --pack-destination dist");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "install.sh");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "install.ps1");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, `node-version: ${REQUIRED_NODE_MAJOR}`);
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "${{ needs.validate-release.outputs.version }}");

  for (const asset of RELEASE_ASSETS) {
    expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, asset);
  }

  expectVersionReferences(context, ".github/workflows/release-agentos.yml", workflow, agentosPackage.version, [
    {
      label: "literal release tag version",
      pattern: new RegExp(`${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g"),
      optional: true
    },
    {
      label: "literal package version",
      pattern: new RegExp(`${AGENTOS_PACKAGE_NAME.replace("/", "\\/")}@(${SEMVER_SOURCE})`, "g"),
      optional: true
    }
  ]);
}

function expectVersionReferences(context, file, source, expectedVersion, checks) {
  for (const check of checks) {
    const matches = [...source.matchAll(check.pattern)];

    if (matches.length === 0) {
      if (!check.optional) {
        addIssue(context, file, `Missing ${check.label} for published package version ${expectedVersion}.`);
      }
      continue;
    }

    for (const match of matches) {
      const actualVersion = match[1];

      if (actualVersion !== expectedVersion) {
        addIssue(context, file, `${check.label} uses ${actualVersion}, expected ${expectedVersion} from ${AGENTOS_PACKAGE_JSON}.`);
      }
    }
  }
}

function buildResult(context, agentosPackage) {
  return {
    ok: context.issues.length === 0,
    packageName: agentosPackage?.name || AGENTOS_PACKAGE_NAME,
    version: agentosPackage?.version || "unknown",
    issues: context.issues,
    notes: context.notes
  };
}

function readText(context, relativePath) {
  if (context.overrides.has(relativePath)) {
    return context.overrides.get(relativePath);
  }

  const absolutePath = path.join(context.repoRoot, relativePath);

  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(context, relativePath, `Unable to read required release file: ${detail}`);
    return null;
  }
}

function readJson(context, relativePath) {
  const text = readText(context, relativePath);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(context, relativePath, `Invalid JSON: ${detail}`);
    return null;
  }
}

function expectFileExists(context, relativePath) {
  if (context.overrides.has(relativePath)) {
    return;
  }

  if (!existsSync(path.join(context.repoRoot, relativePath))) {
    addIssue(context, relativePath, "Expected file does not exist.");
  }
}

function expectIncludes(context, file, source, expected) {
  if (!source.includes(expected)) {
    addIssue(context, file, `Expected to find ${JSON.stringify(expected)}.`);
  }
}

function expectEqual(context, file, field, actual, expected) {
  if (actual !== expected) {
    addIssue(context, file, `${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

function addIssue(context, file, message) {
  context.issues.push({
    file,
    message
  });
}

function isSemver(value) {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

function normalizeOverrides(overrides) {
  if (!overrides) {
    return new Map();
  }

  if (overrides instanceof Map) {
    return overrides;
  }

  return new Map(Object.entries(overrides));
}

function parseCliArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--repo-root") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--repo-root requires a path value.");
      }

      args.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

if (path.resolve(process.argv[1] || "") === scriptPath) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const result = checkReleaseConsistency(args);
    const output = formatReleaseConsistencyResult(result);

    if (result.ok) {
      console.log(output);
    } else {
      console.error(output);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
