import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpenClawCapabilityDiffReport } from "@/lib/openclaw/capability-diff";
import { buildOpenClawCertificationScorecardReport } from "@/lib/openclaw/certification-scorecard";
import type {
  GatewayDiagnostics,
  OpenClawCertificationRoundTripEvidence,
  OpenClawUpdateDecision
} from "@/lib/openclaw/types";

const candidateDecision: OpenClawUpdateDecision = {
  version: "2026.6.6",
  status: "unknown",
  allowed: true,
  defaultVisible: false,
  requiresExplicitOptIn: true,
  requiresAgentOsUpdate: false,
  minRequiredAgentOsVersion: null,
  reason: "Unknown OpenClaw version allowed only through advanced update mode.",
  notes: null
};

function createDiagnostics(input: Partial<GatewayDiagnostics> = {}): GatewayDiagnostics {
  return {
    installed: true,
    loaded: true,
    rpcOk: true,
    health: "ok",
    version: "2026.6.1",
    latestVersion: "2026.6.6",
    workspaceRoot: "/tmp/workspace",
    configuredWorkspaceRoot: null,
    dashboardUrl: "http://127.0.0.1:3000",
    gatewayUrl: "ws://127.0.0.1:18789",
    configuredGatewayUrl: null,
    modelReadiness: {
      ready: true,
      defaultModel: "openai/gpt-5.4-mini",
      resolvedDefaultModel: "openai/gpt-5.4-mini",
      defaultModelReady: true,
      recommendedModelId: "openai/gpt-5.4-mini",
      preferredLoginProvider: "openai",
      totalModelCount: 1,
      availableModelCount: 1,
      localModelCount: 0,
      remoteModelCount: 1,
      missingModelCount: 0,
      authProviders: [],
      issues: []
    },
    runtime: {
      stateRoot: "/tmp/openclaw",
      stateWritable: true,
      sessionStoreWritable: true,
      sessionStores: [],
      smokeTest: {
        status: "passed",
        checkedAt: "2026-06-15T08:00:00.000Z",
        agentId: "agent-main",
        runId: "run-main",
        summary: "Runtime smoke passed.",
        error: null
      },
      issues: []
    },
    runtimeIssues: [],
    securityWarnings: [],
    issues: [],
    transport: {
      gatewayMode: "native",
      statusLabel: "Native Gateway",
      fallbackCounts: {},
      fallbackTotal: 0
    },
    capabilityMatrix: {
      detectedAt: "2026-06-15T08:00:00.000Z",
      openClawVersion: "2026.6.1",
      gatewayProtocolVersion: "4",
      authMode: "native",
      supportedMethods: ["sessions.list", "config.patch"],
      configSchema: "supported",
      configPatch: "supported",
      chatEvents: "supported",
      channels: "supported",
      skills: "supported",
      approvals: "supported",
      updates: "supported",
      nativeMissionDispatch: "supported",
      nativeAgentLifecycle: "supported",
      eventBridge: "supported",
      unsupportedGatewayMethods: [],
      diagnostics: [],
      operations: {
        sessions: {
          label: "Sessions",
          mode: "gateway-native",
          methods: ["sessions.list"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Native sessions are available.",
          preferredMethod: "sessions.list",
          supportedMethod: "sessions.list",
          compatibility: "preferred"
        },
        config: {
          label: "Config patch",
          mode: "gateway-native",
          methods: ["config.patch"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Native config patch is available.",
          preferredMethod: "config.patch",
          supportedMethod: "config.patch",
          compatibility: "preferred"
        }
      },
      compatibility: {
        protocol: {
          status: "compatible",
          version: "4",
          reason: "Protocol compatible."
        },
        methodContract: {
          status: "verified",
          checkedAt: "2026-06-15T08:00:00.000Z",
          source: "rpc.discover",
          refreshIntervalMs: 60000,
          expectedMethodCount: 2,
          advertisedMethodCount: 2,
          missingMethodCount: 0,
          missingMethods: [],
          missingOperations: [],
          requiredMethodCount: 2,
          missingRequiredMethods: [],
          optionalMethodCount: 0,
          missingOptionalMethods: [],
          experimentalMethodCount: 0,
          missingExperimentalMethods: [],
          reason: "All methods available."
        },
        nativeOperationCount: 2,
        degradedOperationCount: 0,
        unknownOperationCount: 0,
        aliasOperations: [],
        degradedOperations: []
      }
    },
    ...input
  } as unknown as GatewayDiagnostics;
}

function createTargetDiagnostics(input: Partial<GatewayDiagnostics> = {}) {
  const baseline = createDiagnostics();
  return createDiagnostics({
    ...baseline,
    version: "2026.6.6",
    capabilityMatrix: {
      ...baseline.capabilityMatrix!,
      openClawVersion: "2026.6.6"
    },
    ...input
  });
}

function buildScorecard(input: {
  target?: GatewayDiagnostics | null;
  output?: string;
  rollbackToCertifiedBaseline?: "passed" | "failed" | "not-run" | "not-required";
  roundTripEvidence?: OpenClawCertificationRoundTripEvidence | null;
  completed?: boolean;
} = {}) {
  const baseline = createDiagnostics();
  const target = input.target === undefined ? createTargetDiagnostics() : input.target;
  const diff = target
    ? buildOpenClawCapabilityDiffReport({ certified: baseline, target })
    : null;

  return buildOpenClawCertificationScorecardReport({
    baselineDiagnostics: baseline,
    targetDiagnostics: target,
    capabilityDiff: diff,
    manifestDecision: candidateDecision,
    smokeTest: target?.runtime.smokeTest ?? null,
    roundTripEvidence: input.roundTripEvidence === undefined
      ? createRoundTripEvidence("passed")
      : input.roundTripEvidence,
    update: {
      attempted: true,
      completed: input.completed ?? true,
      targetVersion: "2026.6.6",
      installedVersion: target?.version ?? null,
      rollbackSnapshotCreated: true,
      rollbackToCertifiedBaseline: input.rollbackToCertifiedBaseline ?? "passed",
      restoreLastWorking: "not-run",
      output: input.output ?? null
    },
    generatedAt: new Date("2026-06-15T08:10:00.000Z")
  });
}

function createRoundTripEvidence(status: "passed" | "failed" | "not-run"): OpenClawCertificationRoundTripEvidence {
  return {
    status,
    startedAt: status === "not-run" ? null : "2026-06-15T08:00:00.000Z",
    finishedAt: status === "not-run" ? null : "2026-06-15T08:09:00.000Z",
    baselineVersion: "2026.6.1",
    targetVersion: "2026.6.6",
    steps: status === "not-run"
      ? []
      : [{
          id: "final-target-verify",
          requestedVersion: "2026.6.6",
          installedVersion: "2026.6.6",
          gatewayLoaded: true,
          rpcReady: true,
          runtimeSmokeStatus: status,
          fallbackCount: 0,
          exitCode: 0,
          ok: status === "passed",
          message: "Round-trip step verified.",
          stdoutPreview: null,
          stderrPreview: null
        }],
    failureMessage: status === "failed" ? "Round-trip failed." : null
  };
}

test("clean capability diff with passed smoke and rollback becomes pre-certified eligible", () => {
  const scorecard = buildScorecard();

  assert.equal(scorecard.status, "pre_certified_eligible");
  assert.equal(scorecard.globalCertification, "not_certified");
  assert.equal(scorecard.hardBlockers.length, 0);
  assert.ok(scorecard.score >= 90);
  assert.ok(scorecard.artifact);
});

test("clean capability diff without round-trip evidence cannot generate artifact", () => {
  const scorecard = buildScorecard({ roundTripEvidence: createRoundTripEvidence("not-run") });

  assert.equal(scorecard.status, "pre_certified_eligible");
  assert.equal(scorecard.roundTripEvidence.status, "not-run");
  assert.equal(scorecard.artifact, null);
});

test("clean capability diff with rollback failure is blocked", () => {
  const scorecard = buildScorecard({ rollbackToCertifiedBaseline: "failed" });

  assert.equal(scorecard.status, "blocked");
  assert.match(scorecard.hardBlockers.join("\n"), /Rollback to the certified baseline failed/);
  assert.equal(scorecard.artifact, null);
});

test("clean capability diff with gateway restart failure is blocked", () => {
  const target = createTargetDiagnostics({ loaded: false, rpcOk: false });
  const scorecard = buildScorecard({ target });

  assert.equal(scorecard.status, "blocked");
  assert.match(scorecard.hardBlockers.join("\n"), /Gateway was not reachable/);
});

test("capability native regression blocks certification", () => {
  const target = createTargetDiagnostics({
    capabilityMatrix: {
      ...createTargetDiagnostics().capabilityMatrix!,
      operations: {
        ...createTargetDiagnostics().capabilityMatrix!.operations!,
        sessions: {
          ...createTargetDiagnostics().capabilityMatrix!.operations!.sessions,
          mode: "cli-fallback",
          reason: "sessions.list regressed to CLI fallback."
        }
      }
    }
  });
  const scorecard = buildScorecard({ target });

  assert.equal(scorecard.status, "blocked");
  assert.match(scorecard.hardBlockers.join("\n"), /native Gateway operation/);
});

test("capability diff carries disabled no-fallback evidence", () => {
  const baseline = createDiagnostics();
  const target = createTargetDiagnostics({
    capabilityMatrix: {
      ...createTargetDiagnostics().capabilityMatrix!,
      operations: {
        ...createTargetDiagnostics().capabilityMatrix!.operations!,
        taskAssign: {
          label: "Task assignment",
          mode: "disabled",
          methods: ["tasks.assign"],
          events: [],
          fallbackAllowed: false,
          baseline: "experimental",
          reason: "OpenClaw Gateway does not advertise native support and no safe fallback is available.",
          recovery: "Leave task assignment unavailable until OpenClaw exposes tasks.assign.",
          preferredMethod: "tasks.assign",
          supportedMethod: null,
          aliasMethods: [],
          compatibility: "missing"
        }
      },
      compatibility: {
        ...createTargetDiagnostics().capabilityMatrix!.compatibility!,
        methodContract: {
          ...createTargetDiagnostics().capabilityMatrix!.compatibility!.methodContract,
          source: "gateway-handshake"
        }
      }
    }
  });
  const diff = buildOpenClawCapabilityDiffReport({ certified: baseline, target });
  const row = diff.rows.find((entry) => entry.operationId === "taskAssign");

  assert.ok(row);
  assert.equal(row.targetMode, "disabled");
  assert.equal(row.preferredMethod, "tasks.assign");
  assert.equal(row.evidenceSource, "gateway-handshake");
  assert.match(row.targetReason, /does not advertise native support/);
  assert.match(row.targetRecovery ?? "", /Leave task assignment unavailable/);
});

test("update.status schema warning reduces plugin/config score without blocking", () => {
  const scorecard = buildScorecard({
    output: "OpenClaw Gateway update.status did not include update availability details."
  });
  const pluginConfig = scorecard.categories.find((category) => category.id === "plugin-config");

  assert.equal(scorecard.status, "pre_certified_eligible");
  assert.equal(scorecard.hardBlockers.length, 0);
  assert.equal(pluginConfig?.score, 8);
  assert.match(scorecard.warnings.join("\n"), /update\.status/);
});

test("missing target diagnostics reports evidence missing", () => {
  const scorecard = buildScorecard({ target: null, completed: false });

  assert.equal(scorecard.status, "evidence_missing");
  assert.match(scorecard.hardBlockers.join("\n"), /Target diagnostics are missing/);
});

test("required plugin API mismatch blocks certification", () => {
  const scorecard = buildScorecard({
    output: "plugin codex: plugin requires plugin API >=2026.6.6, but this host is 2026.6.1; skipping discovery"
  });

  assert.equal(scorecard.status, "blocked");
  assert.equal(scorecard.pluginConfigFindings[0]?.pluginId, "codex");
  assert.equal(scorecard.pluginConfigFindings[0]?.requiredApiVersion, "2026.6.6");
  assert.equal(scorecard.pluginConfigFindings[0]?.hostVersion, "2026.6.1");
  assert.match(scorecard.hardBlockers.join("\n"), /codex plugin requires plugin API/);
});

test("plugin install and newer config blockers are structured", () => {
  const scorecard = buildScorecard({
    output: [
      'Plugin "codex" installation blocked: incompatible plugin manifest',
      "Refusing to restart Gateway because this command is older than the config last written by OpenClaw 2026.6.6."
    ].join("\n")
  });

  assert.equal(scorecard.status, "blocked");
  assert.equal(scorecard.pluginConfigFindings.some((finding) => finding.kind === "plugin-install" && finding.pluginId === "codex"), true);
  assert.equal(scorecard.pluginConfigFindings.some((finding) => finding.kind === "config-version" && finding.configWriterVersion === "2026.6.6"), true);
});
