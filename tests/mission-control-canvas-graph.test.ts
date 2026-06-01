import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasGraph } from "@/components/mission-control/canvas.graph";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

test("canvas places agent-owned tasks when task workspace id is missing", () => {
  const snapshot = {
    agents: [
      {
        id: "agent-1",
        name: "Research Lead",
        workspaceId: "workspace-1",
        modelId: "gpt-5.5",
        isDefault: false,
        status: "engaged",
        sessionCount: 1,
        lastActiveAt: null,
        currentAction: "Working",
        activeRuntimeIds: [],
        heartbeat: {
          enabled: false,
          every: null,
          everyMs: null
        },
        identity: {},
        profile: {
          purpose: null,
          operatingInstructions: [],
          responseStyle: [],
          outputPreference: null,
          sourceFiles: []
        },
        skills: [],
        tools: [],
        policy: {
          preset: "worker",
          installScope: "none",
          fileAccess: "workspace",
          network: "enabled",
          missingToolBehavior: "fallback"
        }
      }
    ],
    channelRegistry: {
      channels: []
    },
    models: [],
    relationships: [],
    runtimes: [],
    tasks: [
      {
        id: "task-1",
        key: "session:session-1",
        title: "Gateway runtime event",
        mission: "Prepare launch notes",
        subtitle: "agent",
        status: "running",
        updatedAt: 0,
        ageMs: 0,
        primaryAgentId: "agent-1",
        primaryAgentName: "Research Lead",
        runtimeIds: ["runtime-1"],
        agentIds: ["agent-1"],
        sessionIds: ["session-1"],
        runIds: [],
        runtimeCount: 1,
        updateCount: 1,
        liveRunCount: 1,
        artifactCount: 0,
        warningCount: 0,
        metadata: {}
      }
    ],
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace",
        path: "/tmp/workspace-1",
        description: null,
        agentIds: ["agent-1"],
        runtimeIds: [],
        activeRuntimeIds: [],
        taskIds: ["task-1"],
        status: "engaged",
        metadata: {}
      }
    ]
  } as unknown as MissionControlSnapshot;

  const graph = buildCanvasGraph(
    snapshot,
    0,
    null,
    null,
    null,
    null,
    null,
    null,
    false,
    [],
    [],
    [],
    [],
    () => {},
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    {}
  );

  assert.ok(graph.nodes.some((node) => node.id === "task-1" && node.type === "task"));
});
