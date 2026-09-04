import assert from "node:assert/strict";
import test from "node:test";

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { buildSessionModelOverrides } from "@/lib/openclaw/domains/session-model-scope";

function createSnapshot(): MissionControlSnapshot {
  return {
    agents: [
      { id: "researcher", name: "Researcher", modelId: "openrouter/auto" },
      { id: "writer", name: "Writer", modelId: "openai/gpt-5.4" }
    ],
    runtimes: [
      {
        id: "override-runtime",
        source: "session",
        key: "agent:researcher:main",
        sessionId: "session-1",
        agentId: "researcher",
        modelId: "anthropic/claude-sonnet-4",
        modelOverrideSource: "user",
        title: "Research session",
        updatedAt: 200
      },
      {
        id: "inherited-runtime",
        source: "session",
        key: "agent:writer:main",
        sessionId: "session-2",
        agentId: "writer",
        modelId: "openai/gpt-5.4",
        title: "Writing session",
        updatedAt: 300
      },
      {
        id: "provider-alias-runtime",
        source: "session",
        key: "agent:researcher:alias",
        sessionId: "session-alias",
        agentId: "researcher",
        modelId: "auto",
        title: "Provider alias session",
        updatedAt: 350
      },
      {
        id: "task-runtime",
        source: "task",
        key: "task:researcher:1",
        sessionId: "session-3",
        agentId: "researcher",
        modelId: "anthropic/claude-sonnet-4",
        title: "Task runtime",
        updatedAt: 400
      }
    ]
  } as unknown as MissionControlSnapshot;
}

test("session model scope reports only explicit OpenClaw session overrides", () => {
  const overrides = buildSessionModelOverrides(createSnapshot());

  assert.equal(overrides.length, 1);
  assert.deepEqual(overrides[0], {
    runtimeId: "override-runtime",
    sessionKey: "agent:researcher:main",
    sessionId: "session-1",
    agentId: "researcher",
    agentName: "Researcher",
    sessionModelId: "anthropic/claude-sonnet-4",
    agentModelId: "openrouter/auto",
    title: "Research session",
    updatedAt: 200
  });
});

test("native user provenance keeps an explicit session override even when the route matches the agent", () => {
  const snapshot = createSnapshot();
  snapshot.runtimes.push({
    id: "same-route-explicit-runtime",
    source: "session",
    key: "agent:writer:explicit",
    sessionId: "session-4",
    agentId: "writer",
    modelId: "openai/gpt-5.4",
    modelOverrideSource: "user",
    title: "Explicit same-route session",
    updatedAt: 500
  } as never);

  const overrides = buildSessionModelOverrides(snapshot);

  assert.equal(overrides.some((override) => override.sessionKey === "agent:writer:explicit"), true);
});
