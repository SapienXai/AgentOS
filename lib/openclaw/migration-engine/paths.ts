import { createHash } from "node:crypto";
import { access, lstat, readFile, stat } from "node:fs/promises";
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
  const binaryPath = safeAbsolutePath(input.binaryPath, "OpenClaw binary");
  const packageRoot = safeAbsolutePath(input.packageRoot ?? inferPackageRoot(binaryPath), "OpenClaw package");
  await assertNonSymlinkRoot(packageRoot, "OpenClaw package");
  assertPathWithinRoot(binaryPath, packageRoot, "OpenClaw binary");
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
  const sourcePackageRoot = safeAbsolutePath(input.sourcePackageRoot ?? inferPackageRoot(input.sourceBinaryPath), "source package");
  const targetPackageRoot = safeAbsolutePath(input.targetPackageRoot ?? inferPackageRoot(input.targetBinaryPath), "target package");
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
  assertDisjoint(sourceStateDir, workRoot, "Migration work root must not be inside or contain the live source state.");
  assertDisjoint(path.dirname(sourceConfigPath), workRoot, "Migration work root must not overlap the live config directory.");
  assertDisjoint(sourceStateDir, snapshotRoot, "Snapshot root must not overlap live source state.");
  assertDisjoint(path.dirname(sourceConfigPath), snapshotRoot, "Snapshot root must not overlap the live config directory.");
  for (const [packageRoot, label] of [[sourcePackageRoot, "source"], [targetPackageRoot, "target"]] as const) {
    assertDisjoint(sourceStateDir, packageRoot, `${label} package must not overlap source state.`);
    assertDisjoint(path.dirname(sourceConfigPath), packageRoot, `${label} package must not overlap source config.`);
    assertDisjoint(targetStateDir, packageRoot, `${label} package must not overlap target state.`);
    assertDisjoint(path.dirname(targetConfigPath), packageRoot, `${label} package must not overlap target config.`);
    assertDisjoint(workRoot, packageRoot, `${label} package must not overlap migration work.`);
    assertDisjoint(snapshotRoot, packageRoot, `${label} package must not overlap the snapshot root.`);
  }
  assertDisjoint(targetStateDir, installPackageRoot, "Target state must not overlap the managed install package.");
  assertDisjoint(path.dirname(targetConfigPath), installPackageRoot, "Target config must not overlap the managed install package.");
  assertDisjoint(targetStateDir, runtimePackageRoot, "Target state must not overlap the runtime package.");
  assertDisjoint(path.dirname(targetConfigPath), runtimePackageRoot, "Target config must not overlap the runtime package.");
  if (installPackageRoot) {
    assertDisjoint(sourceStateDir, installPackageRoot, "Managed install package must not overlap source state.");
    assertDisjoint(path.dirname(sourceConfigPath), installPackageRoot, "Managed install package must not overlap source config.");
    assertDisjoint(installPackageRoot, workRoot, "Managed install package must not overlap migration work.");
  }
  await assertNonSymlinkRoot(sourceStateDir, "source state");
  await assertNonSymlinkRoot(targetStateDir, "target state");
  await assertNonSymlinkRoot(workRoot, "migration work root");
  if (installPackageRoot) await assertNonSymlinkRoot(installPackageRoot, "managed install package");

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

async function assertNonSymlinkRoot(root: string, label: string) {
  const metadata = await lstat(root).catch(() => null);
  if (metadata?.isSymbolicLink()) throw new Error(`Unsafe ${label} path; the root must not be a symbolic link.`);
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

function assertDisjoint(left: string, right: string | null, message: string) {
  if (!right) return;
  assertNotNested(left, right, message);
  assertNotNested(right, left, message);
}

export function assertPathWithinRoot(filePath: string, root: string, label: string) {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must remain inside its declared package root.`);
}
