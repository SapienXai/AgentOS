import { createHash } from "node:crypto";

import {
  createEmptyProjectIntelligencePack,
  normalizeProjectFactValue,
  normalizeProjectIntelligenceText,
  validateProjectIntelligencePack,
  type EvidenceRef,
  type OfficialResource,
  type ProjectClaimEvidence,
  type ProjectFact,
  type ProjectFactCategory,
  type ProjectFactValue,
  type ProjectIntelligencePack,
  type ProjectIntelligencePackState,
  PROJECT_FACT_CATEGORIES
} from "@/lib/agentos/domains/project-intelligence";
import type { ProjectIntelligenceExtraction } from "@/lib/agentos/application/project-intelligence-extraction-service";
import {
  buildProjectIntelligenceExecutionPrompt,
  ProjectIntelligenceRemoteExecutionError,
  runStructuredProjectIntelligenceAgent,
  type ProjectIntelligenceModelExecutionResult
} from "@/lib/openclaw/application/structured-agent-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { PlannerRuntimeEnsureDependencies } from "@/lib/openclaw/application/planner-runtime-service";
import { redactSecretText } from "@/lib/security/redaction";

export const PROJECT_INTELLIGENCE_SYNTHESIS_SCHEMA_VERSION = 1 as const;
export const PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION = 1 as const;

export type ProjectIntelligenceSynthesisStatus = "ready" | "partial" | "fallback";

export type ProjectIntelligenceSynthesisClaim = {
  category: ProjectFactCategory;
  key: string;
  value: ProjectFactValue;
  statement: string;
  confidence: "low" | "medium" | "high";
  evidenceRefIds: readonly string[];
};

export type ProjectIntelligenceSynthesisProposal = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SYNTHESIS_SCHEMA_VERSION;
  policyVersion: typeof PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION;
  proposalId: string;
  inputFingerprint: string;
  status: ProjectIntelligenceSynthesisStatus;
  inferredClaims: readonly ProjectIntelligenceSynthesisClaim[];
  unknowns: readonly string[];
  warnings: readonly string[];
  recommendations: readonly string[];
};

export type ProjectIntelligenceInputBundle = {
  brief: string;
  extractionId: string;
  inputFingerprint: string;
  sourceIds: readonly string[];
  facts: readonly Pick<ProjectFact, "id" | "category" | "key" | "normalizedValue" | "statement" | "verification" | "evidence">[];
  resources: readonly Pick<OfficialResource, "id" | "category" | "locator" | "label" | "verification" | "evidence">[];
  evidence: readonly Pick<EvidenceRef, "id" | "sourceId" | "canonicalLocator" | "title" | "excerpt" | "summary" | "qualification" | "claimScopes">[];
  conflicts: ProjectIntelligenceExtraction["conflicts"];
  unknowns: readonly string[];
};

export type ProjectIntelligenceSynthesisResult = {
  proposal: ProjectIntelligenceSynthesisProposal;
  pack: ProjectIntelligencePack;
  execution: {
    status: "model" | "fallback";
    modelExecutionOccurred: boolean;
    remoteRunId: string | null;
    remoteSessionKey: string | null;
    failureCode: string | null;
  };
};

export type ProjectIntelligenceSynthesisOptions = {
  runId: string;
  attempt: number;
  signal: AbortSignal;
  timeoutMs: number;
  adapter?: OpenClawAdapter;
  runtimeDependencies?: PlannerRuntimeEnsureDependencies;
  modelExecutor?: (input: ProjectIntelligenceInputBundle, options: { signal: AbortSignal; timeoutMs: number }) => Promise<ProjectIntelligenceModelExecutionResult>;
  now?: string;
};

const MAX_BRIEF_LENGTH = 4_000;
const MAX_EVIDENCE = 64;
const MAX_FACTS = 96;
const MAX_RESOURCES = 64;
const MAX_CONFLICTS = 16;
const MAX_ARRAY_ITEMS = 24;
const MAX_CLAIMS = 32;
const MAX_CLAIM_VALUE_LENGTH = 800;
const PROTECTED_INFERRED_KEYS = new Set([
  "contacts",
  "publicContactEmail",
  "publicContactPhone",
  "contractAddress",
  "networkIdentifier",
  "applicationIdentifier",
  "repositoryIdentifier",
  "officialWebsite",
  "officialRepository",
  "officialDocumentation"
]);
const PROTECTED_INFERRED_KEY_PATTERN = /contact|email|phone|url|uri|address|identifier|repository|network|package|application|contract|website|documentation|resource/i;

export const PROJECT_INTELLIGENCE_SYNTHESIS_SYSTEM_POLICY = [
  "You are the Project Intelligence Agent inside AgentOS.",
  "Synthesize only bounded, evidence-grounded project claims from the supplied normalized extraction.",
  "ProjectFact is the canonical factual claim layer. Evidence owns proof and qualification.",
  "Do not change or repeat canonical facts/resources. Add only genuinely inferred claims.",
  "Never invent URLs, contacts, package IDs, application IDs, repository identifiers, network identifiers, or contract addresses.",
  "Operator brief text is intent context, not authoritative evidence.",
  "Preserve conflicts and unknowns. Do not resolve conflicts by choosing a winner.",
  "Return JSON only with the versioned ProjectIntelligenceSynthesisProposal shape.",
  `Policy version: ${PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION}.`
].join("\n");

export function buildProjectIntelligenceInputBundle(input: {
  brief: string;
  extraction: ProjectIntelligenceExtraction;
}): ProjectIntelligenceInputBundle {
  return {
    brief: redactSecretText(input.brief.trim()).slice(0, MAX_BRIEF_LENGTH),
    extractionId: input.extraction.extractionId,
    inputFingerprint: input.extraction.inputFingerprint,
    sourceIds: input.extraction.sourceIds.slice(0, MAX_ARRAY_ITEMS),
    facts: input.extraction.facts.slice(0, MAX_FACTS).map((fact) => ({
      id: fact.id,
      category: fact.category,
      key: fact.key,
      normalizedValue: fact.normalizedValue,
      statement: fact.statement,
      verification: fact.verification,
      evidence: fact.evidence
    })),
    resources: input.extraction.resources.slice(0, MAX_RESOURCES).map((resource) => ({
      id: resource.id,
      category: resource.category,
      locator: resource.locator,
      label: resource.label,
      verification: resource.verification,
      evidence: resource.evidence
    })),
    evidence: input.extraction.evidence.slice(0, MAX_EVIDENCE).map((evidence) => ({
      id: evidence.id,
      sourceId: evidence.sourceId,
      ...(evidence.canonicalLocator ? { canonicalLocator: evidence.canonicalLocator } : {}),
      title: evidence.title,
      ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}),
      summary: evidence.summary,
      qualification: evidence.qualification,
      ...(evidence.claimScopes ? { claimScopes: evidence.claimScopes } : {})
    })),
    conflicts: input.extraction.conflicts.slice(0, MAX_CONFLICTS),
    unknowns: input.extraction.unknowns.slice(0, MAX_ARRAY_ITEMS)
  };
}

export function createProjectIntelligenceSynthesisInputFingerprint(input: { brief: string; extraction: ProjectIntelligenceExtraction }) {
  return sha256(stableStringify({
    schemaVersion: PROJECT_INTELLIGENCE_SYNTHESIS_SCHEMA_VERSION,
    policyVersion: PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION,
    brief: redactSecretText(input.brief.trim()).slice(0, MAX_BRIEF_LENGTH),
    extractionId: input.extraction.extractionId,
    extractionFingerprint: input.extraction.inputFingerprint
  }));
}

export function validateProjectIntelligenceSynthesisProposal(value: unknown, input?: { evidence?: readonly EvidenceRef[]; inputFingerprint?: string }) {
  const issues: Array<{ path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference"; message: string }> = [];
  if (!isRecord(value)) return { valid: false, issues: [{ path: "proposal", code: "invalid_type" as const, message: "Synthesis proposal must be an object." }] };
  assertOnlyKeys(value, ["schemaVersion", "policyVersion", "proposalId", "inputFingerprint", "status", "inferredClaims", "unknowns", "warnings", "recommendations"], "proposal", issues);
  if (value.schemaVersion !== PROJECT_INTELLIGENCE_SYNTHESIS_SCHEMA_VERSION) issues.push(issue("proposal.schemaVersion", "invalid_value", "Unsupported synthesis schema version."));
  if (value.policyVersion !== PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION) issues.push(issue("proposal.policyVersion", "invalid_value", "Unsupported synthesis policy version."));
  for (const key of ["proposalId", "inputFingerprint"]) if (typeof value[key] !== "string" || !value[key]) issues.push(issue(`proposal.${key}`, "missing_field", "A bounded proposal identifier is required."));
  if (input?.inputFingerprint && value.inputFingerprint !== input.inputFingerprint) issues.push(issue("proposal.inputFingerprint", "invalid_value", "Synthesis proposal input fingerprint does not match the bounded input."));
  if (!(value.status === "ready" || value.status === "partial" || value.status === "fallback")) issues.push(issue("proposal.status", "invalid_value", "Unsupported synthesis status."));
  for (const key of ["unknowns", "warnings", "recommendations"]) validateStringArray(value[key], `proposal.${key}`, issues);
  if (!Array.isArray(value.inferredClaims)) issues.push(issue("proposal.inferredClaims", "invalid_type", "Inferred claims must be an array."));
  else {
    if (value.inferredClaims.length > MAX_CLAIMS) issues.push(issue("proposal.inferredClaims", "invalid_value", "Inferred claims exceed the bounded proposal limit."));
    value.inferredClaims.forEach((claim, index) => validateSynthesisClaim(claim, `proposal.inferredClaims[${index}]`, issues, input?.evidence));
  }
  return { valid: issues.length === 0, issues };
}

export function createFallbackProjectIntelligenceSynthesisProposal(inputFingerprint: string, now = new Date().toISOString()): ProjectIntelligenceSynthesisProposal {
  return {
    schemaVersion: PROJECT_INTELLIGENCE_SYNTHESIS_SCHEMA_VERSION,
    policyVersion: PROJECT_INTELLIGENCE_SYNTHESIS_POLICY_VERSION,
    proposalId: `intelligence-synthesis-fallback-${sha256(`${inputFingerprint}|${now}`).slice(0, 32)}`,
    inputFingerprint,
    status: "fallback",
    inferredClaims: [],
    unknowns: ["intelligence-synthesis"],
    warnings: ["AI project intelligence synthesis was unavailable; canonical extracted evidence was preserved."],
    recommendations: []
  };
}

export function materializeProjectIntelligencePack(input: {
  extraction: ProjectIntelligenceExtraction;
  proposal: ProjectIntelligenceSynthesisProposal;
  packId: string;
  now?: string;
}) {
  const now = input.now ?? new Date().toISOString();
  const proposalValidation = validateProjectIntelligenceSynthesisProposal(input.proposal, { evidence: input.extraction.evidence, inputFingerprint: input.proposal.inputFingerprint });
  if (!proposalValidation.valid) throw new Error("Project Intelligence synthesis proposal failed normalized validation.");
  const facts = input.extraction.facts.map((fact) => structuredClone(fact));
  const factIdentities = new Set(facts.map((fact) => `${fact.key}|${stableStringify(fact.normalizedValue)}`));
  for (const [index, claim] of input.proposal.inferredClaims.slice(0, MAX_CLAIMS).entries()) {
    const normalizedValue = normalizeProjectFactValue(claim.value);
    const identity = `${claim.key}|${stableStringify(normalizedValue)}`;
    if (factIdentities.has(identity)) continue;
    factIdentities.add(identity);
    const evidence = claim.evidenceRefIds.map((evidenceRefId) => ({ evidenceRefId, relation: "context" as const } satisfies ProjectClaimEvidence));
    facts.push({
      schemaVersion: 1,
      id: `fact-inferred-${sha256(`${input.proposal.proposalId}|${index}|${identity}`).slice(0, 32)}`,
      category: claim.category,
      key: claim.key,
      value: claim.value,
      normalizedValue,
      statement: normalizeProjectIntelligenceText(claim.statement, MAX_CLAIM_VALUE_LENGTH),
      confidence: claim.confidence,
      verification: "inferred",
      evidence,
      sourceIds: unique(claim.evidenceRefIds.map((id) => input.extraction.evidence.find((entry) => entry.id === id)?.sourceId).filter((id): id is string => Boolean(id))),
      provenance: { origin: input.extraction.evidence.find((entry) => claim.evidenceRefIds.includes(entry.id))?.provenance.origin ?? "unknown-external", declaredBy: "system" },
      observedAt: now
    });
  }
  const base = createEmptyProjectIntelligencePack({ id: input.packId, now });
  const pack: ProjectIntelligencePack = {
    ...base,
    state: packState(input.proposal.status, facts, input.extraction.resources),
    identity: projectIdentity(facts),
    overview: projectOverview(facts),
    products: projectCollections(facts, ["products", "services", "features", "platforms"]) as ProjectIntelligencePack["products"],
    technicalLandscape: projectCollections(facts, ["frontend", "backend", "mobile", "apis", "repositories", "technologies", "infrastructure", "networks", "dependencies", "integrations"]) as ProjectIntelligencePack["technicalLandscape"],
    officialResources: input.extraction.resources.map((resource) => structuredClone(resource)),
    contacts: projectCollection<ProjectIntelligencePack["contacts"]["value"][number]>(facts, "contacts", []),
    identifiers: projectCollection<ProjectIntelligencePack["identifiers"]["value"][number]>(facts, "identifiers", ["networkIdentifier", "contractAddress", "applicationIdentifier", "repositoryIdentifier"]),
    facts,
    evidence: input.extraction.evidence.map((entry) => structuredClone(entry)),
    unknowns: unique([...input.extraction.unknowns, ...input.proposal.unknowns].map((value) => normalizeProjectIntelligenceText(value, 400))).slice(0, MAX_ARRAY_ITEMS),
    conflicts: input.extraction.conflicts.map((conflict) => structuredClone(conflict)),
    sourceCoverage: {
      sourceIds: unique([...input.extraction.sourceIds]),
      evidenceRefIds: input.extraction.evidence.map((entry) => entry.id),
      coveredFactIds: facts.map((fact) => fact.id),
      uncoveredAreas: unique([...input.extraction.unknowns, ...input.proposal.unknowns])
    },
    provenance: { generatedBy: "system", sourceIds: unique([...input.extraction.sourceIds]), generationId: input.proposal.inputFingerprint },
    generation: { id: input.proposal.proposalId, createdAt: now, method: "system" },
    updatedAt: now
  };
  const validation = validateProjectIntelligencePack(pack);
  if (!validation.valid) throw new Error("Materialized Project Intelligence pack failed normalized validation.");
  return pack;
}

export async function synthesizeProjectIntelligence(input: {
  brief: string;
  extraction: ProjectIntelligenceExtraction;
  packId: string;
}, options: ProjectIntelligenceSynthesisOptions): Promise<ProjectIntelligenceSynthesisResult> {
  const now = options.now ?? new Date().toISOString();
  const inputFingerprint = createProjectIntelligenceSynthesisInputFingerprint(input);
  const bundle = buildProjectIntelligenceInputBundle(input);
  let completedModel: ProjectIntelligenceModelExecutionResult | null = null;
  try {
    const model = options.modelExecutor
      ? await options.modelExecutor(bundle, { signal: options.signal, timeoutMs: options.timeoutMs })
      : await runStructuredProjectIntelligenceAgent({
          runId: options.runId,
          attempt: options.attempt,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          systemPrompt: PROJECT_INTELLIGENCE_SYNTHESIS_SYSTEM_POLICY,
          userPrompt: buildProjectIntelligenceExecutionPrompt(bundle)
        }, { adapter: options.adapter, runtimeDependencies: options.runtimeDependencies });
    completedModel = model;
    const parsed = parseProposal(model.text, inputFingerprint);
    const proposalValidation = validateProjectIntelligenceSynthesisProposal(parsed, { evidence: input.extraction.evidence, inputFingerprint });
    if (!proposalValidation.valid) throw new Error("Structured Project Intelligence proposal was rejected.");
    return {
      proposal: parsed,
      pack: materializeProjectIntelligencePack({ extraction: input.extraction, proposal: parsed, packId: input.packId, now }),
      execution: { status: "model", modelExecutionOccurred: true, remoteRunId: model.runId, remoteSessionKey: model.sessionKey, failureCode: null }
    };
  } catch (error) {
    if (options.signal.aborted || error instanceof ProjectIntelligenceRemoteExecutionError) throw error;
    const proposal = createFallbackProjectIntelligenceSynthesisProposal(inputFingerprint, now);
    return {
      proposal,
      pack: materializeProjectIntelligencePack({ extraction: input.extraction, proposal, packId: input.packId, now }),
      execution: {
        status: "fallback",
        modelExecutionOccurred: completedModel !== null,
        remoteRunId: completedModel?.runId ?? null,
        remoteSessionKey: completedModel?.sessionKey ?? null,
        failureCode: safeFailureCode(error)
      }
    };
  }
}

function validateSynthesisClaim(value: unknown, path: string, issues: Array<{ path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference"; message: string }>, evidence?: readonly EvidenceRef[]) {
  if (!isRecord(value)) return issues.push(issue(path, "invalid_type", "Inferred claim must be an object."));
  assertOnlyKeys(value, ["category", "key", "value", "statement", "confidence", "evidenceRefIds"], path, issues);
  if (!PROJECT_FACT_CATEGORIES.includes(value.category as ProjectFactCategory)) issues.push(issue(`${path}.category`, "invalid_value", "Unsupported inferred claim category."));
  if (typeof value.key !== "string" || !value.key.trim()) issues.push(issue(`${path}.key`, "missing_field", "Inferred claim key is required."));
  if (PROTECTED_INFERRED_KEYS.has(String(value.key)) || PROTECTED_INFERRED_KEY_PATTERN.test(String(value.key)) || value.category === "contact" || value.category === "identifier" || value.category === "resource") issues.push(issue(`${path}.key`, "invalid_value", "Identifiers, contacts, and official resource locators must remain canonical extracted data."));
  validateFactValue(value.value, `${path}.value`, issues);
  if (containsPublicLocator(value.value)) issues.push(issue(`${path}.value`, "invalid_value", "Synthesis cannot invent public locators or identifiers."));
  if (typeof value.statement !== "string" || !value.statement.trim() || value.statement.length > MAX_CLAIM_VALUE_LENGTH) issues.push(issue(`${path}.statement`, "invalid_value", "Inferred claim statement is bounded and required."));
  if (!(value.confidence === "low" || value.confidence === "medium" || value.confidence === "high")) issues.push(issue(`${path}.confidence`, "invalid_value", "Unsupported inferred claim confidence."));
  validateStringArray(value.evidenceRefIds, `${path}.evidenceRefIds`, issues, true);
  if (Array.isArray(value.evidenceRefIds) && evidence) for (const [index, id] of value.evidenceRefIds.entries()) if (!evidence.some((entry) => entry.id === id)) issues.push(issue(`${path}.evidenceRefIds[${index}]`, "missing_reference", "Inferred claims must reference known evidence."));
}

function projectIdentity(facts: readonly ProjectFact[]): ProjectIntelligencePack["identity"] {
  return {
    projectName: scalarFromFacts(facts, "projectName", "string"),
    displayName: scalarFromFacts(facts, "displayName", "string"),
    organizationName: scalarFromFacts(facts, "organizationName", "string"),
    description: scalarFromFacts(facts, "description", "string"),
    projectType: scalarFromFacts(facts, "projectType", "projectType")
  };
}

function projectOverview(facts: readonly ProjectFact[]): ProjectIntelligencePack["overview"] {
  return {
    whatItDoes: scalarFromFacts(facts, "whatItDoes", "string", "description"),
    primaryAudience: projectCollection<string>(facts, "primaryAudience", []),
    businessContext: scalarFromFacts(facts, "businessContext", "string"),
    goals: projectCollection<string>(facts, "goals", [])
  };
}

function projectCollections<T extends readonly string[]>(facts: readonly ProjectFact[], keys: T) {
  return Object.fromEntries(keys.map((key) => [key, projectCollection<string>(facts, key, [])])) as unknown as Record<T[number], { value: readonly string[]; factIds: readonly string[] }>;
}

function scalarFromFacts<T>(facts: readonly ProjectFact[], key: string, _kind: "string" | "projectType", fallbackKey?: string) {
  const fact = facts.find((entry) => entry.key === key) ?? (fallbackKey ? facts.find((entry) => entry.key === fallbackKey) : undefined);
  return { value: fact?.value as T | null ?? null, factIds: fact ? [fact.id] : [] };
}

function projectCollection<T = ProjectFactValue>(facts: readonly ProjectFact[], key: string, aliases: readonly string[]) {
  const candidates = facts.filter((fact) => fact.key === key || aliases.includes(fact.key));
  const value: T[] = [];
  const factIds: string[] = [];
  const seen = new Set<string>();
  for (const fact of candidates) {
    const members = Array.isArray(fact.normalizedValue) ? fact.value as readonly ProjectFactValue[] : [fact.value];
    for (const member of members) {
      const identity = stableStringify(normalizeProjectFactValue(member));
      if (seen.has(identity)) continue;
      seen.add(identity);
      value.push(member as T);
    }
    factIds.push(fact.id);
  }
  return { value, factIds };
}

function packState(status: ProjectIntelligenceSynthesisStatus, facts: readonly ProjectFact[], resources: readonly OfficialResource[]): ProjectIntelligencePackState {
  if (status !== "ready") return "partial";
  return facts.length > 0 || resources.length > 0 ? "ready" : "partial";
}

function parseProposal(text: string, inputFingerprint: string): ProjectIntelligenceSynthesisProposal {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Structured synthesis output was not JSON.");
  const value = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  return { ...value, inputFingerprint } as ProjectIntelligenceSynthesisProposal;
}

function safeFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout")) return "intelligence-timeout";
  if (message.includes("structured") || message.includes("json")) return "intelligence-structured-output-rejected";
  return "intelligence-unavailable";
}

function containsPublicLocator(value: unknown): boolean {
  if (typeof value === "string") return /https?:\/\/|0x[a-f0-9]{40}\b|^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value.trim());
  if (Array.isArray(value)) return value.some(containsPublicLocator);
  if (isRecord(value)) return Object.entries(value).some(([key, entry]) => /identifier|address|url|email|repository|network/i.test(key) || containsPublicLocator(entry));
  return false;
}

function validateFactValue(value: unknown, path: string, issues: Array<{ path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference"; message: string }>) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) issues.push(issue(path, "invalid_value", "Claim numbers must be finite.")); return; }
  if (Array.isArray(value)) return value.forEach((entry, index) => validateFactValue(entry, `${path}[${index}]`, issues));
  if (isRecord(value)) return Object.entries(value).forEach(([key, entry]) => { if (/secret|token|password|private|credential|api[-_ ]?key/i.test(key)) issues.push(issue(`${path}.${key}`, "invalid_value", "Secret-shaped claim fields are not allowed.")); validateFactValue(entry, `${path}.${key}`, issues); });
  issues.push(issue(path, "invalid_type", "Claim values must be JSON-compatible."));
}

function validateStringArray(value: unknown, path: string, issues: Array<{ path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference"; message: string }>, requireMember = false) {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS || (requireMember && value.length === 0) || !value.every((entry) => typeof entry === "string" && entry.length <= 400)) issues.push(issue(path, "invalid_type", "Expected a bounded string array."));
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: Array<{ path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference"; message: string }>) {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) issues.push(issue(`${path}.${key}`, "unknown_field", "Unknown normalized synthesis field."));
}

function issue(path: string, code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "missing_reference", message: string) { return { path, code, message }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function unique(values: readonly string[]) { return [...new Set(values)]; }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableStringify(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.trim().toLocaleLowerCase());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}
