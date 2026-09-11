import { createHash } from "node:crypto";

import { redactSecretText } from "@/lib/security/redaction";

export const WORKSPACE_COMPOSITION_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_COMPOSITION_POLICY_VERSION = "phase7-safe-workspace-composition-v1" as const;

export const workspaceCompositionStatuses = ["ready", "partial", "fallback", "blocked"] as const;
export type WorkspaceCompositionStatus = (typeof workspaceCompositionStatuses)[number];
export const WORKSPACE_COMPOSITION_MAX_ARTIFACTS = 8 as const;

export const workspaceCompositionArtifactIds = [
  "workspace-agents",
  "workspace-soul",
  "workspace-identity",
  "workspace-user",
  "workspace-memory",
  "project-profile",
  "project-architecture",
  "official-resources"
] as const;
export type WorkspaceCompositionArtifactId = (typeof workspaceCompositionArtifactIds)[number];

export const WORKSPACE_COMPOSITION_ARTIFACT_PATHS: Record<WorkspaceCompositionArtifactId, string> = {
  "workspace-agents": "AGENTS.md",
  "workspace-soul": "SOUL.md",
  "workspace-identity": "IDENTITY.md",
  "workspace-user": "USER.md",
  "workspace-memory": "MEMORY.md",
  "project-profile": "docs/project-profile.md",
  "project-architecture": "docs/workspace-architecture.md",
  "official-resources": "docs/official-resources.md"
};

export type WorkspaceCompositionSourceRefs = {
  factIds: readonly string[];
  resourceIds: readonly string[];
  evidenceRefIds: readonly string[];
};

export type WorkspaceCompositionProposalArtifact = {
  artifactId: WorkspaceCompositionArtifactId;
  title: string;
  sections: readonly string[];
  body: string;
  sourceRefs: WorkspaceCompositionSourceRefs;
  blueprintRefs: readonly string[];
};

export type WorkspaceCompositionProposal = {
  schemaVersion: typeof WORKSPACE_COMPOSITION_SCHEMA_VERSION;
  policyVersion: typeof WORKSPACE_COMPOSITION_POLICY_VERSION;
  artifacts: readonly WorkspaceCompositionProposalArtifact[];
  warnings: readonly string[];
};

export type WorkspaceCompositionOperation = "create" | "merge-managed-section" | "preserve" | "conflict";
export type WorkspaceCompositionOwnership = "agentos-managed" | "agentos-managed-section" | "operator-owned" | "preserved" | "conflict";

export type WorkspaceCompositionArtifact = WorkspaceCompositionProposalArtifact & {
  path: string;
  operation: WorkspaceCompositionOperation;
  ownership: WorkspaceCompositionOwnership;
  expectedExistingHash: string | null;
  expectedMaterializedHash: string | null;
  proposedContentHash: string;
  content: string;
  warnings: readonly string[];
};

export type WorkspaceCompositionPlan = {
  schemaVersion: typeof WORKSPACE_COMPOSITION_SCHEMA_VERSION;
  policyVersion: typeof WORKSPACE_COMPOSITION_POLICY_VERSION;
  planId: string;
  inputFingerprint: string;
  status: WorkspaceCompositionStatus;
  projectIntelligencePackId: string | null;
  projectIntelligenceGenerationId: string | null;
  workspaceBlueprintId: string;
  workspaceBlueprintFingerprint: string;
  materializationMode: "empty" | "clone" | "existing";
  existingFileHashes: readonly { path: string; hash: string }[];
  artifacts: readonly WorkspaceCompositionArtifact[];
  warnings: readonly string[];
  conflicts: readonly string[];
  provenance: {
    source: "model" | "fallback";
    modelExecutionOccurred: boolean;
    attempts: number;
    composerRunId: string;
  };
};

export type WorkspaceCompositionSummary = {
  status: WorkspaceCompositionStatus;
  planId: string;
  artifactCount: number;
  createCount: number;
  mergeCount: number;
  preserveCount: number;
  conflictCount: number;
  modelExecutionOccurred: boolean;
  attempts: number;
  elapsedMs: number;
  failure: { code: string; message: string } | null;
};

export type WorkspaceCompositionModelExecutionRequest = {
  runId: string;
  attempt: number;
  idempotencyKey: string;
  signal: AbortSignal;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
};

export type WorkspaceCompositionModelExecutionResult = {
  text: string;
  runId: string | null;
  sessionKey: string | null;
  runtime: "native-openclaw" | "model-runtime";
};

export type WorkspaceCompositionExecutionStarted = {
  runId: string;
  attempt: number;
  idempotencyKey: string;
};

export type WorkspaceCompositionExecutionKnownCompleted = WorkspaceCompositionExecutionStarted & {
  remoteRunId: string | null;
  remoteSessionKey: string | null;
};

export function normalizeWorkspaceCompositionProposal(value: unknown): WorkspaceCompositionProposal {
  if (!isRecord(value) || Object.keys(value).some((key) => !["schemaVersion", "policyVersion", "artifacts", "warnings"].includes(key))) {
    throw new Error("Workspace composition proposal contains unsupported fields.");
  }
  if (value.schemaVersion !== WORKSPACE_COMPOSITION_SCHEMA_VERSION || value.policyVersion !== WORKSPACE_COMPOSITION_POLICY_VERSION || !Array.isArray(value.artifacts) || !Array.isArray(value.warnings)) {
    throw new Error("Workspace composition proposal has an unsupported version or shape.");
  }
  if (value.artifacts.length > WORKSPACE_COMPOSITION_MAX_ARTIFACTS || value.warnings.length > 24) {
    throw new Error("Workspace composition proposal exceeds the bounded output limit.");
  }
  const artifacts = value.artifacts.map((artifact, index) => normalizeProposalArtifact(artifact, index));
  const ids = artifacts.map((artifact) => artifact.artifactId);
  if (new Set(ids).size !== ids.length) throw new Error("Workspace composition proposal contains duplicate artifact ids.");
  return {
    schemaVersion: WORKSPACE_COMPOSITION_SCHEMA_VERSION,
    policyVersion: WORKSPACE_COMPOSITION_POLICY_VERSION,
    artifacts,
    warnings: value.warnings.filter((entry): entry is string => typeof entry === "string").map((entry) => redactSecretText(entry).slice(0, 300)).filter(Boolean).slice(0, 24)
  };
}

export function validateWorkspaceCompositionPlan(value: unknown): value is WorkspaceCompositionPlan {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "schemaVersion", "policyVersion", "planId", "inputFingerprint", "status", "projectIntelligencePackId", "projectIntelligenceGenerationId", "workspaceBlueprintId", "workspaceBlueprintFingerprint", "materializationMode", "existingFileHashes", "artifacts", "warnings", "conflicts", "provenance"
  ].includes(key))) return false;
  if (value.schemaVersion !== WORKSPACE_COMPOSITION_SCHEMA_VERSION || value.policyVersion !== WORKSPACE_COMPOSITION_POLICY_VERSION) return false;
  if (typeof value.planId !== "string" || value.planId.length === 0 || value.planId.length > 160 || typeof value.inputFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(value.inputFingerprint)) return false;
  if ((typeof value.projectIntelligencePackId !== "string" && value.projectIntelligencePackId !== null) || (typeof value.projectIntelligenceGenerationId !== "string" && value.projectIntelligenceGenerationId !== null)) return false;
  if (typeof value.workspaceBlueprintId !== "string" || !/^[a-f0-9]{64}$/i.test(String(value.workspaceBlueprintFingerprint)) || !["empty", "clone", "existing"].includes(value.materializationMode as string)) return false;
  if (!Array.isArray(value.existingFileHashes) || value.existingFileHashes.length > 16 || !value.existingFileHashes.every(validateExistingFileHash)) return false;
  if (!workspaceCompositionStatuses.includes(value.status as WorkspaceCompositionStatus) || !Array.isArray(value.artifacts) || value.artifacts.length > WORKSPACE_COMPOSITION_MAX_ARTIFACTS || !Array.isArray(value.warnings) || value.warnings.length > 24 || !value.warnings.every((warning) => typeof warning === "string" && warning.length <= 300) || !Array.isArray(value.conflicts) || value.conflicts.length > 24 || !value.conflicts.every((conflict) => typeof conflict === "string" && conflict.length <= 300)) return false;
  if (!isRecord(value.provenance) || Object.keys(value.provenance).some((key) => !["source", "modelExecutionOccurred", "attempts", "composerRunId"].includes(key))) return false;
  const provenance = value.provenance;
  if (!["model", "fallback"].includes(provenance.source as string) || typeof provenance.modelExecutionOccurred !== "boolean" || !Number.isSafeInteger(provenance.attempts) || (provenance.attempts as number) < 0 || (provenance.attempts as number) > 2 || typeof provenance.composerRunId !== "string" || provenance.composerRunId.length === 0) return false;
  try {
    const ids = value.artifacts.map((artifact) => normalizePlanArtifact(artifact).artifactId);
    return new Set(ids).size === ids.length;
  } catch {
    return false;
  }
}

export function createWorkspaceCompositionInputFingerprint(value: unknown) {
  return sha256(stableStringify(value));
}

export function summarizeWorkspaceCompositionPlan(plan: WorkspaceCompositionPlan, elapsedMs = 0, failure: WorkspaceCompositionSummary["failure"] = null): WorkspaceCompositionSummary {
  return {
    status: plan.status,
    planId: plan.planId,
    artifactCount: plan.artifacts.length,
    createCount: plan.artifacts.filter((artifact) => artifact.operation === "create").length,
    mergeCount: plan.artifacts.filter((artifact) => artifact.operation === "merge-managed-section").length,
    preserveCount: plan.artifacts.filter((artifact) => artifact.operation === "preserve").length,
    conflictCount: plan.artifacts.filter((artifact) => artifact.operation === "conflict").length,
    modelExecutionOccurred: plan.provenance.modelExecutionOccurred,
    attempts: plan.provenance.attempts,
    elapsedMs: Math.max(0, Math.floor(elapsedMs)),
    failure
  };
}

function normalizeProposalArtifact(value: unknown, index: number): WorkspaceCompositionProposalArtifact {
  if (!isRecord(value) || Object.keys(value).some((key) => !["artifactId", "title", "sections", "body", "sourceRefs", "blueprintRefs"].includes(key))) throw new Error(`Workspace composition artifact ${index + 1} contains unsupported fields.`);
  if (!workspaceCompositionArtifactIds.includes(value.artifactId as WorkspaceCompositionArtifactId) || typeof value.title !== "string" || !Array.isArray(value.sections) || value.sections.length > 24 || typeof value.body !== "string" || !isRecord(value.sourceRefs) || !Array.isArray(value.blueprintRefs) || value.blueprintRefs.length > 64) throw new Error(`Workspace composition artifact ${index + 1} is malformed.`);
  const sourceRefs = value.sourceRefs as Record<string, unknown>;
  if (Object.keys(sourceRefs).some((key) => !["factIds", "resourceIds", "evidenceRefIds"].includes(key)) || !["factIds", "resourceIds", "evidenceRefIds"].every((key) => Array.isArray(sourceRefs[key]))) throw new Error(`Workspace composition artifact ${index + 1} has malformed source references.`);
  const body = redactSecretText(value.body).slice(0, 16_000);
  if (body.includes("[redacted]")) throw new Error(`Workspace composition artifact ${index + 1} contains protected secret material.`);
  return {
    artifactId: value.artifactId as WorkspaceCompositionArtifactId,
    title: redactSecretText(value.title).slice(0, 160),
    sections: value.sections.filter((entry): entry is string => typeof entry === "string").map((entry) => redactSecretText(entry).slice(0, 120)).slice(0, 24),
    body,
    sourceRefs: {
      factIds: normalizeIds(sourceRefs.factIds),
      resourceIds: normalizeIds(sourceRefs.resourceIds),
      evidenceRefIds: normalizeIds(sourceRefs.evidenceRefIds)
    },
    blueprintRefs: normalizeIds(value.blueprintRefs)
  };
}

function normalizePlanArtifact(value: unknown): WorkspaceCompositionArtifact {
  if (!isRecord(value) || Object.keys(value).some((key) => !["artifactId", "title", "sections", "body", "sourceRefs", "blueprintRefs", "path", "operation", "ownership", "expectedExistingHash", "expectedMaterializedHash", "proposedContentHash", "content", "warnings"].includes(key))) throw new Error("Workspace composition plan artifact contains unsupported fields.");
  const proposal = normalizeProposalArtifact({
    artifactId: value.artifactId,
    title: value.title,
    sections: value.sections,
    body: value.body,
    sourceRefs: value.sourceRefs,
    blueprintRefs: value.blueprintRefs
  }, 0);
  if (
    typeof value.path !== "string"
    || WORKSPACE_COMPOSITION_ARTIFACT_PATHS[proposal.artifactId] !== value.path
    || !["create", "merge-managed-section", "preserve", "conflict"].includes(value.operation as string)
    || !["agentos-managed", "agentos-managed-section", "operator-owned", "preserved", "conflict"].includes(value.ownership as string)
    || !("expectedExistingHash" in value)
    || (value.expectedExistingHash !== null && (typeof value.expectedExistingHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.expectedExistingHash)))
    || !("expectedMaterializedHash" in value)
    || (value.expectedMaterializedHash !== null && (typeof value.expectedMaterializedHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.expectedMaterializedHash)))
    || typeof value.proposedContentHash !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.proposedContentHash)
    || typeof value.content !== "string"
    || !Array.isArray(value.warnings)
  ) throw new Error("Workspace composition plan artifact is malformed.");
  if (value.body !== value.content) throw new Error("Workspace composition artifact body and content must agree.");
  if (sha256(value.content) !== value.proposedContentHash) throw new Error("Workspace composition artifact content hash is inconsistent.");
  return { ...proposal, path: value.path, operation: value.operation as WorkspaceCompositionOperation, ownership: value.ownership as WorkspaceCompositionOwnership, expectedExistingHash: value.expectedExistingHash as string | null, expectedMaterializedHash: value.expectedMaterializedHash as string | null, proposedContentHash: value.proposedContentHash, content: value.content, warnings: value.warnings.filter((entry): entry is string => typeof entry === "string").slice(0, 12) };
}

function validateExistingFileHash(value: unknown): value is { path: string; hash: string } {
  return isRecord(value)
    && typeof value.path === "string"
    && value.path.length > 0
    && typeof value.hash === "string"
    && /^[a-f0-9]{64}$/i.test(value.hash)
    && Object.values(WORKSPACE_COMPOSITION_ARTIFACT_PATHS).includes(value.path)
    && Object.keys(value).every((key) => key === "path" || key === "hash");
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Workspace composition references exceed the bounded limit.");
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim()))].slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
