import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectWorkspaceChannelSetup,
  type WorkspaceChannelSetupProvider
} from "@/lib/openclaw/domains/workspace-channel-setup";
import type {
  ChannelRegistry,
  SurfaceRuntimeSnapshot
} from "@/lib/openclaw/types";

const providers: WorkspaceChannelSetupProvider[] = [
  provider("whatsapp", "QR code", "qr"),
  provider("telegram", "Bot token", "bot-token"),
  provider("discord", "Bot token", "bot-token"),
  provider("slack", "App tokens", "app-tokens"),
  {
    id: "googlechat",
    label: "Google Chat",
    setupMode: "cloud",
    setupLabel: "Cloud setup",
    implemented: false,
    availabilityReason: "Google Chat setup is not available in AgentOS yet.",
    pluginInstalled: false,
    pluginEnabled: false
  }
];

test("pending WhatsApp without an OpenClaw account requires native authentication", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["whatsapp:customer-support"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot(),
    providers
  });

  assert.equal(result.items[0]?.status, "authentication-required");
  assert.equal(result.items[0]?.action, "authenticate");
  assert.equal(result.complete, false);
});

test("multiple native accounts require explicit account selection", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:community"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot({
      telegram: {
        first: runtimeAccount("telegram", "first", { configured: true }),
        second: runtimeAccount("telegram", "second", { configured: true })
      }
    }),
    providers
  });

  assert.equal(result.items[0]?.status, "account-selection-required");
  assert.equal(result.items[0]?.action, "select-account");
  assert.deepEqual(result.items[0]?.accountIds, ["first", "second"]);
});

test("a native connected account is complete only after the workspace binding exists", () => {
  const account = runtimeAccount("telegram", "marketing", { configured: true, connected: true });
  const unbound = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:marketing-channel"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot({ telegram: { marketing: account } }),
    providers
  });

  assert.equal(unbound.items[0]?.status, "connected");
  assert.equal(unbound.items[0]?.action, "bind");
  assert.equal(unbound.complete, false);

  const bound = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:marketing-channel"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: {
      version: 1,
      channels: [{
        id: "marketing",
        type: "telegram",
        name: "Marketing",
        primaryAgentId: "agent-1",
        workspaces: [{ workspaceId: "workspace-1", workspacePath: "/runtime/workspace", agentIds: ["agent-1"], groupAssignments: [] }]
      }]
    },
    surfaceRuntime: runtimeSnapshot({ telegram: { marketing: account } }),
    providers
  });

  assert.equal(bound.items[0]?.bindingPresent, true);
  assert.equal(bound.items[0]?.action, "none");
  assert.equal(bound.complete, true);
});

test("remote or blocked live status is unavailable and never becomes a disconnected claim", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:remote-channel"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot({}, { source: "unavailable", issue: "Gateway is remote or unreachable." }),
    providers
  });

  assert.equal(result.source, "unavailable");
  assert.equal(result.items[0]?.status, "unavailable");
  assert.equal(result.items[0]?.action, "none");
  assert.equal(result.items[0]?.nativeStatusAvailable, false);
});

test("config-only snapshots are unavailable because they do not prove live native status", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:offline-channel"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot({}, {
      source: "config-only",
      issue: "Live OpenClaw channel status is unavailable."
    }),
    providers
  });

  assert.equal(result.source, "unavailable");
  assert.equal(result.items[0]?.status, "unavailable");
  assert.equal(result.items[0]?.nativeStatusAvailable, false);
});

test("a declaration can identify its own bound account without selecting a different workspace account", () => {
  const account = runtimeAccount("telegram", "marketing", { configured: true, connected: true });
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["telegram:marketing"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: {
      version: 1,
      channels: [
        {
          id: "marketing",
          type: "telegram",
          name: "Marketing",
          primaryAgentId: "agent-1",
          workspaces: [{ workspaceId: "workspace-1", workspacePath: "/runtime/workspace", agentIds: ["agent-1"], groupAssignments: [] }]
        },
        {
          id: "support",
          type: "telegram",
          name: "Support",
          primaryAgentId: "agent-1",
          workspaces: [{ workspaceId: "workspace-1", workspacePath: "/runtime/workspace", agentIds: ["agent-1"], groupAssignments: [] }]
        }
      ]
    },
    surfaceRuntime: runtimeSnapshot({ telegram: { marketing: account } }),
    providers
  });

  assert.equal(result.items[0]?.accountId, "marketing");
  assert.equal(result.items[0]?.bindingPresent, true);
  assert.equal(result.items[0]?.complete, true);
});

test("unsupported providers stay honest even when a historical declaration exists", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["googlechat:customer-chat"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot(),
    providers
  });

  assert.equal(result.items[0]?.status, "unavailable");
  assert.equal(result.items[0]?.availabilityReason, "Google Chat setup is not available in AgentOS yet.");
});

test("plugin availability is represented before credentials are requested", () => {
  const result = projectWorkspaceChannelSetup({
    pendingChannels: ["discord:support"],
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    registry: emptyRegistry(),
    surfaceRuntime: runtimeSnapshot(),
    providers: providers.map((entry) => entry.id === "discord" ? { ...entry, pluginInstalled: false, pluginEnabled: false } : entry)
  });

  assert.equal(result.items[0]?.status, "plugin-required");
  assert.equal(result.items[0]?.action, "install-plugin");
});

function provider(
  id: "whatsapp" | "telegram" | "discord" | "slack",
  setupLabel: string,
  setupMode: WorkspaceChannelSetupProvider["setupMode"]
): WorkspaceChannelSetupProvider {
  return {
    id,
    label: id[0].toUpperCase() + id.slice(1),
    setupMode,
    setupLabel,
    implemented: true,
    availabilityReason: null,
    pluginInstalled: true,
    pluginEnabled: true
  };
}

function emptyRegistry(): ChannelRegistry {
  return { version: 1, channels: [] };
}

function runtimeAccount(
  provider: "telegram" | "whatsapp",
  accountId: string,
  overrides: Partial<SurfaceRuntimeSnapshot["accountsByProvider"][string][string]> = {}
) {
  return {
    key: `${provider}:${accountId}`,
    provider,
    accountId,
    name: accountId,
    label: accountId,
    enabled: true,
    configured: false,
    linked: false,
    running: false,
    connected: false,
    isDefault: false,
    authenticationRequired: false,
    disabled: false,
    failed: false,
    status: "unknown" as const,
    healthState: null,
    errorMessage: null,
    source: "gateway-probe" as const,
    checkedAt: new Date().toISOString(),
    ...overrides
  };
}

function runtimeSnapshot(
  accountsByProvider: SurfaceRuntimeSnapshot["accountsByProvider"] = {},
  overrides: Partial<SurfaceRuntimeSnapshot> = {}
): SurfaceRuntimeSnapshot {
  return {
    source: "gateway-probe",
    checkedAt: new Date().toISOString(),
    gatewayAccess: {
      ok: true,
      blocked: false,
      role: "operator",
      scopes: ["operator.read"],
      missingScopes: [],
      requestId: null,
      issue: null,
      repairAvailable: false,
      repairAction: null
    },
    providerOrder: Object.keys(accountsByProvider) as SurfaceRuntimeSnapshot["providerOrder"],
    providerLabels: {},
    accountsByProvider,
    accountsByKey: {},
    issue: null,
    ...overrides
  };
}
