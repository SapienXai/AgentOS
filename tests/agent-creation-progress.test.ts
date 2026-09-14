import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveAgentCreationProgressPercent,
  resolveAgentCreationProgressSteps
} from "@/components/mission-control/agent-creation-progress.utils";

test("agent creation progress exposes the real create lifecycle boundaries", () => {
  assert.deepEqual(
    resolveAgentCreationProgressSteps("creating", false).map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "active" },
      { id: "workspace", status: "pending" },
      { id: "online", status: "pending" }
    ]
  );

  assert.deepEqual(
    resolveAgentCreationProgressSteps("syncing", true).map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "done" },
      { id: "workspace", status: "active" },
      { id: "online", status: "pending" }
    ]
  );
  assert.equal(resolveAgentCreationProgressSteps("syncing", true)[2]?.label, "Linking workspace routes");
  assert.ok(resolveAgentCreationProgressSteps("syncing", false)[2]?.description.includes("workspace snapshot"));

  assert.deepEqual(
    resolveAgentCreationProgressSteps("complete", false).map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "done" },
      { id: "workspace", status: "done" },
      { id: "online", status: "done" }
    ]
  );
});

test("agent creation progress percentages are lifecycle milestones", () => {
  assert.equal(resolveAgentCreationProgressPercent("creating"), 42);
  assert.equal(resolveAgentCreationProgressPercent("syncing"), 78);
  assert.equal(resolveAgentCreationProgressPercent("complete"), 100);
});
