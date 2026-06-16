import type {
  GatewayDiagnostics,
  OpenClawCapabilityDiffReport,
  OpenClawCapabilityDiffRow,
  OpenClawCertificationScorecardCategory,
  OpenClawCertificationScorecardFinding,
  OpenClawCertificationScorecardReport,
  OpenClawCertificationScorecardStatus,
  OpenClawCertificationRoundTripEvidence,
  OpenClawPluginConfigMigrationFinding,
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
  roundTripEvidence?: OpenClawCertificationRoundTripEvidence | null;
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
  const capabilityBlockerRows = resolveCapabilityBlockerRows(input.capabilityDiff ?? null);
  const pluginConfigFindings = resolvePluginConfigMigrationFindings(input);
  const roundTripEvidence = input.roundTripEvidence ?? createDefaultRoundTripEvidence({
    baselineVersion,
    targetVersion
  });
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
  const roundTripPassed =
    roundTripEvidence.status === "passed" ||
    (input.update.rollbackToCertifiedBaseline === "not-required" && baselineVersion === targetVersion);
  const artifactEligible =
    score >= 90 &&
    hardBlockers.length === 0 &&
    targetDiagnosticsAvailable &&
    input.smokeTest?.status === "passed" &&
    rollbackPassed &&
    roundTripPassed;
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
        capabilityDiff: input.capabilityDiff ?? null,
        capabilityBlockerRows,
        pluginConfigFindings,
        roundTripEvidence
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
    capabilityBlockerRows,
    pluginConfigFindings,
    roundTripEvidence,
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
  const pluginConfigFindings = resolvePluginConfigMigrationFindings(input);
  const findings: OpenClawCertificationScorecardFinding[] = pluginConfigFindings.map((finding) => ({
    id: `plugin-config-${finding.kind}`,
    severity: finding.severity,
    message: finding.message
  }));
  const diagnostics = input.targetDiagnostics;
  let score: number = categoryMaxScores["plugin-config"];

  if (pluginConfigFindings.some((finding) => finding.severity === "blocker")) {
    score = 0;
  }

  if (pluginConfigFindings.some((finding) => finding.severity === "warning")) {
    score = Math.min(score, 8);
  }

  if (diagnostics?.capabilityMatrix?.configPatch !== "supported" && !findings.some((finding) => finding.id === "plugin-config-config-patch")) {
    findings.push({
      id: "plugin-config-config-patch",
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
      ? `${findings.length} plugin/config migration finding(s) were detected.`
      : "No plugin or config migration issues were detected.",
    findings
  });
}

function resolveCapabilityBlockerRows(diff: OpenClawCapabilityDiffReport | null): OpenClawCapabilityDiffRow[] {
  return (diff?.rows ?? []).filter((row) =>
    row.severity === "regression" ||
    row.targetMode === "missing" ||
    row.targetMode === "disabled" ||
    row.missingRequiredMethods.length > 0
  );
}

function resolvePluginConfigMigrationFindings(
  input: OpenClawCertificationScorecardInput
): OpenClawPluginConfigMigrationFinding[] {
  const output = input.update.output ?? "";
  const findings: OpenClawPluginConfigMigrationFinding[] = [];
  const pluginApi = /plugin\s+["']?([@\w./-]+)["']?:?\s+plugin requires plugin API\s+>=?v?(\d+(?:\.\d+)+),?\s+but this host is\s+v?(\d+(?:\.\d+)+)/i.exec(output);
  const pluginInstall = /Plugin\s+"([^"]+)"\s+installation blocked(?::\s*([^\n]+))?/i.exec(output);
  const disabledPlugin = /Disabled\s+"([^"]+)"\s+after plugin update failure(?::\s*([^\n]+))?/i.exec(output);
  const configBlocker =
    /config (?:was written by version|last written by(?: a newer OpenClaw version)?)[^\d]*(?:v)?(\d+(?:\.\d+)+)/i.exec(output) ??
    /Refusing to (?:install|restart|rewrite).*older than the config last written by[^\d]*(?:v)?(\d+(?:\.\d+)+)/i.exec(output);
  const updateStatusWarning = /update\.status did not include update availability details/i.test(output);
  const configPatchWarning =
    /Gateway config schema\/patch support is not available/i.test(output) ||
    input.targetDiagnostics?.capabilityMatrix?.configPatch !== "supported";

  if (pluginApi) {
    findings.push(createPluginConfigFinding({
      kind: "plugin-api",
      severity: "blocker",
      pluginId: pluginApi[1] ?? null,
      requiredApiVersion: pluginApi[2] ?? null,
      hostVersion: pluginApi[3] ?? null,
      message: `${pluginApi[1]} plugin requires plugin API >=${formatVersion(pluginApi[2])}; host reports ${formatVersion(pluginApi[3])}.`,
      recovery: "Align the OpenClaw plugin version with the active OpenClaw host before certifying this target."
    }));
  }

  if (pluginInstall || disabledPlugin) {
    const match = pluginInstall ?? disabledPlugin;
    findings.push(createPluginConfigFinding({
      kind: "plugin-install",
      severity: "blocker",
      pluginId: match?.[1] ?? null,
      message: match?.[2]
        ? `${match[1]} plugin install/update failed: ${sanitizeFindingMessage(match[2])}.`
        : `${match?.[1] ?? "OpenClaw"} plugin install/update failed.`,
      recovery: "Repair the plugin install/update failure and rerun certification."
    }));
  }

  if (configBlocker) {
    findings.push(createPluginConfigFinding({
      kind: "config-version",
      severity: "blocker",
      configWriterVersion: configBlocker[1] ?? null,
      message: `OpenClaw config/service metadata was written by ${formatVersion(configBlocker[1])} and blocked restart or recovery.`,
      recovery: "Restore the matching OpenClaw version or migrate/reset the OpenClaw config before retrying certification."
    }));
  }

  if (updateStatusWarning) {
    findings.push(createPluginConfigFinding({
      kind: "update-status-schema",
      severity: "warning",
      message: "Gateway update.status did not include update availability details.",
      recovery: "Keep update status classified as incomplete until the Gateway reports availability metadata."
    }));
  }

  if (configPatchWarning) {
    findings.push(createPluginConfigFinding({
      kind: "config-patch",
      severity: "warning",
      configKey: "config.patch",
      message: "Gateway config schema/patch support is unavailable or unknown.",
      recovery: "Keep config mutation surfaces degraded until config schema/patch support is advertised."
    }));
  }

  return dedupePluginConfigFindings(findings);
}

function createPluginConfigFinding(
  input: Partial<OpenClawPluginConfigMigrationFinding> &
    Pick<OpenClawPluginConfigMigrationFinding, "kind" | "severity" | "message">
): OpenClawPluginConfigMigrationFinding {
  return {
    kind: input.kind,
    severity: input.severity,
    pluginId: sanitizeConfigKey(input.pluginId),
    pluginVersion: sanitizeVersion(input.pluginVersion),
    requiredApiVersion: sanitizeVersion(input.requiredApiVersion),
    hostVersion: sanitizeVersion(input.hostVersion),
    configWriterVersion: sanitizeVersion(input.configWriterVersion),
    configKey: sanitizeConfigKey(input.configKey),
    message: sanitizeFindingMessage(input.message),
    recovery: input.recovery ? sanitizeFindingMessage(input.recovery) : null
  };
}

function dedupePluginConfigFindings(findings: OpenClawPluginConfigMigrationFinding[]) {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = `${finding.kind}:${finding.pluginId ?? ""}:${finding.configWriterVersion ?? ""}:${finding.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sanitizeVersion(value: string | null | undefined) {
  return normalizeVersion(value);
}

function sanitizeConfigKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/[^\w@./:-]+/g, "")
    .split("/")
    .filter(Boolean)
    .slice(-2)
    .join("/");
}

function sanitizeFindingMessage(value: string) {
  return value
    .replace(/(?:[A-Za-z]:)?\/(?:Users|home)\/[^/\s]+/g, "<home>")
    .replace(/(?:token|password|secret|key)=\S+/gi, "$1=<redacted>")
    .trim();
}

function createDefaultRoundTripEvidence(input: {
  baselineVersion: string | null;
  targetVersion: string | null;
}): OpenClawCertificationRoundTripEvidence {
  return {
    status: "not-run",
    startedAt: null,
    finishedAt: null,
    baselineVersion: input.baselineVersion,
    targetVersion: input.targetVersion,
    steps: [],
    failureMessage: null
  };
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
