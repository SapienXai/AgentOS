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
      channels: [
        {
          id: "telegram-main",
          name: "Telegram Main",
          type: "telegram",
          primaryAgentId: "agent-1",
          workspaces: [
            {
              workspaceId: "workspace-1",
              agentIds: ["agent-1"],
              groupAssignments: []
            }
          ]
        }
      ]
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
    [],
    [],
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
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
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
    () => {},
    [],
    {},
    {}
  );

  assert.ok(graph.nodes.some((node) => node.id === "task-1" && node.type === "task"));
  const agentNode = graph.nodes.find((node) => node.id === "agent-1");
  const surfaceTetherEdge = graph.edges.find((edge) => edge.id.startsWith("edge:agent-1:surface-module-v1:"));

  assert.ok(agentNode);
  assert.ok(surfaceTetherEdge);
  assert.equal(surfaceTetherEdge.zIndex, 8);
  assert.ok((surfaceTetherEdge.zIndex ?? 0) < (agentNode.zIndex ?? 0));
});

test("buildCanvasGraph renders a pending agent birth node until the live snapshot catches up", () => {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    agents: [],
    tasks: [],
    channelRegistry: {
      channels: []
    },
    models: [{ id: "openai/gpt-4.1", name: "GPT-4.1", provider: "OpenAI" }],
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace",
        path: "/tmp/workspace-1",
        description: null,
        agentIds: [],
        runtimeIds: [],
        activeRuntimeIds: [],
        taskIds: [],
        status: "idle",
        metadata: {}
      }
    ]
  } as unknown as MissionControlSnapshot;

  const graph = buildCanvasGraph(
    snapshot,
    [],
    [],
    0,
    "workspace-1",
    null,
    null,
    "workspace-1-worker",
    null,
    null,
    false,
    [],
    [],
    [],
    [],
    () => {},
    undefined,
    undefined,
    () => {},
    () => {},
    () => {},
    undefined,
    undefined,
    undefined,
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
    () => {},
    [
      {
        id: "workspace-1-worker",
        workspaceId: "workspace-1",
        workspacePath: "/tmp/workspace-1",
        name: "Worker",
        modelId: "openai/gpt-4.1",
        emoji: "*",
        theme: "Build",
        policy: {
          preset: "worker",
          missingToolBehavior: "fallback",
          installScope: "workspace",
          fileAccess: "workspace-only",
          networkAccess: "restricted"
        },
        heartbeat: {
          enabled: false
        },
        skills: [],
        tools: [],
        createdAt: 1
      }
    ],
    {},
    {}
  );

  const agentNode = graph.nodes.find((node) => node.id === "workspace-1-worker");

  assert.equal(agentNode?.type, "agent");
  assert.equal(agentNode?.data.pendingCreation, true);
  assert.equal(agentNode?.data.agent.currentAction, "Provisioning in OpenClaw");
});

test("buildCanvasGraph packs idle workspace agents without growing the workspace for every agent", () => {
  const buildGraphForAgentCount = (agentCount: number) => {
    const agents = Array.from({ length: agentCount }, (_, index) => ({
      id: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      workspaceId: "workspace-1",
      modelId: "gpt-5.5",
      isDefault: index === 0,
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: null,
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
      observedTools: [],
      policy: {
        preset: "worker",
        installScope: "none",
        fileAccess: "workspace",
        network: "enabled",
        missingToolBehavior: "fallback"
      }
    }));
    const snapshot = {
      generatedAt: new Date().toISOString(),
      agents,
      tasks: [],
      channelRegistry: {
        channels: []
      },
      models: [],
      workspaces: [
        {
          id: "workspace-1",
          name: "Workspace",
          path: "/tmp/workspace-1",
          description: null,
          agentIds: agents.map((agent) => agent.id),
          runtimeIds: [],
          activeRuntimeIds: [],
          taskIds: [],
          status: "ready",
          metadata: {}
        }
      ]
    } as unknown as MissionControlSnapshot;

    return buildCanvasGraph(
      snapshot,
      [],
      [],
      0,
      "workspace-1",
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
      undefined,
      () => {},
      () => {},
      () => {},
      undefined,
      undefined,
      undefined,
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
      () => {},
      [],
      {},
      {}
    );
  };

  const oneAgentGraph = buildGraphForAgentCount(1);
  const threeAgentGraph = buildGraphForAgentCount(3);
  const workspaceWithOneAgent = oneAgentGraph.nodes.find((node) => node.id === "workspace-1");
  const workspaceWithThreeAgents = threeAgentGraph.nodes.find((node) => node.id === "workspace-1");
  const firstAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-1");
  const secondAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-2");
  const thirdAgentNode = threeAgentGraph.nodes.find((node) => node.id === "agent-3");

  assert.equal(workspaceWithOneAgent?.style?.height, 700);
  assert.equal(workspaceWithThreeAgents?.style?.height, 700);
  assert.equal(firstAgentNode?.position.y, secondAgentNode?.position.y);
  assert.equal(secondAgentNode?.position.y, thirdAgentNode?.position.y);
  assert.ok((secondAgentNode?.position.x ?? 0) > (firstAgentNode?.position.x ?? 0));
  assert.ok((thirdAgentNode?.position.x ?? 0) > (secondAgentNode?.position.x ?? 0));
});
