import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const WORKSPACE_FILESYSTEM_OWNERSHIP_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT = path.join(missionControlRootPath, "workspace-filesystem-ownership");

export type WorkspaceFilesystemOwnership =
  | "agentos-created-empty"
  | "agentos-created-clone"
  | "user-selected-existing"
  | "external-imported"
  | "unknown";

export type WorkspaceFilesystemOwnershipRecord = {
  schemaVersion: typeof WORKSPACE_FILESYSTEM_OWNERSHIP_SCHEMA_VERSION;
  workspacePath: string;
  ownership: Exclude<WorkspaceFilesystemOwnership, "unknown">;
  materialization: WorkspaceMaterialization["mode"];
  directoryIdentity: {
    device: string;
    inode: string;
  };
  recordedAt: string;
};

export function workspaceFilesystemOwnershipPath(
  workspacePath: string,
  rootPath = WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT
) {
  const digest = createHash("sha256").update(path.resolve(workspacePath)).digest("hex");
  return path.join(path.resolve(rootPath), `${digest}.json`);
}

export function ownershipForWorkspaceMaterialization(
  materialization: WorkspaceMaterialization,
  wasDirectoryCreated: boolean
): Exclude<WorkspaceFilesystemOwnership, "unknown"> {
  if (materialization.mode === "clone") return "agentos-created-clone";
  if (materialization.mode === "empty" && wasDirectoryCreated) return "agentos-created-empty";
  if (materialization.mode === "existing") return "user-selected-existing";
  return "external-imported";
}

export function isAgentOsOwnedWorkspaceFilesystem(ownership: WorkspaceFilesystemOwnership | null | undefined) {
  return ownership === "agentos-created-empty" || ownership === "agentos-created-clone";
}

export type WorkspaceFilesystemCleanupDecision = {
  action: "delete" | "preserve";
  reason: "agentos-owned" | "native-state-not-confirmed" | "ownership-not-proven";
};

/**
 * Filesystem cleanup is a consequence of two independent proofs: OpenClaw's
 * native removal must be confirmed, and the directory must be explicitly
 * owned by AgentOS. Any missing proof preserves the directory.
 */
export function decideWorkspaceFilesystemCleanup(input: {
  nativeConfirmed: boolean;
  ownership: WorkspaceFilesystemOwnership | null | undefined;
}): WorkspaceFilesystemCleanupDecision {
  if (!input.nativeConfirmed) {
    return { action: "preserve", reason: "native-state-not-confirmed" };
  }
  if (!isAgentOsOwnedWorkspaceFilesystem(input.ownership)) {
    return { action: "preserve", reason: "ownership-not-proven" };
  }
  return { action: "delete", reason: "agentos-owned" };
}

export async function writeWorkspaceFilesystemOwnership(
  workspacePath: string,
  input: {
    ownership: Exclude<WorkspaceFilesystemOwnership, "unknown">;
    materialization: WorkspaceMaterialization["mode"];
    recordedAt?: string;
  },
  rootPath = WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT
) {
  const resolvedPath = path.resolve(workspacePath);
  const directoryStat = await lstat(resolvedPath, { bigint: true });
  if (!directoryStat.isDirectory()) {
    throw new Error("Workspace ownership can only be recorded for a directory.");
  }
  const filePath = workspaceFilesystemOwnershipPath(resolvedPath, rootPath);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const record: WorkspaceFilesystemOwnershipRecord = {
    schemaVersion: WORKSPACE_FILESYSTEM_OWNERSHIP_SCHEMA_VERSION,
    workspacePath: resolvedPath,
    ownership: input.ownership,
    materialization: input.materialization,
    directoryIdentity: {
      device: directoryStat.dev.toString(),
      inode: directoryStat.ino.toString()
    },
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return record;
}

/**
 * Missing, malformed, or path-mismatched evidence is intentionally treated as
 * unknown. Callers must preserve the directory in that case.
 */
export async function readWorkspaceFilesystemOwnership(workspacePath: string) {
  return readWorkspaceFilesystemOwnershipAtRoot(workspacePath, WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT);
}

export async function readWorkspaceFilesystemOwnershipAtRoot(
  workspacePath: string,
  rootPath = WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT
) {
  try {
    const parsed = JSON.parse(
      await readFile(workspaceFilesystemOwnershipPath(workspacePath, rootPath), "utf8")
    ) as Partial<WorkspaceFilesystemOwnershipRecord>;
    if (
      parsed.schemaVersion !== WORKSPACE_FILESYSTEM_OWNERSHIP_SCHEMA_VERSION ||
      typeof parsed.workspacePath !== "string" ||
      path.resolve(parsed.workspacePath) !== path.resolve(workspacePath) ||
      typeof parsed.ownership !== "string" ||
      !["agentos-created-empty", "agentos-created-clone", "user-selected-existing", "external-imported"].includes(parsed.ownership) ||
      typeof parsed.materialization !== "string" ||
      !parsed.directoryIdentity ||
      typeof parsed.directoryIdentity !== "object" ||
      typeof parsed.directoryIdentity.device !== "string" ||
      typeof parsed.directoryIdentity.inode !== "string"
    ) {
      return null;
    }

    const directoryStat = await lstat(path.resolve(workspacePath), { bigint: true });
    if (
      !directoryStat.isDirectory() ||
      directoryStat.dev.toString() !== parsed.directoryIdentity.device ||
      directoryStat.ino.toString() !== parsed.directoryIdentity.inode
    ) {
      return null;
    }

    return parsed as WorkspaceFilesystemOwnershipRecord;
  } catch {
    return null;
  }
}

export async function readWorkspaceDirectoryIdentity(workspacePath: string) {
  const directoryStat = await lstat(path.resolve(workspacePath), { bigint: true });
  if (!directoryStat.isDirectory()) {
    throw new Error("Workspace ownership can only be recorded for a directory.");
  }
  return {
    device: directoryStat.dev.toString(),
    inode: directoryStat.ino.toString()
  };
}

export async function removeWorkspaceFilesystemOwnership(
  workspacePath: string,
  rootPath = WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT
) {
  await rm(workspaceFilesystemOwnershipPath(workspacePath, rootPath), { force: true });
}

/**
 * Moves an ownership proof only after the renamed directory proves it is the
 * same device/inode. Missing evidence remains unknown and is never upgraded
 * into AgentOS ownership by a move.
 */
export async function migrateWorkspaceFilesystemOwnership(input: {
  fromPath: string;
  toPath: string;
  record: WorkspaceFilesystemOwnershipRecord | null | undefined;
  rootPath?: string;
}) {
  if (!input.record) {
    return {
      record: null,
      migrated: false,
      oldEvidenceRemoved: false
    };
  }

  const fromPath = path.resolve(input.fromPath);
  const toPath = path.resolve(input.toPath);
  if (path.resolve(input.record.workspacePath) !== fromPath) {
    throw new Error("Workspace ownership evidence does not match the move source.");
  }

  const directoryIdentity = await readWorkspaceDirectoryIdentity(toPath);
  if (
    directoryIdentity.device !== input.record.directoryIdentity.device ||
    directoryIdentity.inode !== input.record.directoryIdentity.inode
  ) {
    throw new Error("Workspace ownership evidence does not match the moved directory.");
  }

  const rootPath = input.rootPath ?? WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT;
  const migrated = await writeWorkspaceFilesystemOwnership(toPath, {
    ownership: input.record.ownership,
    materialization: input.record.materialization,
    recordedAt: input.record.recordedAt
  }, rootPath);
  await removeWorkspaceFilesystemOwnership(fromPath, rootPath);

  return {
    record: migrated,
    migrated: true,
    oldEvidenceRemoved: true
  };
}

async function syncDirectory(directoryPath: string) {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems do not permit syncing directories; the atomic rename remains the boundary.
  }
}

export function resolveWorkspaceFilesystemOwnership(
  record: WorkspaceFilesystemOwnershipRecord | null | undefined
): WorkspaceFilesystemOwnership {
  return record?.ownership ?? "unknown";
}
