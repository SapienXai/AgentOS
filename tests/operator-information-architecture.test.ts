import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isNavigationItemActive, navigationItems } from "@/components/mission-control/navigation-config";

test("workforce navigation starts at the canvas and keeps settings secondary", () => {
  assert.deepEqual(navigationItems.filter(item => item.section === "operate").map(item => item.label), [
    "Mission Control", "Chat", "Team", "Tasks", "Knowledge", "Integrations"
  ]);
  assert.deepEqual(navigationItems.filter(item => item.section === "system").map(item => item.label), ["Settings"]);
  assert.deepEqual(navigationItems.flatMap(item => item.mobileLabel ?? []), ["Canvas", "Chat", "Team", "Tasks"]);
  assert.equal(navigationItems[0]?.href, "/");
});

test("canonical and legacy routes map to the same workforce destinations", () => {
  const cases = [
    ["/", "mission-control"], ["/mission-control", "mission-control"], ["/dashboard", "mission-control"],
    ["/chat", "chat"], ["/team", "agents"], ["/agents", "agents"], ["/agents/sam", "agents"],
    ["/missions", "missions"], ["/missions/example", "missions"], ["/human-control", "missions"], ["/tasks", "missions"],
    ["/knowledge", "files"], ["/files", "files"], ["/integrations", "integrations"],
    ["/channels", "integrations"], ["/accounts/browser-live", "integrations"],
    ["/settings", "settings"], ["/models", "settings"], ["/updates", "settings"], ["/operations", "settings"]
  ];
  for (const [route, id] of cases) {
    assert.deepEqual(navigationItems.filter(item => isNavigationItemActive(item, route)).map(item => item.id), [id]);
  }
  for (const item of navigationItems) {
    for (const route of [item.href, ...(item.aliases ?? [])]) {
      assert.ok(existsSync(path.join(process.cwd(), "app", route, "page.tsx")), route);
    }
  }
  assert.ok(navigationItems.every(item => !isNavigationItemActive(item, "/unknown")));
});
