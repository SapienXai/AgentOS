import "server-only";

import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";

export const AGENTOS_RUNTIME_DIRECTORY_NAMES = ["run", "cache", "reset-plans"] as const;
export const AGENTOS_RUNTIME_FILE_NAMES = [
  "api-token",
  "instance-protection.json",
  "agentos-users.json",
  "operator-profile.json",
  "openclaw-gateway-auth.json",
  "agentos-audit.jsonl"
] as const;

/**
 * Returns the AgentOS-owned runtime locations that Full Uninstall may touch.
 * The package directory is intentionally absent: an installed server may
 * still be executing code from it until the deferred package step runs.
 */
export function listAgentOsRuntimeCleanupPaths(env: NodeJS.ProcessEnv = process.env) {
  const root = resolveAgentOsRuntimeDir(env);

  return [
    ...AGENTOS_RUNTIME_FILE_NAMES.map((name) => path.join(root, name)),
    ...AGENTOS_RUNTIME_DIRECTORY_NAMES.map((name) => path.join(root, name))
  ];
}

/**
 * Remove only the allowlisted AgentOS runtime files and known generated
 * entries. Unknown files in the runtime root remain untouched.
 */
export async function removeAgentOsRuntimeState(env: NodeJS.ProcessEnv = process.env) {
  const root = resolveAgentOsRuntimeDir(env);
  const removedPaths: string[] = [];

  for (const name of AGENTOS_RUNTIME_FILE_NAMES) {
    const targetPath = path.join(root, name);
    if (await removeFile(targetPath)) removedPaths.push(targetPath);
  }

  const runRoot = path.join(root, "run");
  for (const entry of await readdir(runRoot).catch(() => [] as string[])) {
    if (!/^agentos-[^/]+\.json$/.test(entry)) continue;
    const targetPath = path.join(runRoot, entry);
    if (await removeFile(targetPath)) removedPaths.push(targetPath);
  }

  const updateCachePath = path.join(root, "cache", "update-check.json");
  if (await removeFile(updateCachePath)) removedPaths.push(updateCachePath);

  const resetPlansRoot = path.join(root, "reset-plans");
  for (const entry of await readdir(resetPlansRoot).catch(() => [] as string[])) {
    if (!/^[0-9a-f-]{36}\.(?:json|active)$/.test(entry)) continue;
    const targetPath = path.join(resetPlansRoot, entry);
    if (await removeFile(targetPath)) removedPaths.push(targetPath);
  }

  for (const directoryName of AGENTOS_RUNTIME_DIRECTORY_NAMES) {
    await removeDirectoryIfEmpty(path.join(root, directoryName));
  }
  await removeDirectoryIfEmpty(root);

  return removedPaths;
}

async function removeFile(targetPath: string) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }

  try {
    await rm(targetPath, { force: true });
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function removeDirectoryIfEmpty(targetPath: string) {
  try {
    await rmdir(targetPath);
  } catch (error) {
    if (isMissingPathError(error) || isNotEmptyError(error)) return;
    throw error;
  }
}

function isMissingPathError(error: unknown) {
  return isNodeError(error, "ENOENT");
}

function isNotEmptyError(error: unknown) {
  return isNodeError(error, "ENOTEMPTY") || isNodeError(error, "EEXIST");
}

function isNodeError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
