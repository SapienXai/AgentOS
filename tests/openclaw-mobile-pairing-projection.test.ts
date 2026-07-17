import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeOpenClawMobileSetupCode } from "@/lib/openclaw/mobile-pairing-projection";

test("decodes short-lived OpenClaw setup data for Android manual pairing", () => {
  const setupCode = encodeSetupCode({
    url: "ws://192.168.1.154:18789",
    bootstrapToken: "temporary-pairing-token",
    expiresAtMs: 1_800_000_000_000
  });

  assert.deepEqual(decodeOpenClawMobileSetupCode(setupCode), {
    host: "192.168.1.154",
    port: 18789,
    secure: false,
    pairingToken: "temporary-pairing-token",
    expiresAtMs: 1_800_000_000_000
  });
});

test("supports secure default ports and the legacy token field", () => {
  const setupCode = encodeSetupCode({ url: "wss://gateway.example.test", token: "temporary-token" });

  assert.deepEqual(decodeOpenClawMobileSetupCode(setupCode), {
    host: "gateway.example.test",
    port: 443,
    secure: true,
    pairingToken: "temporary-token",
    expiresAtMs: null
  });
});

test("rejects malformed or credential-bearing setup URLs", () => {
  assert.equal(decodeOpenClawMobileSetupCode("not-a-valid-payload"), null);
  assert.equal(decodeOpenClawMobileSetupCode(encodeSetupCode({
    url: "ws://user:password@192.168.1.154:18789",
    bootstrapToken: "temporary-token"
  })), null);
});

function encodeSetupCode(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
