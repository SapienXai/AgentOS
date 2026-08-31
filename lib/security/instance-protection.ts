import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import {
  createPasswordSalt,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
  verifyPasswordOrDummy
} from "@/lib/security/password-hashing";
import {
  createOwnerUserFromInstanceState,
  normalizeAgentOsUsername,
  readAgentOsUserStore,
  writeAgentOsUserStore
} from "@/lib/security/agentos-user-store";

export const INSTANCE_PROTECTION_COOKIE = "agentos_instance_session";
export const INSTANCE_PROTECTION_FILE = "instance-protection.json";
export const INSTANCE_SESSION_TTL_SECONDS = 12 * 60 * 60;
export const INSTANCE_PASSWORD_MIN_LENGTH = 8;

const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

export type InstanceProtectionState = {
  version: 2;
  enabled: true;
  actorId: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  sessionSecret: string;
  sessionVersion: number;
  updatedAt: string;
};

export type InstanceProtectionStatus = {
  protectionEnabled: boolean;
  authenticated: boolean;
  username: string | null;
  credentialConfigured: boolean;
  actorId?: string | null;
  role?: "owner" | "member" | null;
};

type LoginRateEntry = {
  failures: number[];
  lockedUntil: number;
};

const loginAttempts = new Map<string, LoginRateEntry>();

export function resolveInstanceProtectionPath(env: NodeJS.ProcessEnv = process.env) {
  return join(resolveAgentOsRuntimeDir(env), INSTANCE_PROTECTION_FILE);
}

export async function readInstanceProtectionState(
  env: NodeJS.ProcessEnv = process.env
): Promise<InstanceProtectionState | null> {
  let raw: string;
  try {
    raw = await readFile(resolveInstanceProtectionPath(env), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error("Instance Protection state could not be read.");
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Omit<InstanceProtectionState, "version">> & { version?: unknown };
    if (
      parsed.enabled !== true ||
      typeof parsed.username !== "string" ||
      !parsed.username.trim() ||
      typeof parsed.passwordSalt !== "string" ||
      typeof parsed.passwordHash !== "string" ||
      typeof parsed.sessionSecret !== "string" ||
      !Number.isSafeInteger(parsed.sessionVersion) ||
      typeof parsed.updatedAt !== "string"
    ) {
      throw new Error("Instance Protection state is invalid.");
    }

    if (parsed.version === 1) {
      const migratedState: InstanceProtectionState = {
        version: 2,
        enabled: true,
        actorId: randomUUID(),
        username: parsed.username,
        passwordSalt: parsed.passwordSalt,
        passwordHash: parsed.passwordHash,
        sessionSecret: parsed.sessionSecret,
        sessionVersion: parsed.sessionVersion as number,
        updatedAt: new Date().toISOString()
      };
      await writeInstanceProtectionState(migratedState, env);
      return migratedState;
    }

    if (parsed.version !== 2 || !isStableActorId(parsed.actorId)) {
      throw new Error("Instance Protection state is invalid.");
    }

    return parsed as InstanceProtectionState;
  } catch (error) {
    if (error instanceof Error && error.message === "Instance Protection state is invalid.") throw error;
    throw new Error("Instance Protection state is invalid.");
  }
}

export async function getInstanceProtectionStatus(
  cookieValue: string | null,
  env: NodeJS.ProcessEnv = process.env
): Promise<InstanceProtectionStatus> {
  const state = await readInstanceProtectionState(env);
  if (!state) {
    return {
      protectionEnabled: false,
      authenticated: true,
      username: null,
      credentialConfigured: false
    };
  }

  const sessionIdentity = readInstanceSessionIdentity(cookieValue, state);
  const userStore = await readAgentOsUserStore(env) ?? await ensureAgentOsUserStoreForMigration(env);
  const sessionUser = sessionIdentity
    ? userStore?.users.find((entry) => entry.actorId === sessionIdentity.actorId) ?? null
    : null;

  return {
    protectionEnabled: true,
    authenticated: await isActiveInstanceSession(cookieValue, state, env),
    username: sessionUser?.username ?? state.username,
    credentialConfigured: true,
    actorId: sessionIdentity?.actorId ?? null,
    role: sessionUser?.role ?? await resolveInstanceSessionRole(cookieValue, state, env)
  };
}

export async function enableInstanceProtection(
  input: { username: string; password: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const existing = await readInstanceProtectionState(env);
  if (existing) {
    throw new InstanceProtectionError("Protection is already enabled.", 409, "already-enabled");
  }

  const username = validateUsername(input.username);
  validatePassword(input.password);
  const passwordSalt = createPasswordSalt();
  const passwordHash = await hashPassword(input.password, passwordSalt);
  const state: InstanceProtectionState = {
    version: 2,
    enabled: true,
    actorId: randomUUID(),
    username,
    passwordSalt,
    passwordHash,
    sessionSecret: randomBytes(32).toString("base64url"),
    sessionVersion: 1,
    updatedAt: new Date().toISOString()
  };

  await writeInstanceProtectionState(state, env);
  await createOwnerUserFromInstanceState(state, env);
  const session = createInstanceSession(state);
  return { status: await getInstanceProtectionStatus(session, env), session };
}

export async function loginToInstance(
  input: { username: string; password: string; rateKey: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const state = await readInstanceProtectionState(env);
  const attemptKey = input.username.trim().toLocaleLowerCase("en-US") || "<empty>";
  assertLoginAllowed(attemptKey);

  let userStore = await readAgentOsUserStore(env);
  if (!userStore && state) {
    userStore = await ensureAgentOsUserStoreForMigration(env);
  }
  const user = userStore?.users.find((entry) => entry.username === input.username.trim().toLocaleLowerCase("en-US"));
  const passwordMatches = await verifyPasswordOrDummy(input.password, user?.passwordSalt ?? state?.passwordSalt, user?.passwordHash ?? state?.passwordHash);
  const usernameMatches = Boolean(state && user
    ? constantTimeTextEqual(input.username.trim().toLocaleLowerCase("en-US"), user.username)
    : state && constantTimeTextEqual(input.username.trim(), state.username));

  if (!state || !usernameMatches || !passwordMatches || !user || user.status !== "active") {
    recordLoginFailure(attemptKey);
    throw new InstanceProtectionError("Invalid username or password.", 401, "invalid-credentials");
  }

  loginAttempts.delete(attemptKey);
  const session = createInstanceSession(state, user.actorId, user.sessionVersion);
  return { status: await getInstanceProtectionStatus(session, env), session };
}

export async function updateInstanceCredentials(
  input: { username: string; currentPassword: string; newPassword?: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const state = await requireState(env);
  if (!(await verifyPassword(input.currentPassword, state.passwordSalt, state.passwordHash))) {
    throw new InstanceProtectionError("Current password is incorrect.", 401, "invalid-current-password");
  }

  const username = validateUsername(input.username);
  const nextPassword = input.newPassword?.length ? input.newPassword : null;
  if (nextPassword) {
    validatePassword(nextPassword);
  }

  const passwordSalt = nextPassword ? createPasswordSalt() : state.passwordSalt;
  const passwordHash = nextPassword ? await hashPassword(nextPassword, passwordSalt) : state.passwordHash;
  const nextState: InstanceProtectionState = {
    ...state,
    username,
    passwordSalt,
    passwordHash,
    // The state version is the instance-wide signing epoch. Per-user
    // credentials use the account store's sessionVersion so changing the
    // owner's password does not revoke unrelated team sessions.
    sessionVersion: state.sessionVersion,
    updatedAt: new Date().toISOString()
  };
  await writeInstanceProtectionState(nextState, env);
  const userStore = await readAgentOsUserStore(env) ?? await ensureAgentOsUserStoreForMigration(env);
  const owner = userStore?.users.find((user) => user.actorId === state.actorId);
  const ownerSessionVersion = (owner?.sessionVersion ?? state.sessionVersion) + 1;
  if (owner && userStore) {
    owner.username = username.toLocaleLowerCase("en-US");
    owner.passwordSalt = passwordSalt;
    owner.passwordHash = passwordHash;
    owner.sessionVersion = ownerSessionVersion;
    owner.updatedAt = nextState.updatedAt;
    await writeAgentOsUserStore(userStore, env);
  } else if (!userStore) {
    await createOwnerUserFromInstanceState({ ...nextState, sessionVersion: ownerSessionVersion }, env);
  }
  const session = createInstanceSession(nextState, state.actorId, ownerSessionVersion);
  return { status: await getInstanceProtectionStatus(session, env), session };
}

export async function disableInstanceProtection(
  currentPassword: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const state = await requireState(env);
  if (!(await verifyPassword(currentPassword, state.passwordSalt, state.passwordHash))) {
    throw new InstanceProtectionError("Current password is incorrect.", 401, "invalid-current-password");
  }

  await resetInstanceProtection(env);
}

export async function resetInstanceProtection(env: NodeJS.ProcessEnv = process.env) {
  await rm(resolveInstanceProtectionPath(env), { force: true });
}

export function verifyInstanceSession(cookieValue: string | null, state: InstanceProtectionState) {
  return Boolean(readInstanceSessionIdentity(cookieValue, state));
}

export function readInstanceSessionIdentity(cookieValue: string | null, state: InstanceProtectionState): {
  actorId: string;
  sessionVersion: number;
} | null {
  if (!cookieValue) return null;
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;
  const encodedPayload = cookieValue.slice(0, separator);
  const providedSignature = cookieValue.slice(separator + 1);
  const expectedSignature = signSessionPayload(encodedPayload, state.sessionSecret);
  if (!constantTimeTextEqual(providedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      exp?: unknown;
      version?: unknown;
      actorId?: unknown;
      sessionVersion?: unknown;
    };
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.version !== state.sessionVersion) return null;
    const actorId = typeof payload.actorId === "string" ? payload.actorId : state.actorId;
    const sessionVersion = typeof payload.sessionVersion === "number" ? payload.sessionVersion : state.sessionVersion;
    return Number.isSafeInteger(sessionVersion) ? { actorId, sessionVersion } : null;
  } catch {
    return null;
  }
}

export function buildInstanceSessionCookie(session: string, secure: boolean) {
  return `${INSTANCE_PROTECTION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${INSTANCE_SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function buildExpiredInstanceSessionCookie(secure: boolean) {
  return `${INSTANCE_PROTECTION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readInstanceSessionCookie(headers: Headers) {
  const cookieHeader = headers.get("cookie") ?? "";
  for (const entry of cookieHeader.split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name === INSTANCE_PROTECTION_COOKIE) {
      try {
        return decodeURIComponent(parts.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function isSecureRequest(request: { url: string; headers: Headers }) {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
}

export class InstanceProtectionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409 | 429,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

export function createInstanceSession(
  state: InstanceProtectionState,
  actorId = state.actorId,
  sessionVersion = state.sessionVersion
) {
  const encodedPayload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + INSTANCE_SESSION_TTL_SECONDS,
    version: state.sessionVersion,
    actorId,
    sessionVersion,
    nonce: randomBytes(16).toString("base64url")
  })).toString("base64url");
  return `${encodedPayload}.${signSessionPayload(encodedPayload, state.sessionSecret)}`;
}

function signSessionPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

async function writeInstanceProtectionState(state: InstanceProtectionState, env: NodeJS.ProcessEnv) {
  const targetPath = resolveInstanceProtectionPath(env);
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, targetPath);
  await chmod(targetPath, 0o600);
}

async function requireState(env: NodeJS.ProcessEnv) {
  const state = await readInstanceProtectionState(env);
  if (!state) {
    throw new InstanceProtectionError("Protection is not enabled.", 409, "not-enabled");
  }
  return state;
}

function validateUsername(value: string) {
  try {
    return normalizeAgentOsUsername(value);
  } catch (error) {
    throw new InstanceProtectionError(error instanceof Error ? error.message : "Username is invalid.", 400, "invalid-input");
  }
}

function validatePassword(value: string) {
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new InstanceProtectionError(`Password must be at least ${INSTANCE_PASSWORD_MIN_LENGTH} characters.`, 400, "invalid-input");
  }
  if (value.length > 1024) throw new InstanceProtectionError("Password is too long.", 400, "invalid-input");
}

function constantTimeTextEqual(left: string, right: string) {
  const leftDigest = createHmac("sha256", "agentos-constant-time").update(left).digest();
  const rightDigest = createHmac("sha256", "agentos-constant-time").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function assertLoginAllowed(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.lockedUntil <= now) return;
  const retryAfterSeconds = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
  throw new InstanceProtectionError("Too many login attempts. Try again later.", 429, "rate-limited", retryAfterSeconds);
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key) ?? { failures: [], lockedUntil: 0 };
  const failures = current.failures.filter((timestamp) => timestamp > now - LOGIN_WINDOW_MS);
  failures.push(now);
  loginAttempts.set(key, {
    failures,
    lockedUntil: failures.length >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCK_MS : 0
  });
}

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isStableActorId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function isActiveInstanceSession(cookieValue: string | null, state: InstanceProtectionState, env: NodeJS.ProcessEnv) {
  const identity = readInstanceSessionIdentity(cookieValue, state);
  if (!identity) return false;
  const store = await readAgentOsUserStore(env);
  const user = store?.users.find((entry) => entry.actorId === identity.actorId);
  return !user || (user.status === "active" && user.sessionVersion === identity.sessionVersion);
}

async function resolveInstanceSessionRole(cookieValue: string | null, state: InstanceProtectionState, env: NodeJS.ProcessEnv) {
  const identity = readInstanceSessionIdentity(cookieValue, state);
  if (!identity) return null;
  const store = await readAgentOsUserStore(env);
  return store?.users.find((entry) => entry.actorId === identity.actorId)?.role ?? "owner";
}

async function ensureAgentOsUserStoreForMigration(env: NodeJS.ProcessEnv) {
  const { ensureAgentOsUserStore } = await import("@/lib/agentos/application/agentos-account-service");
  return ensureAgentOsUserStore(env);
}
