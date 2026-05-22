import assert from "node:assert/strict";
import { test } from "node:test";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import {
  buildGatewayAuthBlockedMessage,
  GatewayAuthSetupRecoveryError,
  resolveGatewayAuthSetupIssueFromSnapshot,
  runWithGatewayAuthSetupRecovery
} from "@/lib/openclaw/model-setup-recovery";

test("model setup recovery detects Gateway token mismatch from snapshot diagnostics", () => {
  const snapshot = createErrorSnapshot("Gateway unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: false
  });
  snapshot.diagnostics.transport = {
    mode: "native-ws",
    gatewayMode: "degraded",
    statusLabel: "degraded",
    recovery: "Check the OpenClaw Gateway token/password.",
    connectionState: "error",
    protocolVersion: null,
    protocolRange: {
      min: 1,
      max: 2
    },
    fallbackCounts: {},
    fallbackTotal: 1,
    recentFallbackDiagnostics: [],
    lastNativeError: "INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)",
    lastNativeFailureAt: new Date("2026-05-22T10:00:00.000Z").toISOString(),
    lastConnectedAt: null,
    lastDisconnectedAt: null
  };

  const issue = resolveGatewayAuthSetupIssueFromSnapshot(snapshot);

  assert.equal(issue?.kind, "gateway-token");
  assert.ok(issue);
  assert.match(buildGatewayAuthBlockedMessage(issue, "model setup"), /local Gateway token no longer matches OpenClaw/);
});

test("model setup recovery repairs Gateway auth and retries the model config mutation once", async () => {
  const statuses: string[] = [];
  const repairs: string[] = [];
  let attempts = 0;

  const result = await runWithGatewayAuthSetupRecovery(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("unauthorized: gateway token mismatch (provide gateway auth token)");
      }

      return "saved";
    },
    {
      operationLabel: "setting the default model",
      onStatus: (message) => {
        statuses.push(message);
      },
      repairGatewayAuth: async (kind) => {
        repairs.push(kind);
      }
    }
  );

  assert.equal(result.value, "saved");
  assert.equal(result.repaired?.kind, "gateway-token");
  assert.equal(attempts, 2);
  assert.deepEqual(repairs, ["gateway-token"]);
  assert.match(statuses.join("\n"), /Repairing the local Gateway token/);
  assert.match(statuses.join("\n"), /Retrying setting the default model/);
});

test("model setup recovery returns a clean message when Gateway auth repair fails", async () => {
  await assert.rejects(
    () => runWithGatewayAuthSetupRecovery(
      async () => {
        throw new Error("unauthorized: gateway token mismatch (provide gateway auth token)");
      },
      {
        operationLabel: "adding models",
        repairGatewayAuth: async () => {
          throw new Error("repair failed with token=query-secret");
        }
      }
    ),
    (error) => {
      assert.equal(error instanceof GatewayAuthSetupRecoveryError, true);
      assert.match((error as Error).message, /could not repair the local Gateway token/);
      assert.doesNotMatch((error as Error).message, /query-secret/);
      assert.match((error as Error).message, /Gateway reported a token mismatch/);
      return true;
    }
  );
});
