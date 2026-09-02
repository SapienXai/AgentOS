import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  AGENTOS_UI_STATE_DEFINITIONS,
  type AgentOsUiState
} from "@/components/ui/design-system";

const root = process.cwd();

async function readProjectFile(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("AgentOS UI governance requires design-system-first work", async () => {
  const [agents, skill] = await Promise.all([
    readProjectFile("AGENTS.md"),
    readProjectFile("skills/agentos-ui-ux/SKILL.md")
  ]);

  assert.match(agents, /skills\/agentos-ui-ux\/SKILL\.md/);
  assert.match(agents, /existing product surface.*semantic tokens before creating a new UI pattern/);
  assert.match(agents, /does not justify a new visual language/);
  assert.match(agents, /current scope, state, next action, failure detail, and recovery path visible/);
  assert.match(agents, /mobile behavior, safe areas, keyboard access/);

  for (const heading of [
    "## Design-System-First Decision Gate",
    "## UI Architecture Layers",
    "## Canonical Dialog Architecture",
    "## Semantic Design Tokens",
    "## UI State Vocabulary",
    "## Interaction Architecture",
    "## Responsive Architecture",
    "## Accessibility Architecture",
    "## AgentOS UI Decision"
  ]) {
    assert.match(skill, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(skill, /Never design a new visual system directly from a feature requirement/);
  assert.match(skill, /A new feature does not justify a new visual language/);
  assert.match(skill, /context-engine-dialog\.tsx.*intentional multi-pane exception/);
});

test("the shared UI state vocabulary preserves operator meaning", () => {
  const expectedStates: AgentOsUiState[] = [
    "active",
    "idle",
    "pending",
    "running",
    "success",
    "degraded",
    "blocked",
    "unsupported",
    "unknown",
    "failed",
    "recovering",
    "disabled"
  ];

  assert.deepEqual(Object.keys(AGENTOS_UI_STATE_DEFINITIONS).sort(), [...expectedStates].sort());
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.success.tone, "success");
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.degraded.tone, "warning");
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.degraded.actionRequired, true);
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.failed.recoveryAvailable, true);
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.unsupported.informational, false);
  assert.equal(AGENTOS_UI_STATE_DEFINITIONS.unknown.informational, false);
});

test("semantic tokens and accent ownership are explicit", async () => {
  const [globals, skill] = await Promise.all([
    readProjectFile("app/globals.css"),
    readProjectFile("skills/agentos-ui-ux/SKILL.md")
  ]);

  for (const token of [
    "--agentos-surface-base",
    "--agentos-surface-panel",
    "--agentos-surface-inset",
    "--agentos-surface-strong",
    "--agentos-border-default",
    "--agentos-border-subtle",
    "--agentos-text-default",
    "--agentos-text-muted",
    "--agentos-brand-primary",
    "--agentos-operational-accent",
    "--agentos-focus",
    "--agentos-status-success",
    "--agentos-status-warning",
    "--agentos-status-danger",
    "--mission-surface",
    "--mission-panel",
    "--mission-inset",
    "--mission-accent"
  ]) {
    assert.match(globals, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(skill, /Brand primary.*rose\/pink/);
  assert.match(skill, /Operational accent.*violet/);
  assert.match(skill, /Semantic status.*green.*success.*amber.*warning.*red.*failure/);
  assert.match(skill, /Do not use status colors as decoration/);
});

test("the canonical dialog shell protects responsive and scroll contracts", async () => {
  const [dialog, skill] = await Promise.all([
    readProjectFile("components/mission-control/mission-control-dialog-shell.tsx"),
    readProjectFile("skills/agentos-ui-ux/SKILL.md")
  ]);

  assert.match(dialog, /h-dvh max-h-dvh w-screen max-w-none/);
  assert.match(dialog, /sm:h-\[min\(calc\(100dvh-72px\),760px\)\]/);
  assert.match(dialog, /safe-area-inset-top/);
  assert.match(dialog, /safe-area-inset-right/);
  assert.match(dialog, /safe-area-inset-bottom/);
  assert.match(dialog, /grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(dialog, /min-h-0 overflow-y-auto/);
  assert.match(dialog, /<DialogHeader/);
  assert.match(dialog, /<DialogFooter/);

  assert.match(skill, /`MissionControlDialogShell` is the primary reusable dialog reference/);
  assert.match(skill, /`ContextEngineDialog` remains a reference implementation[\s\S]*deliberate exception/);
  assert.match(skill, /one deliberate scroll owner/);
});

test("repeated status surface mappings use the shared visual helper", async () => {
  const source = await readProjectFile("components/mission-control/surface-visual-tones.ts");

  assert.match(source, /AgentOsSurfaceTheme/);
  assert.match(source, /resolveSurfaceStatusBadgeClasses/);
  assert.match(source, /return resolveSurfaceStatusBadgeClasses\(/);
  assert.doesNotMatch(source, /case "healthy":\s+return surfaceTheme === "light"/);
});
