import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const managedProfilePattern = /^acct-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const readOnlyActions = new Set([
  "tabs",
  "snapshot",
  "screenshot",
  "console"
]);
const lifecycleActions = new Set(["close"]);
const navigationActions = new Set(["open", "navigate"]);
const interactiveActions = new Set(["act", "dialog"]);

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
        let binding = localBinding && isBindingCurrent(localBinding) ? localBinding : null;

        if (hasPolicyHeartbeatChannel()) {
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

        if (
          action === "profiles" ||
          action === "doctor" ||
          action === "status" ||
          action === "start" ||
          action === "stop" ||
          action === "focus"
        ) {
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
          return { params };
        }

        if (interactiveActions.has(action)) {
          await appendPolicyAudit(binding, "sensitive_action_requested");
          return {
            params,
            requireApproval: {
              title: "Approve browser interaction",
              description: `Allow ${action === "act" ? readActKind(params) : action} on ${binding.allowedDomains[0] ?? "the connected account"}?`,
              severity: "warning",
              allowedDecisions: ["allow-once", "deny"],
              timeoutMs: 120_000,
              timeoutBehavior: "deny",
              onResolution: async (decision) => {
                await appendPolicyAudit(
                  binding,
                  decision === "allow-once"
                    ? "sensitive_action_approved"
                    : "sensitive_action_blocked"
                );
              }
            }
          };
        }

        if (readOnlyActions.has(action) || lifecycleActions.has(action)) {
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
  return Date.parse(binding?.expiresAt ?? "") > Date.now();
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
        ? "OpenClaw requested an interactive browser action."
        : type === "sensitive_action_approved"
          ? "The operator approved one interactive browser action."
          : "An interactive browser action was denied or blocked."
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
