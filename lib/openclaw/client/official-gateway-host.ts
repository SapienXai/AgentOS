import "server-only";

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import type {
  DeviceAuthTokenRecord,
  DeviceIdentity,
  GatewayClientHostDeps
} from "@openclaw/gateway-client";

import {
  publicKeyRawBase64UrlFromPem,
  resolveOpenClawStateDir,
  signDevicePayload
} from "@/lib/openclaw/client/native-ws-gateway-auth";
import { redactSecretText } from "@/lib/security/redaction";

export type AgentOsGatewayClientHostOptions = {
  stateDir?: string;
  /** Read-only is safe for probes; managed-write enables fenced token rotation. */
  sharedStateMode?: "read-only" | "managed-write";
  overrides?: GatewayClientHostDeps;
};

type DeviceIdentityFile = Partial<DeviceIdentity> & {
  deviceId?: unknown;
  privateKeyPem?: unknown;
  publicKeyPem?: unknown;
};

type DeviceAuthFile = {
  deviceId?: unknown;
  tokens?: Record<string, DeviceAuthTokenRecord | undefined>;
};

type DeviceAuthSnapshot = {
  token: string | null;
};

/**
 * Bridges the official package to AgentOS/OpenClaw state without making the
 * package aware of AgentOS storage. Identity creation is never delegated to
 * AgentOS here. Token writes require the explicit managed-write mode and are
 * fenced against the token observed by this host before the connect attempt.
 */
export function createAgentOsGatewayClientHostDeps(
  options: AgentOsGatewayClientHostOptions = {}
): GatewayClientHostDeps {
  const stateDir = options.stateDir ?? resolveOpenClawStateDir();
  const overrides = options.overrides ?? {};
  const managedWrite = options.sharedStateMode === "managed-write";
  const snapshots = new Map<string, DeviceAuthSnapshot>();

  const hostDeps: GatewayClientHostDeps = {
    loadOrCreateDeviceIdentity: () => readDeviceIdentity(stateDir),
    signDevicePayload,
    publicKeyRawBase64UrlFromPem,
    loadDeviceAuthToken: ({ deviceId, role }) => {
      const result = readDeviceAuthToken(stateDir, deviceId, role);
      snapshots.set(authSnapshotKey(deviceId, role), { token: result?.token ?? null });
      return result;
    },
    storeDeviceAuthToken: (params) => {
      if (!managedWrite) {
        return;
      }
      fencedStoreDeviceAuthToken(stateDir, params, snapshots);
    },
    clearDeviceAuthToken: (params) => {
      if (!managedWrite) {
        return;
      }
      fencedClearDeviceAuthToken(stateDir, params, snapshots);
    },
    beforeConnect: () => {},
    logDebug: () => {},
    logError: () => {},
    redactForLog: (message) => redactSecretText(message),
    // Callers may customize transport hooks and logging, but auth state hooks
    // below are always selected by the explicit shared-state policy.
    ...overrides
  };

  // Do not let arbitrary host-dependency overrides bypass the identity or
  // token policy. The official package must use these exact AgentOS hooks.
  hostDeps.loadOrCreateDeviceIdentity = () => readDeviceIdentity(stateDir);
  hostDeps.loadDeviceAuthToken = ({ deviceId, role }) => {
    const result = readDeviceAuthToken(stateDir, deviceId, role);
    snapshots.set(authSnapshotKey(deviceId, role), { token: result?.token ?? null });
    return result;
  };
  hostDeps.storeDeviceAuthToken = managedWrite
    ? (params) => fencedStoreDeviceAuthToken(stateDir, params, snapshots)
    : () => {};
  hostDeps.clearDeviceAuthToken = managedWrite
    ? (params) => fencedClearDeviceAuthToken(stateDir, params, snapshots)
    : () => {};
  hostDeps.redactForLog = (message) => redactSecretText(message);

  return hostDeps;
}

function readDeviceIdentity(stateDir: string): DeviceIdentity | undefined {
  if (canonicalStateDatabaseExists(stateDir)) {
    return readCanonicalDeviceIdentity(stateDir);
  }

  const value = readJson<DeviceIdentityFile>(join(stateDir, "identity", "device.json"));
  const deviceId = readString(value?.deviceId);
  const privateKeyPem = readString(value?.privateKeyPem);
  const publicKeyPem = readString(value?.publicKeyPem);

  if (!deviceId || !privateKeyPem || !publicKeyPem) {
    return undefined;
  }

  return { deviceId, privateKeyPem, publicKeyPem };
}

function readDeviceAuthToken(
  stateDir: string,
  deviceId: string,
  role: string
): DeviceAuthTokenRecord | null {
  if (canonicalStateDatabaseExists(stateDir)) {
    return readCanonicalDeviceAuthToken(stateDir, deviceId, role);
  }

  const value = readJson<DeviceAuthFile>(join(stateDir, "identity", "device-auth.json"));

  if (readString(value?.deviceId) !== deviceId) {
    return null;
  }

  const entry = value?.tokens?.[role];
  const token = readString(entry?.token);

  if (!token) {
    return null;
  }

  return {
    token,
    scopes: Array.isArray(entry?.scopes)
      ? entry.scopes.filter((scope): scope is string => typeof scope === "string")
      : undefined
  };
}

function fencedStoreDeviceAuthToken(
  stateDir: string,
  params: Parameters<NonNullable<GatewayClientHostDeps["storeDeviceAuthToken"]>>[0],
  snapshots: Map<string, DeviceAuthSnapshot>
) {
  if (canonicalStateDatabaseExists(stateDir)) {
    fencedStoreCanonicalDeviceAuthToken(stateDir, params, snapshots);
    return;
  }

  const key = authSnapshotKey(params.deviceId, params.role);
  withDeviceAuthFileLock(stateDir, () => {
    const current = readDeviceAuthToken(stateDir, params.deviceId, params.role);
    const expected = snapshots.get(key)?.token ?? null;
    if ((current?.token ?? null) !== expected) {
      return;
    }

    const file = readJson<DeviceAuthFile>(join(stateDir, "identity", "device-auth.json")) ?? {};
    const tokens = isRecord(file.tokens) ? { ...file.tokens } : {};
    tokens[params.role.trim()] = {
      token: params.token,
      scopes: [...params.scopes]
    };
    writeDeviceAuthFile(stateDir, {
      ...file,
      deviceId: params.deviceId,
      tokens
    });
    snapshots.set(key, { token: params.token });
  });
}

function fencedClearDeviceAuthToken(
  stateDir: string,
  params: Parameters<NonNullable<GatewayClientHostDeps["clearDeviceAuthToken"]>>[0],
  snapshots: Map<string, DeviceAuthSnapshot>
) {
  if (canonicalStateDatabaseExists(stateDir)) {
    fencedClearCanonicalDeviceAuthToken(stateDir, params, snapshots);
    return;
  }

  const key = authSnapshotKey(params.deviceId, params.role);
  withDeviceAuthFileLock(stateDir, () => {
    const current = readDeviceAuthToken(stateDir, params.deviceId, params.role);
    const expected = snapshots.get(key)?.token ?? null;
    if ((current?.token ?? null) !== expected) {
      return;
    }

    const file = readJson<DeviceAuthFile>(join(stateDir, "identity", "device-auth.json"));
    if (!file || !isRecord(file.tokens)) {
      snapshots.set(key, { token: null });
      return;
    }

    const tokens = { ...file.tokens };
    delete tokens[params.role.trim()];
    writeDeviceAuthFile(stateDir, { ...file, tokens });
    snapshots.set(key, { token: null });
  });
}

type CanonicalDeviceIdentityRow = {
  device_id?: unknown;
  public_key_pem?: unknown;
  private_key_pem?: unknown;
};

type CanonicalDeviceAuthRow = {
  token?: unknown;
  scopes_json?: unknown;
};

function canonicalStateDatabasePath(stateDir: string) {
  return join(stateDir, "state", "openclaw.sqlite");
}

function canonicalStateDatabaseExists(stateDir: string) {
  return existsSync(canonicalStateDatabasePath(stateDir));
}

function readCanonicalDeviceIdentity(stateDir: string): DeviceIdentity | undefined {
  const row = withCanonicalStateDatabase(stateDir, (db) => db
    .prepare("SELECT device_id, public_key_pem, private_key_pem FROM device_identities WHERE identity_key = ?")
    .get("primary") as CanonicalDeviceIdentityRow | undefined, { readOnly: true });
  const deviceId = readString(row?.device_id);
  const privateKeyPem = readString(row?.private_key_pem);
  const publicKeyPem = readString(row?.public_key_pem);
  if (!deviceId || !privateKeyPem || !publicKeyPem) {
    return undefined;
  }

  try {
    const publicKeyRaw = Buffer.from(publicKeyRawBase64UrlFromPem(publicKeyPem), "base64url");
    const derivedDeviceId = createHash("sha256").update(publicKeyRaw).digest("hex");
    return derivedDeviceId === deviceId ? { deviceId, privateKeyPem, publicKeyPem } : undefined;
  } catch {
    return undefined;
  }
}

function readCanonicalDeviceAuthToken(
  stateDir: string,
  deviceId: string,
  role: string
): DeviceAuthTokenRecord | null {
  const row = withCanonicalStateDatabase(stateDir, (db) => db
    .prepare("SELECT token, scopes_json FROM device_auth_tokens WHERE device_id = ? AND role = ?")
    .get(deviceId, role.trim()) as CanonicalDeviceAuthRow | undefined, { readOnly: true });
  const token = readString(row?.token);
  if (!token) {
    return null;
  }

  return {
    token,
    scopes: parseScopes(row?.scopes_json)
  };
}

function fencedStoreCanonicalDeviceAuthToken(
  stateDir: string,
  params: Parameters<NonNullable<GatewayClientHostDeps["storeDeviceAuthToken"]>>[0],
  snapshots: Map<string, DeviceAuthSnapshot>
) {
  const key = authSnapshotKey(params.deviceId, params.role);
  withCanonicalStateDatabase(stateDir, (db) => {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db
        .prepare("SELECT token FROM device_auth_tokens WHERE device_id = ? AND role = ?")
        .get(params.deviceId, params.role.trim()) as { token?: unknown } | undefined;
      const expected = snapshots.get(key)?.token ?? null;
      if ((readString(current?.token) ?? null) !== expected) {
        db.exec("ROLLBACK");
        return;
      }

      if (current) {
        db.prepare("UPDATE device_auth_tokens SET token = ?, scopes_json = ?, updated_at_ms = ? WHERE device_id = ? AND role = ? AND token = ?")
          .run(params.token, JSON.stringify(params.scopes), Date.now(), params.deviceId, params.role.trim(), expected);
      } else {
        db.prepare("INSERT INTO device_auth_tokens (device_id, role, token, scopes_json, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
          .run(params.deviceId, params.role.trim(), params.token, JSON.stringify(params.scopes), Date.now());
      }
      db.exec("COMMIT");
      snapshots.set(key, { token: params.token });
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original SQLite failure.
      }
      throw error;
    }
  });
}

function fencedClearCanonicalDeviceAuthToken(
  stateDir: string,
  params: Parameters<NonNullable<GatewayClientHostDeps["clearDeviceAuthToken"]>>[0],
  snapshots: Map<string, DeviceAuthSnapshot>
) {
  const key = authSnapshotKey(params.deviceId, params.role);
  withCanonicalStateDatabase(stateDir, (db) => {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db
        .prepare("SELECT token FROM device_auth_tokens WHERE device_id = ? AND role = ?")
        .get(params.deviceId, params.role.trim()) as { token?: unknown } | undefined;
      const expected = snapshots.get(key)?.token ?? null;
      if ((readString(current?.token) ?? null) !== expected) {
        db.exec("ROLLBACK");
        return;
      }
      if (current) {
        db.prepare("DELETE FROM device_auth_tokens WHERE device_id = ? AND role = ? AND token = ?")
          .run(params.deviceId, params.role.trim(), expected);
      }
      db.exec("COMMIT");
      snapshots.set(key, { token: null });
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original SQLite failure.
      }
      throw error;
    }
  });
}

function withCanonicalStateDatabase<T>(
  stateDir: string,
  callback: (db: DatabaseSync) => T,
  options: { readOnly?: boolean } = {}
): T {
  const db = new DatabaseSync(canonicalStateDatabasePath(stateDir), options);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function parseScopes(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : undefined;
  } catch {
    return undefined;
  }
}

function writeDeviceAuthFile(stateDir: string, file: DeviceAuthFile) {
  const identityDir = join(stateDir, "identity");
  mkdirSync(identityDir, { recursive: true, mode: 0o700 });
  const authPath = join(identityDir, "device-auth.json");
  const temporaryPath = `${authPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, authPath);
}

function withDeviceAuthFileLock(stateDir: string, callback: () => void) {
  const identityDir = join(stateDir, "identity");
  mkdirSync(identityDir, { recursive: true, mode: 0o700 });
  const lockPath = join(identityDir, ".agentos-device-auth.lock");
  let descriptor: number | null = null;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      Atomics.wait(waitBuffer, 0, 0, 5);
    }
  }

  if (descriptor === null) {
    throw new Error("Timed out acquiring the AgentOS device-auth state lock.");
  }

  try {
    callback();
  } finally {
    closeSync(descriptor);
    try {
      unlinkSync(lockPath);
    } catch {
      // Another cleanup path may have removed an orphaned lock already.
    }
  }
}

function authSnapshotKey(deviceId: string, role: string) {
  return `${deviceId}\u0000${role.trim()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
