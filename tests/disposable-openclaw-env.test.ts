import assert from "node:assert/strict";
import { test } from "node:test";

import { createDisposableOpenClawEnvironment } from "@/scripts/lib/disposable-openclaw-env";

test("disposable OpenClaw environments omit host credentials and test-mode overrides", () => {
  const previous = {
    openAiKey: process.env.OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV,
    vitest: process.env.VITEST,
    home: process.env.HOME,
    path: process.env.PATH
  };
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  mutableEnvironment.OPENAI_API_KEY = "host-secret-fixture";
  mutableEnvironment.NODE_ENV = "test";
  mutableEnvironment.VITEST = "1";
  mutableEnvironment.HOME = "/host/home";

  try {
    const environment = createDisposableOpenClawEnvironment({
      homeDir: "/tmp/openclaw-certification-home",
      overrides: { OPENCLAW_GATEWAY_TOKEN: "disposable-token" }
    });
    assert.equal(environment.HOME, "/tmp/openclaw-certification-home");
    assert.equal(environment.OPENCLAW_GATEWAY_TOKEN, "disposable-token");
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.NODE_ENV, undefined);
    assert.equal(environment.VITEST, undefined);
    assert.equal(environment.PATH, previous.path);
  } finally {
    restoreEnvironment("OPENAI_API_KEY", previous.openAiKey);
    restoreEnvironment("NODE_ENV", previous.nodeEnv);
    restoreEnvironment("VITEST", previous.vitest);
    restoreEnvironment("HOME", previous.home);
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
