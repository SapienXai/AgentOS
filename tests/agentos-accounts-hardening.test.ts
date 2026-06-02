import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import type { AccountAccessPermission, AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import {
  buildReplacementAccountAccessRulesForTarget,
  removeAccountAccessRulesForTarget,
  resolveAccountAccessDecisionFromRules
} from "@/lib/agentos/application/account-access-policy-service";
import {
  normalizeAccountLoginTarget,
  normalizeStorableLoginUrl,
  normalizeStoredLoginUrl
} from "@/lib/agentos/application/account-login-target-service";
import { buildAccountTargetMissionContext } from "@/lib/agentos/application/account-target-mission-context-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  listOpenClawBrowserProfiles,
  openLoginUrlInOpenClawBrowserProfile,
  startOpenClawBrowserProfile
} from "@/lib/openclaw/application/browser-profile-service";

afterEach(() => {
  setOpenClawAdapterForTesting(null);
});

test("account access decisions deny absent, no-access, and approval-required rules", () => {
  const rules = [
    accountRule({ agentId: "agent-allow", permission: "use_browser_profile" }),
    accountRule({ agentId: "agent-approval", permission: "requires_approval" }),
    accountRule({ agentId: "agent-deny", permission: "no_access" })
  ];

  assert.deepEqual(
    pickDecision(resolveAccountAccessDecisionFromRules(rules, decisionInput("agent-missing"))),
    { allowed: false, approvalRequired: false, error: "This agent is not allowed to use the selected account target." }
  );
  assert.deepEqual(
    pickDecision(resolveAccountAccessDecisionFromRules(rules, decisionInput("agent-deny"))),
    { allowed: false, approvalRequired: false, error: "This agent is not allowed to use the selected account target." }
  );
  assert.deepEqual(
    pickDecision(resolveAccountAccessDecisionFromRules(rules, decisionInput("agent-approval"))),
    { allowed: false, approvalRequired: true, error: "This account target requires approval, but account approval dispatch is not exposed yet." }
  );
  assert.deepEqual(
    pickDecision(resolveAccountAccessDecisionFromRules(rules, decisionInput("agent-allow"))),
    { allowed: true, approvalRequired: false, error: null }
  );
});

test("account access replacement dedupes agents and lets later no-access remove a rule", () => {
  const currentRules = [
    accountRule({ agentId: "agent-old", agentName: "Old Agent" }),
    accountRule({ targetId: "target-other", agentId: "agent-keep", agentName: "Keep Agent" })
  ];
  const nextRules = buildReplacementAccountAccessRulesForTarget({
    currentRules,
    workspaceId: "workspace-1",
    targetId: "target-1",
    now: "2026-06-02T00:00:00.000Z",
    rules: [
      { agentId: "agent-a", agentName: "Agent A", permission: "use_browser_profile" },
      { agentId: "agent-b", agentName: "Agent B", permission: "requires_approval" },
      { agentId: " agent-a ", agentName: "Agent A", permission: "no_access" },
      { agentId: "agent-c", agentName: "Agent C", permission: "use_browser_profile" }
    ]
  });

  assert.deepEqual(
    nextRules.map((rule) => `${rule.targetId}:${rule.agentId}:${rule.permission}`).sort(),
    [
      "target-1:agent-b:requires_approval",
      "target-1:agent-c:use_browser_profile",
      "target-other:agent-keep:use_browser_profile"
    ]
  );
});

test("account access cleanup removes only the exact target in the deleted target workspace", () => {
  const currentRules = [
    accountRule({ workspaceId: "workspace-1", targetId: "shared-target", agentId: "agent-a" }),
    accountRule({ workspaceId: "workspace-2", targetId: "shared-target", agentId: "agent-b" }),
    accountRule({ workspaceId: "workspace-1", targetId: "other-target", agentId: "agent-c" })
  ];
  const nextRules = removeAccountAccessRulesForTarget({
    currentRules,
    workspaceId: "workspace-1",
    targetId: "shared-target"
  });

  assert.deepEqual(
    nextRules.map((rule) => `${rule.workspaceId}:${rule.targetId}:${rule.agentId}`).sort(),
    [
      "workspace-1:other-target:agent-c",
      "workspace-2:shared-target:agent-b"
    ]
  );
});

test("account login targets strip query and hash data while preserving stable target ids", () => {
  assert.equal(
    normalizeStorableLoginUrl("https://example.com/login?token=query-secret&safe=1#password=hash-secret"),
    "https://example.com/login"
  );
  assert.equal(normalizeStoredLoginUrl("not a url", "example.com"), "https://example.com");

  const target = normalizeAccountLoginTarget({
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
    serviceId: "portal",
    serviceName: "Portal",
    primaryDomain: "https://Example.com/login?token=query-secret",
    loginUrl: "https://example.com/login?token=query-secret#hash-secret",
    browserProfileName: "openclaw",
    lastOpenedAt: "2026-06-02T00:00:00.000Z"
  });

  assert.equal(target?.id, "workspace-1:openclaw:example.com");
  assert.equal(target?.primaryDomain, "example.com");
  assert.equal(target?.loginUrl, "https://example.com/login");
});

test("account target mission context omits login URLs and secret-bearing values", () => {
  const context = buildAccountTargetMissionContext({
    serviceName: "Portal token=query-secret\npassword=line-secret",
    primaryDomain: "example.com",
    browserProfileName: "openclaw"
  });

  assert.match(context, /AgentOS account-target context is an MVP bridge/);
  assert.doesNotMatch(context, /Login URL|https?:\/\//);
  assert.doesNotMatch(context, /query-secret|line-secret|hash-secret|cookie-secret|password-secret/);
  assert.doesNotMatch(context, /[?#]/);
});

test("browser profile service uses OpenClaw browser.request and sanitizes URL fields", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  setOpenClawAdapterForTesting(createBrowserAdapter(async (method, params) => {
    calls.push({ method, params });

    if (params.path === "/profiles") {
      return {
        profiles: [
          {
            name: "openclaw",
            driver: "openclaw",
            transport: "cdp",
            cdpUrl: "ws://127.0.0.1:9222/devtools/browser/abc?token=query-secret",
            running: true,
            tabCount: 2
          }
        ]
      };
    }

    if (params.path === "/tabs/open" && isRecord(params.body)) {
      return {
        tabId: "tab-1",
        url: `${String(params.body.url)}?token=response-secret#hash-secret`
      };
    }

    return {};
  }));

  const profiles = await listOpenClawBrowserProfiles();
  await startOpenClawBrowserProfile({ profileName: "OpenClaw" });
  const opened = await openLoginUrlInOpenClawBrowserProfile({
    profileName: "OpenClaw",
    loginUrl: "https://example.com/login?token=query-secret#hash-secret",
    label: "Portal Login!"
  });

  assert.deepEqual(calls.map((call) => call.method), ["browser.request", "browser.request", "browser.request"]);
  assert.equal(profiles.profiles[0]?.cdpUrl?.includes("query-secret"), false);
  assert.deepEqual(calls[1]?.params.query, { profile: "openclaw" });
  assert.deepEqual(calls[2]?.params.query, { profile: "openclaw" });
  assert.deepEqual(calls[2]?.params.body, {
    url: "https://example.com/login",
    label: "portal-login"
  });
  assert.equal(opened.tab?.url, "https://example.com/login");
});

test("browser profile service redacts unsupported browser.request errors", async () => {
  setOpenClawAdapterForTesting(createBrowserAdapter(async () => {
    throw new Error("INVALID_REQUEST: unknown method browser.request token=query-secret password=plain-secret");
  }));

  await assert.rejects(
    () => listOpenClawBrowserProfiles(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /browser\.request/);
      assert.doesNotMatch(error.message, /query-secret|plain-secret/);
      return true;
    }
  );
});

test("browser profile service normalizes signed-in Chrome attach failures", async () => {
  setOpenClawAdapterForTesting(createBrowserAdapter(async () => {
    throw new Error(
      "INVALID_REQUEST: Chrome MCP existing-session attach for profile \"user\" could not connect to Chrome. " +
        "Cause: Could not find DevToolsActivePort for chrome at /Users/kazimakgul/Library/Application Support/Google/Chrome/DevToolsActivePort " +
        "Gateway-native operation failed; CLI fallback disabled for this operation. Recovery: Update OpenClaw or report the incompatible Gateway response shape."
    );
  }));

  await assert.rejects(
    () => openLoginUrlInOpenClawBrowserProfile({
      profileName: "user",
      loginUrl: "https://example.com/login"
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Signed-in Chrome could not be attached through OpenClaw/);
      assert.match(error.message, /managed "openclaw" profile/);
      assert.doesNotMatch(error.message, /DevToolsActivePort|Gateway-native operation failed|Update OpenClaw|kazimakgul/);
      return true;
    }
  );
});

function decisionInput(agentId: string) {
  return {
    workspaceId: "workspace-1",
    targetId: "target-1",
    agentId
  };
}

function pickDecision(decision: ReturnType<typeof resolveAccountAccessDecisionFromRules>) {
  return {
    allowed: decision.allowed,
    approvalRequired: decision.approvalRequired,
    error: decision.error ?? null
  };
}

function accountRule(overrides: Partial<AccountAccessRuleView> & {
  permission?: AccountAccessPermission;
} = {}): AccountAccessRuleView {
  const permission = overrides.permission ?? "use_browser_profile";
  const workspaceId = overrides.workspaceId ?? "workspace-1";
  const targetId = overrides.targetId ?? "target-1";
  const agentId = overrides.agentId ?? "agent-1";

  return {
    id: `${workspaceId}:${targetId}:${agentId}`,
    workspaceId,
    targetId,
    agentId,
    agentName: overrides.agentName ?? "Agent",
    permission,
    permissionLabel: permission === "requires_approval"
      ? "Requires approval"
      : permission === "use_browser_profile"
        ? "Can use browser profile"
        : "No access",
    approvalRequired: permission === "requires_approval",
    notes: overrides.notes ?? null,
    source: "agentos.account-access-policy",
    createdAt: overrides.createdAt ?? "2026-06-02T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-02T00:00:00.000Z"
  };
}

function createBrowserAdapter(
  handler: (method: string, params: Record<string, unknown>) => Promise<unknown>
) {
  return {
    async call(method: string, params: Record<string, unknown>) {
      return handler(method, params);
    }
  } as unknown as OpenClawAdapter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
