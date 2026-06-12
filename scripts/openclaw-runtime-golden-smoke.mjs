#!/usr/bin/env node

const baseUrl = process.env.AGENTOS_SMOKE_BASE_URL ?? "http://localhost:3000";
const enabled = process.env.AGENTOS_RUNTIME_SMOKE === "1";
const preferredAgentId = process.env.AGENTOS_RUNTIME_SMOKE_AGENT_ID?.trim() || null;
const preferredWorkspaceId = process.env.AGENTOS_RUNTIME_SMOKE_WORKSPACE_ID?.trim() || null;
const apiToken = process.env.AGENTOS_SMOKE_API_TOKEN?.trim() || process.env.AGENTOS_API_TOKEN?.trim() || null;
const checks = [];

function record(name, status, detail = "") {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(7)} ${name}${detail ? ` -- ${detail}` : ""}`);
}

function finish() {
  const failed = checks.filter((check) => check.status === "FAIL");
  console.log("SMOKE_RESULT_JSON_START");
  console.log(JSON.stringify({ baseUrl, enabled, checks }, null, 2));
  console.log("SMOKE_RESULT_JSON_END");

  if (failed.length > 0) {
    process.exit(1);
  }
}

if (!enabled) {
  record("runtime golden path gate", "BLOCKED", "Set AGENTOS_RUNTIME_SMOKE=1 to run real dispatch and continuation steps.");
  finish();
  process.exit(0);
}

async function request(path, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "Content-Type": "application/json",
    ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
    ...(options.headers ?? {})
  };

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function snapshot(force = true) {
  return request(`/api/snapshot${force ? "?force=true" : ""}`, {}, 45_000);
}

async function poll(name, producer, predicate, timeoutMs = 90_000, intervalMs = 2_000) {
  const startedAt = Date.now();
  let latest = null;

  while (Date.now() - startedAt < timeoutMs) {
    latest = await producer();

    if (predicate(latest)) {
      return latest;
    }

    await delay(intervalMs);
  }

  record(name, "FAIL", "timed out waiting for real OpenClaw evidence");
  return latest;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectWorkspaceBackedAgent(currentSnapshot) {
  const agents = Array.isArray(currentSnapshot?.agents) ? currentSnapshot.agents : [];

  return agents.find((agent) => {
    if (!agent?.id || !agent?.workspaceId || !agent?.workspacePath) {
      return false;
    }

    if (preferredAgentId && agent.id !== preferredAgentId) {
      return false;
    }

    if (preferredWorkspaceId && agent.workspaceId !== preferredWorkspaceId) {
      return false;
    }

    return true;
  }) ?? null;
}

async function createSafeSmokeAgent(currentSnapshot) {
  const timestamp = Date.now();
  const workspaceName = `AgentOS Runtime Smoke ${timestamp}`;
  const agentId = `agentos-runtime-smoke-${timestamp}`;
  const modelId =
    currentSnapshot?.diagnostics?.modelReadiness?.recommendedModelId ??
    currentSnapshot?.diagnostics?.modelReadiness?.resolvedDefaultModel ??
    currentSnapshot?.diagnostics?.modelReadiness?.defaultModel ??
    currentSnapshot?.models?.find((model) => model?.id && model?.ready !== false)?.id ??
    undefined;

  const response = await request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      name: workspaceName,
      brief: "AgentOS runtime golden-path smoke workspace.",
      sourceMode: "empty",
      template: "software",
      teamPreset: "solo",
      modelProfile: "fast",
      modelId,
      rules: {
        workspaceOnly: true,
        generateStarterDocs: true,
        generateMemory: false,
        kickoffMission: false
      },
      agents: [
        {
          id: agentId,
          role: "Runtime smoke agent",
          name: "Runtime Smoke Agent",
          enabled: true,
          modelId,
          isPrimary: true,
          policy: {
            preset: "worker",
            missingToolBehavior: "ask-setup",
            installScope: "workspace",
            fileAccess: "workspace-only",
            networkAccess: "restricted"
          }
        }
      ]
    })
  }, 120_000);

  if (!response.ok) {
    record("safe smoke workspace creation", "BLOCKED", response.body?.error ?? `status=${response.status}`);
    return null;
  }

  record("safe smoke workspace creation", "PASS", `agent=${agentId}`);

  const refreshed = await snapshot(true);
  if (!refreshed.ok) {
    return null;
  }

  return selectWorkspaceBackedAgent(refreshed.body) ??
    (Array.isArray(refreshed.body?.agents) ? refreshed.body.agents.find((agent) => agent?.id === agentId) : null) ??
    null;
}

function findTaskByDispatch(currentSnapshot, dispatchId, runId) {
  const tasks = Array.isArray(currentSnapshot?.tasks) ? currentSnapshot.tasks : [];

  return tasks.find((task) => {
    if (dispatchId && task?.dispatchId === dispatchId) {
      return true;
    }

    return Boolean(runId && Array.isArray(task?.runIds) && task.runIds.includes(runId));
  }) ?? null;
}

function runtimeIdForTask(task) {
  return task?.primaryRuntimeId ??
    (Array.isArray(task?.runtimeIds) ? task.runtimeIds.find((runtimeId) => typeof runtimeId === "string" && runtimeId) : null) ??
    null;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const initialSnapshot = await snapshot(true);
if (!initialSnapshot.ok) {
  const status = initialSnapshot.status === 401 ? "BLOCKED" : "FAIL";
  record("running AgentOS server", status, initialSnapshot.body?.error ?? `status=${initialSnapshot.status}`);
  finish();
}

record(
  "running AgentOS server",
  initialSnapshot.body?.diagnostics ? "PASS" : "FAIL",
  `health=${initialSnapshot.body?.diagnostics?.health ?? "unknown"}`
);

const readinessIssues = initialSnapshot.body?.diagnostics?.modelReadiness?.issues;
if (Array.isArray(readinessIssues) && readinessIssues.length > 0) {
  record("model readiness", "BLOCKED", readinessIssues.join(" | "));
  finish();
}

let agent = selectWorkspaceBackedAgent(initialSnapshot.body);

if (!agent) {
  record("workspace-backed agent selection", "BLOCKED", "no matching workspace-backed agent found; attempting safe smoke workspace creation");
  agent = await createSafeSmokeAgent(initialSnapshot.body);
} else {
  record("workspace-backed agent selection", "PASS", `agent=${agent.id}; workspace=${agent.workspaceId}`);
}

if (!agent?.id || !agent?.workspaceId) {
  record("workspace-backed agent availability", "BLOCKED", "no usable OpenClaw agent is available for a real mission dispatch");
  finish();
}

const mission = [
  "AgentOS runtime golden-path smoke.",
  "Reply with one short sentence containing the words AGENTOS_RUNTIME_SMOKE_READY.",
  `Nonce: ${Date.now()}`
].join("\n");
const missionResponse = await request("/api/mission", {
  method: "POST",
  body: JSON.stringify({
    mission,
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    thinking: "off"
  })
}, 120_000);

if (!missionResponse.ok) {
  const message = missionResponse.body?.error ?? `status=${missionResponse.status}`;
  record(/auth|credential|model|login|provider|not ready/i.test(message) ? "mission dispatch readiness" : "mission dispatch", /auth|credential|model|login|provider|not ready/i.test(message) ? "BLOCKED" : "FAIL", message);
  finish();
}

const dispatchId = readString(missionResponse.body?.dispatchId);
const runId = readString(missionResponse.body?.runId);
record("real mission dispatch", dispatchId || runId ? "PASS" : "FAIL", `dispatch=${dispatchId ?? "none"}; run=${runId ?? "none"}; status=${missionResponse.body?.status ?? "unknown"}`);

const taskSnapshot = await poll(
  "task polling",
  () => snapshot(true),
  (candidate) => candidate?.ok && findTaskByDispatch(candidate.body, dispatchId, runId)
);
const task = taskSnapshot?.ok ? findTaskByDispatch(taskSnapshot.body, dispatchId, runId) : null;

if (!task?.id) {
  finish();
}

record("task visibility", "PASS", `task=${task.id}; status=${task.status}; runtimes=${task.runtimeIds?.length ?? 0}`);

const runtimeId = runtimeIdForTask(task);
if (!runtimeId) {
  record("runtime linkage", "FAIL", "task did not expose a runtime id");
  finish();
}

const runtimeOutput = await request(`/api/runtimes/${encodeURIComponent(runtimeId)}`, {}, 45_000);
const hasRuntimeEvidence = runtimeOutput.ok &&
  runtimeOutput.body?.status !== "missing" &&
  (Array.isArray(runtimeOutput.body?.items) || typeof runtimeOutput.body?.finalText === "string");
record(
  "runtime output and transcript",
  hasRuntimeEvidence ? "PASS" : "FAIL",
  runtimeOutput.ok
    ? `runtime=${runtimeId}; status=${runtimeOutput.body?.status}; items=${runtimeOutput.body?.items?.length ?? 0}`
    : runtimeOutput.body?.error ?? `status=${runtimeOutput.status}`
);

const controlResponse = await request(`/api/tasks/${encodeURIComponent(task.id)}/control`, {
  method: "POST",
  body: JSON.stringify({
    action: "continue",
    message: "Continue the smoke test in the same OpenClaw session. Reply with AGENTOS_RUNTIME_SMOKE_CONTINUED.",
    dispatchId,
    idempotencyKey: `${dispatchId || task.id}:continue:runtime-golden-smoke`
  })
}, 120_000);

if (!controlResponse.ok) {
  const message = controlResponse.body?.error ?? `status=${controlResponse.status}`;
  record(/session|auth|credential|model|login|provider|not ready/i.test(message) ? "task continuation readiness" : "task continuation", /session|auth|credential|model|login|provider|not ready/i.test(message) ? "BLOCKED" : "FAIL", message);
  finish();
}

const continuationRunId =
  readString(controlResponse.body?.result?.result?.runId) ??
  readString(controlResponse.body?.result?.target?.runId);
record(
  "task continuation",
  continuationRunId || controlResponse.body?.result?.ok ? "PASS" : "FAIL",
  `run=${continuationRunId ?? "unknown"}; warning=${controlResponse.body?.result?.warning ?? "none"}`
);

const followUpSnapshot = await poll(
  "follow-up runtime metadata",
  () => snapshot(true),
  (candidate) => {
    if (!candidate?.ok) {
      return false;
    }

    const nextTask = findTaskByDispatch(candidate.body, dispatchId, continuationRunId ?? runId);
    const runtimes = Array.isArray(candidate.body?.runtimes) ? candidate.body.runtimes : [];

    return Boolean(
      nextTask?.runIds?.includes?.(continuationRunId) ||
      runtimes.some((runtime) => continuationRunId && runtime?.runId === continuationRunId)
    );
  },
  90_000,
  3_000
);

if (followUpSnapshot?.ok) {
  const bridge = followUpSnapshot.body?.diagnostics?.eventBridge;
  const bridgeMode = bridge?.mode ?? followUpSnapshot.body?.diagnostics?.capabilityMatrix?.eventBridge ?? "unknown";
  const bridgeDetail = bridge?.message ?? bridge?.lastError ?? `mode=${bridgeMode}`;
  record(
    "Gateway event stream or polling fallback visibility",
    bridgeMode === "live" || bridgeMode === "gateway-events" || bridgeMode === true || bridgeMode === "polling" ? "PASS" : "BLOCKED",
    bridgeDetail
  );
}

finish();
