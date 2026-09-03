import "server-only";

import { readFileSync } from "node:fs";
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

export type AgentOsGatewayClientHostOptions = {
  stateDir?: string;
  sharedStateMode?: "read-only";
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

/**
 * Bridges the official package to AgentOS/OpenClaw state without making the
 * package aware of AgentOS storage. The default mode is deliberately
 * read-only: Phase 2 must not create identities or rotate shared credentials.
 */
export function createAgentOsGatewayClientHostDeps(
  options: AgentOsGatewayClientHostOptions = {}
): GatewayClientHostDeps {
  const stateDir = options.stateDir ?? resolveOpenClawStateDir();
  const overrides = options.overrides ?? {};

  const hostDeps: GatewayClientHostDeps = {
    loadOrCreateDeviceIdentity: () => readDeviceIdentity(stateDir),
    signDevicePayload,
    publicKeyRawBase64UrlFromPem,
    loadDeviceAuthToken: ({ deviceId, role }) => readDeviceAuthToken(stateDir, deviceId, role),
    storeDeviceAuthToken: () => {},
    clearDeviceAuthToken: () => {},
    beforeConnect: () => {},
    logDebug: () => {},
    logError: () => {},
    redactForLog: (message) => message,
    ...overrides
  };

  // Phase 2 is always read-only at this boundary. Do not let a caller
  // accidentally turn a shared-state transport into an identity/token writer
  // through an override; Phase 3 can introduce an explicit write policy.
  hostDeps.loadOrCreateDeviceIdentity = () => readDeviceIdentity(stateDir);
  hostDeps.storeDeviceAuthToken = () => {};
  hostDeps.clearDeviceAuthToken = () => {};

  return hostDeps;
}

function readDeviceIdentity(stateDir: string): DeviceIdentity | undefined {
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
