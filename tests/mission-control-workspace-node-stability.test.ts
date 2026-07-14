import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mergeNodePositions } from "@/components/mission-control/canvas.layout";
import type { CanvasNode } from "@/components/mission-control/canvas-types";

test("workspace surface remains stable while live canvas data refreshes", async () => {
  const [workspaceNode, globalStyles] = await Promise.all([
    readFile("components/mission-control/nodes/workspace-node.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.doesNotMatch(workspaceNode, /motion\.div/);
  assert.doesNotMatch(workspaceNode, /whileHover/);
  assert.doesNotMatch(workspaceNode, /backdrop-blur-xl/);
  assert.match(globalStyles, /\.workspace-node\s*\{[\s\S]*?cursor:\s*default;/);
  assert.match(
    globalStyles,
    /\.mission-shell \.react-flow__node-workspace,[\s\S]*?cursor:\s*default;/,
  );
  assert.match(
    globalStyles,
    /\.workspace-node__workspace-action\s*\{[\s\S]*?cursor:\s*pointer;/,
  );
});

test("workspace measurement remains stable across graph refreshes", () => {
  const previousWorkspace = {
    id: "workspace:stable",
    type: "workspace",
    position: { x: 44, y: 42 },
    width: 1200,
    height: 900,
    measured: { width: 1200, height: 900 },
    selected: true,
    data: {},
  } as unknown as CanvasNode;
  const refreshedWorkspace = {
    id: "workspace:stable",
    type: "workspace",
    position: { x: 44, y: 42 },
    style: { width: 1200, height: 900 },
    selected: false,
    data: {},
  } as unknown as CanvasNode;

  const [mergedWorkspace] = mergeNodePositions([previousWorkspace], [refreshedWorkspace]);

  assert.equal(mergedWorkspace.width, 1200);
  assert.equal(mergedWorkspace.height, 900);
  assert.deepEqual(mergedWorkspace.measured, { width: 1200, height: 900 });
  assert.equal(mergedWorkspace.selected, true);
});
