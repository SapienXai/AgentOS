import type {
  GatewayDiagnostics,
  OpenClawCapabilityDiffReport,
  OpenClawCertificationScorecardCategory,
  OpenClawCertificationScorecardFinding,
  OpenClawCertificationScorecardReport,
  OpenClawCertificationScorecardStatus,
  OpenClawRuntimeSmokeTest,
  OpenClawUpdateDecision,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";

export type OpenClawCertificationRollbackEvidence = "passed" | "failed" | "not-run" | "not-required";

export type OpenClawCertificationScorecardInput = {
  baselineDiagnostics: GatewayDiagnostics;
  targetDiagnostics?: GatewayDiagnostics | null;
  capabilityDiff?: OpenClawCapabilityDiffReport | null;
  preflightReport?: OpenClawUpdateSafetyReport | null;
  manifestDecision?: OpenClawUpdateDecision | null;
  update: {
    attempted: boolean;
    completed: boolean;
    exitCode?: number | null;
    targetVersion: string;
    installedVersion?: string | null;
    rollbackSnapshotCreated: boolean;
    rollbackToCertifiedBaseline: OpenClawCertificationRollbackEvidence;
    restoreLastWorking: OpenClawCertificationRollbackEvidence;
    output?: string | null;
    failureMessage?: string | null;
  };
  smokeTest?: OpenClawRuntimeSmokeTest | null;
  generatedAt?: Date;
};

const categoryMaxScores = {
  "registry-policy": 10,
  "capability-contract": 25,
  "gateway-lifecycle": 15,
  "runtime-smoke": 20,
  "update-rollback": 20,
  "plugin-config": 10
} as const;

export function buildOpenClawCertificationScorecardReport(
  input: OpenClawCertificationScorecardInput
): OpenClawCertificationScorecardReport {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const baselineVersion = resolveBaselineVersion(input);
  const targetVersion = normalizeVersion(input.update.targetVersion) ?? resolveTargetVersion(input);
  const targetDiagnosticsAvailable = Boolean(input.targetDiagnostics);
  const categories = [
    buildRegistryPolicyCategory(input),
    buildCapabilityContractCategory(input),
    buildGatewayLifecycleCategory(input),
    buildRuntimeSmokeCategory(input),
    buildUpdateRollbackCategory(input, baselineVersion, targetVersion),
    buildPluginConfigCategory(input)
  ];
  const score = clampScore(categories.reduce((total, category) => total + category.score, 0));
  const hardBlockers = categories.flatMap((category) =>
    category.findings.filter((finding) => finding.severity === "blocker").map((finding) => finding.message)
  );
  const warnings = categories.flatMap((category) =>
    category.findings.filter((finding) => finding.severity === "warning").map((finding) => finding.message)
  );
  const unknowns = categories.flatMap((category) =>
    category.findings.filter((finding) => finding.severity === "unknown").map((finding) => finding.message)
  );
  const globalCertification: OpenClawCertificationScorecardReport["globalCertification"] =
    input.manifestDecision?.status === "certified" && hardBlockers.length === 0
      ? "certified"
      : "not_certified";
  const status = resolveScorecardStatus({
    score,
    hardBlockerCount: hardBlockers.length,
    targetDiagnosticsAvailable,
    globalCertification
  });
  const rollbackPassed =
    input.update.rollbackToCertifiedBaseline === "passed" ||
    input.update.rollbackToCertifiedBaseline === "not-required";
  const artifactEligible =
    score >= 90 &&
    hardBlockers.length === 0 &&
    targetDiagnosticsAvailable &&
    input.smokeTest?.status === "passed" &&
    rollbackPassed;
  const artifact = artifactEligible
    ? {
        schemaVersion: 1 as const,
        generatedAt,
        baselineVersion,
        targetVersion,
        score,
        status,
        globalCertification,
        hardBlockers,
        warnings,
        unknowns,
        categories,
        capabilityDiff: input.capabilityDiff ?? null
      }
    : null;

  return {
    generatedAt,
    baselineVersion,
    targetVersion,
    score,
    status,
    globalCertification,
    hardBlockers,
    warnings,
    unknowns,
    categories,
    capabilityDiff: input.capabilityDiff ?? null,
    artifact
  };
}

function buildRegistryPolicyCategory(input: OpenClawCertificationScorecardInput) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const decision = input.manifestDecision ?? input.preflightReport?.decision ?? null;
  let score: number = categoryMaxScores["registry-policy"];

  if (!decision) {
    findings.push({
      id: "registry-policy-missing",
      severity: "unknown",
      message: "No compatibility manifest decision was attached to the verification evidence."
    });
    score = 4;
  } else if (!decision.allowed || decision.requiresAgentOsUpdate || decision.status === "blocked") {
    findings.push({
      id: "registry-policy-blocked",
      severity: "blocker",
      message: decision.reason
    });
    score = 0;
  } else if (decision.status !== "certified") {
    findings.push({
      id: "registry-policy-not-certified",
      severity: decision.status === "unknown" ? "warning" : "info",
      message: "The target version is not globally certified by the AgentOS compatibility registry."
    });
    score = decision.status === "candidate" ? 8 : 7;
  }

  if (decision?.requiresExplicitOptIn) {
    findings.push({
      id: "registry-policy-explicit-opt-in",
      severity: "warning",
      message: "The target required explicit operator opt-in before install-and-verify."
    });
    score = Math.min(score, 8);
  }

  return createCategory({
    id: "registry-policy",
    label: "Registry/version policy",
    score,
    evidence: decision
      ? `Registry status ${decision.status}; default visible ${decision.defaultVisible ? "yes" : "no"}.`
      : "Registry decision evidence missing.",
    findings
  });
}

function buildCapabilityContractCategory(input: OpenClawCertificationScorecardInput) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const diff = input.capabilityDiff;
  const protocolStatus = input.targetDiagnostics?.capabilityMatrix?.compatibility?.protocol.status;
  let score: number = categoryMaxScores["capability-contract"];

  if (!input.targetDiagnostics || !diff) {
    findings.push({
      id: "capability-evidence-missing",
      severity: "blocker",
      message: "Target diagnostics are missing; Gateway capability contract comparison cannot be certified."
    });
    return createCategory({
      id: "capability-contract",
      label: "Gateway capability contract",
      score: 0,
      evidence: "Install-and-verify did not capture target capability diagnostics.",
      findings
    });
  }

  if (protocolStatus === "unsupported") {
    findings.push({
      id: "capability-protocol-unsupported",
      severity: "blocker",
      message: "Target Gateway protocol is incompatible with AgentOS."
    });
    score = 0;
  }

  if (diff.summary.certificationBlockerCount > 0) {
    findings.push({
      id: "capability-regressions",
      severity: "blocker",
      message: `${diff.summary.certificationBlockerCount} Gateway capability blocker(s) were detected versus the certified baseline.`
    });
    score = Math.min(score, Math.max(0, 25 - diff.summary.certificationBlockerCount * 5));
  }

  if (diff.summary.nativeRegressions > 0) {
    findings.push({
      id: "capability-native-regression",
      severity: "blocker",
      message: `${diff.summary.nativeRegressions} native Gateway operation(s) regressed.`
    });
  }

  if (diff.summary.fallbackRegressions > 0) {
    findings.push({
      id: "capability-fallback-regression",
      severity: "blocker",
      message: `${diff.summary.fallbackRegressions} operation(s) fell back from native Gateway coverage.`
    });
  }

  if (diff.summary.newMissingRequiredMethods > 0) {
    findings.push({
      id: "capability-missing-required",
      severity: "blocker",
      message: `${diff.summary.newMissingRequiredMethods} required Gateway method(s) are newly missing.`
    });
  }

  if (diff.summary.degradedOrUnknownOperations > 0 && diff.summary.certificationBlockerCount === 0) {
    findings.push({
      id: "capability-degraded-unknown",
      severity: "warning",
      message: `${diff.summary.degradedOrUnknownOperations} target operation(s) remain degraded or unknown.`
    });
    score = Math.min(score, 21);
  }

  return createCategory({
    id: "capability-contract",
    label: "Gateway capability contract",
    score,
    evidence:
      diff.summary.certificationBlockerCount === 0
        ? "No Gateway method regressions were detected versus the certified baseline."
        : "Gateway capability regressions were detected versus the certified baseline.",
    findings
  });
}

function buildGatewayLifecycleCategory(input: OpenClawCertificationScorecardInput) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const diagnostics = input.targetDiagnostics;
  let score: number = categoryMaxScores["gateway-lifecycle"];

  if (!diagnostics) {
    findings.push({
      id: "gateway-target-missing",
      severity: "blocker",
      message: "Target diagnostics are missing; Gateway lifecycle could not be verified after update."
    });
    score = 0;
  } else if (!diagnostics.loaded || !diagnostics.rpcOk) {
    findings.push({
      id: "gateway-unreachable",
      severity: "blocker",
      message: "OpenClaw Gateway was not reachable and RPC-ready after update."
    });
    score = 0;
  } else {
    const fallbackCount = diagnostics.transport?.fallbackTotal ?? 0;
    if (fallbackCount > 0) {
      findings.push({
        id: "gateway-fallback-used",
        severity: "warning",
        message: `Gateway became reachable, but AgentOS observed ${fallbackCount} CLI fallback call(s).`
      });
      score = 12;
    }
  }

  if (diagnostics?.runtimeIssues.some((issue) => issue.type === "gateway_unreachable" && issue.status !== "resolved")) {
    findings.push({
      id: "gateway-runtime-issue-open",
      severity: "blocker",
      message: "A Gateway unreachable runtime issue is still visible after update."
    });
    score = 0;
  }

  return createCategory({
    id: "gateway-lifecycle",
    label: "Gateway lifecycle",
    score,
    evidence: diagnostics
      ? `Gateway loaded ${diagnostics.loaded ? "yes" : "no"}; RPC ready ${diagnostics.rpcOk ? "yes" : "no"}.`
      : "Gateway lifecycle evidence missing.",
    findings
  });
}

function buildRuntimeSmokeCategory(input: OpenClawCertificationScorecardInput) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const diagnostics = input.targetDiagnostics;
  const smoke = input.smokeTest ?? diagnostics?.runtime.smokeTest ?? null;
  let score: number = categoryMaxScores["runtime-smoke"];

  if (!diagnostics) {
    findings.push({
      id: "runtime-target-missing",
      severity: "blocker",
      message: "Target diagnostics are missing; runtime smoke could not be verified."
    });
    score = 0;
  } else if (smoke?.status === "failed") {
    findings.push({
      id: "runtime-smoke-failed",
      severity: "blocker",
      message: smoke.error || "Runtime smoke failed after update."
    });
    score = 0;
  } else if (smoke?.status === "passed") {
    score = categoryMaxScores["runtime-smoke"];
  } else {
    findings.push({
      id: "runtime-smoke-not-run",
      severity: "warning",
      message: "Runtime smoke did not run to completion, so runtime behavior is not fully certified."
    });
    score = 12;
  }

  if (diagnostics && !diagnostics.modelReadiness.ready) {
    findings.push({
      id: "runtime-model-not-ready",
      severity: "warning",
      message: diagnostics.modelReadiness.issues[0] || "Model readiness was not confirmed after update."
    });
    score = Math.min(score, 14);
  }

  return createCategory({
    id: "runtime-smoke",
    label: "Runtime smoke",
    score,
    evidence: smoke
      ? `Runtime smoke status ${smoke.status}.`
      : "Runtime smoke evidence missing.",
    findings
  });
}

function buildUpdateRollbackCategory(
  input: OpenClawCertificationScorecardInput,
  baselineVersion: string | null,
  targetVersion: string | null
) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const installedVersion = normalizeVersion(input.update.installedVersion);
  const expectedVersion = normalizeVersion(targetVersion);
  const baseline = normalizeVersion(baselineVersion);
  const targetEqualsBaseline = Boolean(baseline && expectedVersion && baseline === expectedVersion);
  let score: number = categoryMaxScores["update-rollback"];

  if (!input.update.attempted || !input.update.completed) {
    findings.push({
      id: "update-not-completed",
      severity: "blocker",
      message: input.update.failureMessage || "OpenClaw update did not complete cleanly."
    });
    score = 0;
  }

  if (!installedVersion || !expectedVersion || installedVersion !== expectedVersion) {
    findings.push({
      id: "update-installed-version-mismatch",
      severity: "blocker",
      message: `Installed OpenClaw version ${formatVersion(installedVersion)} did not match requested target ${formatVersion(expectedVersion)}.`
    });
    score = 0;
  }

  if (!input.update.rollbackSnapshotCreated) {
    findings.push({
      id: "rollback-snapshot-missing",
      severity: "blocker",
      message: "Rollback snapshot evidence was not created before mutation."
    });
    score = 0;
  }

  if (!targetEqualsBaseline) {
    if (input.update.rollbackToCertifiedBaseline === "failed") {
      findings.push({
        id: "rollback-certified-failed",
        severity: "blocker",
        message: "Rollback to the certified baseline failed."
      });
      score = 0;
    } else if (input.update.rollbackToCertifiedBaseline !== "passed") {
      findings.push({
        id: "rollback-certified-unverified",
        severity: "blocker",
        message: "Rollback to the certified baseline has not been verified for this target."
      });
      score = Math.min(score, 10);
    }
  }

  if (input.update.restoreLastWorking === "failed") {
    findings.push({
      id: "restore-last-working-failed",
      severity: "blocker",
      message: "Restore last working version failed."
    });
    score = 0;
  }

  return createCategory({
    id: "update-rollback",
    label: "Update and rollback safety",
    score,
    evidence:
      `Update completed ${input.update.completed ? "yes" : "no"}; rollback-to-certified ${input.update.rollbackToCertifiedBaseline}.`,
    findings
  });
}

function buildPluginConfigCategory(input: OpenClawCertificationScorecardInput) {
  const findings: OpenClawCertificationScorecardFinding[] = [];
  const output = input.update.output ?? "";
  const diagnostics = input.targetDiagnostics;
  let score: number = categoryMaxScores["plugin-config"];

  if (/Plugin\s+"[^"]+"\s+installation blocked|Disabled\s+"[^"]+"\s+after plugin update failure|plugin requires plugin API/i.test(output)) {
    findings.push({
      id: "plugin-api-blocked",
      severity: "blocker",
      message: "A required OpenClaw plugin install or API compatibility check failed."
    });
    score = 0;
  }

  if (/Refusing to (?:install|restart|rewrite).*older than the config last written by|config last written by a newer OpenClaw version/i.test(output)) {
    findings.push({
      id: "config-newer-version-blocked",
      severity: "blocker",
      message: "OpenClaw config/service metadata was written by a newer version and blocked restart or recovery."
    });
    score = 0;
  }

  if (/update\.status did not include update availability details/i.test(output)) {
    findings.push({
      id: "update-status-schema-warning",
      severity: "warning",
      message: "Gateway update.status did not include update availability details."
    });
    score = Math.min(score, 8);
  }

  if (/Gateway config schema\/patch support is not available/i.test(output) || diagnostics?.capabilityMatrix?.configPatch !== "supported") {
    findings.push({
      id: "config-patch-warning",
      severity: "warning",
      message: "Gateway config schema/patch support is unavailable or unknown."
    });
    score = Math.min(score, 8);
  }

  return createCategory({
    id: "plugin-config",
    label: "Plugin/config migration",
    score,
    evidence: findings.length > 0
      ? "Plugin/config warnings were detected in update output or target diagnostics."
      : "No plugin or config migration issues were detected.",
    findings
  });
}

function createCategory(input: Omit<OpenClawCertificationScorecardCategory, "maxScore" | "status">) {
  const maxScore = categoryMaxScores[input.id];
  return {
    ...input,
    score: clampScore(input.score, maxScore),
    maxScore,
    status: resolveCategoryStatus(input.score, maxScore, input.findings)
  };
}

function resolveCategoryStatus(
  score: number,
  maxScore: number,
  findings: OpenClawCertificationScorecardFinding[]
): OpenClawCertificationScorecardStatus {
  if (findings.some((finding) => finding.severity === "blocker")) {
    return "blocked";
  }

  if (findings.some((finding) => finding.severity === "unknown")) {
    return "evidence_missing";
  }

  if (findings.some((finding) => finding.severity === "warning")) {
    return score / maxScore >= 0.75 ? "compatible_with_warnings" : "degraded";
  }

  return "pre_certified_eligible";
}

function resolveScorecardStatus(input: {
  score: number;
  hardBlockerCount: number;
  targetDiagnosticsAvailable: boolean;
  globalCertification: "certified" | "not_certified";
}): OpenClawCertificationScorecardStatus {
  if (!input.targetDiagnosticsAvailable) {
    return "evidence_missing";
  }

  if (input.hardBlockerCount > 0) {
    return "blocked";
  }

  if (input.globalCertification === "certified") {
    return "certified";
  }

  if (input.score >= 90) {
    return "pre_certified_eligible";
  }

  if (input.score >= 75) {
    return "compatible_with_warnings";
  }

  if (input.score >= 60) {
    return "degraded";
  }

  return "blocked";
}

function resolveBaselineVersion(input: OpenClawCertificationScorecardInput) {
  return (
    normalizeVersion(input.capabilityDiff?.certifiedVersion) ??
    normalizeVersion(input.preflightReport?.supportedBaselineVersion) ??
    normalizeVersion(input.baselineDiagnostics.compatibilityReport?.openClaw.installedVersion) ??
    normalizeVersion(input.baselineDiagnostics.capabilityMatrix?.openClawVersion) ??
    normalizeVersion(input.baselineDiagnostics.version)
  );
}

function resolveTargetVersion(input: OpenClawCertificationScorecardInput) {
  return (
    normalizeVersion(input.capabilityDiff?.targetVersion) ??
    normalizeVersion(input.targetDiagnostics?.compatibilityReport?.openClaw.installedVersion) ??
    normalizeVersion(input.targetDiagnostics?.capabilityMatrix?.openClawVersion) ??
    normalizeVersion(input.targetDiagnostics?.version) ??
    null
  );
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function formatVersion(value: string | null | undefined) {
  return value ? `v${value}` : "unknown";
}

function clampScore(value: number, max = 100) {
  return Math.max(0, Math.min(max, Math.round(value)));
}
