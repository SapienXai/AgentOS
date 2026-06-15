import type {
  GatewayDiagnostics,
  OpenClawCapabilityDiffReport,
  OpenClawCapabilityDiffRow,
  OpenClawCapabilityOperation,
  OpenClawCapabilityOperationMode
} from "@/lib/openclaw/types";

type OperationMode = OpenClawCapabilityOperationMode | "missing";

const modeRank: Record<OperationMode, number> = {
  "gateway-native": 5,
  degraded: 4,
  "cli-fallback": 3,
  unknown: 2,
  disabled: 1,
  missing: 0
};

export function buildOpenClawCapabilityDiffReport(input: {
  certified: GatewayDiagnostics;
  target: GatewayDiagnostics;
  generatedAt?: Date;
}): OpenClawCapabilityDiffReport {
  const certifiedOperations = resolveCapabilityOperations(input.certified);
  const targetOperations = resolveCapabilityOperations(input.target);
  const operationIds = Array.from(new Set([
    ...Object.keys(certifiedOperations),
    ...Object.keys(targetOperations)
  ])).sort();

  const rows = operationIds
    .map((operationId) =>
      buildCapabilityDiffRow({
        operationId,
        certifiedOperation: certifiedOperations[operationId] ?? null,
        targetOperation: targetOperations[operationId] ?? null,
        certifiedDiagnostics: input.certified,
        targetDiagnostics: input.target
      })
    )
    .sort((left, right) => {
      const severityOrder = diffSeveritySortOrder(left.severity) - diffSeveritySortOrder(right.severity);
      if (severityOrder !== 0) {
        return severityOrder;
      }

      const changeOrder = diffChangeSortOrder(left.changeKind) - diffChangeSortOrder(right.changeKind);
      if (changeOrder !== 0) {
        return changeOrder;
      }

      return left.label.localeCompare(right.label);
    });

  return {
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    certifiedVersion:
      input.certified.compatibilityReport?.openClaw.installedVersion ??
      input.certified.capabilityMatrix?.openClawVersion ??
      input.certified.version ??
      null,
    targetVersion:
      input.target.compatibilityReport?.openClaw.installedVersion ??
      input.target.capabilityMatrix?.openClawVersion ??
      input.target.version ??
      null,
    certifiedProtocolVersion:
      input.certified.compatibilityReport?.gateway.protocolVersion ??
      input.certified.capabilityMatrix?.gatewayProtocolVersion ??
      null,
    targetProtocolVersion:
      input.target.compatibilityReport?.gateway.protocolVersion ??
      input.target.capabilityMatrix?.gatewayProtocolVersion ??
      null,
    summary: {
      totalOperations: rows.length,
      unchangedOperations: rows.filter((row) => row.changeKind === "unchanged").length,
      addedOperations: rows.filter((row) => row.changeKind === "added").length,
      removedOperations: rows.filter((row) => row.changeKind === "removed").length,
      nativeImprovements: rows.filter((row) => row.severity === "improvement" && row.targetNative).length,
      nativeRegressions: rows.filter((row) => row.severity === "regression" && row.certifiedNative && !row.targetNative).length,
      fallbackRegressions: rows.filter((row) =>
        row.severity === "regression" &&
        row.certifiedMode !== "cli-fallback" &&
        row.targetMode === "cli-fallback"
      ).length,
      newMissingRequiredMethods: rows.reduce((total, row) => total + row.missingRequiredMethods.length, 0),
      degradedOrUnknownOperations: rows.filter((row) =>
        row.targetMode === "degraded" ||
        row.targetMode === "unknown" ||
        row.targetMode === "disabled" ||
        row.targetMode === "missing"
      ).length,
      certificationBlockerCount: rows.filter((row) => isCertificationBlocker(row)).length
    },
    rows
  };
}

function buildCapabilityDiffRow(input: {
  operationId: string;
  certifiedOperation: OpenClawCapabilityOperation | null;
  targetOperation: OpenClawCapabilityOperation | null;
  certifiedDiagnostics: GatewayDiagnostics;
  targetDiagnostics: GatewayDiagnostics;
}): OpenClawCapabilityDiffRow {
  const certifiedMode = input.certifiedOperation?.mode ?? "missing";
  const targetMode = input.targetOperation?.mode ?? "missing";
  const addedMethods = difference(input.targetOperation?.methods, input.certifiedOperation?.methods);
  const removedMethods = difference(input.certifiedOperation?.methods, input.targetOperation?.methods);
  const addedEvents = difference(input.targetOperation?.events, input.certifiedOperation?.events);
  const removedEvents = difference(input.certifiedOperation?.events, input.targetOperation?.events);
  const missingRequiredMethods = resolveNewMissingRequiredMethods(input.operationId, input.certifiedDiagnostics, input.targetDiagnostics);
  const changeKind = resolveCapabilityDiffChangeKind({
    certifiedOperation: input.certifiedOperation,
    targetOperation: input.targetOperation,
    certifiedMode,
    targetMode,
    addedMethods,
    removedMethods,
    addedEvents,
    removedEvents
  });
  const severity = resolveCapabilityDiffSeverity({
    changeKind,
    certifiedMode,
    targetMode,
    certifiedFallbackAllowed: Boolean(input.certifiedOperation?.fallbackAllowed),
    targetFallbackAllowed: Boolean(input.targetOperation?.fallbackAllowed),
    missingRequiredMethods
  });

  return {
    operationId: input.operationId,
    label: input.targetOperation?.label || input.certifiedOperation?.label || input.operationId,
    changeKind,
    severity,
    certifiedMode,
    targetMode,
    certifiedNative: certifiedMode === "gateway-native",
    targetNative: targetMode === "gateway-native",
    certifiedFallbackAllowed: Boolean(input.certifiedOperation?.fallbackAllowed),
    targetFallbackAllowed: Boolean(input.targetOperation?.fallbackAllowed),
    addedMethods,
    removedMethods,
    addedEvents,
    removedEvents,
    missingRequiredMethods,
    reason: input.targetOperation?.reason || input.certifiedOperation?.reason || "No capability reason reported.",
    recovery: input.targetOperation?.recovery ?? input.certifiedOperation?.recovery ?? null
  };
}

function resolveCapabilityOperations(diagnostics: GatewayDiagnostics) {
  if (diagnostics.capabilityMatrix?.operations) {
    return diagnostics.capabilityMatrix.operations;
  }

  return Object.fromEntries(
    (diagnostics.compatibilityReport?.contracts ?? []).map((contract) => [
      contract.operation,
      {
        label: contract.label,
        mode: contract.nativeGatewaySupported
          ? "gateway-native"
          : contract.cliFallbackAvailable
            ? "cli-fallback"
            : contract.status === "failed" || contract.status === "degraded"
              ? "degraded"
              : "disabled",
        methods: contract.methods,
        events: contract.events,
        fallbackAllowed: contract.cliFallbackAvailable,
        baseline: contract.baseline,
        reason: contract.reason,
        recovery: contract.suggestedRecovery,
        preferredMethod: contract.methods[0] ?? null,
        supportedMethod: contract.supportedMethod,
        compatibility: contract.nativeGatewaySupported
          ? contract.supportedMethod && !contract.methods.includes(contract.supportedMethod)
            ? "alias"
            : "preferred"
          : "missing"
      } satisfies OpenClawCapabilityOperation
    ])
  );
}

function resolveCapabilityDiffChangeKind(input: {
  certifiedOperation: OpenClawCapabilityOperation | null;
  targetOperation: OpenClawCapabilityOperation | null;
  certifiedMode: OperationMode;
  targetMode: OperationMode;
  addedMethods: string[];
  removedMethods: string[];
  addedEvents: string[];
  removedEvents: string[];
}): OpenClawCapabilityDiffRow["changeKind"] {
  if (!input.certifiedOperation && input.targetOperation) {
    return "added";
  }

  if (input.certifiedOperation && !input.targetOperation) {
    return "removed";
  }

  if (input.certifiedMode !== input.targetMode) {
    return "mode-changed";
  }

  if (
    input.addedMethods.length > 0 ||
    input.removedMethods.length > 0 ||
    input.addedEvents.length > 0 ||
    input.removedEvents.length > 0
  ) {
    return "method-changed";
  }

  if (Boolean(input.certifiedOperation?.fallbackAllowed) !== Boolean(input.targetOperation?.fallbackAllowed)) {
    return "fallback-changed";
  }

  return "unchanged";
}

function resolveCapabilityDiffSeverity(input: {
  changeKind: OpenClawCapabilityDiffRow["changeKind"];
  certifiedMode: OperationMode;
  targetMode: OperationMode;
  certifiedFallbackAllowed: boolean;
  targetFallbackAllowed: boolean;
  missingRequiredMethods: string[];
}): OpenClawCapabilityDiffRow["severity"] {
  if (input.missingRequiredMethods.length > 0) {
    return "regression";
  }

  if (input.changeKind === "removed") {
    return "regression";
  }

  if (modeRank[input.targetMode] < modeRank[input.certifiedMode]) {
    return "regression";
  }

  if (
    input.certifiedMode !== "cli-fallback" &&
    input.targetMode === "cli-fallback"
  ) {
    return "regression";
  }

  if (modeRank[input.targetMode] > modeRank[input.certifiedMode] || input.changeKind === "added") {
    return "improvement";
  }

  if (!input.certifiedFallbackAllowed && input.targetFallbackAllowed) {
    return "changed";
  }

  return input.changeKind === "unchanged" ? "unchanged" : "changed";
}

function resolveNewMissingRequiredMethods(
  operationId: string,
  certifiedDiagnostics: GatewayDiagnostics,
  targetDiagnostics: GatewayDiagnostics
) {
  const certifiedMissing = new Set(resolveMissingRequiredMethods(operationId, certifiedDiagnostics));
  return resolveMissingRequiredMethods(operationId, targetDiagnostics).filter((method) => !certifiedMissing.has(method));
}

function resolveMissingRequiredMethods(operationId: string, diagnostics: GatewayDiagnostics) {
  const contract = diagnostics.capabilityMatrix?.compatibility?.methodContract;
  const operationMethods = new Set(diagnostics.capabilityMatrix?.operations?.[operationId]?.methods ?? []);
  const missing = new Set<string>();

  for (const method of contract?.missingRequiredMethods ?? []) {
    if (operationMethods.has(method)) {
      missing.add(method);
    }
  }

  for (const entry of contract?.missingOperations ?? []) {
    const [id, detail] = entry.split(/:\s*/, 2);
    if (id === operationId && detail) {
      missing.add(detail);
    }
  }

  for (const check of diagnostics.compatibilityReport?.contracts ?? []) {
    if (check.operation === operationId && check.baseline === "required" && !check.nativeGatewaySupported) {
      for (const method of check.methods) {
        missing.add(method);
      }
    }
  }

  return Array.from(missing);
}

function difference(left: string[] | undefined, right: string[] | undefined) {
  const rightValues = new Set(right ?? []);
  return (left ?? []).filter((value) => !rightValues.has(value));
}

function isCertificationBlocker(row: OpenClawCapabilityDiffRow) {
  return (
    row.severity === "regression" ||
    row.targetMode === "missing" ||
    row.targetMode === "disabled" ||
    row.missingRequiredMethods.length > 0
  );
}

function diffSeveritySortOrder(value: OpenClawCapabilityDiffRow["severity"]) {
  switch (value) {
    case "regression":
      return 0;
    case "changed":
      return 1;
    case "improvement":
      return 2;
    case "unchanged":
      return 3;
  }
}

function diffChangeSortOrder(value: OpenClawCapabilityDiffRow["changeKind"]) {
  switch (value) {
    case "removed":
      return 0;
    case "mode-changed":
      return 1;
    case "method-changed":
      return 2;
    case "fallback-changed":
      return 3;
    case "added":
      return 4;
    case "unchanged":
      return 5;
  }
}
