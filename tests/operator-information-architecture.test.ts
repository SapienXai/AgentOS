import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  collapsedNavigationItems,
  isNavigationItemActive,
  navigationItems,
  navigationSections
} from "@/components/mission-control/navigation-config";

const rootDir = process.cwd();

test("operator navigation follows the job-based hierarchy", () => {
  assert.deepEqual(navigationSections.map((section) => section.label), ["Operate", "Connect", "System"]);
  assert.deepEqual(
    navigationItems.map((item) => item.label),
    [
      "Home",
      "Mission Control",
      "Agents",
      "Missions",
      "Human Control",
      "Channels",
      "Accounts",
      "Models",
      "Integrations",
      "Files",
      "Operations",
      "Updates",
      "Settings"
    ]
  );
  assert.equal(navigationItems.find((item) => item.label === "Home")?.href, "/dashboard");
  assert.equal(navigationItems.find((item) => item.label === "Mission Control")?.href, "/");
  assert.equal(navigationItems.find((item) => item.label === "Operations")?.section, "system");
  assert.equal(navigationItems.some((item) => item.href === "/tasks"), false);
  assert.deepEqual(collapsedNavigationItems.map((item) => item.label), [
    "Home",
    "Mission Control",
    "Agents",
    "Missions",
    "Human Control",
    "Channels",
    "Accounts",
    "Updates",
    "Settings"
  ]);
});

test("navigation keeps canonical and compatibility routes reachable", () => {
  const routeFiles = [
    "app/page.tsx",
    "app/mission-control/page.tsx",
    "app/dashboard/page.tsx",
    "app/agents/page.tsx",
    "app/missions/page.tsx",
    "app/human-control/page.tsx",
    "app/files/page.tsx",
    "app/accounts/page.tsx",
    "app/models/page.tsx",
    "app/channels/page.tsx",
    "app/integrations/page.tsx",
    "app/updates/page.tsx",
    "app/settings/page.tsx",
    "app/operations/page.tsx",
    "app/tasks/page.tsx"
  ];

  assert.ok(routeFiles.every((file) => existsSync(path.join(rootDir, file))));
  const missionControl = navigationItems.find((item) => item.label === "Mission Control");
  const home = navigationItems.find((item) => item.label === "Home");
  assert.ok(missionControl && home);
  assert.equal(isNavigationItemActive(missionControl, "/", ""), true);
  assert.equal(isNavigationItemActive(missionControl, "/mission-control", ""), true);
  assert.equal(isNavigationItemActive(home, "/dashboard", ""), true);
  assert.equal(isNavigationItemActive(home, "/", ""), false);
});

test("Home is an operator surface instead of a second technical inventory", () => {
  const source = readFileSync(path.join(rootDir, "components/operations/dashboard/dashboard-page-content.tsx"), "utf8");

  assert.match(source, /presentOperatorRuntime\(rootSnapshot, \{ connectionState \}\)/);
  assert.doesNotMatch(source, /presentOperatorRuntime\(rootSnapshot,[\s\S]*?scope:\s*\{[\s\S]*?workspaceId/);
  assert.match(source, /Workspace view/);
  assert.match(source, /title="Active workforce"/);
  assert.match(source, /title="Active work"/);
  assert.match(source, /Needs your attention/);
  assert.match(source, /No active work/);
  assert.match(source, /No agents in this workspace/);
  assert.match(source, /Search agents and tasks/);
  assert.match(source, /primaryRecovery/);
  assert.doesNotMatch(source, /title="OpenClaw Runtime"/);
  assert.doesNotMatch(source, /title="Accounts & Integrations"/);
  assert.doesNotMatch(source, /title="Models"/);
  assert.doesNotMatch(source, /<RuntimeIssuesCard/);
  assert.doesNotMatch(source, /<TaskHealthCard/);
});
