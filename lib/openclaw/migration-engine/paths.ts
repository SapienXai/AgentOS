import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  OpenClawMigrationEngineInput,
  OpenClawMigrationPaths,
  OpenClawRuntimeIdentity
} from "@/lib/openclaw/migration-engine/types";

const PACKAGE_HASH_FILES = ["package.json", "dist/build-info.json"] as const;

export async function readOpenClawRuntimeIdentity(input: {
  binaryPath: string;
  packageRoot?: string;
}): Promise<OpenClawRuntimeIdentity> {
  const binaryPath = path.resolve(input.binaryPath);
  const packageRoot = path.resolve(input.packageRoot ?? inferPackageRoot(binaryPath));
  const packagePath = path.join(packageRoot, "package.json");
  const packageJson = parseRecord(await readFile(packagePath, "utf8"), packagePath);
  const version = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  if (!version) throw new Error(`OpenClaw package at ${packageRoot} has no version.`);

  const buildInfoPath = path.join(packageRoot, "dist", "build-info.json");
  const buildInfo = await readJsonRecordIfPresent(buildInfoPath);
  const hash = createHash("sha256");
  for (const relativePath of PACKAGE_HASH_FILES) {
    const filePath = path.join(packageRoot, relativePath);
    try {
      hash.update(relativePath);
      hash.update(await readFile(filePath));
    } catch {
      // Older OpenClaw packages do not carry build-info.json.
    }
  }

  await assertRegularFile(binaryPath, `OpenClaw binary ${binaryPath}`);
  return {
    packageRoot,
    binaryPath,
    version,
    sourceCommit: typeof buildInfo?.commit === "string" ? buildInfo.commit : null,
    buildId: typeof buildInfo?.buildId === "string" ? buildInfo.buildId : null,
    packageHash: hash.digest("hex")
  };
}

export async function resolveMigrationPaths(input: OpenClawMigrationEngineInput, runId: string): Promise<OpenClawMigrationPaths> {
  const sourceStateDir = safeAbsolutePath(input.sourceStateDir, "source state");
  const sourceConfigPath = safeAbsolutePath(input.sourceConfigPath, "source config");
  const workRoot = safeAbsolutePath(input.workRoot, "migration work root");
  const targetStateDir = safeAbsolutePath(input.targetStateDir ?? path.join(workRoot, "runs", runId, "target-state"), "target state");
  const targetConfigPath = safeAbsolutePath(input.targetConfigPath ?? path.join(workRoot, "runs", runId, "target-config", "openclaw.json"), "target config");
  const runtimePackageRoot = safeAbsolutePath(input.runtimePackageRoot ?? input.targetPackageRoot ?? inferPackageRoot(input.targetBinaryPath), "runtime package");
  const snapshotRoot = safeAbsolutePath(input.snapshotRoot ?? path.join(workRoot, "snapshots"), "snapshot root");
  const installPackageRoot = input.installPackageRoot ? safeAbsolutePath(input.installPackageRoot, "managed install package") : null;

  assertDistinctPath(sourceStateDir, targetStateDir, "Source and target state directories must be different.");
  assertDistinctPath(sourceConfigPath, targetConfigPath, "Source and target config files must be different.");
  assertNotNested(sourceStateDir, targetStateDir, "Target state must not be nested inside source state.");
  assertNotNested(targetStateDir, sourceStateDir, "Source state must not be nested inside target state.");

  return {
    sourceStateDir,
    sourceConfigPath,
    targetStateDir,
    targetConfigPath,
    runtimePackageRoot,
    installPackageRoot,
    workRoot,
    snapshotRoot
  };
}

function safeAbsolutePath(value: string, label: string) {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved === path.parse(resolved).root) {
    throw new Error(`Unsafe ${label} path; an explicit non-root absolute path is required.`);
  }
  return resolved;
}

export async function assertRegularFile(filePath: string, label = filePath) {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`${label} is not a regular file.`);
}

export async function pathExists(filePath: string) {
  return access(filePath).then(() => true).catch(() => false);
}

export function inferPackageRoot(binaryPath: string) {
  const resolved = path.resolve(binaryPath);
  return path.basename(resolved) === "openclaw.mjs" ? path.dirname(resolved) : path.dirname(path.dirname(resolved));
}

export function compareOpenClawVersions(left: string, right: string) {
  const parse = (value: string) => {
    const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

async function readJsonRecordIfPresent(filePath: string) {
  try {
    return parseRecord(await readFile(filePath, "utf8"), filePath);
  } catch {
    return null;
  }
}

function parseRecord(raw: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`OpenClaw metadata at ${filePath} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`OpenClaw metadata at ${filePath} is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function assertDistinctPath(left: string, right: string, message: string) {
  if (left === right) throw new Error(message);
}

function assertNotNested(parent: string, child: string, message: string) {
  const relative = path.relative(parent, child);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error(message);
}
