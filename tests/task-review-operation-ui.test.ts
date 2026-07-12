import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("needs-review task badge opens the review workflow", async () => {
  const source = await readFile("components/mission-control/nodes/task-node.tsx", "utf8");

  assert.match(source, /aria-label=\{`\$\{hasReviewResolution \? "Open review record" : "Review task result"\}/);
  assert.match(source, /data\.onReviewTask\?\.\(displayTask\)/);
  assert.match(source, /badgeLabel === "needs review"/);
});

test("scheduled task review uses real OpenClaw operation actions", async () => {
  const dialog = await readFile("components/mission-control/task-review-dialog.tsx", "utf8");
  const shell = await readFile("components/mission-control/mission-control-shell.tsx", "utf8");

  assert.match(dialog, /fetch\("\/api\/operations"/);
  assert.match(dialog, /"Retry failed run"/);
  assert.match(dialog, /"Resume schedule" : "Pause schedule"/);
  assert.match(dialog, /"Run now"/);
  assert.match(dialog, /This review belongs to one scheduled run/);
  assert.match(dialog, /max-w-\[680px\]/);
  assert.match(dialog, /What needs review/);
  assert.match(dialog, /Last captured output/);
  assert.match(dialog, /Expected outcome/);
  assert.match(shell, /onOperationComplete=\{async \(\) => \{[\s\S]*await refreshSnapshot\(\{ force: true \}\)/);
});
