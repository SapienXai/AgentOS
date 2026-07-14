import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getNodePositionsStorageKey,
  parseWorkspaceTaskCardFilters,
  workspaceTaskCardFiltersStorageKey
} from "@/components/mission-control/canvas.persistence";

test("workspace task filters retain valid per-workspace selections", () => {
  assert.deepEqual(
    parseWorkspaceTaskCardFilters(JSON.stringify({
      "workspace-a": "active",
      "workspace-b": "hidden",
      "workspace-c": "all",
      invalid: "running"
    })),
    {
      "workspace-a": "active",
      "workspace-b": "hidden",
      "workspace-c": "all"
    }
  );
  assert.deepEqual(parseWorkspaceTaskCardFilters("not-json"), {});
  assert.match(workspaceTaskCardFiltersStorageKey, /^mission-control-/);
  assert.match(getNodePositionsStorageKey("all"), /node-positions:v4:all$/);
});

test("Mission Canvas hydrates and persists the workspace run filter", async () => {
  const source = await readFile("components/mission-control/canvas.tsx", "utf8");
  const shell = await readFile("components/mission-control/mission-control-shell.tsx", "utf8");

  assert.match(source, /readWorkspaceTaskCardFilters\(\)/);
  assert.match(source, /writeWorkspaceTaskCardFilters\(workspaceTaskCardFilters\)/);
  assert.match(shell, /workspaceTaskCardFiltersStorageKey/);
});
