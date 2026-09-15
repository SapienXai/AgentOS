import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

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
const interactiveKinds = new Set([
  "click",
  "clickcoors",
  "click-coords",
  "drag",
  "fill",
  "hover",
  "press",
  "scrollintoview",
  "select",
  "type"
]);
const accountAdminPattern = /\b(change|reset|update|remove|disable|enable)\b.{0,40}\b(password|passcode|mfa|2fa|two-factor|authenticator|security|recovery email|recovery phone)\b|\b(create|generate|rotate|revoke)\b.{0,40}\b(api key|access token|secret)\b|\b(change|grant|revoke|remove)\b.{0,40}\b(permission|role|admin|owner)\b|\b(delete|close)\b.{0,32}\b(account|workspace|organization)\b/i;
const transactionPattern = /\b(purchase|buy|checkout|pay|payment|transfer money|wire transfer|place an order|subscribe|upgrade plan)\b|\b(confirm|submit)\b.{0,32}\b(order|payment|purchase|checkout)\b/i;
const publishPattern = /\b(publish|post|tweet|reply|comment|send|email|message|submit)\b|\b(create|edit)\b.{0,32}\b(listing|release|announcement|article|issue|pull request)\b/i;
const accountCapabilities = new Set(["read", "interact", "publish", "transact", "account_admin"]);
const serviceRiskPatterns = {
  github: /\b(merge|approve|open|create|edit)\b.{0,32}\b(pull request|issue|release)\b/i,
  x: /\b(tweet|post|reply|quote|repost|direct message)\b/i,
  producthunt: /\b(launch|comment|upvote|submit)\b/i,
  amazon: /\b(add to cart|buy now|order|checkout|return)\b/i
};

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
      await unlink(resolveReadyPath()).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
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
          return await enforceCapabilityPolicy({ action, params, binding });
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

function readActKind(params) {
  const request = params.request && typeof params.request === "object" ? params.request : null;
  const kind =
    typeof request?.kind === "string"
      ? request.kind
      : typeof params.kind === "string"
        ? params.kind
        : "interaction";
  return kind.slice(0, 32);
}

function readActionDescription(action, params) {
  const request = params.request && typeof params.request === "object" ? params.request : null;
  const candidates = [
    params.actionDescription,
    params.description,
    params.intent,
    request?.actionDescription,
    request?.description,
    request?.intent,
    request?.text,
    request?.value
  ];
  return [action, readActKind(params), ...candidates]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .slice(0, 2_000);
}

function classifyAction(action, params, binding) {
  const description = readActionDescription(action, params);
  if (accountAdminPattern.test(description)) return "account_admin";
  if (transactionPattern.test(description)) return "transact";
  if (publishPattern.test(description) || serviceRiskPatterns[binding.serviceId]?.test(description)) {
    return "publish";
  }
  if (readOnlyActions.has(action) || navigationActions.has(action)) return "read";
  const kind = readActKind(params).toLowerCase();
  if (interactiveKinds.has(kind) || action === "dialog") return "interact";
  return "unknown";
}

function hasCapability(binding, capability) {
  // Older task bindings are normalized by the AgentOS heartbeat route. The
  // fallback keeps an already-running pre-capability task bounded to its old
  // read/interaction scope until it is released.
  return Array.isArray(binding.capabilities)
    ? binding.capabilities.includes(capability)
    : capability === "read" || capability === "interact";
}

async function enforceCapabilityPolicy({ action, params, binding }) {
  const capability = classifyAction(action, params, binding);
  if (capability === "read") {
    if (!hasCapability(binding, "read")) {
      await appendPolicyAudit(binding, "sensitive_action_blocked");
      return {
        block: true,
        blockReason: "Read capability is not granted for this browser account identity."
      };
    }
    return { params };
  }

  if (capability === "interact") {
    if (!hasCapability(binding, "interact")) {
      await appendPolicyAudit(binding, "sensitive_action_blocked");
      return {
        block: true,
        blockReason: "Interaction capability is not granted for this browser account identity."
      };
    }
    return { params };
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
  if (!requiresApproval) return { params };

  await appendPolicyAudit(binding, "sensitive_action_requested");
  return {
    params,
    requireApproval: {
      title: capability === "transact" ? "Approve browser transaction" : "Approve sensitive browser action",
      description: capability === "unknown"
        ? "Allow this browser action? AgentOS could not classify it safely."
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

function isAllowedUrl(value, allowedDomains) {
  try {
    const url = new URL(value);
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
