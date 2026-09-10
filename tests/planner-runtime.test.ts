import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generateWorkspaceBlueprint
} from "@/lib/agentos/application/workspace-architect";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  ensureAgentOsPlannerRuntime,
  ensureWorkspaceArchitectRuntime,
  PLANNER_RUNTIME_ARCHITECT_AGENT_ID,
  PLANNER_RUNTIME_WORKSPACE_PATH,
  type PlannerRuntimeEnsureDependencies
} from "@/lib/openclaw/application/planner-runtime-service";

function createRuntimeFixture(options: {
  workspace?: boolean;
  architect?: boolean;
  manifestReady?: boolean;
  createDelayMs?: number;
  failSnapshot?: Error;
} = {}) {
  let workspace = options.workspace ? { id: "planner-runtime", path: PLANNER_RUNTIME_WORKSPACE_PATH } : null;
  const agentIds = new Set<string>();
  if (options.architect) agentIds.add(PLANNER_RUNTIME_ARCHITECT_AGENT_ID);
  let manifestReady = options.manifestReady !== false;
  let workspaceCreateCount = 0;
  let agentCreateCount = 0;
  let configureCount = 0;
  const dependencies: PlannerRuntimeEnsureDependencies = {
    getSnapshot: async () => {
      if (options.failSnapshot) throw options.failSnapshot;
      return {
        workspaces: workspace ? [workspace] : [],
        agents: Array.from(agentIds).map((id) => ({ id, workspaceId: workspace?.id ?? "" }))
      } as never;
    },
    createWorkspaceProject: async (request) => {
      workspaceCreateCount += 1;
      if (options.createDelayMs) await new Promise((resolve) => setTimeout(resolve, options.createDelayMs));
      workspace = { id: "planner-runtime", path: request.directory ?? PLANNER_RUNTIME_WORKSPACE_PATH };
      for (const agent of request.agents ?? []) agentIds.add(`agentos-planner-runtime-${agent.id}`);
      return {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        agentIds: [...agentIds],
        primaryAgentId: PLANNER_RUNTIME_ARCHITECT_AGENT_ID
      };
    },
    createAgent: async (request) => {
      agentCreateCount += 1;
      agentIds.add(request.id);
    },
    readManifest: async () => ({ hidden: manifestReady, systemTag: manifestReady ? "mission-control-planner" : null } as never),
    configureWorkspace: async () => {
      configureCount += 1;
      manifestReady = true;
    }
  };
  return {
    dependencies,
    get workspaceCreateCount() { return workspaceCreateCount; },
    get agentCreateCount() { return agentCreateCount; },
    get configureCount() { return configureCount; }
  };
}

function architectAdapter(onRun?: (agentId: string) => void): OpenClawAdapter {
  return {
    runAgentTurn: async (request: { agentId: string }) => {
      onRun?.(request.agentId);
      return {
        runId: "architect-run",
        result: { payloads: [{ text: JSON.stringify({ workforce: { specialists: [] } }) }] }
      };
    }
  } as unknown as OpenClawAdapter;
}

test("fresh default Architect generation bootstraps the canonical internal runtime", async () => {
  const runtime = createRuntimeFixture();
  const seenAgentIds: string[] = [];
  const result = await generateWorkspaceBlueprint({ brief: "Build a workspace." }, {
    adapter: architectAdapter((agentId) => seenAgentIds.push(agentId)),
    runtimeDependencies: runtime.dependencies
  });

  assert.equal(result.reasoning.status, "model");
  assert.equal(result.reasoning.mode, "openclaw-agent");
  assert.equal(result.reasoning.failureKind, "none");
  assert.deepEqual(seenAgentIds, [PLANNER_RUNTIME_ARCHITECT_AGENT_ID]);
  assert.equal(runtime.workspaceCreateCount, 1);
  assert.equal(runtime.agentCreateCount, 0);
});

test("ready internal runtime is idempotent and partial runtime repair is minimal", async () => {
  const ready = createRuntimeFixture({ workspace: true, architect: true });
  const first = await ensureWorkspaceArchitectRuntime({ dependencies: ready.dependencies });
  const second = await ensureWorkspaceArchitectRuntime({ dependencies: ready.dependencies });
  assert.equal(first.status, "ready");
  assert.equal(second.workspaceId, first.workspaceId);
  assert.equal(ready.workspaceCreateCount, 0);
  assert.equal(ready.agentCreateCount, 0);

  const partial = createRuntimeFixture({ workspace: true, manifestReady: false });
  const repaired = await ensureWorkspaceArchitectRuntime({ dependencies: partial.dependencies });
  assert.equal(repaired.status, "ready");
  assert.equal(partial.workspaceCreateCount, 0);
  assert.equal(partial.agentCreateCount, 1);
  assert.equal(partial.configureCount, 2);
});

test("concurrent Architect runtime ensures share one coherent provisioning operation", async () => {
  const runtime = createRuntimeFixture({ createDelayMs: 10 });
  const results = await Promise.all([
    ensureWorkspaceArchitectRuntime({ dependencies: runtime.dependencies }),
    ensureWorkspaceArchitectRuntime({ dependencies: runtime.dependencies })
  ]);

  assert.equal(runtime.workspaceCreateCount, 1);
  assert.equal(runtime.agentCreateCount, 0);
  assert.deepEqual(results.map((result) => result.architectAgentId), [PLANNER_RUNTIME_ARCHITECT_AGENT_ID, PLANNER_RUNTIME_ARCHITECT_AGENT_ID]);
});

test("legacy planner can lazily request advisors after Architect-only bootstrap", async () => {
  const runtime = createRuntimeFixture();
  const architectOnly = await ensureWorkspaceArchitectRuntime({ dependencies: runtime.dependencies });
  assert.equal(architectOnly.status, "ready");
  assert.equal(runtime.agentCreateCount, 0);

  const withAdvisors = await ensureAgentOsPlannerRuntime({ includeAdvisors: true, dependencies: runtime.dependencies });
  assert.equal(withAdvisors.status, "ready");
  assert.equal(Object.keys(withAdvisors.advisorAgentIds).length, 5);
  assert.equal(runtime.workspaceCreateCount, 1);
  assert.equal(runtime.agentCreateCount, 5);
});

test("runtime bootstrap failure produces an honest safe fallback and no model turn", async () => {
  let modelCalls = 0;
  const runtime = createRuntimeFixture({ failSnapshot: new Error("Gateway unavailable") });
  const result = await generateWorkspaceBlueprint({ brief: "Build a workspace." }, {
    adapter: architectAdapter(() => { modelCalls += 1; }),
    runtimeDependencies: runtime.dependencies,
    maxRetries: 1
  });

  assert.equal(modelCalls, 0);
  assert.equal(result.reasoning.status, "fallback");
  assert.equal(result.reasoning.failureKind, "gateway");
  assert.match(result.reasoning.warning ?? "", /runtime bootstrap failed/i);
  assert.equal(result.blueprint.status, "draft");
});

test("model failure after successful bootstrap remains distinct from runtime failure", async () => {
  const runtime = createRuntimeFixture();
  let modelCalls = 0;
  const adapter = {
    runAgentTurn: async () => {
      modelCalls += 1;
      throw new Error("model turn failed");
    }
  } as unknown as OpenClawAdapter;
  const result = await generateWorkspaceBlueprint({ brief: "Build a workspace." }, {
    adapter,
    runtimeDependencies: runtime.dependencies,
    maxRetries: 1
  });

  assert.equal(modelCalls, 2);
  assert.equal(runtime.workspaceCreateCount, 1);
  assert.equal(result.reasoning.failureKind, "model");
  assert.doesNotMatch(result.reasoning.warning ?? "", /runtime bootstrap failed/i);
  assert.equal(result.blueprint.workforce.specialists.length, 0);
});
