import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import WebSocket from "ws";

import { getOpenClawServerMethodContractDiff } from "@/lib/openclaw/application/update-contract-diff-service";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import {
  DEFAULT_NATIVE_TIMEOUT_MS,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-types";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { redactGatewayUrl } from "@/lib/openclaw/compat/targets";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import { bridgeOpenClawStaticRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-bridge";
import { runOpenClawRuntimeCertification } from "@/lib/openclaw/runtime-certification/harness";
import type {
  OpenClawRuntimeCertificationContext,
  OpenClawRuntimeCertificationProbe,
  OpenClawRuntimeCertificationReport
} from "@/lib/openclaw/runtime-certification/types";

const TARGET_VERSION = process.env.OPENCLAW_RUNTIME_CERT_TARGET?.trim() || "2026.8.1";
const GATEWAY_URL = process.env.OPENCLAW_RUNTIME_CERT_GATEWAY_URL?.trim() || "ws://127.0.0.1:18789";
const TOKEN =
  process.env.OPENCLAW_RUNTIME_CERT_TOKEN?.trim() ||
  process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() ||
  null;
const OUTPUT_PATH = process.env.OPENCLAW_RUNTIME_CERT_OUTPUT?.trim() || null;
const QUIET = process.env.OPENCLAW_RUNTIME_CERT_QUIET === "1";
const FULL_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
  "operator.talk.secrets"
];

async function main() {
  if (!TOKEN) {
    console.error("OpenClaw runtime certification requires OPENCLAW_RUNTIME_CERT_TOKEN or AGENTOS_OPENCLAW_GATEWAY_TOKEN.");
    return 1;
  }

  const fullClient = createClient(FULL_SCOPES);
  const readClient = createClient(["operator.read"]);
  let report: OpenClawRuntimeCertificationReport | null = null;

  try {
    const handshake = await fullClient.probeNativeHandshake({ timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS });
    const readHandshake = await readClient.probeNativeHandshake({ timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS });
    const sessionKey = `agent:dev:agentos-runtime-cert-${Date.now()}`;
    const questionRequestId = `agentos-runtime-cert-question-${Date.now()}`;
    const cronName = `agentos-runtime-cert-${Date.now()}`;
    const contextClients = {
      full: {
        client: fullClient,
        handshake,
        probeHandshake: () => fullClient.probeNativeHandshake({ timeoutMs: 2_000 })
      },
      read: {
        client: readClient,
        handshake: readHandshake,
        probeHandshake: () => readClient.probeNativeHandshake({ timeoutMs: 2_000 })
      }
    };
    const probes = createProbes({ sessionKey, questionRequestId, cronName });

    report = await runOpenClawRuntimeCertification({
      targetVersion: TARGET_VERSION,
      gatewayUrl: redactGatewayUrl(GATEWAY_URL) ?? "[redacted]",
      handshake,
      clients: contextClients,
      defaultClientId: "full",
      probes
    });

    const staticReport = await getOpenClawServerMethodContractDiff({
      currentVersion: OPENCLAW_RECOMMENDED_VERSION,
      targetVersion: TARGET_VERSION
    });
    const evidenceBridge = bridgeOpenClawStaticRuntimeEvidence({
      staticReport,
      runtimeReport: report
    });

    const output = {
      runtime: report,
      staticContract: {
        source: staticReport.source,
        currentVersion: staticReport.currentVersion,
        targetVersion: staticReport.targetVersion,
        status: staticReport.status,
        targetMethodCount: staticReport.targetMethodCount,
        changedServerMethodFiles: staticReport.changedServerMethodFiles,
        changedProtocolFiles: staticReport.changedProtocolFiles,
        changes: staticReport.changes,
        blockerCount: staticReport.blockerCount,
        warningCount: staticReport.warningCount,
        unknownCount: staticReport.unknownCount,
        error: staticReport.error
      },
      evidenceBridge
    };

    await writeReport(output);
    printSummary(report, evidenceBridge.summary);
    return report.summary.requiredFailures > 0 ? 1 : 0;
  } catch (error) {
    const normalized = normalizeClientError(error);
    console.error(`OpenClaw runtime certification could not complete: ${normalized.message}`);
    return 1;
  } finally {
    fullClient.close("runtime certification complete");
    readClient.close("runtime certification complete");
  }
}

function createClient(scopes: string[]) {
  return new NativeWsOpenClawGatewayClient({
    url: GATEWAY_URL,
    token: TOKEN,
    scopes,
    timeoutMs: DEFAULT_NATIVE_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-runtime-certification",
    webSocketFactory: WebSocket as unknown as WebSocketFactory
  });
}

function createProbes(input: {
  sessionKey: string;
  questionRequestId: string;
  cronName: string;
}): OpenClawRuntimeCertificationProbe[] {
  const uniqueSessionLabel = `AgentOS runtime certification ${Date.now()}`;
  const sessionData = (context: OpenClawRuntimeCertificationContext) => {
    const sessionId = typeof context.data.sessionId === "string" ? context.data.sessionId : undefined;
    const lifecycleRevision = typeof context.data.lifecycleRevision === "number"
      ? context.data.lifecycleRevision
      : undefined;
    return {
      key: input.sessionKey,
      archived: true,
      ...(sessionId ? { expectedSessionId: sessionId } : {}),
      ...(lifecycleRevision !== undefined ? { expectedLifecycleRevision: lifecycleRevision } : {})
    };
  };

  return [
    probe("gateway-health", "Gateway handshake", "health", null, {
      params: {},
      validateResponse: objectWith("ok")
    }),
    probe("sessions-list", "Sessions", "sessions.list", "operator.read", {
      validateResponse: objectWith("sessions")
    }),
    probe("sessions-create", "Session lifecycle", "sessions.create", "operator.write", {
      params: {
        key: input.sessionKey,
        agentId: "dev",
        label: uniqueSessionLabel
      },
      validateResponse: objectWith("ok", "key", "sessionId"),
      captureResponse: (payload, context) => {
        const record = asRecord(payload);
        const sessionId = readString(record?.sessionId) ?? readString(asRecord(record?.entry)?.sessionId);
        if (sessionId) context.data.sessionId = sessionId;
      }
    }),
    probe("sessions-describe", "Session details", "sessions.describe", "operator.read", {
      params: { key: input.sessionKey },
      validateResponse: objectWith("session"),
      captureResponse: (payload, context) => {
        const session = asRecord(asRecord(payload)?.session);
        const lifecycleRevision = session?.lifecycleRevision;
        if (typeof lifecycleRevision === "number") context.data.lifecycleRevision = lifecycleRevision;
        const sessionId = readString(session?.sessionId);
        if (sessionId) context.data.sessionId = sessionId;
      }
    }),
    probe("sessions-preview", "Session preview", "sessions.preview", "operator.read", {
      params: { keys: [input.sessionKey] },
      validateResponse: objectWith("previews")
    }),
    probe("chat-history", "Chat history", "chat.history", "operator.read", {
      params: { sessionKey: input.sessionKey, limit: 20 },
      validateResponse: objectWith("messages", "sessionKey")
    }),
    probe("chat-send-stream", "Chat send and stream", "chat.send", "operator.write", {
      skipReason: "Chat send/stream execution was skipped because isolated runtime model credentials are not configured and sending could incur provider cost."
    }),
    probe("sessions-subscribe", "Session event subscription", "sessions.subscribe", "operator.read", {
      params: {},
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-messages-subscribe", "Session message subscription", "sessions.messages.subscribe", "operator.read", {
      params: { key: input.sessionKey },
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-messages-unsubscribe", "Session message unsubscription", "sessions.messages.unsubscribe", "operator.read", {
      params: { key: input.sessionKey },
      validateResponse: objectWith("subscribed")
    }),
    probe("sessions-patch-label", "Session metadata patch", "sessions.patch", "operator.write", {
      params: { key: input.sessionKey, label: `${uniqueSessionLabel} patched` },
      validateResponse: objectWith("ok", "key")
    }),
    probe("sessions-patch-read-denial", "Read-only session patch denial", "sessions.patch", "operator.write", {
      clientId: "read",
      params: { key: input.sessionKey, label: `${uniqueSessionLabel} read denied` },
      expectedOutcome: "authorization-denied"
    }),
    probe("sessions-abort-idle", "Idle session abort", "sessions.abort", "operator.write", {
      params: { key: input.sessionKey },
      validateResponse: objectWith("ok")
    }),
    probe("sessions-patch-archive", "Session lifecycle archive", "sessions.patch", "operator.admin", {
      params: sessionData,
      validateResponse: objectWith("ok", "key")
    }),
    probe("sessions-delete-archived", "Archived session deletion", "sessions.delete", "operator.write", {
      params: () => ({ key: input.sessionKey, archivedOnly: true, deleteTranscript: false }),
      validateResponse: objectWith("ok", "deleted")
    }),
    probe("sessions-delete-read-denial", "Read-only session deletion denial", "sessions.delete", "operator.admin", {
      clientId: "read",
      params: { key: input.sessionKey, archivedOnly: false },
      expectedOutcome: "authorization-denied"
    }),
    probe("sessions-create-read-denial", "Read-only session creation denial", "sessions.create", "operator.write", {
      clientId: "read",
      params: { key: `${input.sessionKey}-read-denied`, agentId: "dev" },
      expectedOutcome: "authorization-denied"
    }),
    probe("agent-read-denial", "Read-only agent invocation denial", "agent", "operator.write", {
      clientId: "read",
      params: {
        message: "AgentOS runtime authorization probe",
        agentId: "dev",
        sessionKey: input.sessionKey,
        deliver: false,
        timeout: 1
      },
      expectedOutcome: "authorization-denied"
    }),
    probe("agents-list", "Agent catalog", "agents.list", "operator.read", {
      validateResponse: objectWith("agents")
    }),
    probe("agents-create", "Disposable agent creation", "agents.create", "operator.admin", {
      params: {
        name: `agentos-runtime-cert-agent-${Date.now()}`,
        workspace: path.join(process.env.OPENCLAW_RUNTIME_CERT_WORKSPACE?.trim() || "/tmp", "agentos-runtime-cert-workspace")
      },
      validateResponse: objectWith("ok", "agentId"),
      captureResponse: (payload, context) => {
        const agentId = readString(asRecord(payload)?.agentId);
        if (agentId) context.data.agentId = agentId;
      }
    }),
    probe("agents-update", "Disposable agent update", "agents.update", "operator.admin", {
      params: (context) => ({
        agentId: typeof context.data.agentId === "string" ? context.data.agentId : "agentos-runtime-cert-agent-missing",
        name: `AgentOS runtime certification updated ${Date.now()}`
      }),
      validateResponse: objectWith("ok", "agentId")
    }),
    probe("agents-delete", "Disposable agent deletion", "agents.delete", "operator.admin", {
      params: (context) => ({ agentId: typeof context.data.agentId === "string" ? context.data.agentId : "agentos-runtime-cert-agent-missing" }),
      validateResponse: objectWith("ok", "agentId")
    }),
    probe("config-get", "Config snapshot", "config.get", "operator.read", {
      validateResponse: objectWith("config", "hash"),
      captureResponse: (payload, context) => {
        const hash = readString(asRecord(payload)?.hash);
        if (hash) context.data.configHash = hash;
      }
    }),
    probe("config-schema", "Config schema", "config.schema", "operator.read", {
      validateResponse: objectWith("schema")
    }),
    probe("config-schema-lookup", "Config schema lookup", "config.schema.lookup", "operator.read", {
      params: { path: "gateway" },
      validateResponse: objectWith("schema")
    }),
    probe("config-patch-noop", "No-op config patch", "config.patch", "operator.admin", {
      params: (context) => ({
        raw: "{}",
        ...(typeof context.data.configHash === "string" ? { baseHash: context.data.configHash } : {})
      }),
      validateResponse: objectWith("ok")
    }),
    probe("config-patch-read-denial", "Read-only config mutation denial", "config.patch", "operator.write", {
      clientId: "read",
      params: { raw: "{}" },
      expectedOutcome: "authorization-denied"
    }),
    probe("models-list", "Model catalog", "models.list", "operator.read", {
      validateResponse: objectWith("models")
    }),
    probe("models-auth-status", "Model auth status", "models.authStatus", "operator.read", {
      validateResponse: objectWith("providers")
    }),
    probe("models-probe", "Model provider probe", "models.probe", "operator.read", {
      skipReason: "Provider probing was skipped because isolated runtime credentials are not configured and probing may incur network or provider cost."
    }),
    probe("models-auth-logout", "Model auth logout", "models.authLogout", "operator.admin", {
      skipReason: "Credential logout was skipped because it is destructive and not required for runtime contract certification."
    }),
    probe("approval-list", "Execution approval list", "exec.approval.list", "operator.approvals", {
      validateResponse: (payload) => ({ valid: Array.isArray(payload), evidence: "Approval list returned an array." })
    }),
    probe("question-list", "Question list", "question.list", "operator.questions", {
      validateResponse: objectWith("questions")
    }),
    probe("question-request", "Question request", "question.request", "operator.questions", {
      params: {
        id: input.questionRequestId,
        questions: [{
          questionId: "runtime_certification",
          header: "Verify",
          question: "AgentOS runtime certification question",
          options: [{ label: "Continue" }, { label: "Cancel" }]
        }],
        timeoutMs: 10_000
      },
      validateResponse: objectWith("id"),
      captureResponse: (payload, context) => {
        const id = readString(asRecord(payload)?.id);
        if (id) context.data.questionId = id;
      }
    }),
    probe("question-get", "Question retrieval", "question.get", "operator.questions", {
      params: (context) => ({ id: typeof context.data.questionId === "string" ? context.data.questionId : input.questionRequestId }),
      validateResponse: objectWith("question")
    }),
    probe("question-wait-answer", "Question wait", "question.waitAnswer", "operator.questions", {
      params: (context) => ({
        id: typeof context.data.questionId === "string" ? context.data.questionId : input.questionRequestId,
        timeoutMs: 10
      }),
      validateResponse: objectWith("status")
    }),
    probe("question-resolve-cancel", "Question cancellation", "question.resolve", "operator.questions", {
      params: (context) => ({
        id: typeof context.data.questionId === "string" ? context.data.questionId : input.questionRequestId,
        cancel: true
      }),
      validateResponse: objectWith("status")
    }),
    probe("node-list", "Node list", "node.list", "operator.read", {
      validateResponse: objectWith("nodes")
    }),
    probe("node-pair-list", "Node pairing list", "node.pair.list", "operator.pairing", {
      validateResponse: objectWith("pending", "paired")
    }),
    probe("node-invoke", "Paired node invocation", "node.invoke", "operator.write", {
      skipReason: "Node invocation was skipped because the isolated runtime has no paired node and no safe command target."
    }),
    probe("node-invoke-read-denial", "Read-only node invocation denial", "node.invoke", "operator.write", {
      clientId: "read",
      params: {
        nodeId: "agentos-runtime-cert-missing-node",
        command: "device.info",
        params: {},
        idempotencyKey: `agentos-runtime-cert-${Date.now()}`
      },
      expectedOutcome: "authorization-denied"
    }),
    probe("device-pair-list", "Device pairing list", "device.pair.list", "operator.pairing", {
      validateResponse: objectWith("pending", "paired")
    }),
    probe("talk-config", "Talk configuration", "talk.config", "operator.read", {
      validateResponse: objectWith("config")
    }),
    probe("talk-config-secrets-denial", "Talk secret configuration denial", "talk.config", "operator.talk.secrets", {
      clientId: "read",
      params: { includeSecrets: true },
      expectedOutcome: "authorization-denied"
    }),
    probe("talk-catalog", "Talk catalog", "talk.catalog", "operator.read", {
      validateResponse: objectWith("modes", "transports")
    }),
    probe("talk-session", "Talk session", "talk.session.create", "operator.talk.secrets", {
      skipReason: "Talk session creation and audio transport were skipped because no provider, microphone, or audio transport is configured in the isolated runtime."
    }),
    probe("memory-status", "Memory status", "doctor.memory.status", "operator.read", {
      params: { agentId: "dev" },
      validateResponse: objectWith("agentId", "embedding")
    }),
    probe("memory-dream-diary", "Memory dream diary", "doctor.memory.dreamDiary", "operator.read", {
      params: { agentId: "dev" },
      validateResponse: objectWith("agentId")
    }),
    probe("memory-search", "Memory search", "memory.search", "operator.read", {
      skipReason: "Semantic memory search was skipped because isolated runtime embedding credentials are not configured."
    }),
    probe("cron-status", "Cron status", "cron.status", "operator.read", {
      validateResponse: objectWith("enabled", "jobs")
    }),
    probe("cron-list", "Cron list", "cron.list", "operator.read", {
      validateResponse: objectWith("jobs")
    }),
    probe("cron-add", "Disposable cron creation", "cron.add", "operator.admin", {
      params: {
        name: input.cronName,
        agentId: "dev",
        schedule: { kind: "every", everyMs: 3_600_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "AgentOS runtime certification probe" },
        enabled: false,
        deleteAfterRun: true
      },
      validateResponse: (payload) => ({ valid: Boolean(asRecord(payload)?.id || asRecord(asRecord(payload)?.job)?.id), evidence: "Disabled disposable cron job was created." }),
      captureResponse: (payload, context) => {
        const record = asRecord(payload);
        const job = asRecord(record?.job);
        const id = readString(record?.id) ?? readString(job?.id);
        if (id) context.data.cronId = id;
      }
    }),
    probe("cron-update", "Disposable cron update", "cron.update", "operator.admin", {
      params: (context) => ({
        id: typeof context.data.cronId === "string" ? context.data.cronId : "agentos-runtime-cert-missing",
        patch: { name: `${input.cronName}-updated` }
      }),
      validateResponse: objectWith("id")
    }),
    probe("cron-remove", "Disposable cron removal", "cron.remove", "operator.admin", {
      params: (context) => ({ id: typeof context.data.cronId === "string" ? context.data.cronId : "agentos-runtime-cert-missing" }),
      validateResponse: objectWith("removed")
    }),
    probe("cron-run", "Cron execution", "cron.run", "operator.admin", {
      skipReason: "Cron execution was skipped because the job would enter an agent runtime and no model credentials are configured."
    }),
    probe("gateway-restart-preflight", "Gateway restart preflight", "gateway.restart.preflight", "operator.admin", {
      validateResponse: objectWith("safe", "counts", "blockers", "summary")
    }),
    probe("gateway-restart-recovery", "Gateway restart and reconnect", "gateway.restart.request", "operator.admin", {
      params: { reason: "AgentOS runtime certification isolated recovery probe" },
      execute: async (context) => {
        const clientContext = context.clients.full;
        const accepted = await clientContext.client.callNative("gateway.restart.request", { reason: "AgentOS runtime certification isolated recovery probe" }, { timeoutMs: 4_000 }, { safety: "mutation", timeoutMs: 4_000 });
        await wait(1_000);
        if (!clientContext.probeHandshake) return accepted;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            const recovered = await clientContext.probeHandshake();
            context.data.recoveredHandshake = recovered;
            return { accepted, recovered: true };
          } catch (error) {
            lastError = error;
            await wait(500);
          }
        }
        throw lastError ?? new Error("Gateway did not reconnect after restart request.");
      },
      validateResponse: (payload) => ({ valid: asRecord(payload)?.recovered === true, evidence: "Restart request was accepted and a fresh native handshake succeeded." })
    })
  ];
}

function probe(
  id: string,
  operation: string,
  method: string,
  expectedScope: string | null,
  options: Omit<OpenClawRuntimeCertificationProbe, "id" | "operation" | "method" | "expectedScope">
): OpenClawRuntimeCertificationProbe {
  return { id, operation, method, expectedScope, ...options };
}

function objectWith(...keys: string[]) {
  return (payload: unknown) => {
    const record = asRecord(payload);
    return {
      valid: Boolean(record && keys.every((key) => Object.hasOwn(record, key))),
      evidence: `Response object ${keys.length > 0 ? `contains ${keys.join(", ")}` : "was received"}.`
    };
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function writeReport(output: unknown) {
  const serialized = JSON.stringify(output, null, 2);
  if (!QUIET) {
    console.log("OPENCLAW_RUNTIME_CERTIFICATION_JSON_START");
    console.log(serialized);
    console.log("OPENCLAW_RUNTIME_CERTIFICATION_JSON_END");
  }
  if (OUTPUT_PATH) {
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${serialized}\n`, "utf8");
  }
}

function printSummary(
  report: OpenClawRuntimeCertificationReport,
  bridgeSummary: { certified: number; failed: number; uncertified: number; staticOnly: number }
) {
  console.log(
    `OpenClaw ${report.targetVersion} runtime certification: ${report.summary.passed} PASS, ${report.summary.failed} FAIL, ${report.summary.skipped} SKIPPED, ${report.summary.expectedDenials} EXPECTED-DENIAL, ${report.summary.unknown} UNKNOWN.`
  );
  console.log(
    `Static to runtime evidence bridge: ${bridgeSummary.certified} certified, ${bridgeSummary.failed} failed, ${bridgeSummary.uncertified} uncertified, ${bridgeSummary.staticOnly} static-only.`
  );
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
