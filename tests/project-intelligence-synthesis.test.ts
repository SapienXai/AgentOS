import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProjectIntelligenceSynthesisInputFingerprint,
  materializeProjectIntelligencePack,
  synthesizeProjectIntelligence,
  validateProjectIntelligenceSynthesisProposal,
  type ProjectIntelligenceSynthesisProposal
} from "@/lib/agentos/application/project-intelligence-synthesis-service";
import { extractProjectIntelligence } from "@/lib/agentos/application/project-intelligence-extraction-service";

function extraction() {
  return extractProjectIntelligence({
    generationId: "generation-1",
    inputFingerprint: "a".repeat(64),
    sourceIds: ["operator-brief"],
    documents: [{
      documentId: "document-1",
      sourceId: "operator-brief",
      sourceKind: "prompt",
      title: "Operator brief",
      canonicalLocator: "prompt:operator-brief",
      content: "Project type: saas. The product helps teams coordinate customer requests."
    }],
    now: "2026-09-11T00:00:00.000Z"
  });
}

test("synthesis proposals are strict, bounded, and evidence-referenced", () => {
  const input = extraction();
  const fingerprint = createProjectIntelligenceSynthesisInputFingerprint({ brief: "Build a support workspace", extraction: input });
  const evidenceId = input.evidence[0]?.id;
  assert.ok(evidenceId);
  const proposal: ProjectIntelligenceSynthesisProposal = {
    schemaVersion: 1,
    policyVersion: 1,
    proposalId: "proposal-1",
    inputFingerprint: fingerprint,
    status: "ready" as const,
    inferredClaims: [{
      category: "overview" as const,
      key: "businessContext",
      value: "Support operations",
      statement: "The project appears oriented toward support operations.",
      confidence: "medium" as const,
      evidenceRefIds: [evidenceId]
    }],
    unknowns: [],
    warnings: [],
    recommendations: []
  };
  assert.equal(validateProjectIntelligenceSynthesisProposal(proposal, { evidence: input.evidence, inputFingerprint: fingerprint }).valid, true);
  const pack = materializeProjectIntelligencePack({ extraction: input, proposal, packId: "pack-1", now: "2026-09-11T00:00:00.000Z" });
  assert.equal(pack.facts.find((fact) => fact.key === "businessContext")?.verification, "inferred");
  assert.equal(pack.facts.find((fact) => fact.key === "projectType")?.verification, "discovered");
  assert.equal(pack.officialResources.length, 0);
  assert.equal(pack.provenance.generationId, fingerprint);
});

test("synthesis cannot introduce identifiers or unknown evidence references", () => {
  const input = extraction();
  const fingerprint = createProjectIntelligenceSynthesisInputFingerprint({ brief: "Brief", extraction: input });
  const base = {
    schemaVersion: 1,
    policyVersion: 1,
    proposalId: "proposal-2",
    inputFingerprint: fingerprint,
    status: "ready" as const,
    unknowns: [],
    warnings: [],
    recommendations: []
  };
  const invented = validateProjectIntelligenceSynthesisProposal({
    ...base,
    inferredClaims: [{ category: "identifier", key: "networkIdentifier", value: "Ethereum", statement: "invented", confidence: "high", evidenceRefIds: [input.evidence[0]?.id] }]
  }, { evidence: input.evidence, inputFingerprint: fingerprint });
  assert.equal(invented.valid, false);
  const inventedIdentifierCategory = validateProjectIntelligenceSynthesisProposal({
    ...base,
    inferredClaims: [{ category: "identifier", key: "publicId", value: "public", statement: "invented", confidence: "high", evidenceRefIds: [input.evidence[0]?.id] }]
  }, { evidence: input.evidence, inputFingerprint: fingerprint });
  assert.equal(inventedIdentifierCategory.valid, false);
  const unknownEvidence = validateProjectIntelligenceSynthesisProposal({
    ...base,
    inferredClaims: [{ category: "overview", key: "businessContext", value: "Operations", statement: "inferred", confidence: "low", evidenceRefIds: ["missing"] }]
  }, { evidence: input.evidence, inputFingerprint: fingerprint });
  assert.equal(unknownEvidence.valid, false);

  const unqualified = validateProjectIntelligenceSynthesisProposal({
    ...base,
    inferredClaims: [{ category: "not-a-category", key: "businessContext", value: "Operations", statement: "inferred", confidence: "low", evidenceRefIds: [input.evidence[0]?.id] }]
  }, { evidence: input.evidence, inputFingerprint: fingerprint });
  assert.equal(unqualified.valid, false);

  const unsupported = validateProjectIntelligenceSynthesisProposal({
    ...base,
    inferredClaims: [{ category: "overview", key: "businessContext", value: "Operations", statement: "inferred", confidence: "low", evidenceRefIds: [] }]
  }, { evidence: input.evidence, inputFingerprint: fingerprint });
  assert.equal(unsupported.valid, false);
});

test("model synthesis uses the fake structured model and falls back honestly", async () => {
  const input = extraction();
  const brief = "Build a support workspace";
  const fingerprint = createProjectIntelligenceSynthesisInputFingerprint({ brief, extraction: input });
  const modelResult = await synthesizeProjectIntelligence({ brief, extraction: input, packId: "pack-model" }, {
    runId: "run-model",
    attempt: 1,
    signal: new AbortController().signal,
    timeoutMs: 5_000,
    modelExecutor: async () => ({ text: JSON.stringify({ schemaVersion: 1, policyVersion: 1, proposalId: "proposal-model", inputFingerprint: fingerprint, status: "ready", inferredClaims: [], unknowns: [], warnings: [], recommendations: [] }), runId: "remote-1", sessionKey: "session-1", runtime: "model-runtime" })
  });
  assert.equal(modelResult.execution.status, "model");
  assert.equal(modelResult.execution.modelExecutionOccurred, true);

  const fallback = await synthesizeProjectIntelligence({ brief, extraction: input, packId: "pack-fallback" }, {
    runId: "run-fallback",
    attempt: 1,
    signal: new AbortController().signal,
    timeoutMs: 5_000,
    modelExecutor: async () => { throw new Error("temporary provider failure"); }
  });
  assert.equal(fallback.execution.status, "fallback");
  assert.equal(fallback.pack.state, "partial");
  assert.equal(fallback.proposal.status, "fallback");
  assert.equal(fallback.pack.facts.some((fact) => fact.verification === "inferred"), false);
});

test("an interrupted synthesis does not become a reusable fallback", async () => {
  const input = extraction();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => synthesizeProjectIntelligence({ brief: "Build a support workspace", extraction: input, packId: "pack-cancelled" }, {
    runId: "run-cancelled",
    attempt: 1,
    signal: controller.signal,
    timeoutMs: 5_000,
    modelExecutor: async () => { throw new Error("cancelled"); }
  }));
});
