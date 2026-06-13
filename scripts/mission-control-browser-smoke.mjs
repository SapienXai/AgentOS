#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const baseUrl = (process.env.AGENTOS_SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const requestTimeoutMs = Number.parseInt(process.env.AGENTOS_SMOKE_TIMEOUT_MS || "15000", 10);
const missionControlPath = process.env.AGENTOS_MISSION_CONTROL_PATH?.trim() || "/";
const expectedAgentId = process.env.AGENTOS_MISSION_CONTROL_SMOKE_AGENT_ID?.trim() || null;
const expectPollingFallback = process.env.AGENTOS_SMOKE_EXPECT_POLLING_FALLBACK === "1";
const accessToken =
  process.env.AGENTOS_SMOKE_API_TOKEN?.trim() ||
  process.env.AGENTOS_API_TOKEN?.trim() ||
  process.env.AGENTOS_ACCESS_TOKEN?.trim() ||
  process.env.AGENTOS_AUTH_TOKEN?.trim() ||
  null;
const jsonOutputPath = process.env.AGENTOS_SMOKE_JSON_OUTPUT?.trim() || null;
const allowDataBlocked = process.env.AGENTOS_SMOKE_ALLOW_DATA_BLOCKED === "1";

const checks = [];

function record(name, status, detail = "") {
  checks.push({ name, status, detail });
  const suffix = detail ? ` - ${detail}` : "";
  console.log(`${status} ${name}${suffix}`);
}

async function requestJson(path) {
  const response = await timedFetch(path);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function requestText(path) {
  const response = await timedFetch(path);
  const body = await response.text().catch(() => "");
  return { response, body };
}

async function timedFetch(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : 15000);

  try {
    return await fetch(`${baseUrl}${path}`, {
      headers: authHeaders(),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`${path}: ${formatError(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function assert(condition, name, detail) {
  if (!condition) {
    record(name, "FAIL", detail);
    return false;
  }

  record(name, "PASS", detail);
  return true;
}

function skip(name, detail) {
  record(name, "SKIP", detail);
}

function blocked(name, detail) {
  record(name, "BLOCKED", detail);
}

function isDataBlockedCheck(check) {
  return check.status === "BLOCKED" &&
    (
      check.name === "Agent inspector smoke" ||
      check.name === "Task inspector provenance" ||
      check.name === "Follow-up confidence states"
    );
}

try {
  const page = await requestText(missionControlPath);
  if (!assert(page.response.ok, "Mission Control page loads", `path=${missionControlPath}; status=${page.response.status}`)) {
    throw new Error("Mission Control page did not load.");
  }
  assert(/<html/i.test(page.body) || /__next/i.test(page.body), "Mission Control returns browser HTML");

  const snapshotResult = await requestJson("/api/snapshot?force=true");
  if (!assert(snapshotResult.response.ok, "Snapshot API loads", `status=${snapshotResult.response.status}`)) {
    throw new Error(snapshotResult.body?.error || "Snapshot API did not load.");
  }

  const snapshot = snapshotResult.body;
  assert(Array.isArray(snapshot?.workspaces), "Snapshot has workspaces", `${snapshot?.workspaces?.length ?? 0} workspace(s)`);
  assert(Array.isArray(snapshot?.agents), "Snapshot has agents", `${snapshot?.agents?.length ?? 0} agent(s)`);

  const agent =
    (expectedAgentId ? snapshot.agents?.find((entry) => entry.id === expectedAgentId) : null) ??
    snapshot.agents?.find((entry) => entry.id === "main") ??
    snapshot.agents?.[0] ??
    null;

  if (!agent) {
    blocked("Agent inspector smoke", "No AgentOS agent exists in the snapshot.");
  } else {
    assert(typeof agent.sessionCount === "number", "Agent inspector exposes session count", `agent=${agent.id}`);
    assert(Array.isArray(agent.activeRuntimeIds), "Agent inspector exposes runtime ids", `${agent.activeRuntimeIds?.length ?? 0} active runtime(s)`);

    const contextResult = await requestJson(`/api/agents/${encodeURIComponent(agent.id)}/context`);
    if (assert(contextResult.response.ok, "Context Engine snapshot loads", `agent=${agent.id}; status=${contextResult.response.status}`)) {
      const contextSnapshot = contextResult.body;
      const files = Array.isArray(contextSnapshot?.files) ? contextSnapshot.files : [];
      assert(files.length > 0, "Context Engine exposes file list", `${files.length} file(s)`);

      const readableFile = files.find((file) => file.exists && file.path) ?? files.find((file) => file.path) ?? null;
      if (readableFile) {
        const fileResult = await requestJson(
          `/api/agents/${encodeURIComponent(agent.id)}/context/file?path=${encodeURIComponent(readableFile.path)}`
        );
        if (assert(fileResult.response.ok, "Context Engine selected file loads", `path=${readableFile.path}; status=${fileResult.response.status}`)) {
          const content = typeof fileResult.body?.content === "string" ? fileResult.body.content : "";
          assert(content.trim().length > 0, "Context Engine selected file has content", `${content.length} char(s)`);
        }
      } else {
        record("Context Engine selected file loads", "FAIL", "No file path was available.");
      }
    }
  }

  const task = Array.isArray(snapshot?.tasks) ? snapshot.tasks[0] : null;
  if (!task) {
    skip("Task inspector provenance", "No task exists in the current snapshot.");
    skip("Follow-up confidence states", "No task exists in the current snapshot.");
  } else {
    const linkedRuntimeIds = Array.isArray(task.runtimeIds) ? task.runtimeIds : [];
    const linkedSessionIds = Array.isArray(task.sessionIds) ? task.sessionIds : [];
    const linkedRunIds = Array.isArray(task.runIds) ? task.runIds : [];
    assert(Boolean(task.id), "Task inspector exposes task id", `task=${task.id}`);
    assert(
      Boolean(task.dispatchId || linkedSessionIds.length || linkedRunIds.length || linkedRuntimeIds.length),
      "Task inspector exposes session/run provenance",
      `sessions=${linkedSessionIds.length}; runs=${linkedRunIds.length}; runtimes=${linkedRuntimeIds.length}; dispatch=${task.dispatchId || "none"}`
    );

    const confidenceGroups = new Set(
      snapshot.tasks
        .map((entry) => entry?.metadata?.continuationConfidence)
        .filter((value) => value === "high" || value === "medium" || value === "none")
    );
    if (confidenceGroups.size > 0) {
      record("Follow-up confidence states", "PASS", Array.from(confidenceGroups).join(", "));
    } else {
      skip("Follow-up confidence states", "No task exposes continuationConfidence metadata.");
    }
  }

  const eventBridge = snapshot?.diagnostics?.eventBridge;
  if (eventBridge?.mode === "polling" || eventBridge?.mode === "reconnecting") {
    record("Polling fallback notice", "PASS", eventBridge.message || `mode=${eventBridge.mode}`);
  } else if (expectPollingFallback) {
    record("Polling fallback notice", "FAIL", `Expected degraded event stream, got ${eventBridge?.mode ?? "unknown"}.`);
  } else {
    skip("Polling fallback notice", `Gateway event stream is ${eventBridge?.mode ?? "unknown"}.`);
  }
} catch (error) {
  blocked("Mission Control smoke", formatError(error));
}

const failed = checks.filter((check) => check.status === "FAIL");
const blockedChecks = checks.filter((check) => check.status === "BLOCKED");
const requiredBlockedChecks = allowDataBlocked
  ? blockedChecks.filter((check) => !isDataBlockedCheck(check))
  : blockedChecks;
const result = {
  baseUrl,
  missionControlPath,
  allowDataBlocked,
  generatedAt: new Date().toISOString(),
  status: failed.length > 0 ? "FAIL" : requiredBlockedChecks.length > 0 ? "BLOCKED" : "PASS",
  checks
};

if (jsonOutputPath) {
  mkdirSync(path.dirname(jsonOutputPath), { recursive: true });
  writeFileSync(jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (failed.length > 0) {
  process.exitCode = 1;
} else if (requiredBlockedChecks.length > 0) {
  process.exitCode = 2;
} else {
  console.log("PASS Mission Control smoke completed.");
}

function formatError(error) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `request timed out after ${requestTimeoutMs}ms`;
    }

    if ("cause" in error && error.cause instanceof Error) {
      return `${error.message}: ${error.cause.message}`;
    }

    return error.message;
  }

  return String(error);
}
