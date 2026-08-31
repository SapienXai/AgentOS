import {
  OPENCLAW_RUNTIME_EVIDENCE_DIMENSIONS,
  type OpenClawRuntimeCertificationResult,
  type OpenClawRuntimeEvidence,
  type OpenClawRuntimeEvidenceDimension,
  type OpenClawRuntimeEvidenceState,
  type OpenClawRuntimeOperationEvidence,
  type OpenClawRuntimeOperationOutcome,
  type OpenClawRuntimeRequirementLevel
} from "@/lib/openclaw/runtime-certification/types";

export function createRuntimeEvidence(
  overrides: Partial<OpenClawRuntimeEvidence> = {}
): OpenClawRuntimeEvidence {
  return Object.fromEntries(
    OPENCLAW_RUNTIME_EVIDENCE_DIMENSIONS.map((dimension) => [dimension, overrides[dimension] ?? "not-tested"])
  ) as OpenClawRuntimeEvidence;
}

export function aggregateOpenClawRuntimeEvidence(
  results: OpenClawRuntimeCertificationResult[]
): OpenClawRuntimeOperationEvidence[] {
  const groups = new Map<string, OpenClawRuntimeCertificationResult[]>();
  for (const result of results) {
    const existing = groups.get(result.operationId) ?? [];
    existing.push(result);
    groups.set(result.operationId, existing);
  }

  return [...groups.values()].map((proofs) => {
    const first = proofs[0];
    const evidenceDimensions = mergeDimensionStates(proofs.map((proof) => proof.evidenceDimensions));
    const outcome = resolveOperationOutcome({
      proofs,
      evidenceDimensions,
      requiredEvidenceDimensions: first.requiredEvidenceDimensions,
      requirementLevel: first.requirementLevel
    });

    return {
      operationId: first.operationId,
      method: first.method,
      requirementLevel: first.requirementLevel,
      requiredEvidenceDimensions: first.requiredEvidenceDimensions,
      requirementRationale: first.requirementRationale,
      evidenceDimensions,
      outcome,
      proofIds: proofs.map((proof) => proof.id),
      reason: resolveOperationReason({
        outcome,
        requiredEvidenceDimensions: first.requiredEvidenceDimensions,
        evidenceDimensions,
        requirementLevel: first.requirementLevel
      })
    };
  });
}

export function resolveOperationOutcome(input: {
  proofs: OpenClawRuntimeCertificationResult[];
  evidenceDimensions: OpenClawRuntimeEvidence;
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[];
  requirementLevel: OpenClawRuntimeRequirementLevel;
}): OpenClawRuntimeOperationOutcome {
  const hasUsefulRequiredEvidence = input.requiredEvidenceDimensions.some((dimension) => {
    const state = input.evidenceDimensions[dimension];
    return state === "proven" || state === "failed";
  });

  if (input.proofs.some((proof) => proof.status === "FAIL")) {
    return "failed";
  }

  if (input.requiredEvidenceDimensions.some((dimension) => input.evidenceDimensions[dimension] === "failed")) {
    return "failed";
  }

  const allRequiredDimensionsProven = input.requiredEvidenceDimensions.every(
    (dimension) => input.evidenceDimensions[dimension] === "proven" || input.evidenceDimensions[dimension] === "not-required"
  );
  if (allRequiredDimensionsProven && hasUsefulRequiredEvidence) {
    return "certified";
  }

  const hasUsefulEvidence = Object.values(input.evidenceDimensions).some((state) => state === "proven" || state === "failed");
  if (hasUsefulEvidence) {
    return "partially-certified";
  }

  return input.requirementLevel === "required" ? "uncertified" : "static-only";
}

export function mergeDimensionStates(
  evidence: OpenClawRuntimeEvidence[]
): OpenClawRuntimeEvidence {
  return createRuntimeEvidence(
    Object.fromEntries(
      OPENCLAW_RUNTIME_EVIDENCE_DIMENSIONS.map((dimension) => [dimension, mergeDimension(dimension, evidence)])
    ) as Partial<OpenClawRuntimeEvidence>
  );
}

function mergeDimension(
  dimension: OpenClawRuntimeEvidenceDimension,
  evidence: OpenClawRuntimeEvidence[]
): OpenClawRuntimeEvidenceState {
  const states = evidence.map((entry) => entry[dimension]);
  if (states.includes("failed")) return "failed";
  if (states.includes("proven")) return "proven";
  if (states.includes("not-required")) return "not-required";
  return "not-tested";
}

function resolveOperationReason(input: {
  outcome: OpenClawRuntimeOperationOutcome;
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[];
  evidenceDimensions: OpenClawRuntimeEvidence;
  requirementLevel: OpenClawRuntimeRequirementLevel;
}) {
  if (input.outcome === "certified") return "All required evidence dimensions are proven.";
  if (input.outcome === "failed") return "A required evidence dimension or runtime proof failed.";
  const missing = input.requiredEvidenceDimensions.filter((dimension) => input.evidenceDimensions[dimension] === "not-tested");
  if (input.outcome === "partially-certified") {
    return `Runtime evidence exists, but required dimensions remain unproven: ${missing.join(", ") || "none"}.`;
  }
  if (input.requirementLevel === "required") {
    return "No sufficient runtime evidence exists for this required operation.";
  }
  return "No runtime proof is required for the current optional or experimental operation classification.";
}
