import type { OpenClawServerMethodContractDiffReport } from "@/lib/openclaw/types";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeCertificationResult,
  OpenClawRuntimeCertificationStatus
} from "@/lib/openclaw/runtime-certification/types";

export type OpenClawStaticRuntimeEvidenceOutcome =
  | "certified"
  | "failed"
  | "uncertified"
  | "static-only";

export type OpenClawStaticRuntimeEvidenceRow = {
  method: string;
  staticStatus: OpenClawServerMethodContractDiffReport["changes"][number]["status"];
  authorizationEvidence: OpenClawServerMethodContractDiffReport["changes"][number]["authorizationEvidence"];
  runtimeProof: OpenClawRuntimeCertificationResult | null;
  outcome: OpenClawStaticRuntimeEvidenceOutcome;
  reason: string;
};

export type OpenClawStaticRuntimeEvidenceReport = {
  schemaVersion: 1;
  staticTargetVersion: string;
  runtimeTargetVersion: string;
  runtimeVersionMatched: boolean;
  rows: OpenClawStaticRuntimeEvidenceRow[];
  summary: {
    certified: number;
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
  const rows = input.staticReport.changes.map((change) => {
    const proofs = runtimeResults.filter((result) => result.method === change.method);
    const runtimeProof = selectRuntimeProof(proofs);
    const outcome = resolveOutcome({
      authorizationEvidence: change.authorizationEvidence,
      runtimeProof,
      runtimeVersionMatched
    });

    return {
      method: change.method,
      staticStatus: change.status,
      authorizationEvidence: change.authorizationEvidence,
      runtimeProof,
      outcome,
      reason: resolveReason({
        changeStatus: change.status,
        authorizationEvidence: change.authorizationEvidence,
        outcome,
        runtimeVersionMatched
      })
    };
  });

  return {
    schemaVersion: 1,
    staticTargetVersion: input.staticReport.targetVersion,
    runtimeTargetVersion: input.runtimeReport.targetVersion,
    runtimeVersionMatched,
    rows,
    summary: {
      certified: rows.filter((row) => row.outcome === "certified").length,
      failed: rows.filter((row) => row.outcome === "failed").length,
      uncertified: rows.filter((row) => row.outcome === "uncertified").length,
      staticOnly: rows.filter((row) => row.outcome === "static-only").length
    }
  };
}

function selectRuntimeProof(proofs: OpenClawRuntimeCertificationResult[]) {
  return proofs.find((proof) => proof.status === "FAIL") ??
    proofs.find((proof) => isPassingRuntimeProof(proof.status)) ??
    proofs[0] ??
    null;
}

function resolveOutcome(input: {
  authorizationEvidence: OpenClawStaticRuntimeEvidenceRow["authorizationEvidence"];
  runtimeProof: OpenClawRuntimeCertificationResult | null;
  runtimeVersionMatched: boolean;
}): OpenClawStaticRuntimeEvidenceOutcome {
  if (!input.runtimeVersionMatched || !input.runtimeProof) {
    return input.authorizationEvidence === "runtime-required" ? "uncertified" : "static-only";
  }

  if (input.runtimeProof.status === "FAIL") {
    return "failed";
  }
  if (isPassingRuntimeProof(input.runtimeProof.status)) {
    return "certified";
  }
  return input.authorizationEvidence === "runtime-required" ? "uncertified" : "static-only";
}

function isPassingRuntimeProof(status: OpenClawRuntimeCertificationStatus) {
  return status === "PASS" || status === "EXPECTED-DENIAL";
}

function resolveReason(input: {
  changeStatus: OpenClawStaticRuntimeEvidenceRow["staticStatus"];
  authorizationEvidence: OpenClawStaticRuntimeEvidenceRow["authorizationEvidence"];
  outcome: OpenClawStaticRuntimeEvidenceOutcome;
  runtimeVersionMatched: boolean;
}) {
  if (!input.runtimeVersionMatched) {
    return "Runtime proof was ignored because its target version does not exactly match the static target version.";
  }
  switch (input.outcome) {
    case "certified":
      return "Exact target-version runtime proof passed for this method.";
    case "failed":
      return "Runtime failure overrides the static contract status; this method remains uncertified.";
    case "uncertified":
      return input.authorizationEvidence === "runtime-required"
        ? "Static analysis requires live runtime authorization evidence, but no passing proof exists."
        : "Runtime evidence is incomplete; static evidence remains visible without certification promotion.";
    case "static-only":
      return `Static ${input.changeStatus} evidence is retained; no runtime proof was required.`;
  }
}
