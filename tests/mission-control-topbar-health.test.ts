import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("topbar shares degraded Gateway and polling-fallback labels with the settings menu", () => {
  const source = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"),
    "utf8"
  );
  const utilitySource = readFileSync(
    join(process.cwd(), "components/mission-control/settings-control-center.utils.ts"),
    "utf8"
  );

  assert.match(source, /formatGatewayHealthLabel\(snapshot\)/);
  assert.match(utilitySource, /gatewayMode === "fallback-active"/);
  assert.match(utilitySource, /return "Degraded"/);
  assert.match(utilitySource, /eventBridge\?\.mode === "polling"/);
  assert.match(utilitySource, /return "Polling fallback"/);
});

test("CLI fallback status indicators stay stateless across Mission Control refreshes", () => {
  const sources = [
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"), "utf8"),
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"), "utf8")
  ];

  for (const source of sources) {
    assert.match(source, /title="CLI fallback active"/);
    assert.doesNotMatch(source, /CliFallbackInfoTooltip|TooltipProvider delayDuration=\{120\}/);
  }
});
