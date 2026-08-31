import { chmod, cp, lstat, mkdir, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { hashFile, createWalAwareSqliteSnapshot, findSqliteSidecars } from "@/lib/openclaw/migration-engine/sqlite";
import type {
  OpenClawMigrationSnapshot,
  OpenClawMigrationSnapshotFile,
  OpenClawMigrationSnapshotSqlite
} from "@/lib/openclaw/migration-engine/types";
import { OPENCLAW_MIGRATION_SCHEMA_VERSION } from "@/lib/openclaw/migration-engine/types";

export async function createMigrationSnapshot(input: {
  snapshotId: string;
  sourceVersion: string;
  sourceCommit: string | null;
  stateDir: string;
  configPath: string;
  destinationRoot: string;
}): Promise<OpenClawMigrationSnapshot> {
  const root = path.resolve(input.destinationRoot);
  const stateDestination = path.join(root, "state");
  const configDestination = path.join(root, "config", "openclaw.json");
  await mkdir(stateDestination, { recursive: true, mode: 0o700 });
  await mkdir(path.dirname(configDestination), { recursive: true, mode: 0o700 });

  const files: OpenClawMigrationSnapshotFile[] = [];
  const sqlite: OpenClawMigrationSnapshotSqlite[] = [];
  await copyStateTree(input.stateDir, stateDestination, input.stateDir, files, sqlite);

  let config: OpenClawMigrationSnapshot["config"] = null;
  try {
    const configStat = await lstat(input.configPath);
    if (!configStat.isFile()) throw new Error(`OpenClaw config is not a regular file: ${input.configPath}`);
    await cp(input.configPath, configDestination, { force: false, errorOnExist: true });
    config = {
      relativePath: "config/openclaw.json",
      sha256: await hashFile(configDestination),
      bytes: configStat.size
    };
  } catch (error) {
    if (isMissingPath(error)) {
      config = null;
    } else {
      throw error;
    }
  }

  const snapshot: OpenClawMigrationSnapshot = {
    schemaVersion: OPENCLAW_MIGRATION_SCHEMA_VERSION,
    snapshotId: input.snapshotId,
    createdAt: new Date().toISOString(),
    sourceVersion: input.sourceVersion,
    sourceCommit: input.sourceCommit,
    stateDir: path.resolve(input.stateDir),
    configPath: path.resolve(input.configPath),
    root,
    files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    sqlite: sqlite.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    config,
    verified: true
  };
  const manifestPath = path.join(root, "snapshot-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600).catch(() => {});
  return snapshot;
}

export async function restoreMigrationSnapshot(input: {
  snapshot: OpenClawMigrationSnapshot;
  stateDir: string;
  configPath: string;
}) {
  if (!input.snapshot.verified) throw new Error("Cannot restore an unverified OpenClaw migration snapshot.");
  await replaceDirectoryFromSnapshot(path.join(input.snapshot.root, "state"), input.stateDir);
  const configSnapshot = input.snapshot.config ? path.join(input.snapshot.root, input.snapshot.config.relativePath) : null;
  if (configSnapshot) {
    await mkdir(path.dirname(input.configPath), { recursive: true, mode: 0o700 });
    await cp(configSnapshot, input.configPath, { force: true });
  } else {
    await rm(input.configPath, { force: true });
  }
}

export async function copySnapshotState(input: { snapshot: OpenClawMigrationSnapshot; destinationStateDir: string }) {
  await replaceDirectoryFromSnapshot(path.join(input.snapshot.root, "state"), input.destinationStateDir);
}

export async function auditMigrationSymlinks(input: {
  snapshot: OpenClawMigrationSnapshot;
  stateDir: string;
  forbiddenRoots: string[];
}) {
  const links: Array<{ relativePath: string; target: string; status: "pass" | "fail"; reason?: string }> = [];
  const snapshotLinks = new Map(input.snapshot.files.filter((entry) => entry.kind === "symlink").map((entry) => [entry.relativePath, entry.linkTarget ?? ""]));
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      const relativePath = path.relative(input.stateDir, filePath);
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(filePath);
        const resolvedTarget = path.resolve(path.dirname(filePath), target);
        const forbidden = input.forbiddenRoots.some((root) => isSameOrNested(root, resolvedTarget));
        const missing = !(await pathExists(resolvedTarget));
        const unchangedBrokenLink = snapshotLinks.get(relativePath) === target && missing;
        links.push({
          relativePath,
          target,
          status: forbidden || (missing && !unchangedBrokenLink) ? "fail" : "pass",
          reason: forbidden ? "Symlink target references a migration package or staging root." : missing && !unchangedBrokenLink ? "Symlink target is missing after migration." : undefined
        });
      } else if (metadata.isDirectory()) await walk(filePath);
    }
  };
  if (await pathExists(input.stateDir)) await walk(input.stateDir);
  const failures = links.filter((link) => link.status === "fail");
  return { status: failures.length === 0 ? "pass" as const : "fail" as const, links, failures };
}

async function copyStateTree(
  sourceRoot: string,
  destinationRoot: string,
  currentSourcePath: string,
  files: OpenClawMigrationSnapshotFile[],
  sqlite: OpenClawMigrationSnapshotSqlite[]
) {
  const entries = await readdir(currentSourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(currentSourcePath, entry.name);
    const relativePath = path.relative(sourceRoot, sourcePath);
    const destinationPath = path.join(destinationRoot, relativePath);
    const metadata = await lstat(sourcePath);
    if (metadata.isSymbolicLink()) {
      const linkTarget = await readlink(sourcePath);
      await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
      await symlink(linkTarget, destinationPath);
      files.push({
        relativePath,
        kind: "symlink",
        bytes: 0,
        sha256: createHash("sha256").update(`symlink:${linkTarget}`).digest("hex"),
        linkTarget
      });
      continue;
    }

    if (metadata.isDirectory()) {
      await mkdir(destinationPath, { recursive: true, mode: 0o700 });
      files.push({ relativePath, kind: "directory", bytes: 0, sha256: null });
      await copyStateTree(sourceRoot, destinationRoot, sourcePath, files, sqlite);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`Unsupported state entry: ${sourcePath}`);
    if (isSqliteSidecar(sourcePath) || isVolatileStateFile(sourcePath)) continue;

    await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
    if (sourcePath.endsWith(".sqlite") || sourcePath.endsWith(".db")) {
      const snapshotPath = destinationPath;
      const inspection = await createWalAwareSqliteSnapshot({ sourcePath, destinationPath: snapshotPath });
      const sidecars = await findSqliteSidecars(sourcePath);
      sqlite.push({
        relativePath,
        snapshotPath: path.relative(path.dirname(destinationRoot), snapshotPath),
        userVersion: inspection.userVersion,
        integrity: inspection.integrity,
        sourceSidecars: sidecars,
        sha256: inspection.sha256
      });
      files.push({ relativePath, kind: "sqlite", bytes: inspection.bytes, sha256: inspection.sha256 });
    } else {
      await cp(sourcePath, destinationPath, { force: false, errorOnExist: true });
      files.push({ relativePath, kind: "file", bytes: metadata.size, sha256: await hashFile(sourcePath) });
    }
  }
}

async function replaceDirectoryFromSnapshot(source: string, destination: string) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

function isSqliteSidecar(filePath: string) {
  return ["-wal", "-shm", "-journal"].some((suffix) => filePath.endsWith(suffix));
}

function isVolatileStateFile(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  return name.endsWith(".lock") || name === "gateway.lock" || name === "gateway.pid";
}

function isMissingPath(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

async function pathExists(filePath: string) {
  return lstat(filePath).then(() => true).catch(() => false);
}

function isSameOrNested(root: string, child: string) {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
