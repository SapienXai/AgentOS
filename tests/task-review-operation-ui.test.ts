import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("needs-review task badge opens the review workflow", async () => {
  const source = await readFile("components/mission-control/nodes/task-node.tsx", "utf8");

  assert.match(source, /aria-label=\{`\$\{hasReviewResolution \? "Open review record" : "Review task result"\}/);
  assert.match(source, /data\.onReviewTask\?\.\(displayTask\)/);
  assert.match(source, /badgeLabel === "needs review"/);
});

test("task cards show observed run and reported token metrics", async () => {
  const source = await readFile("components/mission-control/nodes/task-node.tsx", "utf8");

  assert.match(source, /operationRunCount/);
  assert.match(source, /taskTokenCount/);
  assert.match(source, /OpenClaw run/);
  assert.match(source, /tokens reported by OpenClaw/);
  assert.match(source, /Tokens not reported/);
});

test("scheduled task review uses real OpenClaw operation actions", async () => {
  const dialog = await readFile("components/mission-control/task-review-dialog.tsx", "utf8");
  const shell = await readFile("components/mission-control/mission-control-shell.tsx", "utf8");

  assert.match(dialog, /fetch\("\/api\/operations"/);
  assert.match(dialog, /"Retry failed run"/);
  assert.match(dialog, /"Resume schedule" : "Pause schedule"/);
  assert.match(dialog, /"Run now"/);
  assert.match(dialog, /The latest scheduled result needs an operator decision/);
  assert.match(dialog, /max-w-\[680px\]/);
  assert.match(dialog, /What needs review/);
  assert.match(dialog, /Last captured output/);
  assert.match(dialog, /Expected outcome/);
  assert.match(shell, /onOperationComplete=\{async \(\) => \{[\s\S]*await refreshSnapshot\(\{ force: true \}\)/);
});

test("task review defaults to a compact operator decision view", async () => {
  const dialog = await readFile("components/mission-control/task-review-dialog.tsx", "utf8");

  assert.match(dialog, /max-w-\[620px\]/);
  assert.match(dialog, />What happened</);
  assert.match(dialog, />Last activity</);
  assert.match(dialog, />Recommended action</);
  assert.match(dialog, /Technical details/);
  assert.match(dialog, /"Continue safely"/);
  assert.match(dialog, /"Acknowledge"/);
  assert.doesNotMatch(dialog, /function ReviewMetric/);
  assert.doesNotMatch(dialog, /function ReviewLine/);
});
