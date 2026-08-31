import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeOpenClawRuntimeCertificationArtifact,
  serializeOpenClawRuntimeCertificationArtifact
} from "@/lib/openclaw/runtime-certification/serialization";

test("runtime certification serialization redacts credentials and local paths", () => {
  const input = {
    token: "gateway-secret-value",
    provider: { apiKey: "provider-secret-value" },
    workspace: "/Users/example/private-workspace",
    sqlitePath: "/tmp/agentos-runtime/openclaw.sqlite",
    error: "authorization: Bearer gateway-secret-value token=another-secret"
  };
  const sanitized = sanitizeOpenClawRuntimeCertificationArtifact(input) as Record<string, unknown>;
  const serialized = serializeOpenClawRuntimeCertificationArtifact(input);

  assert.equal(sanitized.token, "[REDACTED]");
  assert.deepEqual(sanitized.provider, { apiKey: "[REDACTED]" });
  assert.equal(sanitized.workspace, "[LOCAL_PATH]");
  assert.equal(sanitized.sqlitePath, "[LOCAL_PATH]");
  assert.doesNotMatch(serialized, /gateway-secret-value|provider-secret-value|another-secret/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /\[LOCAL_PATH\]/);
});
