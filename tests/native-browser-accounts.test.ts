import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateBrowserActionPolicy } from "@/lib/agentos/browser-accounts/action-policy";
import { resolveBrowserAuthenticationRule } from "@/lib/agentos/browser-accounts/authentication-rules";
import { NativeOpenClawBrowserProvider } from "@/lib/agentos/browser-accounts/native-openclaw-provider";
import {
  listBrowserServiceDefinitions
} from "@/lib/agentos/browser-accounts/service-registry";
import type {
  NativeBrowserRequest,
  NativeBrowserRequestPort,
  NativeBrowserTab
} from "@/lib/openclaw/application/native-browser-service";
import {
  NativeOpenClawBrowserService,
  normalizeBrowserUrl,
  normalizeManagedProfileName
} from "@/lib/openclaw/application/native-browser-service";

type FakeProfile = {
  running: boolean;
  tabs: NativeBrowserTab[];
  snapshot: unknown;
};

class FakeNativeBrowserPort implements NativeBrowserRequestPort {
  readonly calls: NativeBrowserRequest[] = [];
  readonly profiles = new Map<string, FakeProfile>();

  async request<TPayload>(input: NativeBrowserRequest): Promise<TPayload> {
    this.calls.push(input);
    const profileName = input.query?.profile ??
      (input.method === "DELETE" && input.path.startsWith("/profiles/")
        ? decodeURIComponent(input.path.slice("/profiles/".length))
        : undefined);

    if (input.method === "GET" && input.path === "/profiles") {
      return {
        profiles: [...this.profiles].map(([name, profile]) => ({
          name,
          driver: "openclaw",
          running: profile.running,
          tabCount: profile.tabs.length,
          isDefault: false
        }))
      } as TPayload;
    }

    if (input.method === "POST" && input.path === "/profiles/create") {
      const name = String(input.body?.name ?? "");
      if (!this.profiles.has(name)) {
        this.profiles.set(name, { running: false, tabs: [], snapshot: {} });
      }
      return {} as TPayload;
    }

    if (!profileName || !this.profiles.has(profileName)) {
      throw new Error("profile not found");
    }
    const profile = this.profiles.get(profileName);
    assert.ok(profile);

    if (input.method === "POST" && input.path === "/start") {
      profile.running = true;
      return {} as TPayload;
    }
    if (input.method === "POST" && input.path === "/stop") {
      profile.running = false;
      return {} as TPayload;
    }
    if (input.method === "DELETE" && input.path.startsWith("/profiles/")) {
      this.profiles.delete(profileName);
      return {} as TPayload;
    }
    if (input.method === "POST" && input.path === "/tabs/open") {
      const tab: NativeBrowserTab = {
        tabId: `tab-${profileName}-${profile.tabs.length + 1}`,
        targetId: `target-${profileName}-${profile.tabs.length + 1}`,
        title: "Synthetic browser tab",
        url: String(input.body?.url ?? "")
      };
      profile.tabs.push(tab);
      return tab as TPayload;
    }
    if (input.method === "GET" && input.path === "/tabs") {
      return { tabs: profile.tabs } as TPayload;
    }
    if (input.method === "GET" && input.path === "/snapshot") {
      return profile.snapshot as TPayload;
    }

    throw new Error(`unsupported fake browser request: ${input.method} ${input.path}`);
  }
}

test("native OpenClaw profiles persist through graceful stop/start without credential sidecars", async () => {
  const port = new FakeNativeBrowserPort();
  const provider = new NativeOpenClawBrowserProvider(new NativeOpenClawBrowserService(port));

  const created = await provider.createProfile({ browserProfileId: "acct-github-a1b2c3" });
  assert.equal(created.provider, "native-openclaw");
  assert.equal(created.runtimeProvider, "openclaw-managed");
  assert.equal(created.persistent, true);
  assert.equal(created.externalProfileId, null);

  const firstSession = await provider.startSession({
    browserProfileId: "acct-github-a1b2c3",
    initialUrl: "https://github.com/dashboard?token=synthetic-secret#otp=synthetic-secret"
  });
  assert.equal(port.profiles.get("acct-github-a1b2c3")?.tabs[0]?.url, "https://github.com/dashboard");
  port.profiles.get("acct-github-a1b2c3")!.snapshot = { "user-login": "synthetic-user" };

  await provider.stopSession({
    sessionId: firstSession.sessionId,
    browserProfileId: firstSession.browserProfileId
  });

  // Recreate the AgentOS adapter around the same OpenClaw-owned state to model
  // an AgentOS restart. The profile and its benign state remain available.
  const restarted = new NativeOpenClawBrowserProvider(new NativeOpenClawBrowserService(port));
  const secondSession = await restarted.startSession({ browserProfileId: "acct-github-a1b2c3" });
  const verification = await restarted.verifyAuthentication({
    sessionId: secondSession.sessionId,
    browserProfileId: "acct-github-a1b2c3",
    allowedDomains: ["github.com"],
    serviceId: "github"
  });
  assert.equal(verification.status, "verified");
  assert.equal(port.profiles.get("acct-github-a1b2c3")?.running, true);
  const persistedSnapshot = port.profiles.get("acct-github-a1b2c3")?.snapshot as Record<string, unknown>;
  assert.equal(persistedSnapshot["user-login"], "synthetic-user");

  const serializedCalls = JSON.stringify(port.calls);
  assert.doesNotMatch(serializedCalls, /password|cookie|cdpUrl|userDataDir|token=synthetic-secret|otp=synthetic-secret/i);
  assert.doesNotMatch(JSON.stringify(created), /cdp|cookie|password|token|userDataDir/i);

  await restarted.revokeProfile({ browserProfileId: "acct-github-a1b2c3" });
  assert.equal(port.profiles.has("acct-github-a1b2c3"), false);
});

test("native OpenClaw profiles remain isolated and provider capability truth is explicit", async () => {
  const port = new FakeNativeBrowserPort();
  const service = new NativeOpenClawBrowserService(port);
  const provider = new NativeOpenClawBrowserProvider(service);

  await provider.createProfile({ browserProfileId: "acct-x-a1b2c3" });
  await provider.createProfile({ browserProfileId: "acct-amazon-d4e5f6" });
  await provider.startSession({ browserProfileId: "acct-x-a1b2c3", initialUrl: "https://x.com/home" });
  await provider.startSession({ browserProfileId: "acct-amazon-d4e5f6", initialUrl: "https://www.amazon.com/" });

  assert.deepEqual((await service.listTabs("acct-x-a1b2c3")).map((tab) => tab.url), ["https://x.com/home"]);
  assert.deepEqual((await service.listTabs("acct-amazon-d4e5f6")).map((tab) => tab.url), ["https://www.amazon.com/"]);
  assert.equal((await service.listProfiles()).length, 2);

  const capabilities = await provider.getCapabilities();
  assert.equal(capabilities.source, "native-openclaw");
  assert.equal(capabilities.profileCreation, "supported");
  assert.equal(capabilities.persistentProfiles, "supported");
  assert.equal(capabilities.liveView, "unsupported");
  assert.equal(capabilities.humanTakeover, "unsupported");
  assert.equal(capabilities.cdpExposure, "private");
  assert.match(capabilities.reason ?? "", /view-only/i);

  assert.equal(normalizeBrowserUrl("https://user:pass@x.com/home?session=secret#fragment"), "https://x.com/home");
  assert.equal(normalizeManagedProfileName("ACCT-X-A1B2C3"), "acct-x-a1b2c3");
  assert.throws(() => normalizeManagedProfileName("acct-user@example.com"), /opaque acct-/);
});

test("service registry and authentication rules cover the first four services without trusting manual confirmation", () => {
  const definitions = listBrowserServiceDefinitions();
  assert.deepEqual(definitions.map((definition) => definition.id), ["github", "x", "producthunt", "amazon"]);
  assert.equal(definitions.find((definition) => definition.id === "github")?.loginUrl, "https://github.com/login");
  assert.ok(definitions.find((definition) => definition.id === "amazon")?.domains.includes("amazon.com.tr"));

  for (const [serviceId, domain] of [
    ["github", "github.com"],
    ["x", "x.com"],
    ["producthunt", "producthunt.com"],
    ["amazon", "amazon.com"]
  ] as const) {
    const rule = resolveBrowserAuthenticationRule([domain], serviceId);
    assert.equal(rule?.serviceId, serviceId);
    assert.ok(rule?.authenticatedMarkers.length);
    assert.ok(rule?.loginPathPatterns.length);
  }
  assert.equal(resolveBrowserAuthenticationRule(["example.test"], "custom"), null);
});

test("native authentication does not treat an Amazon sign-in marker as connected", async () => {
  const port = new FakeNativeBrowserPort();
  const provider = new NativeOpenClawBrowserProvider(new NativeOpenClawBrowserService(port));
  await provider.createProfile({ browserProfileId: "acct-amazon-login-check" });
  await provider.startSession({ browserProfileId: "acct-amazon-login-check", initialUrl: "https://www.amazon.com/" });
  port.profiles.get("acct-amazon-login-check")!.snapshot = { "nav-ya-signin": "Sign in" };

  const verification = await provider.verifyAuthentication({
    sessionId: "synthetic-session",
    browserProfileId: "acct-amazon-login-check",
    allowedDomains: ["amazon.com"],
    serviceId: "amazon"
  });

  assert.equal(verification.status, "needs_user_action");
});

test("capability policy allows ordinary work but fails closed for sensitive and unknown actions", () => {
  const base = {
    approvalPolicy: "block_sensitive" as const,
    approvalInfrastructureAvailable: true
  };
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Read recent notifications",
    actionKind: "snapshot",
    grantedCapabilities: ["read"]
  }).decision, "allow");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Click the notifications filter",
    actionKind: "click",
    grantedCapabilities: ["read", "interact"]
  }).decision, "allow");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Publish this prepared post",
    actionKind: "click",
    grantedCapabilities: ["read", "interact"]
  }).decision, "block");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Publish this prepared post",
    actionKind: "click",
    grantedCapabilities: ["read", "interact", "publish"]
  }).decision, "allow");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Purchase the selected item",
    actionKind: "click",
    grantedCapabilities: ["read", "interact", "transact"]
  }).decision, "require_approval");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Change the account password",
    actionKind: "click",
    grantedCapabilities: ["read", "interact", "account_admin"]
  }).decision, "block");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Perform an unclassified browser operation",
    actionKind: "unclassified",
    grantedCapabilities: ["read", "interact"]
  }).decision, "require_approval");
  assert.equal(evaluateBrowserActionPolicy({
    ...base,
    actionDescription: "Purchase the selected item",
    actionKind: "click",
    grantedCapabilities: ["read", "interact", "transact"],
    approvalInfrastructureAvailable: false
  }).decision, "block");
});
