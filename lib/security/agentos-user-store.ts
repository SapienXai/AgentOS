import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import {
  createPasswordSalt,
  hashPassword,
  validatePassword,
  verifyPasswordOrDummy
} from "@/lib/security/password-hashing";

export const AGENTOS_USER_STORE_FILE = "agentos-users.json";
export const AGENTOS_USER_STORE_VERSION = 1;

export type AgentOsUserRole = "owner" | "member";
export type AgentOsUserStatus = "active" | "disabled";
export type AgentOsOpenClawLinkageState = "unlinked" | "pending" | "linked" | "error";

export type AgentOsUserProfile = {
  displayName: string;
  email: string;
  avatarDataUrl: string | null;
};

export type AgentOsOpenClawLinkage = {
  profileId: string | null;
  role: string | null;
  linkageState: AgentOsOpenClawLinkageState;
  lastVerifiedAt: string | null;
};

export type AgentOsUser = {
  actorId: string;
  username: string;
  role: AgentOsUserRole;
  status: AgentOsUserStatus;
  passwordSalt: string;
  passwordHash: string;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
  profile: AgentOsUserProfile;
  openClaw: AgentOsOpenClawLinkage;
};

export type AgentOsUserStore = {
  version: 1;
  users: AgentOsUser[];
};

export type AgentOsUserSummary = Omit<AgentOsUser, "passwordSalt" | "passwordHash">;

type UserStoreErrorCode =
  | "invalid-input"
  | "conflict"
  | "not-found"
  | "last-owner"
  | "invalid-credentials"
  | "rate-limited"
  | "orphaned-security-state"
  | "linkage-conflict";

export class AgentOsUserStoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 429,
    readonly code: UserStoreErrorCode,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

type LoginRateEntry = { failures: number[]; lockedUntil: number };
const loginAttempts = new Map<string, LoginRateEntry>();
const userStoreMutationTails = new Map<string, Promise<void>>();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

export function resolveAgentOsUserStorePath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveAgentOsRuntimeDir(env), AGENTOS_USER_STORE_FILE);
}

export function normalizeAgentOsUsername(value: string) {
  const username = value.trim().toLocaleLowerCase("en-US");
  if (!username) throw new AgentOsUserStoreError("Username is required.", 400, "invalid-input");
  if (username.length > 128 || /[\u0000-\u001f\u007f/\\]/.test(username)) {
    throw new AgentOsUserStoreError(
      "Username must be 128 characters or fewer and cannot contain control or path-separator characters.",
      400,
      "invalid-input"
    );
  }
  return username;
}

export async function readAgentOsUserStore(env: NodeJS.ProcessEnv = process.env): Promise<AgentOsUserStore | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(await readFile(resolveAgentOsUserStorePath(env), "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error("AgentOS user account data is unavailable or invalid.");
  }
  return parseUserStore(payload);
}

async function writeAgentOsUserStore(store: AgentOsUserStore, env: NodeJS.ProcessEnv = process.env) {
  assertAgentOsUserStoreInvariants(store);
  const targetPath = resolveAgentOsUserStorePath(env);
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, targetPath);
  await chmod(targetPath, 0o600);
}

/**
 * Serialize account-store read/modify/write transactions for one AgentOS
 * runtime directory. Atomic rename protects readers, while this boundary
 * prevents same-process lost updates between concurrent account operations.
 */
export async function mutateAgentOsUserStore<T>(
  env: NodeJS.ProcessEnv,
  mutation: (store: AgentOsUserStore) => Promise<T> | T
) {
  return withAgentOsUserStoreLock(env, async () => {
    const store = await requireUserStore(env);
    const result = await mutation(store);
    assertAgentOsUserStoreInvariants(store);
    await writeAgentOsUserStore(store, env);
    return result;
  });
}

export async function createOwnerUserFromInstanceState(input: {
  actorId: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionVersion: number;
  profile?: Partial<AgentOsUserProfile>;
}, env: NodeJS.ProcessEnv = process.env) {
  return withAgentOsUserStoreLock(env, async () => {
    const existing = await readAgentOsUserStore(env);
    if (existing) {
      const owner = existing.users.find((user) => user.actorId === input.actorId);
      if (!owner || owner.role !== "owner" || owner.status !== "active") {
        throw new AgentOsUserStoreError(
          "Instance Protection and AgentOS user accounts refer to different security identities.",
          409,
          "orphaned-security-state"
        );
      }
      return existing;
    }
    const now = new Date().toISOString();
    const owner: AgentOsUser = {
      actorId: input.actorId,
      username: normalizeAgentOsUsername(input.username),
      role: "owner",
      status: "active",
      passwordSalt: input.passwordSalt,
      passwordHash: input.passwordHash,
      sessionVersion: Number.isSafeInteger(input.sessionVersion) && input.sessionVersion > 0 ? input.sessionVersion : 1,
      createdAt: now,
      updatedAt: now,
      profile: {
        displayName: readString(input.profile?.displayName),
        email: readString(input.profile?.email).toLocaleLowerCase("en-US"),
        avatarDataUrl: typeof input.profile?.avatarDataUrl === "string" ? input.profile.avatarDataUrl : null
      },
      openClaw: emptyOpenClawLinkage()
    };
    const store: AgentOsUserStore = { version: AGENTOS_USER_STORE_VERSION, users: [owner] };
    await writeAgentOsUserStore(store, env);
    return store;
  });
}

export async function getAgentOsUserByActorId(actorId: string, env: NodeJS.ProcessEnv = process.env) {
  const store = await readAgentOsUserStore(env);
  return store?.users.find((user) => user.actorId === actorId) ?? null;
}

export async function getAgentOsUserByUsername(username: string, env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeAgentOsUsername(username);
  const store = await readAgentOsUserStore(env);
  return store?.users.find((user) => user.username === normalized) ?? null;
}

export function summarizeAgentOsUser(user: AgentOsUser): AgentOsUserSummary {
  return {
    actorId: user.actorId,
    username: user.username,
    role: user.role,
    status: user.status,
    sessionVersion: user.sessionVersion,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile: user.profile,
    openClaw: user.openClaw
  };
}

export async function authenticateAgentOsUser(input: {
  username: string;
  password: string;
  rateKey: string;
}, env: NodeJS.ProcessEnv = process.env) {
  const normalized = input.username.trim().toLocaleLowerCase("en-US") || "<empty>";
  assertLoginAllowed(normalized, input.rateKey);
  const user = await getAgentOsUserByUsernameSafe(input.username, env);
  const passwordMatches = await verifyPasswordOrDummy(input.password, user?.passwordSalt, user?.passwordHash);
  if (!user || user.status !== "active" || !passwordMatches) {
    recordLoginFailure(normalized, input.rateKey);
    throw new AgentOsUserStoreError("Invalid username or password.", 401, "invalid-credentials");
  }
  loginAttempts.delete(loginAttemptKey(normalized, input.rateKey));
  return user;
}

export async function createAgentOsUser(input: {
  username: string;
  password: string;
  role?: AgentOsUserRole;
  profile?: Partial<AgentOsUserProfile>;
}, env: NodeJS.ProcessEnv = process.env) {
  validatePasswordForStore(input.password);
  const username = normalizeAgentOsUsername(input.username);
  return mutateAgentOsUserStore(env, async (store) => {
    if (store.users.some((user) => user.username === username)) {
      throw new AgentOsUserStoreError("That username is already in use.", 409, "conflict");
    }
    const now = new Date().toISOString();
    const passwordSalt = createPasswordSalt();
    const user: AgentOsUser = {
      actorId: randomUUID(),
      username,
      role: input.role ?? "member",
      status: "active",
      passwordSalt,
      passwordHash: await hashPassword(input.password, passwordSalt),
      sessionVersion: 1,
      createdAt: now,
      updatedAt: now,
      profile: {
        displayName: readString(input.profile?.displayName),
        email: readString(input.profile?.email).toLocaleLowerCase("en-US"),
        avatarDataUrl: typeof input.profile?.avatarDataUrl === "string" ? input.profile.avatarDataUrl : null
      },
      openClaw: emptyOpenClawLinkage()
    };
    store.users.push(user);
    return user;
  });
}

export async function updateAgentOsUserRole(actorId: string, role: AgentOsUserRole, env: NodeJS.ProcessEnv = process.env) {
  return mutateAgentOsUserStore(env, (store) => {
    const user = findUserOrThrow(store, actorId);
    if (user.role === "owner" && role !== "owner" && countActiveOwners(store) <= 1) {
      throw new AgentOsUserStoreError("At least one active owner is required.", 409, "last-owner");
    }
    if (user.role !== role) {
      user.role = role;
      user.sessionVersion += 1;
      user.updatedAt = new Date().toISOString();
    }
    return user;
  });
}

export async function setAgentOsUserStatus(actorId: string, status: AgentOsUserStatus, env: NodeJS.ProcessEnv = process.env) {
  return mutateAgentOsUserStore(env, (store) => {
    const user = findUserOrThrow(store, actorId);
    if (user.status === "active" && status === "disabled" && user.role === "owner" && countActiveOwners(store) <= 1) {
      throw new AgentOsUserStoreError("At least one active owner is required.", 409, "last-owner");
    }
    if (user.status !== status) {
      user.status = status;
      user.sessionVersion += 1;
      user.updatedAt = new Date().toISOString();
    }
    return user;
  });
}

export async function setAgentOsUserPassword(actorId: string, password: string, env: NodeJS.ProcessEnv = process.env) {
  validatePasswordForStore(password);
  return mutateAgentOsUserStore(env, async (store) => {
    const user = findUserOrThrow(store, actorId);
    user.passwordSalt = createPasswordSalt();
    user.passwordHash = await hashPassword(password, user.passwordSalt);
    user.sessionVersion += 1;
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

export async function updateAgentOsUserProfile(actorId: string, profile: AgentOsUserProfile, env: NodeJS.ProcessEnv = process.env) {
  return mutateAgentOsUserStore(env, (store) => {
    const user = findUserOrThrow(store, actorId);
    user.profile = {
      displayName: profile.displayName.trim(),
      email: profile.email.trim().toLocaleLowerCase("en-US"),
      avatarDataUrl: profile.avatarDataUrl
    };
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

export async function updateAgentOsUserOpenClawLinkage(input: {
  actorId: string;
  profileId: string | null;
  role: string | null;
  linkageState: AgentOsOpenClawLinkageState;
  lastVerifiedAt?: string | null;
}, env: NodeJS.ProcessEnv = process.env) {
  return mutateAgentOsUserStore(env, (store) => {
    const user = findUserOrThrow(store, input.actorId);
    if (input.profileId && store.users.some((entry) => entry.actorId !== input.actorId && entry.openClaw.profileId === input.profileId)) {
      throw new AgentOsUserStoreError("That OpenClaw profile is already linked to another AgentOS user.", 409, "linkage-conflict");
    }
    user.openClaw = {
      profileId: input.profileId,
      role: input.role,
      linkageState: input.linkageState,
      lastVerifiedAt: input.lastVerifiedAt === undefined ? new Date().toISOString() : input.lastVerifiedAt
    };
    user.updatedAt = new Date().toISOString();
    return user;
  });
}

export async function updateAgentOsUserCredentials(input: {
  actorId: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionVersion: number;
  updatedAt?: string;
}, env: NodeJS.ProcessEnv = process.env) {
  const username = normalizeAgentOsUsername(input.username);
  if (!Number.isSafeInteger(input.sessionVersion) || input.sessionVersion <= 0) {
    throw new AgentOsUserStoreError("User session version is invalid.", 400, "invalid-input");
  }
  return mutateAgentOsUserStore(env, (store) => {
    const user = findUserOrThrow(store, input.actorId);
    if (store.users.some((entry) => entry.actorId !== input.actorId && entry.username === username)) {
      throw new AgentOsUserStoreError("That username is already in use.", 409, "conflict");
    }
    user.username = username;
    user.passwordSalt = input.passwordSalt;
    user.passwordHash = input.passwordHash;
    user.sessionVersion = input.sessionVersion;
    user.updatedAt = input.updatedAt ?? new Date().toISOString();
    return user;
  });
}

export function emptyOpenClawLinkage(): AgentOsOpenClawLinkage {
  return { profileId: null, role: null, linkageState: "unlinked", lastVerifiedAt: null };
}

async function requireUserStore(env: NodeJS.ProcessEnv) {
  const store = await readAgentOsUserStore(env);
  if (!store) throw new AgentOsUserStoreError("AgentOS user accounts are not initialized.", 409, "not-found");
  return store;
}

async function withAgentOsUserStoreLock<T>(env: NodeJS.ProcessEnv, operation: () => Promise<T> | T) {
  const key = resolveAgentOsUserStorePath(env);
  const previous = userStoreMutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  userStoreMutationTails.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (userStoreMutationTails.get(key) === current) userStoreMutationTails.delete(key);
  }
}

async function getAgentOsUserByUsernameSafe(username: string, env: NodeJS.ProcessEnv) {
  const normalized = username.trim().toLocaleLowerCase("en-US");
  const store = await readAgentOsUserStore(env);
  return store?.users.find((user) => user.username === normalized) ?? null;
}

function parseUserStore(payload: unknown): AgentOsUserStore {
  if (!payload || typeof payload !== "object") throw new Error("AgentOS user account data is unavailable or invalid.");
  const value = payload as { version?: unknown; users?: unknown };
  if (value.version !== AGENTOS_USER_STORE_VERSION || !Array.isArray(value.users)) {
    throw new Error("AgentOS user account data is unavailable or invalid.");
  }
  const users = value.users.map(parseUser);
  const usernames = new Set<string>();
  const actorIds = new Set<string>();
  for (const user of users) {
    if (usernames.has(user.username) || actorIds.has(user.actorId)) throw new Error("AgentOS user account data is unavailable or invalid.");
    usernames.add(user.username);
    actorIds.add(user.actorId);
  }
  if (users.filter((user) => user.status === "active" && user.role === "owner").length === 0) {
    throw new Error("AgentOS user account data is unavailable or invalid.");
  }
  return { version: AGENTOS_USER_STORE_VERSION, users };
}

export function assertAgentOsUserStoreInvariants(store: AgentOsUserStore) {
  parseUserStore(store);
}

function parseUser(value: unknown): AgentOsUser {
  if (!value || typeof value !== "object") throw new Error("AgentOS user account data is unavailable or invalid.");
  const input = value as Partial<AgentOsUser>;
  const sessionVersion = input.sessionVersion;
  if (!isStableActorId(input.actorId) || typeof input.username !== "string" || normalizeForParse(input.username) !== input.username ||
    (input.role !== "owner" && input.role !== "member") || (input.status !== "active" && input.status !== "disabled") ||
    typeof input.passwordSalt !== "string" || typeof input.passwordHash !== "string" || !Number.isSafeInteger(sessionVersion) || (sessionVersion as number) <= 0 ||
    typeof input.createdAt !== "string" || typeof input.updatedAt !== "string") {
    throw new Error("AgentOS user account data is unavailable or invalid.");
  }
  const profile = input.profile as Partial<AgentOsUserProfile> | undefined;
  const openClaw = input.openClaw as Partial<AgentOsOpenClawLinkage> | undefined;
  if (!profile || typeof profile.displayName !== "string" || typeof profile.email !== "string" ||
    (profile.avatarDataUrl !== null && typeof profile.avatarDataUrl !== "string") || !openClaw ||
    (typeof openClaw.profileId !== "string" && openClaw.profileId !== null) ||
    (typeof openClaw.role !== "string" && openClaw.role !== null) ||
    !["unlinked", "pending", "linked", "error"].includes(openClaw.linkageState as string) ||
    (openClaw.lastVerifiedAt !== null && typeof openClaw.lastVerifiedAt !== "string")) {
    throw new Error("AgentOS user account data is unavailable or invalid.");
  }
  return {
    actorId: input.actorId,
    username: input.username,
    role: input.role as AgentOsUserRole,
    status: input.status as AgentOsUserStatus,
    passwordSalt: input.passwordSalt,
    passwordHash: input.passwordHash,
    sessionVersion: input.sessionVersion as number,
    createdAt: input.createdAt as string,
    updatedAt: input.updatedAt as string,
    profile: {
      displayName: profile.displayName,
      email: profile.email,
      avatarDataUrl: profile.avatarDataUrl
    },
    openClaw: {
      profileId: openClaw.profileId,
      role: openClaw.role,
      linkageState: openClaw.linkageState as AgentOsOpenClawLinkageState,
      lastVerifiedAt: openClaw.lastVerifiedAt
    }
  };
}

function normalizeForParse(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function findUserOrThrow(store: AgentOsUserStore, actorId: string) {
  const user = store.users.find((entry) => entry.actorId === actorId);
  if (!user) throw new AgentOsUserStoreError("User was not found.", 404, "not-found");
  return user;
}

function countActiveOwners(store: AgentOsUserStore) {
  return store.users.filter((user) => user.status === "active" && user.role === "owner").length;
}

function validatePasswordForStore(password: string) {
  try {
    validatePassword(password);
  } catch (error) {
    throw new AgentOsUserStoreError(error instanceof Error ? error.message : "Password is invalid.", 400, "invalid-input");
  }
}

function assertLoginAllowed(username: string, rateKey: string) {
  const entry = loginAttempts.get(loginAttemptKey(username, rateKey));
  if (!entry || entry.lockedUntil <= Date.now()) return;
  throw new AgentOsUserStoreError(
    "Too many login attempts. Try again later.",
    429,
    "rate-limited",
    Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 1000))
  );
}

function recordLoginFailure(username: string, rateKey: string) {
  const now = Date.now();
  const key = loginAttemptKey(username, rateKey);
  const current = loginAttempts.get(key) ?? { failures: [], lockedUntil: 0 };
  const failures = current.failures.filter((timestamp) => timestamp > now - LOGIN_WINDOW_MS);
  failures.push(now);
  loginAttempts.set(key, { failures, lockedUntil: failures.length >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCK_MS : 0 });
}

function loginAttemptKey(username: string, rateKey: string) {
  return `${rateKey.trim() || "local"}:${username}`;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isStableActorId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
