import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { resolveAttentionDestination } from "@/lib/agentos/attention-destinations";
import { groupHumanControlItems } from "@/components/operations/human-control-inbox.utils";
import type { AttentionItem } from "@/lib/agentos/contracts";
import { parseAgentDetailQueryState, parseAgentDetailTab } from "@/components/operations/agents/agent-detail-tabs";

function item(overrides: Partial<AttentionItem> = {}) {
  return {
    id: "item-1",
    type: "needs-setup",
    source: { system: "agentos", kind: "effective-capability", sessionKey: "agent:rocket:main", taskId: null },
    worker: { id: "rocket", label: "Rocket" },
    severity: "normal",
    title: "Needs setup",
    summary: "Browser is not connected.",
    createdAt: null,
    updatedAt: null,
    availableActions: [{ id: "open-setup", label: "Open setup" }],
    status: "pending",
    evidence: { capabilityId: "browser", reasonCode: "account_not_connected", toolId: "browser" },
    ...overrides
  } as AttentionItem;
}

test("Agent Detail tabs accept only canonical deep-link values", () => {
  for (const tab of ["overview", "behavior", "capabilities", "channels", "sessions"] as const) {
    assert.equal(parseAgentDetailTab(tab), tab);
  }
  assert.equal(parseAgentDetailTab("capabilities"), "capabilities");
  assert.equal(parseAgentDetailTab("channels"), "channels");
  assert.equal(parseAgentDetailTab("sessions"), "sessions");
  assert.equal(parseAgentDetailTab("not-a-tab"), "overview");
  assert.equal(parseAgentDetailTab(null), "overview");
});

test("Agent Detail server and client query state share bounded canonical parsing", async () => {
  const serverState = parseAgentDetailQueryState({ tab: "capabilities", capability: " browser ", session: "ignored" });
  const clientSearch = new URLSearchParams("?tab=capabilities&capability=%20browser%20&session=ignored");
  const clientState = parseAgentDetailQueryState({
    tab: clientSearch.get("tab"),
    capability: clientSearch.get("capability"),
    session: clientSearch.get("session")
  });
  assert.deepEqual(clientState, serverState);
  assert.equal(parseAgentDetailQueryState({ tab: "not-a-tab", capability: "x" }).tab, "overview");
  assert.equal(parseAgentDetailQueryState({ tab: "sessions", session: "x".repeat(257) }).sessionFocus, null);

  const route = await readFile("app/agents/[agentId]/page.tsx", "utf8");
  const client = await readFile("components/operations/agents/agent-detail-page-content.tsx", "utf8");
  assert.match(route, /searchParams/);
  assert.match(route, /initialTab/);
  assert.match(route, /initialCapabilityFocus/);
  assert.match(route, /initialSessionFocus/);
  assert.match(client, /useState<AgentDetailTab>\(initialTab\)/);
});

test("attention destinations prefer exact worker capability and session surfaces", () => {
  const capability = resolveAttentionDestination(item(), "open-setup");
  assert.equal(capability.href, "/agents/rocket?tab=capabilities&capability=browser");
  assert.equal(capability.label, "Open worker capabilities");

  const session = resolveAttentionDestination(item({
    id: "runtime-1",
    type: "runtime-issue",
    availableActions: [{ id: "inspect", label: "Inspect" }],
    evidence: { runtimeIssueType: "unknown_runtime_action", reasonCode: "unknown_runtime_action" }
  }), "inspect");
  assert.equal(session.href, "/agents/rocket?tab=sessions&session=agent%3Arocket%3Amain");

  const global = resolveAttentionDestination(item({
    id: "runtime-global",
    type: "runtime-issue",
    worker: { id: null, label: null },
    source: { system: "agentos", kind: "gateway_unreachable", sessionKey: null, taskId: null },
    evidence: { runtimeIssueType: "gateway_unreachable", reasonCode: "gateway_unreachable" },
    availableActions: [{ id: "inspect", label: "Inspect" }]
  }), "inspect");
  assert.equal(global.href, "/settings#diagnostics");

  const workerReview = resolveAttentionDestination(item({
    id: "review-1",
    availableActions: [{ id: "review", label: "Review" }],
    source: { system: "openclaw", kind: "approval", sessionKey: null, taskId: null },
    evidence: undefined
  }), "review");
  assert.equal(workerReview.href, "/agents/rocket?tab=overview");

  const accountSetup = resolveAttentionDestination(item({
    id: "account-setup",
    worker: { id: null, label: null },
    source: { system: "agentos", kind: "effective-capability", sessionKey: null, taskId: null },
    availableActions: [{ id: "open-setup", label: "Open setup" }],
    evidence: { reasonCode: "account_not_connected" }
  }), "open-setup");
  assert.equal(accountSetup.href, "/accounts");

  const globalPolicy = resolveAttentionDestination(item({
    id: "global-policy",
    type: "blocked",
    worker: { id: null, label: null },
    source: { system: "agentos", kind: "policy", sessionKey: null, taskId: null },
    availableActions: [{ id: "review-policy", label: "Review policy" }],
    evidence: { reasonCode: "policy_blocked" }
  }), "review-policy");
  assert.equal(globalPolicy.href, "/settings#gateway");
});

test("Human Control groups repeated blockers but preserves decision items and evidence", () => {
  const first = item();
  const second = item({ id: "item-2", source: { ...first.source, sessionKey: "agent:rocket:secondary" } });
  const otherCapability = item({ id: "item-3", evidence: { ...first.evidence, capabilityId: "gmail" } });
  const approval = item({ id: "approval-1", type: "approval", evidence: { toolId: "browser" }, availableActions: [{ id: "approve", label: "Approve" }] });
  const question = item({ id: "question-1", type: "question", evidence: undefined, availableActions: [{ id: "answer", label: "Answer" }] });
  const groups = groupHumanControlItems([first, second, otherCapability, approval, question]);

  assert.equal(groups.length, 4);
  assert.equal(groups[0]?.items.length, 2);
  assert.deepEqual(groups[0]?.items.map((entry) => entry.id), ["item-1", "item-2"]);
  assert.equal(groups.some((group) => group.item.id === "approval-1" && group.items.length === 1), true);
  assert.equal(groups.some((group) => group.item.id === "question-1" && group.items.length === 1), true);
  assert.equal(groups.some((group) => group.item.id === "item-3" && group.items.length === 1), true);
});

test("Human Control runtime grouping preserves exact mission and session destinations", () => {
  const runtime = (overrides: Partial<AttentionItem> = {}) => item({
    type: "runtime-issue",
    availableActions: [{ id: "inspect", label: "Inspect" }],
    evidence: { runtimeIssueType: "task", reasonCode: "task_failed" },
    ...overrides
  });
  const sameMission = groupHumanControlItems([
    runtime({ id: "runtime-a", mission: { id: "mission-a", title: "Mission A" } }),
    runtime({ id: "runtime-b", mission: { id: "mission-a", title: "Mission A" } })
  ]);
  const differentMissions = groupHumanControlItems([
    runtime({ id: "runtime-c", mission: { id: "mission-a", title: "Mission A" } }),
    runtime({ id: "runtime-d", mission: { id: "mission-b", title: "Mission B" } })
  ]);
  const differentSessions = groupHumanControlItems([
    runtime({ id: "runtime-e", mission: undefined, source: { ...item().source, sessionKey: "agent:rocket:one" } }),
    runtime({ id: "runtime-f", mission: undefined, source: { ...item().source, sessionKey: "agent:rocket:two" } })
  ]);

  assert.equal(sameMission.length, 1);
  assert.equal(sameMission[0]?.items.length, 2);
  assert.equal(differentMissions.length, 2);
  assert.equal(differentSessions.length, 2);
});

test("route simulator UI and API are explicit read-only surfaces", async () => {
  const service = await readFile("lib/openclaw/application/channel-route-simulator-service.ts", "utf8");
  const api = await readFile("app/api/openclaw/channels/simulate/route.ts", "utf8");
  const ui = await readFile("components/operations/channels/route-simulator-page-content.tsx", "utf8");
  assert.match(service, /getChannelRouteBinding/);
  assert.match(service, /readTelegramRoutePolicy/);
  assert.doesNotMatch(service, /setChannelRouteBinding|clearChannelRouteBinding|updateChannelRoutePolicy|updateTelegramGroupPermissions/);
  assert.doesNotMatch(api, /requireAgentOsOpenClawPreflight|setConfig|\bsend(?:Message|Text)?\s*\(/);
  assert.match(ui, /no message will be sent/i);
  assert.match(ui, /does not run the model/i);
});
