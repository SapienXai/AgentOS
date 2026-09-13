import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const matrixPath = path.join(root, "docs/openclaw-ownership-matrix.md");

test("ownership matrix keeps the certified target and architecture guard explicit", async () => {
  const matrix = await readText(matrixPath);
  const audit = await readText(path.join(root, "docs/openclaw-2026.9.4-compatibility-audit.md"));
  const rows = matrix.split("\n").filter((line) => /^\| .* \| [A-E] \|/.test(line));
  const owners = new Set<string>();

  assert.ok(rows.length >= 20, "matrix should remain broad enough to cover the required ownership surface");
  for (const concern of [
    "Worker lifecycle",
    "Retries",
    "Recovery",
    "Delegation",
    "Lineage",
    "Worktrees",
    "Execution environments",
    "Session placement",
    "Memory",
    "Plugins",
    "Updates",
    "Tasks",
    "Sessions",
    "Channels",
    "Auth",
    "Persistence",
    "operator UX"
  ]) {
    assert.match(matrix, new RegExp(escapeRegExp(concern), "i"), `${concern} must be represented`);
  }

  assert.match(matrix, /v2026\.9\.4/);
  assert.match(matrix, /8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e/);
  assert.match(matrix, /3a9d69db306cd7f081e06254cb89c4bcc14a7107/);
  assert.match(matrix, /C94/);
  assert.match(matrix, /MAIN-SIGNAL/);
  assert.match(matrix, /No GitHub issue status was changed/);
  assert.match(audit, /openclaw-ownership-matrix\.md/);

  const taskAssignment = readMatrixRow(matrix, "Task assignment");
  const taskHistory = readMatrixRow(matrix, "Task history");
  assert.doesNotMatch(matrix, /\| Task assignment and richer task history \|/);
  assert.equal(taskAssignment[1], "D");
  assert.match(taskAssignment[2] ?? "", /tasks\.assign/);
  assert.equal(taskAssignment[4], "unsupported");
  assert.equal(taskHistory[1], "B");
  assert.match(taskHistory[2] ?? "", /tasks\.history/);
  assert.match(taskHistory[3] ?? "", /openclaw-2026\.9\.3-to-2026\.9\.4-contract-diff\.json/);
  for (const currentPath of [
    "../lib/openclaw/client/types.ts",
    "../lib/openclaw/client/native-ws-gateway-client.ts",
    "../lib/openclaw/adapter/openclaw-adapter.ts",
    "../lib/openclaw/application/runtime-service.ts",
    "../lib/openclaw/domains/task-history.ts",
    "../lib/openclaw/domains/task-detail.ts",
    "../tests/openclaw-task-history.test.ts"
  ]) {
    assert.match(taskHistory[3] ?? "", new RegExp(escapeRegExp(currentPath)));
  }
  assert.equal(taskHistory[4], "native + fallback + degraded");
  assert.match(taskHistory[5] ?? "", /native history authoritative/i);
  assert.match(audit, /\| `tasks\.history` \| Native additive contract; integrated in the current checkout/);
  assert.doesNotMatch(audit, /\| `tasks\.history`, terminal question URLs, delegated Talk completion \|/);

  for (const row of rows) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    owners.add(cells[1] ?? "");
    assert.match(cells[4] ?? "", /(?:native|fallback|unsupported|degraded)/i, "integration status must be explicit");
    assert.match(row, /\]\([^)]*\)/, "each row must carry evidence or code links");
  }
  assert.deepEqual([...owners].sort(), ["A", "B", "C", "D", "E"]);
});

test("ownership matrix local links resolve without requiring a live Gateway", async () => {
  const matrix = await readText(matrixPath);
  const localLinks = [...matrix.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1].split("#", 1)[0].trim())
    .filter((target) => target && !target.startsWith("http://") && !target.startsWith("https://"));

  for (const target of localLinks) {
    const resolved = path.resolve(path.dirname(matrixPath), target);
    await access(resolved);
  }
});

function readMatrixRow(matrix: string, concern: string) {
  const row = matrix.split("\n").find((line) => line.startsWith(`| ${concern} |`));
  assert.ok(row, `${concern} must have a dedicated matrix row`);
  return row.split("|").slice(1, -1).map((cell) => cell.trim());
}

async function readText(filePath: string) {
  return readFile(filePath, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
