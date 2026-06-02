import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSurfaceCatalogEntries } from "@/lib/openclaw/surface-catalog";
import {
  buildManagedOpenClawBindings,
  buildSurfaceBindingRepairResult,
  buildSurfaceDriftSnapshot,
  createConfigOnlySurfaceRuntimeSnapshot,
  mergeManagedOpenClawBindings,
  normalizeSurfaceRuntimeFromChannelStatus
} from "@/lib/openclaw/surface-runtime";
import type {
  ChannelAccountRecord,
  ChannelRegistry,
  SurfaceRuntimeSnapshot
} from "@/lib/openclaw/types";

test("normalizes channels.status account health without deriving live status from config", () => {
  const runtime = normalizeSurfaceRuntimeFromChannelStatus(
    {
      ts: 1,
      channelOrder: ["telegram", "discord", "gmail", "webhook", "email"],
      channelMeta: [{ id: "matrix", label: "Matrix", detailLabel: "Matrix channel" }],
      channelLabels: { webhook: "Webhook" },
      channels: {},
      channelDefaultAccountId: {},
      channelAccounts: {
        telegram: [{ accountId: "tg-main", name: "Telegram Main", enabled: true, connected: true }],
        discord: [{ accountId: "discord-bot", enabled: true, running: true }],
        gmail: [{ accountId: "gmail-primary", enabled: true, configured: true }],
        webhook: [{ accountId: "disabled-hook", enabled: false }],
        email: [{ accountId: "support", enabled: true, lastError: "Connector failed with token xoxb-secret" }],
        malformed: [{ name: "missing-account-id" } as unknown as Record<string, unknown> & { accountId: string }]
      }
    },
    {
      source: "gateway-probe",
      checkedAt: "2026-06-02T00:00:00.000Z"
    }
  );

  assert.equal(runtime.source, "gateway-probe");
  assert.equal(runtime.accountsByKey["telegram:tg-main"].status, "connected");
  assert.equal(runtime.accountsByKey["discord:discord-bot"].status, "running");
  assert.equal(runtime.accountsByKey["gmail:gmail-primary"].status, "configured");
  assert.equal(runtime.accountsByKey["webhook:disabled-hook"].status, "disabled");
  assert.equal(runtime.accountsByKey["email:support"].status, "failed");
  assert.equal(runtime.accountsByKey["malformed:missing-account-id"], undefined);
  assert.equal(runtime.accountsByKey["email:support"].errorMessage?.includes("xoxb-secret"), false);
});

test("skips placeholder default runtime accounts when a concrete account exists", () => {
  const runtime = normalizeSurfaceRuntimeFromChannelStatus(
    {
      ts: 1,
      channelOrder: ["telegram"],
      channelMeta: [],
      channelLabels: {},
      channels: {},
      channelDefaultAccountId: { telegram: "telegram-agentos-main" },
      channelAccounts: {
        telegram: [
          {
            accountId: "default",
            enabled: true,
            configured: false,
            running: false,
            connected: false,
            lastError: "not configured"
          },
          {
            accountId: "telegram-agentos-main",
            name: "AgentOS Telegram",
            enabled: true,
            configured: true,
            running: true
          }
        ]
      }
    },
    {
      source: "gateway-probe",
      checkedAt: "2026-06-02T00:00:00.000Z"
    }
  );

  assert.equal(runtime.accountsByKey["telegram:default"], undefined);
  assert.equal(runtime.accountsByKey["telegram:telegram-agentos-main"].status, "running");
  assert.deepEqual(Object.keys(runtime.accountsByProvider.telegram ?? {}), ["telegram-agentos-main"]);
});

test("includes dynamic OpenClaw providers without enabling guessed provisioning", () => {
  const runtime = normalizeSurfaceRuntimeFromChannelStatus(
    {
      ts: 1,
      channelOrder: ["matrix"],
      channelMeta: [{ id: "matrix", label: "Matrix", detailLabel: "Matrix channel" }],
      channelLabels: {},
      channels: {},
      channelDefaultAccountId: {},
      channelAccounts: {
        matrix: [{ accountId: "matrix-main", enabled: true, linked: true }]
      }
    },
    {
      source: "gateway-status",
      checkedAt: "2026-06-02T00:00:00.000Z"
    }
  );

  const entries = buildSurfaceCatalogEntries({ surfaceRuntime: runtime });
  const matrix = entries.find((entry) => entry.provider === "matrix");

  assert.ok(matrix);
  assert.equal(matrix?.label, "Matrix");
  assert.equal(matrix?.supportsProvisioning, false);
  assert.equal(matrix?.provisionFields.length, 0);
});

test("builds expected OpenClaw bindings for primary, Telegram route, and Discord routes", () => {
  const registry = createRegistry();
  const bindings = buildManagedOpenClawBindings(registry);

  assert.deepEqual(bindings, [
    {
      agentId: "agent-primary",
      match: {
        channel: "telegram",
        accountId: "tg-main"
      }
    },
    {
      agentId: "agent-group",
      match: {
        channel: "telegram",
        accountId: "tg-main"
      }
    },
    {
      agentId: "agent-group",
      match: {
        channel: "telegram",
        accountId: "tg-main",
        peer: {
          kind: "group",
          id: "-1001"
        }
      }
    },
    {
      agentId: "agent-discord",
      match: {
        channel: "discord",
        accountId: "discord-main",
        guildId: "guild1",
        peer: {
          kind: "channel",
          id: "channel1"
        }
      }
    },
    {
      agentId: "agent-role",
      match: {
        channel: "discord",
        accountId: "discord-main",
        guildId: "guild1",
        roles: ["role1"]
      }
    }
  ]);
});

test("detects missing, extra, mismatched, missing account, and disabled provider drift", () => {
  const registry = createRegistry();
  const configuredAccounts: ChannelAccountRecord[] = [
    { id: "discord-main", type: "discord", name: "Discord Main", enabled: true }
  ];
  const surfaceRuntime: SurfaceRuntimeSnapshot = {
    ...createConfigOnlySurfaceRuntimeSnapshot(configuredAccounts, registry),
    accountsByKey: {
      "telegram:tg-main": {
        key: "telegram:tg-main",
        provider: "telegram",
        accountId: "tg-main",
        name: "Telegram Main",
        label: "Telegram Main",
        enabled: false,
        configured: true,
        linked: false,
        running: false,
        connected: false,
        disabled: true,
        failed: false,
        status: "disabled",
        healthState: null,
        errorMessage: null,
        source: "gateway-probe",
        checkedAt: "2026-06-02T00:00:00.000Z"
      }
    }
  };

  const drift = buildSurfaceDriftSnapshot({
    registry,
    configuredAccounts,
    surfaceRuntime,
    currentBindings: [
      {
        agentId: "wrong-agent",
        match: {
          channel: "telegram",
          accountId: "tg-main"
        }
      },
      {
        agentId: "extra-agent",
        match: {
          channel: "discord",
          accountId: "discord-main",
          guildId: "guild1",
          peer: {
            kind: "thread",
            id: "thread-extra"
          }
        }
      }
    ],
    workspaceId: "workspace-1"
  });

  assert.equal(drift.checked, true);
  assert.equal(drift.summary.agentMismatch, 2);
  assert.equal(drift.summary.missingBindings, 3);
  assert.equal(drift.summary.extraBindings, 1);
  assert.equal(drift.summary.providerDisabled, 1);
  assert.equal(drift.summary.accountMissing, 0);
  assert.ok(drift.issues.every((issue) => issue.workspaceId === "workspace-1"));
});

test("repairs managed bindings without returning binding secrets", () => {
  const registry = createRegistry();
  const previousBindings = [
    {
      agentId: "legacy-agent",
      match: {
        channel: "telegram",
        accountId: "tg-main"
      },
      secret: "do-not-return"
    },
    {
      agentId: "extra-agent",
      match: {
        channel: "discord",
        accountId: "discord-main",
        guildId: "guild1",
        peer: {
          kind: "thread",
          id: "thread-extra"
        }
      }
    }
  ];
  const nextBindings = mergeManagedOpenClawBindings({
    registry,
    currentBindings: previousBindings,
    scope: "workspace",
    workspaceId: "workspace-1"
  });
  const drift = buildSurfaceDriftSnapshot({
    registry,
    configuredAccounts: [
      { id: "tg-main", type: "telegram", name: "Telegram Main", enabled: true },
      { id: "discord-main", type: "discord", name: "Discord Main", enabled: true }
    ],
    surfaceRuntime: createConfigOnlySurfaceRuntimeSnapshot([], registry),
    currentBindings: nextBindings,
    workspaceId: "workspace-1"
  });
  const result = buildSurfaceBindingRepairResult({
    scope: "workspace",
    workspaceId: "workspace-1",
    registry,
    previousBindings,
    nextBindings,
    configMutations: [{
      path: "bindings",
      appliedVia: "config.patch",
      baseHash: "hash-1",
      hotReloaded: true
    }],
    drift
  });

  assert.equal(result.changed, true);
  assert.equal(result.expectedBindingCount, 5);
  assert.deepEqual(result.configMutations, [{
    path: "bindings",
    appliedVia: "config.patch",
    baseHash: "hash-1",
    hotReloaded: true
  }]);
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
  assert.equal(JSON.stringify(nextBindings).includes("thread-extra"), false);
});

test("surface binding repair result carries dry-run audit and restore metadata without config mutations", () => {
  const registry = createRegistry();
  const previousBindings = buildManagedOpenClawBindings(registry);
  const nextBindings = mergeManagedOpenClawBindings({
    registry,
    currentBindings: previousBindings,
    scope: "workspace",
    workspaceId: "workspace-1"
  });
  const drift = buildSurfaceDriftSnapshot({
    registry,
    configuredAccounts: [
      { id: "tg-main", type: "telegram", name: "Telegram Main", enabled: true },
      { id: "discord-main", type: "discord", name: "Discord Main", enabled: true }
    ],
    surfaceRuntime: createConfigOnlySurfaceRuntimeSnapshot([], registry),
    currentBindings: nextBindings,
    workspaceId: "workspace-1"
  });
  const result = buildSurfaceBindingRepairResult({
    scope: "workspace",
    workspaceId: "workspace-1",
    registry,
    previousBindings,
    nextBindings,
    dryRun: true,
    applied: false,
    auditId: "surface-reconcile-test",
    auditPath: "/tmp/surface-reconcile-test.json",
    confirmedPreviewAuditId: "surface-reconcile-preview",
    backupId: "surface-reconcile-backup-test",
    backupPath: "/tmp/surface-reconcile-backup-test.json",
    restorePlan: {
      auditId: "surface-reconcile-test",
      createdAt: "2026-06-02T00:00:00.000Z",
      configPaths: ["bindings"],
      confirmedPreviewAuditId: "surface-reconcile-preview",
      backupId: "surface-reconcile-backup-test",
      backupPath: "/tmp/surface-reconcile-backup-test.json",
      instructions: ["Review audit surface-reconcile-test before restoring bindings."]
    },
    drift
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.applied, false);
  assert.equal(result.auditId, "surface-reconcile-test");
  assert.equal(result.auditPath, "/tmp/surface-reconcile-test.json");
  assert.equal(result.confirmedPreviewAuditId, "surface-reconcile-preview");
  assert.equal(result.backupId, "surface-reconcile-backup-test");
  assert.equal(result.backupPath, "/tmp/surface-reconcile-backup-test.json");
  assert.equal(result.configMutations, undefined);
  assert.deepEqual(result.restorePlan?.configPaths, ["bindings"]);
  assert.equal(result.restorePlan?.backupId, "surface-reconcile-backup-test");
});

test("detects and removes orphan AgentOS-managed OpenClaw bindings", () => {
  const registry = createRegistry();
  const orphanBinding = {
    agentId: "agent-primary",
    match: {
      channel: "telegram",
      accountId: "telegram-agentos-old"
    }
  };
  const currentBindings = [
    ...buildManagedOpenClawBindings(registry),
    orphanBinding
  ];
  const drift = buildSurfaceDriftSnapshot({
    registry,
    configuredAccounts: [
      { id: "tg-main", type: "telegram", name: "Telegram Main", enabled: true },
      { id: "discord-main", type: "discord", name: "Discord Main", enabled: true }
    ],
    surfaceRuntime: createConfigOnlySurfaceRuntimeSnapshot([], registry),
    currentBindings,
    workspaceId: "workspace-1"
  });

  assert.equal(drift.summary.extraBindings, 1);
  assert.equal(drift.issues.some((issue) => issue.accountId === "telegram-agentos-old"), true);

  const repaired = mergeManagedOpenClawBindings({
    registry,
    currentBindings,
    scope: "workspace",
    workspaceId: "workspace-1"
  });

  assert.equal(JSON.stringify(repaired).includes("telegram-agentos-old"), false);
});

function createRegistry(): ChannelRegistry {
  return {
    version: 1,
    channels: [
      {
        id: "tg-main",
        type: "telegram",
        name: "Telegram Main",
        primaryAgentId: "agent-primary",
        workspaces: [
          {
            workspaceId: "workspace-1",
            workspacePath: "/tmp/workspace-1",
            agentIds: ["agent-primary", "agent-group"],
            groupAssignments: [
              {
                chatId: "-1001",
                title: "Main group",
                agentId: "agent-group",
                enabled: true
              }
            ]
          }
        ]
      },
      {
        id: "discord-main",
        type: "discord",
        name: "Discord Main",
        primaryAgentId: null,
        workspaces: [
          {
            workspaceId: "workspace-1",
            workspacePath: "/tmp/workspace-1",
            agentIds: ["agent-discord", "agent-role"],
            groupAssignments: [
              {
                chatId: "channel:guild1:channel1",
                title: "General",
                agentId: "agent-discord",
                enabled: true
              },
              {
                chatId: "role:guild1:role1",
                title: "Support",
                agentId: "agent-role",
                enabled: true
              }
            ]
          }
        ]
      }
    ]
  };
}
