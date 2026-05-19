import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  listWorkspaceManagedFilesForPath,
  readWorkspaceManagedFileForPath,
  resolveWorkspaceManagedFileForPath,
  writeWorkspaceManagedFileForPath
} from "@/lib/openclaw/application/workspace-file-service";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("lists official OpenClaw workspace files and discovered safe context files", async () => {
  const workspacePath = await createWorkspaceRoot();
  await mkdir(path.join(workspacePath, "memory"), { recursive: true });
  await mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "reviewer"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw", "agents", "builder", "agent"), { recursive: true });

  await writeFile(path.join(workspacePath, "AGENTS.md"), "# Agents\n");
  await writeFile(path.join(workspacePath, "memory", "2026-05-18.md"), "Daily memory\n");
  await writeFile(path.join(workspacePath, "docs", "brief.md"), "# Brief\n");
  await writeFile(path.join(workspacePath, "skills", "reviewer", "SKILL.md"), "# Skill\n");
  await writeFile(path.join(workspacePath, ".openclaw", "project.json"), JSON.stringify({ name: "Lab" }));
  await writeFile(path.join(workspacePath, ".openclaw", "config.json"), JSON.stringify({ safeLooking: true }));
  await writeFile(path.join(workspacePath, ".openclaw", "token.json"), JSON.stringify({ token: "hidden" }));
  await writeFile(path.join(workspacePath, ".openclaw", "agents", "builder", "agent", "POLICY.md"), "Policy\n");
  await writeFile(path.join(workspacePath, ".openclaw", "agents", "builder", "agent", "config.json"), "{}");

  const files = await listWorkspaceManagedFilesForPath(workspacePath);
  const paths = files.map((file) => file.path);

  assert.ok(paths.includes("AGENTS.md"));
  assert.ok(paths.includes("SOUL.md"));
  assert.ok(paths.includes("USER.md"));
  assert.ok(paths.includes("IDENTITY.md"));
  assert.ok(paths.includes("TOOLS.md"));
  assert.ok(paths.includes("HEARTBEAT.md"));
  assert.ok(paths.includes("BOOT.md"));
  assert.ok(paths.includes("BOOTSTRAP.md"));
  assert.ok(paths.includes("MEMORY.md"));
  assert.ok(paths.includes("memory/2026-05-18.md"));
  assert.ok(paths.includes("docs/brief.md"));
  assert.ok(paths.includes("skills/reviewer/SKILL.md"));
  assert.ok(paths.includes(".openclaw/project.json"));
  assert.ok(paths.includes(".openclaw/agents/builder/agent/POLICY.md"));
  assert.equal(paths.includes(".openclaw/config.json"), false);
  assert.equal(paths.includes(".openclaw/token.json"), false);
  assert.equal(paths.includes(".openclaw/agents/builder/agent/config.json"), false);

  assert.equal(files.find((file) => file.path === "USER.md")?.exists, false);
  assert.equal(files.find((file) => file.path === "USER.md")?.createable, true);
  assert.equal(files.find((file) => file.path === ".openclaw/project.json")?.category, "project-config");
  assert.equal(files.find((file) => file.path === ".openclaw/agents/builder/agent/POLICY.md")?.category, "agent-policy-config");
});

test("reads and writes safe workspace files while blocking traversal and invalid JSON", async () => {
  const workspacePath = await createWorkspaceRoot();
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await writeFile(path.join(workspacePath, ".openclaw", "project.json"), JSON.stringify({ name: "Before" }));

  const project = await readWorkspaceManagedFileForPath(workspacePath, ".openclaw/project.json");
  assert.match(project.content, /Before/);

  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, ".openclaw/project.json", "{broken"),
    /Invalid JSON/
  );
  await assert.rejects(
    () => readWorkspaceManagedFileForPath(workspacePath, "../outside.md"),
    /outside the workspace/
  );
  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, "/tmp/outside.md", "nope"),
    /path is invalid/
  );
  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, ".openclaw/secrets.json", "{}"),
    /allowlist/
  );

  await writeWorkspaceManagedFileForPath(workspacePath, ".openclaw/project.json", JSON.stringify({ name: "After" }));
  assert.equal(JSON.parse(await readFile(path.join(workspacePath, ".openclaw", "project.json"), "utf8")).name, "After");

  await writeWorkspaceManagedFileForPath(workspacePath, "USER.md", "User profile\n");
  assert.equal(await readFile(path.join(workspacePath, "USER.md"), "utf8"), "User profile\n");
});

test("does not expose symlinked files that resolve outside the workspace", async () => {
  const workspacePath = await createWorkspaceRoot();
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-workspace-files-outside-"));
  tempRoots.push(outsideRoot);
  const outsideFile = path.join(outsideRoot, "brief.md");
  await writeFile(outsideFile, "outside\n");
  await mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await symlink(outsideFile, path.join(workspacePath, "docs", "brief.md"));

  const files = await listWorkspaceManagedFilesForPath(workspacePath);
  assert.equal(files.some((file) => file.path === "docs/brief.md"), false);

  const resolved = await resolveWorkspaceManagedFileForPath(workspacePath, "docs/brief.md");
  assert.equal(resolved.file.editable, false);
  assert.match(resolved.file.reason ?? "", /Symlinks/);

  await assert.rejects(
    () => readWorkspaceManagedFileForPath(workspacePath, "docs/brief.md"),
    /Symlinks/
  );
});

async function createWorkspaceRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-workspace-files-"));
  tempRoots.push(tempRoot);
  const workspacePath = path.join(tempRoot, "workspace");
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}
