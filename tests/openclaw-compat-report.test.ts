import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  clearOpenClawCompatibilityReportCacheForTesting,
  generateOpenClawCompatibilityReport,
  getCachedOpenClawCompatibilityReport,
  getOpenClawCompatibilityReport
} from "@/lib/openclaw/compat";
import { buildOpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/report-service";
import { resolveOpenClawCompatibilityTarget } from "@/lib/openclaw/compat/targets";
import {
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { FakeOpenClawGateway } from "@/tests/helpers/fake-openclaw-gateway";

afterEach(() => {
  clearOpenClawCompatibilityReportCacheForTesting();
});

test("compatibility report marks the stable advertised Gateway contract compatible", async () => {
  const gateway = createCompatibilityGateway([
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ]);

  const report = await generateOpenClawCompatibilityReport({
    ...baseReportOptions(gateway),
    includeLiveShapeChecks: true
  });

  assert.equal(report.status, "compatible");
  assert.equal(report.openClaw.installedVersion, OPENCLAW_SUPPORTED_BASELINE_VERSION);
  assert.equal(report.gateway.protocolStatus, "compatible");
  assert.equal(report.gateway.capabilitySource, "gateway-advertised");
  assert.equal(report.capabilities.find((capability) => capability.id === "models")?.status, "supported");
  assert.equal(report.capabilities.find((capability) => capability.id === "cliFallback")?.status, "supported");
  assert.equal(report.contracts.find((check) => check.operation === "models")?.status, "ok");
  assert.equal(report.contracts.find((check) => check.operation === "models")?.responseShapeStatus, "valid");
  assert.ok(report.summary.nativeGatewayCoveragePercent > 50);
});

test("compatibility report cache keeps stale data while refresh warms", async () => {
  const gateway = createCompatibilityGateway([
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ]);
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const report = await getOpenClawCompatibilityReport({
      ...baseReportOptions(gateway),
      force: true,
      includeLiveShapeChecks: false
    });
    now += 120_000;

    const stale = getCachedOpenClawCompatibilityReport();

    assert.equal(stale?.generatedAt, report.generatedAt);
    assert.equal(stale?.status, "compatible");
  } finally {
    Date.now = originalNow;
  }
});

test("compatibility report uses version safe defaults when Gateway omits method metadata", async () => {
  const gateway = createCompatibilityGateway([], { advertiseMethods: false });

  const report = await generateOpenClawCompatibilityReport({
    ...baseReportOptions(gateway),
    includeLiveShapeChecks: false
  });

  assert.equal(report.gateway.capabilitySource, "version-default");
  assert.equal(report.capabilities.find((capability) => capability.id === "sessions")?.source, "version-default");
  assert.equal(report.capabilities.find((capability) => capability.id === "sessions")?.status, "supported");
  assert.equal(report.contracts.find((check) => check.operation === "models")?.nativeGatewaySupported, false);
  assert.equal(report.contracts.find((check) => check.operation === "models")?.status, "degraded");
  assert.equal(report.status, "degraded");
});

test("compatibility report fails a required contract when live response shape drifts", async () => {
  const gateway = createCompatibilityGateway([
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ]);
  gateway.route("models.list", (_frame, context) => {
    context.respond({ unexpected: true });
  });

  const report = await generateOpenClawCompatibilityReport({
    ...baseReportOptions(gateway),
    includeLiveShapeChecks: true
  });
  const modelsContract = report.contracts.find((check) => check.operation === "models");

  assert.equal(report.status, "incompatible");
  assert.equal(modelsContract?.status, "failed");
  assert.equal(modelsContract?.responseShapeValid, false);
  assert.match(modelsContract?.suggestedRecovery ?? "", /response matches the contract/i);

  const labReport = buildOpenClawCompatibilityLabReport({
    generatedAt: new Date("2026-06-17T10:00:00.000Z"),
    targetVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    currentCertifiedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    installedOpenClawVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    manifestDecision: {
      version: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      status: "certified",
      allowed: true,
      defaultVisible: true,
      requiresExplicitOptIn: false,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion: null,
      reason: "Certified stable baseline.",
      notes: null
    },
    preflightReport: null,
    compatibilityReport: report,
    capabilityMatrix: null,
    compatibilitySmokeReport: null,
    runtimeIssues: []
  });

  assert.equal(labReport.areas.find((area) => area.id === "payload-shapes")?.status, "failed");
});

test("compatibility report avoids scoped live probes that require runtime ids or extra scopes", async () => {
  const gateway = createCompatibilityGateway([
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ]);
  gateway.route("tools.catalog", (_frame, context) => {
    context.respond({ groups: [{ id: "core", tools: [] }] });
  });
  gateway.route("chat.history", () => {
    throw new Error("chat.history requires a sessionKey");
  });
  gateway.route("artifacts.list", () => {
    throw new Error("artifacts.list requires a taskId");
  });
  gateway.route("exec.approval.list", () => {
    throw new Error("exec.approval.list requires operator.approvals");
  });

  const report = await generateOpenClawCompatibilityReport({
    ...baseReportOptions(gateway),
    includeLiveShapeChecks: true
  });

  assert.equal(report.contracts.find((check) => check.operation === "tools")?.status, "ok");
  assert.equal(report.contracts.find((check) => check.operation === "tools")?.responseShapeStatus, "valid");
  assert.equal(report.contracts.find((check) => check.operation === "sessionHistory")?.responseShapeStatus, "not-checked");
  assert.equal(report.contracts.find((check) => check.operation === "artifacts")?.responseShapeStatus, "not-checked");
  assert.equal(report.contracts.find((check) => check.operation === "execApprovals")?.responseShapeStatus, "not-checked");
  assert.equal(gateway.methods().includes("chat.history"), false);
  assert.equal(gateway.methods().includes("artifacts.list"), false);
  assert.equal(gateway.methods().includes("exec.approval.list"), false);
});

test("compatibility report degrades advertised scope-gated methods when operator scopes are missing", async () => {
  const gateway = createCompatibilityGateway([
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ], { authScopes: ["operator.read", "operator.write"] });

  const report = await generateOpenClawCompatibilityReport({
    ...baseReportOptions(gateway, { authScopes: ["operator.read", "operator.write"] }),
    includeLiveShapeChecks: true
  });
  const approvalsContract = report.contracts.find((check) => check.operation === "execApprovals");

  assert.equal(approvalsContract?.status, "degraded");
  assert.equal(approvalsContract?.supportedMethod, "exec.approval.list");
  assert.equal(approvalsContract?.nativeGatewaySupported, false);
  assert.deepEqual(approvalsContract?.requiredScopes, ["operator.approvals"]);
  assert.deepEqual(approvalsContract?.missingScopes, ["operator.approvals"]);
  assert.match(approvalsContract?.reason ?? "", /missing scope operator\.approvals/i);
  assert.match(approvalsContract?.suggestedRecovery ?? "", /Repair local OpenClaw device access/i);
  assert.equal(report.summary.degradedSurfaces.includes("Execution approvals"), true);
});

function baseReportOptions(
  gateway: FakeOpenClawGateway,
  options: { authScopes?: string[] } = {}
) {
  const authScopes = options.authScopes ?? [
    "operator.read",
    "operator.write",
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
    "operator.talk.secrets"
  ];

  return {
    target: {
      ...resolveOpenClawCompatibilityTarget({
        target: "test-gateway-stable",
        runtimeStartedBy: "ci"
      }),
      label: "OpenClaw stable test gateway"
    },
    installedVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    status: {
      runtimeVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      version: OPENCLAW_SUPPORTED_BASELINE_VERSION
    },
    gatewayStatus: {
      service: { loaded: true, label: "OpenClaw Gateway" },
      rpc: {
        ok: true,
        capability: "protocol v4",
        auth: {
          role: "operator",
          scopes: authScopes,
          capability: "operator"
        }
      },
      gateway: {
        bindMode: "local",
        port: 18789,
        probeUrl: "ws://127.0.0.1:18789"
      }
    },
    cliAvailable: true,
    nativeClientOptions: {
      webSocketFactory: gateway.webSocketFactory,
      url: "ws://127.0.0.1:18789",
      token: "test-token",
      timeoutMs: 100
    },
    nativeTimeoutMs: 100
  };
}

function createCompatibilityGateway(
  methods: string[],
  options: { advertiseMethods?: boolean; authScopes?: string[] } = {}
) {
  const authScopes = options.authScopes ?? [
    "operator.read",
    "operator.write",
    "operator.admin",
    "operator.approvals",
    "operator.pairing",
    "operator.talk.secrets"
  ];
  const events = options.advertiseMethods === false
    ? []
    : ["chat", "agent", "session.message", "session.tool", "task", "task.updated", "task.completed"];
  const gateway = new FakeOpenClawGateway({
    protocol: 4,
    methods: options.advertiseMethods === false ? [] : methods,
    events,
    handshake: {
      type: "hello-ok",
      protocol: 4,
      server: { version: OPENCLAW_SUPPORTED_BASELINE_VERSION },
      features: {
        methods: options.advertiseMethods === false ? [] : methods,
        events
      },
      auth: { role: "operator", scopes: authScopes }
    }
  });

  gateway.route("models.list", (_frame, context) => context.respond({ models: [] }));
  gateway.route("models.authStatus", (_frame, context) => context.respond({ auth: { providers: [] } }));
  gateway.route("usage.status", (_frame, context) => context.respond({ enabled: true }));
  gateway.route("usage.cost", (_frame, context) => context.respond({ total: 0, currency: "USD" }));
  gateway.route("sessions.usage", (_frame, context) => context.respond({ sessions: [] }));
  gateway.route("sessions.usage.timeseries", (_frame, context) => context.respond({ points: [] }));
  gateway.route("sessions.usage.logs", (_frame, context) => context.respond({ logs: [] }));
  gateway.route("doctor.memory.status", (_frame, context) => context.respond({ ok: true }));
  gateway.route("diagnostics.stability", (_frame, context) => context.respond({ ok: true }));
  gateway.route("gateway.identity.get", (_frame, context) => context.respond({ id: "gateway-test" }));
  gateway.route("system-presence", (_frame, context) => context.respond({ nodes: [] }));
  gateway.route("sessions.list", (_frame, context) => context.respond({ sessions: [] }));
  gateway.route("sessions.preview", (_frame, context) => context.respond({ messages: [], sessions: [] }));
  gateway.route("chat.history", (_frame, context) => context.respond({ messages: [] }));
  gateway.route("tasks.list", (_frame, context) => context.respond({ tasks: [] }));
  gateway.route("artifacts.list", (_frame, context) => context.respond({ artifacts: [] }));
  gateway.route("commands.list", (_frame, context) => context.respond({ commands: [] }));
  gateway.route("tools.catalog", (_frame, context) => context.respond({ tools: [] }));
  gateway.route("tools.effective", (_frame, context) => context.respond({ tools: [] }));
  gateway.route("exec.approval.list", (_frame, context) => context.respond({ approvals: [], pending: [] }));
  gateway.route("device.pair.list", (_frame, context) => context.respond({ pending: [], devices: [] }));
  gateway.route("node.pair.list", (_frame, context) => context.respond({ pending: [], nodes: [] }));
  gateway.route("node.list", (_frame, context) => context.respond({ nodes: [] }));
  gateway.route("devices.list", (_frame, context) => context.respond({ devices: [] }));
  gateway.route("cron.list", (_frame, context) => context.respond({ jobs: [] }));
  gateway.route("cron.status", (_frame, context) => context.respond({ enabled: false, jobs: 0 }));
  gateway.route("cron.runs", (_frame, context) => context.respond({ runs: [] }));
  gateway.route("voicewake.get", (_frame, context) => context.respond({ enabled: false }));
  gateway.route("talk.catalog", (_frame, context) => context.respond({ providers: [] }));
  gateway.route("talk.config", (_frame, context) => context.respond({ mode: "off" }));
  gateway.route("tts.status", (_frame, context) => context.respond({ enabled: false }));
  gateway.route("tts.providers", (_frame, context) => context.respond({ providers: [] }));
  gateway.route("environments.list", (_frame, context) => context.respond({ environments: [] }));
  gateway.route("environments.status", (_frame, context) => context.respond({ environments: [] }));
  gateway.route("config.get", (_frame, context) => context.respond({ config: {} }));
  gateway.route("config.schema", (_frame, context) => context.respond({ schema: {} }));
  gateway.route("config.schema.lookup", (_frame, context) => context.respond({ path: "gateway", schema: {} }));
  gateway.route("skills.status", (_frame, context) => context.respond({ skills: [] }));
  gateway.route("logs.tail", (_frame, context) => context.respond({ lines: [] }));

  return gateway;
}
