import "server-only";

import { join } from "node:path";

/**
 * ROLLBACK-ONLY: this module assembles the legacy custom connect/auth
 * handshake. Neutral state and device-signing primitives live in
 * gateway-state.ts and gateway-device-auth.ts so official production code
 * cannot depend on this custom assembly.
 */
import { readAgentOsGatewayAuthCredential } from "@/lib/agentos/runtime-auth";
import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  buildDeviceAuthPayloadV3,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload
} from "@/lib/openclaw/client/gateway-device-auth";
import {
  readJsonFile,
  resolveOpenClawConfigPath,
  resolveOpenClawStateDir
} from "@/lib/openclaw/client/gateway-state";
import {
  AGENTOS_GATEWAY_CLIENT_CAPABILITIES,
  resolveGatewayClientId
} from "@/lib/openclaw/client/openclaw-protocol";
import {
  DEFAULT_OPERATOR_SCOPES,
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION,
  OPENCLAW_DEVICE_AUTH_FILE_NAME,
  OPENCLAW_DEVICE_IDENTITY_FILE_NAME,
  SERVER_OPERATOR_CLIENT_MODE,
  type ConnectParamsContext,
  type GatewayConnectChallenge,
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

export {
  base64UrlEncode,
  buildDeviceAuthPayloadV3,
  createPublicKeyDer,
  normalizeDeviceMetadataForAuth,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload
} from "@/lib/openclaw/client/gateway-device-auth";
export {
  expandHomePath,
  readJsonFile,
  resolveOpenClawConfigPath,
  resolveOpenClawStateDir
} from "@/lib/openclaw/client/gateway-state";

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
  const preferLocalConfig = isLocalGatewayUrl(url) && !options.webSocketFactory;
  const configTokenPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.token", "gateway.remote.token"]
    : ["gateway.remote.token", "gateway.auth.token"];
  const configPasswordPaths = isLocalGatewayUrl(url)
    ? ["gateway.auth.password", "gateway.remote.password"]
    : ["gateway.remote.password", "gateway.auth.password"];
  const explicitToken = options.token?.trim();
  const envToken =
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim();

  if (explicitToken) {
    return {
      token: explicitToken,
      password: ""
    };
  }

  if (envToken && !preferLocalConfig) {
    return {
      token: envToken,
      password: ""
    };
  }

  const explicitPassword = options.password?.trim();
  const envPassword =
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

  if (envToken) {
    return {
      token: envToken,
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

  if (!password && envPassword) {
    return {
      token: "",
      password: envPassword
    };
  }

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

export async function buildConnectParams(
  fallback: OpenClawGatewayClient,
  options: NativeWsOpenClawGatewayClientOptions,
  url: string,
  commandOptions: OpenClawCommandOptions,
  challenge?: GatewayConnectChallenge | null
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
  const signedAtMs = challenge?.ts ?? Date.now();
  const platform = process.platform;
  const clientId = resolveGatewayClientId(options.clientName);
  const device = activeDeviceAuth && challenge
    ? {
      id: activeDeviceAuth.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(activeDeviceAuth.publicKeyPem),
      signature: signDevicePayload(
        activeDeviceAuth.privateKeyPem,
        buildDeviceAuthPayloadV3({
          deviceId: activeDeviceAuth.deviceId,
          clientId,
          clientMode: SERVER_OPERATOR_CLIENT_MODE,
          role: options.role ?? "operator",
          scopes,
          signedAtMs,
          token: authToken ?? null,
          nonce: challenge.nonce,
          platform,
          deviceFamily: null
        })
      ),
      signedAt: signedAtMs,
      nonce: challenge.nonce
    }
    : undefined;

  return {
    deviceAuth: activeDeviceAuth,
    params: {
      minProtocol: MIN_CONTROL_PROTOCOL_VERSION,
      maxProtocol: MAX_CONTROL_PROTOCOL_VERSION,
      client: {
        id: clientId,
        version: options.clientVersion ?? "agentos",
        platform,
        mode: SERVER_OPERATOR_CLIENT_MODE,
        instanceId: options.instanceId
      },
      role: options.role ?? "operator",
      scopes,
      caps: [...AGENTOS_GATEWAY_CLIENT_CAPABILITIES],
      ...(auth ? { auth } : {}),
      ...(device ? { device } : {}),
      userAgent: "AgentOS",
      locale: "en"
    }
  };
}
