import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildNativeMutationFailureResponse,
  executeNativeMutation
} from "@/lib/openclaw/application/native-mutation-service";
import {
  reconcileNativeSessionMemberMutation,
  reconcileNativeSessionOwnerMutation,
  reconcileNativeSessionVisibilityMutation
} from "@/lib/openclaw/application/session-collaboration-service";
import { NativeGatewayError, NativeGatewayRequestError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

function adapterFor(input: {
  members?: Array<{ identityId: string; addedBy: string; addedAt: number }>;
  owner?: { type: "agent" | "human" | "system"; id: string };
  visibility?: "shared" | "read-only" | "suggest" | "draft";
} = {}) {
  return {
    listSessionMembers: async () => ({
      sessionKey: "agent:main:collaboration",
      members: input.members ?? [],
      identities: [],
      ...(input.owner ? { owner: input.owner } : {}),
      role: "owner" as const,
      allowedVisibilities: []
    }),
    describeSession: async () => ({ session: { visibility: input.visibility } })
  } as unknown as OpenClawAdapter;
}

test("definite native rejection never reconciles or retries", async () => {
  let mutationCalls = 0;
  let reconciliationReads = 0;
  const outcome = await executeNativeMutation({
    operation: "session.members.add",
    mutate: async () => {
      mutationCalls += 1;
      throw new NativeGatewayError("operator scope denied", { kind: "scope-limited" });
    },
    reconcile: async () => {
      reconciliationReads += 1;
      return { verified: true };
    }
  });

  assert.equal(outcome.outcome, "failed");
  assert.equal(outcome.reconciled, false);
  assert.equal(mutationCalls, 1);
  assert.equal(reconciliationReads, 0);
});

test("request-not-sent errors are definite failures without reconciliation", async () => {
  let reconciliationReads = 0;
  const outcome = await executeNativeMutation({
    operation: "session.visibility.set",
    mutate: async () => {
      throw new NativeGatewayRequestError("request was not sent", "session.visibility.set", false, { kind: "timeout" });
    },
    reconcile: async () => {
      reconciliationReads += 1;
      return { verified: true };
    }
  });

  assert.equal(outcome.outcome, "failed");
  assert.equal(reconciliationReads, 0);
});

test("ambiguous delivery reconciles once only when causality proves a transition", async () => {
  let mutationCalls = 0;
  let reconciliationReads = 0;
  const proven = await executeNativeMutation({
    operation: "session.members.add",
    mutate: async () => {
      mutationCalls += 1;
      throw new NativeGatewayRequestError("timed out after dispatch", "session.members.add", true, { kind: "timeout" });
    },
    reconcile: async () => {
      reconciliationReads += 1;
      return { verified: true, result: { ok: true } };
    }
  });

  assert.equal(proven.outcome, "succeeded");
  assert.equal(proven.reconciled, true);
  assert.equal(mutationCalls, 1);
  assert.equal(reconciliationReads, 1);

  const inconclusive = await executeNativeMutation({
    operation: "session.members.add",
    mutate: async () => {
      throw new NativeGatewayRequestError("timed out after dispatch", "session.members.add", true, { kind: "timeout" });
    },
    reconcile: async () => ({ verified: false })
  });
  assert.equal(inconclusive.outcome, "unknown");
  assert.equal(inconclusive.retryable, false);
});

test("pre-existing member state cannot prove an ambiguous add or remove", async () => {
  const alreadyPresent = await reconcileNativeSessionMemberMutation({
    adapter: adapterFor({ members: [{ identityId: "profile-a", addedBy: "service", addedAt: 1 }] }),
    sessionKey: "agent:main:collaboration",
    identityId: "profile-a",
    expectedPresent: true,
    beforePresent: true,
    timeoutMs: 100
  });
  assert.equal(alreadyPresent.verified, true);
  assert.equal(alreadyPresent.changedAndVerified, false);

  const removed = await reconcileNativeSessionMemberMutation({
    adapter: adapterFor(),
    sessionKey: "agent:main:collaboration",
    identityId: "profile-a",
    expectedPresent: false,
    beforePresent: true,
    timeoutMs: 100
  });
  assert.equal(removed.verified, true);
  assert.equal(removed.changedAndVerified, true);
});

test("pre-existing visibility and owner state cannot prove an ambiguous mutation", async () => {
  const visibility = await reconcileNativeSessionVisibilityMutation({
    adapter: adapterFor({ visibility: "read-only" }),
    sessionKey: "agent:main:collaboration",
    expectedVisibility: "read-only",
    beforeVisibility: "read-only",
    timeoutMs: 100
  });
  assert.equal(visibility.verified, true);
  assert.equal(visibility.changedAndVerified, false);

  const owner = await reconcileNativeSessionOwnerMutation({
    adapter: adapterFor({ owner: { type: "agent", id: "agent-a" } }),
    sessionKey: "agent:main:collaboration",
    target: { type: "agent", id: "agent-a" },
    beforeOwner: { type: "agent", id: "agent-a" },
    timeoutMs: 100
  });
  assert.equal(owner.verified, true);
  assert.equal(owner.changedAndVerified, false);
});

test("definite and uncertain API payloads use distinct truthful semantics", () => {
  const failed = buildNativeMutationFailureResponse({
    outcome: "failed",
    reconciled: false,
    retryable: false,
    result: null,
    classification: {
      disposition: "definite-rejection",
      kind: "scope-limited",
      requestSent: true,
      message: "operator scope denied"
    }
  });
  assert.equal(failed.status, 403);
  assert.equal(failed.body.outcome, "failed");
  assert.match(failed.body.error, /scope denied/);

  const unknown = buildNativeMutationFailureResponse({
    outcome: "unknown",
    reconciled: false,
    retryable: false,
    result: null,
    classification: {
      disposition: "ambiguous-outcome",
      kind: "timeout",
      requestSent: true,
      message: "timed out"
    }
  });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.outcome, "unknown");
  assert.equal(unknown.body.retryable, false);
  assert.doesNotMatch(unknown.body.error, /rejected/i);
});

test("Phase 7 mutation routes use the shared classifier execution boundary", async () => {
  const [ownership, users] = await Promise.all([
    readFile("app/api/sessions/ownership/route.ts", "utf8"),
    readFile("app/api/users/openclaw/route.ts", "utf8")
  ]);
  assert.match(ownership, /executeNativeMutation/);
  assert.match(ownership, /buildNativeMutationFailureResponse/);
  assert.match(users, /executeOpenClawUserRoleMutation/);
  assert.match(users, /buildNativeMutationFailureResponse/);
  assert.doesNotMatch(ownership, /classifyNativeMutationError/);
  assert.doesNotMatch(users, /classifyNativeMutationError/);
});
