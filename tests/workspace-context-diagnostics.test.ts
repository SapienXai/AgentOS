import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWorkspaceContextDiagnosticIssues } from "@/lib/openclaw/application/mission-control/workspace-context-diagnostics";
import type { OpenClawAgent, RuntimeRecord, TaskRecord, WorkspaceProject } from "@/lib/openclaw/types";

test("workspace context diagnostics report missing runtime and task workspace links", () => {
  const issues = buildWorkspaceContextDiagnosticIssues({
    workspaces: [workspace("workspace-1")],
    agents: [agent("agent-1", "workspace-1")],
    runtimes: [runtime("runtime-1", "workspace-missing", "agent-1")],
    tasks: [task("task-1", "workspace-missing", ["runtime-1"])]
  });

  assert.equal(issues.length, 3);
  assert.equal(issues.some((issue) => /1 runtime with missing workspace context/.test(issue)), true);
  assert.equal(issues.some((issue) => /1 task with missing workspace context/.test(issue)), true);
  assert.equal(issues.some((issue) => /assigned agent/.test(issue)), true);
});

test("workspace context diagnostics report task and runtime workspace mismatch", () => {
  const issues = buildWorkspaceContextDiagnosticIssues({
    workspaces: [workspace("workspace-1"), workspace("workspace-2")],
    agents: [agent("agent-1", "workspace-1")],
    runtimes: [runtime("runtime-1", "workspace-2", "agent-1")],
    tasks: [task("task-1", "workspace-1", ["runtime-1"])]
  });

  assert.equal(issues.some((issue) => /runtime workspace metadata that differs/.test(issue)), true);
  assert.equal(issues.some((issue) => /assigned agent/.test(issue)), true);
});

test("workspace context diagnostics stay empty for consistent context", () => {
  const issues = buildWorkspaceContextDiagnosticIssues({
    workspaces: [workspace("workspace-1")],
    agents: [agent("agent-1", "workspace-1")],
    runtimes: [runtime("runtime-1", "workspace-1", "agent-1")],
    tasks: [task("task-1", "workspace-1", ["runtime-1"])]
  });

  assert.deepEqual(issues, []);
});

function workspace(id: string): WorkspaceProject {
  return { id } as WorkspaceProject;
}

function agent(id: string, workspaceId: string): OpenClawAgent {
  return { id, workspaceId } as OpenClawAgent;
}

function runtime(id: string, workspaceId: string, agentId: string): RuntimeRecord {
  return {
    id,
    workspaceId,
    agentId
  } as RuntimeRecord;
}

function task(id: string, workspaceId: string, runtimeIds: string[]): TaskRecord {
  return {
    id,
    workspaceId,
    runtimeIds
  } as TaskRecord;
}
