import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildWorkspaceContextDiagnosticIssues,
  buildWorkspaceContextDiagnostics
} from "@/lib/openclaw/application/mission-control/workspace-context-diagnostics";
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

test("historical workspace context findings stay visible without degrading active runtime health", () => {
  const report = buildWorkspaceContextDiagnostics({
    workspaces: [workspace("workspace-1")],
    agents: [],
    runtimes: [runtime("runtime-old", "workspace-missing", "agent-old", "completed")],
    tasks: [task("task-old", "workspace-missing", [], "completed")]
  });

  assert.equal(report.hasActiveIssues, false);
  assert.equal(report.issues.length, 2);
  assert.equal(report.issues.every((issue) => /0 active records/.test(issue)), true);
});

test("workspace context findings on queued work remain health-affecting", () => {
  const report = buildWorkspaceContextDiagnostics({
    workspaces: [workspace("workspace-1")],
    agents: [],
    runtimes: [],
    tasks: [task("task-queued", "workspace-missing", [], "queued")]
  });

  assert.equal(report.hasActiveIssues, true);
  assert.match(report.issues[0], /1 active record/);
});

test("workspace context findings on stalled work remain diagnostic without degrading live runtime health", () => {
  const report = buildWorkspaceContextDiagnostics({
    workspaces: [workspace("workspace-1")],
    agents: [agent("agent-1", "workspace-1")],
    runtimes: [runtime("runtime-stalled", "workspace-missing", "agent-1", "stalled")],
    tasks: [task("task-stalled", "workspace-missing", ["runtime-stalled"], "stalled")]
  });

  assert.equal(report.hasActiveIssues, false);
  assert.equal(report.issues.length, 3);
  assert.equal(report.issues.every((issue) => /0 active records/.test(issue)), true);
  assert.equal(report.issues.every((issue) => /No live/.test(issue)), true);
});

test("workspace context findings with unknown status remain health-affecting", () => {
  const report = buildWorkspaceContextDiagnostics({
    workspaces: [workspace("workspace-1")],
    agents: [],
    runtimes: [],
    tasks: [task("task-unknown", "workspace-missing", [], "unknown" as TaskRecord["status"])]
  });

  assert.equal(report.hasActiveIssues, true);
  assert.match(report.issues[0], /1 active record/);
});

function workspace(id: string): WorkspaceProject {
  return { id } as WorkspaceProject;
}

function agent(id: string, workspaceId: string): OpenClawAgent {
  return { id, workspaceId } as OpenClawAgent;
}

function runtime(
  id: string,
  workspaceId: string,
  agentId: string,
  status: RuntimeRecord["status"] = "running"
): RuntimeRecord {
  return {
    id,
    workspaceId,
    agentId,
    status
  } as RuntimeRecord;
}

function task(
  id: string,
  workspaceId: string,
  runtimeIds: string[],
  status: TaskRecord["status"] = "running"
): TaskRecord {
  return {
    id,
    workspaceId,
    runtimeIds,
    status
  } as TaskRecord;
}
