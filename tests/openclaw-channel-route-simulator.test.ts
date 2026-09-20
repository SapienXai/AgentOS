import assert from "node:assert/strict";
import { test } from "node:test";

import {
  simulateChannelRoute,
  type ChannelRouteSimulationDependencies
} from "@/lib/openclaw/application/channel-route-simulator-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

function center(connected = true) {
  return {
    providers: [{
      id: "telegram",
      accounts: [{
        accountId: "support-bot",
        name: "Support Bot",
        configured: true,
        enabled: true,
        isDefault: true,
        linked: true,
        running: connected,
        connected,
        liveStatusAvailable: true,
        authenticationRequired: false,
        lastError: null,
        evidence: "live-and-config"
      }]
    }]
  } as never;
}

function capabilities() {
  return {
    workerId: "support-agent",
    capturedAt: new Date().toISOString(),
    session: { key: "agent:support-agent:main", updatedAt: null, profile: null },
    capabilities: [],
    skills: [],
    skillLibrary: { supported: true, error: null },
    sources: { toolsCatalog: "native", toolsEffective: "native", skillsLibrary: "native", accounts: "native" },
    summary: { available: 0, "requires-approval": 0, "needs-setup": 0, blocked: 0, unavailable: 0, unknown: 0 }
  } as never;
}

function adapter(bindings: unknown[], config: Record<string, unknown>, agents = [{ id: "support-agent", name: "Support Agent" }]) {
  return {
    getConfig: async (path: string) => path === "bindings" ? bindings : config,
    listAgents: async () => ({ agents, defaultId: null })
  } as unknown as OpenClawAdapter;
}

function deps(currentAdapter: OpenClawAdapter, capabilitiesReader = async () => capabilities()): ChannelRouteSimulationDependencies {
  return {
    adapter: currentAdapter,
    readChannelCenter: async () => center(),
    readAgents: async () => [{ id: "support-agent", name: "Support Agent" }] as never,
    readCapabilities: async () => capabilitiesReader()
  };
}

function route(kind: "group" | "topic" = "group") {
  return buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "support-bot",
    kind,
    routeId: kind === "topic" ? "12" : "-100123",
    ...(kind === "topic" ? { parentRouteId: "-100123" } : {})
  });
}

function groupConfig(overrides: Record<string, unknown> = {}) {
  return {
    groups: {
      "-100123": {
        enabled: true,
        groupPolicy: "open",
        requireMention: false,
        ...overrides
      }
    }
  };
}

test("simulates an exact Telegram binding without executing a message", async () => {
  const result = await simulateChannelRoute({
    route: route(),
    senderId: "1842",
    mentioned: false,
    message: "I need a refund"
  }, deps(adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], groupConfig())));

  assert.equal(result.outcome, "deliverable");
  assert.equal(result.binding.effectiveAgentId, "support-agent");
  assert.equal(result.binding.effectiveMatch, "exact");
  assert.equal(result.binding.source, "openclaw");
  assert.equal(result.access.senderGate.status, "pass");
  assert.equal(result.access.mentionGate.status, "pass");
  assert.equal(result.input.message, "I need a refund");
});

test("explains Telegram topic inheritance from its parent group route", async () => {
  const result = await simulateChannelRoute({
    route: route("topic"),
    senderId: "1842",
    mentioned: false
  }, deps(adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], {
    groups: { "-100123": { enabled: true, groupPolicy: "open", requireMention: false, topics: { "12": {} } } }
  })));

  assert.equal(result.outcome, "deliverable");
  assert.equal(result.binding.effectiveMatch, "inherited");
  assert.equal(result.binding.inheritedFrom?.routeId, "-100123");
  assert.equal(result.access.policy.topicId, "12");
});

test("does not select a winner when native bindings are ambiguous", async () => {
  const result = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: false }, deps(adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } },
    { agentId: "another-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], groupConfig())));

  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.binding.effectiveAgentId, null);
  assert.equal(result.worker.label, null);
});

test("blocks a Telegram message that is not mentioned when mention is required", async () => {
  const result = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: false }, deps(adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], groupConfig({ requireMention: true }))));

  assert.equal(result.outcome, "blocked");
  assert.equal(result.access.mentionGate.status, "fail");
});

test("keeps required mention unknown when the operator did not establish it", async () => {
  const result = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: null }, deps(adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], groupConfig({ requireMention: true }))));

  assert.equal(result.outcome, "unknown");
  assert.equal(result.access.mentionGate.status, "unknown");
});

test("uses the canonical Telegram allowlist and does not infer sender identity", async () => {
  const currentAdapter = adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], groupConfig({ groupPolicy: "allowlist", allowFrom: ["1842"], requireMention: false }));
  const allowed = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: false }, deps(currentAdapter));
  const denied = await simulateChannelRoute({ route: route(), senderId: "9999", mentioned: false }, deps(currentAdapter));
  const unknown = await simulateChannelRoute({ route: route(), senderId: null, mentioned: false }, deps(currentAdapter));

  assert.equal(allowed.outcome, "deliverable");
  assert.equal(denied.outcome, "blocked");
  assert.equal(unknown.outcome, "unknown");
  assert.equal(unknown.access.senderGate.status, "unknown");
});

test("preserves native group-over-account policy precedence", async () => {
  const currentAdapter = adapter([
    { agentId: "support-agent", match: { channel: "telegram", accountId: "support-bot", peer: { kind: "group", id: "-100123" } } }
  ], {
    groupPolicy: "disabled",
    accounts: { "support-bot": { groupPolicy: "disabled" } },
    groups: { "-100123": { enabled: true, groupPolicy: "open", requireMention: false } }
  });
  const result = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: false }, deps(currentAdapter));

  assert.equal(result.access.policy.groupPolicy, "open");
  assert.equal(result.outcome, "deliverable");
});

test("returns unresolved when no effective worker is available", async () => {
  const currentAdapter = adapter([], groupConfig(), []);
  const result = await simulateChannelRoute({ route: route(), senderId: "1842", mentioned: false }, {
    ...deps(currentAdapter),
    readCapabilities: async () => capabilities()
  });

  assert.equal(result.outcome, "unresolved");
  assert.equal(result.binding.effectiveAgentId, null);
  assert.equal(result.capabilities.status, "unknown");
});

test("keeps non-Telegram policy semantics unknown instead of guessing", async () => {
  const currentAdapter = adapter([
    { agentId: "support-agent", match: { channel: "discord", accountId: "support-bot", peer: { kind: "group", id: "guild-1" } } }
  ], {});
  const result = await simulateChannelRoute({
    route: buildChannelRouteIdentity({ provider: "discord", accountId: "support-bot", kind: "group", routeId: "guild-1" }),
    senderId: "1842",
    mentioned: true
  }, { ...deps(currentAdapter), readChannelCenter: async () => ({ providers: [{ id: "discord", accounts: [{ accountId: "support-bot", name: "Discord", enabled: true, connected: true, running: true, liveStatusAvailable: true, authenticationRequired: false }] }] } as never) });

  assert.equal(result.binding.effectiveAgentId, "support-agent");
  assert.equal(result.outcome, "unknown");
  assert.equal(result.access.policy.availability, "unsupported");
});
