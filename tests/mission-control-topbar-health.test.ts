import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("topbar and settings use the canonical operator runtime projection", () => {
  const source = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"),
    "utf8"
  );
  const settingsSource = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"),
    "utf8"
  );

  assert.match(source, /presentOperatorRuntime/);
  assert.match(source, /OperatorTruthBadge/);
  assert.match(settingsSource, /presentOperatorRuntime/);
  assert.match(settingsSource, /OperatorTruthBadge/);
});

test("CLI fallback remains an explicit operator authority in the shared presenter", () => {
  const sources = [
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"), "utf8"),
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"), "utf8"),
    readFileSync(join(process.cwd(), "lib/agentos/ui/operator-runtime-projection.ts"), "utf8")
  ];

  assert.match(sources[0], /OperatorTruthBadge/);
  assert.match(sources[1], /OperatorTruthBadge/);
  assert.match(sources[2], /cli-fallback/);
  assert.match(sources[2], /fallback-active/);
});
