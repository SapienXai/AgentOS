import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
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

export function workspaceFilesystemOwnershipPath(workspacePath: string) {
  const digest = createHash("sha256").update(path.resolve(workspacePath)).digest("hex");
  return path.join(path.resolve(WORKSPACE_FILESYSTEM_OWNERSHIP_ROOT), `${digest}.json`);
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
  }
) {
  const resolvedPath = path.resolve(workspacePath);
  const directoryStat = await lstat(resolvedPath, { bigint: true });
  if (!directoryStat.isDirectory()) {
    throw new Error("Workspace ownership can only be recorded for a directory.");
  }
  const filePath = workspaceFilesystemOwnershipPath(resolvedPath);
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
  await rename(temporaryPath, filePath);
  return record;
}

/**
 * Missing, malformed, or path-mismatched evidence is intentionally treated as
 * unknown. Callers must preserve the directory in that case.
 */
export async function readWorkspaceFilesystemOwnership(workspacePath: string) {
  try {
    const parsed = JSON.parse(
      await readFile(workspaceFilesystemOwnershipPath(workspacePath), "utf8")
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

export function resolveWorkspaceFilesystemOwnership(
  record: WorkspaceFilesystemOwnershipRecord | null | undefined
): WorkspaceFilesystemOwnership {
  return record?.ownership ?? "unknown";
}
