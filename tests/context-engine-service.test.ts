import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyContextEngineFileOwner,
  decorateContextEngineFile,
  filterContextEngineFilesForAgent,
  normalizeOpenClawContextReport
} from "@/lib/openclaw/application/context-engine-service";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";

function file(path: string, category: WorkspaceManagedFile["category"]): WorkspaceManagedFile {
  return {
    path,
    label: path.split("/").at(-1) ?? path,
    category,
    language: path.endsWith(".json") ? "json" : "markdown",
    exists: true,
    createable: false,
    editable: true,
    size: 128,
    source: path.startsWith("agents/") ? "virtual" : "official"
  };
}

test("classifyContextEngineFileOwner separates workspace and selected-agent files", () => {
  assert.equal(classifyContextEngineFileOwner(file("AGENTS.md", "context")), "workspace-global");
  assert.equal(classifyContextEngineFileOwner(file("MEMORY.md", "memory")), "memory");
  assert.equal(classifyContextEngineFileOwner(file("memory/decisions.md", "memory")), "memory");
  assert.equal(classifyContextEngineFileOwner(file("skills/reviewer/SKILL.md", "skills")), "workspace-skill");
  assert.equal(classifyContextEngineFileOwner(file("agents/agent-1/PROFILE.md", "identity")), "agent-profile");
  assert.equal(classifyContextEngineFileOwner(file("agents/agent-2/PROFILE.md", "identity")), "agent-profile");
});

test("decorateContextEngineFile marks runtime-included files without claiming unrelated files", () => {
  const decorated = decorateContextEngineFile(file("AGENTS.md", "context"), "agent-1", [
    {
      path: "./AGENTS.md",
      tokens: 42,
      truncated: false
    }
  ]);
  const unrelated = decorateContextEngineFile(file("SOUL.md", "context"), "agent-1", [
    {
      path: "AGENTS.md",
      tokens: 42
    }
  ]);

  assert.equal(decorated.ownerLabel, "Workspace global");
  assert.equal(decorated.runtimeIncluded, true);
  assert.equal(decorated.runtimeTokenEstimate, 42);
  assert.equal(unrelated.runtimeIncluded, false);

  const otherAgentProfile = decorateContextEngineFile(file("agents/agent-2/PROFILE.md", "identity"), "agent-1");
  assert.equal(otherAgentProfile.ownerLabel, "Agent profile");
  assert.equal(otherAgentProfile.selectedAgentOwned, false);
});

test("decorateContextEngineFile applies saved include and exclude configuration", () => {
  const included = decorateContextEngineFile(file("AGENTS.md", "context"), "agent-1", [], {
    version: 1,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    updatedAt: "2026-06-12T00:00:00.000Z",
    files: [
      {
        path: "AGENTS.md",
        enabled: false
      }
    ]
  });
  const missing = decorateContextEngineFile(
    {
      ...file("USER.md", "context"),
      exists: false,
      createable: true,
      size: null
    },
    "agent-1",
    [],
    {
      version: 1,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      updatedAt: "2026-06-12T00:00:00.000Z",
      files: [
        {
          path: "USER.md",
          enabled: true
        }
      ]
    }
  );

  assert.equal(included.enabled, false);
  assert.equal(included.savedEnabled, false);
  assert.equal(included.status, "disabled");
  assert.equal(included.injectedTokens, 0);
  assert.equal(missing.enabled, false);
  assert.equal(missing.status, "missing");
  assert.equal(missing.canToggle, false);
});

test("filterContextEngineFilesForAgent keeps only selected agent profile and policy files", () => {
  const files = [
    file("AGENTS.md", "context"),
    file("agents/agent-1/PROFILE.md", "identity"),
    file("agents/agent-2/PROFILE.md", "identity"),
    file("skills/agent-policy-agent-1/SKILL.md", "agent-policy-config"),
    file("skills/agent-policy-agent-2/SKILL.md", "agent-policy-config"),
    file("skills/reviewer/SKILL.md", "skills")
  ];
  const visiblePaths = filterContextEngineFilesForAgent(files, "agent-1").map((entry) => entry.path);

  assert.deepEqual(visiblePaths, [
    "AGENTS.md",
    "agents/agent-1/PROFILE.md",
    "skills/agent-policy-agent-1/SKILL.md",
    "skills/reviewer/SKILL.md"
  ]);
});

test("normalizeOpenClawContextReport preserves exact session prompt report details", () => {
  const report = normalizeOpenClawContextReport({
    source: "openclaw-session-report",
    session: {
      sessionId: "session-1",
      key: "agent-1/default",
      updatedAt: 1710000000,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    },
    report: {
      source: "system-prompt-report",
      systemPromptChars: 1200,
      toolsSchemaChars: 330,
      skillsPromptChars: 220,
      injectedWorkspaceFiles: [
        {
          path: "AGENTS.md",
          chars: 1000,
          tokens: 250,
          truncated: true
        }
      ],
      truncationNotes: ["AGENTS.md was truncated"]
    }
  });

  assert.equal(report.status, "exact");
  assert.equal(report.source, "openclaw-session-report");
  assert.equal(report.sessionId, "session-1");
  assert.equal(report.systemPromptChars, 1200);
  assert.equal(report.toolsSchemaChars, 330);
  assert.equal(report.skillsPromptChars, 220);
  assert.equal(report.totalTokens, 150);
  assert.deepEqual(report.injectedFiles, [
    {
      path: "AGENTS.md",
      label: null,
      chars: 1000,
      tokens: 250,
      truncated: true
    }
  ]);
  assert.equal(report.truncation.occurred, true);
  assert.deepEqual(report.truncation.notes, ["AGENTS.md was truncated"]);
});
