import assert from "node:assert/strict";
import { test } from "node:test";

import { getOpenClawChannelAuthentication } from "@/lib/openclaw/domains/channel-auth";

test("channel blueprint authentication metadata follows native OpenClaw setup semantics", () => {
  assert.deepEqual(getOpenClawChannelAuthentication("telegram"), {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  });
  assert.deepEqual(getOpenClawChannelAuthentication("whatsapp"), {
    authenticationKind: "qr-session",
    requiresCredentials: false,
    requiresAuthentication: true
  });
  assert.deepEqual(getOpenClawChannelAuthentication("slack"), {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  });
  assert.deepEqual(getOpenClawChannelAuthentication("discord"), {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  });
  assert.deepEqual(getOpenClawChannelAuthentication("googlechat"), {
    authenticationKind: "service-account",
    requiresCredentials: true,
    requiresAuthentication: true
  });
});
