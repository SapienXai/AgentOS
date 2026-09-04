import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import {
  capabilityState,
  normalizeManagedWorktree,
  normalizeNativeWorkExecution,
  normalizeSessionOwnership,
  normalizeSuggestedWork,
  resolveIsolatedWorktreeEligibility
} from "@/lib/openclaw/domains/native-work-model";

test("normalizes the exact OpenClaw 2026.9.1 managed-work contract", () => {
  const worktree = normalizeManagedWorktree({
    id: "wt-1",
    name: "agent-work",
    repoFingerprint: "0123456789abcdef",
    repoRoot: "/repo",
    path: "/repo/.openclaw/worktrees/agent-work",
    branch: "openclaw/agent-work",
    baseRef: "main",
    ownerKind: "session",
    ownerId: "session-1",
    createdAt: 10,
    lastActiveAt: 20
  });
  assert.deepEqual(worktree, {
    id: "wt-1",
    name: "agent-work",
    repoRoot: "/repo",
    path: "/repo/.openclaw/worktrees/agent-work",
    branch: "openclaw/agent-work",
    baseRef: "main",
    ownerKind: "session",
    ownerId: "session-1",
    createdAt: 10,
    lastActiveAt: 20,
    lifecycle: "active",
    cleanupOutcome: null,
    sourceOfTruth: "openclaw"
  });
});

test("keeps task suggestions separate from accepted tasks and preserves native context", () => {
  const suggestion = normalizeSuggestedWork({
    id: "suggestion-1",
    title: "Review the release notes",
    prompt: "Review the release notes and report gaps.",
    tldr: "Find missing release evidence.",
    cwd: "/repo",
    sessionKey: "agent:main:main",
    agentId: "main",
    createdAt: 30
  }, ["worktree"]);
  assert.equal(suggestion?.status, "suggested");
  assert.deepEqual(suggestion?.availableAcceptModes, ["worktree"]);
  assert.equal(suggestion?.sourceOfTruth, "openclaw");
});

test("projects session ownership, participants, visibility, and principal-less evidence", () => {
  const ownership = normalizeSessionOwnership({
    key: "agent:main:main",
    createdActor: { type: "agent", id: "main", label: "Main" },
    owner: { actor: { type: "agent", id: "main", label: "Main" }, assignedAt: 40 },
    participants: [{ identity: { id: "human-1", label: "Operator" } }],
    visibility: "shared",
    sharingRole: "owner"
  }, undefined, {
    members: [{ identityId: "human-1", addedAt: 50, addedByState: "unknown" }]
  });
  assert.equal(ownership.createdActor?.id, "main");
  assert.equal(ownership.owner?.id, "main");
  assert.equal(ownership.visibility, "shared");
  assert.equal(ownership.participantCount, 1);
  assert.equal(ownership.memberEvidence[0]?.addedByState, "unknown");
});

test("isolated execution is eligible only after native capability and repository evidence", () => {
  assert.deepEqual(resolveIsolatedWorktreeEligibility({
    requestedMode: "isolated-worktree",
    workspacePath: "/repo",
    worktreesCapability: "supported",
    repositoryStatus: "git"
  }), { eligible: true, reason: null });
  assert.equal(resolveIsolatedWorktreeEligibility({
    requestedMode: "isolated-worktree",
    workspacePath: "/repo",
    worktreesCapability: "unsupported",
    repositoryStatus: "git"
  }).eligible, false);
  assert.equal(resolveIsolatedWorktreeEligibility({
    requestedMode: "isolated-worktree",
    workspacePath: "/repo",
    worktreesCapability: "supported",
    repositoryStatus: "not_git"
  }).reason, "Isolated work requires a Git repository at the selected workspace.");
});

test("execution projection links the native session to its managed worktree", () => {
  const execution = normalizeNativeWorkExecution({
    key: "agent:main:isolated",
    sessionId: "session-1",
    agentId: "main",
    status: "running",
    updatedAt: 100,
    execCwd: "/repo/.openclaw/worktrees/agent-work",
    worktree: { id: "wt-1", branch: "openclaw/agent-work", repoRoot: "/repo", path: "/repo/.openclaw/worktrees/agent-work" },
    createdActor: { type: "agent", id: "main" },
    visibility: "shared"
  }, null, null, undefined, undefined, ["task-1"]);
  assert.equal(execution?.sessionKey, "agent:main:isolated");
  assert.equal(execution?.worktree?.id, "wt-1");
  assert.deepEqual(execution?.taskIds, ["task-1"]);
  assert.equal(execution?.ownership.sourceOfTruth, "openclaw");
});

test("capability state remains unknown when the live handshake has no operation entry", () => {
  assert.equal(capabilityState(null, "worktrees"), "unknown");
});

test("native work operations fail closed when CLI transport is forced", async () => {
  const fallback = { listWorktrees: async () => ({ worktrees: [] }) } as unknown as OpenClawGatewayClient;
  const client = new NativeWsOpenClawGatewayClient({
    forceCli: true,
    fallback,
    transport: {} as never
  });
  await assert.rejects(client.listWorktrees(), /CLI fallback is disabled/);
  await assert.rejects(client.acceptTaskSuggestion({ taskId: "suggestion-1" }), /CLI fallback is disabled/);
});
