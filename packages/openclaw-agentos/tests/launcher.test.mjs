import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  buildAgentOsDoctorArgs,
  buildAgentOsStartArgs,
  buildAgentOsStatusArgs,
  resolveAgentOsTarget,
  runAgentOsCommand
} from "../dist/launcher.js";

test("builds only the supported AgentOS start arguments", () => {
  assert.deepEqual(buildAgentOsStartArgs({ port: "3100", host: "127.0.0.1", plain: true }, true), [
    "start",
    "--port",
    "3100",
    "--host",
    "127.0.0.1",
    "--open",
    "--plain"
  ]);
});

test("builds status and doctor arguments without arbitrary passthrough", () => {
  assert.deepEqual(buildAgentOsStatusArgs({ port: "3100", host: "localhost" }), [
    "status",
    "--port",
    "3100",
    "--host",
    "localhost"
  ]);
  assert.deepEqual(buildAgentOsDoctorArgs({ deep: true, json: true, port: "3100" }), [
    "doctor",
    "--deep",
    "--json",
    "--port",
    "3100"
  ]);
});

test("requires an absolute usable executable for AGENTOS_BIN", () => {
  assert.equal(resolveAgentOsTarget({ AGENTOS_BIN: "agentos", PATH: "" }), null);
});

test("delegates to an explicit AgentOS executable and propagates its exit code", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agentos-plugin-test-"));
  const fakeAgentOs = path.join(tempDir, "agentos");

  writeFileSync(
    fakeAgentOs,
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`,
    { mode: 0o700 }
  );
  chmodSync(fakeAgentOs, 0o700);

  try {
    const exitCode = await runAgentOsCommand(["status", "--port", "3100"], {
      AGENTOS_BIN: fakeAgentOs,
      PATH: ""
    });

    assert.equal(exitCode, 7);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
