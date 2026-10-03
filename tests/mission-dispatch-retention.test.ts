import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createMissionDispatchRecord,
  readMissionDispatchRecords,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";

test("terminal dispatch identity is retained while verbose logs prune separately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-dispatch-retention-"));
  const previousRoot = process.env.AGENTOS_MISSION_CONTROL_ROOT;
  process.env.AGENTOS_MISSION_CONTROL_ROOT = root;

  try {
    const recent = createMissionDispatchRecord(buildPayload("request-recent"));
    const recentUpdatedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    await writeMissionDispatchRecord({
      ...recent,
      status: "completed",
      updatedAt: recentUpdatedAt,
      runner: { ...recent.runner, finishedAt: recentUpdatedAt }
    });
    await mkdir(path.dirname(recent.runner.logPath!), { recursive: true });
    await writeFile(recent.runner.logPath!, "recent terminal log\n", "utf8");

    const retained = await readMissionDispatchRecords();
    assert.ok(retained.some((record) => record.id === recent.id));
    await assert.doesNotReject(() => access(recent.runner.logPath!));

    const old = createMissionDispatchRecord(buildPayload("request-old"));
    const oldUpdatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await writeMissionDispatchRecord({
      ...old,
      status: "completed",
      updatedAt: oldUpdatedAt,
      runner: { ...old.runner, finishedAt: oldUpdatedAt }
    });
    await writeFile(old.runner.logPath!, "old terminal log\n", "utf8");

    const afterLogPrune = await readMissionDispatchRecords();
    assert.ok(afterLogPrune.some((record) => record.id === old.id));
    await assert.rejects(() => access(old.runner.logPath!));
  } finally {
    if (previousRoot === undefined) delete process.env.AGENTOS_MISSION_CONTROL_ROOT;
    else process.env.AGENTOS_MISSION_CONTROL_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

function buildPayload(clientRequestId: string) {
  return {
    clientRequestId,
    agentId: "agent-1",
    mission: "Keep the task identity",
    routedMission: "Keep the task identity",
    thinking: "medium" as const,
    requestedModelId: null,
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    outputDir: null,
    outputDirRelative: null,
    notesDirRelative: null
  };
}
