import assert from "node:assert/strict";
import { test } from "node:test";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import { getRuntimeOutputForResolvedRuntime } from "@/lib/openclaw/domains/runtime-transcript";
import { sanitizeGatewayDiagnosticText } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isOpenClawOnboardingSystemReady,
  isOpenClawOnboardingModelReady,
  isOpenClawSystemReady,
  resolveAgentCreationReadinessError,
  resolveMissionDispatchReadinessError,
  resolveWorkspaceCreationReadinessError
} from "@/lib/openclaw/readiness";
import type { RuntimeRecord } from "@/lib/openclaw/types";

test("OpenClaw missing snapshot does not present fake live workspaces, models, agents, or runtimes", () => {
  const snapshot = createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
    installed: false,
    loaded: false,
    rpcOk: false
  });

  assert.equal(snapshot.mode, "fallback");
  assert.equal(snapshot.diagnostics.installed, false);
  assert.equal(snapshot.diagnostics.rpcOk, false);
  assert.equal(snapshot.diagnostics.modelReadiness.ready, false);
  assert.deepEqual(snapshot.workspaces, []);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.models, []);
  assert.deepEqual(snapshot.runtimes, []);
  assert.deepEqual(snapshot.tasks, []);
});

test("first-run write actions return actionable readiness failures before mutation", () => {
  const snapshot = createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
    installed: false,
    loaded: false,
    rpcOk: false
  });

  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /OpenClaw CLI is not installed/);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /blocked before any files are written/);
  assert.match(resolveAgentCreationReadinessError(snapshot) ?? "", /Agent creation is blocked/);
  assert.match(resolveMissionDispatchReadinessError(snapshot) ?? "", /Mission dispatch is blocked/);
});

test("onboarding system readiness waits for runtime write access after Gateway RPC", () => {
  const snapshot = createErrorSnapshot("Runtime state is not writable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });

  assert.equal(isOpenClawSystemReady(snapshot), false);
  assert.equal(isOpenClawOnboardingSystemReady(snapshot), false);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /runtime state is not writable/i);

  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;

  assert.equal(isOpenClawSystemReady(snapshot), true);
  assert.equal(isOpenClawOnboardingSystemReady(snapshot), true);
});

test("model readiness failures explain the next action for first workspace and agent creation", () => {
  const snapshot = createErrorSnapshot("Model setup unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.diagnostics.modelReadiness = {
    ...snapshot.diagnostics.modelReadiness,
    ready: false,
    totalModelCount: 0,
    availableModelCount: 0,
    issues: []
  };

  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /No models are configured yet/);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /Choose a model before creating the first workspace/);
  assert.match(resolveAgentCreationReadinessError(snapshot) ?? "", /Choose a ready model before creating the agent/);
});

test("workspace-backed agent models keep first-run actions usable when the global default is missing", () => {
  const snapshot = createErrorSnapshot("Model setup default is missing.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.workspaces = [
    {
      id: "workspace",
      name: "Workspace",
      path: "/tmp/workspace",
      status: "ready",
      tags: []
    }
  ] as unknown as typeof snapshot.workspaces;
  snapshot.agents = [
    {
      id: "main",
      workspaceId: "workspace",
      workspacePath: "/tmp/workspace",
      modelId: "openai/gpt-5.4-mini",
      name: "Main",
      status: "ready",
      role: "Worker",
      emoji: "A",
      theme: "slate",
      avatar: null,
      heartbeat: null,
      skills: [],
      tools: [],
      policy: {
        preset: "worker",
        missingToolBehavior: "ask-setup",
        installScope: "none",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      }
    }
  ] as unknown as typeof snapshot.agents;
  snapshot.models = [
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT 5.4 Mini",
      provider: "openai-codex",
      input: "remote",
      contextWindow: null,
      local: false,
      available: true,
      missing: false,
      tags: [],
      usageCount: 1
    }
  ];
  snapshot.diagnostics.modelReadiness = {
    ...snapshot.diagnostics.modelReadiness,
    ready: false,
    defaultModel: null,
    resolvedDefaultModel: null,
    defaultModelReady: false,
    recommendedModelId: "openai/gpt-5.4-mini",
    totalModelCount: 1,
    availableModelCount: 1,
    issues: ["Choose a default model to finish setup."]
  };

  assert.equal(isOpenClawOnboardingModelReady(snapshot), true);
  assert.equal(resolveMissionDispatchReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.equal(resolveWorkspaceCreationReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.equal(resolveAgentCreationReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.match(resolveAgentCreationReadinessError(snapshot, "openai/missing") ?? "", /not ready/);
});

test("runtime output surfaces an explicit diagnostic when dispatch output is empty", async () => {
  const snapshot = createErrorSnapshot("OpenClaw snapshot unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.mode = "live";
  const runtime: RuntimeRecord = {
    id: "runtime:dispatch:dispatch-1",
    source: "turn",
    key: "dispatch:dispatch-1",
    title: "First mission",
    subtitle: "Mission accepted.",
    status: "running",
    updatedAt: Date.parse("2026-05-22T10:00:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    metadata: {
      dispatchId: "dispatch-1",
      dispatchStatus: "running",
      mission: "Say hello"
    }
  };

  const output = await getRuntimeOutputForResolvedRuntime(runtime, snapshot);

  assert.equal(output.status, "missing");
  assert.match(output.errorMessage ?? "", /no transcript output has been captured yet/i);
  assert.equal(output.finalText, null);
  assert.deepEqual(output.items, []);
});

test("runtime output redacts dispatch metadata errors before exposing diagnostics", async () => {
  const snapshot = createErrorSnapshot("OpenClaw snapshot unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.mode = "live";
  const runtime: RuntimeRecord = {
    id: "runtime:dispatch:dispatch-secret",
    source: "turn",
    key: "dispatch:dispatch-secret",
    title: "First mission",
    subtitle: "Mission failed.",
    status: "stalled",
    updatedAt: Date.parse("2026-05-22T10:00:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    metadata: {
      dispatchId: "dispatch-secret",
      dispatchStatus: "failed",
      error: "Gateway rejected request with token=query-secret and password=json-secret"
    }
  };

  const output = await getRuntimeOutputForResolvedRuntime(runtime, snapshot);

  assert.equal(output.status, "missing");
  assert.doesNotMatch(output.errorMessage ?? "", /query-secret|json-secret/);
  assert.match(output.errorMessage ?? "", /\[redacted\]/);
});

test("Gateway diagnostic sanitization redacts token, password, bearer, and URL query secrets", () => {
  const sanitized = sanitizeGatewayDiagnosticText(
    'Authorization: Bearer bearer-secret ws://127.0.0.1:18789/?token=query-secret {"password":"json-secret","clientSecret":"client-secret"}'
  );

  assert.doesNotMatch(sanitized, /bearer-secret|query-secret|json-secret|client-secret/);
  assert.match(sanitized, /\[redacted\]/);
});
