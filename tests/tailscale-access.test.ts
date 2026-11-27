import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as readTailscale, POST as writeTailscale } from "@/app/api/auth/access/tailscale/route";
import { createManagedAgentOsUser } from "@/lib/agentos/application/agentos-account-service";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import {
  disableInstanceProtection, enableInstanceProtection, loginToInstance,
  readInstanceProtectionState, resolveInstanceProtectionPath
} from "@/lib/security/instance-protection";
import type { TailscaleRoute } from "@/lib/security/remote-access-policy";
import { changeTailscaleAccess, getTailscaleUpstream, inspectTailscaleAccess } from "@/lib/security/tailscale-access";
import { type JsonMap, type NativeTailscale, TailscaleConfigChanged } from "@/lib/security/tailscale-native";
import { proxy } from "@/proxy";

const name = "mac.agentos-test.ts.net";
const upstream = "http://127.0.0.1:31257";

function nativeFixture(initial: JsonMap = {}) {
  let config = structuredClone(initial);
  let revision = 0;
  let route: TailscaleRoute | undefined;
  let running = true;
  const writes: JsonMap[] = [];
  const native: NativeTailscale = {
    inspect: async () => ({
      BackendState: running ? "Running" : "Stopped",
      Self: { ID: "n-test-device", DNSName: name + "." },
      CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [name]
    }),
    readServe: async () => structuredClone(config),
    readConfig: async () => ({ config: structuredClone(config), etag: String(revision) }),
    writeConfig: async (next, etag) => {
      if (etag !== String(revision)) throw new TailscaleConfigChanged();
      writes.push(next);
      config = structuredClone(next);
      revision += 1;
    }
  };
  const dependencies = { native: async () => native, verify: async () => true };
  return {
    native, dependencies, writes,
    get route() { return route; },
    get config() { return structuredClone(config); },
    set config(next) { config = next; revision += 1; },
    set running(value: boolean) { running = value; },
    change: (action: "enable" | "disable") => changeTailscaleAccess({
      action, route, upstream, persist: async (next) => { route = next; }
    }, dependencies)
  };
}

test("native access uses the bound loopback port and refuses a wildcard or ephemeral Desktop listener", () => {
  assert.equal(getTailscaleUpstream({ PORT: "31257", __NEXT_PRIVATE_ORIGIN: upstream }), upstream);
  for (const origin of ["http://localhost:31257", "http://0.0.0.0:31257", "http://127.0.0.1:3000", "https://127.0.0.1:31257"]) {
    assert.equal(getTailscaleUpstream({ PORT: "31257", __NEXT_PRIVATE_ORIGIN: origin }), null);
  }
  assert.equal(getTailscaleUpstream({ PORT: "31257", __NEXT_PRIVATE_ORIGIN: upstream, AGENTOS_DESKTOP: "1" }), null);
});

test("managed Serve preserves existing Gateway, Funnel and foreground routes across enable, recheck and disable", async () => {
  const existing = {
    TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
    Web: { [name + ":443"]: { Handlers: { "/": { Proxy: "http://127.0.0.1:18789" } } } },
    AllowFunnel: { [name + ":8443"]: true },
    Foreground: { "another-session": { TCP: { "9443": { HTTPS: true } } } }
  };
  const fixture = nativeFixture(existing);
  assert.equal((await fixture.change("enable")).origin, `https://${name}:10443`);
  assert.equal(fixture.route?.enabled, true);
  assert.equal((await inspectTailscaleAccess(fixture.route, upstream, fixture.dependencies)).status, "active");
  assert.equal((await inspectTailscaleAccess(fixture.route, "http://127.0.0.1:31258", fixture.dependencies)).status, "conflict");
  assert.equal((await fixture.change("disable")).status, "ready");
  assert.deepEqual(fixture.config, existing);
});

test("atomic collision failure keeps a concurrently added route and never approves the address", async () => {
  const fixture = nativeFixture();
  const win = fixture.native.writeConfig;
  const competing = { TCP: { "443": { TCPForward: "127.0.0.1:18789" } } };
  fixture.native.writeConfig = async (config, etag) => {
    fixture.config = competing;
    await win(config, etag);
  };
  assert.equal((await fixture.change("enable")).status, "conflict");
  assert.deepEqual(fixture.config, competing);
  assert.equal(fixture.route, undefined);
  assert.equal(fixture.writes.length, 0);
});

test("a device profile change during native setup leaves AgentOS sign-in disabled", async () => {
  const fixture = nativeFixture();
  const write = fixture.native.writeConfig;
  const inspect = fixture.native.inspect;
  fixture.native.writeConfig = async (config, etag) => {
    await write(config, etag);
    fixture.native.inspect = async () => ({
      ...await inspect() as JsonMap, Self: { ID: "other-device", DNSName: name + "." }
    });
  };
  assert.equal((await fixture.change("enable")).status, "cleanup-required");
  assert.equal(fixture.route?.enabled, false);
});

test("offline disable revokes AgentOS approval and allows native cleanup after reconnect", async () => {
  const fixture = nativeFixture();
  await fixture.change("enable");
  fixture.running = false;
  assert.equal((await fixture.change("disable")).status, "disconnected");
  assert.equal(fixture.route?.enabled, false);
  assert.equal(fixture.writes.length, 1);
  fixture.running = true;
  await fixture.change("disable");
  assert.equal(fixture.route, undefined);
  assert.equal(fixture.writes.length, 2);
});

test("replacement handler on an owned port is never removed", async () => {
  const fixture = nativeFixture();
  await fixture.change("enable");
  const config = fixture.config;
  const server = (config.Web as Record<string, { Handlers: JsonMap }>)[name + ":443"];
  server.Handlers["/third-party"] = { Proxy: "http://127.0.0.1:18789" };
  fixture.config = config;
  assert.equal((await fixture.change("disable")).status, "cleanup-required");
  assert.deepEqual(fixture.config, config);
  assert.equal(fixture.route?.enabled, false);
  assert.equal(fixture.writes.length, 1);
});

test("Tailscale routes require the existing account session, secure cookies and owner-local controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentos-tailscale-auth-"));
  const before = { ...process.env };
  Object.assign(process.env, { AGENTOS_RUNTIME_DIR: directory, PORT: "31257", __NEXT_PRIVATE_ORIGIN: upstream });
  delete process.env.AGENTOS_DESKTOP;
  const url = `https://${name}`;
  const credentials = { username: "test-owner", password: "fixture password" };
  const headers = { host: name, "x-forwarded-host": name, "x-forwarded-proto": "https", "x-forwarded-for": "100.64.0.10" };
  const request = (path: string, extra = {}, body?: object) => new NextRequest(url + path, {
    headers: { ...headers, ...extra, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {})
  });
  try {
    assert.equal((await proxy(request("/"))).status, 403);
    const { session } = await enableInstanceProtection(credentials);
    const stored = (await readInstanceProtectionState())!;
    const route = {
      nodeId: "test-device", origin: url, target: upstream, enabled: true,
      marker: "/.well-known/agentos-serve-123e4567-e89b-12d3-a456-426614174000"
    };
    const protection = resolveInstanceProtectionPath();
    await writeFile(protection, JSON.stringify({ ...stored, remoteAccess: { origins: [], lanEnabled: false, tailscale: route } }));
    assert.equal((await proxy(request("/api/snapshot", { "tailscale-user-login": "owner@example.test" }))).status, 401);
    assert.equal((await proxy(request("/settings"))).headers.get("location"), url + "/login?returnTo=%2Fsettings");
    const remoteLogin = await login(request("/api/auth/login", { origin: url }, credentials));
    assert.equal(remoteLogin.status, 200);
    assert.match(remoteLogin.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict.*; Secure/);
    const cookie = remoteLogin.headers.get("set-cookie")!.split(";")[0];
    const streamRequest = request("/api/stream", { cookie });
    assert.equal((await resolveAgentOsActorContext(streamRequest))?.authenticationMethod, "instance-session");
    assert.equal((await proxy(request("/api/mission", { origin: url, cookie }, {}))).status, 200);
    assert.equal((await proxy(request("/api/mission", { origin: "https://cross-site.example", cookie }, {}))).status, 403);
    assert.equal((await proxy(request("/api/snapshot", { "tailscale-funnel-request": "?1", cookie }))).status, 403);
    assert.equal((await proxy(request("/api/snapshot", { "x-forwarded-for": "203.0.113.15", cookie }))).status, 403);
    assert.equal((await proxy(request("/api/snapshot", { "x-forwarded-host": "localhost", cookie }))).status, 403);
    assert.equal((await readTailscale(request("/api/auth/access/tailscale", { cookie }))).status, 403);
    const local = upstream + "/api/auth/access/tailscale";
    const ownerCookie = `agentos_instance_session=${session}`;
    const localWrite = (headers: HeadersInit, body: object) => new Request(local, {
      headers, method: "POST", body: JSON.stringify(body)
    });
    assert.equal((await readTailscale(new Request(local))).status, 403);
    assert.equal((await writeTailscale(localWrite({ cookie: ownerCookie }, { action: "disable" }))).status, 403);
    assert.equal((await writeTailscale(localWrite({ cookie: ownerCookie, origin: upstream, "x-forwarded-for": "100.64.0.10" }, { action: "disable" }))).status, 403);
    assert.equal((await writeTailscale(localWrite({ cookie: ownerCookie, origin: upstream }, { action: "enable", port: 8080 }))).status, 400);
    const member = { username: "test-member", password: "fixture password" };
    await createManagedAgentOsUser(member);
    const memberLogin = await loginToInstance({ ...member, rateKey: "tailnet-member" });
    assert.equal((await writeTailscale(localWrite({ cookie: `agentos_instance_session=${memberLogin.session}`, origin: upstream }, { action: "disable" }))).status, 403);
    await assert.rejects(disableInstanceProtection(credentials.password), /Disable the managed Tailscale route/);
    await writeFile(protection, JSON.stringify({ ...stored, remoteAccess: { origins: [], lanEnabled: false, tailscale: { ...route, enabled: false } } }));
    assert.equal((await proxy(request("/api/snapshot", { cookie }))).status, 403);
    assert.equal(await resolveAgentOsActorContext(streamRequest), null);
  } finally {
    for (const key of ["AGENTOS_RUNTIME_DIR", "AGENTOS_DESKTOP", "PORT", "__NEXT_PRIVATE_ORIGIN"]) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
