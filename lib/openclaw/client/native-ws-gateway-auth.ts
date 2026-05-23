import "server-only";

import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readAgentOsGatewayAuthCredential } from "@/lib/agentos/runtime-auth";
import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  DEFAULT_OPERATOR_SCOPES,
  ED25519_SPKI_PREFIX,
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION,
  OPENCLAW_DEVICE_AUTH_FILE_NAME,
  OPENCLAW_DEVICE_IDENTITY_FILE_NAME,
  SERVER_OPERATOR_CLIENT_ID,
  SERVER_OPERATOR_CLIENT_MODE,
  type ConnectParamsContext,
  type LocalDeviceAuth,
  type NativeWsOpenClawGatewayClientOptions
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  isRedactedOpenClawSecret,
  readConfigPath,
  readConfigString,
  readNonEmptyString
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/types";
import { isOpenClawInvalidConfigError } from "@/lib/openclaw/command-failure";

export async function resolveConfiguredGatewaySecret(
  fallback: OpenClawGatewayClient,
  paths: string[],
  options: OpenClawCommandOptions,
  configOptions: { readLocalConfigFile: boolean }
) {
  if (configOptions.readLocalConfigFile) {
    const localResult = await resolveConfiguredGatewaySecretFromLocalConfig(paths);

    if (localResult.fromConfigFile) {
      return localResult;
    }
  }

  for (const path of paths) {
    let rawValue: unknown = null;

    try {
      rawValue = await fallback.getConfig<unknown>(path, options);
    } catch (error) {
      if (isOpenClawInvalidConfigError(error)) {
        return {
          value: "",
          invalidConfig: true
        };
      }

      continue;
    }

    const value = readConfigString(rawValue);
    if (isRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        `${path} is configured but OpenClaw returned a redacted secret. Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD to enable native Gateway WS; using CLI fallback.`,
        "auth"
      );
    }
    if (value) {
      return {
        value,
        invalidConfig: false
      };
    }
  }

  return {
    value: "",
    invalidConfig: false
  };
}

export async function resolveConfiguredGatewaySecretFromLocalConfig(paths: string[]) {
  const config = await readJsonFile<Record<string, unknown>>(resolveOpenClawConfigPath());

  if (!config) {
    return {
      value: "",
      invalidConfig: false,
      fromConfigFile: false
    };
  }

  for (const path of paths) {
    const value = readConfigString(readConfigPath(config, path));

    if (isRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        `${path} is configured but OpenClaw returned a redacted secret. Set AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD or OPENCLAW_GATEWAY_TOKEN/PASSWORD to enable native Gateway WS; using CLI fallback.`,
        "auth"
      );
    }

    if (value) {
      return {
        value,
        invalidConfig: false,
        fromConfigFile: true
      };
    }
  }

  return {
    value: "",
    invalidConfig: false,
    fromConfigFile: true
  };
}

export async function resolveGatewayAuth(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions
) {
  const configTokenPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.token", "gateway.remote.token"]
    : ["gateway.remote.token", "gateway.auth.token"];
  const configPasswordPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.password", "gateway.remote.password"]
    : ["gateway.remote.password", "gateway.auth.password"];
  const explicitToken =
    options.token?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  if (explicitToken) {
    return {
      token: explicitToken,
      password: ""
    };
  }

  const explicitPassword =
    options.password?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim() ||
    process.env.OPENCLAW_GATEWAY_PASSWORD?.trim();

  if (explicitPassword) {
    return {
      token: "",
      password: explicitPassword
    };
  }

  const tokenResult = await resolveConfiguredGatewaySecret(fallback, configTokenPaths, commandOptions, {
    readLocalConfigFile: !options.webSocketFactory
  });

  if (tokenResult.value || tokenResult.invalidConfig) {
    return {
      token: tokenResult.value,
      password: ""
    };
  }

  const savedCredential = isLocalGatewayUrl(url)
    ? await readAgentOsGatewayAuthCredential()
    : null;

  if (savedCredential?.kind === "token") {
    return {
      token: savedCredential.value,
      password: ""
    };
  }

  const passwordResult = await resolveConfiguredGatewaySecret(fallback, configPasswordPaths, commandOptions, {
    readLocalConfigFile: !options.webSocketFactory
  });
  const password = passwordResult.invalidConfig ? "" : passwordResult.value;

  if (!password && savedCredential?.kind === "password") {
    return {
      token: "",
      password: savedCredential.value
    };
  }

  return {
    token: "",
    password
  };
}

export function isLocalGatewayUrl(rawUrl: string) {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export async function resolveLocalGatewayDeviceAuth(
  rawUrl: string,
  options: NativeWsOpenClawGatewayClientOptions
): Promise<LocalDeviceAuth | null> {
  if (!isLocalGatewayUrl(rawUrl) || options.webSocketFactory) {
    return null;
  }

  const stateDir = resolveOpenClawStateDir();
  const [identity, authStore] = await Promise.all([
    readJsonFile<{
      version?: unknown;
      deviceId?: unknown;
      publicKeyPem?: unknown;
      privateKeyPem?: unknown;
    }>(join(stateDir, "identity", OPENCLAW_DEVICE_IDENTITY_FILE_NAME)),
    readJsonFile<{
      version?: unknown;
      deviceId?: unknown;
      tokens?: {
        operator?: {
          token?: unknown;
          scopes?: unknown;
        };
      };
    }>(join(stateDir, "identity", OPENCLAW_DEVICE_AUTH_FILE_NAME))
  ]);
  const deviceId = readNonEmptyString(identity?.deviceId);
  const publicKeyPem = readNonEmptyString(identity?.publicKeyPem);
  const privateKeyPem = readNonEmptyString(identity?.privateKeyPem);
  const token = readNonEmptyString(authStore?.tokens?.operator?.token);

  if (!deviceId || !publicKeyPem || !privateKeyPem || !token || authStore?.deviceId !== deviceId) {
    return null;
  }

  return {
    deviceId,
    publicKeyPem,
    privateKeyPem,
    token
  };
}

export function resolveOpenClawStateDir() {
  const override = process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return expandHomePath(override);
  }

  return join(homedir(), ".openclaw");
}

export function resolveOpenClawConfigPath() {
  const override = process.env.OPENCLAW_CONFIG_PATH?.trim();
  return override ? expandHomePath(override) : join(resolveOpenClawStateDir(), "openclaw.json");
}

export function expandHomePath(value: string) {
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

export async function readJsonFile<TPayload>(path: string): Promise<TPayload | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as TPayload;
  } catch {
    return null;
  }
}

export function base64UrlEncode(buffer: Buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string) {
  const spki = createPublicKeyDer(publicKeyPem);

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return base64UrlEncode(spki.subarray(ED25519_SPKI_PREFIX.length));
  }

  return base64UrlEncode(spki);
}

export function createPublicKeyDer(publicKeyPem: string) {
  return Buffer.from(createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der"
  }) as Buffer);
}

export function signDevicePayload(privateKeyPem: string, payload: string) {
  const key = createPrivateKey(privateKeyPem);
  return base64UrlEncode(sign(null, Buffer.from(payload, "utf8"), key));
}

export function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily: string | null;
}) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily)
  ].join("|");
}

export function normalizeDeviceMetadataForAuth(value: unknown) {
  return typeof value === "string" ? value.trim().replaceAll("|", "") : "";
}

export async function buildConnectParams(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions,
  nonce?: string | null
): Promise<ConnectParamsContext> {
  const deviceAuth = await resolveLocalGatewayDeviceAuth(url, options);
  const scopes = options.scopes ?? DEFAULT_OPERATOR_SCOPES;
  let token = "";
  let password = "";

  try {
    const gatewayAuth = await resolveGatewayAuth(fallback, options, url, commandOptions);
    token = gatewayAuth.token;
    password = gatewayAuth.password;
  } catch (error) {
    if (!deviceAuth?.token) {
      throw error;
    }
  }

  const activeDeviceAuth = deviceAuth && !token && !password
    ? deviceAuth
    : null;
  const authToken = activeDeviceAuth?.token ?? token;
  const auth = authToken
    ? { token: authToken }
    : password
      ? { password }
      : undefined;
  const signedAtMs = Date.now();
  const platform = process.platform;
  const device = activeDeviceAuth && nonce
    ? {
      id: activeDeviceAuth.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(activeDeviceAuth.publicKeyPem),
      signature: signDevicePayload(
        activeDeviceAuth.privateKeyPem,
        buildDeviceAuthPayloadV3({
          deviceId: activeDeviceAuth.deviceId,
          clientId: options.clientName ?? SERVER_OPERATOR_CLIENT_ID,
          clientMode: SERVER_OPERATOR_CLIENT_MODE,
          role: options.role ?? "operator",
          scopes,
          signedAtMs,
          token: authToken ?? null,
          nonce,
          platform,
          deviceFamily: null
        })
      ),
      signedAt: signedAtMs,
      nonce
    }
    : undefined;

  return {
    deviceAuth: activeDeviceAuth,
    params: {
      minProtocol: MIN_CONTROL_PROTOCOL_VERSION,
      maxProtocol: MAX_CONTROL_PROTOCOL_VERSION,
      client: {
        id: options.clientName ?? SERVER_OPERATOR_CLIENT_ID,
        version: options.clientVersion ?? "agentos",
        platform,
        mode: SERVER_OPERATOR_CLIENT_MODE,
        instanceId: options.instanceId
      },
      role: options.role ?? "operator",
      scopes,
      caps: ["tool-events"],
      ...(auth ? { auth } : {}),
      ...(device ? { device } : {}),
      userAgent: "AgentOS",
      locale: "en"
    }
  };
}
