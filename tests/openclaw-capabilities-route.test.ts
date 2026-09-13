import assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePluginCatalogContext } from "@/app/api/openclaw/capabilities/route";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

const snapshot = {
  workspaces: [
    {
      id: "workspace-calendar",
      name: "Calendar workspace",
      slug: "calendar-workspace",
      agentIds: ["calendar-planner"]
    }
  ],
  agents: [
    {
      id: "calendar-planner",
      name: "Calendar planner",
      workspaceId: "workspace-calendar",
      profile: {
        purpose: "Plan calendar workflows"
      }
    },
    {
      id: "other-agent",
      name: "Other agent",
      workspaceId: "workspace-other",
      profile: {
        purpose: "Handle another workspace"
      }
    }
  ]
} as unknown as Pick<ControlPlaneSnapshot, "workspaces" | "agents">;

test("capabilities route context resolver only projects a valid workspace-agent relationship", () => {
  assert.deepEqual(
    resolvePluginCatalogContext(snapshot, "workspace-calendar", "calendar-planner"),
    {
      workspaceName: "Calendar workspace",
      workspaceSlug: "calendar-workspace",
      agentName: "Calendar planner",
      agentPurpose: "Plan calendar workflows"
    }
  );
});

test("capabilities route context resolver keeps missing or mismatched context unknown", () => {
  assert.equal(resolvePluginCatalogContext(snapshot, undefined, "calendar-planner"), null);
  assert.equal(resolvePluginCatalogContext(snapshot, "workspace-calendar", undefined), null);
  assert.equal(resolvePluginCatalogContext(snapshot, "workspace-calendar", "other-agent"), null);
  assert.equal(resolvePluginCatalogContext(snapshot, "workspace-other", "calendar-planner"), null);
  assert.equal(resolvePluginCatalogContext(snapshot, "missing-workspace", "missing-agent"), null);
});
