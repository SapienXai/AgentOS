import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { POST as loginRoute } from "@/app/api/auth/login/route";
import { GET as accessRoute, POST as changeAccessRoute } from "@/app/api/auth/access/route";
import { getLanHttpsOrigins } from "@/lib/security/remote-access-policy";
import { createManagedAgentOsUser } from "@/lib/agentos/application/agentos-account-service";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import { bootstrapInitialInstanceProtection } from "@/lib/security/initial-instance-bootstrap";
import {
  disableInstanceProtection,
  enableInstanceProtection,
  getInstanceProtectionStatus,
  lockInstance,
  loginToInstance,
  readInstanceProtectionState,
  resetInstanceProtection,
  resolveInstanceProtectionPath,
  signOutFromInstance,
  unlockLockedInstance,
  updateInstanceCredentials
} from "@/lib/security/instance-protection";
import { proxy } from "@/proxy";

test("deployment bootstrap creates Instance Protection once and removes the password from process state", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-bootstrap-"));
  const env = {
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    AGENTOS_INITIAL_ADMIN_USERNAME: "railway-owner",
    AGENTOS_INITIAL_ADMIN_PASSWORD: "initial secure password"
  };

  assert.deepEqual(await bootstrapInitialInstanceProtection(env), { status: "created" });
  assert.equal(env.AGENTOS_INITIAL_ADMIN_PASSWORD, undefined);

  const login = await loginToInstance({
    username: "railway-owner",
    password: "initial secure password",
    rateKey: "bootstrap-login"
  }, env);
  assert.equal(login.status.authenticated, true);

  env.AGENTOS_INITIAL_ADMIN_PASSWORD = "replacement password";
  assert.deepEqual(await bootstrapInitialInstanceProtection(env), { status: "already-configured" });
  assert.equal(env.AGENTOS_INITIAL_ADMIN_PASSWORD, undefined);
  await assert.rejects(
    loginToInstance({
      username: "railway-owner",
      password: "replacement password",
      rateKey: "bootstrap-replacement"
    }, env),
    /Invalid username or password/
  );
});

test("instance protection lifecycle hashes credentials and invalidates old sessions", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-protection-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };

  assert.deepEqual(await getInstanceProtectionStatus(null, env), {
    protectionEnabled: false,
    authenticated: true,
    username: null,
    credentialConfigured: false,
    locked: false
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

test("lock preserves the current account and blocks other login or API access until that account unlocks", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-lock-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  const enabled = await enableInstanceProtection({ username: "operator", password: "secure password" }, env);
  await createManagedAgentOsUser({ username: "member", password: "member password" }, env);

  await lockInstance(enabled.session, env);
  const locked = await getInstanceProtectionStatus(enabled.session, env);
  assert.deepEqual(
    { authenticated: locked.authenticated, locked: locked.locked, username: locked.username },
    { authenticated: false, locked: true, username: "operator" }
  );
  assert.equal(await resolveAgentOsActorContext(new Request("https://agentos.example.com/api/snapshot", {
    headers: { cookie: `agentos_instance_session=${enabled.session}` }
  }), env), null);

  await assert.rejects(
    loginToInstance({ username: "member", password: "member password", rateKey: "member" }, env),
    /AgentOS is locked/
  );
  await assert.rejects(
    unlockLockedInstance({ username: "member", password: "member password", rateKey: "member-unlock" }, env),
    /Invalid username or password/
  );
  await assert.rejects(
    unlockLockedInstance({ username: "operator", password: "definitely-not-the-password", rateKey: "operator-wrong-unlock" }, env),
    /Invalid username or password/
  );
  assert.equal((await getInstanceProtectionStatus(null, env)).locked, true);
  const unlocked = await unlockLockedInstance({ username: "operator", password: "secure password", rateKey: "operator-unlock" }, env);
  assert.equal(unlocked.status.authenticated, true);
  assert.equal(unlocked.status.locked, false);
  assert.equal((await getInstanceProtectionStatus(unlocked.session, env)).username, "operator");
});

test("sign out invalidates the current AgentOS account sessions without touching OpenClaw state", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-signout-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir };
  const enabled = await enableInstanceProtection({ username: "operator", password: "secure password" }, env);
  const before = await readInstanceProtectionState(env);

  await signOutFromInstance(enabled.session, env);

  assert.equal((await getInstanceProtectionStatus(enabled.session, env)).authenticated, false);
  assert.equal((await readInstanceProtectionState(env))?.actorId, before?.actorId);
  assert.equal(
    (await loginToInstance({ username: "operator", password: "secure password", rateKey: "signout-login" }, env)).status.authenticated,
    true
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
    const enabled = await enableInstanceProtection({ username: "operator", password: "secure password" });
    const ui = await proxy(new NextRequest("http://localhost:3000/settings"));
    assert.equal(ui.status, 307);
    assert.match(ui.headers.get("location") ?? "", /\/login\?returnTo=%2Fsettings/);

    const setup = await proxy(new NextRequest("http://localhost:3000/api/onboarding", {
      headers: { authorization: "Bearer test-api-token" }
    }));
    assert.equal(setup.status, 401);
    assert.equal(setup.headers.get("x-agentos-auth-required"), "instance");

    const status = await proxy(new NextRequest("http://localhost:3000/api/auth/status", {
      headers: { host: "localhost:3000" }
    }));
    assert.equal(status.status, 200);

    const login = await proxy(new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { host: "localhost:3000", origin: "http://localhost:3000" }
    }));
    assert.equal(login.status, 200);

    const health = await proxy(new NextRequest("http://healthcheck.railway.app/api/health"));
    assert.equal(health.status, 200);

    const sessionOnly = await proxy(new NextRequest("http://localhost:3000/api/snapshot", {
      headers: {
        cookie: `agentos_instance_session=${encodeURIComponent(enabled.session)}`,
        host: "localhost:3000"
      }
    }));
    assert.equal(sessionOnly.status, 200);

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

test("trusted remote browsers can use password sessions without API token bootstrap", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-instance-remote-"));
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    token: process.env.AGENTOS_API_TOKEN,
    trustedOrigins: process.env.AGENTOS_TRUSTED_OPERATOR_ORIGINS,
    nodeEnv: process.env.NODE_ENV
  };
  setEnv("AGENTOS_RUNTIME_DIR", runtimeDir);
  setEnv("AGENTOS_API_TOKEN", "test-api-token");
  setEnv("AGENTOS_TRUSTED_OPERATOR_ORIGINS", "https://agentos.example.com");
  setEnv("NODE_ENV", "production");

  try {
    await enableInstanceProtection({ username: "operator", password: "secure password" });
    const loginRequest = new NextRequest("https://agentos.example.com/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "agentos.example.com",
        origin: "https://agentos.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "agentos.example.com",
        "x-forwarded-proto": "https"
      },
      body: JSON.stringify({ username: "operator", password: "secure password" })
    });
    const loginGate = await proxy(loginRequest);
    assert.equal(loginGate.status, 200);
    const login = await loginRoute(loginRequest);
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(sessionCookie);

    const mutation = await proxy(new NextRequest("https://agentos.example.com/api/mission", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        host: "agentos.example.com",
        origin: "https://agentos.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "agentos.example.com",
        "x-forwarded-proto": "https"
      }
    }));
    assert.equal(mutation.status, 200);

    setEnv("AGENTOS_TRUSTED_OPERATOR_ORIGINS", "https://other.example.com");
    const untrustedMutation = await proxy(new NextRequest("https://agentos.example.com/api/mission", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        host: "agentos.example.com",
        origin: "https://agentos.example.com",
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-host": "agentos.example.com",
        "x-forwarded-proto": "https"
      }
    }));
    assert.equal(untrustedMutation.status, 403);
    assert.equal((await untrustedMutation.json()).code, "unsafe-local-api");
  } finally {
    await resetInstanceProtection();
    restoreEnv("AGENTOS_RUNTIME_DIR", previous.runtime);
    restoreEnv("AGENTOS_API_TOKEN", previous.token);
    restoreEnv("AGENTOS_TRUSTED_OPERATOR_ORIGINS", previous.trustedOrigins);
    restoreEnv("NODE_ENV", previous.nodeEnv);
  }
});

test("local owners can approve and revoke a remote HTTPS address without changing credentials", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-access-policy-"));
  const previous = process.env.AGENTOS_RUNTIME_DIR;
  setEnv("AGENTOS_RUNTIME_DIR", runtimeDir);
  const local = "http://localhost:3000";
  const remote = "https://agentos-access-test.example.com";
  const credentials = { username: "access-owner", password: "fixture password" };
  const write = (origin: string, path: string, body: object, cookie = "") => new NextRequest(`${origin}${path}`, {
    method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const read = (origin: string, path: string, cookie: string) => new NextRequest(`${origin}${path}`, { headers: { cookie } });
  const accessPath = "/api/auth/access";

  try {
    const { session } = await enableInstanceProtection(credentials);
    const ownerCookie = `agentos_instance_session=${session}`;
    const member = { username: "access-member", password: "fixture password" };
    await createManagedAgentOsUser(member);
    const { session: memberSession } = await loginToInstance({ ...member, rateKey: "member" });
    const memberCookie = `agentos_instance_session=${memberSession}`;
    assert.equal((await accessRoute(read(local, accessPath, ""))).status, 403);
    assert.equal((await accessRoute(read(local, accessPath, memberCookie))).status, 403);
    assert.equal((await changeAccessRoute(write(local, accessPath, { action: "add", origin: remote }, memberCookie))).status, 403);
    assert.equal((await accessRoute(read(remote, accessPath, ownerCookie))).status, 403);
    assert.equal((await changeAccessRoute(write(remote, accessPath, { action: "add", origin: remote }, ownerCookie))).status, 403);
    assert.equal((await loginRoute(write(remote, "/api/auth/login", credentials))).status, 403);
    for (const origin of ["http://agentos-access-test.example.com", "https://*.example.com", `${remote}/path`, `${remote}?`, "https://user:secret@example.com"]) {
      assert.equal((await changeAccessRoute(write(local, accessPath, { action: "add", origin }, ownerCookie))).status, 400);
    }
    const stored = await changeAccessRoute(write(local, accessPath, { action: "add", origin: remote }, ownerCookie));
    assert.equal(stored.status, 200);
    assert.deepEqual((await stored.json()).origins, [remote]);
    assert.deepEqual((await (await accessRoute(read(local, accessPath, ownerCookie))).json()).origins, [remote]);
    assert.equal((await loginRoute(write(remote.replace("https:", "http:"), "/api/auth/login", credentials))).status, 403);

    const login = await loginRoute(write(remote, "/api/auth/login", credentials));
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") ?? "", /; Secure/);
    const remoteCookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await proxy(read(remote, "/api/snapshot", ""))).status, 401);
    assert.equal((await proxy(read(remote, "/api/snapshot", remoteCookie))).status, 200);
    assert.equal((await proxy(write(remote, "/api/mission", {}, remoteCookie))).status, 200);
    assert.equal((await proxy(new NextRequest(`${remote}/api/mission`, {
      method: "POST", headers: { cookie: remoteCookie, origin: "https://untrusted.example.com" }
    }))).status, 403);

    assert.equal((await changeAccessRoute(write(local, accessPath, { action: "remove", origin: remote }, ownerCookie))).status, 200);
    assert.equal((await proxy(read(remote, "/settings", remoteCookie))).status, 403);
    assert.equal((await proxy(read(remote, "/api/snapshot", remoteCookie))).status, 403);
    assert.equal((await proxy(read(local, "/api/snapshot", ownerCookie))).status, 200);
  } finally {
    await resetInstanceProtection();
    restoreEnv("AGENTOS_RUNTIME_DIR", previous);
  }
});

test("LAN access resolves only this host's private IPv4 addresses and approved HTTPS port", () => {
  const address = (ip: string, internal = false) => ({
    address: ip, family: "IPv4" as const, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", internal, cidr: null
  });
  const interfaces = { eth0: [address("192.168.10.5"), address("203.0.113.10"), address("172.32.0.8")],
    eth1: [address("172.20.1.2")], lo0: [address("127.0.0.1", true)] };
  assert.deepEqual(getLanHttpsOrigins({ AGENTOS_LAN_HTTPS_PORT: "3443" }, interfaces), ["https://172.20.1.2:3443", "https://192.168.10.5:3443"]);
  assert.deepEqual(getLanHttpsOrigins({ AGENTOS_LAN_HTTPS_PORT: "invalid" }, interfaces), []);
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
