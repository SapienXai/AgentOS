import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
  mergeAgentOSWorkerProfile,
  parseAgentOSWorkerProfile
} from "@/lib/agentos/worker-profile";

test("legacy manifest fields normalize into a Worker Profile without an eager rewrite", () => {
  const profile = parseAgentOSWorkerProfile(null, {
    name: "Research Worker",
    role: "Research analyst",
    emoji: "🔎",
    theme: "blue"
  });

  assert.deepEqual(profile, {
    schemaVersion: AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
    identity: {
      displayName: "Research Worker",
      emoji: "🔎",
      theme: "blue",
      avatar: null
    },
    employment: {
      role: "Research analyst",
      mission: null,
      behaviorInstructions: null
    },
    operator: {
      labels: []
    }
  });
});

test("Worker Profile mutations preserve omitted fields and normalize labels", () => {
  const current = parseAgentOSWorkerProfile({
    schemaVersion: 1,
    identity: { displayName: "Research Worker", emoji: "🔎" },
    employment: { role: "Research analyst", mission: "Find evidence" },
    operator: { labels: ["research"] }
  });

  const next = mergeAgentOSWorkerProfile(current, {
    schemaVersion: 1,
    employment: { mission: "Produce a cited brief" },
    operator: { labels: ["research", " priority ", "research", ""] }
  });

  assert.equal(next.identity.displayName, "Research Worker");
  assert.equal(next.employment.role, "Research analyst");
  assert.equal(next.employment.mission, "Produce a cited brief");
  assert.deepEqual(next.operator.labels, ["research", "priority"]);
});

test("Worker Profile mutations honor explicit null clearing", () => {
  const next = mergeAgentOSWorkerProfile(null, {
    schemaVersion: 1,
    identity: { displayName: null },
    employment: { role: null }
  }, {
    name: "Legacy worker",
    role: "Legacy role"
  });

  assert.equal(next.identity.displayName, null);
  assert.equal(next.employment.role, null);
});
