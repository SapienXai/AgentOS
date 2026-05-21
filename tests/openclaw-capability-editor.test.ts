import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeDeclaredAgentSkills
} from "@/lib/openclaw/domains/agent-config";
import {
  updateSnapshotAgentCapabilities
} from "@/lib/openclaw/capability-editor";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";

test("declared agent skills preserve dynamic workspace skill ids", () => {
  assert.deepEqual(
    normalizeDeclaredAgentSkills([
      " project-builder ",
      "workspace-reviewer",
      "agent-policy-worker",
      "workspace-reviewer",
      ""
    ]),
    ["project-builder", "workspace-reviewer"]
  );
});

test("capability optimistic update preserves policy locked workspace file tool", () => {
  const snapshot = {
    agents: [
      {
        id: "worker",
        workspaceId: "workspace",
        skills: ["project-builder"],
        tools: ["read", "fs.workspaceOnly"]
      },
      {
        id: "reviewer",
        workspaceId: "workspace",
        skills: ["project-reviewer"],
        tools: ["message"]
      }
    ],
    workspaces: [
      {
        id: "workspace",
        capabilities: {
          skills: [],
          tools: [],
          workspaceOnlyAgentCount: 0
        }
      }
    ]
  } as unknown as MissionControlSnapshot;

  const updated = updateSnapshotAgentCapabilities(snapshot, "worker", ["workspace-reviewer"], ["read", "edit"]);
  const worker = updated.agents.find((agent) => agent.id === "worker");
  const workspace = updated.workspaces.find((entry) => entry.id === "workspace");

  assert.deepEqual(worker?.skills, ["workspace-reviewer"]);
  assert.deepEqual(worker?.tools, ["read", "edit", "fs.workspaceOnly"]);
  assert.deepEqual(workspace?.capabilities.tools, ["read", "edit", "fs.workspaceOnly", "message"]);
  assert.equal(workspace?.capabilities.workspaceOnlyAgentCount, 1);
});
