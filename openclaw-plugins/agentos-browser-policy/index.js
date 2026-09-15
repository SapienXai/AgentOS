import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildTrustedBrowserActionContext,
  classifyBrowserAction,
  parseBrowserToolSnapshotResult,
  readActKind,
  readActRefs,
  readActRequest,
  readTargetId
} from "./action-context.js";

const managedProfilePattern = /^acct-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const readOnlyActions = new Set([
  "tabs",
  "snapshot",
  "screenshot",
  "console",
  "wait"
]);
const lifecycleActions = new Set(["close", "profiles", "doctor", "status", "start", "stop", "focus"]);
const navigationActions = new Set(["open", "navigate"]);
const interactiveActions = new Set(["act", "dialog"]);
const accountCapabilities = new Set(["read", "interact", "publish", "transact", "account_admin"]);
const observationTtlMs = 10 * 60_000;
const maxObservations = 512;
const observedBrowserSnapshots = new Map();
const observationInvalidatingActions = new Set([
  "act",
  "dialog",
  "navigate",
  "open",
  "close",
  "focus"
]);

export default definePluginEntry({
  id: "agentos-browser-policy",
  name: "AgentOS Browser Policy",
  description: "Task-scoped secure browser profile enforcement",
  register(api) {
    api.on("gateway_start", async () => {
      const markerPath = resolveReadyPath();
      await mkdir(path.dirname(markerPath), { recursive: true, mode: 0o700 });
      await writeFile(markerPath, `${new Date().toISOString()}\n`, { mode: 0o600 });
    });

    api.on("gateway_stop", async () => {
      observedBrowserSnapshots.clear();
      await unlink(resolveReadyPath()).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    });

    api.on("after_tool_call", async (event, ctx) => {
      if (event.toolName !== "browser") return;
      const key = observationKey(ctx.sessionKey, ctx.agentId);
      if (!key) return;

      const action = typeof event.params?.action === "string" ? event.params.action.toLowerCase() : "";
      if (action === "snapshot") {
        const binding = await findBinding(ctx.sessionKey, ctx.agentId);
        const context = binding
          ? parseBrowserToolSnapshotResult(event.result, { allowedDomains: binding.allowedDomains })
          : null;
        if (context && binding && isAllowedUrl(context.url, binding.allowedDomains)) {
          rememberObservation(key, context);
        } else {
          observedBrowserSnapshots.delete(key);
        }
        return;
      }

      if (observationInvalidatingActions.has(action)) observedBrowserSnapshots.delete(key);
    });

    api.on(
      "before_tool_call",
      async (event, ctx) => {
        if (event.toolName !== "browser") return;

        const requestedProfile =
          typeof event.params.profile === "string" ? event.params.profile.trim() : "";
        const localBinding = await findBinding(ctx.sessionKey, ctx.agentId, true);
        if (!hasPolicyHeartbeatChannel()) {
          if (localBinding || managedProfilePattern.test(requestedProfile)) {
            return {
              block: true,
              blockReason: "The AgentOS browser policy channel is unavailable; managed browser access is blocked."
            };
          }
          return;
        }

        let binding = null;
        try {
          binding = await heartbeatBinding(ctx.sessionKey, ctx.agentId);
        } catch {
          if (localBinding || managedProfilePattern.test(requestedProfile)) {
            return {
              block: true,
              blockReason: "The AgentOS browser policy channel is unavailable; managed browser access is blocked."
            };
          }
          return;
        }

        if (!binding) {
          if (localBinding || managedProfilePattern.test(requestedProfile)) {
            return {
              block: true,
              blockReason: localBinding
                ? "The AgentOS managed browser task binding expired or was fenced."
                : "AgentOS managed browser profiles require an active task binding."
            };
          }
          return;
        }

        const action = typeof event.params.action === "string" ? event.params.action : "";
        const params = {
          ...event.params,
          target: "host",
          profile: binding.openClawProfileName
        };

        if (lifecycleActions.has(action)) {
          await appendPolicyAudit(binding, "sensitive_action_blocked");
          return {
            block: true,
            blockReason: "This browser lifecycle action is not available inside an account-bound task."
          };
        }

        if (action === "upload" || action === "pdf") {
          await appendPolicyAudit(binding, "sensitive_action_blocked");
          return {
            block: true,
            blockReason: "Browser file transfer is disabled for Secure Browser Accounts."
          };
        }

        if (action === "act" && readActKind(params) === "evaluate") {
          await appendPolicyAudit(binding, "sensitive_action_blocked");
          return {
            block: true,
            blockReason: "Arbitrary page evaluation is disabled for Secure Browser Accounts."
          };
        }

        if (action === "wait" && hasWaitPredicate(params)) {
          await appendPolicyAudit(binding, "sensitive_action_blocked");
          return {
            block: true,
            blockReason: "JavaScript wait predicates are disabled for Secure Browser Accounts."
          };
        }

        if (navigationActions.has(action)) {
          const targetUrl = readNavigationUrl(params);
          if (!targetUrl || !isAllowedUrl(targetUrl, binding.allowedDomains)) {
            await appendPolicyAudit(binding, "sensitive_action_blocked");
            return {
              block: true,
              blockReason: "Navigation is outside this browser account's allowed domains."
            };
          }
          if (!hasCapability(binding, "read")) {
            await appendPolicyAudit(binding, "sensitive_action_blocked");
            return {
              block: true,
              blockReason: "Read capability is not granted for this browser account identity."
            };
          }
          return { params };
        }

        if (interactiveActions.has(action)) {
          const observedContext = getObservation(observationKey(ctx.sessionKey, ctx.agentId));
          const trustedContext = await resolveTrustedBrowserActionContext({
            api,
            params,
            binding,
            observedContext
          });
          return await enforceCapabilityPolicy({
            action,
            params,
            binding,
            trustedContext,
            observedContext
          });
        }

        if (readOnlyActions.has(action)) {
          if (!hasCapability(binding, "read")) {
            await appendPolicyAudit(binding, "sensitive_action_blocked");
            return {
              block: true,
              blockReason: "Read capability is not granted for this browser account identity."
            };
          }
          return { params };
        }

        await appendPolicyAudit(binding, "sensitive_action_blocked");
        return {
          block: true,
          blockReason: "This browser action is not allowed by the Secure Browser Account policy."
        };
      },
      { priority: 1000, timeoutMs: 5_000 }
    );
  }
});

async function findBinding(sessionKey, agentId, includeExpired = false) {
  if (typeof sessionKey !== "string" || typeof agentId !== "string") return null;
  try {
    const raw = await readFile(resolveBindingsPath(), "utf8");
    if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) return null;
    const parsed = JSON.parse(raw);
    const now = Date.now();
    return Array.isArray(parsed?.bindings)
      ? parsed.bindings.find((entry) =>
          entry?.openClawSessionKey === sessionKey &&
          entry?.agentId === agentId &&
          managedProfilePattern.test(entry?.openClawProfileName ?? "") &&
          Array.isArray(entry?.allowedDomains) &&
          entry.allowedDomains.length > 0 &&
          entry.allowedDomains.every(isSafeDomain) &&
          (includeExpired || Date.parse(entry?.expiresAt ?? "") > now)
        ) ?? null
      : null;
  } catch {
    return null;
  }
}

async function heartbeatBinding(sessionKey, agentId) {
  if (typeof sessionKey !== "string" || typeof agentId !== "string") return null;
  const response = await fetch(resolveHeartbeatUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AgentOS-Browser-Policy-Token": process.env.AGENTOS_BROWSER_POLICY_TOKEN
    },
    body: JSON.stringify({
      openClawSessionKey: sessionKey,
      agentId
    }),
    signal: AbortSignal.timeout(2_500)
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Browser policy heartbeat was rejected.");
  const payload = await response.json();
  const binding = payload?.binding;
  if (
    !binding ||
    binding.agentId !== agentId ||
    !managedProfilePattern.test(binding.openClawProfileName ?? "") ||
    !Array.isArray(binding.allowedDomains) ||
    !binding.allowedDomains.length ||
    !isBindingCurrent(binding)
  ) {
    throw new Error("Browser policy heartbeat returned an invalid binding.");
  }
  return binding;
}

function hasPolicyHeartbeatChannel() {
  return (
    /^[A-Za-z0-9_-]{43,128}$/.test(process.env.AGENTOS_BROWSER_POLICY_TOKEN ?? "") &&
    /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/internal\/browser-policy\/heartbeat$/.test(
      resolveHeartbeatUrl()
    )
  );
}

function resolveHeartbeatUrl() {
  return process.env.AGENTOS_BROWSER_POLICY_HEARTBEAT_URL?.trim() || "";
}

function isBindingCurrent(binding) {
  return (
    Date.parse(binding?.expiresAt ?? "") > Date.now() &&
    Number.isSafeInteger(binding?.fencingToken) &&
    binding.fencingToken > 0 &&
    Array.isArray(binding?.allowedDomains) &&
    binding.allowedDomains.length > 0 &&
    binding.allowedDomains.every(isSafeDomain) &&
    (!Array.isArray(binding?.capabilities) || binding.capabilities.every((value) => accountCapabilities.has(value)))
  );
}

function isSafeDomain(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  const hostname = normalized.startsWith("*.") ? normalized.slice(2) : normalized;
  const labels = hostname.split(".");
  return Boolean(
    hostname &&
    hostname.length <= 253 &&
    labels.length >= 2 &&
    !hostname.includes("..") &&
    labels.every((label) =>
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ) &&
    /^[a-z]{2,63}$/.test(labels.at(-1))
  );
}

function readNavigationUrl(params) {
  const value =
    typeof params.targetUrl === "string"
      ? params.targetUrl
      : typeof params.url === "string"
        ? params.url
        : null;
  return value?.trim() || null;
}

function hasWaitPredicate(params) {
  const request = readActRequest(params);
  return typeof request?.fn === "string" && request.fn.trim().length > 0;
}

function hasCapability(binding, capability) {
  // Older task bindings are normalized by the AgentOS heartbeat route. The
  // fallback keeps an already-running pre-capability task bounded to its old
  // read/interaction scope until it is released.
  return Array.isArray(binding.capabilities)
    ? binding.capabilities.includes(capability)
    : capability === "read" || capability === "interact";
}

async function enforceCapabilityPolicy({ action, params, binding, trustedContext, observedContext }) {
  const classification = classifyBrowserAction({
    action,
    params,
    binding,
    trustedContext,
    observedContext
  });
  const capability = classification.capability;
  const boundParams = trustedContext?.targetId
    ? { ...params, targetId: trustedContext.targetId }
    : params;
  if (capability === "read") {
    if (!hasCapability(binding, "read")) {
      await appendPolicyAudit(binding, "sensitive_action_blocked");
      return {
        block: true,
        blockReason: "Read capability is not granted for this browser account identity."
      };
    }
    return { params: boundParams };
  }

  if (capability === "interact") {
    if (!hasCapability(binding, "interact")) {
      await appendPolicyAudit(binding, "sensitive_action_blocked");
      return {
        block: true,
        blockReason: "Interaction capability is not granted for this browser account identity."
      };
    }
    return { params: boundParams };
  }

  if (capability === "account_admin") {
    await appendPolicyAudit(binding, "sensitive_action_blocked");
    return {
      block: true,
      blockReason: "Account administration is blocked for Secure Browser Accounts."
    };
  }

  if (capability === "transact" && !hasCapability(binding, "transact")) {
    await appendPolicyAudit(binding, "sensitive_action_blocked");
    return {
      block: true,
      blockReason: "Transaction capability is not granted for this browser account identity."
    };
  }

  if (capability === "publish" && !hasCapability(binding, "publish")) {
    await appendPolicyAudit(binding, "sensitive_action_blocked");
    return {
      block: true,
      blockReason: "Publish capability is not granted for this browser account identity."
    };
  }

  // Transactions always require the existing OpenClaw approval framework.
  // Publish approval is opt-in per identity; a granted publish capability is
  // otherwise sufficient. Unknown actions require approval because their risk
  // cannot be established from a CSS ref or arbitrary page DOM.
  const requiresApproval =
    capability === "transact" ||
    (capability === "publish" && binding.approvalPolicy === "require_approval") ||
    capability === "unknown";
  if (!requiresApproval) return { params: boundParams };

  await appendPolicyAudit(binding, "sensitive_action_requested");
  return {
    params: boundParams,
    requireApproval: {
      title: capability === "transact" ? "Approve browser transaction" : "Approve sensitive browser action",
      description: capability === "unknown"
        ? "Allow this browser action? AgentOS could not classify its trusted browser target safely."
        : `Allow ${capability} action on ${binding.allowedDomains[0] ?? "the connected account"}?`,
      severity: capability === "transact" ? "critical" : "warning",
      allowedDecisions: ["allow-once", "deny"],
      timeoutMs: 120_000,
      timeoutBehavior: "deny",
      onResolution: async (decision) => {
        await appendPolicyAudit(
          binding,
          decision === "allow-once" ? "sensitive_action_approved" : "sensitive_action_blocked"
        );
      }
    }
  };
}

function observationKey(sessionKey, agentId) {
  return typeof sessionKey === "string" && typeof agentId === "string" && sessionKey && agentId
    ? `${sessionKey}\u0000${agentId}`
    : null;
}

function getObservation(key) {
  if (!key) return null;
  const entry = observedBrowserSnapshots.get(key);
  if (!entry) return null;
  if (Date.now() - entry.observedAt > observationTtlMs) {
    observedBrowserSnapshots.delete(key);
    return null;
  }
  return entry.context;
}

function rememberObservation(key, context) {
  if (!key || !context) return;
  if (observedBrowserSnapshots.size >= maxObservations && !observedBrowserSnapshots.has(key)) {
    const oldestKey = observedBrowserSnapshots.keys().next().value;
    if (oldestKey) observedBrowserSnapshots.delete(oldestKey);
  }
  observedBrowserSnapshots.set(key, { context, observedAt: Date.now() });
}

async function resolveTrustedBrowserActionContext({ api, params, binding, observedContext }) {
  const refs = readActRefs(params);
  const requestedRef = refs[0] ?? "";
  const snapshotQuery = {
    profile: binding.openClawProfileName,
    format: requestedRef.toLowerCase().startsWith("ax") ? "aria" : "ai",
    maxChars: "40000",
    ...(requestedRef.toLowerCase().startsWith("ax")
      ? {}
      : { interactive: "true", refs: "role" })
  };
  const targetId = readTargetId(params) ?? observedContext?.targetId ?? await resolveSingleBrowserTarget(api, binding);
  if (!targetId) return null;

  const raw = await browserGatewayRequest(api, {
    target: "host",
    method: "GET",
    path: "/snapshot",
    query: { ...snapshotQuery, targetId }
  });
  if (!raw || typeof raw !== "object") return null;
  return buildTrustedBrowserActionContext(raw, {
    allowedDomains: binding.allowedDomains
  });
}

async function resolveSingleBrowserTarget(api, binding) {
  const raw = await browserGatewayRequest(api, {
    target: "host",
    method: "GET",
    path: "/tabs",
    query: { profile: binding.openClawProfileName }
  });
  const tabs = Array.isArray(raw?.tabs) ? raw.tabs : [];
  const allowedTabs = tabs.filter((tab) =>
    typeof tab?.targetId === "string" &&
    typeof tab?.url === "string" &&
    isAllowedUrl(tab.url, binding.allowedDomains)
  );
  return allowedTabs.length === 1 ? allowedTabs[0].targetId : null;
}

async function browserGatewayRequest(api, params) {
  const gateway = api?.runtime?.gateway;
  if (!gateway || typeof gateway.request !== "function") return null;
  try {
    if (typeof gateway.isAvailable === "function" && !(await gateway.isAvailable())) return null;
    return await gateway.request("browser.request", params, { timeoutMs: 2_000 });
  } catch {
    return null;
  }
}

function isAllowedUrl(value, allowedDomains) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (url.protocol !== "https:" && !localHttp) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return Array.isArray(allowedDomains) && allowedDomains.some((entry) => {
      const domain = String(entry).toLowerCase();
      if (domain.startsWith("*.")) {
        const suffix = domain.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
      }
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

async function appendPolicyAudit(binding, type) {
  const auditPath = resolveAuditPath();
  await mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  const event = {
    id: randomUUID(),
    type,
    accountId: binding.accountId,
    workspaceId: binding.workspaceId,
    actorUserId: binding.ownerUserId,
    agentId: binding.agentId,
    taskId: binding.dispatchId,
    at: new Date().toISOString(),
    detail:
      type === "sensitive_action_requested"
        ? "OpenClaw requested a browser action that needs policy review."
        : type === "sensitive_action_approved"
          ? "The operator approved one browser action."
          : "A browser action was denied or blocked by policy."
  };
  const line = `${JSON.stringify(event)}\n`;
  const size = await stat(auditPath).then((entry) => entry.size).catch(() => 0);
  if (size > 1024 * 1024) {
    await writeFile(auditPath, line, { encoding: "utf8", mode: 0o600 });
  } else {
    await appendFile(auditPath, line, { encoding: "utf8", mode: 0o600 });
  }
}

function resolveMissionControlRoot() {
  return process.env.AGENTOS_MISSION_CONTROL_ROOT?.trim() || "/agentos/.mission-control";
}

function resolveBindingsPath() {
  return path.join(resolveMissionControlRoot(), "browser-task-bindings.json");
}

function resolveAuditPath() {
  return path.join(resolveMissionControlRoot(), "browser-policy-audit.jsonl");
}

function resolveReadyPath() {
  return process.env.AGENTOS_BROWSER_POLICY_READY_PATH?.trim() || "/tmp/agentos-browser-policy.ready";
}
