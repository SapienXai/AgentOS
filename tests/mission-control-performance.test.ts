import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mergeSurfaceModulePositions } from "@/components/mission-control/canvas.motion";
import type { CanvasNode } from "@/components/mission-control/canvas-types";

test("initial pages render before a slow OpenClaw snapshot blocks navigation", async () => {
  const source = await readFile("lib/agentos/initial-snapshot.ts", "utf8");
  const timeout = source.match(/INITIAL_SNAPSHOT_TIMEOUT_MS\s*=\s*([\d_]+)/)?.[1];

  assert.ok(timeout);
  assert.ok(Number(timeout.replaceAll("_", "")) <= 1_000);
});

test("runtime stream uses event-first status updates with bounded reconciliation", async () => {
  const source = await readFile("app/api/stream/route.ts", "utf8");

  assert.match(source, /STREAM_SYSTEM_STATUS_INTERVAL_MS\s*=\s*10_000/);
  assert.match(source, /subscribeOpenClawEventBridgeEvents\(\(\) => \{[\s\S]*?sendSystemStatus/);
  assert.match(source, /setInterval\(\(\) => \{[\s\S]*?STREAM_SYSTEM_STATUS_INTERVAL_MS/);
});

test("normal snapshot refresh is bounded while force refresh remains blocking", async () => {
  const [routeSource, dataHookSource] = await Promise.all([
    readFile("app/api/snapshot/route.ts", "utf8"),
    readFile("hooks/use-mission-control-data.ts", "utf8"),
  ]);

  assert.match(routeSource, /force[\s\S]*?getMissionControlSnapshot\(\{ force: true \}\)/);
  assert.match(routeSource, /getBoundedControlPlaneSnapshot\(\)/);
  assert.match(routeSource, /X-AgentOS-Snapshot-Pending/);
  assert.match(dataHookSource, /X-AgentOS-Snapshot-Pending/);
  assert.match(dataHookSource, /if \(!snapshotPending\)/);
  assert.match(dataHookSource, /else \{[\s\S]*?setConnectionState\("connecting"\)/);
});

test("surface spring animation sleeps after nodes settle", async () => {
  const source = await readFile("components/mission-control/canvas.tsx", "utf8");

  assert.match(source, /if \(shouldContinue\) \{[\s\S]*?requestAnimationFrame/);
  assert.match(source, /surfaceAnimationFrameRef\.current = null/);
  assert.doesNotMatch(source, /frameId = window\.requestAnimationFrame\(tick\)/);
});

test("surface animation never overwrites live agent drag positions", () => {
  const agentNode = {
    id: "agent:dragging",
    type: "agent",
    position: { x: 420, y: 240 },
    dragging: true,
    data: {},
  } as unknown as CanvasNode;
  const surfaceNode = {
    id: "surface:following",
    type: "surface-module",
    position: { x: 100, y: 100 },
    data: {},
  } as unknown as CanvasNode;

  const merged = mergeSurfaceModulePositions(
    [agentNode, surfaceNode],
    new Map([[surfaceNode.id, { x: 130, y: 140 }]]),
  );

  assert.equal(merged[0], agentNode);
  assert.deepEqual(merged[0]?.position, { x: 420, y: 240 });
  assert.deepEqual(merged[1]?.position, { x: 130, y: 140 });
});
