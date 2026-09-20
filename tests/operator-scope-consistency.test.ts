import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

test("OperationsShell resolves persisted workspace selection before paint", () => {
  const source = readFileSync(path.join(process.cwd(), "components/operations/operations-shell.tsx"), "utf8");

  assert.match(source, /const useIsomorphicLayoutEffect =/);
  assert.match(source, /useIsomorphicLayoutEffect\(\(\) => \{\n    const workspaceRoot = snapshot\.diagnostics\.workspaceRoot/);
  assert.match(source, /buildWorkspaceSelectionStorageKey\(workspaceRoot\)/);
  assert.match(source, /resolveWorkspaceSelection\(/);
  assert.doesNotMatch(source, /queueMicrotask\(/);
});

test("Runtime Inbox empty state does not claim platform health", () => {
  const source = readFileSync(path.join(process.cwd(), "components/runtime/runtime-inbox.tsx"), "utf8");

  assert.match(source, /No actionable runtime issues/);
  assert.doesNotMatch(source, /No runtime issues\. AgentOS and OpenClaw look healthy/);
});
