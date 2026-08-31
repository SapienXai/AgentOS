import type { OpenClawServerMethodContractDiffReport } from "@/lib/openclaw/types";
import { aggregateOpenClawRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-model";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeCertificationResult,
  OpenClawRuntimeOperationEvidence,
  OpenClawRuntimeOperationOutcome,
  OpenClawRuntimeRequirementLevel
} from "@/lib/openclaw/runtime-certification/types";

export type OpenClawStaticRuntimeEvidenceOutcome = OpenClawRuntimeOperationOutcome;

export type OpenClawStaticRuntimeEvidenceRow = {
  method: string;
  staticStatus: OpenClawServerMethodContractDiffReport["changes"][number]["status"];
  authorizationEvidence: OpenClawServerMethodContractDiffReport["changes"][number]["authorizationEvidence"];
  requirementLevel: OpenClawRuntimeRequirementLevel;
  runtimeProofs: OpenClawRuntimeCertificationResult[];
  runtimeOperation: OpenClawRuntimeOperationEvidence | null;
  outcome: OpenClawStaticRuntimeEvidenceOutcome;
  reason: string;
};

export type OpenClawStaticRuntimeEvidenceReport = {
  schemaVersion: 2;
  staticTargetVersion: string;
  runtimeTargetVersion: string;
  runtimeVersionMatched: boolean;
  rows: OpenClawStaticRuntimeEvidenceRow[];
  summary: {
    certified: number;
    partiallyCertified: number;
    failed: number;
    uncertified: number;
    staticOnly: number;
  };
};

export function bridgeOpenClawStaticRuntimeEvidence(input: {
  staticReport: OpenClawServerMethodContractDiffReport;
  runtimeReport: OpenClawRuntimeCertificationReport;
}): OpenClawStaticRuntimeEvidenceReport {
  const runtimeVersionMatched = input.staticReport.targetVersion === input.runtimeReport.targetVersion;
  const runtimeResults = runtimeVersionMatched ? input.runtimeReport.results : [];
  const runtimeOperations = runtimeVersionMatched
    ? input.runtimeReport.operations.length > 0
      ? input.runtimeReport.operations
      : aggregateOpenClawRuntimeEvidence(runtimeResults)
    : [];

  const rows = input.staticReport.changes.map((change) => {
    const runtimeProofs = runtimeResults.filter((result) => result.method === change.method);
    const runtimeOperation = runtimeOperations.find(
      (operation) => operation.method === change.method || operation.operationId === change.method
    ) ?? null;
    const requirementLevel = runtimeOperation?.requirementLevel ?? inferRequirementLevel(change.authorizationEvidence);
    const outcome = resolveOutcome({
      authorizationEvidence: change.authorizationEvidence,
      runtimeOperation,
      runtimeProofs,
      runtimeVersionMatched
    });

    return {
      method: change.method,
      staticStatus: change.status,
      authorizationEvidence: change.authorizationEvidence,
      requirementLevel,
      runtimeProofs,
      runtimeOperation,
      outcome,
      reason: resolveReason({
        authorizationEvidence: change.authorizationEvidence,
        outcome,
        runtimeVersionMatched,
        runtimeOperation
      })
    };
  });

  return {
    schemaVersion: 2,
    staticTargetVersion: input.staticReport.targetVersion,
    runtimeTargetVersion: input.runtimeReport.targetVersion,
    runtimeVersionMatched,
    rows,
    summary: {
      certified: rows.filter((row) => row.outcome === "certified").length,
      partiallyCertified: rows.filter((row) => row.outcome === "partially-certified").length,
      failed: rows.filter((row) => row.outcome === "failed").length,
      uncertified: rows.filter((row) => row.outcome === "uncertified").length,
      staticOnly: rows.filter((row) => row.outcome === "static-only").length
    }
  };
}

function resolveOutcome(input: {
  authorizationEvidence: OpenClawStaticRuntimeEvidenceRow["authorizationEvidence"];
  runtimeOperation: OpenClawRuntimeOperationEvidence | null;
  runtimeProofs: OpenClawRuntimeCertificationResult[];
  runtimeVersionMatched: boolean;
}): OpenClawStaticRuntimeEvidenceOutcome {
  if (!input.runtimeVersionMatched || (!input.runtimeOperation && input.runtimeProofs.length === 0)) {
    return input.authorizationEvidence === "runtime-required" ? "uncertified" : "static-only";
  }
  if (input.runtimeOperation) return input.runtimeOperation.outcome;
  if (input.runtimeProofs.some((proof) => proof.status === "FAIL")) return "failed";
  if (input.runtimeProofs.some((proof) => proof.status === "PASS" || proof.status === "EXPECTED-DENIAL")) {
    return input.authorizationEvidence === "runtime-required" ? "partially-certified" : "certified";
  }
  return input.authorizationEvidence === "runtime-required" ? "uncertified" : "static-only";
}

function inferRequirementLevel(
  authorizationEvidence: OpenClawStaticRuntimeEvidenceRow["authorizationEvidence"]
): OpenClawRuntimeRequirementLevel {
  return authorizationEvidence === "runtime-required" ? "required" : "optional";
}

function resolveReason(input: {
  authorizationEvidence: OpenClawStaticRuntimeEvidenceRow["authorizationEvidence"];
  outcome: OpenClawStaticRuntimeEvidenceOutcome;
  runtimeVersionMatched: boolean;
  runtimeOperation: OpenClawRuntimeOperationEvidence | null;
}) {
  if (!input.runtimeVersionMatched) return "Runtime proof was ignored because its target version does not exactly match the static target version.";
  if (input.runtimeOperation) return input.runtimeOperation.reason;
  if (input.outcome === "uncertified" && input.authorizationEvidence === "runtime-required") {
    return "Static analysis requires runtime evidence, but no exact operation proof exists.";
  }
  return "Static evidence is retained without runtime promotion.";
}
