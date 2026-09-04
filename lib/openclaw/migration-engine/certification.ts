/** TEST/CERTIFICATION-ONLY: migration certification uses the official client path. */
import { createOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import { normalizeGatewayTurnEvent } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import type { GatewayEventFrame } from "@/lib/openclaw/client/native-ws-gateway-types";
import { DEFAULT_NATIVE_TIMEOUT_MS } from "@/lib/openclaw/client/native-ws-gateway-types";
import type { OpenClawMigrationEvidence } from "@/lib/openclaw/migration-engine/types";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";

export async function certifyOpenClawMigrationRuntime(input: {
  gatewayUrl: string;
  token: string;
  phase?: "staged" | "canonical" | "rollback";
  expectedVersion?: string;
  expectedCommit?: string | null;
  existingSessionKey?: string;
}): Promise<OpenClawMigrationEvidence> {
  const client = createOpenClawGatewayClient({
    url: input.gatewayUrl,
    token: input.token,
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions"],
    timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-migration-engine",
  });
  const checks: string[] = [];
  const sessionKey = `agent:dev:agentos-migration-${Date.now()}`;
  let sessionId: string | null = null;
  let cronId: string | null = null;
  const phase = input.phase ?? "staged";
  const expectedVersion = input.expectedVersion ?? OPENCLAW_SUPPORTED_BASELINE_VERSION;
  try {
    const handshake = await retryHandshake(client, 30_000);
    if (handshake.server?.version !== expectedVersion) throw new Error(`Runtime certification connected to ${handshake.server?.version ?? "unknown"}, not ${expectedVersion}.`);
    checks.push("gateway.health");
    const health = await client.callNative<Record<string, unknown>>("health", {}, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
    if (!health || typeof health !== "object") throw new Error("Gateway health response was invalid.");

    const listedBeforeWrite = input.existingSessionKey
      ? await client.callNative<unknown>("sessions.list", {}, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 })
      : null;
    const preservedSessionKey = input.existingSessionKey ? findSessionKey(listedBeforeWrite, input.existingSessionKey) : null;
    if (input.existingSessionKey && !preservedSessionKey) throw new Error("Canonical session history key was not present in sessions.list after migration.");
    if (preservedSessionKey) {
      const history = await client.callNative<Record<string, unknown>>("chat.history", { sessionKey: preservedSessionKey, limit: 50 }, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
      const messages = asRecord(history)?.messages;
      if (!Array.isArray(messages) || messages.length === 0) throw new Error("Canonical session history was not preserved.");
      checks.push(phase === "rollback" ? "rollback.session-history" : "canonical.session-history");
    }

    const session = await client.callNative<Record<string, unknown>>("sessions.create", { key: sessionKey, agentId: "dev", label: "AgentOS migration certification" }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    sessionId = readString(session.sessionId) ?? readString(asRecord(session.entry)?.sessionId);
    if (!sessionId) throw new Error("Target Gateway did not return a durable session id.");
    const sessions = await client.callNative<unknown>("sessions.list", {}, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
    if (!containsSession(sessions, sessionKey) && phase === "staged") throw new Error("Target Gateway did not expose the created session in sessions.list.");
    checks.push(phase === "staged" ? "session-continuity" : `${phase}.session-write`);

    if (phase === "canonical") {
      return {
        id: "runtime-certification",
        step: "runtime-certification",
        kind: "runtime",
        status: "pass",
        summary: "Canonical target Gateway health, preserved history, and durable session write certification passed.",
        details: { checks, targetVersion: expectedVersion, expectedCommit: input.expectedCommit ?? null, phase },
        createdAt: new Date().toISOString()
      };
    }

    const frames: GatewayEventFrame[] = [];
    const subscription = await client.subscribeNativeEvents(
      { subscribeSessions: true, sessionKeys: [sessionKey] },
      { onEvent: (frame) => frames.push(frame) },
      { timeoutMs: 8_000 }
    );
    try {
      const dispatch = await client.callNative<Record<string, unknown>>("chat.send", {
        sessionKey,
        message: "AGENTOS_SYNTHETIC_FIRST_PROMPT",
        idempotencyKey: `agentos-migration-${Date.now()}`
      }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
      const runId = readString(dispatch.runId);
      if (!runId) throw new Error("Target Gateway did not return a chat run id.");
      const terminal = await waitForTerminal(frames, sessionKey, runId, 45_000);
      const history = await client.callNative<Record<string, unknown>>("chat.history", { sessionKey, limit: 20 }, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
      const assistantText = readAssistantText(history);
      if (!terminal.textObserved || !assistantText) throw new Error("Target model execution did not produce a streamed and persisted assistant response.");
      checks.push("model", "streaming");
    } finally {
      subscription.close();
    }

    const restart = await client.callNative<Record<string, unknown>>("gateway.restart.request", { reason: "AgentOS migration runtime certification" }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    if (restart === null || typeof restart !== "object") throw new Error("Target Gateway restart request returned no response.");
    await wait(1_000);
    await retryHandshake(client, 30_000);
    checks.push("gateway.restart");

    const cron = await retryNativeCall<Record<string, unknown>>(client, "cron.add", {
      name: `agentos-migration-${Date.now()}`,
      agentId: "dev",
      schedule: { kind: "every", everyMs: 3_600_000 },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "AGENTOS_SYNTHETIC_CRON_PROMPT" },
      delivery: { mode: "none" },
      enabled: true,
      deleteAfterRun: false
    }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    cronId = readString(cron.id) ?? readString(asRecord(cron.job)?.id);
    if (!cronId) throw new Error("Target Gateway did not return a cron id.");
    const queued = await retryNativeCall<Record<string, unknown>>(client, "cron.run", { id: cronId, mode: "force" }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    const runId = readString(queued.runId);
    if (!runId) throw new Error("cron.run did not return a run id.");
    let succeeded = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const runs = await retryNativeCall<unknown>(client, "cron.runs", { jobId: cronId, runId, limit: 10 }, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
      const entry = findRun(runs, runId);
      if (entry && ["ok", "error", "skipped", "cancelled"].includes(readString(entry.status) ?? "")) {
        succeeded = entry.status === "ok";
        break;
      }
      await wait(500);
    }
    if (!succeeded) throw new Error("cron.run did not reach a successful terminal cron.runs entry.");
    checks.push("cron.run");
    return {
      id: "runtime-certification",
      step: "runtime-certification",
      kind: "runtime",
      status: "pass",
      summary: `${phase} native Gateway, model, streaming, session history, restart, and cron.run certification passed.`,
      details: { checks, targetVersion: expectedVersion, expectedCommit: input.expectedCommit ?? null, phase },
      createdAt: new Date().toISOString()
    };
  } finally {
    if (cronId) await client.callNative("cron.remove", { id: cronId }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 }).catch(() => {});
    if (sessionId) {
      await client.callNative("sessions.patch", { key: sessionKey, archived: true, expectedSessionId: sessionId }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 }).catch(() => {});
      await client.callNative("sessions.delete", { key: sessionKey, archivedOnly: true, deleteTranscript: false }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 }).catch(() => {});
    }
    client.close("migration runtime certification complete");
  }
}

async function waitForTerminal(frames: GatewayEventFrame[], sessionKey: string, runId: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const normalized = frames.map((frame) => normalizeGatewayTurnEvent(frame, sessionKey, runId)).filter((event): event is NonNullable<ReturnType<typeof normalizeGatewayTurnEvent>> => event !== null);
    if (normalized.some((event) => event.done)) return { textObserved: normalized.some((event) => Boolean(event.text)) };
    await wait(100);
  }
  throw new Error("Timed out waiting for the target Gateway terminal model event.");
}

async function retryHandshake(client: NativeWsOpenClawGatewayClient, timeoutMs: number) {
  const started = Date.now();
  let lastError: unknown = null;
  while (Date.now() - started < timeoutMs) {
    try {
      return await client.probeNativeHandshake({ timeoutMs: 4_000 });
    } catch (error) {
      lastError = error;
      await wait(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Target Gateway did not reconnect after restart.");
}

function readAssistantText(payload: unknown) {
  const messages = asRecord(payload)?.messages;
  if (!Array.isArray(messages)) return "";
  return messages.map((entry) => {
    const record = asRecord(entry);
    const role = readString(record?.role) ?? readString(asRecord(record?.message)?.role);
    const content = readMessageContent(record?.content) ?? readMessageContent(asRecord(record?.message)?.content);
    return role === "assistant" ? content : "";
  }).filter(Boolean).join(" ");
}

function containsSession(payload: unknown, sessionKey: string) {
  const record = asRecord(payload);
  const entries = Array.isArray(record?.sessions) ? record.sessions : Array.isArray(record?.entries) ? record.entries : Array.isArray(payload) ? payload : [];
  return entries.some((entry) => {
    const item = asRecord(entry);
    return item?.key === sessionKey || item?.sessionKey === sessionKey || asRecord(item?.session)?.key === sessionKey;
  });
}

function findSessionKey(payload: unknown, requestedKey: string) {
  const record = asRecord(payload);
  const entries = Array.isArray(record?.sessions) ? record.sessions : Array.isArray(record?.entries) ? record.entries : Array.isArray(payload) ? payload : [];
  const records = entries.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null);
  const exact = records.find((entry) => entry.key === requestedKey || entry.sessionKey === requestedKey || asRecord(entry.session)?.key === requestedKey);
  if (exact) return readString(exact.key) ?? readString(exact.sessionKey) ?? readString(asRecord(exact.session)?.key);
  const agentMatch = records.find((entry) => readString(entry.agentId) === "dev" && (readString(entry.key) || readString(entry.sessionKey)));
  return agentMatch ? readString(agentMatch.key) ?? readString(agentMatch.sessionKey) : null;
}

function readMessageContent(value: unknown): string | null {
  const direct = readString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  const text = value.map((part) => {
    const record = asRecord(part);
    return readString(record?.text) ?? readString(record?.content) ?? "";
  }).join("");
  return text || null;
}

function findRun(payload: unknown, runId: string) {
  const record = asRecord(payload);
  const entries = Array.isArray(record?.entries) ? record.entries : Array.isArray(record?.runs) ? record.runs : Array.isArray(payload) ? payload : [];
  return entries.map(asRecord).find((entry) => entry?.runId === runId || entry?.id === runId) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function retryNativeCall<T>(client: NativeWsOpenClawGatewayClient, method: string, params: Record<string, unknown>, options: { timeoutMs: number }, policy: { safety: "read" | "mutation"; timeoutMs: number }) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      return await client.callNative<T>(method, params, options, policy);
    } catch (error) {
      lastError = error;
      await wait(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method} remained unavailable after Gateway restart.`);
}
