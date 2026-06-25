import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTaskHealthSummary } from "@/lib/openclaw/domains/task-health";

test("task health treats clean audit and historical failures as non-current issues", () => {
  const health = buildTaskHealthSummary({
    generatedAt: "2026-06-25T10:00:00.000Z",
    status: {
      tasks: {
        total: 4,
        active: 0,
        byStatus: {
          failed: 2,
          timed_out: 1,
          succeeded: 1
        },
        byRuntime: {
          cron: 4
        }
      },
      taskAudit: {
        total: 0,
        warnings: 0,
        errors: 0,
        byCode: {}
      }
    },
    taskList: {
      tasks: [
        {
          taskId: "task-1",
          runtime: "cron",
          sourceId: "cron:agent-1",
          ownerKey: "agent:workspace:cron",
          childSessionKey: "session-child-1",
          agentId: "agent-1",
          runId: "run-1",
          status: "failed",
          endedAt: "2026-06-25T09:30:00.000Z",
          error: "cron failed",
          progressSummary: "Heartbeat failed"
        },
        {
          taskId: "task-2",
          runtime: "cron",
          sourceId: "cron:agent-1",
          ownerKey: "agent:workspace:cron",
          childSessionKey: "session-child-2",
          agentId: "agent-1",
          runId: "run-2",
          status: "timed_out",
          endedAt: "2026-06-25T09:40:00.000Z",
          error: "cron timed out"
        },
        {
          taskId: "task-3",
          runtime: "cron",
          sourceId: "cron:agent-1",
          ownerKey: "agent:workspace:cron",
          agentId: "agent-1",
          runId: "run-3",
          status: "succeeded",
          endedAt: "2026-06-25T09:50:00.000Z"
        }
      ]
    },
    agents: [
      {
        id: "agent-1",
        name: "Digital Emir"
      } as never
    ]
  });

  assert.equal(health.active.active, 0);
  assert.equal(health.active.queued, 0);
  assert.equal(health.active.running, 0);
  assert.equal(health.audit.state, "clean");
  assert.equal(health.currentIssue.count, 0);
  assert.equal(health.currentIssue.severity, "healthy");
  assert.equal(health.historical.issueCount, 3);
  assert.equal(health.explanation, "Current runtime healthy, but past task failures were recorded.");
  assert.equal(health.groups.length, 1);
  assert.equal(health.groups[0]?.agentName, "Digital Emir");
  assert.deepEqual(health.groups[0]?.statusCounts, {
    failed: 1,
    succeeded: 1,
    timed_out: 1
  });
});

test("task health marks audit findings as current issues", () => {
  const health = buildTaskHealthSummary({
    status: {
      tasks: {
        total: 0,
        active: 0,
        byStatus: {}
      },
      taskAudit: {
        total: 2,
        warnings: 1,
        errors: 1,
        byCode: {
          stale_running: 1,
          lost: 1
        }
      }
    },
    taskList: {
      tasks: []
    }
  });

  assert.equal(health.audit.state, "findings");
  assert.equal(health.currentIssue.count, 2);
  assert.equal(health.currentIssue.severity, "critical");
  assert.deepEqual(health.currentIssue.reasons, [
    "1 task audit error",
    "1 task audit warning"
  ]);
});
