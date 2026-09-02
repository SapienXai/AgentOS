import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeOpenClawToolsCatalog } from "@/lib/openclaw/application/catalog-service";
import { normalizeDeclaredAgentSkills } from "@/lib/openclaw/domains/agent-config";
import { updateSnapshotAgentCapabilities } from "@/lib/openclaw/capability-editor";
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

test("live OpenClaw tool discovery preserves tools outside the static fallback catalog", () => {
  const entries = normalizeOpenClawToolsCatalog({
    agentId: "agent-1",
    profiles: [],
    groups: [
      {
        id: "core",
        label: "Core",
        source: "core",
        tools: [
          {
            id: "future-live-tool",
            label: "Future live tool",
            description: "Reported by the current Gateway.",
            source: "core",
            defaultProfiles: ["full"]
          }
        ]
      },
      {
        id: "plugin-tools",
        label: "Example Plugin",
        source: "plugin",
        pluginId: "example-plugin",
        tools: [
          {
            id: "plugin-live-tool",
            label: "Plugin live tool",
            description: "Provided by the current Gateway plugin catalog.",
            source: "plugin",
            pluginId: "example-plugin",
            defaultProfiles: ["full"]
          }
        ]
      }
    ]
  });

  assert.deepEqual(entries.map((entry) => entry.name), ["future-live-tool", "plugin-live-tool"]);
  assert.equal(entries[0]?.source, "OpenClaw Gateway");
  assert.equal(entries[1]?.category, "plugin");
  assert.equal(entries[1]?.pluginId, "example-plugin");
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
