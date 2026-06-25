import assert from "node:assert/strict";
import { test } from "node:test";

import { runTaskHealthAudit } from "@/lib/openclaw/application/task-health-service";

type RunOpenClawJson = typeof import("@/lib/openclaw/cli").runOpenClawJson;

test("task health audit normalizes CLI payload into a safe summary", async () => {
  const calls: Array<{ args: string[]; options: { timeoutMs?: number } }> = [];

  const result = await runTaskHealthAudit(
    { timeoutMs: 12_000 },
    {
      runOpenClawJson: (async <T>(args: string[], options: { timeoutMs?: number } = {}) => {
        calls.push({ args, options });
        return {
          taskAudit: {
            total: "3",
            warnings: 1,
            errors: "2",
            byCode: {
              stale_running: "2",
              missing_session: 1
            },
            state: "findings",
            explanation: "Audit found issues."
          }
        } as T;
      }) as RunOpenClawJson
    }
  );

  assert.deepEqual(calls, [
    {
      args: ["tasks", "audit", "--json"],
      options: {
        timeoutMs: 12_000
      }
    }
  ]);
  assert.equal(result.command, "openclaw tasks audit --json");
  assert.equal(result.transport, "cli-fallback");
  assert.match(result.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.audit.state, "findings");
  assert.equal(result.audit.total, 3);
  assert.equal(result.audit.warnings, 1);
  assert.equal(result.audit.errors, 2);
  assert.deepEqual(result.audit.byCode, {
    stale_running: 2,
    missing_session: 1
  });
  assert.equal(result.audit.explanation, "Audit found issues.");
});

test("task health audit falls back to an unknown summary for unstructured payloads", async () => {
  const result = await runTaskHealthAudit(
    {},
    {
      runOpenClawJson: (async <T>() => "unexpected" as T) as RunOpenClawJson
    }
  );

  assert.equal(result.audit.state, "unknown");
  assert.equal(result.audit.total, 0);
  assert.equal(result.audit.warnings, 0);
  assert.equal(result.audit.errors, 0);
  assert.equal(result.audit.explanation, "Task audit returned an unstructured payload.");
});
