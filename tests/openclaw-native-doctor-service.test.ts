import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditResultForNativeDoctorMutation,
  buildNativeDoctorConfirmation,
  claimNativeUpdateRunAdmission,
  confirmationMatches,
  consumeNativeUpdateConfirmation,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot,
  issueNativeUpdateConfirmation,
  normalizeNativeUpdateRunOutcome,
  projectUpdateRun,
  reconcileNativeDoctorMutation,
  verifyFreshRestartState,
  verifyFreshUpdateState
} from "@/lib/openclaw/application/native-doctor-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import type { OpenClawCapabilityMatrix } from "@/lib/openclaw/types";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";

function createAdapter(overrides: Partial<OpenClawAdapter> = {}) {
  return {
    async getNativeHealth() {
      return { ok: true };
    },
    async getNativeStatus() {
      return {};
    },
    async getDiagnosticsStability() {
      return { status: "stable", checksRun: 3, privatePath: "/should-not-be-returned" };
    },
    async getConfigSnapshot() {
      return {
        valid: true,
        configRevisionHash: "revision-1",
        appliedConfigHash: "revision-1"
      };
    },
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: null,
        effectiveChannel: "stable" as const
      };
    },
    getConnectionIdentity() {
      return {
        connectionId: "connection-1",
        client: {
          async getOperatorIdentity() {
            return {
              requestedRole: "operator",
              role: "operator",
              requestedScopes: ["operator.admin", "operator.read"],
              grantedScopes: ["operator.admin", "operator.read"],
              grantedScopesKnown: true,
              deviceId: "device",
              connectionId: "connection-1",
              authenticated: true,
              source: "native-handshake" as const
            };
          }
        }
      };
    },
    getNativeConnectionGeneration() {
      return 1;
    },
    ...overrides
  } as unknown as OpenClawAdapter;
}

test("native Doctor keeps config application and runtime health truthful", async () => {
  const snapshot = await getNativeDoctorSnapshot({ adapter: createAdapter() });

  assert.equal(snapshot.runtime.status, "healthy");
  assert.equal(snapshot.config.application, "applied");
  assert.equal(snapshot.update.status, "current");
  assert.equal(snapshot.identity.connectionId, "connection-1");
  assert.equal(snapshot.diagnostics.stability?.privatePath, undefined);
});

test("native Doctor projects bounded durable update runs without origin or runtime-sensitive fields", () => {
  const projected = projectUpdateRun({
    runId: "run-9-2",
    createdAtMs: 1,
    updatedAtMs: 2,
    trigger: "control-ui",
    phase: "restarting",
    status: "running",
    reason: "token=do-not-leak",
    origin: { sessionKey: "private-session", requester: { accountId: "private-user" } },
    target: { version: "2026.9.2", sha: "target-sha" },
    before: { version: "2026.9.1", buildId: "old-build" },
    steps: [{ step: "restart", status: "in_progress", detail: "Authorization token=secret" }],
    verification: { runningVersion: "2026.9.1", pid: 1234, port: 18789, versionMatch: false },
    finishedAtMs: null
  });

  assert.equal(projected?.runId, "run-9-2");
  assert.equal(projected?.phase, "restarting");
  assert.equal(projected?.targetVersion, "2026.9.2");
  assert.equal(projected?.beforeVersion, "2026.9.1");
  assert.equal(projected?.verification?.versionMatch, false);
  assert.equal("origin" in (projected ?? {}), false);
  assert.equal("pid" in (projected?.verification ?? {}), false);
  assert.doesNotMatch(projected?.reason ?? "", /token=do-not-leak/);
});

test("native Doctor exposes active and last durable update runs from update.status", async () => {
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeUpdateStatus() {
        return {
          sentinel: null,
          updateAvailable: { currentVersion: "2026.9.1", latestVersion: "2026.9.2" },
          effectiveChannel: "stable" as const,
          activeRun: {
            runId: "active",
            createdAtMs: 1,
            updatedAtMs: 2,
            trigger: "control-ui",
            phase: "verifying",
            status: "running",
            reason: null
          },
          lastRun: {
            runId: "last",
            createdAtMs: 1,
            updatedAtMs: 3,
            trigger: "cli",
            phase: "finished",
            status: "succeeded",
            reason: null,
            finishedAtMs: 3
          }
        };
      }
    })
  });

  assert.equal(snapshot.update.activeRun?.runId, "active");
  assert.equal(snapshot.update.activeRun?.phase, "verifying");
  assert.equal(snapshot.update.lastRun?.runId, "last");
  assert.equal(snapshot.update.lastRun?.status, "succeeded");
});

test("native Doctor keeps status separate and sends probe only when requested", async () => {
  let probe: boolean | undefined;
  let refreshCheckout: boolean | undefined;
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth(options) {
        probe = options?.probe;
        return { ok: true };
      },
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1", gateway: { reachable: true, mode: "local" } };
      },
      async getNativeUpdateStatus(options) {
        refreshCheckout = options?.refreshCheckout;
        return { sentinel: null, updateAvailable: null, effectiveChannel: "stable" as const };
      }
    }),
    probe: true,
    refreshCheckout: true
  });

  assert.equal(probe, true);
  assert.equal(snapshot.status.runtimeVersion, "2026.9.1");
  assert.equal(snapshot.status.gatewayReachable, true);
  assert.equal(snapshot.status.gatewayMode, "local");
  assert.equal(refreshCheckout, true);
});

test("native Doctor records a read-only update target when Gateway status omits it", async () => {
  let fallbackCount = 0;
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getConnectionIdentity() {
        return {
          connectionId: "connection-fallback",
          client: {
            async getOperatorIdentity() {
              return {
                requestedRole: "operator",
                role: "operator",
                requestedScopes: ["operator.admin", "operator.read"],
                grantedScopes: ["operator.admin", "operator.read"],
                grantedScopesKnown: true,
                deviceId: "device",
                connectionId: "connection-fallback",
                authenticated: true,
                source: "native-handshake" as const
              };
            },
            getDiagnostics() {
              return { fallbackCounts: { "update.status": fallbackCount } };
            }
          } as unknown as OpenClawGatewayClient
        };
      },
      async getUpdateStatus() {
        fallbackCount += 1;
        return { latestVersion: "2026.9.4" };
      }
    })
  });

  assert.equal(snapshot.update.status, "current");
  assert.equal(snapshot.update.latestVersion, null);
  assert.equal(snapshot.update.discoveredAvailableVersion, "2026.9.4");
  assert.equal(snapshot.update.availabilitySource, "openclaw-cli-fallback");
  assert.equal(buildNativeDoctorConfirmation(snapshot).availableVersion, null);
});

test("config revision mismatch is restart-required, not silently applied", async () => {
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getConfigSnapshot() {
        return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
      }
    })
  });

  assert.equal(snapshot.config.application, "restart-required");
});

test("native read failures become unknown while unsupported native methods are unavailable", async () => {
  const unknown = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth() {
        throw new Error("Gateway timed out");
      }
    })
  });
  assert.equal(unknown.runtime.status, "unknown");
  assert.equal(unknown.runtime.reachable, null);

  const unavailable = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth() {
        throw new NativeGatewayError("method unsupported", { kind: "unsupported" });
      }
    })
  });
  assert.equal(unavailable.runtime.status, "unavailable");
  assert.equal(unavailable.runtime.reachable, false);
});

test("Doctor keeps read-only surfaces when update.status is forbidden", async () => {
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getConnectionIdentity() {
        return {
          connectionId: "connection-read-only",
          client: {
            async getOperatorIdentity() {
              return {
                requestedRole: "operator",
                role: "operator",
                requestedScopes: ["operator.read"],
                grantedScopes: ["operator.read"],
                grantedScopesKnown: true,
                deviceId: "device",
                connectionId: "connection-read-only",
                authenticated: true,
                source: "native-handshake" as const
              };
            }
          } as OpenClawGatewayClient
        };
      },
      async getNativeUpdateStatus() {
        throw new Error("update.status must not be called without operator.admin");
      }
    })
  });

  assert.equal(snapshot.runtime.status, "healthy");
  assert.equal(snapshot.update.readStatus, "forbidden");
  assert.equal(snapshot.update.status, "unavailable");
});

test("native mutation routing does not retry or use a CLI fallback", async () => {
  const calls: string[] = [];
  const adapter = createAdapter({
    async requestNativeGatewayRestart(input) {
      calls.push(`restart:${input?.skipDeferral === false ? "safe" : "unsafe"}`);
      return { ok: true, status: "accepted" };
    },
    async runNativeUpdate() {
      calls.push("update.run");
      return { ok: true, result: { status: "skipped", reason: "restart-unavailable" }, restart: null, handoff: null };
    }
  });

  const restart = await executeNativeDoctorMutation({
    action: "gateway.restart.request",
    input: { reason: "operator recovery", skipDeferral: false }
  }, { adapter });
  const update = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });

  assert.equal(restart.outcome, "accepted");
  assert.equal(update.outcome, "skipped");
  assert.deepEqual(calls, ["restart:safe", "update.run"]);
});

test("native update result status wins over successful RPC transport", () => {
  const skipped = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "skipped", reason: "external-supervisor-update-required" },
    restart: null,
    handoff: null
  });
  const failed = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "error", reason: "restart-disabled" },
    restart: null,
    handoff: null
  });
  const succeeded = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "ok" },
    restart: null,
    handoff: null
  });

  assert.equal(skipped.outcome, "skipped");
  assert.equal(failed.outcome, "failed");
  assert.equal(succeeded.outcome, "succeeded");
});

test("unknown Doctor mutation outcomes are audited as unknown", () => {
  assert.equal(auditResultForNativeDoctorMutation("unknown"), "unknown");
  assert.equal(auditResultForNativeDoctorMutation("failed"), "failed");
  assert.equal(auditResultForNativeDoctorMutation("skipped"), "succeeded");
  assert.equal(auditResultForNativeDoctorMutation("succeeded", "unknown"), "unknown");
  assert.equal(auditResultForNativeDoctorMutation("accepted", "verified"), "succeeded");
  assert.equal(auditResultForNativeDoctorMutation("skipped", "not-required"), "unknown");
});

test("accepted restart becomes verified only after a fresh native generation", async () => {
  let generation = 1;
  let subscriptionClosed = false;
  const adapter = createAdapter({
    getNativeConnectionGeneration() {
      return generation;
    },
    async requestNativeGatewayRestart() {
      return { ok: true, status: "scheduled" };
    },
    async subscribeNativeRuntimeEvents(_input, callbacks) {
      assert.equal(this.getNativeConnectionGeneration?.(), generation);
      generation = 2;
      await callbacks.onReconnected?.({ generation });
      return {
        reconnectManagedByClient: true,
        close() {
          subscriptionClosed = true;
        }
      };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "gateway.restart.request" }, { adapter });
  assert.equal(mutation.outcome, "accepted");
  assert.equal(mutation.verification.status, "not-required");

  const reconciled = await reconcileNativeDoctorMutation(mutation, { before, adapter });
  assert.equal(reconciled.verification.status, "verified");
  assert.equal(reconciled.reconciliation, "confirmed");
  assert.equal(subscriptionClosed, true);
});

test("accepted update without a fresh Gateway reconnect remains unverified and is never replayed", async () => {
  let updateCalls = 0;
  const adapter = createAdapter({
    async runNativeUpdate() {
      updateCalls += 1;
      return { ok: true, result: { status: "ok" }, restart: { status: "accepted" } };
    },
    async subscribeNativeRuntimeEvents() {
      return { reconnectManagedByClient: false, close() {} };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });
  const reconciled = await reconcileNativeDoctorMutation(mutation, { before, adapter });

  assert.equal(mutation.outcome, "accepted");
  assert.equal(reconciled.outcome, "accepted");
  assert.equal(reconciled.verification.status, "unknown");
  assert.match(reconciled.message, /did not observe a fresh reconnect generation/i);
  assert.equal(updateCalls, 1);
});

test("native update failure is reported before reconnect verification and is never replayed", async () => {
  let updateCalls = 0;
  let exposeFailedRun = false;
  const adapter = createAdapter({
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: { currentVersion: "2026.9.4", latestVersion: "2026.9.7" },
        effectiveChannel: "stable" as const,
        ...(exposeFailedRun ? {
          lastRun: {
            runId: "failed-update-run",
            createdAtMs: 100,
            updatedAtMs: 200,
            finishedAtMs: 200,
            trigger: "api" as const,
            phase: "finished" as const,
            status: "failed" as const,
            reason: "global-install-failed",
            target: { version: "2026.9.7" },
            before: { version: "2026.9.4" },
            after: { version: "2026.9.4" },
            steps: [{ step: "validating", status: "failed", detail: "Package rollback launcher backup changed." }]
          }
        } : {})
      };
    },
    async runNativeUpdate() {
      updateCalls += 1;
      exposeFailedRun = true;
      return { ok: true, result: { status: "ok" }, restart: { status: "accepted" } };
    },
    async subscribeNativeRuntimeEvents() {
      return { reconnectManagedByClient: false, close() {} };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });
  const reconciled = await reconcileNativeDoctorMutation(mutation, { before, adapter });

  assert.equal(reconciled.outcome, "failed");
  assert.equal(reconciled.verification.status, "unknown");
  assert.match(reconciled.message, /failed for v2026\.9\.7 during package validation/i);
  assert.match(reconciled.message, /global-install-failed/i);
  assert.match(reconciled.message, /rollback launcher backup changed/i);
  assert.match(reconciled.verification.message, /did not observe a fresh Gateway reconnect/i);
  assert.equal(updateCalls, 1);
});

test("a previously recorded native failure is not attributed to a later update request", async () => {
  const adapter = createAdapter({
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: { currentVersion: "2026.9.4", latestVersion: "2026.9.7" },
        effectiveChannel: "stable" as const,
        lastRun: {
          runId: "previous-failed-run",
          createdAtMs: 100,
          updatedAtMs: 200,
          finishedAtMs: 200,
          trigger: "api" as const,
          phase: "finished" as const,
          status: "failed" as const,
          reason: "previous-attempt-failed",
          target: { version: "2026.9.7" }
        }
      };
    },
    async runNativeUpdate() {
      return { ok: true, result: { status: "ok" }, restart: { status: "accepted" } };
    },
    async subscribeNativeRuntimeEvents() {
      return { reconnectManagedByClient: false, close() {} };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });
  const reconciled = await reconcileNativeDoctorMutation(mutation, { before, adapter });

  assert.equal(reconciled.outcome, "accepted");
  assert.equal(reconciled.verification.status, "unknown");
  assert.match(reconciled.message, /did not observe a fresh reconnect generation/i);
});

test("ambiguous update transport reconnects and verifies native truth without retrying update.run", async () => {
  let generation = 1;
  let installedTarget = false;
  let updateCalls = 0;
  const adapter = createAdapter({
    getNativeConnectionGeneration() { return generation; },
    getConnectionIdentity() {
      return {
        connectionId: `connection-${generation}`,
        client: {
          async getOperatorIdentity() {
            return {
              requestedRole: "operator",
              role: "operator",
              requestedScopes: ["operator.admin", "operator.read"],
              grantedScopes: ["operator.admin", "operator.read"],
              grantedScopesKnown: true,
              deviceId: "device",
              connectionId: `connection-${generation}`,
              authenticated: true,
              source: "native-handshake" as const
            };
          }
        } as OpenClawGatewayClient
      };
    },
    async getNativeStatus() {
      return { runtimeVersion: installedTarget ? "2026.9.8" : "2026.9.7", version: installedTarget ? "2026.9.8" : "2026.9.7" };
    },
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: installedTarget ? null : { currentVersion: "2026.9.7", latestVersion: "2026.9.8" },
        effectiveChannel: "stable" as const
      };
    },
    async runNativeUpdate() {
      updateCalls += 1;
      throw new Error("Gateway disconnected after the native request was sent");
    },
    async subscribeNativeRuntimeEvents(_input, callbacks) {
      installedTarget = true;
      generation = 2;
      await callbacks.onReconnected?.({ generation });
      return { reconnectManagedByClient: true, close() {} };
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });
  assert.equal(mutation.outcome, "unknown");

  const reconciled = await reconcileNativeDoctorMutation(mutation, {
    before,
    adapter,
    getCapabilityMatrix: async () => postUpdateCapabilities()
  });

  assert.equal(reconciled.outcome, "succeeded");
  assert.equal(reconciled.verification.status, "verified");
  assert.equal(reconciled.verification.connectionGeneration, 2);
  assert.equal(updateCalls, 1);
});

test("ambiguous update reconciles a Gateway that reconnected before the listener was attached", async () => {
  let generation = 1;
  let installedTarget = false;
  let updateCalls = 0;
  let subscribeCalls = 0;
  const adapter = createAdapter({
    getNativeConnectionGeneration() { return generation; },
    getConnectionIdentity() {
      return {
        connectionId: `connection-${generation}`,
        client: {
          async getOperatorIdentity() {
            return {
              requestedRole: "operator",
              role: "operator",
              requestedScopes: ["operator.admin", "operator.read"],
              grantedScopes: ["operator.admin", "operator.read"],
              grantedScopesKnown: true,
              deviceId: "device",
              connectionId: `connection-${generation}`,
              authenticated: true,
              source: "native-handshake" as const
            };
          }
        } as OpenClawGatewayClient
      };
    },
    async getNativeStatus() {
      const version = installedTarget ? "2026.9.8" : "2026.9.7";
      return { runtimeVersion: version, version };
    },
    async getNativeUpdateStatus() {
      return {
        sentinel: null,
        updateAvailable: installedTarget ? null : { currentVersion: "2026.9.7", latestVersion: "2026.9.8" },
        effectiveChannel: "stable" as const
      };
    },
    async runNativeUpdate() {
      updateCalls += 1;
      installedTarget = true;
      generation = 2;
      throw new Error("Gateway reconnected before the update request returned");
    },
    async subscribeNativeRuntimeEvents() {
      subscribeCalls += 1;
      throw new Error("A completed reconnect should be reconciled without a new subscription");
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const mutation = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });
  const reconciled = await reconcileNativeDoctorMutation(mutation, {
    before,
    adapter,
    getCapabilityMatrix: async () => postUpdateCapabilities()
  });

  assert.equal(reconciled.outcome, "succeeded");
  assert.equal(reconciled.verification.status, "verified");
  assert.equal(reconciled.verification.connectionGeneration, 2);
  assert.equal(updateCalls, 1);
  assert.equal(subscribeCalls, 0);
});

test("restart verification rejects the old generation and a different native identity", async () => {
  const before = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; }
  }) });
  const oldState = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; }
  }) });
  assert.equal(verifyFreshRestartState(before, oldState, 1).status, "unknown");

  const differentIdentity = {
    ...oldState,
    identity: { ...oldState.identity, deviceId: "different-device" }
  };
  assert.equal(verifyFreshRestartState(before, differentIdentity, 2).status, "unknown");
});

test("restart verification requires matching config hashes when config applied restart was the reason", async () => {
  const before = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 1; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
    }
  }) });
  const afterApplied = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 2; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-2" };
    }
  }) });
  const afterMismatch = await getNativeDoctorSnapshot({ adapter: createAdapter({
    getNativeConnectionGeneration() { return 2; },
    async getConfigSnapshot() {
      return { valid: true, configRevisionHash: "revision-2", appliedConfigHash: "revision-1" };
    }
  }) });

  assert.equal(verifyFreshRestartState(before, afterApplied, 2).status, "verified");
  assert.equal(verifyFreshRestartState(before, afterMismatch, 2).status, "unknown");
});

test("skipped and failed native updates do not enter reconnect verification", async () => {
  let subscribed = false;
  const adapter = createAdapter({
    async subscribeNativeRuntimeEvents() {
      subscribed = true;
      throw new Error("skipped update must not subscribe");
    }
  });
  const before = await getNativeDoctorSnapshot({ adapter });
  const skipped = normalizeNativeUpdateRunOutcome({
    ok: true,
    result: { status: "skipped", reason: "restart-disabled" },
    restart: null
  });
  const failed = normalizeNativeUpdateRunOutcome({
    ok: false,
    result: { status: "error", reason: "not-openclaw-root" },
    restart: null
  });
  assert.equal((await reconcileNativeDoctorMutation(skipped, { before, adapter })).outcome, "skipped");
  assert.equal((await reconcileNativeDoctorMutation(failed, { before, adapter })).outcome, "failed");
  assert.equal(subscribed, false);
});

test("ambiguous native mutations are surfaced without a blind retry", async () => {
  let calls = 0;
  const result = await executeNativeDoctorMutation(
    { action: "update.hold" },
    {
      adapter: createAdapter({
        async holdNativeUpdate() {
          calls += 1;
          throw new Error("request timed out after send");
        }
      })
    }
  );

  assert.equal(result.outcome, "unknown");
  assert.equal(calls, 1);
  assert.equal(result.reconciliation, "inconclusive");
});

test("AgentOS admits only one simultaneous native update.run request", () => {
  const releaseFirst = claimNativeUpdateRunAdmission();
  assert.equal(typeof releaseFirst, "function");
  assert.equal(claimNativeUpdateRunAdmission(), null);
  releaseFirst?.();
  releaseFirst?.();
  const releaseNext = claimNativeUpdateRunAdmission();
  assert.equal(typeof releaseNext, "function");
  releaseNext?.();
});

test("confirmation is tied to the current native connection and channel", () => {
  const confirmation = (overrides: Partial<ReturnType<typeof buildNativeDoctorConfirmation>> = {}) => ({
    challengeId: null,
    connectionId: "connection-1",
    deviceId: "device",
    connectionGeneration: 4,
    currentVersion: "2026.9.1",
    effectiveChannel: "stable",
    availableVersion: "2026.9.2",
    updateReadStatus: "available" as const,
    updateStatus: "available" as const,
    updateAvailable: true,
    availabilitySource: "native-gateway" as const,
    authenticated: true,
    grantedScopesKnown: true,
    updateAuthorized: true,
    runtimeStatus: "healthy" as const,
    statusReadStatus: "available" as const,
    configReadStatus: "available" as const,
    configValid: true,
    configApplication: "applied" as const,
    configuredRevisionHash: "revision-1",
    appliedRevisionHash: "revision-1",
    recoveryStatus: "healthy" as const,
    agentOsVersion: "0.7.2",
    compatibilityStatus: "unknown" as const,
    compatibilityAllowed: false,
    requiresAgentOsUpdate: false,
    minRequiredAgentOsVersion: null,
    ...overrides
  });
  assert.equal(
    confirmationMatches(
      confirmation(),
      confirmation()
    ),
    true
  );
  assert.equal(
    confirmationMatches(
      confirmation({ deviceId: null }),
      confirmation({ deviceId: null })
    ),
    true
  );
  assert.equal(
    confirmationMatches(
      confirmation({ deviceId: null }),
      confirmation({ deviceId: "device" })
    ),
    false
  );
  assert.equal(
    confirmationMatches(
      confirmation(),
      confirmation({ connectionId: "connection-2" })
    ),
    false
  );
  assert.equal(
    confirmationMatches(
      confirmation(),
      confirmation({ availableVersion: "2026.9.3" })
    ),
    false
  );
  for (const changedFact of [
    { connectionGeneration: 5 },
    { currentVersion: "2026.9.2" },
    { effectiveChannel: "beta" },
    { agentOsVersion: "0.7.3" },
    { compatibilityStatus: "blocked" as const },
    { updateAvailable: false },
    { configuredRevisionHash: "revision-2" }
  ]) {
    assert.equal(confirmationMatches(confirmation(), confirmation(changedFact)), false);
  }
});

test("native update confirmation challenges are actor-bound, fact-bound, expiring, and one-use", () => {
  const facts = {
    challengeId: null,
    connectionId: "connection-1",
    deviceId: "device",
    connectionGeneration: 4,
    currentVersion: "2026.9.1",
    effectiveChannel: "stable",
    availableVersion: "2026.9.2",
    updateReadStatus: "available" as const,
    updateStatus: "available" as const,
    updateAvailable: true,
    availabilitySource: "native-gateway" as const,
    authenticated: true,
    grantedScopesKnown: true,
    updateAuthorized: true,
    runtimeStatus: "healthy" as const,
    statusReadStatus: "available" as const,
    configReadStatus: "available" as const,
    configValid: true,
    configApplication: "applied" as const,
    configuredRevisionHash: "revision-1",
    appliedRevisionHash: "revision-1",
    recoveryStatus: "healthy" as const,
    agentOsVersion: "0.7.2",
    compatibilityStatus: "unknown" as const,
    compatibilityAllowed: false,
    requiresAgentOsUpdate: false,
    minRequiredAgentOsVersion: null
  } satisfies ReturnType<typeof buildNativeDoctorConfirmation>;

  const actorBound = issueNativeUpdateConfirmation(facts, "owner-1", 1_000);
  assert.match(actorBound.challengeId ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(consumeNativeUpdateConfirmation(actorBound, "owner-2", facts, 1_001), false);
  assert.equal(consumeNativeUpdateConfirmation(actorBound, "owner-1", facts, 1_002), true);

  const factBound = issueNativeUpdateConfirmation(facts, "owner-1", 2_000);
  assert.equal(consumeNativeUpdateConfirmation(
    factBound,
    "owner-1",
    { ...facts, availableVersion: "2026.9.3" },
    2_001
  ), false);

  const expires = issueNativeUpdateConfirmation(facts, "owner-1", 3_000);
  assert.equal(consumeNativeUpdateConfirmation(expires, "owner-1", facts, 124_000), false);

  const oneUse = issueNativeUpdateConfirmation(facts, "owner-1", 4_000);
  assert.equal(consumeNativeUpdateConfirmation(oneUse, "owner-1", facts, 4_001), true);
  assert.equal(consumeNativeUpdateConfirmation(oneUse, "owner-1", facts, 4_002), false);
});

test("fresh native update verification rejects a version mismatch", async () => {
  const before = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1" };
      },
      async getNativeUpdateStatus() {
        return {
          sentinel: null,
          updateAvailable: {
            currentVersion: "2026.9.1",
            latestVersion: "2026.9.2",
            channel: "stable"
          },
          effectiveChannel: "stable" as const
        };
      }
    })
  });
  const after = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getNativeConnectionGeneration() { return 2; },
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1" };
      }
    })
  });

  assert.equal(verifyFreshUpdateState(before, after, 2, postUpdateCapabilities()).status, "unknown");

  const verifiedAfter = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getNativeConnectionGeneration() { return 2; },
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.2" };
      }
    })
  });
  assert.equal(verifyFreshUpdateState(before, verifiedAfter, 2, postUpdateCapabilities()).status, "verified");
});

test("update reconnect is not success without a target, native terminal state, or current capabilities", async () => {
  const before = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() { return { runtimeVersion: "2026.9.1" }; },
      async getNativeUpdateStatus() {
        return { sentinel: null, updateAvailable: { currentVersion: "2026.9.1", latestVersion: "2026.9.2" }, effectiveChannel: "stable" as const };
      }
    })
  });
  const afterAvailable = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getNativeConnectionGeneration() { return 2; },
      async getNativeStatus() { return { runtimeVersion: "2026.9.2" }; },
      async getNativeUpdateStatus() {
        return {
          sentinel: null,
          updateAvailable: { currentVersion: "2026.9.2", latestVersion: "2026.9.3" },
          effectiveChannel: "stable" as const,
          lastRun: {
            runId: "run-1",
            createdAtMs: 1,
            updatedAtMs: 2,
            trigger: "control-ui",
            phase: "finished",
            status: "succeeded",
            target: { version: "2026.9.2" },
            finishedAtMs: 2
          }
        } as never;
      }
    })
  });

  assert.equal(verifyFreshUpdateState(before, afterAvailable, 2, postUpdateCapabilities()).status, "verified");
  assert.equal(verifyFreshUpdateState(before, afterAvailable, 2, null).status, "unknown");

  const missingLedger = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getNativeConnectionGeneration() { return 2; },
      async getNativeStatus() { return { runtimeVersion: "2026.9.2" }; },
      async getNativeUpdateStatus() {
        return {
          sentinel: null,
          updateAvailable: { currentVersion: "2026.9.2", latestVersion: "2026.9.3" },
          effectiveChannel: "stable"
        };
      }
    })
  });
  assert.equal(verifyFreshUpdateState(before, missingLedger, 2, postUpdateCapabilities()).status, "unknown");
});

test("fresh update verification requires the native contract and authorization evidence", async () => {
  const before = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeStatus() { return { runtimeVersion: "2026.9.1" }; },
      async getNativeUpdateStatus() {
        return { sentinel: null, updateAvailable: { currentVersion: "2026.9.1", latestVersion: "2026.9.2" }, effectiveChannel: "stable" as const };
      }
    })
  });
  const after = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      getNativeConnectionGeneration() { return 2; },
      async getNativeStatus() { return { runtimeVersion: "2026.9.2" }; }
    })
  });

  assert.equal(verifyFreshUpdateState(before, after, 2, {
    ...postUpdateCapabilities(),
    compatibility: {
      protocol: { status: "compatible" },
      methodContract: { status: "drift", missingRequiredMethods: [] }
    }
  } as never).status, "unknown");
  assert.equal(verifyFreshUpdateState(before, after, 2, {
    ...postUpdateCapabilities(),
    authScopes: ["operator.read"]
  } as never).status, "unknown");
});

function postUpdateCapabilities() {
  return {
    supportedMethods: ["sessions.list", "sessions.get", "sessions.send", "agent.wait"],
    authScopes: ["operator.admin"],
    updates: "supported",
    compatibility: {
      protocol: { status: "compatible" },
      methodContract: { status: "advertised", missingRequiredMethods: [] }
    }
  } as unknown as OpenClawCapabilityMatrix;
}
