import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("topbar keeps the Gateway online while event delivery uses polling", () => {
  const source = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"),
    "utf8"
  );
  const pollingBranch = source.match(
    /if \(diagnostics\.eventBridge\?\.mode === "polling"\) \{[\s\S]*?\n\s*\}/
  )?.[0];

  assert.ok(pollingBranch);
  assert.match(pollingBranch, /return "Online"/);
  assert.doesNotMatch(pollingBranch, /return "Polling"/);
});
