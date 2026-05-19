import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { reconcileWorkspaceProjectManifestAgents } from "@/lib/openclaw/domains/workspace-manifest";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("project manifest reconciliation prunes stale agents and keeps a primary agent", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-workspace-manifest-"));
  tempRoots.push(tempRoot);
  const workspacePath = path.join(tempRoot, "workspace");
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "agent-policy-stale-agent"), { recursive: true });
  await mkdir(path.join(workspacePath, "skills", "agent-policy-live-agent"), { recursive: true });
  await writeFile(path.join(workspacePath, "skills", "agent-policy-stale-agent", "SKILL.md"), "# Stale\n");
  await writeFile(path.join(workspacePath, "skills", "agent-policy-live-agent", "SKILL.md"), "# Live\n");

  await writeFile(
    path.join(workspacePath, ".openclaw", "project.json"),
    JSON.stringify(
      {
        version: 1,
        name: "Manifest Lab",
        agents: [
          {
            id: "stale-agent",
            name: "Stale Agent",
            role: "Old role",
            isPrimary: true,
            enabled: true
          },
          {
            id: "live-agent",
            name: "Live Agent",
            role: "Current role",
            isPrimary: false,
            enabled: true
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const manifest = await reconcileWorkspaceProjectManifestAgents(workspacePath, ["live-agent"]);
  const persisted = JSON.parse(await readFile(path.join(workspacePath, ".openclaw", "project.json"), "utf8")) as {
    agents: Array<{ id: string; isPrimary: boolean }>;
  };

  assert.deepEqual(manifest.agents.map((agent) => agent.id), ["live-agent"]);
  assert.equal(manifest.agents[0]?.isPrimary, true);
  assert.deepEqual(persisted.agents.map((agent) => agent.id), ["live-agent"]);
  assert.equal(persisted.agents[0]?.isPrimary, true);
  await assert.rejects(
    () => access(path.join(workspacePath, "skills", "agent-policy-stale-agent", "SKILL.md")),
    /ENOENT/
  );
  await access(path.join(workspacePath, "skills", "agent-policy-live-agent", "SKILL.md"));
});
