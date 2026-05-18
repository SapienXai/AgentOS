import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearOpenClawCapabilityMatrixCacheForTesting,
  getOpenClawCapabilityMatrix,
  setOpenClawCapabilityMatrixNativeCallerForTesting
} from "@/lib/openclaw/application/capability-matrix-service";
import { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/event-bridge-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { submitMissionDispatch } from "@/lib/openclaw/domains/mission-dispatch-workflow";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";

afterEach(() => {
  clearOpenClawCapabilityMatrixCacheForTesting();
  setOpenClawAdapterForTesting(null);
});

test("capability matrix detects advertised Gateway-first methods", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async (method) => {
    assert.equal(method, "rpc.discover");
    return {
      protocolVersion: 4,
      auth: { mode: "device", role: "operator", scopes: ["operator.read", "operator.write"] },
      methods: [
        "chat.send",
        "chat.abort",
        "sessions.subscribe",
        "models.authOrder.set",
        "config.schema",
        "config.schema.lookup",
        "config.patch",
        "logs.tail",
        "agents.create",
        "agents.update",
        "agents.delete",
        "channels.status",
        "skills.status",
        "exec.approval.list",
        "exec.approval.resolve",
        "cron.list",
        "cron.status",
        "update.status"
      ],
      events: ["session.message", "session.tool"]
    };
  });

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.openClawVersion, "9.9.9");
  assert.equal(matrix.gatewayProtocolVersion, "4");
  assert.equal(matrix.authMode, "device");
  assert.equal(matrix.authRole, "operator");
  assert.deepEqual(matrix.authScopes, ["operator.read", "operator.write"]);
  assert.deepEqual(matrix.requestedProtocolRange, { min: 3, max: 4 });
  assert.equal(matrix.configSchemaLookup, "supported");
  assert.equal(matrix.nativeMissionDispatch, "supported");
  assert.equal(matrix.nativeAgentLifecycle, "supported");
  assert.equal(matrix.configPatch, "supported");
  assert.equal(matrix.eventBridge, "supported");
  assert.equal(matrix.channels, "supported");
  assert.equal(matrix.approvals, "supported");
  assert.equal(matrix.logsTail, "supported");
  assert.equal(matrix.cronRead, "supported");
  assert.equal(matrix.operations?.agentCreate.mode, "gateway-native");
  assert.equal(matrix.operations?.modelAuthOrder.mode, "gateway-native");
  assert.equal(matrix.operations?.missionStream.mode, "gateway-native");
  assert.ok(matrix.unsupportedGatewayMethods.includes("models.list"));
  assert.equal(matrix.operations?.modelAuthOrder.compatibility, "preferred");
  assert.equal(matrix.compatibility?.protocol.status, "compatible");
});

test("capability matrix reports Gateway compatibility aliases without degrading to CLI", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["models.auth.order.set"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.operations?.modelAuthOrder.mode, "gateway-native");
  assert.equal(matrix.operations?.modelAuthOrder.compatibility, "alias");
  assert.equal(matrix.operations?.modelAuthOrder.preferredMethod, "models.authOrder.set");
  assert.equal(matrix.operations?.modelAuthOrder.supportedMethod, "models.auth.order.set");
  assert.deepEqual(matrix.compatibility?.aliasOperations, ["modelAuthOrder: models.auth.order.set"]);
  assert.equal(matrix.compatibility?.degradedOperations.includes("modelAuthOrder"), false);
});

test("capability matrix tracks Phase 2 Gateway-native runtime surfaces", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: [
      "sessions.describe",
      "sessions.history",
      "sessions.export",
      "tasks.get",
      "tasks.subscribe",
      "artifacts.list",
      "artifacts.get",
      "runtime.snapshot",
      "tools.catalog",
      "tools.effective"
    ],
    events: ["task.updated", "artifact.updated"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.operations?.sessionHistory.mode, "gateway-native");
  assert.equal(matrix.operations?.taskEvents.mode, "gateway-native");
  assert.equal(matrix.operations?.artifacts.mode, "gateway-native");
  assert.equal(matrix.operations?.runtimeSnapshot.mode, "gateway-native");
  assert.equal(matrix.operations?.tools.mode, "gateway-native");
  assert.equal(matrix.eventBridge, "supported");
  assert.ok(!matrix.unsupportedGatewayMethods.includes("tasks.subscribe"));
  assert.ok(!matrix.unsupportedGatewayMethods.includes("runtime.snapshot"));
});

test("mission dispatch uses native chat when capability matrix supports it", async () => {
  const calls: string[] = [];
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["chat.send"]
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn(input) {
      calls.push(`run:${input.agentId}:${input.dispatchId ?? "none"}`);
      return {
        runId: "run-native-1",
        status: "running",
        summary: "Queued by Gateway"
      };
    }
  }));

  const response = await submitMissionDispatch({ mission: "Ship it", workspaceId: "workspace-1" }, {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });

  assert.equal(response.runId, "run-native-1");
  assert.equal(response.status, "running");
  assert.deepEqual(calls, [`run:agent-1:${response.dispatchId}`]);
});

test("mission dispatch still attempts Gateway-first path when capabilities are unknown", async () => {
  const calls: string[] = [];
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: []
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn(input) {
      calls.push(`run:${input.agentId}:${input.dispatchId ?? "none"}`);
      return {
        runId: "run-unknown-1",
        status: "running",
        summary: "Queued by Gateway"
      };
    }
  }));

  const response = await submitMissionDispatch({ mission: "Try native", workspaceId: "workspace-1" }, {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });

  assert.equal(response.runId, "run-unknown-1");
  assert.equal(response.status, "running");
  assert.deepEqual(calls, [`run:agent-1:${response.dispatchId}`]);
});

test("Gateway event bridge normalizes chat, tool, session, and approval events into runtimes", () => {
  const runtime = normalizeOpenClawGatewayEventToRuntime({
    type: "event",
    event: "approval.requested",
    payload: {
      agentId: "agent-1",
      sessionId: "session-1",
      runId: "run-1",
      approvalId: "approval-1",
      toolName: "shell",
      status: "queued",
      message: "Approval needed"
    }
  });

  assert.ok(runtime);
  assert.equal(runtime.agentId, "agent-1");
  assert.equal(runtime.sessionId, "session-1");
  assert.equal(runtime.runId, "run-1");
  assert.equal(runtime.status, "queued");
  assert.deepEqual(runtime.toolNames, ["shell"]);
  assert.equal(runtime.metadata.origin, "openclaw-gateway-event");
  assert.equal(runtime.metadata.approvalId, "approval-1");
});

function createContractAdapter(overrides: Partial<OpenClawAdapter> = {}): OpenClawAdapter {
  return {
    async getHealth() {
      return { ok: true };
    },
    async getStatus() {
      return { version: "9.9.9" };
    },
    async getGatewayStatus() {
      return {};
    },
    async getModelStatus() {
      return {};
    },
    async getAgentModelStatus() {
      return {};
    },
    async setModelAuthOrder() {
      return { stdout: "", stderr: "" };
    },
    async listAgents() {
      return { agents: [] };
    },
    async listSessions() {
      return { sessions: [] };
    },
    async describeSession() {
      return {};
    },
    async getSessionHistory() {
      return {};
    },
    async exportSession() {
      return {};
    },
    async listTasks() {
      return { tasks: [] };
    },
    async getTask() {
      return {};
    },
    async assignTask() {
      return {};
    },
    async cancelTask() {
      return {};
    },
    async listArtifacts() {
      return { artifacts: [] };
    },
    async getArtifact() {
      return {};
    },
    async putArtifact() {
      return {};
    },
    async deleteArtifact() {
      return {};
    },
    async getRuntimeSnapshot() {
      return {};
    },
    async getToolsCatalog() {
      return { tools: [] };
    },
    async getEffectiveTools() {
      return { tools: [] };
    },
    async invokeTool() {
      return {};
    },
    async subscribeRuntimeEvents() {
      return {
        close() {
          return undefined;
        }
      };
    },
    async getChannelStatus() {
      return {
        ts: 0,
        channelOrder: [],
        channelLabels: {},
        channels: {},
        channelAccounts: {},
        channelDefaultAccountId: {}
      };
    },
    async getChannelLogs() {
      return { lines: [] };
    },
    async listModels() {
      return { models: [] };
    },
    async listSkills() {
      return { skills: [] };
    },
    async listPlugins() {
      return { plugins: [] };
    },
    async scanModels() {
      return [];
    },
    async getConfig() {
      return null;
    },
    async getConfigSchema() {
      return null;
    },
    async lookupConfigSchema() {
      return null;
    },
    async hasConfig() {
      return false;
    },
    async setConfig() {
      return { stdout: "", stderr: "" };
    },
    async unsetConfig() {
      return { stdout: "", stderr: "" };
    },
    async addAgent() {
      return { stdout: "", stderr: "" };
    },
    async updateAgent() {
      return { stdout: "", stderr: "" };
    },
    async deleteAgent() {
      return { stdout: "", stderr: "" };
    },
    async runAgentTurn() {
      return {};
    },
    async abortAgentTurn() {
      return {};
    },
    async streamAgentTurn() {
      return {};
    },
    async probeGateway() {
      return {};
    },
    async controlGateway() {
      return {};
    },
    async call<TPayload>() {
      return {} as TPayload;
    },
    async tailLogs() {
      return {};
    },
    async listExecApprovals() {
      return {};
    },
    async resolveExecApproval() {
      return {};
    },
    async getCronStatus() {
      return {};
    },
    async listCronJobs() {
      return {};
    },
    ...overrides
  };
}

function createSnapshot(): MissionControlSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    mode: "live",
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: true,
      health: "healthy",
      workspaceRoot: "/tmp",
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: {
        mode: "auto",
        path: null,
        resolvedPath: null,
        label: "Auto",
        detail: "Auto"
      },
      modelReadiness: {
        ready: true,
        defaultModel: "openai/test",
        resolvedDefaultModel: "openai/test",
        defaultModelReady: true,
        recommendedModelId: null,
        preferredLoginProvider: null,
        totalModelCount: 1,
        availableModelCount: 1,
        localModelCount: 0,
        remoteModelCount: 1,
        missingModelCount: 0,
        authProviders: [],
        issues: []
      },
      runtime: {
        stateRoot: "/tmp/.openclaw",
        stateWritable: true,
        sessionStoreWritable: true,
        sessionStores: [],
        smokeTest: {
          status: "passed",
          checkedAt: new Date().toISOString(),
          agentId: "agent-1",
          runId: "run-smoke",
          summary: "ok",
          error: null
        },
        issues: []
      },
      securityWarnings: [],
      issues: []
    },
    presence: [],
    channelAccounts: [],
    workspaces: [{
      id: "workspace-1",
      name: "Workspace",
      slug: "workspace",
      path: "/tmp/agentos-contract-workspace",
      kind: "workspace",
      agentIds: ["agent-1"],
      modelIds: [],
      activeRuntimeIds: [],
      totalSessions: 0,
      health: "ready",
      bootstrap: {
        template: null,
        sourceMode: null,
        agentTemplate: null,
        coreFiles: [],
        optionalFiles: [],
        folders: [],
        projectShell: [],
        localSkillIds: []
      },
      capabilities: {
        skills: [],
        tools: [],
        workspaceOnlyAgentCount: 0
      },
      channels: []
    }],
    agents: [{
      id: "agent-1",
      name: "Agent",
      workspaceId: "workspace-1",
      workspacePath: "/tmp/agentos-contract-workspace",
      modelId: "openai/test",
      isDefault: true,
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: "Idle",
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
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      }
    }],
    models: [],
    runtimes: [],
    tasks: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    }
  };
}
