import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readTaskReview,
  readTaskReviews,
  writeTaskReview
} from "@/lib/agentos/application/task-review-service";

test("operator review decisions persist across reads and remain actor-scoped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-task-review-"));
  const previousRoot = process.env.AGENTOS_MISSION_CONTROL_ROOT;
  process.env.AGENTOS_MISSION_CONTROL_ROOT = root;

  try {
    const review = await writeTaskReview({
      actorId: "operator-a",
      taskId: "task-record-1",
      taskKey: "dispatch-1",
      status: "accepted",
      action: "Accepted the captured result"
    });

    assert.deepEqual(await readTaskReview("operator-a", "dispatch-1"), review);
    assert.equal(await readTaskReview("operator-b", "dispatch-1"), null);
    assert.deepEqual(await readTaskReviews("operator-a", ["dispatch-1", "dispatch-1"]), {
      "dispatch-1": review
    });
  } finally {
    if (previousRoot === undefined) delete process.env.AGENTOS_MISSION_CONTROL_ROOT;
    else process.env.AGENTOS_MISSION_CONTROL_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
