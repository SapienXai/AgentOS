import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("operations jobs expose expandable runtime facts from the normalized projection", async () => {
  const source = await readFile("components/operations/operations/operations-jobs-page-content.tsx", "utf8");

  assert.match(source, /function OperationJobRow/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /label="Owner"/);
  assert.match(source, /label="Workspace"/);
  assert.match(source, /label="Runs"/);
  assert.match(source, /label="Token usage"/);
  assert.match(source, /label="Next run"/);
  assert.match(source, /label="Current state"/);
  assert.match(source, /run\.tokens/);
  assert.match(source, /job\.capabilities\.runHistory/);
  assert.match(source, /job\.status === "scheduled" \? scheduledJobBadgeClassName\(surfaceTheme\)/);
  assert.match(source, /border-blue-300\/70 bg-blue-50 text-blue-700/);
  assert.match(source, /border-blue-300\/25 bg-blue-300\/10 text-blue-100/);
});

test("operations job controls stay capability-aware and use real API actions", async () => {
  const source = await readFile("components/operations/operations/operations-jobs-page-content.tsx", "utf8");
  const service = await readFile("lib/agentos/application/operations-service.ts", "utf8");

  assert.match(source, /fetch\("\/api\/operations"/);
  assert.match(source, /job\.capabilities\.mutable/);
  assert.match(source, /onAction\("run", job\)/);
  assert.match(source, /<Zap className="h-3\.5 w-3\.5"/);
  assert.match(source, /Run once now/);
  assert.match(source, /function JobActionTooltip/);
  assert.match(source, /<TooltipProvider delayDuration=\{140\}>/);
  assert.match(source, /This job already has an active OpenClaw run/);
  assert.match(source, /Permanently remove this job from OpenClaw after confirmation/);
  assert.match(source, /job\.enabled \? "pause" : "resume"/);
  assert.match(source, /perform\("delete", job\)/);
  assert.match(source, /Delete operation\?/);
  assert.match(service, /\["cron\.remove", \{ id: jobId \}\]/);
  assert.match(service, /\["cron\.run", \{ id: jobId, mode: "force" \}\]/);
  assert.match(service, /\["cron\.update", \{ id: jobId, patch: \{ enabled: action === "resume" \} \}\]/);
  assert.match(source, /run cancellation is unsupported/);
});
