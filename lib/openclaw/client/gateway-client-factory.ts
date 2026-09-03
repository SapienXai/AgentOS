import "server-only";

import type { GatewayClientName } from "@openclaw/gateway-protocol/client-info";
import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import { resolveOpenClawStateDir } from "@/lib/openclaw/client/gateway-state";
import {
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import {
  createOfficialBackedOpenClawGatewayClient,
  type OfficialBackedOpenClawGatewayClientOptions
} from "@/lib/openclaw/client/official-gateway-factory";
import {
  isCliGatewayClientForcedByEnv,
  resolveGatewayUrl,
  resolveOpenClawTransportSelection
} from "@/lib/openclaw/client/native-ws-gateway-policy";
import type { NativeWsOpenClawGatewayClientOptions } from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

let defaultClient: OpenClawGatewayClient | null = null;
let configuredProvider: OpenClawGatewayClientProvider | null = null;

export type OpenClawGatewayClientProvider = () => OpenClawGatewayClient;

export type OpenClawGatewayClientFactoryOptions = Omit<
  OfficialBackedOpenClawGatewayClientOptions,
  "clientName" | "url"
> & {
  url?: string | null;
  clientName?: string;
  webSocketFactory?: NativeWsOpenClawGatewayClientOptions["webSocketFactory"];
  transport?: NativeWsOpenClawGatewayClientOptions["transport"];
};

export function createOpenClawGatewayClient(
  options: OpenClawGatewayClientFactoryOptions = {}
) {
  const cliClient = options.fallback ?? new CliOpenClawGatewayClient();
  const forceCli = options.forceCli || isCliGatewayClientForcedByEnv();

  const selection = resolveOpenClawTransportSelection();
  const commonOptions = {
    fallback: cliClient,
    url: options.url ?? resolveGatewayUrl(),
    transportSelectionWarning: selection.warning
  } as const;

  if (!forceCli && selection.implementation === "custom") {
    return new NativeWsOpenClawGatewayClient({ ...options, ...commonOptions });
  }

  return createOfficialBackedOpenClawGatewayClient({
    ...options,
    ...commonOptions,
    forceCli,
    token: options.token !== undefined
      ? options.token
      : resolveGatewayCredential("AGENTOS_OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"),
    password: options.password !== undefined
      ? options.password
      : resolveGatewayCredential("AGENTOS_OPENCLAW_GATEWAY_PASSWORD", "OPENCLAW_GATEWAY_PASSWORD"),
    stateDir: options.stateDir ?? resolveOpenClawStateDir(),
    sharedStateMode: options.sharedStateMode ?? "managed-write",
    clientName: options.clientName as GatewayClientName | undefined,
    // A custom WebSocketFactory/transport is only meaningful on the explicit
    // rollback branch. Keep those test seams out of the official constructor.
    webSocketFactory: undefined,
    transport: undefined
  } as OfficialBackedOpenClawGatewayClientOptions);
}

function createDefaultOpenClawGatewayClient() {
  if (isCliGatewayClientForcedByEnv()) {
    return new CliOpenClawGatewayClient();
  }

  return createOpenClawGatewayClient();
}

function resolveGatewayCredential(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function getOpenClawGatewayClient() {
  if (!defaultClient) {
    defaultClient = (configuredProvider ?? createDefaultOpenClawGatewayClient)();
  }

  return defaultClient;
}

export function resetOpenClawGatewayClient(reason = "reset") {
  const client = defaultClient;
  defaultClient = null;

  try {
    client?.close?.(reason);
  } catch {
    // Best-effort cleanup; the next request will create a fresh client.
  }
}

export function setOpenClawGatewayClientProvider(provider: OpenClawGatewayClientProvider | null) {
  resetOpenClawGatewayClient("provider changed");
  configuredProvider = provider;
}

export function setOpenClawGatewayClientForTesting(client: OpenClawGatewayClient | null) {
  resetOpenClawGatewayClient("testing client changed");
  defaultClient = client;
}
