import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskConversation, resolveLiveTaskState } from "@/components/mission-control/nodes/task-live-presentation";
import { mergeTaskAssistantUpdate } from "@/hooks/use-task-feed";
import { projectTaskAssistantFrame, projectTaskToolFrame } from "@/lib/openclaw/domains/task-live-events";
import type { TaskRecord } from "@/lib/openclaw/types";

const timestamp = "2026-11-27T10:32:00.000Z";
const target = { sessionKey: "agent:worker:explicit:task-a", sessionId: "session-a", runIds: new Set(["run-a"]), dedicated: true };
const task: TaskRecord = {
  id: "task-a", key: "task-a", title: "Check the source", mission: "Check the source", subtitle: "",
  status: "completed", updatedAt: Date.parse(timestamp), ageMs: 0, runtimeIds: [], agentIds: ["worker"], sessionIds: [],
  runIds: ["run-a"], runtimeCount: 1, updateCount: 0, liveRunCount: 0, artifactCount: 0, warningCount: 0, metadata: {}
};

test("task live frames require the exact session and known run without exposing hidden blocks", () => {
  const payload = {
    sessionKey: target.sessionKey, runId: "run-a", seq: 3, state: "delta", deltaText: "Public",
    message: { role: "assistant", content: [{ type: "thought", text: "private" }, { type: "text", text: "Public" }] }
  };
  const frame = { type: "event" as const, event: "chat", payload };
  const projected = projectTaskAssistantFrame(frame, target);
  assert.equal(projected?.text, "Public");
  assert.equal(projected?.replace, true);
  assert.equal(projectTaskAssistantFrame({ ...frame, payload: { ...payload, sessionKey: "agent:worker:main" } }, target), null);
  assert.equal(projectTaskAssistantFrame({ ...frame, payload: { ...payload, runId: "run-b" } }, target), null);
  assert.equal(projectTaskAssistantFrame({ ...frame, payload: { ...payload, sessionId: "another-session" } }, target), null);
  assert.equal(projectTaskAssistantFrame({ ...frame, payload: { ...payload, message: { role: "user" } } }, target), null);

  const tool = projectTaskToolFrame({ type: "event", event: "session.tool", payload: {
    sessionKey: target.sessionKey, runId: "run-a", stream: "tool",
    data: { phase: "start", toolCallId: "tool-1", name: "read", args: { path: "private" } }
  } }, target);
  assert.equal(tool?.phase, "start");
  assert.equal(tool?.name, "read");
  assert.equal(JSON.stringify(tool).includes("private"), false);
});

test("assistant deltas append once, accept replacement and ignore late frames", () => {
  const first = { type: "assistant" as const, runId: "run-a", sequence: 1, timestamp, text: "First", done: false, replace: true };
  let turns = mergeTaskAssistantUpdate([], first);
  turns = mergeTaskAssistantUpdate(turns, { ...first, sequence: 2, text: " source", replace: false });
  assert.equal(turns[0].text, "First source");
  assert.equal(mergeTaskAssistantUpdate(turns, first), turns);
  turns = mergeTaskAssistantUpdate(turns, { ...first, sequence: 3, text: "Final answer.", done: true });
  assert.equal(turns[0].text, "Final answer.");
  assert.equal(mergeTaskAssistantUpdate(turns, { ...first, sequence: 4 }), turns);
});

test("old reasoning rejection cannot appear as a completed result in the live card", () => {
  const rejection = 'Thinking level "off" is not supported for openai/gpt-6.2-sol. Use one of: minimal, low, medium, high.';
  assert.equal(resolveLiveTaskState({ ...task, subtitle: rejection }, null, []), "Failed");
  assert.equal(buildTaskConversation({ ...task, metadata: { finalResponseText: rejection } }, null, [], []).length, 0);
});

test("a historical live run does not reactivate a terminal task", () => {
  assert.equal(resolveLiveTaskState({ ...task, liveRunCount: 1 }, null, []), "Completed");
  assert.equal(resolveLiveTaskState({ ...task, status: "cancelled", liveRunCount: 1 }, null, []), "Cancelled");
});

test("a disconnected or idle native session does not prove an active task", () => {
  assert.equal(resolveLiveTaskState({ ...task, status: "running", liveRunCount: 1,
    metadata: { nativeSessionActive: false } }, null, []), "Status unknown");
});

test("conversation uses verified files and one copy of the final assistant response", () => {
  const finalText = "The source is verified.";
  const entries = buildTaskConversation({ ...task, metadata: { finalResponseText: finalText } }, null, [
    { id: "final", kind: "assistant", title: "Worker", detail: finalText, timestamp },
    { id: "phantom", kind: "artifact", title: "Created file", detail: "//example.com", filePath: "//example.com", timestamp }
  ], [
    { type: "assistant", runId: "run-a", sequence: 2, timestamp, text: finalText, done: true, replace: true }
  ], [], [
    { id: "file-a", label: "source.csv", timestamp, href: "/api/missions/task-a?artifact=file-a" }
  ]);
  assert.deepEqual(entries.map(({ kind, text }) => [kind, text]), [["assistant", finalText], ["artifact", "source.csv"]]);
});

test("a completed task does not present runtime status copy as an assistant reply", () => {
  const completed = { ...task, metadata: { resultPreview: "Dispatch runner finished · deliverables/example" } };
  assert.deepEqual(buildTaskConversation(completed, null, [], []), []);
});
