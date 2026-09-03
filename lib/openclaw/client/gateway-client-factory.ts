import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import { resolveOpenClawStateDir } from "@/lib/openclaw/client/native-ws-gateway-auth";
import {
  isCliGatewayClientForcedByEnv,
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import {
  resolveGatewayUrl,
  resolveOpenClawTransportSelection
} from "@/lib/openclaw/client/native-ws-gateway-policy";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

let defaultClient: OpenClawGatewayClient | null = null;
let configuredProvider: OpenClawGatewayClientProvider | null = null;

export type OpenClawGatewayClientProvider = () => OpenClawGatewayClient;

function createDefaultOpenClawGatewayClient() {
  const cliClient = new CliOpenClawGatewayClient();

  if (isCliGatewayClientForcedByEnv()) {
    return cliClient;
  }

  const selection = resolveOpenClawTransportSelection();
  const commonOptions = {
    fallback: cliClient,
    url: resolveGatewayUrl(),
    transportSelectionWarning: selection.warning
  } as const;

  if (selection.implementation === "custom") {
    return new NativeWsOpenClawGatewayClient(commonOptions);
  }

  return createOfficialBackedOpenClawGatewayClient({
    ...commonOptions,
    token: resolveGatewayCredential("AGENTOS_OPENCLAW_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"),
    password: resolveGatewayCredential("AGENTOS_OPENCLAW_GATEWAY_PASSWORD", "OPENCLAW_GATEWAY_PASSWORD"),
    stateDir: resolveOpenClawStateDir(),
    sharedStateMode: "managed-write"
  });
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
