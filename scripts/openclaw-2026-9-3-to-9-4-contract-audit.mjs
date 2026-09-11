#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SOURCE = {
  version: "2026.9.3",
  tag: "v2026.9.3",
  signedTagObject: "a69d657b4b74556017f2d0ef98b0c64aeabb3643",
  sourceCommit: "1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7",
  buildId: "2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z",
  stateSchema: 16,
  agentSchema: 19,
  protocol: 4,
  packageIntegrity: {
    openclaw: "sha512-CzDHMeHdnjlIZ76ZyBb1lvLO4H/yBIMYXupFGGBN87x0853y3hg5nLAnKfxSKqLzqhbUKqy9ebDRAWWV4t8aew==",
    gatewayClient: "sha512-NfBXoINz2cOWfMGKwNIU1xGwtla7nKgaxA4cslwBnJaKTs/Y2IUYkafn9GCxxcLHTI760edlD8epYFgmk07NPA==",
    gatewayProtocol: "sha512-v1+ljByJj8kttGxt1lU0UXhNLUcJ3CB+T4tiupcCzLhzLcfdAGe7Be/+M45KONecZjHq2SnMram6nOgLKMR1Og=="
  }
};

export const TARGET = {
  version: "2026.9.4",
  tag: "v2026.9.4",
  signedTagObject: "8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e",
  sourceCommit: "3a9d69db306cd7f081e06254cb89c4bcc14a7107",
  buildId: "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z",
  stateSchema: 17,
  agentSchema: 19,
  protocol: 4,
  nodeEngine: ">=24.16.0 <25 || >=26.1.0",
  packageIntegrity: {
    openclaw: "sha512-lTQpEEe1Xm3u2PCHaPEr+vP8paGk1vLdHuzdItsNToaLI6hAqRVvgJYg+GxukJhETJp4tPy/S1Gftl4KuB8n7A==",
    gatewayClient: "sha512-MQSj/agWzPMvPbWIyh5azarYYJvxcrc9TVdPn22zdGAfW7SAOpocpa/ImOi8YcIDk6IILXvv0nRDFKXQnjMS6A==",
    gatewayProtocol: "sha512-arnDRQV4d7yP1veI0i3UWJSrRk7ehgM0N8n0kQoVc0yP6/cy40GZmshh10RD/ZASrhGeZGDXbVQBjSHIHgrtDg=="
  }
};

const repoRoot = path.resolve(process.cwd());
const outputPath = path.resolve(process.env.OPENCLAW_CONTRACT_AUDIT_OUTPUT?.trim() || "docs/evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json");

export function diffProtocolSchemas(sourceSchema, targetSchema) {
  const sourceMethods = sourceSchema?.methods ?? {};
  const targetMethods = targetSchema?.methods ?? {};
  const sourceDefinitions = sourceSchema?.definitions ?? {};
  const targetDefinitions = targetSchema?.definitions ?? {};
  const sourceMethodNames = new Set(Object.keys(sourceMethods));
  const targetMethodNames = new Set(Object.keys(targetMethods));
  const sourceDefinitionNames = new Set(Object.keys(sourceDefinitions));
  const targetDefinitionNames = new Set(Object.keys(targetDefinitions));

  return {
    methodInventory: {
      sourceCount: sourceMethodNames.size,
      targetCount: targetMethodNames.size,
      added: sortedDifference(targetMethodNames, sourceMethodNames),
      removed: sortedDifference(sourceMethodNames, targetMethodNames),
      changed: sortedChanged(sourceMethods, targetMethods)
    },
    definitionInventory: {
      sourceCount: sourceDefinitionNames.size,
      targetCount: targetDefinitionNames.size,
      added: sortedDifference(targetDefinitionNames, sourceDefinitionNames),
      removed: sortedDifference(sourceDefinitionNames, targetDefinitionNames),
      changed: sortedChanged(sourceDefinitions, targetDefinitions)
    },
    requiredFieldChanges: collectRequiredFieldChanges(sourceDefinitions, targetDefinitions),
    protocolSchemaTopLevelKeys: {
      source: Object.keys(sourceSchema ?? {}).filter((key) => key !== "$schema").sort(),
      target: Object.keys(targetSchema ?? {}).filter((key) => key !== "$schema").sort()
    }
  };
}

async function main() {
  const inputs = resolveInputs();
  const evidence = {
    schemaVersion: 1,
    artifactType: "openclaw-contract-diff",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosHead: await gitHead(repoRoot),
      comparison: `${SOURCE.version} -> ${TARGET.version}`,
      source: SOURCE,
      target: TARGET,
      sourceRepository: await inspectGitIdentity(inputs.sourceRepository),
      artifactInputs: Object.fromEntries(Object.entries(inputs).filter(([key]) => key !== "sourceRepository").map(([key, value]) => [key, value ? path.basename(value) : null]))
    },
    packageIdentity: {
      source: await inspectPackageIdentity(inputs.sourcePackage, SOURCE),
      target: await inspectPackageIdentity(inputs.targetPackage, TARGET),
      gatewayClient: await inspectClientOrProtocol(inputs.sourceClientPackage, inputs.targetClientPackage, "gateway-client", SOURCE, TARGET),
      gatewayProtocol: await inspectClientOrProtocol(inputs.sourceProtocolPackage, inputs.targetProtocolPackage, "gateway-protocol", SOURCE, TARGET)
    },
    archiveIntegrity: await inspectArchiveIntegrity(inputs),
    protocol: {
      source: await readJson(path.join(inputs.sourceProtocolPackage, "protocol.schema.json")),
      target: await readJson(path.join(inputs.targetProtocolPackage, "protocol.schema.json"))
    },
    classifications: {
      additive: [
        "Five Gateway methods were added: environments.prepare, plugins.catalog.browse, plugins.catalog.categories, plugins.catalog.get, and tasks.history.",
        "The protocol definitions add prepared-worker placement, plugin catalog, task-history, and capability metadata shapes."
      ],
      behavioral: [
        "Model listing now carries provider/auth-profile/detail/session context and can report refresh failures.",
        "Plugin inspection and control-UI responses carry additional component/catalog state.",
        "Session creation, patching, placement, and task summaries expose additional lifecycle and transcript metadata."
      ],
      breaking: [
        "No Gateway methods or protocol definitions were removed.",
        "PluginsInspectResult adds a required components response member; AgentOS treats unknown upstream fields as native data and does not construct this response itself."
      ],
      deprecated: [],
      removed: [],
      securityRelevant: [
        "Updater recovery now requires verified backup protection for migration-bearing upgrades and preserves failed status after recovery.",
        "Read-only externally managed configuration is available through OPENCLAW_CONFIG_READONLY=1; it is not enabled by AgentOS in this release."
      ],
      migrationRelevant: [
        "State schema changes from 16 to 17 while the agent schema remains 19.",
        "Prepared-worker ownership and lifecycle state are represented in the target schema."
      ],
      agentOsRelevant: [
        "Native update/restart/reconnect reconciliation, models/providers, sessions/history, plugins, memory, and Doctor require recertification.",
        "The protocol remains v4, so no synthetic v5 adapter or parallel transport is introduced."
      ],
      irrelevantOrDeferred: [
        "Prepared cloud sessions/workers, unified plugin workspace UI, terminal question enhancements, Talk delegated completion, and externally managed config remain upstream capabilities for future AgentOS exposure or deployment-specific evaluation."
      ]
    },
    contractDecision: {
      owner: "OpenClaw",
      transport: "official gateway-client and gateway-protocol",
      lifecycle: "native OpenClaw Gateway/updater/supervisor",
      stateMigration: "native OpenClaw Doctor/runtime migration path",
      agentOsChanges: "recertify and normalize native responses only; no duplicate runtime, lifecycle machine, updater ledger, or plugin workspace"
    }
  };

  evidence.protocolDiff = diffProtocolSchemas(evidence.protocol.source, evidence.protocol.target);
  evidence.protocol = {
    source: summarizeProtocol(evidence.protocol.source),
    target: summarizeProtocol(evidence.protocol.target)
  };
  evidence.checks = await evaluateChecks(evidence);
  evidence.success = Object.values(evidence.checks).every(Boolean);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW 2026.9.3 -> 2026.9.4 CONTRACT AUDIT: ${evidence.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${outputPath}`);
  if (!evidence.success) process.exitCode = 1;
}

function resolveInputs() {
  const required = {
    sourcePackage: process.env.OPENCLAW_9_3_PACKAGE,
    targetPackage: process.env.OPENCLAW_9_4_PACKAGE,
    sourceClientPackage: process.env.OPENCLAW_9_3_CLIENT_PACKAGE,
    targetClientPackage: process.env.OPENCLAW_9_4_CLIENT_PACKAGE,
    sourceProtocolPackage: process.env.OPENCLAW_9_3_PROTOCOL_PACKAGE,
    targetProtocolPackage: process.env.OPENCLAW_9_4_PROTOCOL_PACKAGE,
    sourceOpenClawArchive: process.env.OPENCLAW_9_3_OPENCLAW_ARCHIVE,
    targetOpenClawArchive: process.env.OPENCLAW_9_4_OPENCLAW_ARCHIVE,
    sourceClientArchive: process.env.OPENCLAW_9_3_CLIENT_ARCHIVE,
    targetClientArchive: process.env.OPENCLAW_9_4_CLIENT_ARCHIVE,
    sourceProtocolArchive: process.env.OPENCLAW_9_3_PROTOCOL_ARCHIVE,
    targetProtocolArchive: process.env.OPENCLAW_9_4_PROTOCOL_ARCHIVE,
    sourceRepository: process.env.OPENCLAW_SOURCE_REPOSITORY
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Missing exact upstream audit inputs: ${missing.join(", ")}`);
  return Object.fromEntries(Object.entries(required).map(([key, value]) => [key, path.resolve(value)]));
}

async function inspectPackageIdentity(packageRoot, expected) {
  const packageJson = await readJson(path.join(packageRoot, "package.json"));
  const buildInfo = await readJson(path.join(packageRoot, "dist", "build-info.json"));
  const hash = createHash("sha256");
  for (const file of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(file);
    hash.update(await readFile(path.join(packageRoot, file)));
  }
  return {
    packageName: packageJson.name ?? null,
    version: packageJson.version ?? null,
    sourceCommit: buildInfo.commit ?? null,
    buildId: buildInfo.buildId ?? null,
    builtAt: buildInfo.builtAt ?? null,
    packageHash: hash.digest("hex"),
    stateSchema: packageJson.openclaw?.schemaVersions?.state ?? null,
    agentSchema: packageJson.openclaw?.schemaVersions?.agent ?? null,
    nodeEngine: packageJson.engines?.node ?? null,
    expected: {
      version: expected.version,
      sourceCommit: expected.sourceCommit,
      buildId: expected.buildId ?? null,
      stateSchema: expected.stateSchema,
      agentSchema: expected.agentSchema,
      nodeEngine: expected.nodeEngine ?? null
    },
    exact: packageJson.version === expected.version
      && buildInfo.commit === expected.sourceCommit
      && (!expected.buildId || buildInfo.buildId === expected.buildId)
      && packageJson.openclaw?.schemaVersions?.state === expected.stateSchema
      && packageJson.openclaw?.schemaVersions?.agent === expected.agentSchema
      && (!expected.nodeEngine || packageJson.engines?.node === expected.nodeEngine)
  };
}

async function inspectClientOrProtocol(sourceRoot, targetRoot, label, sourceExpected, targetExpected) {
  const source = await readJson(path.join(sourceRoot, "package.json"));
  const target = await readJson(path.join(targetRoot, "package.json"));
  const sourceVersion = label === "gateway-protocol" ? await readVersionModule(sourceRoot) : null;
  const targetVersion = label === "gateway-protocol" ? await readVersionModule(targetRoot) : null;
  return {
    name: label,
    source: { packageName: source.name ?? null, version: source.version ?? null, versionModule: sourceVersion },
    target: { packageName: target.name ?? null, version: target.version ?? null, versionModule: targetVersion },
    exact: source.version === sourceExpected.version && target.version === targetExpected.version
      && (label !== "gateway-protocol" || (sourceVersion.protocol === sourceExpected.protocol && targetVersion.protocol === targetExpected.protocol))
      && (label !== "gateway-client" || target.dependencies?.["@openclaw/gateway-protocol"] === targetExpected.version)
  };
}

async function readVersionModule(packageRoot) {
  const source = await readFile(path.join(packageRoot, "dist", "version.mjs"), "utf8");
  return {
    protocol: Number(source.match(/PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1] ?? NaN),
    minClient: Number(source.match(/MIN_CLIENT_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1] ?? NaN),
    minNode: Number(source.match(/MIN_NODE_PROTOCOL_VERSION\s*=\s*(\d+)/)?.[1] ?? NaN)
  };
}

async function inspectGitIdentity(repository) {
  const tagObject = (await execFileAsync("git", ["-C", repository, "cat-file", "-p", TARGET.tag])).stdout;
  const peeled = (await execFileAsync("git", ["-C", repository, "rev-parse", `${TARGET.tag}^{}`])).stdout.trim();
  const object = (await execFileAsync("git", ["-C", repository, "rev-parse", TARGET.tag])).stdout.trim();
  const sourceTagObject = (await execFileAsync("git", ["-C", repository, "rev-parse", SOURCE.tag])).stdout.trim();
  const sourcePeeled = (await execFileAsync("git", ["-C", repository, "rev-parse", `${SOURCE.tag}^{}`])).stdout.trim();
  return {
    targetTagObject: object,
    targetPeeledCommit: peeled,
    targetAnnotatedSigned: tagObject.includes("BEGIN SSH SIGNATURE") || tagObject.includes("BEGIN PGP SIGNATURE"),
    sourceTagObject,
    sourcePeeledCommit: sourcePeeled,
    exact: object === TARGET.signedTagObject && peeled === TARGET.sourceCommit && sourceTagObject === SOURCE.signedTagObject && sourcePeeled === SOURCE.sourceCommit
  };
}

async function evaluateChecks(evidence) {
  const source = evidence.packageIdentity.source;
  const target = evidence.packageIdentity.target;
  const targetProtocol = evidence.packageIdentity.gatewayProtocol.target;
  const diff = evidence.protocolDiff;
  return {
    sourcePackageExact: evidence.packageIdentity.source.exact,
    targetPackageExact: target.exact,
    clientAndProtocolExact: evidence.packageIdentity.gatewayClient.exact && evidence.packageIdentity.gatewayProtocol.exact,
    sourceAndTargetTagIdentityExact: evidence.provenance.sourceRepository.exact,
    targetProtocolV4: targetProtocol.versionModule.protocol === TARGET.protocol,
    stateSchema16To17: source.stateSchema === SOURCE.stateSchema && target.stateSchema === TARGET.stateSchema,
    agentSchemaRemains19: source.agentSchema === SOURCE.agentSchema && target.agentSchema === TARGET.agentSchema,
    methodsOnlyAdditive: diff.methodInventory.removed.length === 0,
    definitionsOnlyAdditiveOrChanged: diff.definitionInventory.removed.length === 0,
    archiveIntegrityExact: Object.values(evidence.archiveIntegrity).every((entry) => entry.exact)
  };
}

function summarizeProtocol(schema) {
  return {
    id: schema?.$id ?? null,
    methodCount: Object.keys(schema?.methods ?? {}).length,
    definitionCount: Object.keys(schema?.definitions ?? {}).length,
    methods: Object.keys(schema?.methods ?? {}).sort(),
    hasDefinitions: Boolean(schema?.definitions)
  };
}

function sortedDifference(left, right) { return [...left].filter((value) => !right.has(value)).sort(); }
function sortedChanged(source, target) {
  return [...new Set([...Object.keys(source), ...Object.keys(target)])].filter((key) => source[key] && target[key] && JSON.stringify(source[key]) !== JSON.stringify(target[key])).sort();
}
function collectRequiredFieldChanges(source, target) {
  const names = new Set([...Object.keys(source), ...Object.keys(target)]);
  return [...names].sort().flatMap((name) => {
    const sourceRequired = source[name]?.required ?? [];
    const targetRequired = target[name]?.required ?? [];
    const added = targetRequired.filter((field) => !sourceRequired.includes(field));
    const removed = sourceRequired.filter((field) => !targetRequired.includes(field));
    return added.length || removed.length ? [{ name, added, removed }] : [];
  });
}
async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }
async function gitHead(directory) { return (await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"])).stdout.trim(); }
async function inspectArchiveIntegrity(inputs) {
  const entries = [
    ["sourceOpenClaw", inputs.sourceOpenClawArchive, SOURCE.packageIntegrity.openclaw],
    ["targetOpenClaw", inputs.targetOpenClawArchive, TARGET.packageIntegrity.openclaw],
    ["sourceGatewayClient", inputs.sourceClientArchive, SOURCE.packageIntegrity.gatewayClient],
    ["targetGatewayClient", inputs.targetClientArchive, TARGET.packageIntegrity.gatewayClient],
    ["sourceGatewayProtocol", inputs.sourceProtocolArchive, SOURCE.packageIntegrity.gatewayProtocol],
    ["targetGatewayProtocol", inputs.targetProtocolArchive, TARGET.packageIntegrity.gatewayProtocol]
  ];
  const result = {};
  for (const [name, archive, expected] of entries) {
    const actual = `sha512-${createHash("sha512").update(await readFile(archive)).digest("base64")}`;
    result[name] = { file: path.basename(archive), expected, actual, exact: actual === expected };
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`OpenClaw contract audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
