import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const navigationSource = readFileSync("components/settings/settings-navigation.tsx", "utf8");
const pageSource = readFileSync("components/settings/settings-page.tsx", "utf8");
const controlCenterSource = readFileSync("components/mission-control/settings-control-center.tsx", "utf8");
const runtimeSource = readFileSync("components/settings/runtime-settings.tsx", "utf8");
const advancedSource = readFileSync("components/settings/advanced-settings.tsx", "utf8");

test("normal Settings navigation is organized around user intent", () => {
  for (const label of ["General", "AI & Tools", "Workspace", "Runtime", "Advanced"]) {
    assert.match(navigationSource, new RegExp(`label: "${label.replace("&", "\\&")}"`));
  }

  for (const technicalSection of ["Overview", "Capabilities", "Diagnostics", "Agents", "Danger Zone"]) {
    assert.doesNotMatch(navigationSource, new RegExp(`label: "${technicalSection}"`));
  }
});

test("Runtime keeps native OpenClaw access and contextual recovery", () => {
  assert.match(runtimeSource, /Open OpenClaw Control UI/);
  assert.match(runtimeSource, /Gateway needs attention/);
  assert.match(runtimeSource, /onRunRecommendedGatewayAction/);
});

test("Settings surfaces do not override child control sizing", () => {
  assert.doesNotMatch(pageSource, /\[&_a\]:|\[&_button\]:|\[&_input\]:|\[&_select\]:/);
  assert.doesNotMatch(controlCenterSource, /\[&_a\]:|\[&_button\]:|\[&_input\]:|\[&_select\]:/);
});

test("Advanced links preserve engineering and destructive controls", () => {
  for (const label of ["OpenClaw runtime", "Gateway & authentication", "Diagnostics & recovery", "Capabilities & contracts", "Compatibility Lab", "Reset or uninstall"]) {
    assert.match(advancedSource, new RegExp(label.replace(/[&]/g, "\\&")));
  }
  assert.match(advancedSource, /\/updates/);
});
