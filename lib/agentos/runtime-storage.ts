import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";

export const AGENTOS_MISSION_CONTROL_ROOT_ENV = "AGENTOS_MISSION_CONTROL_ROOT";
const MIGRATION_STATUS_PATH = path.join("updates", "storage-migration.json");
const MAX_MIGRATION_ENTRIES = 20_000;
const MAX_MIGRATION_BYTES = 256 * 1024 * 1024;

export type AgentOsStoragePreparation = {
  status: "ready" | "migrated" | "conflict" | "failed";
  persistent: boolean;
  checkedAt: string;
};

export function resolveAgentOsMissionControlRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
) {
  const configured = env[AGENTOS_MISSION_CONTROL_ROOT_ENV]?.trim();
  if (configured) return path.resolve(configured);

  if (env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase() === "railway") {
    return path.resolve(cwd, ".mission-control");
  }

  if (env.AGENTOS_PACKAGE_RUNTIME === "1") {
    const runtimeDir = env.AGENTOS_RUNTIME_DIR?.trim();
    if (runtimeDir) return path.join(resolveRuntimePath(runtimeDir), "mission-control");
  }

  return path.resolve(cwd, ".mission-control");
}

/**
 * Moves the known AgentOS sidecar root out of a replaceable packaged tree.
 * The old tree is retained; failures keep it as the active root and are
 * recorded outside the package so product updates can fail closed.
 */
export async function prepareAgentOsRuntimeStorage(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
} = {}): Promise<AgentOsStoragePreparation> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const packaged = env.AGENTOS_PACKAGE_RUNTIME === "1";
  const railway = env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase() === "railway";
  const explicitRoot = env[AGENTOS_MISSION_CONTROL_ROOT_ENV]?.trim();
  const persistent = packaged && !railway;
  const target = resolveAgentOsMissionControlRoot(env, cwd);
  const legacy = path.resolve(cwd, ".mission-control");

  if (!persistent || explicitRoot || legacy === target) {
    return writePreparation(env, { status: "ready", persistent, checkedAt: new Date().toISOString() });
  }

  try {
    const sourceState = await inspectTree(legacy);
    const targetState = await inspectTree(target);
    if (!sourceState.exists || sourceState.entries === 0) {
      return writePreparation(env, { status: "ready", persistent, checkedAt: new Date().toISOString() });
    }

    if (targetState.exists && targetState.entries > 0) {
      if (sameTree(sourceState.files, targetState.files)) {
        return writePreparation(env, { status: "migrated", persistent, checkedAt: new Date().toISOString() });
      }
      env[AGENTOS_MISSION_CONTROL_ROOT_ENV] = legacy;
      return writePreparation(env, { status: "conflict", persistent, checkedAt: new Date().toISOString() });
    }

    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    if (targetState.exists) await rmdir(target);
    const staging = `${target}.migration-${randomUUID()}`;
    try {
      await mkdir(staging, { mode: 0o700 });
      await copyTree(legacy, staging);
      const copied = await inspectTree(staging);
      if (!sameTree(sourceState.files, copied.files)) {
        throw new Error("The copied AgentOS sidecar did not match its source.");
      }
      await rename(staging, target);
      await chmod(target, 0o700).catch(() => {});
      return writePreparation(env, { status: "migrated", persistent, checkedAt: new Date().toISOString() });
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } catch {
    env[AGENTOS_MISSION_CONTROL_ROOT_ENV] = legacy;
    return writePreparation(env, { status: "failed", persistent, checkedAt: new Date().toISOString() });
  }
}

export async function readAgentOsStoragePreparation(env: NodeJS.ProcessEnv = process.env) {
  try {
    const payload = JSON.parse(await readFile(path.join(resolveAgentOsRuntimeDir(env), MIGRATION_STATUS_PATH), "utf8")) as Record<string, unknown>;
    if (
      (payload.status === "ready" || payload.status === "migrated" || payload.status === "conflict" || payload.status === "failed") &&
      typeof payload.persistent === "boolean" && typeof payload.checkedAt === "string"
    ) {
      return payload as AgentOsStoragePreparation;
    }
  } catch {
    // Missing status is treated as unavailable by update admission.
  }
  return null;
}

async function writePreparation(env: NodeJS.ProcessEnv, preparation: AgentOsStoragePreparation) {
  if (env.AGENTOS_RUNTIME_DIR?.trim()) {
    const filePath = path.join(resolveAgentOsRuntimeDir(env), MIGRATION_STATUS_PATH);
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(preparation)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporaryPath, 0o600).catch(() => {});
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600).catch(() => {});
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => {});
      return { ...preparation, status: "failed" as const };
    }
  }
  return preparation;
}

type TreeState = { exists: boolean; entries: number; files: Map<string, string> };

async function inspectTree(root: string): Promise<TreeState> {
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch (error) {
    if (isMissing(error)) return { exists: false, entries: 0, files: new Map() };
    throw error;
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("AgentOS sidecar root is not a real directory.");
  const files = new Map<string, string>();
  let bytes = 0;

  const visit = async (directory: string, relative: string): Promise<number> => {
    const children = await readdir(directory, { withFileTypes: true });
    let entries = 0;
    for (const child of children) {
      const childRelative = relative ? `${relative}/${child.name}` : child.name;
      const childPath = path.join(directory, child.name);
      const info = await lstat(childPath);
      if (info.isSymbolicLink()) throw new Error("AgentOS sidecar contains a symbolic link.");
      entries += 1;
      if (entries > MAX_MIGRATION_ENTRIES || files.size + entries > MAX_MIGRATION_ENTRIES) {
        throw new Error("AgentOS sidecar exceeds the migration entry limit.");
      }
      if (info.isDirectory()) {
        entries += await visit(childPath, childRelative);
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > MAX_MIGRATION_BYTES) throw new Error("AgentOS sidecar exceeds the migration size limit.");
        const content = await readFile(childPath);
        files.set(childRelative, createHash("sha256").update(content).digest("hex"));
      } else {
        throw new Error("AgentOS sidecar contains an unsupported filesystem entry.");
      }
      if (files.size + entries > MAX_MIGRATION_ENTRIES) throw new Error("AgentOS sidecar exceeds the migration entry limit.");
    }
    return entries;
  };

  const entries = await visit(root, "");
  return { exists: true, entries, files };
}

async function copyTree(source: string, destination: string) {
  const children = await readdir(source, { withFileTypes: true });
  for (const child of children) {
    const from = path.join(source, child.name);
    const to = path.join(destination, child.name);
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error("AgentOS sidecar contains a symbolic link.");
    if (info.isDirectory()) {
      await mkdir(to, { mode: 0o700 });
      await copyTree(from, to);
    } else if (info.isFile()) {
      await copyFile(from, to);
      await chmod(to, 0o600).catch(() => {});
    } else {
      throw new Error("AgentOS sidecar contains an unsupported filesystem entry.");
    }
  }
}

function sameTree(left: Map<string, string>, right: Map<string, string>) {
  return left.size === right.size && [...left].every(([file, digest]) => right.get(file) === digest);
}

function resolveRuntimePath(value: string) {
  return path.resolve(value.startsWith("~") ? path.join(process.env.HOME ?? "", value.slice(1)) : value);
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
