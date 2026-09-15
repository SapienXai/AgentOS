import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_CREATION_SNAPSHOT_RECONCILIATION_DELAYS_MS,
  AGENT_CREATION_SNAPSHOT_RECONCILIATION_TIMEOUT_MS,
  resolveAgentCreationProgressSteps
} from "@/components/mission-control/agent-creation-progress.utils";

test("agent creation progress exposes the real create lifecycle boundaries", () => {
  assert.deepEqual(
    resolveAgentCreationProgressSteps("creating").map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "active" },
      { id: "workspace", status: "pending" },
      { id: "online", status: "pending" }
    ]
  );

  assert.deepEqual(
    resolveAgentCreationProgressSteps("syncing").map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "done" },
      { id: "workspace", status: "active" },
      { id: "online", status: "pending" }
    ]
  );
  assert.equal(resolveAgentCreationProgressSteps("syncing")[2]?.label, "Joining workspace");
  assert.ok(resolveAgentCreationProgressSteps("syncing")[2]?.description.includes("workspace snapshot"));

  assert.deepEqual(
    resolveAgentCreationProgressSteps("complete").map(({ id, status }) => ({ id, status })),
    [
      { id: "identity", status: "done" },
      { id: "openclaw", status: "done" },
      { id: "workspace", status: "done" },
      { id: "online", status: "done" }
    ]
  );
});

test("agent creation progress uses truthful lifecycle labels", () => {
  assert.equal(resolveAgentCreationProgressSteps("creating")[0]?.label, "Preparing agent");
  assert.equal(resolveAgentCreationProgressSteps("creating")[1]?.label, "Creating agent");
  assert.equal(resolveAgentCreationProgressSteps("syncing")[2]?.label, "Joining workspace");
  assert.equal(resolveAgentCreationProgressSteps("complete")[3]?.label, "Ready");
});

test("agent creation reconciliation remains bounded and retries the live snapshot", () => {
  assert.equal(AGENT_CREATION_SNAPSHOT_RECONCILIATION_DELAYS_MS[0], 0);
  assert.ok(AGENT_CREATION_SNAPSHOT_RECONCILIATION_DELAYS_MS.length >= 5);
  assert.ok(
    AGENT_CREATION_SNAPSHOT_RECONCILIATION_TIMEOUT_MS >
      AGENT_CREATION_SNAPSHOT_RECONCILIATION_DELAYS_MS.reduce((total, delay) => total + delay, 0 as number)
  );
});
