import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confirmationMatches,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot
} from "@/lib/openclaw/application/native-doctor-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
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
              requestedScopes: ["operator.read"],
              grantedScopes: ["operator.read"],
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

test("native Doctor keeps status separate and sends probe only when requested", async () => {
  let probe: boolean | undefined;
  const snapshot = await getNativeDoctorSnapshot({
    adapter: createAdapter({
      async getNativeHealth(options) {
        probe = options?.probe;
        return { ok: true };
      },
      async getNativeStatus() {
        return { runtimeVersion: "2026.9.1", gateway: { reachable: true, mode: "local" } };
      }
    }),
    probe: true
  });

  assert.equal(probe, true);
  assert.equal(snapshot.status.runtimeVersion, "2026.9.1");
  assert.equal(snapshot.status.gatewayReachable, true);
  assert.equal(snapshot.status.gatewayMode, "local");
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

test("native mutation routing does not retry or use a CLI fallback", async () => {
  const calls: string[] = [];
  const adapter = createAdapter({
    async requestNativeGatewayRestart(input) {
      calls.push(`restart:${input?.skipDeferral === false ? "safe" : "unsafe"}`);
      return { ok: true, status: "accepted" };
    },
    async runNativeUpdate() {
      calls.push("update.run");
      return { status: "skipped", reason: "restart-unavailable" };
    }
  });

  const restart = await executeNativeDoctorMutation({
    action: "gateway.restart.request",
    input: { reason: "operator recovery", skipDeferral: false }
  }, { adapter });
  const update = await executeNativeDoctorMutation({ action: "update.run" }, { adapter });

  assert.equal(restart.outcome, "accepted");
  assert.equal(update.outcome, "succeeded");
  assert.deepEqual(calls, ["restart:safe", "update.run"]);
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

test("confirmation is tied to the current native connection and channel", () => {
  assert.equal(
    confirmationMatches(
      { connectionId: "connection-1", effectiveChannel: "stable" },
      { connectionId: "connection-1", effectiveChannel: "stable" }
    ),
    true
  );
  assert.equal(
    confirmationMatches(
      { connectionId: "connection-1", effectiveChannel: "stable" },
      { connectionId: "connection-2", effectiveChannel: "stable" }
    ),
    false
  );
});
