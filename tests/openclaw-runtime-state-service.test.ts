import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeOpenClawGatewayEventFrame } from "@/lib/agentos/acl/openclaw";
import {
  mapOpenClawRuntimeSnapshotToRuntimes,
  normalizeOpenClawGatewayEventToRuntime
} from "@/lib/openclaw/application/runtime-state-service";

test("runtime snapshot mapper converts Gateway sessions, tasks, and artifacts into runtime records", () => {
  const runtimes = mapOpenClawRuntimeSnapshotToRuntimes(
    {
      sessions: [{
        key: "agent:agent-1:task:task-1",
        sessionId: "session-1",
        agentId: "agent-1",
        updatedAt: 1_700_000_000_000,
        status: "running",
        model: "openai/test",
        totalTokens: 42
      }],
      tasks: [{
        id: "task-1",
        agentId: "agent-1",
        sessionKey: "agent:agent-1:explicit:session-1",
        title: "Ship runtime state",
        mission: "Ship runtime state",
        status: "queued",
        updatedAt: 1_700_000_001_000,
        artifacts: [{ path: "deliverables/runtime.md", name: "runtime.md" }]
      }],
      artifacts: [{
        id: "artifact-1",
        taskId: "task-1",
        agentId: "agent-1",
        path: "deliverables/runtime.md",
        updatedAt: 1_700_000_002_000
      }]
    },
    {
      agentConfig: [{ id: "agent-1", workspace: "/tmp/workspace", model: "openai/test" }],
      agentsList: [{ id: "agent-1", workspace: "/tmp/workspace", model: "openai/test" }],
      resolveWorkspaceId: () => "workspace-1"
    }
  );

  assert.equal(runtimes.length, 3);
  assert.equal(runtimes[0].metadata.origin, "openclaw-runtime-snapshot");
  assert.equal(runtimes[0].workspaceId, "workspace-1");
  assert.equal(runtimes[1].taskId, "task-1");
  assert.equal(runtimes[1].sessionId, "session-1");
  assert.equal(runtimes[1].metadata.gatewayObjectKind, "task");
  const taskMetadata = runtimes[1].metadata as Record<string, unknown>;
  assert.equal(taskMetadata.openClawSessionId, "session-1");
  assert.equal(taskMetadata.openClawSessionKey, "agent:agent-1:explicit:session-1");
  assert.deepEqual(taskMetadata.createdFiles, [{
    path: "deliverables/runtime.md",
    displayPath: "runtime.md"
  }]);
  assert.equal(runtimes[2].metadata.gatewayObjectKind, "artifact");
});

test("runtime snapshot mapper preserves workspace linkage without agent catalog fallback", () => {
  const runtimes = mapOpenClawRuntimeSnapshotToRuntimes(
    {
      sessions: [{
        key: "agent:missing-agent:task:task-1",
        sessionId: "session-1",
        agentId: "missing-agent",
        workspacePath: "/tmp/runtime-only-workspace",
        updatedAt: 1_700_000_000_000,
        status: "running"
      }],
      tasks: [{
        id: "task-1",
        agentId: "missing-agent",
        workspace: "/tmp/runtime-only-workspace",
        title: "Continue runtime-only task",
        status: "running",
        updatedAt: 1_700_000_001_000
      }],
      artifacts: [{
        id: "artifact-1",
        taskId: "task-1",
        workspacePath: "/tmp/runtime-only-workspace",
        path: "deliverables/result.md",
        updatedAt: 1_700_000_002_000
      }]
    },
    {
      agentConfig: [],
      agentsList: [],
      resolveWorkspaceId: (workspacePath) =>
        workspacePath === "/tmp/runtime-only-workspace" ? "runtime-only-workspace" : "unexpected"
    }
  );

  assert.equal(runtimes.length, 3);
  assert.deepEqual(
    runtimes.map((runtime) => runtime.workspaceId),
    ["runtime-only-workspace", "runtime-only-workspace", "runtime-only-workspace"]
  );
  assert.deepEqual(
    runtimes.map((runtime) => runtime.workspacePath),
    ["/tmp/runtime-only-workspace", "/tmp/runtime-only-workspace", "/tmp/runtime-only-workspace"]
  );
});

test("Gateway event normalizers preserve runtime-neutral task and artifact state", () => {
  const frame = {
    type: "event",
    event: "artifact.updated",
    payload: {
      agentId: "agent-1",
      sessionId: "session-1",
      taskId: "task-1",
      artifactId: "artifact-1",
      path: "deliverables/runtime.md",
      status: "completed",
      timestamp: "2026-05-18T10:00:00.000Z"
    }
  };

  const runtime = normalizeOpenClawGatewayEventToRuntime(frame);
  const event = normalizeOpenClawGatewayEventFrame(frame);

  assert.ok(runtime);
  assert.equal(runtime.status, "completed");
  assert.equal(runtime.taskId, "task-1");
  assert.equal(runtime.metadata.artifactId, "artifact-1");
  assert.deepEqual(runtime.metadata.createdFiles, [{
    path: "deliverables/runtime.md",
    displayPath: "deliverables/runtime.md"
  }]);
  assert.equal(event.kind, "artifact");
  assert.equal(event.source, "gateway");
  assert.equal(event.taskId, "task-1");
  assert.equal(event.receivedAt, "2026-05-18T10:00:00.000Z");
});

test("Gateway event normalizer preserves workspace path linkage", () => {
  const runtime = normalizeOpenClawGatewayEventToRuntime({
    type: "event",
    event: "task.updated",
    payload: {
      agentId: "agent-1",
      sessionId: "session-1",
      taskId: "task-1",
      workspacePath: "/tmp/runtime-only-workspace",
      message: "Task is still running"
    }
  });

  assert.ok(runtime);
  assert.equal(runtime.workspaceId, "runtime-only-workspace");
  assert.equal(runtime.workspacePath, "/tmp/runtime-only-workspace");
});

test("Gateway event normalizer preserves AgentOS direct chat origin metadata", () => {
  const runtime = normalizeOpenClawGatewayEventToRuntime({
    type: "event",
    event: "chat",
    payload: {
      agentId: "agent-1",
      sessionId: "agent:agent-1:explicit:chat-session",
      runId: "agentos:mpvp9v8y:rdxnctfeg5o",
      message: "Agent is replying",
      metadata: {
        origin: "agentos-direct-chat",
        kind: "direct",
        chatType: "direct"
      }
    }
  });

  assert.ok(runtime);
  assert.equal(runtime.metadata.origin, "agentos-direct-chat");
  assert.equal(runtime.metadata.kind, "direct");
  assert.equal(runtime.metadata.chatType, "direct");
});
