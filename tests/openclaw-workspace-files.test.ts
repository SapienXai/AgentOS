import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  listWorkspaceManagedFiles,
  listWorkspaceManagedFilesForPath,
  listWorkspaceDeliverablePaths,
  inspectWorkspaceDeliverable,
  readWorkspaceDeliverable,
  readWorkspaceManagedFile,
  writeWorkspaceManagedFile,
  readWorkspaceManagedFileForPath,
  resolveWorkspaceManagedFileForPath,
  writeWorkspaceManagedFileForPath,
  WorkspaceFileConflictError
} from "@/lib/openclaw/application/workspace-file-service";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("workspace deliverables are confined to regular files with bounded source discovery", async () => {
  const workspace = await createWorkspaceRoot();
  const external = await createWorkspaceRoot();
  await mkdir(path.join(workspace, "deliverables", "run"), { recursive: true });
  await writeFile(path.join(workspace, "deliverables", "run", "report.csv"), "total\n12\n");
  await writeFile(path.join(external, "private.csv"), "private");
  await symlink(path.join(external, "private.csv"), path.join(workspace, "deliverables", "run", "linked.csv"));
  await symlink(external, path.join(workspace, "deliverables", "run", "elsewhere"), "dir");
  await link(path.join(external, "private.csv"), path.join(workspace, "deliverables", "run", "hardlinked.csv"));
  const relative = "deliverables/run/report.csv";
  assert.ok((await listWorkspaceDeliverablePaths(workspace, "deliverables/run")).includes(relative));
  assert.equal(await inspectWorkspaceDeliverable(workspace, relative), 9);
  assert.equal(new TextDecoder().decode(await readWorkspaceDeliverable(workspace, relative) ?? undefined), "total\n12\n");
  for (const unsafe of ["../private.csv", "deliverables/run/../private.csv", "deliverables/run/linked.csv",
    "deliverables/run/elsewhere/private.csv", "deliverables/run/hardlinked.csv", "deliverables/run/.env"]) {
    assert.equal(await readWorkspaceDeliverable(workspace, unsafe), null, unsafe);
  }
  await rm(path.join(workspace, relative));
  assert.equal(await readWorkspaceDeliverable(workspace, relative), null);
});

test("a managed source preserves the first of two concurrent edits to the same revision", async () => {
  const workspacePath = await createWorkspaceRoot();
  const source = "docs/brief.md";
  const opened = await writeWorkspaceManagedFileForPath(workspacePath, source, "Original");
  assert.ok(opened.revision);
  assert.ok(opened.file.updatedAt);
  const edits = await Promise.allSettled([
    writeWorkspaceManagedFileForPath(workspacePath, source, "First edit", opened.revision),
    writeWorkspaceManagedFileForPath(workspacePath, source, "Second edit", opened.revision)
  ]);
  const saved = edits.find(edit => edit.status === "fulfilled");
  const rejected = edits.find(edit => edit.status === "rejected");
  assert.ok(saved);
  assert.notEqual(saved.value.revision, opened.revision);
  assert.ok(rejected?.reason instanceof WorkspaceFileConflictError);
  assert.equal((await readWorkspaceManagedFileForPath(workspacePath, source)).content, saved.value.content);
});

test("lists official OpenClaw workspace files and discovered safe context files", async () => {
  const workspacePath = await createWorkspaceRoot();
  await mkdir(path.join(workspacePath, "memory"), { recursive: true });
  await mkdir(path.join(workspacePath, "docs"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "reviewer"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });

  await writeFile(path.join(workspacePath, "AGENTS.md"), "# Agents\n");
  await writeFile(path.join(workspacePath, "memory", "2026-05-18.md"), "Daily memory\n");
  await writeFile(path.join(workspacePath, "docs", "brief.md"), "# Brief\n");
  await writeFile(path.join(workspacePath, "skills", "reviewer", "SKILL.md"), "# Skill\n");
  await writeFile(path.join(workspacePath, ".openclaw", "project.json"), JSON.stringify({ name: "Lab" }));
  await writeFile(path.join(workspacePath, ".openclaw", "config.json"), JSON.stringify({ safeLooking: true }));
  await writeFile(path.join(workspacePath, ".openclaw", "token.json"), JSON.stringify({ token: "hidden" }));

  const files = await listWorkspaceManagedFilesForPath(workspacePath);
  const paths = files.map((file) => file.path);

  assert.ok(paths.includes("AGENTS.md"));
  assert.ok(paths.includes("SOUL.md"));
  assert.ok(paths.includes("USER.md"));
  assert.ok(paths.includes("IDENTITY.md"));
  assert.equal(paths.includes("TOOLS.md"), false);
  assert.equal(paths.includes("HEARTBEAT.md"), false);
  assert.ok(paths.includes("BOOT.md"));
  assert.ok(paths.includes("BOOTSTRAP.md"));
  assert.ok(paths.includes("MEMORY.md"));
  assert.ok(paths.includes("memory/2026-05-18.md"));
  assert.ok(paths.includes("docs/brief.md"));
  assert.ok(paths.includes("skills/reviewer/SKILL.md"));
  assert.ok(paths.includes(".openclaw/project.json"));
  assert.equal(paths.includes(".openclaw/agents/builder/agent/POLICY.md"), false);
  assert.equal(paths.includes(".openclaw/config.json"), false);
  assert.equal(paths.includes(".openclaw/token.json"), false);
  assert.equal(paths.includes(".openclaw/agents/builder/agent/config.json"), false);

  assert.equal(files.find((file) => file.path === "USER.md")?.exists, false);
  assert.equal(files.find((file) => file.path === "USER.md")?.createable, true);
  assert.equal(files.find((file) => file.path === "BOOTSTRAP.md")?.createable, false);
  assert.equal(files.find((file) => file.path === ".openclaw/project.json")?.category, "project-config");
});

test("preserves legacy TOOLS.md and HEARTBEAT.md without treating them as current bootstrap", async () => {
  const workspacePath = await createWorkspaceRoot();
  await writeFile(path.join(workspacePath, "TOOLS.md"), "# Legacy tools\n");
  await writeFile(path.join(workspacePath, "HEARTBEAT.md"), "# Legacy heartbeat\n");

  const files = await listWorkspaceManagedFilesForPath(workspacePath);
  const tools = files.find((file) => file.path === "TOOLS.md");
  const heartbeat = files.find((file) => file.path === "HEARTBEAT.md");

  assert.equal(tools?.source, "discovered");
  assert.equal(tools?.createable, false);
  assert.equal(tools?.editable, true);
  assert.equal(heartbeat?.source, "discovered");
  assert.equal(heartbeat?.createable, false);
  assert.equal(heartbeat?.editable, true);

  await writeWorkspaceManagedFileForPath(workspacePath, "TOOLS.md", "# Preserved tools\n");
  assert.equal(await readFile(path.join(workspacePath, "TOOLS.md"), "utf8"), "# Preserved tools\n");
  await rm(path.join(workspacePath, "TOOLS.md"), { force: true });
  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, "TOOLS.md", "# New tools\n"),
    /cannot be created/
  );
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

test("reads and writes virtual agent profiles through the worker-profile sidecar", async () => {
  const workspacePath = await createWorkspaceRoot();
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await writeFile(
    path.join(workspacePath, ".openclaw", "project.json"),
    JSON.stringify(
      {
        name: "Lab",
        agents: [
          {
            id: "lab-builder",
            name: "Lab Builder",
            role: "Builder",
            enabled: true,
            skillIds: ["project-builder"],
            workerProfile: {
              schemaVersion: 1,
              identity: { displayName: "Lab Builder", emoji: null, theme: null, avatar: null },
              employment: {
                role: "Builder",
                mission: null,
                behaviorInstructions: "#### Persona\nCalm operator."
              },
              operator: { labels: [] }
            }
          }
        ]
      },
      null,
      2
    )
  );
  await writeFile(
    path.join(workspacePath, "AGENTS.md"),
    `# Lab

## Agent Roles
Each agent should use only the subsection matching its current OpenClaw agent id as its personal role/persona. Other subsections describe teammates in the same workspace.

### Lab Builder (\`lab-builder\`)
- Agent id: \`lab-builder\`
- Runtime rule: stale
- Role: Builder

#### Persona
Calm operator.
`
  );

  const files = await listWorkspaceManagedFilesForPath(workspacePath);
  const profileFile = files.find((file) => file.path === "agents/lab-builder/PROFILE.md");
  assert.ok(profileFile);
  assert.equal(profileFile.label, "Agent Profile");
  assert.equal(profileFile.source, "virtual");
  assert.equal(profileFile.category, "identity");

  const profile = await readWorkspaceManagedFileForPath(workspacePath, "agents/lab-builder/PROFILE.md");
  assert.match(profile.content, /#### Persona/);
  assert.match(profile.content, /Calm operator\./);

  await assert.rejects(
    () => writeWorkspaceManagedFileForPath(workspacePath, "agents/lab-builder/PROFILE.md", "## Persona\nNope\n"),
    /level-4 headings/
  );

  await writeWorkspaceManagedFileForPath(
    workspacePath,
    "agents/lab-builder/PROFILE.md",
    "#### Persona\nPrecise builder.\n\n#### Boundaries\nStay inside the workspace.\n"
  );

  const agentsMarkdown = await readFile(path.join(workspacePath, "AGENTS.md"), "utf8");
  assert.match(agentsMarkdown, /### Lab Builder \(`lab-builder`\)/);
  assert.match(agentsMarkdown, /- Runtime rule: stale/);
  assert.match(agentsMarkdown, /#### Persona\nCalm operator\./);
  assert.doesNotMatch(agentsMarkdown, /Precise builder/);

  const manifest = JSON.parse(await readFile(path.join(workspacePath, ".openclaw", "project.json"), "utf8")) as {
    agents: Array<{ workerProfile?: { employment?: { behaviorInstructions?: string | null } } }>;
  };
  assert.equal(manifest.agents[0]?.workerProfile?.employment?.behaviorInstructions, "#### Persona\nPrecise builder.\n\n#### Boundaries\nStay inside the workspace.");
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


test("managed workspace file operations reject a configured remote Gateway before resolving host paths", async (context) => {
  const previous = process.env.AGENTOS_OPENCLAW_GATEWAY_URL;
  process.env.AGENTOS_OPENCLAW_GATEWAY_URL = "wss://gateway.example.test";
  context.after(() => {
    if (previous === undefined) delete process.env.AGENTOS_OPENCLAW_GATEWAY_URL;
    else process.env.AGENTOS_OPENCLAW_GATEWAY_URL = previous;
  });
  const operation = { workspaceId: "remote-workspace", path: "AGENTS.md" };
  const unavailable = /Workspace file access is unavailable for a remote OpenClaw Gateway/;

  await assert.rejects(listWorkspaceManagedFiles(operation.workspaceId), unavailable);
  await assert.rejects(readWorkspaceManagedFile(operation), unavailable);
  await assert.rejects(writeWorkspaceManagedFile({ ...operation, content: "must stay remote" }), unavailable);
});
