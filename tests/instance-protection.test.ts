import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { NextRequest } from "next/server";

import {
  disableInstanceProtection,
  enableInstanceProtection,
  getInstanceProtectionStatus,
  loginToInstance,
  resetInstanceProtection,
  resolveInstanceProtectionPath,
  updateInstanceCredentials
} from "@/lib/security/instance-protection";
import { proxy } from "@/proxy";

test("instance protection lifecycle hashes credentials and invalidates old sessions", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-protection-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };

  assert.deepEqual(await getInstanceProtectionStatus(null, env), {
    protectionEnabled: false,
    authenticated: true,
    username: null,
    credentialConfigured: false
  });

  const enabled = await enableInstanceProtection({ username: "operator", password: "correct horse" }, env);
  assert.equal(enabled.status.authenticated, true);
  const storedText = await readFile(resolveInstanceProtectionPath(env), "utf8");
  assert.doesNotMatch(storedText, /correct horse/);
  assert.equal((await stat(resolveInstanceProtectionPath(env))).mode & 0o777, 0o600);

  await assert.rejects(
    loginToInstance({ username: "operator", password: "wrong password", rateKey: "wrong-1" }, env),
    /Invalid username or password/
  );
  const loggedIn = await loginToInstance({ username: "operator", password: "correct horse", rateKey: "right-1" }, env);
  assert.equal(loggedIn.status.authenticated, true);

  const updated = await updateInstanceCredentials({
    username: "owner",
    currentPassword: "correct horse",
    newPassword: "new secure password"
  }, env);
  assert.equal(updated.status.username, "owner");
  assert.equal((await getInstanceProtectionStatus(loggedIn.session, env)).authenticated, false);
  assert.equal((await getInstanceProtectionStatus(updated.session, env)).authenticated, true);

  await assert.rejects(
    loginToInstance({ username: "owner", password: "correct horse", rateKey: "old-password" }, env),
    /Invalid username or password/
  );
  await disableInstanceProtection("new secure password", env);
  assert.equal((await getInstanceProtectionStatus(null, env)).protectionEnabled, false);
});

test("repeated login failures are rate limited without identifying the wrong field", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-rate-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };
  await enableInstanceProtection({ username: "rate-owner", password: "secure password" }, env);
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      loginToInstance({ username: "rate-owner", password: `wrong-${index}`, rateKey: `spoofed-${index}` }, env),
      /Invalid username or password/
    );
  }
  await assert.rejects(
    loginToInstance({ username: "rate-owner", password: "secure password", rateKey: "new-spoof" }, env),
    /Too many login attempts/
  );
});

test("expired signed sessions are rejected", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-expiry-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };
  await enableInstanceProtection({ username: "operator", password: "secure password" }, env);
  const state = JSON.parse(await readFile(resolveInstanceProtectionPath(env), "utf8")) as {
    sessionSecret: string;
    sessionVersion: number;
  };
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1, version: state.sessionVersion, nonce: "expired" })).toString("base64url");
  const signature = createHmac("sha256", state.sessionSecret).update(payload).digest("base64url");
  assert.equal((await getInstanceProtectionStatus(`${payload}.${signature}`, env)).authenticated, false);
});

test("proxy protects UI, setup, and sensitive APIs while leaving auth endpoints reachable", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-proxy-"));
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    token: process.env.AGENTOS_API_TOKEN,
    nodeEnv: process.env.NODE_ENV
  };
  setEnv("AGENTOS_RUNTIME_DIR", runtimeDir);
  setEnv("AGENTOS_API_TOKEN", "test-api-token");
  setEnv("NODE_ENV", "production");

  try {
    await enableInstanceProtection({ username: "operator", password: "secure password" });
    const ui = await proxy(new NextRequest("http://localhost:3000/settings"));
    assert.equal(ui.status, 307);
    assert.match(ui.headers.get("location") ?? "", /\/login\?returnTo=%2Fsettings/);

    const setup = await proxy(new NextRequest("http://localhost:3000/api/onboarding", {
      headers: { authorization: "Bearer test-api-token" }
    }));
    assert.equal(setup.status, 401);
    assert.equal(setup.headers.get("x-agentos-auth-required"), "instance");

    const status = await proxy(new NextRequest("http://localhost:3000/api/auth/status", {
      headers: { authorization: "Bearer test-api-token" }
    }));
    assert.equal(status.status, 200);

    await writeFile(resolveInstanceProtectionPath(), "{corrupt", { mode: 0o600 });
    const failClosed = await proxy(new NextRequest("http://localhost:3000/api/snapshot", {
      headers: { authorization: "Bearer test-api-token" }
    }));
    assert.equal(failClosed.status, 503);
    assert.equal((await failClosed.json()).code, "instance-auth-unavailable");
  } finally {
    await resetInstanceProtection();
    restoreEnv("AGENTOS_RUNTIME_DIR", previous.runtime);
    restoreEnv("AGENTOS_API_TOKEN", previous.token);
    restoreEnv("NODE_ENV", previous.nodeEnv);
  }
});

test("agentos auth reset removes only the instance protection file", async () => {
  const installRoot = await mkdtemp(path.join(tmpdir(), "agentos-auth-reset-"));
  const protectionPath = path.join(installRoot, "instance-protection.json");
  const preservedPath = path.join(installRoot, "preserved.json");
  await writeFile(protectionPath, "credential", { mode: 0o600 });
  await writeFile(preservedPath, "workspace-data", { mode: 0o600 });

  const result = spawnSync(process.execPath, [path.join(process.cwd(), "packages/agentos/bin/agentos.js"), "auth", "reset"], {
    encoding: "utf8",
    env: { ...process.env, AGENTOS_INSTALL_ROOT: installRoot }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sessions were invalidated/);
  await assert.rejects(readFile(protectionPath, "utf8"), /ENOENT/);
  assert.equal(await readFile(preservedPath, "utf8"), "workspace-data");
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function setEnv(key: string, value: string) {
  process.env[key] = value;
}
