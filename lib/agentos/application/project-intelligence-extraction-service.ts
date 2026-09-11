import { createHash } from "node:crypto";

import {
  isEvidenceQualificationEligible,
  normalizeEvidenceRef,
  normalizeOfficialResource,
  normalizeProjectConflict,
  normalizeProjectFact,
  normalizeProjectFactValue,
  isEvidenceClaimScopeCompatible,
  PROJECT_INTELLIGENCE_SCHEMA_VERSION,
  validateEvidenceRef,
  validateOfficialResource,
  validateProjectConflict,
  validateProjectFact,
  type EvidenceRef,
  type OfficialResource,
  type ProjectClaimEvidence,
  type ProjectConflict,
  type ProjectEvidenceOrigin,
  type ProjectEvidenceQualificationCapability,
  type ProjectEvidenceType,
  type ProjectFact,
  type ProjectFactValue,
  type ProjectEvidenceClaimScope,
} from "@/lib/agentos/domains/project-intelligence";
import type { ProjectDiscoveryManifest, ProjectDiscoveryPage } from "@/lib/agentos/domains/project-discovery";
import type { WorkspaceKnowledgeSource, WorkspaceKnowledgeSourceKind } from "@/lib/agentos/domains/workspace-knowledge";
import { redactSecretText } from "@/lib/security/redaction";

export const PROJECT_INTELLIGENCE_EXTRACTION_SCHEMA_VERSION = 1 as const;
export const PROJECT_INTELLIGENCE_EXTRACTION_POLICY_VERSION = 1 as const;

export type ProjectIntelligenceExtractionDocument = {
  documentId?: string;
  sourceId: string;
  sourceKind?: WorkspaceKnowledgeSourceKind;
  title?: string;
  classification?: string;
  canonicalLocator?: string;
  retrievedAt?: string;
  content: string;
};

export type ProjectIntelligenceEvidenceQualificationInput = {
  sourceId: string;
  sourceKind?: WorkspaceKnowledgeSourceKind;
  origin: ProjectEvidenceOrigin;
  evidenceType: ProjectEvidenceType;
  canonicalLocator?: string;
  title: string;
};

export type ProjectIntelligenceExtractionInput = {
  generationId: string | null;
  inputFingerprint: string;
  sourceIds?: readonly string[];
  sources?: readonly WorkspaceKnowledgeSource[];
  documents?: readonly ProjectIntelligenceExtractionDocument[];
  discoveryManifests?: readonly ProjectDiscoveryManifest[];
  now?: string;
  signal?: AbortSignal;
  qualifyEvidence?: (input: ProjectIntelligenceEvidenceQualificationInput) => ProjectEvidenceQualificationCapability | null;
};

export type ProjectIntelligenceExtractionLimits = {
  maxDocuments: number;
  maxDocumentCharacters: number;
  maxEvidence: number;
  maxFacts: number;
  maxResources: number;
  maxConflicts: number;
  maxWarnings: number;
};

export const DEFAULT_PROJECT_INTELLIGENCE_EXTRACTION_LIMITS: ProjectIntelligenceExtractionLimits = {
  maxDocuments: 48,
  maxDocumentCharacters: 6_000,
  maxEvidence: 128,
  maxFacts: 128,
  maxResources: 128,
  maxConflicts: 32,
  maxWarnings: 32
};

export type ProjectIntelligenceExtractionCoverage = {
  sourceCount: number;
  documentCount: number;
  manifestCount: number;
  evidenceCount: number;
  factCount: number;
  resourceCount: number;
  verifiedFactCount: number;
  verifiedResourceCount: number;
  conflictCount: number;
  unknownCount: number;
};

export type ProjectIntelligenceExtraction = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_EXTRACTION_SCHEMA_VERSION;
  policyVersion: typeof PROJECT_INTELLIGENCE_EXTRACTION_POLICY_VERSION;
  extractionId: string;
  generationId: string | null;
  inputFingerprint: string;
  status: "empty" | "partial" | "ready";
  sourceIds: readonly string[];
  evidence: readonly EvidenceRef[];
  facts: readonly ProjectFact[];
  resources: readonly OfficialResource[];
  conflicts: readonly ProjectConflict[];
  unknowns: readonly string[];
  warnings: readonly string[];
  coverage: ProjectIntelligenceExtractionCoverage;
  limits: ProjectIntelligenceExtractionLimits;
  createdAt: string;
};

export type ProjectIntelligenceExtractionSummary = {
  extractionId: string;
  generationId: string | null;
  inputFingerprint: string;
  status: ProjectIntelligenceExtraction["status"];
  evidenceCount: number;
  factCount: number;
  resourceCount: number;
  verifiedFactCount: number;
  verifiedResourceCount: number;
  conflictCount: number;
  warningCount: number;
  unknownCount: number;
};

export function createProjectIntelligenceExtractionInputFingerprint(input: {
  generationId: string | null;
  baseInputFingerprint?: string;
  sourceIds: readonly string[];
  documents: readonly ProjectIntelligenceExtractionDocument[];
  discoveryManifests: readonly ProjectDiscoveryManifest[];
}) {
  return sha256(stableStringify({
    schemaVersion: PROJECT_INTELLIGENCE_EXTRACTION_SCHEMA_VERSION,
    policyVersion: PROJECT_INTELLIGENCE_EXTRACTION_POLICY_VERSION,
    generationId: input.generationId,
    baseInputFingerprint: input.baseInputFingerprint ?? null,
    sourceIds: [...input.sourceIds].sort(),
    documents: input.documents.map((document) => ({
      documentId: document.documentId ?? null,
      sourceId: document.sourceId,
      sourceKind: document.sourceKind ?? null,
      title: document.title ?? null,
      classification: document.classification ?? null,
      canonicalLocator: document.canonicalLocator ?? null,
      retrievedAt: document.retrievedAt ?? null,
      contentHash: sha256(document.content)
    })),
    discoveryManifests: input.discoveryManifests.map((manifest) => sha256(stableStringify(manifest)))
  }));
}

type FactDraft = {
  category: ProjectFact["category"];
  key: string;
  value: ProjectFactValue;
  statement: string;
  evidenceIds: string[];
  sourceIds: string[];
  origin: ProjectEvidenceOrigin;
};

type ResourceDraft = {
  category: OfficialResource["category"];
  locator: OfficialResource["locator"];
  label: string;
  evidenceIds: string[];
  origin: ProjectEvidenceOrigin;
  sourceId?: string;
  baseVerification: "declared" | "discovered";
};

export function extractProjectIntelligence(input: ProjectIntelligenceExtractionInput): ProjectIntelligenceExtraction {
  const limits = DEFAULT_PROJECT_INTELLIGENCE_EXTRACTION_LIMITS;
  const now = input.now ?? new Date().toISOString();
  const sourceIds = unique([
    ...(input.sourceIds ?? []),
    ...(input.sources ?? []).map((source) => source.id),
    ...(input.documents ?? []).map((document) => document.sourceId),
    ...(input.discoveryManifests ?? []).map((manifest) => manifest.sourceId)
  ]).slice(0, 64);
  const sources = new Map((input.sources ?? []).map((source) => [source.id, source]));
  const evidence: EvidenceRef[] = [];
  const evidenceByIdentity = new Map<string, EvidenceRef>();
  const evidenceByLocator = new Map<string, EvidenceRef>();
  const factDrafts = new Map<string, FactDraft>();
  const resourceDrafts = new Map<string, ResourceDraft>();
  const warnings: string[] = [];
  let partial = false;

  function addWarning(value: string) {
    const warning = redactSecretText(value).replace(/https?:\/\/\S+/gi, "[url]").slice(0, 300);
    if (warning && !warnings.includes(warning) && warnings.length < limits.maxWarnings) warnings.push(warning);
  }

  const documents = (input.documents ?? []).slice(0, limits.maxDocuments);
  if ((input.documents ?? []).length > documents.length) addWarning("Extraction document limit stopped additional documents.");

  for (const document of documents) {
    if (input.signal?.aborted) {
      partial = true;
      addWarning("Extraction was cancelled after a bounded partial result.");
      break;
    }
    const content = safeContent(document.content, limits.maxDocumentCharacters);
    if (!content) continue;
    const source = sources.get(document.sourceId);
    const evidenceType = evidenceTypeForDocument(document, source);
    const origin = evidenceOriginForDocument(document, source);
    addEvidence({
      sourceId: document.sourceId,
      documentId: document.documentId,
      canonicalLocator: document.canonicalLocator,
      title: document.title ?? document.canonicalLocator ?? `${document.sourceId} document`,
      excerpt: excerptFor(content),
      summary: `${document.classification ?? "Project"} material was read from the staged project corpus.`,
      retrievedAt: document.retrievedAt,
      evidenceType,
      origin
    });
  }

  const pageEvidence = new Map<string, EvidenceRef>();
  for (const manifest of input.discoveryManifests ?? []) {
    for (const page of manifest.pages.slice(0, limits.maxDocuments)) {
      if (input.signal?.aborted) {
        partial = true;
        addWarning("Extraction was cancelled after a bounded partial result.");
        break;
      }
      if (page.fetchStatus === "failed" || page.fetchStatus === "blocked") continue;
      const existing = evidenceByLocator.get(`${manifest.sourceId}|${page.locator}`);
      const pageRef = existing ?? addEvidence({
        sourceId: manifest.sourceId,
        canonicalLocator: page.locator,
        title: page.title ?? page.locator,
        excerpt: page.metadata.description ?? page.metadata.openGraphDescription ?? undefined,
        summary: `A bounded discovery page observation was collected from ${page.locator}.`,
        evidenceType: evidenceTypeForPage(page),
        origin: evidenceOriginForPage(page)
      });
      if (pageRef) pageEvidence.set(`${manifest.sourceId}|${page.locator}`, pageRef);
    }
  }

  const rootPages = [...(input.discoveryManifests ?? []).flatMap((manifest) => manifest.pages.map((page) => ({ manifest, page })))]
    .filter(({ page }) => page.firstParty === "root" && page.fetchStatus === "fetched")
    .sort((left, right) => `${left.manifest.sourceId}|${left.page.depth}|${left.page.locator}`.localeCompare(`${right.manifest.sourceId}|${right.page.depth}|${right.page.locator}`));
  const primaryPage = rootPages[0];
  if (primaryPage) {
    const ref = pageEvidence.get(`${primaryPage.manifest.sourceId}|${primaryPage.page.locator}`);
    const name = primaryPage.page.metadata.jsonLdNames?.[0] ?? primaryPage.page.title;
    if (ref && name && !isInstructionalText(name)) addFact("identity", "projectName", name, `The project is named ${name}.`, [ref], primaryPage.manifest.sourceId, ref.provenance.origin);
    const description = primaryPage.page.metadata.description ?? primaryPage.page.metadata.openGraphDescription;
    if (ref && description && !isInstructionalText(description)) addFact("overview", "description", description, `The project describes itself as ${description}.`, [ref], primaryPage.manifest.sourceId, ref.provenance.origin);
  }

  for (const document of documents) {
    if (input.signal?.aborted) { partial = true; break; }
    const content = safeContent(document.content, limits.maxDocumentCharacters);
    if (!content || isInstructionalText(content)) continue;
    const ref = evidenceByLocator.get(`${document.sourceId}|${document.canonicalLocator ?? document.documentId ?? ""}`)
      ?? evidence.find((entry) => entry.sourceId === document.sourceId);
    if (!ref) continue;
    const sourceOrigin = ref.provenance.origin;
    const projectType = explicitProjectType(content);
    if (projectType) addFact("identity", "projectType", projectType, `The project explicitly identifies its type as ${projectType}.`, [ref], document.sourceId, sourceOrigin);

    for (const network of explicitNetworks(content)) {
      addFact("technical", "networks", network, `The project explicitly references the ${network} network.`, [ref], document.sourceId, sourceOrigin);
      addFact("identifier", "networkIdentifier", { kind: "network", value: network, label: "Explicit network" }, `The project publishes ${network} as a network identifier.`, [ref], document.sourceId, sourceOrigin);
    }
    for (const address of explicitContractAddresses(content)) {
      const network = networkNear(content, address.index);
      const label = network ? `Contract address on ${network}` : "Contract address";
      addFact("identifier", `contractAddress:${(network ?? "unknown").toLowerCase()}`, { kind: "contract-address", value: address.value, ...(network ? { label } : { label: "Contract address" }) }, `The project publishes a public ${label.toLowerCase()}.`, [ref], document.sourceId, sourceOrigin);
    }
    for (const feature of headingListMembers(content)) addFact("product", "features", feature, `The project lists ${feature} as a feature.`, [ref], document.sourceId, sourceOrigin);
    for (const category of sourcePageJsonLdCategories(document, input.discoveryManifests ?? [])) addFact("product", "applicationCategory", category, `Structured project metadata categorizes the application as ${category}.`, [ref], document.sourceId, sourceOrigin);
  }

  for (const manifest of input.discoveryManifests ?? []) {
    const source = sources.get(manifest.sourceId);
    const root = manifest.pages.find((page) => page.firstParty === "root" && page.depth === 0 && page.fetchStatus === "fetched") ?? manifest.pages.find((page) => page.firstParty === "root" && page.fetchStatus === "fetched");
    if (root) {
      const ref = pageEvidence.get(`${manifest.sourceId}|${root.locator}`);
      if (ref && root.metadata.jsonLdApplicationCategories) for (const category of root.metadata.jsonLdApplicationCategories) addFact("product", "applicationCategory", category, `Structured project metadata categorizes the application as ${category}.`, [ref], manifest.sourceId, ref.provenance.origin);
      if (ref && root.metadata.jsonLdOperatingSystems) for (const operatingSystem of root.metadata.jsonLdOperatingSystems) addFact("technical", "operatingSystem", operatingSystem, `Structured project metadata identifies ${operatingSystem} as a supported operating system.`, [ref], manifest.sourceId, ref.provenance.origin);
      if (ref && root.metadata.jsonLdLegalNames?.[0] && !isInstructionalText(root.metadata.jsonLdLegalNames[0])) addFact("identity", "organizationName", root.metadata.jsonLdLegalNames[0], `Structured project metadata identifies ${root.metadata.jsonLdLegalNames[0]} as the organization.`, [ref], manifest.sourceId, ref.provenance.origin);
      if (ref && source?.kind === "website") addResource("website", { kind: "url", value: manifest.rootUrl }, source.label, [ref], ref.provenance.origin, manifest.sourceId);
    }
    for (const candidate of manifest.candidates) {
      if (candidate.kind === "sitemap" || candidate.kind === "contact" || candidate.locator === "[invalid-url]") continue;
      const ref = pageEvidence.get(`${manifest.sourceId}|${candidate.discoveredFrom}`);
      const category = categoryForCandidate(candidate.relation, candidate.kind, candidate.locator);
      if (!category) continue;
      const resource = addResource(category, { kind: "url", value: candidate.locator }, candidate.label ?? category, ref ? [ref] : [], ref?.provenance.origin ?? (candidate.firstParty ? "first-party-website" : "discovered-external"), manifest.sourceId);
      if (resource && (candidate.relation === "repository" || candidate.relation === "developer" || candidate.relation === "documentation")) addFact("technical", candidate.relation === "repository" ? "repositories" : candidate.relation === "documentation" ? "documentation" : "apis", candidate.locator, `The project references ${candidate.locator} as a ${candidate.relation} resource.`, ref ? [ref] : [], manifest.sourceId, ref?.provenance.origin ?? "discovered-external");
    }
    for (const contact of manifest.contacts) {
      const ref = pageEvidence.get(`${manifest.sourceId}|${contact.discoveredFrom}`);
      const category = contact.kind === "email" ? "email" : contact.kind === "support-url" ? "support" : "contact";
      const locator = contact.kind === "email" ? { kind: "email" as const, value: contact.value } : contact.kind === "phone" ? { kind: "phone" as const, value: contact.value } : { kind: "url" as const, value: contact.value };
      addResource(category, locator, contact.label ?? category, ref ? [ref] : [], ref?.provenance.origin ?? "discovered-external", manifest.sourceId);
      if (contact.kind !== "support-url") addFact("contact", "contacts", { kind: contact.kind === "email" ? "email" : "phone", value: contact.value, ...(contact.label ? { label: contact.label } : {}) }, `The project publishes ${contact.value} as a public contact.`, ref ? [ref] : [], manifest.sourceId, ref?.provenance.origin ?? "discovered-external");
    }
  }

  for (const source of input.sources ?? []) {
    if (source.kind === "repository" && source.locator.kind === "repository" && source.locator.remoteUrl) {
      const ref = evidence.find((entry) => entry.sourceId === source.id);
      addResource("repository", { kind: "url", value: source.locator.remoteUrl }, source.label, ref ? [ref] : [], ref?.provenance.origin ?? "operator", source.id);
    }
  }

  const facts = [...factDrafts.values()].slice(0, limits.maxFacts).map((draft) => makeFact(draft, evidence, input.generationId, now));
  if (factDrafts.size > facts.length) addWarning("Extraction fact limit stopped additional claims.");
  const resources = [...resourceDrafts.values()].slice(0, limits.maxResources).map((draft) => makeResource(draft, evidence));
  if (resourceDrafts.size > resources.length) addWarning("Extraction resource limit stopped additional candidates.");
  const conflicts = detectConflicts(facts, resources, evidence, now, limits.maxConflicts);
  if (conflicts.length >= limits.maxConflicts) addWarning("Extraction conflict limit stopped additional conflict records.");
  const unknowns = buildUnknowns(facts, resources, evidence);
  const status: ProjectIntelligenceExtraction["status"] = evidence.length === 0 && facts.length === 0 && resources.length === 0 ? "empty" : partial || warnings.length > 0 ? "partial" : "ready";
  const artifact: ProjectIntelligenceExtraction = {
    schemaVersion: PROJECT_INTELLIGENCE_EXTRACTION_SCHEMA_VERSION,
    policyVersion: PROJECT_INTELLIGENCE_EXTRACTION_POLICY_VERSION,
    extractionId: `intelligence-extraction-${sha256(`${input.inputFingerprint}|${input.generationId ?? "none"}`).slice(0, 32)}`,
    generationId: input.generationId,
    inputFingerprint: input.inputFingerprint,
    status,
    sourceIds,
    evidence,
    facts,
    resources,
    conflicts,
    unknowns,
    warnings: warnings.slice(0, limits.maxWarnings),
    coverage: {
      sourceCount: sourceIds.length,
      documentCount: documents.length,
      manifestCount: (input.discoveryManifests ?? []).length,
      evidenceCount: evidence.length,
      factCount: facts.length,
      resourceCount: resources.length,
      verifiedFactCount: facts.filter((fact) => fact.verification === "verified").length,
      verifiedResourceCount: resources.filter((resource) => resource.verification === "verified").length,
      conflictCount: conflicts.length,
      unknownCount: unknowns.length
    },
    limits,
    createdAt: now
  };
  const validation = validateProjectIntelligenceExtraction(artifact);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "));
  return artifact;

  function addEvidence(inputValue: {
    sourceId: string;
    documentId?: string;
    canonicalLocator?: string;
    title: string;
    excerpt?: string;
    summary: string;
    retrievedAt?: string;
    evidenceType: ProjectEvidenceType;
    origin: ProjectEvidenceOrigin;
  }) {
    const identity = `${inputValue.sourceId}|${inputValue.canonicalLocator ?? inputValue.documentId ?? inputValue.title}`;
    const existing = evidenceByIdentity.get(identity);
    if (existing) return existing;
    if (evidence.length >= limits.maxEvidence) {
      partial = true;
      addWarning("Extraction evidence limit stopped additional observations.");
      return undefined;
    }
    const qualification = qualificationFor(inputValue);
    const raw: EvidenceRef = {
      schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
      id: `evidence-${sha256(`${identity}|${safeExcerpt(inputValue.excerpt ?? inputValue.summary, 800)}`).slice(0, 32)}`,
      sourceId: inputValue.sourceId,
      ...(inputValue.documentId ? { documentId: inputValue.documentId } : {}),
      ...(inputValue.canonicalLocator ? { canonicalLocator: inputValue.canonicalLocator } : {}),
      title: inputValue.title,
      ...(inputValue.excerpt ? { excerpt: inputValue.excerpt } : {}),
      summary: inputValue.summary,
      ...(inputValue.retrievedAt ? { retrievedAt: inputValue.retrievedAt } : {}),
      evidenceType: inputValue.evidenceType,
      provenance: { origin: inputValue.origin, declaredBy: "discovery" },
      qualification,
      confidence: qualification.status === "qualified" ? "high" : "low"
    };
    const normalized = normalizeEvidenceRef(raw);
    evidence.push(normalized);
    evidenceByIdentity.set(identity, normalized);
    if (inputValue.canonicalLocator) evidenceByLocator.set(`${inputValue.sourceId}|${inputValue.canonicalLocator}`, normalized);
    return normalized;
  }

  function claimScopedEvidence(base: EvidenceRef, key: string, value: ProjectFactValue) {
    const normalizedValue = normalizeProjectFactValue(value);
    if (isEvidenceClaimScopeCompatible(base, key, normalizedValue)) return base;
    const scope: ProjectEvidenceClaimScope = { key, normalizedValue };
    const identity = `${base.id}|claim|${scope.key}|${stableStringify(scope.normalizedValue)}`;
    const existing = evidenceByIdentity.get(identity);
    if (existing) return existing;
    if (evidence.length >= limits.maxEvidence) {
      partial = true;
      addWarning("Extraction evidence limit stopped additional observations.");
      return base;
    }
    const normalized = normalizeEvidenceRef({
      ...base,
      id: `evidence-${sha256(identity).slice(0, 32)}`,
      claimScopes: [...(base.claimScopes ?? []), scope]
    });
    evidence.push(normalized);
    evidenceByIdentity.set(identity, normalized);
    if (normalized.canonicalLocator) evidenceByLocator.set(`${normalized.sourceId}|${normalized.canonicalLocator}|${identity}`, normalized);
    return normalized;
  }

  function addFact(category: ProjectFact["category"], key: string, value: ProjectFactValue, statement: string, refs: readonly EvidenceRef[], sourceId: string, origin: ProjectEvidenceOrigin) {
    if (factDrafts.size >= limits.maxFacts && !factDrafts.has(`${key}|${stableStringify(value)}`)) { partial = true; addWarning("Extraction fact limit stopped additional claims."); return; }
    if (refs.length === 0) return;
    const scopedRefs = refs.map((ref) => claimScopedEvidence(ref, key, value));
    const identity = `${key}|${stableStringify(normalizeProjectFactValue(value))}`;
    const existing = factDrafts.get(identity);
    if (existing) {
      mergeIds(existing.evidenceIds, scopedRefs.map((ref) => ref.id));
      mergeIds(existing.sourceIds, [sourceId]);
      return;
    }
    factDrafts.set(identity, { category, key, value, statement, evidenceIds: scopedRefs.map((ref) => ref.id), sourceIds: [sourceId], origin });
  }

  function addResource(category: OfficialResource["category"], locator: OfficialResource["locator"], label: string, refs: readonly EvidenceRef[], origin: ProjectEvidenceOrigin, sourceId?: string) {
    if (resourceDrafts.size >= limits.maxResources && !resourceDrafts.has(`${category}|${locator.kind}|${locator.value}`)) { partial = true; addWarning("Extraction resource limit stopped additional candidates."); return undefined; }
    const identity = `${category}|${locator.kind}|${locator.value.toLowerCase()}`;
    const scopedRefs = refs.map((ref) => claimScopedEvidence(ref, `resource:${category}`, locator));
    const existing = resourceDrafts.get(identity);
    if (existing) {
      mergeIds(existing.evidenceIds, scopedRefs.map((ref) => ref.id));
      return existing;
    }
    resourceDrafts.set(identity, { category, locator, label: safeExcerpt(label, 240), evidenceIds: scopedRefs.map((ref) => ref.id), origin, baseVerification: origin === "operator" ? "declared" : "discovered", ...(sourceId ? { sourceId } : {}) });
    return resourceDrafts.get(identity);
  }

  function qualificationFor(value: Parameters<typeof addEvidence>[0]) {
    const capability = input.qualifyEvidence?.({ sourceId: value.sourceId, sourceKind: sources.get(value.sourceId)?.kind, origin: value.origin, evidenceType: value.evidenceType, canonicalLocator: value.canonicalLocator, title: value.title })
      ?? defaultCapability(value.origin);
    if (capability && capabilityMatches(capability, value.origin, value.evidenceType)) return { status: "qualified" as const, capability, qualifiedAt: now };
    return { status: "unqualified" as const, reason: unqualifiedReason(value.origin) };
  }
}

export function summarizeProjectIntelligenceExtraction(value: ProjectIntelligenceExtraction): ProjectIntelligenceExtractionSummary {
  return {
    extractionId: value.extractionId,
    generationId: value.generationId,
    inputFingerprint: value.inputFingerprint,
    status: value.status,
    evidenceCount: value.coverage.evidenceCount,
    factCount: value.coverage.factCount,
    resourceCount: value.coverage.resourceCount,
    verifiedFactCount: value.coverage.verifiedFactCount,
    verifiedResourceCount: value.coverage.verifiedResourceCount,
    conflictCount: value.coverage.conflictCount,
    warningCount: value.warnings.length,
    unknownCount: value.unknowns.length
  };
}

export type ProjectIntelligenceExtractionValidationIssue = { path: string; code: "invalid_type" | "missing_field" | "unknown_field" | "invalid_value" | "unsupported_verification" | "missing_reference" | "duplicate_id"; message: string };
export type ProjectIntelligenceExtractionValidation = { valid: boolean; issues: ProjectIntelligenceExtractionValidationIssue[] };

export function validateProjectIntelligenceExtraction(value: unknown): ProjectIntelligenceExtractionValidation {
  const issues: ProjectIntelligenceExtractionValidationIssue[] = [];
  if (!isRecord(value)) return { valid: false, issues: [{ path: "extraction", code: "invalid_type", message: "Extraction must be an object." }] };
  assertOnlyKeys(value, ["schemaVersion", "policyVersion", "extractionId", "generationId", "inputFingerprint", "status", "sourceIds", "evidence", "facts", "resources", "conflicts", "unknowns", "warnings", "coverage", "limits", "createdAt"], "extraction", issues);
  if (value.schemaVersion !== PROJECT_INTELLIGENCE_EXTRACTION_SCHEMA_VERSION) addIssue("extraction.schemaVersion", "invalid_value", "Unsupported extraction schema version.");
  if (value.policyVersion !== PROJECT_INTELLIGENCE_EXTRACTION_POLICY_VERSION) addIssue("extraction.policyVersion", "invalid_value", "Unsupported extraction policy version.");
  for (const key of ["extractionId", "inputFingerprint", "createdAt"]) if (typeof value[key] !== "string" || !value[key]) addIssue(`extraction.${key}`, "missing_field", "A bounded extraction identifier or timestamp is required.");
  if (value.generationId !== null && typeof value.generationId !== "string") addIssue("extraction.generationId", "invalid_type", "Generation ID must be a string or null.");
  if (!["empty", "partial", "ready"].includes(value.status as string)) addIssue("extraction.status", "invalid_value", "Unsupported extraction status.");
  for (const key of ["sourceIds", "unknowns", "warnings"]) if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every((entry) => typeof entry === "string")) addIssue(`extraction.${key}`, "invalid_type", "Expected a bounded string array.");
  const evidence = Array.isArray(value.evidence) ? value.evidence as EvidenceRef[] : [];
  const facts = Array.isArray(value.facts) ? value.facts as ProjectFact[] : [];
  const resources = Array.isArray(value.resources) ? value.resources as OfficialResource[] : [];
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts as ProjectConflict[] : [];
  const evidenceIds = new Set<string>();
  evidence.forEach((entry, index) => {
    const result = validateEvidenceRef(entry);
    if (!result.valid) issues.push(...result.issues.map((issue) => extractionIssue(`extraction.evidence[${index}].${issue.path}`, issue.code, issue.message)));
    if (evidenceIds.has(entry.id)) addIssue(`extraction.evidence[${index}].id`, "duplicate_id", "Evidence IDs must be unique.");
    evidenceIds.add(entry.id);
  });
  const factIds = new Set<string>();
  facts.forEach((entry, index) => {
    const result = validateProjectFact(entry, facts, evidence);
    if (!result.valid) issues.push(...result.issues.map((issue) => extractionIssue(`extraction.facts[${index}].${issue.path}`, issue.code, issue.message)));
    if (factIds.has(entry.id)) addIssue(`extraction.facts[${index}].id`, "duplicate_id", "Fact IDs must be unique.");
    factIds.add(entry.id);
  });
  const resourceIds = new Set<string>();
  resources.forEach((entry, index) => {
    const result = validateOfficialResource(entry, evidence);
    if (!result.valid) issues.push(...result.issues.map((issue) => extractionIssue(`extraction.resources[${index}].${issue.path}`, issue.code, issue.message)));
    if (resourceIds.has(entry.id)) addIssue(`extraction.resources[${index}].id`, "duplicate_id", "Resource IDs must be unique.");
    resourceIds.add(entry.id);
  });
  conflicts.forEach((entry, index) => {
    const result = validateProjectConflict(entry, facts, resources, evidence);
    if (!result.valid) issues.push(...result.issues.map((issue) => extractionIssue(`extraction.conflicts[${index}].${issue.path}`, issue.code, issue.message)));
  });
  validateCoverage(value.coverage, "extraction.coverage", issues);
  validateLimits(value.limits, "extraction.limits", issues);
  validateExtractionConsistency(value, evidence, facts, resources, conflicts, issues);
  return { valid: issues.length === 0, issues };

  function addIssue(path: string, code: ProjectIntelligenceExtractionValidationIssue["code"], message: string) { issues.push({ path, code, message }); }
}

function makeFact(draft: FactDraft, evidence: readonly EvidenceRef[], generationId: string | null, now: string): ProjectFact {
  const references: ProjectClaimEvidence[] = draft.evidenceIds.map((evidenceRefId) => ({ evidenceRefId, relation: "supports" }));
  const qualified = references.some((reference) => isEvidenceQualificationEligible(evidence.find((entry) => entry.id === reference.evidenceRefId)));
  return normalizeProjectFact({
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: `fact-${sha256(`${draft.key}|${stableStringify(draft.value)}`).slice(0, 32)}`,
    category: draft.category,
    key: draft.key,
    value: draft.value,
    normalizedValue: normalizeProjectFactValue(draft.value),
    statement: draft.statement,
    confidence: qualified ? "high" : "low",
    verification: qualified ? "verified" : "discovered",
    evidence: references,
    sourceIds: draft.sourceIds,
    provenance: { origin: draft.origin, declaredBy: "discovery" },
    ...(generationId ? { observedAt: now, retrievedAt: now } : {})
  });
}

function makeResource(draft: ResourceDraft, evidence: readonly EvidenceRef[]): OfficialResource {
  const references: ProjectClaimEvidence[] = draft.evidenceIds.map((evidenceRefId) => ({ evidenceRefId, relation: "supports" }));
  const qualified = references.some((reference) => isEvidenceQualificationEligible(evidence.find((entry) => entry.id === reference.evidenceRefId)));
  return normalizeOfficialResource({
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: `resource-${sha256(`${draft.category}|${draft.locator.kind}|${draft.locator.value.toLowerCase()}`).slice(0, 32)}`,
    category: draft.category,
    locator: draft.locator,
    label: draft.label,
    evidence: references,
    confidence: qualified ? "high" : "low",
    verification: qualified ? "verified" : references.length > 0 ? "discovered" : draft.baseVerification,
    origin: { discoveredBy: "discovery", origin: draft.origin, ...(draft.sourceId ? { sourceId: draft.sourceId } : {}), ...(references[0] ? { evidenceRefId: references[0].evidenceRefId } : {}) }
  });
}

function extractionIssue(path: string, code: string, message: string): ProjectIntelligenceExtractionValidationIssue {
  const allowed: ProjectIntelligenceExtractionValidationIssue["code"][] = ["invalid_type", "missing_field", "unknown_field", "invalid_value", "unsupported_verification", "missing_reference", "duplicate_id"];
  return { path, code: allowed.includes(code as ProjectIntelligenceExtractionValidationIssue["code"]) ? code as ProjectIntelligenceExtractionValidationIssue["code"] : "invalid_value", message };
}

function detectConflicts(facts: readonly ProjectFact[], _resources: readonly OfficialResource[], _evidence: readonly EvidenceRef[], now: string, limit: number) {
  const scopes = new Map<string, ProjectFact[]>();
  for (const fact of facts) {
    const scope = conflictScope(fact);
    if (!scope) continue;
    const list = scopes.get(scope) ?? [];
    list.push(fact);
    scopes.set(scope, list);
  }
  const conflicts: ProjectConflict[] = [];
  for (const [scope, entries] of scopes) {
    const distinct = unique(entries.map((entry) => stableStringify(entry.normalizedValue)));
    if (distinct.length < 2) continue;
    const subjects = entries.map((entry) => ({ kind: "fact" as const, id: entry.id }));
    const evidenceRefIds = unique(entries.flatMap((entry) => entry.evidence.map((reference) => reference.evidenceRefId)));
    conflicts.push(normalizeProjectConflict({
      schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
      id: `conflict-${sha256(scope).slice(0, 32)}`,
      subjects,
      evidenceRefIds,
      summary: `Conflicting canonical claims were found for ${scope}.`,
      confidence: "medium",
      status: "open",
      detectedAt: now
    }));
    if (conflicts.length >= limit) break;
  }
  return conflicts;
}

function conflictScope(fact: ProjectFact) {
  if (["projectName", "projectType", "organizationName", "website", "applicationCategory"].includes(fact.key)) return fact.key;
  if (fact.key.startsWith("contractAddress:")) return fact.key;
  return null;
}

function buildUnknowns(facts: readonly ProjectFact[], resources: readonly OfficialResource[], evidence: readonly EvidenceRef[]) {
  const unknowns: string[] = [];
  if (!facts.some((fact) => fact.key === "projectName")) unknowns.push("project-identity");
  if (!resources.some((resource) => resource.category === "website" || resource.category === "application")) unknowns.push("official-resources");
  if (!evidence.some((entry) => entry.qualification.status === "qualified")) unknowns.push("qualified-evidence");
  return unknowns;
}

function evidenceOriginForDocument(document: ProjectIntelligenceExtractionDocument, source?: WorkspaceKnowledgeSource): ProjectEvidenceOrigin {
  if (document.sourceKind === "repository" || source?.kind === "repository") return "first-party-repository";
  if (document.sourceKind === "website" || source?.kind === "website") return /docs?|documentation|developer|api/i.test(`${document.classification ?? ""} ${document.canonicalLocator ?? ""}`) ? "first-party-documentation" : "first-party-website";
  if (document.sourceKind === "file" || source?.kind === "file") return "uploaded-file";
  if (document.sourceKind === "folder" || source?.kind === "folder") return "uploaded-folder";
  if (document.sourceKind === "connector" || source?.kind === "connector") return "connected-source";
  return "operator";
}

function evidenceTypeForDocument(document: ProjectIntelligenceExtractionDocument, source?: WorkspaceKnowledgeSource): ProjectEvidenceType {
  if (source?.kind === "repository" || document.sourceKind === "repository") return "repository";
  if (source?.kind === "file" || source?.kind === "folder" || document.sourceKind === "file" || document.sourceKind === "folder") return "uploaded-document";
  if (source?.kind === "connector" || document.sourceKind === "connector") return "connected-record";
  return /docs?|documentation|developer|api/i.test(`${document.classification ?? ""} ${document.canonicalLocator ?? ""}`) ? "documentation" : "website";
}

function evidenceOriginForPage(page: ProjectDiscoveryPage): ProjectEvidenceOrigin {
  if (page.firstParty === "root" || page.firstParty === "subdomain") return /docs?|documentation|developer|api/i.test(`${page.locator} ${page.title ?? ""}`) ? "first-party-documentation" : "first-party-website";
  return "discovered-external";
}

function evidenceTypeForPage(page: ProjectDiscoveryPage): ProjectEvidenceType {
  if (/docs?|documentation|developer|api/i.test(`${page.locator} ${page.title ?? ""}`)) return "documentation";
  return "website";
}

function defaultCapability(origin: ProjectEvidenceOrigin): ProjectEvidenceQualificationCapability | null {
  return ["first-party-website", "first-party-documentation", "first-party-repository"].includes(origin) ? "authoritative-first-party" : null;
}

function capabilityMatches(capability: ProjectEvidenceQualificationCapability, origin: ProjectEvidenceOrigin, evidenceType: ProjectEvidenceType) {
  if (evidenceType === "operator-declaration" || origin === "operator" || origin === "unknown-external" || origin === "discovered-external") return false;
  if (capability === "authoritative-first-party") return ["first-party-website", "first-party-documentation", "first-party-repository"].includes(origin);
  if (capability === "authoritative-official-upload") return origin === "uploaded-file" || origin === "uploaded-folder";
  return capability === "authoritative-connected-source" && origin === "connected-source";
}

function unqualifiedReason(origin: ProjectEvidenceOrigin): "operator-only" | "unknown-external" | "discovered-external" | "insufficient" | "unsupported" {
  if (origin === "operator") return "operator-only";
  if (origin === "unknown-external") return "unknown-external";
  if (origin === "discovered-external") return "discovered-external";
  return "insufficient";
}

function categoryForCandidate(relation: string, kind: string, locator: string): OfficialResource["category"] | null {
  if (relation === "repository") return "repository";
  if (relation === "social") return "social";
  if (relation === "documentation") return "documentation";
  if (relation === "developer") return "developer";
  if (relation === "application") return "application";
  if (relation === "support") return "support";
  if (relation === "document") return /whitepaper|\.pdf/i.test(locator) ? "whitepaper" : "document";
  if (relation === "contact") return "contact";
  if (kind === "external-resource") return /etherscan|polygonscan|arbiscan|snowtrace/i.test(locator) ? "explorer" : "other";
  if (kind === "page" || kind === "subdomain") return "website";
  return null;
}

function explicitProjectType(content: string): ProjectFactValue | null {
  const match = content.match(/\b(?:project|product|application)\s+type\s*[:\-]\s*(saas|website|mobile-app|backend-api|web3|company|research|content-media|open-source|internal-business|other)\b/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function explicitNetworks(content: string) {
  const result: string[] = [];
  const labeled = /\b(?:network|networks|chain)\s*[:\-]\s*([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*){0,3})/gi;
  const deployed = /\b(?:supported network|deployed on)\s+([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*){0,3})/gi;
  for (const match of [...content.matchAll(labeled), ...content.matchAll(deployed)]) {
    const value = match[1].trim();
    if (value && value.length <= 40) result.push(value);
  }
  return unique(result).slice(0, 16);
}

function explicitContractAddresses(content: string) {
  const result: Array<{ value: string; index: number }> = [];
  for (const match of content.matchAll(/0x[a-fA-F0-9]{40}/g)) {
    const index = match.index ?? 0;
    const window = content.slice(Math.max(0, index - 180), Math.min(content.length, index + match[0].length + 120));
    if (/(?:contract(?: address)?|token address|smart contract|token contract)/i.test(window)) result.push({ value: match[0], index });
  }
  return result.slice(0, 32);
}

function networkNear(content: string, index: number) {
  const window = content.slice(Math.max(0, index - 240), Math.min(content.length, index + 240));
  return explicitNetworks(window)[0] ?? null;
}

function headingListMembers(content: string) {
  const values: string[] = [];
  const heading = /(?:^|\n)#{1,3}\s*(features?|products?|services?|platforms?)\s*\n([\s\S]{0,1200})/gi;
  for (const match of content.matchAll(heading)) {
    for (const item of (match[2] ?? "").matchAll(/(?:^|\n)\s*[-*]\s+([^\n]{2,160})/g)) {
      const value = safeExcerpt(item[1], 160);
      if (value && !isInstructionalText(value)) values.push(value);
      if (values.length >= 32) return unique(values);
    }
  }
  return unique(values);
}

function sourcePageJsonLdCategories(document: ProjectIntelligenceExtractionDocument, manifests: readonly ProjectDiscoveryManifest[]) {
  const page = manifests.flatMap((manifest) => manifest.pages).find((value) => value.locator === document.canonicalLocator);
  return [...(page?.metadata.jsonLdApplicationCategories ?? [])];
}

function safeContent(value: string, maxLength: number) {
  return redactSecretText(value).slice(0, maxLength).trim();
}

function excerptFor(content: string) { return safeExcerpt(content.replace(/\s+/g, " "), 800); }
function safeExcerpt(value: string, maxLength: number) { return redactSecretText(value).replace(/\s+/g, " ").trim().slice(0, maxLength); }
function isInstructionalText(value: string) { return /ignore (?:all|any|the|previous)|system message|developer message|reveal (?:the|your)|prompt injection/i.test(value); }
function unique(values: readonly string[]) { return [...new Set(values)]; }
function mergeIds(target: string[], values: readonly string[]) { for (const value of values) if (!target.includes(value)) target.push(value); }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableStringify(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.trim().toLocaleLowerCase());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ProjectIntelligenceExtractionValidationIssue[]) { const set = new Set(allowed); for (const key of Object.keys(value)) if (!set.has(key)) issues.push({ path: `${path}.${key}`, code: "unknown_field", message: "Unknown normalized extraction field." }); }
function validateCoverage(value: unknown, path: string, issues: ProjectIntelligenceExtractionValidationIssue[]) { if (!isRecord(value)) return issues.push({ path, code: "invalid_type", message: "Coverage must be an object." }); const keys = ["sourceCount", "documentCount", "manifestCount", "evidenceCount", "factCount", "resourceCount", "verifiedFactCount", "verifiedResourceCount", "conflictCount", "unknownCount"]; assertOnlyKeys(value, keys, path, issues); for (const key of keys) if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) issues.push({ path: `${path}.${key}`, code: "invalid_value", message: "Coverage counts must be non-negative integers." }); }
function validateLimits(value: unknown, path: string, issues: ProjectIntelligenceExtractionValidationIssue[]) { if (!isRecord(value)) return issues.push({ path, code: "invalid_type", message: "Limits must be an object." }); const keys = ["maxDocuments", "maxDocumentCharacters", "maxEvidence", "maxFacts", "maxResources", "maxConflicts", "maxWarnings"]; assertOnlyKeys(value, keys, path, issues); for (const key of keys) if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) issues.push({ path: `${path}.${key}`, code: "invalid_value", message: "Extraction limits must be positive integers." }); }
function validateExtractionConsistency(value: Record<string, unknown>, evidence: readonly EvidenceRef[], facts: readonly ProjectFact[], resources: readonly OfficialResource[], conflicts: readonly ProjectConflict[], issues: ProjectIntelligenceExtractionValidationIssue[]) {
  if (!isRecord(value.coverage) || !isRecord(value.limits)) return;
  const coverage = value.coverage;
  const limits = value.limits;
  const counts: Array<[string, number, string]> = [
    ["evidenceCount", evidence.length, "maxEvidence"],
    ["factCount", facts.length, "maxFacts"],
    ["resourceCount", resources.length, "maxResources"],
    ["conflictCount", conflicts.length, "maxConflicts"]
  ];
  for (const [key, actual, limitKey] of counts) {
    if (coverage[key] !== actual) issues.push({ path: `extraction.coverage.${key}`, code: "invalid_value", message: "Extraction coverage must match the normalized collections." });
    if (Number.isSafeInteger(limits[limitKey]) && actual > (limits[limitKey] as number)) issues.push({ path: `extraction.${key}`, code: "invalid_value", message: "Extraction collection exceeds its declared limit." });
  }
  if (coverage.sourceCount !== (Array.isArray(value.sourceIds) ? value.sourceIds.length : 0)) issues.push({ path: "extraction.coverage.sourceCount", code: "invalid_value", message: "Source coverage must match source IDs." });
  if (Array.isArray(value.warnings) && value.warnings.length > (limits.maxWarnings as number)) issues.push({ path: "extraction.warnings", code: "invalid_value", message: "Extraction warnings exceed their declared limit." });
  if (Array.isArray(value.unknowns) && value.unknowns.length > (limits.maxWarnings as number)) issues.push({ path: "extraction.unknowns", code: "invalid_value", message: "Extraction unknowns exceed their declared limit." });
  if (coverage.verifiedFactCount !== facts.filter((fact) => fact.verification === "verified").length) issues.push({ path: "extraction.coverage.verifiedFactCount", code: "invalid_value", message: "Verified fact coverage is inconsistent." });
  if (coverage.verifiedResourceCount !== resources.filter((resource) => resource.verification === "verified").length) issues.push({ path: "extraction.coverage.verifiedResourceCount", code: "invalid_value", message: "Verified resource coverage is inconsistent." });
  if (value.status === "empty" && evidence.length + facts.length + resources.length > 0) issues.push({ path: "extraction.status", code: "invalid_value", message: "An extraction with normalized content cannot be empty." });
}
