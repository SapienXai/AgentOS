import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeWsOpenClawGatewayClient
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { loadNativeSessionOwnershipDetail } from "@/lib/openclaw/application/mission-control/native-work-detail";
import { reconcileNativeSessionOwnerMutation } from "@/lib/openclaw/application/session-collaboration-service";
import { loadNativeWorkSnapshot } from "@/lib/openclaw/application/mission-control/native-work-snapshot";
import type { OpenClawCapabilityMatrix } from "@/lib/openclaw/types";
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

test("root native work projection does not fan out membership detail", async () => {
  let memberCalls = 0;
  let evidenceCalls = 0;
  const adapter = {
    listWorktrees: async () => ({ worktrees: [] }),
    listTaskSuggestions: async () => ({ suggestions: [] }),
    listSessionMembers: async () => {
      memberCalls += 1;
      return { members: [] };
    },
    listSessionMembersEvidence: async () => {
      evidenceCalls += 1;
      return { members: [] };
    }
  } as unknown as OpenClawAdapter;
  const matrix = {
    supportedMethods: [
      "worktrees.list",
      "taskSuggestions.list",
      "session.members.list",
      "session.members.listEvidence"
    ],
    operations: {
      worktrees: { mode: "gateway-native" },
      taskSuggestions: { mode: "gateway-native" },
      sessionCollaboration: { mode: "gateway-native" }
    }
  } as unknown as OpenClawCapabilityMatrix;

  const snapshot = await loadNativeWorkSnapshot({
    sessions: [{ key: "agent:main:detail", agentId: "main", status: "idle" }] as never,
    agents: [],
    matrix,
    adapter,
    timeoutMs: 100
  });

  assert.equal(memberCalls, 0);
  assert.equal(evidenceCalls, 0);
  assert.equal(snapshot.executions[0]?.ownership.membershipDetailState, "not-loaded");

  const detail = await loadNativeSessionOwnershipDetail({
    execution: snapshot.executions[0]!,
    adapter,
    timeoutMs: 100
  });
  assert.equal(memberCalls, 1);
  assert.equal(evidenceCalls, 1);
  assert.equal(detail.state, "available");
  assert.equal(detail.ownership.membershipDetailState, "available");
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

test("ambiguous native owner mutation is reconciled by one authoritative reread without retry", async () => {
  let assignmentCalls = 0;
  let memberReads = 0;
  const adapter = {
    assignSessionOwner: async () => {
      assignmentCalls += 1;
      throw new Error("transport timeout after dispatch");
    },
    listSessionMembers: async () => {
      memberReads += 1;
      return {
        owner: { actor: { type: "human", id: "native-profile-1" } },
        members: [],
        identities: [],
        role: "owner",
        allowedVisibilities: []
      };
    }
  } as unknown as OpenClawAdapter;

  await assert.rejects(
    adapter.assignSessionOwner!({ key: "agent:main:collaboration", owner: { type: "human", id: "native-profile-1" } }),
    /transport timeout/
  );
  const reconciliation = await reconcileNativeSessionOwnerMutation({
    adapter,
    sessionKey: "agent:main:collaboration",
    target: { type: "human", id: "native-profile-1" },
    timeoutMs: 100
  });
  assert.equal(reconciliation.verified, true);
  assert.equal(assignmentCalls, 1);
  assert.equal(memberReads, 1);
});
