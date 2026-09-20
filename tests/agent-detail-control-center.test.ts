import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildAgentDetailActivity,
  buildAgentDetailSessions,
  resolveAgentCurrentWork
} from "@/components/operations/agents/agent-detail-data";
import { scopeMissionControlSnapshot } from "@/components/operations/operations-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

function createSnapshot(): MissionControlSnapshot {
  return {
    generatedAt: "2026-09-20T10:00:00.000Z",
    mode: "live",
    diagnostics: { workspaceRoot: "/workspaces", modelReadiness: { resolvedDefaultModel: null, defaultModel: null } } as unknown as MissionControlSnapshot["diagnostics"],
    presence: [],
    channelAccounts: [],
    workspaces: [
      { id: "workspace-a", name: "Workspace A", path: "/workspaces/a", agentIds: ["agent-a"], modelIds: [] },
      { id: "workspace-b", name: "Workspace B", path: "/workspaces/b", agentIds: ["agent-b"], modelIds: [] }
    ] as unknown as MissionControlSnapshot["workspaces"],
    agents: [
      { id: "agent-a", name: "Researcher", workspaceId: "workspace-a", status: "ready", sessionCount: 1, currentAction: "Reviewing evidence", activeRuntimeIds: [], modelId: "model-a" },
      { id: "agent-b", name: "Writer", workspaceId: "workspace-b", status: "ready", sessionCount: 0, currentAction: "", activeRuntimeIds: [], modelId: "model-b" }
    ] as unknown as MissionControlSnapshot["agents"],
    models: [],
    runtimes: [
      { id: "runtime-a", source: "session", key: "agent:agent-a:main", title: "Evidence review", subtitle: "Reading the latest source set", status: "running", updatedAt: Date.parse("2026-09-20T09:59:00.000Z"), ageMs: null, agentId: "agent-a", sessionId: "session-a", taskId: "task-a", tokenUsage: { input: 10, output: 20, total: 30 }, metadata: {} },
      { id: "runtime-b", source: "session", key: "agent:agent-b:main", title: "Other workspace", subtitle: "Should not appear", status: "running", updatedAt: Date.parse("2026-09-20T09:59:00.000Z"), ageMs: null, agentId: "agent-b", sessionId: "session-b", metadata: {} }
    ],
    tasks: [
      { id: "task-a", key: "task-a", title: "Review sources", mission: "Review sources", subtitle: "Confirm the evidence", status: "running", updatedAt: Date.parse("2026-09-20T09:58:00.000Z"), ageMs: null, primaryAgentId: "agent-a", runtimeIds: ["runtime-a"], agentIds: ["agent-a"], sessionIds: ["session-a"], runIds: [], runtimeCount: 1, updateCount: 1, liveRunCount: 1, artifactCount: 0, warningCount: 0, metadata: {} },
      { id: "task-b", key: "task-b", title: "Other task", mission: null, subtitle: "Other workspace", status: "running", updatedAt: Date.parse("2026-09-20T09:58:00.000Z"), ageMs: null, primaryAgentId: "agent-b", runtimeIds: [], agentIds: ["agent-b"], sessionIds: ["session-b"], runIds: [], runtimeCount: 0, updateCount: 1, liveRunCount: 1, artifactCount: 0, warningCount: 0, metadata: {} }
    ],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: { channels: [] } as unknown as MissionControlSnapshot["channelRegistry"],
    surfaceRuntime: {} as MissionControlSnapshot["surfaceRuntime"],
    surfaceDrift: {} as MissionControlSnapshot["surfaceDrift"]
  };
}

test("agent detail projections stay scoped to the selected agent", () => {
  const snapshot = createSnapshot();
  const sessions = buildAgentDetailSessions(snapshot, "agent-a");
  const activity = buildAgentDetailActivity(snapshot, "agent-a");
  const current = resolveAgentCurrentWork(snapshot.agents[0]!, snapshot);

  assert.deepEqual(sessions.map((entry) => entry.key), ["agent:agent-a:main"]);
  assert.deepEqual(activity.map((entry) => entry.taskId), ["task-a"]);
  assert.equal(current.runtimeId, "runtime-a");
  assert.equal(current.taskId, "task-a");
});

test("workspace scoping cannot project another workspace into an agent detail view", () => {
  const scoped = scopeMissionControlSnapshot(createSnapshot(), "workspace-a");

  assert.deepEqual(scoped.agents.map((agent) => agent.id), ["agent-a"]);
  assert.deepEqual(scoped.tasks.map((task) => task.id), ["task-a"]);
  assert.deepEqual(scoped.runtimes.map((runtime) => runtime.id), ["runtime-a"]);
  assert.deepEqual(scoped.workspaces.map((workspace) => workspace.id), ["workspace-a"]);
});

test("worker detail route and roster preserve the first-class access contract", () => {
  const route = readFileSync(path.join(process.cwd(), "app/agents/[agentId]/page.tsx"), "utf8");
  const shell = readFileSync(path.join(process.cwd(), "components/operations/operations-shell.tsx"), "utf8");
  const roster = readFileSync(path.join(process.cwd(), "components/operations/agents/agents-page-content.tsx"), "utf8");
  const detail = readFileSync(path.join(process.cwd(), "components/operations/agents/agent-detail-page-content.tsx"), "utf8");

  assert.match(route, /preferredWorkspaceId=\{agent\.workspaceId\}/);
  assert.match(shell, /preferredWorkspaceId/);
  assert.match(roster, /Open worker detail/);
  for (const label of ["Overview", "Behavior", "Capabilities", "Channels", "Sessions"]) {
    assert.match(detail, new RegExp(label));
  }
  assert.match(detail, /AgentChatDrawer/);
  assert.match(detail, /MissionDispatchDialog/);
  assert.match(detail, /AgentModelPickerDialog/);
  assert.match(detail, /AgentChannelsSection/);
  assert.match(detail, /EffectiveCapabilitiesPanel/);
});
