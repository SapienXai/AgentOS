import "server-only";

import { createHash } from "node:crypto";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { resolveAgentOsVersion } from "@/lib/agentos/version";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { getLatestOpenClawCompatibilitySmokeReport } from "@/lib/openclaw/application/compatibility-smoke-service";
import { recordOpenClawCertificationRuntimeIssue } from "@/lib/openclaw/application/runtime-issue-service";
import { getOpenClawCompatibilityReport } from "@/lib/openclaw/compat";
import type { OpenClawCompatibilityReport } from "@/lib/openclaw/compat";
import { getOpenClawCompatibilityLabAreaDefinition } from "@/lib/openclaw/compatibility-lab/area-map";
import {
  persistOpenClawCompatibilityLabReport,
  readLatestOpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/store";
import type {
  OpenClawCompatibilityLabAreaId,
  OpenClawCompatibilityLabAreaResult,
  OpenClawCompatibilityLabReport,
  OpenClawCompatibilityLabStatus
} from "@/lib/openclaw/compatibility-lab/types";
import type {
  MissionControlSnapshot,
  OpenClawCapabilityMatrix,
  OpenClawCertificationScorecardReport,
  OpenClawCompatibilitySmokeReport,
  OpenClawUpdateCompatibilityMode,
  OpenClawUpdateDecision,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";
import type { RuntimeIssue } from "@/lib/openclaw/runtime-issues";
import { buildOpenClawUpdatePreflightReport } from "@/lib/openclaw/update-safety";
import { resolveOpenClawUpdateDecision } from "@/lib/openclaw/update-compatibility";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export type GenerateOpenClawCompatibilityLabReportInput = {
  targetVersion?: string | null;
  mode?: OpenClawUpdateCompatibilityMode;
  acceptedWarnings?: string[];
  scorecard?: OpenClawCertificationScorecardReport | null;
};

export type BuildOpenClawCompatibilityLabReportInput = {
  generatedAt?: Date;
  targetVersion: string;
  currentCertifiedBaseline: string;
  installedOpenClawVersion: string | null;
  manifestDecision: OpenClawUpdateDecision;
  preflightReport: OpenClawUpdateSafetyReport | null;
  compatibilityReport: OpenClawCompatibilityReport | null;
  capabilityMatrix: OpenClawCapabilityMatrix | null;
  compatibilitySmokeReport: OpenClawCompatibilitySmokeReport | null;
  runtimeIssues: RuntimeIssue[];
  scorecard?: OpenClawCertificationScorecardReport | null;
  acceptedWarnings?: string[];
  diagnostics?: string[];
};

export async function generateOpenClawCompatibilityLabReport(
  input: GenerateOpenClawCompatibilityLabReportInput = {}
) {
  const snapshot = await getMissionControlSnapshot({ force: true });
  const agentOsVersion = await resolveAgentOsVersion();
  const targetVersion = normalizeVersion(input.targetVersion) ||
    snapshot.diagnostics.updateCompatibility?.latestDecision?.version ||
    snapshot.diagnostics.latestVersion ||
    snapshot.diagnostics.updateCompatibility?.recommendedVersion ||
    OPENCLAW_RECOMMENDED_VERSION;
  const currentCertifiedBaseline =
    snapshot.diagnostics.updateCompatibility?.recommendedVersion ||
    snapshot.diagnostics.compatibilityReport?.openClaw.recommendedVersion ||
    OPENCLAW_RECOMMENDED_VERSION;
  const manifestDecision = resolveOpenClawUpdateDecision({
    agentOsVersion,
    targetVersion,
    mode: input.mode ?? "recommended"
  });
  const diagnostics: string[] = [];
  const preflightReport = safeResolvePreflightReport({
    snapshot,
    targetVersion,
    decision: manifestDecision,
    diagnostics
  });
  const [compatibilityReport, capabilityMatrix, compatibilitySmokeReport] = await Promise.all([
    safeResolveCompatibilityReport(diagnostics),
    safeResolveCapabilityMatrix(snapshot, diagnostics),
    safeResolveCompatibilitySmokeReport(snapshot, diagnostics)
  ]);
  const report = redactSecrets(buildOpenClawCompatibilityLabReport({
    targetVersion,
    currentCertifiedBaseline,
    installedOpenClawVersion: snapshot.diagnostics.version ?? null,
    manifestDecision,
    preflightReport,
    compatibilityReport,
    capabilityMatrix,
    compatibilitySmokeReport,
    runtimeIssues: snapshot.diagnostics.runtimeIssues,
    scorecard: input.scorecard ?? null,
    acceptedWarnings: input.acceptedWarnings ?? [],
    diagnostics
  }));

  await persistOpenClawCompatibilityLabReport(report);

  if (report.certificationBlocked) {
    await recordOpenClawCertificationRuntimeIssue(report);
  }

  return report;
}

export async function getLatestOpenClawCompatibilityLabReport() {
  return readLatestOpenClawCompatibilityLabReport();
}

export function buildOpenClawCompatibilityLabReport(
  input: BuildOpenClawCompatibilityLabReportInput
): OpenClawCompatibilityLabReport {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const acceptedWarnings = [...new Set(input.acceptedWarnings ?? [])].sort();
  const areas = [
    buildManifestPolicyArea(input),
    buildGatewayProtocolArea(input),
    buildNativeRpcArea(input),
    buildPayloadShapesArea(input),
    buildModelsProvidersArea(input),
    buildSessionsTasksAgentsArea(input),
    buildConfigPatchingArea(input),
    buildChannelsAccountsScopesArea(input),
    buildRuntimeSmokeArea(input),
    buildRollbackRecoveryArea(input)
  ];
  const certificationBlocked = areas.some((area) =>
    area.blocksCertification &&
      area.status !== "passed" &&
      !(area.status === "warning" && acceptedWarnings.includes(area.id))
  );
  const status = resolveReportStatus(areas);
  const summary = {
    passed: areas.filter((area) => area.status === "passed").length,
    warnings: areas.filter((area) => area.status === "warning").length,
    failed: areas.filter((area) => area.status === "failed").length,
    unknown: areas.filter((area) => area.status === "unknown").length,
    recommendedNextAction: resolveReportRecommendedNextAction(areas, certificationBlocked)
  };
  const reportSeed = [
    generatedAt,
    input.targetVersion,
    input.currentCertifiedBaseline,
    input.installedOpenClawVersion ?? "unknown",
    input.manifestDecision.status,
    summary.recommendedNextAction
  ].join(":");

  return {
    schemaVersion: 1,
    id: `openclaw-lab-${input.targetVersion}-${createHash("sha256").update(reportSeed).digest("hex").slice(0, 12)}`,
    generatedAt,
    targetOpenClawVersion: input.targetVersion,
    currentCertifiedBaseline: input.currentCertifiedBaseline,
    installedOpenClawVersion: input.installedOpenClawVersion,
    manifestDecision: input.manifestDecision,
    probeTimestamp: generatedAt,
    status,
    certificationBlocked,
    acceptedWarnings,
    summary,
    areas
  };
}

function buildManifestPolicyArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const decision = input.manifestDecision;
  const status: OpenClawCompatibilityLabStatus = !decision.allowed || decision.requiresAgentOsUpdate || decision.status === "blocked"
    ? decision.status === "unknown" ? "warning" : "failed"
    : decision.status === "certified" ? "passed" : "warning";
  const blocksCertification = decision.status !== "certified" || !decision.allowed || decision.requiresAgentOsUpdate;

  return createArea("manifest-policy", {
    status,
    evidence: [
      `Manifest decision: ${decision.status}.`,
      `Allowed by selected mode: ${decision.allowed ? "yes" : "no"}.`,
      decision.reason,
      ...(input.diagnostics?.length ? input.diagnostics.map((entry) => `Diagnostic: ${entry}`) : [])
    ],
    expectedBehaviorOrShape: {
      certificationRequiresManifestStatus: "certified",
      unknownTargetPolicy: "report-only"
    },
    actualBehaviorOrShape: {
      status: decision.status,
      allowed: decision.allowed,
      requiresExplicitOptIn: decision.requiresExplicitOptIn,
      requiresAgentOsUpdate: decision.requiresAgentOsUpdate,
      minRequiredAgentOsVersion: decision.minRequiredAgentOsVersion
    },
    recommendedNextAction: blocksCertification
      ? "Keep this OpenClaw target in needs-certification state until evidence is reviewed and the manifest is updated manually."
      : "Continue with preflight, runtime smoke, rollback, and scorecard evidence before treating the target as certified.",
    blocksCertification
  });
}

function buildGatewayProtocolArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const report = input.compatibilityReport;
  const matrix = input.capabilityMatrix;
  const protocolStatus = report?.gateway.protocolStatus ?? matrix?.compatibility?.protocol.status ?? "unknown";
  const gatewayHealth = report?.gateway.health ?? "unknown";
  const status: OpenClawCompatibilityLabStatus =
    protocolStatus === "unsupported" || gatewayHealth === "unreachable"
      ? "failed"
      : protocolStatus === "unknown" || gatewayHealth === "unknown" || gatewayHealth === "degraded"
        ? "warning"
        : "passed";

  return createArea("gateway-protocol", {
    status,
    evidence: [
      `Gateway health: ${gatewayHealth}.`,
      `Protocol status: ${protocolStatus}.`,
      `Protocol version: ${report?.gateway.protocolVersion ?? matrix?.gatewayProtocolVersion ?? "unknown"}.`
    ],
    expectedBehaviorOrShape: {
      gatewayHealth: "healthy",
      protocolStatus: "compatible",
      protocolRange: report?.gateway.protocolRange ?? matrix?.requestedProtocolRange ?? null
    },
    actualBehaviorOrShape: {
      gatewayHealth,
      protocolStatus,
      protocolVersion: report?.gateway.protocolVersion ?? matrix?.gatewayProtocolVersion ?? null,
      reason: report?.gateway.healthReason ?? matrix?.compatibility?.protocol.reason ?? null
    },
    blocksCertification: status !== "passed"
  });
}

function buildNativeRpcArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const contracts = input.compatibilityReport?.contracts ?? [];
  const failedRequired = contracts.filter((check) =>
    check.required && (check.status === "failed" || check.status === "unsupported")
  );
  const degraded = contracts.filter((check) => check.status === "degraded" || check.status === "unsupported");
  const missingRequiredMethods = input.capabilityMatrix?.compatibility?.methodContract.missingRequiredMethods ?? [];
  const status: OpenClawCompatibilityLabStatus =
    failedRequired.length > 0 || missingRequiredMethods.length > 0
      ? "failed"
      : degraded.length > 0 || input.compatibilityReport?.status === "degraded"
        ? "warning"
        : input.compatibilityReport ? "passed" : "unknown";

  return createArea("native-rpc", {
    status,
    evidence: [
      `Native coverage: ${input.compatibilityReport?.summary.nativeGatewayCoverageLabel ?? "unknown"}.`,
      `Required contract failures: ${failedRequired.length}.`,
      `Missing required methods: ${missingRequiredMethods.length}.`
    ],
    expectedBehaviorOrShape: {
      requiredContracts: "ok",
      missingRequiredMethods: []
    },
    actualBehaviorOrShape: {
      failedRequiredContracts: failedRequired.map(pickContractEvidence),
      degradedContracts: degraded.map(pickContractEvidence),
      missingRequiredMethods
    },
    blocksCertification: status !== "passed"
  });
}

function buildPayloadShapesArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const contracts = input.compatibilityReport?.contracts ?? [];
  const checked = contracts.filter((check) => check.responseShapeStatus !== "not-checked");
  const invalid = checked.filter((check) => check.responseShapeStatus === "invalid" || check.responseShapeValid === false);
  const status: OpenClawCompatibilityLabStatus =
    invalid.length > 0
      ? "failed"
      : checked.length > 0
        ? "passed"
        : "unknown";

  return createArea("payload-shapes", {
    status,
    evidence: [
      `Live response shape checks: ${checked.length}.`,
      `Invalid response shapes: ${invalid.length}.`
    ],
    expectedBehaviorOrShape: {
      responseShapeStatus: "valid"
    },
    actualBehaviorOrShape: {
      checkedContracts: checked.map(pickContractEvidence),
      invalidContracts: invalid.map(pickContractEvidence)
    },
    recommendedNextAction: invalid.length > 0
      ? "Update payload parsers and normalizers for the changed OpenClaw response shape."
      : checked.length > 0
        ? "Payload shape checks passed for live-safe methods."
        : "Run live response shape checks before certification.",
    blocksCertification: status !== "passed"
  });
}

function buildModelsProvidersArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const smokeChecks = pickSmokeChecks(input.compatibilitySmokeReport, ["models-list", "model-readiness"]);
  const modelsContract = input.compatibilityReport?.contracts.find((check) => check.operation === "models");
  const readinessIssue = input.runtimeIssues.find((issue) => issue.type === "model_auth_required" && isRuntimeIssueActive(issue));
  const status = resolveAreaStatusFromSignals({
    hasFailure: smokeChecks.some((check) => check.status === "fail") || modelsContract?.status === "failed" || Boolean(readinessIssue),
    hasWarning: smokeChecks.some((check) => check.status === "warning") || modelsContract?.status === "degraded",
    hasEvidence: smokeChecks.length > 0 || Boolean(modelsContract)
  });

  return createArea("models-providers", {
    status,
    evidence: [
      ...smokeChecks.map((check) => `${check.label}: ${check.status} - ${check.summary}`),
      `Models contract: ${modelsContract?.status ?? "not available"}.`,
      ...(readinessIssue ? [`Runtime issue: ${readinessIssue.message}`] : [])
    ],
    expectedBehaviorOrShape: {
      modelsList: "responds",
      modelReadiness: "ready"
    },
    actualBehaviorOrShape: {
      smokeChecks,
      modelsContract: modelsContract ? pickContractEvidence(modelsContract) : null,
      readinessIssue: readinessIssue ? pickRuntimeIssueEvidence(readinessIssue) : null
    },
    blocksCertification: status !== "passed"
  });
}

function buildSessionsTasksAgentsArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const smokeChecks = pickSmokeChecks(input.compatibilitySmokeReport, ["agents-list", "sessions-list", "tasks-list", "event-subscription"]);
  const operations = new Set(["sessionLifecycle", "runtimeSnapshot", "taskEvents", "agentCreate", "agentUpdate", "agentDelete"]);
  const contracts = (input.compatibilityReport?.contracts ?? []).filter((check) => operations.has(check.operation));
  const failed = contracts.filter((check) => check.required && (check.status === "failed" || check.status === "unsupported"));
  const status = resolveAreaStatusFromSignals({
    hasFailure: smokeChecks.some((check) => check.status === "fail") || failed.length > 0,
    hasWarning: smokeChecks.some((check) => check.status === "warning") || contracts.some((check) => check.status !== "ok"),
    hasEvidence: smokeChecks.length > 0 || contracts.length > 0
  });

  return createArea("sessions-tasks-agents", {
    status,
    evidence: [
      ...smokeChecks.map((check) => `${check.label}: ${check.status} - ${check.summary}`),
      `Runtime contracts checked: ${contracts.length}.`,
      `Required runtime contract failures: ${failed.length}.`
    ],
    expectedBehaviorOrShape: {
      agents: "listable",
      sessions: "listable",
      tasks: "listable or honestly unavailable",
      events: "subscription opens when advertised"
    },
    actualBehaviorOrShape: {
      smokeChecks,
      contracts: contracts.map(pickContractEvidence)
    },
    blocksCertification: status !== "passed"
  });
}

function buildConfigPatchingArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const smokeChecks = pickSmokeChecks(input.compatibilitySmokeReport, ["config-read-schema"]);
  const configContracts = (input.compatibilityReport?.contracts ?? []).filter((check) =>
    check.operation === "config" || check.operation === "configSchemaLookup"
  );
  const configPatch = input.capabilityMatrix?.configPatch ?? "unknown";
  const status = resolveAreaStatusFromSignals({
    hasFailure: configPatch === "unsupported" || configContracts.some((check) => check.required && check.status !== "ok"),
    hasWarning: configPatch === "unknown" || smokeChecks.some((check) => check.status === "warning") || configContracts.some((check) => check.status !== "ok"),
    hasEvidence: smokeChecks.length > 0 || configContracts.length > 0 || Boolean(input.capabilityMatrix)
  });

  return createArea("config-patching", {
    status,
    evidence: [
      `Config patch support: ${configPatch}.`,
      ...smokeChecks.map((check) => `${check.label}: ${check.status} - ${check.summary}`)
    ],
    expectedBehaviorOrShape: {
      configPatch: "supported",
      configSchema: "available"
    },
    actualBehaviorOrShape: {
      configPatch,
      smokeChecks,
      contracts: configContracts.map(pickContractEvidence)
    },
    blocksCertification: status !== "passed"
  });
}

function buildChannelsAccountsScopesArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const operationIds = new Set([
    "channels",
    "channelList",
    "channelLogs",
    "channelProvisioning",
    "channelRemoval",
    "gmailProvisioning",
    "browserProfiles",
    "devicePairList",
    "deviceApproval",
    "execApprovals"
  ]);
  const contracts = (input.compatibilityReport?.contracts ?? []).filter((check) => operationIds.has(check.operation));
  const scopeIssues = input.runtimeIssues.filter((issue) => issue.type === "scope_upgrade_pending" && isRuntimeIssueActive(issue));
  const status = resolveAreaStatusFromSignals({
    hasFailure: contracts.some((check) => check.required && (check.status === "failed" || check.status === "unsupported")),
    hasWarning: scopeIssues.length > 0 || contracts.some((check) => check.status !== "ok"),
    hasEvidence: contracts.length > 0 || Boolean(input.capabilityMatrix)
  });

  return createArea("channels-accounts-scopes", {
    status,
    evidence: [
      `Channel/account/scope contracts checked: ${contracts.length}.`,
      `Pending scope issues: ${scopeIssues.length}.`
    ],
    expectedBehaviorOrShape: {
      requiredChannels: "ok",
      pendingScopes: []
    },
    actualBehaviorOrShape: {
      contracts: contracts.map(pickContractEvidence),
      scopeIssues: scopeIssues.map(pickRuntimeIssueEvidence)
    },
    blocksCertification: status !== "passed"
  });
}

function buildRuntimeSmokeArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const smoke = input.compatibilitySmokeReport;
  const status: OpenClawCompatibilityLabStatus = !smoke
    ? "unknown"
    : smoke.status === "compatible"
      ? "passed"
      : smoke.status === "incompatible"
        ? "failed"
        : "warning";

  return createArea("runtime-smoke", {
    status,
    evidence: smoke
      ? [
        `Compatibility smoke status: ${smoke.status}.`,
        `Safe to dispatch missions: ${smoke.safeToDispatchMissions ? "yes" : "no"}.`,
        smoke.recovery
      ]
      : ["No compatibility smoke report is available."],
    expectedBehaviorOrShape: {
      compatibilitySmokeStatus: "compatible",
      safeToDispatchMissions: true
    },
    actualBehaviorOrShape: smoke
      ? {
        status: smoke.status,
        checkedAt: smoke.checkedAt,
        safeToDispatchMissions: smoke.safeToDispatchMissions,
        recovery: smoke.recovery,
        failedChecks: smoke.checks.filter((check) => check.status === "fail")
      }
      : null,
    blocksCertification: status !== "passed"
  });
}

function buildRollbackRecoveryArea(input: BuildOpenClawCompatibilityLabReportInput) {
  const scorecard = input.scorecard ?? null;
  const rollbackCategory = scorecard?.categories.find((category) => category.id === "update-rollback");
  const preflightRollbackWarning = input.preflightReport
    ? [...input.preflightReport.blockers, ...input.preflightReport.warnings, ...input.preflightReport.unknowns]
      .find((check) => check.id === "rollback-metadata")
    : null;
  const status: OpenClawCompatibilityLabStatus = scorecard
    ? scorecard.status === "blocked" || scorecard.status === "evidence_missing" || scorecard.hardBlockers.length > 0
      ? "failed"
      : scorecard.status === "compatible_with_warnings" || scorecard.status === "degraded" || scorecard.warnings.length > 0
        ? "warning"
        : "passed"
    : "unknown";

  return createArea("rollback-recovery", {
    status,
    evidence: [
      scorecard ? `Scorecard status: ${scorecard.status}; score ${scorecard.score}/100.` : "Certification scorecard evidence is not available.",
      scorecard ? `Round-trip evidence: ${scorecard.roundTripEvidence.status}.` : "Round-trip rollback evidence is not available.",
      ...(rollbackCategory ? [`Rollback category: ${rollbackCategory.status} - ${rollbackCategory.evidence}`] : []),
      ...(preflightRollbackWarning ? [`Preflight rollback metadata: ${preflightRollbackWarning.status} - ${preflightRollbackWarning.message}`] : [])
    ],
    expectedBehaviorOrShape: {
      scorecard: "present",
      roundTripEvidence: "passed",
      rollbackSnapshot: "created-before-mutation"
    },
    actualBehaviorOrShape: {
      scorecardStatus: scorecard?.status ?? null,
      score: scorecard?.score ?? null,
      roundTripEvidence: scorecard?.roundTripEvidence ?? null,
      rollbackCategory: rollbackCategory ?? null,
      preflightRollbackWarning
    },
    recommendedNextAction: scorecard
      ? "Resolve scorecard blockers and verify rollback-to-certified evidence before certification."
      : "Run install-and-verify or round-trip certification before promoting this target.",
    blocksCertification: status !== "passed"
  });
}

function createArea(
  areaId: OpenClawCompatibilityLabAreaId,
  input: Omit<
    OpenClawCompatibilityLabAreaResult,
    "id" | "name" | "affectedAgentOsFiles" | "suggestedFixScope" | "recommendedNextAction"
  > & {
    recommendedNextAction?: string;
  }
): OpenClawCompatibilityLabAreaResult {
  const definition = getOpenClawCompatibilityLabAreaDefinition(areaId);

  return redactSecrets({
    id: areaId,
    name: definition.name,
    status: input.status,
    evidence: input.evidence.filter(Boolean),
    expectedBehaviorOrShape: input.expectedBehaviorOrShape,
    actualBehaviorOrShape: input.actualBehaviorOrShape,
    affectedAgentOsFiles: definition.affectedAgentOsFiles,
    suggestedFixScope: definition.suggestedFixScope,
    recommendedNextAction: input.recommendedNextAction ?? definition.recommendedNextAction,
    blocksCertification: input.blocksCertification,
    ...(input.redactedCommandOutput ? { redactedCommandOutput: input.redactedCommandOutput } : {})
  });
}

function resolveAreaStatusFromSignals(input: {
  hasFailure: boolean;
  hasWarning: boolean;
  hasEvidence: boolean;
}): OpenClawCompatibilityLabStatus {
  if (input.hasFailure) {
    return "failed";
  }

  if (input.hasWarning) {
    return "warning";
  }

  return input.hasEvidence ? "passed" : "unknown";
}

function resolveReportStatus(areas: OpenClawCompatibilityLabAreaResult[]): OpenClawCompatibilityLabStatus {
  if (areas.some((area) => area.status === "failed")) {
    return "failed";
  }

  if (areas.some((area) => area.status === "warning")) {
    return "warning";
  }

  if (areas.some((area) => area.status === "unknown")) {
    return "unknown";
  }

  return "passed";
}

function resolveReportRecommendedNextAction(
  areas: OpenClawCompatibilityLabAreaResult[],
  certificationBlocked: boolean
) {
  const blocker = areas.find((area) => area.blocksCertification && area.status === "failed") ??
    areas.find((area) => area.blocksCertification && area.status === "unknown") ??
    areas.find((area) => area.blocksCertification && area.status === "warning");

  if (certificationBlocked && blocker) {
    return `Do not certify this OpenClaw target. ${blocker.name}: ${blocker.recommendedNextAction}`;
  }

  const warning = areas.find((area) => area.status === "warning");
  if (warning) {
    return `Review warning before certification: ${warning.name}.`;
  }

  return "Compatibility lab evidence has no blockers. Certification still requires explicit manifest promotion.";
}

function pickSmokeChecks(
  report: OpenClawCompatibilitySmokeReport | null,
  ids: string[]
) {
  const idSet = new Set(ids);
  return report?.checks.filter((check) => idSet.has(check.id)) ?? [];
}

function pickContractEvidence(check: OpenClawCompatibilityReport["contracts"][number]) {
  return {
    operation: check.operation,
    label: check.label,
    status: check.status,
    required: check.required,
    baseline: check.baseline,
    supportedMethod: check.supportedMethod,
    responseShapeStatus: check.responseShapeStatus,
    responseShapeValid: check.responseShapeValid,
    missingScopes: check.missingScopes,
    reason: check.reason,
    suggestedRecovery: check.suggestedRecovery
  };
}

function pickRuntimeIssueEvidence(issue: RuntimeIssue) {
  return {
    id: issue.id,
    type: issue.type,
    source: issue.source,
    severity: issue.severity,
    status: issue.status,
    message: issue.message,
    recoveryCommand: issue.recoveryCommand,
    rawOutput: issue.rawOutput
  };
}

function isRuntimeIssueActive(issue: RuntimeIssue) {
  return issue.status === "open" || issue.status === "resolving" || issue.status === "failed";
}

function safeResolvePreflightReport(input: {
  snapshot: MissionControlSnapshot;
  targetVersion: string;
  decision: OpenClawUpdateDecision;
  diagnostics: string[];
}) {
  try {
    return buildOpenClawUpdatePreflightReport({
      snapshot: input.snapshot,
      targetVersion: input.targetVersion,
      decision: input.decision,
      rollbackSnapshotAvailable: false
    });
  } catch (error) {
    input.diagnostics.push(`preflight: ${redactErrorMessage(error, "OpenClaw update preflight failed.")}`);
    return null;
  }
}

async function safeResolveCompatibilityReport(diagnostics: string[]) {
  try {
    return await getOpenClawCompatibilityReport({
      force: true,
      includeLiveShapeChecks: true
    });
  } catch (error) {
    diagnostics.push(`compatibilityReport: ${redactErrorMessage(error, "OpenClaw compatibility report failed.")}`);
    return null;
  }
}

async function safeResolveCapabilityMatrix(snapshot: MissionControlSnapshot, diagnostics: string[]) {
  try {
    return await getOpenClawCapabilityMatrix({ force: true });
  } catch (error) {
    diagnostics.push(`capabilityMatrix: ${redactErrorMessage(error, "OpenClaw capability matrix failed.")}`);
    return snapshot.diagnostics.capabilityMatrix ?? null;
  }
}

async function safeResolveCompatibilitySmokeReport(snapshot: MissionControlSnapshot, diagnostics: string[]) {
  try {
    return await getLatestOpenClawCompatibilitySmokeReport();
  } catch (error) {
    diagnostics.push(`compatibilitySmoke: ${redactErrorMessage(error, "OpenClaw compatibility smoke report could not be read.")}`);
    return snapshot.diagnostics.compatibilitySmokeTest ?? null;
  }
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}
