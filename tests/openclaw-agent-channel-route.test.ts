import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getAgentChannelRouteBadgeSummaries,
  getAgentChannelRouteSummary,
  projectChannelDirectoryEntryForAgent
} from "@/lib/openclaw/application/agent-channel-route-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  buildNativeRouteBinding,
  clearChannelRouteBinding,
  resolveChannelRouteBinding,
  setChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";

afterEach(() => setOpenClawAdapterForTesting(null));

test("Agent Profile projection reads explicit native routes from the canonical binding array", async () => {
  const route = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-1001"
  });
  setOpenClawAdapterForTesting({
    getConfig: async (path: string) => path === "bindings" ? [buildNativeRouteBinding(route, "agent-a")] : {},
    listAgents: async () => ({ defaultId: "agent-default", agents: [{ id: "agent-a" }, { id: "agent-default" }] })
  } as unknown as OpenClawAdapter);

  const summary = await getAgentChannelRouteSummary({ agentId: "agent-a" });

  assert.equal(summary.source, "openclaw");
  assert.equal(summary.routes.length, 1);
  assert.equal(summary.routes[0]?.displayMatch, "explicit");
  assert.equal(summary.routes[0]?.route?.routeId, "-1001");
  assert.equal(summary.routes[0]?.editable, true);
});

test("Agent Profile projection preserves Telegram topic inheritance and native topic overrides", async () => {
  const group = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-1001"
  });
  setOpenClawAdapterForTesting({
    getConfig: async (path: string) => {
      if (path === "bindings") return [buildNativeRouteBinding(group, "agent-a")];
      if (path === "channels.telegram") {
        return {
          accounts: {
            main: {
              groups: {
                "-1001": {
                  topics: {
                    "42": { name: "Reservations" },
                    "43": { name: "Billing", agentId: "agent-a" }
                  }
                },
                "-1002": {
                  topics: {
                    "44": { name: "No parent binding", agentId: "agent-a" }
                  }
                }
              }
            }
          }
        };
      }
      return {};
    },
    listAgents: async () => ({ defaultId: null, agents: [{ id: "agent-a" }] })
  } as unknown as OpenClawAdapter);

  const summary = await getAgentChannelRouteSummary({ agentId: "agent-a" });
  const inherited = summary.routes.find((entry) => entry.route?.routeId === "42");
  const explicit = summary.routes.find((entry) => entry.route?.routeId === "43");
  const topicWithoutParentBinding = summary.routes.find((entry) => entry.route?.routeId === "44");

  assert.equal(inherited?.displayMatch, "inherited");
  assert.equal(inherited?.inheritedFrom?.routeId, "-1001");
  assert.equal(explicit?.displayMatch, "explicit");
  assert.equal(explicit?.route?.kind, "topic");
  assert.equal(explicit?.editable, true);
  assert.equal(topicWithoutParentBinding?.displayMatch, "explicit");
});

test("default, inherited, and explicit directory states stay distinct across surfaces", () => {
  const base = {
    provider: "telegram",
    routeId: "-1001",
    kind: "group" as const,
    accountId: "main",
    parentRouteId: null,
    title: "Operations",
    handle: null,
    metadata: {},
    agentId: "agent-a",
    bindingSource: "openclaw" as const,
    bindingEditingAmbiguous: false,
    inheritedFrom: null,
    shadowedBindingCount: 0
  };

  assert.equal(projectChannelDirectoryEntryForAgent({ entry: { ...base, bindingMatch: "exact" }, agentId: "agent-a" })?.displayMatch, "explicit");
  assert.equal(projectChannelDirectoryEntryForAgent({ entry: { ...base, bindingMatch: "inherited" }, agentId: "agent-a" })?.displayMatch, "inherited");
  assert.equal(projectChannelDirectoryEntryForAgent({ entry: { ...base, bindingMatch: "fallback" }, agentId: "agent-a" })?.displayMatch, "default");
  assert.equal(projectChannelDirectoryEntryForAgent({ entry: { ...base, bindingSource: "agentos-compatibility", bindingMatch: "exact" }, agentId: "agent-a" }), null);
});

test("Agent Profile projects Discord, Slack, and WhatsApp native route bindings without legacy metadata", async () => {
  const routes = [
    buildChannelRouteIdentity({
      provider: "discord",
      accountId: "discord-main",
      kind: "channel",
      routeId: "support",
      parentRouteId: "guild-1",
      metadata: { nativePeerKind: "channel", guildId: "guild-1" }
    }),
    buildChannelRouteIdentity({
      provider: "slack",
      accountId: "slack-main",
      kind: "channel",
      routeId: "sales",
      parentRouteId: "team-1",
      metadata: { nativePeerKind: "channel", teamId: "team-1" }
    }),
    buildChannelRouteIdentity({
      provider: "whatsapp",
      accountId: "whatsapp-main",
      kind: "group",
      routeId: "whatsapp-group"
    })
  ];
  const bindings = routes.map((route) => buildNativeRouteBinding(route, "agent-a"));
  setOpenClawAdapterForTesting({
    getConfig: async (path: string) => path === "bindings" ? bindings : {},
    listAgents: async () => ({ defaultId: null, agents: [{ id: "agent-a" }, { id: "agent-b" }] })
  } as unknown as OpenClawAdapter);

  const summary = await getAgentChannelRouteSummary({ agentId: "agent-a" });
  assert.deepEqual(
    summary.routes.map((entry) => [entry.provider, entry.route?.routeId, entry.displayMatch]),
    [
      ["discord", "support", "explicit"],
      ["slack", "sales", "explicit"],
      ["whatsapp", "whatsapp-group", "explicit"]
    ]
  );
  assert.equal((await getAgentChannelRouteSummary({ agentId: "agent-b" })).routes.length, 0);
});

test("default routing and no binding remain distinct in the Agent Profile projection", async () => {
  const defaultAdapter = {
    getConfig: async () => [],
    listAgents: async () => ({ defaultId: "agent-default", agents: [{ id: "agent-default" }, { id: "agent-other" }] })
  } as unknown as OpenClawAdapter;
  const defaultSummary = await getAgentChannelRouteSummary({ agentId: "agent-default", adapter: defaultAdapter });
  const emptySummary = await getAgentChannelRouteSummary({ agentId: "agent-other", adapter: defaultAdapter });

  assert.equal(defaultSummary.routes[0]?.displayMatch, "default");
  assert.equal(emptySummary.routes.length, 0);
});

test("Agent card route badges come only from native provider bindings, never default-only routing", async () => {
  const route = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-1001"
  });
  const adapter = {
    getConfig: async (path: string) => path === "bindings"
      ? [buildNativeRouteBinding(route, "agent-explicit")]
      : {},
    listAgents: async () => ({ defaultId: "agent-default", agents: [{ id: "agent-explicit" }, { id: "agent-default" }] })
  } as unknown as OpenClawAdapter;

  const badges = await getAgentChannelRouteBadgeSummaries({
    agentIds: ["agent-explicit", "agent-default"],
    adapter
  });

  assert.deepEqual(badges["agent-explicit"], { providers: [{ provider: "telegram", routeCount: 1 }] });
  assert.equal(badges["agent-default"], undefined);
});

test("Telegram topic native overrides add their provider to Agent card badges", async () => {
  const adapter = {
    getConfig: async (path: string) => {
      if (path === "bindings") return [];
      if (path === "channels.telegram") {
        return {
          accounts: {
            main: {
              groups: {
                "-1001": { topics: { "42": { agentId: "agent-topic" } } }
              }
            }
          }
        };
      }
      return {};
    }
  } as unknown as OpenClawAdapter;

  const badges = await getAgentChannelRouteBadgeSummaries({ agentIds: ["agent-topic"], adapter });
  assert.deepEqual(badges["agent-topic"], { providers: [{ provider: "telegram", routeCount: 1 }] });
});

test("Agent card badge counts stay specific to each native provider", async () => {
  const routes = [
    buildChannelRouteIdentity({ provider: "telegram", accountId: "telegram-main", kind: "group", routeId: "support" }),
    buildChannelRouteIdentity({ provider: "telegram", accountId: "telegram-main", kind: "group", routeId: "sales" }),
    buildChannelRouteIdentity({ provider: "discord", accountId: "discord-main", kind: "channel", routeId: "alerts", parentRouteId: "guild-1" })
  ];
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? routes.map((route) => buildNativeRouteBinding(route, "agent-a")) : {},
    listAgents: async () => ({ defaultId: null, agents: [{ id: "agent-a" }] })
  } as unknown as OpenClawAdapter;

  const badges = await getAgentChannelRouteBadgeSummaries({ agentIds: ["agent-a"], adapter });

  assert.deepEqual(badges["agent-a"], {
    providers: [
      { provider: "discord", routeCount: 1 },
      { provider: "telegram", routeCount: 2 }
    ]
  });
});

test("removing the last native route removes the provider badge", async () => {
  const route = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "telegram-main",
    kind: "group",
    routeId: "support"
  });
  let bindings: unknown[] = [buildNativeRouteBinding(route, "agent-a")];
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? bindings : {},
    listAgents: async () => ({ defaultId: null, agents: [{ id: "agent-a" }] })
  } as unknown as OpenClawAdapter;

  const connected = await getAgentChannelRouteBadgeSummaries({ agentIds: ["agent-a"], adapter });
  assert.equal(connected["agent-a"]?.providers[0]?.routeCount, 1);

  bindings = [];
  const disconnected = await getAgentChannelRouteBadgeSummaries({ agentIds: ["agent-a"], adapter });
  assert.equal(disconnected["agent-a"], undefined);
});

test("Channel Center and Agent Profile share native mutation state and restore inheritance after override removal", async () => {
  const parent = buildChannelRouteIdentity({
    provider: "discord",
    accountId: "discord-main",
    kind: "group",
    routeId: "guild-1",
    metadata: { nativeScope: "guild", guildId: "guild-1" }
  });
  const child = buildChannelRouteIdentity({
    provider: "discord",
    accountId: "discord-main",
    kind: "channel",
    routeId: "sales",
    parentRouteId: "guild-1",
    metadata: { nativePeerKind: "channel", guildId: "guild-1" }
  });
  let bindings: unknown[] = [buildNativeRouteBinding(parent, "agent-a")];
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? bindings : {},
    setConfig: async (_path: string, value: unknown) => {
      bindings = value as unknown[];
      return { stdout: JSON.stringify({ configMutation: { appliedVia: "config.patch" } }), stderr: "" };
    },
    listAgents: async () => ({ defaultId: null, agents: [{ id: "agent-a" }, { id: "agent-b" }] })
  } as unknown as OpenClawAdapter;

  await setChannelRouteBinding({ route: child, agentId: "agent-b", adapter });
  const assigned = await getAgentChannelRouteSummary({ agentId: "agent-b", adapter });
  assert.equal(assigned.routes.some((entry) => entry.route?.routeId === "sales" && entry.displayMatch === "explicit"), true);

  await clearChannelRouteBinding({ route: child, adapter });
  const restored = resolveChannelRouteBinding(child, { entries: bindings.map((binding, index) => ({ index, binding: binding as { agentId: string; match: Record<string, unknown> } })) });
  assert.equal(restored.agentId, "agent-a");
  assert.equal(restored.effectiveMatch, "inherited");
});

test("agent route projection is stable across rename and workspace move because it keys on agent id", async () => {
  const route = buildChannelRouteIdentity({
    provider: "slack",
    accountId: "workspace",
    kind: "channel",
    routeId: "channel-1",
    parentRouteId: "team-1"
  });
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? [buildNativeRouteBinding(route, "stable-agent")] : {},
    listAgents: async () => ({ defaultId: null, agents: [{ id: "stable-agent" }] })
  } as unknown as OpenClawAdapter;

  const renamed = await getAgentChannelRouteSummary({ agentId: "stable-agent", adapter });
  const afterWorkspaceMove = await getAgentChannelRouteSummary({ agentId: "stable-agent", adapter });

  assert.deepEqual(renamed.routes.map((entry) => entry.id), afterWorkspaceMove.routes.map((entry) => entry.id));
  assert.equal(afterWorkspaceMove.routes[0]?.route?.routeId, "channel-1");
});
