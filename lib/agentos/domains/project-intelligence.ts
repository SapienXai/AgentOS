import { redactSecretText, redactSecrets, REDACTED_SECRET_VALUE } from "@/lib/security/redaction";

export const PROJECT_INTELLIGENCE_SCHEMA_VERSION = 1 as const;

export type ProjectIntelligencePackState = "empty" | "partial" | "ready";

export type ProjectType =
  | "saas"
  | "website"
  | "mobile-app"
  | "backend-api"
  | "web3"
  | "company"
  | "research"
  | "content-media"
  | "open-source"
  | "internal-business"
  | "other";

export type ProjectVerificationState = "declared" | "discovered" | "inferred" | "verified";

export type ProjectConfidence = "low" | "medium" | "high";

export type ProjectScalarValue<T> = {
  value: T | null;
  factIds: readonly string[];
};

export type ProjectCollectionValue<T> = {
  value: readonly T[];
  factIds: readonly string[];
};

export type ProjectFactValue =
  | string
  | number
  | boolean
  | null
  | readonly ProjectFactValue[]
  | { readonly [key: string]: ProjectFactValue };

export type ProjectFactCategory =
  | "identity"
  | "overview"
  | "product"
  | "technical"
  | "resource"
  | "contact"
  | "identifier"
  | "business"
  | "other";

export type ProjectEvidenceOrigin =
  | "operator"
  | "first-party-website"
  | "first-party-documentation"
  | "first-party-repository"
  | "uploaded-file"
  | "uploaded-folder"
  | "connected-source"
  | "discovered-external"
  | "unknown-external";

export type ProjectEvidenceQualificationCapability =
  | "authoritative-first-party"
  | "authoritative-official-upload"
  | "authoritative-connected-source";

export type ProjectEvidenceQualification =
  | {
      status: "unqualified";
      reason: "operator-only" | "unknown-external" | "discovered-external" | "insufficient" | "unsupported";
    }
  | {
      status: "qualified";
      capability: ProjectEvidenceQualificationCapability;
      qualifiedAt: string;
    };

export type ProjectEvidenceType =
  | "operator-declaration"
  | "website"
  | "documentation"
  | "repository"
  | "uploaded-document"
  | "connected-record"
  | "api-response"
  | "social-profile"
  | "contact-page"
  | "other";

export type ProjectEvidenceProvenance = {
  origin: ProjectEvidenceOrigin;
  declaredBy: "operator" | "discovery" | "system";
  discoveredFromEvidenceRefId?: string;
};

export type EvidenceRef = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  sourceId: string;
  documentId?: string;
  canonicalLocator?: string;
  title: string;
  excerpt?: string;
  summary: string;
  retrievedAt?: string;
  evidenceType: ProjectEvidenceType;
  provenance: ProjectEvidenceProvenance;
  qualification: ProjectEvidenceQualification;
  /** The bounded claim observation this proof window actually supports. */
  claimScopes?: readonly ProjectEvidenceClaimScope[];
  confidence?: ProjectConfidence;
};

export type ProjectEvidenceClaimScope = {
  key: string;
  normalizedValue: ProjectFactValue;
};

export type ProjectEvidenceRelation = "supports" | "contradicts" | "context";

export type ProjectClaimEvidence = {
  evidenceRefId: string;
  relation: ProjectEvidenceRelation;
};

export type ProjectFactProvenance = {
  origin: ProjectEvidenceOrigin;
  declaredBy: "operator" | "discovery" | "system";
};

export type ProjectFact<T extends ProjectFactValue = ProjectFactValue> = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  category: ProjectFactCategory;
  key: string;
  value: T;
  normalizedValue: ProjectFactValue;
  statement: string;
  confidence: ProjectConfidence;
  verification: ProjectVerificationState;
  evidence: readonly ProjectClaimEvidence[];
  sourceIds: readonly string[];
  provenance: ProjectFactProvenance;
  observedAt?: string;
  retrievedAt?: string;
};

export type OfficialResourceCategory =
  | "website"
  | "application"
  | "documentation"
  | "repository"
  | "social"
  | "contact"
  | "email"
  | "whitepaper"
  | "document"
  | "api"
  | "developer"
  | "explorer"
  | "support"
  | "other";

export type OfficialResourceLocatorKind = "url" | "email" | "phone" | "identifier";

export type OfficialResourceLocator = {
  kind: OfficialResourceLocatorKind;
  value: string;
};

/** Origin metadata describes how a resource was found; it is not a trust source. */
export type OfficialResourceOrigin = {
  discoveredBy: "operator" | "discovery" | "system";
  origin: ProjectEvidenceOrigin;
  sourceId?: string;
  evidenceRefId?: string;
};

export type OfficialResource = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  category: OfficialResourceCategory;
  locator: OfficialResourceLocator;
  label: string;
  evidence: readonly ProjectClaimEvidence[];
  confidence: ProjectConfidence;
  verification: ProjectVerificationState;
  origin: OfficialResourceOrigin;
};

export type ProjectConflictSubject =
  | { kind: "fact"; id: string }
  | { kind: "resource"; id: string };

export type ProjectConflictStatus = "open" | "resolved" | "dismissed";

export type ProjectConflict = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  subjects: readonly ProjectConflictSubject[];
  evidenceRefIds: readonly string[];
  summary: string;
  confidence: ProjectConfidence;
  status: ProjectConflictStatus;
  detectedAt: string;
  resolvedAt?: string;
};

export type ProjectConflictSummary = {
  total: number;
  open: number;
  resolved: number;
  dismissed: number;
  hasOpenConflicts: boolean;
};

export type ProjectIdentifierKind =
  | "package"
  | "application"
  | "network"
  | "contract-address"
  | "repository"
  | "other";

export type ProjectIdentifier = {
  kind: ProjectIdentifierKind;
  value: string;
  label?: string;
};

export type ProjectContact = {
  kind: "email" | "phone" | "endpoint";
  value: string;
  label?: string;
};

export type ProjectIdentity = {
  projectName: ProjectScalarValue<string>;
  displayName: ProjectScalarValue<string>;
  organizationName: ProjectScalarValue<string>;
  description: ProjectScalarValue<string>;
  projectType: ProjectScalarValue<ProjectType>;
};

export type ProjectOverview = {
  whatItDoes: ProjectScalarValue<string>;
  primaryAudience: ProjectCollectionValue<string>;
  businessContext: ProjectScalarValue<string>;
  goals: ProjectCollectionValue<string>;
};

export type ProjectProducts = {
  products: ProjectCollectionValue<string>;
  services: ProjectCollectionValue<string>;
  features: ProjectCollectionValue<string>;
  platforms: ProjectCollectionValue<string>;
};

export type ProjectTechnicalLandscape = {
  frontend: ProjectCollectionValue<string>;
  backend: ProjectCollectionValue<string>;
  mobile: ProjectCollectionValue<string>;
  apis: ProjectCollectionValue<string>;
  repositories: ProjectCollectionValue<string>;
  technologies: ProjectCollectionValue<string>;
  infrastructure: ProjectCollectionValue<string>;
  networks: ProjectCollectionValue<string>;
  dependencies: ProjectCollectionValue<string>;
  integrations: ProjectCollectionValue<string>;
};

export type ProjectSourceCoverage = {
  sourceIds: readonly string[];
  evidenceRefIds: readonly string[];
  coveredFactIds: readonly string[];
  uncoveredAreas: readonly string[];
};

export type ProjectPackProvenance = {
  generatedBy: "operator" | "discovery" | "system";
  sourceIds: readonly string[];
  generationId?: string;
};

export type ProjectIntelligenceGeneration = {
  id: string;
  createdAt: string;
  method: "operator" | "discovery" | "system";
};

export type ProjectIntelligencePack = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  state: ProjectIntelligencePackState;
  identity: ProjectIdentity;
  overview: ProjectOverview;
  products: ProjectProducts;
  technicalLandscape: ProjectTechnicalLandscape;
  officialResources: readonly OfficialResource[];
  contacts: ProjectCollectionValue<ProjectContact>;
  identifiers: ProjectCollectionValue<ProjectIdentifier>;
  facts: readonly ProjectFact[];
  evidence: readonly EvidenceRef[];
  unknowns: readonly string[];
  conflicts: readonly ProjectConflict[];
  sourceCoverage: ProjectSourceCoverage;
  provenance: ProjectPackProvenance;
  generation?: ProjectIntelligenceGeneration;
  createdAt: string;
  updatedAt: string;
};

export type DiscoveryRunState = "pending" | "running" | "ready" | "partial" | "failed" | "cancelled";

export type DiscoveryPhase = "discovery" | "fetch" | "extraction" | "synthesis" | "finalization";

export type DiscoveryRun = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  sourceIds: readonly string[];
  state: DiscoveryRunState;
  phase: DiscoveryPhase | null;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  progress: {
    processedSources: number;
    totalSources: number;
    currentSourceId?: string;
    eventCount: number;
  };
  warningCount: number;
  errorCount: number;
  intelligenceGenerationId?: string;
  cancellation: {
    requested: boolean;
    requestedAt?: string;
    completedAt?: string;
  };
};

export type DiscoveryEventKind =
  | "source-accepted"
  | "source-started"
  | "homepage-fetch-started"
  | "homepage-fetched"
  | "robots-discovered"
  | "sitemap-discovered"
  | "page-discovered"
  | "page-fetch-started"
  | "page-fetched"
  | "docs-discovered"
  | "app-discovered"
  | "repository-discovered"
  | "social-discovered"
  | "contact-discovered"
  | "document-discovered"
  | "fact-extracted"
  | "resource-extracted"
  | "conflict-detected"
  | "intelligence-synthesis-started"
  | "intelligence-ready"
  | "warning"
  | "source-partial"
  | "source-failed"
  | "cancelled";

export type DiscoveryEventPayload = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;

export type DiscoveryEvent = {
  schemaVersion: typeof PROJECT_INTELLIGENCE_SCHEMA_VERSION;
  id: string;
  runId: string;
  sequence: number;
  emittedAt: string;
  phase: DiscoveryPhase | null;
  kind: DiscoveryEventKind;
  sourceId?: string;
  payload: DiscoveryEventPayload;
};

export type ProjectIntelligenceValidationIssue = {
  path: string;
  code:
    | "invalid_type"
    | "missing_field"
    | "unknown_field"
    | "secret_field"
    | "invalid_value"
    | "inconsistent_projection"
    | "unsupported_verification"
    | "missing_reference"
    | "duplicate_id"
    | "duplicate_reference"
    | "provenance_cycle";
  message: string;
};

export type ProjectIntelligenceValidation = {
  valid: boolean;
  issues: readonly ProjectIntelligenceValidationIssue[];
};

const REDACTED_MARKER = REDACTED_SECRET_VALUE;
const MAX_TEXT_LENGTH = 4000;
const MAX_EXCERPT_LENGTH = 1200;
const MAX_SUMMARY_LENGTH = 1000;
const SECRET_KEY = /(api[-_ ]?key|access[-_ ]?token|auth(?:orization)?|cookie|credential|password|private[-_ ]?key|refresh[-_ ]?token|secret|seed|recovery|webhook|^token$)/i;

const PROJECT_TYPES: readonly ProjectType[] = [
  "saas",
  "website",
  "mobile-app",
  "backend-api",
  "web3",
  "company",
  "research",
  "content-media",
  "open-source",
  "internal-business",
  "other"
];

const FACT_CATEGORIES: readonly ProjectFactCategory[] = [
  "identity",
  "overview",
  "product",
  "technical",
  "resource",
  "contact",
  "identifier",
  "business",
  "other"
];

const EVIDENCE_ORIGINS: readonly ProjectEvidenceOrigin[] = [
  "operator",
  "first-party-website",
  "first-party-documentation",
  "first-party-repository",
  "uploaded-file",
  "uploaded-folder",
  "connected-source",
  "discovered-external",
  "unknown-external"
];

const VERIFICATION_STATES: readonly ProjectVerificationState[] = ["declared", "discovered", "inferred", "verified"];

const CONFIDENCE_VALUES: readonly ProjectConfidence[] = ["low", "medium", "high"];

const DISCOVERY_PHASES: readonly DiscoveryPhase[] = ["discovery", "fetch", "extraction", "synthesis", "finalization"];

const DISCOVERY_RUN_STATES: readonly DiscoveryRunState[] = ["pending", "running", "ready", "partial", "failed", "cancelled"];

const PROJECT_PACK_KEYS = [
  "schemaVersion",
  "id",
  "state",
  "identity",
  "overview",
  "products",
  "technicalLandscape",
  "officialResources",
  "contacts",
  "identifiers",
  "facts",
  "evidence",
  "unknowns",
  "conflicts",
  "sourceCoverage",
  "provenance",
  "generation",
  "createdAt",
  "updatedAt"
] as const;

const FACT_KEYS = [
  "schemaVersion",
  "id",
  "category",
  "key",
  "value",
  "normalizedValue",
  "statement",
  "confidence",
  "verification",
  "evidence",
  "sourceIds",
  "provenance",
  "observedAt",
  "retrievedAt"
] as const;

const EVIDENCE_KEYS = [
  "schemaVersion",
  "id",
  "sourceId",
  "documentId",
  "canonicalLocator",
  "title",
  "excerpt",
  "summary",
  "retrievedAt",
  "evidenceType",
  "provenance",
  "qualification",
  "claimScopes",
  "confidence"
] as const;

const RESOURCE_KEYS = ["schemaVersion", "id", "category", "locator", "label", "evidence", "confidence", "verification", "origin"] as const;
const CONFLICT_KEYS = ["schemaVersion", "id", "subjects", "evidenceRefIds", "summary", "confidence", "status", "detectedAt", "resolvedAt"] as const;
const DISCOVERY_RUN_KEYS = [
  "schemaVersion",
  "id",
  "sourceIds",
  "state",
  "phase",
  "startedAt",
  "updatedAt",
  "completedAt",
  "progress",
  "warningCount",
  "errorCount",
  "intelligenceGenerationId",
  "cancellation"
] as const;
const DISCOVERY_EVENT_KEYS = ["schemaVersion", "id", "runId", "sequence", "emittedAt", "phase", "kind", "sourceId", "payload"] as const;

export function normalizeProjectIntelligenceText(value: string, maxLength = MAX_TEXT_LENGTH) {
  return redactSecretText(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function normalizeProjectFactValue(value: ProjectFactValue): ProjectFactValue {
  if (typeof value === "string") return normalizeProjectIntelligenceText(value);
  if (Array.isArray(value)) return value.map((entry) => normalizeProjectFactValue(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeProjectFactValue(entry)])
    );
  }
  return value;
}

export function normalizeProjectScalarValue<T>(value: ProjectScalarValue<T>): ProjectScalarValue<T> {
  return {
    value: value.value === null ? null : normalizeProjectionValue(value.value),
    factIds: normalizeIds(value.factIds)
  };
}

export function normalizeProjectCollectionValue<T>(value: ProjectCollectionValue<T>): ProjectCollectionValue<T> {
  const seen = new Set<string>();
  const normalized: T[] = [];
  for (const member of value.value) {
    const normalizedMember = normalizeProjectionValue(member);
    const key = projectMembershipKey(normalizedMember);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(normalizedMember);
  }
  return { value: normalized, factIds: normalizeIds(value.factIds) };
}

export function normalizeEvidenceRef(raw: unknown): EvidenceRef {
  const record = requireRecord(raw, "EvidenceRef");
  assertKnownKeys(record, EVIDENCE_KEYS, "EvidenceRef");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "EvidenceRef.schemaVersion");
  const provenance = normalizeEvidenceProvenance(normalized.provenance);
  const qualification = normalizeEvidenceQualification(normalized.qualification);
  const result: EvidenceRef = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "EvidenceRef.id"),
    sourceId: requiredText(normalized.sourceId, "EvidenceRef.sourceId"),
    ...(optionalText(normalized.documentId) ? { documentId: optionalText(normalized.documentId) } : {}),
    ...(optionalText(normalized.canonicalLocator) ? { canonicalLocator: normalizeProjectIntelligenceText(String(normalized.canonicalLocator)) } : {}),
    title: normalizeProjectIntelligenceText(requiredText(normalized.title, "EvidenceRef.title")),
    ...(optionalText(normalized.excerpt) ? { excerpt: normalizeProjectIntelligenceText(String(normalized.excerpt), MAX_EXCERPT_LENGTH) } : {}),
    summary: normalizeProjectIntelligenceText(requiredText(normalized.summary, "EvidenceRef.summary"), MAX_SUMMARY_LENGTH),
    ...(optionalText(normalized.retrievedAt) ? { retrievedAt: String(normalized.retrievedAt) } : {}),
    evidenceType: requireEvidenceType(normalized.evidenceType),
    provenance,
    qualification,
    ...(Array.isArray(normalized.claimScopes) ? { claimScopes: normalizeClaimScopes(normalized.claimScopes) } : {}),
    ...(isConfidence(normalized.confidence) ? { confidence: normalized.confidence } : {})
  };
  assertValidOrThrow(validateEvidenceRef(result));
  return result;
}

export function normalizeProjectFact(raw: unknown): ProjectFact {
  const record = requireRecord(raw, "ProjectFact");
  assertKnownKeys(record, FACT_KEYS, "ProjectFact");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "ProjectFact.schemaVersion");
  const value = normalizeProjectFactValue(requireFactValue(normalized.value, "ProjectFact.value"));
  const result: ProjectFact = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "ProjectFact.id"),
    category: requireEnum(normalized.category, FACT_CATEGORIES, "ProjectFact.category"),
    key: normalizeProjectIntelligenceText(requiredText(normalized.key, "ProjectFact.key")),
    value,
    normalizedValue: canonicalFactNormalizedValue(value),
    statement: normalizeProjectIntelligenceText(requiredText(normalized.statement, "ProjectFact.statement")),
    confidence: requireEnum(normalized.confidence, CONFIDENCE_VALUES, "ProjectFact.confidence"),
    verification: requireEnum(normalized.verification, VERIFICATION_STATES, "ProjectFact.verification"),
    evidence: normalizeClaimEvidence(normalized.evidence),
    sourceIds: normalizeIds(normalized.sourceIds),
    provenance: normalizeFactProvenance(normalized.provenance),
    ...(optionalText(normalized.observedAt) ? { observedAt: String(normalized.observedAt) } : {}),
    ...(optionalText(normalized.retrievedAt) ? { retrievedAt: String(normalized.retrievedAt) } : {})
  };
  const structuralIssues: ProjectIntelligenceValidationIssue[] = [];
  validateFactAt(result, "fact", structuralIssues);
  assertValidOrThrow(resultFromIssues(structuralIssues));
  return result;
}

export function normalizeOfficialResource(raw: unknown): OfficialResource {
  const record = requireRecord(raw, "OfficialResource");
  assertKnownKeys(record, RESOURCE_KEYS, "OfficialResource");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "OfficialResource.schemaVersion");
  const result: OfficialResource = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "OfficialResource.id"),
    category: requiredResourceCategory(normalized.category),
    locator: normalizeResourceLocator(normalized.locator),
    label: normalizeProjectIntelligenceText(requiredText(normalized.label, "OfficialResource.label")),
    evidence: normalizeClaimEvidence(normalized.evidence),
    confidence: requireEnum(normalized.confidence, CONFIDENCE_VALUES, "OfficialResource.confidence"),
    verification: requireEnum(normalized.verification, VERIFICATION_STATES, "OfficialResource.verification"),
    origin: normalizeResourceOrigin(normalized.origin)
  };
  const structuralIssues: ProjectIntelligenceValidationIssue[] = [];
  validateResourceAt(result, "resource", structuralIssues);
  assertValidOrThrow(resultFromIssues(structuralIssues));
  return result;
}

export function normalizeProjectConflict(raw: unknown): ProjectConflict {
  const record = requireRecord(raw, "ProjectConflict");
  assertKnownKeys(record, CONFLICT_KEYS, "ProjectConflict");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "ProjectConflict.schemaVersion");
  const result: ProjectConflict = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "ProjectConflict.id"),
    subjects: normalizeConflictSubjects(normalized.subjects),
    evidenceRefIds: normalizeIds(normalized.evidenceRefIds),
    summary: normalizeProjectIntelligenceText(requiredText(normalized.summary, "ProjectConflict.summary"), MAX_SUMMARY_LENGTH),
    confidence: requireEnum(normalized.confidence, CONFIDENCE_VALUES, "ProjectConflict.confidence"),
    status: requireEnum(normalized.status, ["open", "resolved", "dismissed"] as const, "ProjectConflict.status"),
    detectedAt: requiredText(normalized.detectedAt, "ProjectConflict.detectedAt"),
    ...(optionalText(normalized.resolvedAt) ? { resolvedAt: String(normalized.resolvedAt) } : {})
  };
  assertValidOrThrow(validateProjectConflict(result));
  return result;
}

export function normalizeDiscoveryRun(raw: unknown): DiscoveryRun {
  const record = requireRecord(raw, "DiscoveryRun");
  assertKnownKeys(record, DISCOVERY_RUN_KEYS, "DiscoveryRun");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "DiscoveryRun.schemaVersion");
  const progress = requireRecord(normalized.progress, "DiscoveryRun.progress");
  assertKnownKeys(progress, ["processedSources", "totalSources", "currentSourceId", "eventCount"], "DiscoveryRun.progress");
  const cancellation = requireRecord(normalized.cancellation, "DiscoveryRun.cancellation");
  assertKnownKeys(cancellation, ["requested", "requestedAt", "completedAt"], "DiscoveryRun.cancellation");
  const result: DiscoveryRun = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "DiscoveryRun.id"),
    sourceIds: normalizeIds(normalized.sourceIds),
    state: requireEnum(normalized.state, DISCOVERY_RUN_STATES, "DiscoveryRun.state"),
    phase: normalized.phase === null ? null : requireEnum(normalized.phase, DISCOVERY_PHASES, "DiscoveryRun.phase"),
    ...(optionalText(normalized.startedAt) ? { startedAt: String(normalized.startedAt) } : {}),
    updatedAt: requiredText(normalized.updatedAt, "DiscoveryRun.updatedAt"),
    ...(optionalText(normalized.completedAt) ? { completedAt: String(normalized.completedAt) } : {}),
    progress: {
      processedSources: requiredNonNegativeInteger(progress.processedSources, "DiscoveryRun.progress.processedSources"),
      totalSources: requiredNonNegativeInteger(progress.totalSources, "DiscoveryRun.progress.totalSources"),
      ...(optionalText(progress.currentSourceId) ? { currentSourceId: String(progress.currentSourceId) } : {}),
      eventCount: requiredNonNegativeInteger(progress.eventCount, "DiscoveryRun.progress.eventCount")
    },
    warningCount: requiredNonNegativeInteger(normalized.warningCount, "DiscoveryRun.warningCount"),
    errorCount: requiredNonNegativeInteger(normalized.errorCount, "DiscoveryRun.errorCount"),
    ...(optionalText(normalized.intelligenceGenerationId) ? { intelligenceGenerationId: String(normalized.intelligenceGenerationId) } : {}),
    cancellation: {
      requested: requireBoolean(cancellation.requested, "DiscoveryRun.cancellation.requested"),
      ...(optionalText(cancellation.requestedAt) ? { requestedAt: String(cancellation.requestedAt) } : {}),
      ...(optionalText(cancellation.completedAt) ? { completedAt: String(cancellation.completedAt) } : {})
    }
  };
  assertValidOrThrow(validateDiscoveryRun(result));
  return result;
}

export function normalizeDiscoveryEvent(raw: unknown): DiscoveryEvent {
  const record = requireRecord(raw, "DiscoveryEvent");
  assertKnownKeys(record, DISCOVERY_EVENT_KEYS, "DiscoveryEvent");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "DiscoveryEvent.schemaVersion");
  const payload = requireRecord(normalized.payload, "DiscoveryEvent.payload");
  const result: DiscoveryEvent = {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: requiredText(normalized.id, "DiscoveryEvent.id"),
    runId: requiredText(normalized.runId, "DiscoveryEvent.runId"),
    sequence: requiredNonNegativeInteger(normalized.sequence, "DiscoveryEvent.sequence"),
    emittedAt: requiredText(normalized.emittedAt, "DiscoveryEvent.emittedAt"),
    phase: normalized.phase === null ? null : requireEnum(normalized.phase, DISCOVERY_PHASES, "DiscoveryEvent.phase"),
    kind: requireDiscoveryEventKind(normalized.kind),
    ...(optionalText(normalized.sourceId) ? { sourceId: String(normalized.sourceId) } : {}),
    payload: normalizeEventPayload(payload)
  };
  assertValidOrThrow(validateDiscoveryEvent(result));
  return result;
}

export function normalizeProjectIntelligencePack(raw: unknown): ProjectIntelligencePack {
  const record = requireRecord(raw, "ProjectIntelligencePack");
  assertKnownKeys(record, PROJECT_PACK_KEYS, "ProjectIntelligencePack");
  const normalized = redactSecrets(structuredClone(record)) as Record<string, unknown>;
  requireSchemaVersion(normalized.schemaVersion, "ProjectIntelligencePack.schemaVersion");
  const result = normalizePackRecord(normalized);
  assertValidOrThrow(validateProjectIntelligencePack(result));
  return result;
}

export function validateEvidenceRef(value: unknown): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateEvidenceRefAt(value, "evidence", issues);
  return result(issues);
}

export function validateProjectFact(value: unknown, _facts?: readonly ProjectFact[], evidence?: readonly EvidenceRef[]): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateFactAt(value, "fact", issues);
  if (!isRecord(value)) return result(issues);
  if (issues.length === 0) {
    if (_facts) validateUniqueObjectIds(_facts, "facts", issues);
    if (evidence) validateUniqueObjectIds(evidence, "evidence", issues);
  }
  if (issues.length === 0) {
    validateFactEvidence(value as ProjectFact, evidence, "fact", issues);
  }
  return result(issues);
}

export function validateOfficialResource(value: unknown, evidence?: readonly EvidenceRef[]): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateResourceAt(value, "resource", issues);
  if (issues.length === 0) {
    if (evidence) validateUniqueObjectIds(evidence, "evidence", issues);
    if (issues.length === 0) validateResourceEvidence(value as OfficialResource, evidence, "resource", issues);
  }
  return result(issues);
}

export function validateProjectConflict(value: unknown, facts?: readonly ProjectFact[], resources?: readonly OfficialResource[], evidence?: readonly EvidenceRef[]): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateConflictAt(value, "conflict", issues);
  if (issues.length === 0 && isRecord(value)) {
    const conflict = value as unknown as ProjectConflict;
    if (facts) validateUniqueObjectIds(facts, "facts", issues);
    if (resources) validateUniqueObjectIds(resources, "resources", issues);
    if (evidence) validateUniqueObjectIds(evidence, "evidence", issues);
    if (issues.length > 0) return result(issues);
    const factIds = new Set((facts ?? []).map((fact) => fact.id));
    const resourceIds = new Set((resources ?? []).map((resource) => resource.id));
    for (const [index, subject] of conflict.subjects.entries()) {
      const exists = subject.kind === "fact" ? factIds.has(subject.id) : resourceIds.has(subject.id);
      if ((facts || resources) && !exists) addIssue(issues, `conflict.subjects[${index}].id`, "missing_reference", "Conflict subject does not reference a known fact or resource.");
    }
    if (evidence) validateEvidenceReferences(conflict.evidenceRefIds, evidence, "conflict.evidenceRefIds", issues);
  }
  return result(issues);
}

export function validateDiscoveryRun(value: unknown): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateDiscoveryRunAt(value, "run", issues);
  return result(issues);
}

export function validateDiscoveryEvent(value: unknown): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  validateDiscoveryEventAt(value, "event", issues);
  return result(issues);
}

export function validateProjectIntelligencePack(value: unknown): ProjectIntelligenceValidation {
  const issues: ProjectIntelligenceValidationIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, "pack", "invalid_type", "ProjectIntelligencePack must be an object.");
    return result(issues);
  }
  assertKnownKeysForValidation(value, PROJECT_PACK_KEYS, "pack", issues);
  validateSchemaVersion(value.schemaVersion, "pack.schemaVersion", issues);
  validateRequiredText(value.id, "pack.id", issues);
  validateEnum(value.state, ["empty", "partial", "ready"] as const, "pack.state", issues);
  validateIdentity(value.identity, "pack.identity", issues);
  validateOverview(value.overview, "pack.overview", issues);
  validateProducts(value.products, "pack.products", issues);
  validateTechnicalLandscape(value.technicalLandscape, "pack.technicalLandscape", issues);
  const evidence = validateArray(value.evidence, "pack.evidence", issues, validateEvidenceRefAt);
  const facts = validateArray(value.facts, "pack.facts", issues, validateFactAt);
  const resources = validateArray(value.officialResources, "pack.officialResources", issues, validateResourceAt);
  validateCollectionValue(value.contacts, "pack.contacts", issues, validateContactValue);
  validateCollectionValue(value.identifiers, "pack.identifiers", issues, validateIdentifierValue);
  validateStringArray(value.unknowns, "pack.unknowns", issues);
  const conflicts = validateArray(value.conflicts, "pack.conflicts", issues, validateConflictAt);
  validateSourceCoverage(value.sourceCoverage, "pack.sourceCoverage", issues);
  validatePackProvenance(value.provenance, "pack.provenance", issues);
  if (value.generation !== undefined) validateGeneration(value.generation, "pack.generation", issues);
  validateRequiredText(value.createdAt, "pack.createdAt", issues);
  validateRequiredText(value.updatedAt, "pack.updatedAt", issues);

  if (issues.length === 0) {
    const typedFacts = facts as ProjectFact[];
    const typedEvidence = evidence as EvidenceRef[];
    const typedResources = resources as OfficialResource[];
    const typedConflicts = conflicts as ProjectConflict[];
    validateUniqueObjectIds(typedFacts, "pack.facts", issues);
    validateUniqueObjectIds(typedEvidence, "pack.evidence", issues);
    validateUniqueObjectIds(typedResources, "pack.officialResources", issues);
    validateUniqueObjectIds(typedConflicts, "pack.conflicts", issues);
    if (issues.length === 0) {
      for (const fact of typedFacts) validateFactEvidence(fact, typedEvidence, "pack.facts", issues);
      for (const resource of typedResources) validateResourceEvidence(resource, typedEvidence, "pack.officialResources", issues);
      for (const conflict of typedConflicts) validateProjectConflict(conflict, typedFacts, typedResources, typedEvidence).issues.forEach((issue) => issues.push({ ...issue, path: `pack.${issue.path}` }));
      validateEvidenceLineage(typedEvidence, "pack.evidence", issues);
      validatePackProjections(value as unknown as ProjectIntelligencePack, typedFacts, issues);
      const sourceCoverage = value.sourceCoverage as ProjectSourceCoverage;
      validateEvidenceReferences(sourceCoverage.evidenceRefIds, typedEvidence, "pack.sourceCoverage.evidenceRefIds", issues);
      validateFactReferences(sourceCoverage.coveredFactIds, typedFacts, "pack.sourceCoverage.coveredFactIds", issues);
      validateSourceCoverageRelationships(value as unknown as ProjectIntelligencePack, typedFacts, typedEvidence, typedResources, typedConflicts, issues);
      validatePackState(value as unknown as ProjectIntelligencePack, typedFacts, typedEvidence, typedResources, issues);
    }
  }
  return result(issues);
}

export function getProjectConflictSummary(pack: Pick<ProjectIntelligencePack, "conflicts">): ProjectConflictSummary {
  let open = 0;
  let resolved = 0;
  let dismissed = 0;
  for (const conflict of pack.conflicts) {
    if (conflict.status === "open") open += 1;
    else if (conflict.status === "resolved") resolved += 1;
    else dismissed += 1;
  }
  return { total: pack.conflicts.length, open, resolved, dismissed, hasOpenConflicts: open > 0 };
}

export function isEvidenceQualificationEligible(evidence: Pick<EvidenceRef, "provenance" | "qualification" | "evidenceType"> | undefined): boolean {
  if (!evidence) return false;
  if (evidence.qualification.status !== "qualified") return false;
  if (evidence.provenance.origin === "operator" || evidence.provenance.origin === "unknown-external" || evidence.provenance.origin === "discovered-external") return false;
  if (evidence.evidenceType === "operator-declaration") return false;
  if (evidence.qualification.capability === "authoritative-first-party") {
    return evidence.provenance.origin === "first-party-website" || evidence.provenance.origin === "first-party-documentation" || evidence.provenance.origin === "first-party-repository";
  }
  if (evidence.qualification.capability === "authoritative-official-upload") {
    return evidence.provenance.origin === "uploaded-file" || evidence.provenance.origin === "uploaded-folder";
  }
  if (evidence.qualification.capability === "authoritative-connected-source") return evidence.provenance.origin === "connected-source";
  return false;
}

export function createEmptyProjectIntelligencePack(input: { id: string; now?: string }): ProjectIntelligencePack {
  const now = input.now ?? new Date().toISOString();
  const scalar = <T,>(): ProjectScalarValue<T> => ({ value: null, factIds: [] });
  const collection = <T,>(): ProjectCollectionValue<T> => ({ value: [], factIds: [] });
  return {
    schemaVersion: PROJECT_INTELLIGENCE_SCHEMA_VERSION,
    id: input.id,
    state: "empty",
    identity: {
      projectName: scalar(),
      displayName: scalar(),
      organizationName: scalar(),
      description: scalar(),
      projectType: scalar()
    },
    overview: {
      whatItDoes: scalar(),
      primaryAudience: collection(),
      businessContext: scalar(),
      goals: collection()
    },
    products: { products: collection(), services: collection(), features: collection(), platforms: collection() },
    technicalLandscape: {
      frontend: collection(),
      backend: collection(),
      mobile: collection(),
      apis: collection(),
      repositories: collection(),
      technologies: collection(),
      infrastructure: collection(),
      networks: collection(),
      dependencies: collection(),
      integrations: collection()
    },
    officialResources: [],
    contacts: collection(),
    identifiers: collection(),
    facts: [],
    evidence: [],
    unknowns: [],
    conflicts: [],
    sourceCoverage: { sourceIds: [], evidenceRefIds: [], coveredFactIds: [], uncoveredAreas: [] },
    provenance: { generatedBy: "system", sourceIds: [] },
    createdAt: now,
    updatedAt: now
  };
}

function normalizePackRecord(record: Record<string, unknown>): ProjectIntelligencePack {
  const normalized = createEmptyProjectIntelligencePack({ id: requiredText(record.id, "ProjectIntelligencePack.id"), now: requiredText(record.createdAt, "ProjectIntelligencePack.createdAt") });
  normalized.state = requireEnum(record.state, ["empty", "partial", "ready"] as const, "ProjectIntelligencePack.state");
  normalized.identity = normalizeIdentity(record.identity);
  normalized.overview = normalizeOverview(record.overview);
  normalized.products = normalizeProducts(record.products);
  normalized.technicalLandscape = normalizeTechnicalLandscape(record.technicalLandscape);
  normalized.officialResources = normalizeArray(record.officialResources, normalizeOfficialResource);
  normalized.contacts = normalizeCollection(record.contacts);
  normalized.identifiers = normalizeCollection(record.identifiers);
  normalized.facts = normalizeArray(record.facts, normalizeProjectFact);
  normalized.evidence = normalizeArray(record.evidence, normalizeEvidenceRef);
  normalized.unknowns = normalizeStringArray(record.unknowns);
  normalized.conflicts = normalizeArray(record.conflicts, normalizeProjectConflict);
  normalized.sourceCoverage = normalizeSourceCoverage(record.sourceCoverage);
  normalized.provenance = normalizePackProvenance(record.provenance);
  normalized.generation = record.generation === undefined ? undefined : normalizeGeneration(record.generation);
  normalized.createdAt = requiredText(record.createdAt, "ProjectIntelligencePack.createdAt");
  normalized.updatedAt = requiredText(record.updatedAt, "ProjectIntelligencePack.updatedAt");
  return normalized;
}

function validateEvidenceRefAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "EvidenceRef must be an object.");
  assertKnownKeysForValidation(value, EVIDENCE_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateRequiredText(value.sourceId, `${path}.sourceId`, issues);
  validateOptionalText(value.documentId, `${path}.documentId`, issues);
  validateOptionalText(value.canonicalLocator, `${path}.canonicalLocator`, issues);
  validateBoundedText(value.title, `${path}.title`, MAX_TEXT_LENGTH, issues);
  validateBoundedText(value.excerpt, `${path}.excerpt`, MAX_EXCERPT_LENGTH, issues, true);
  validateBoundedText(value.summary, `${path}.summary`, MAX_SUMMARY_LENGTH, issues);
  validateOptionalText(value.retrievedAt, `${path}.retrievedAt`, issues);
  validateEnum(value.evidenceType, ["operator-declaration", "website", "documentation", "repository", "uploaded-document", "connected-record", "api-response", "social-profile", "contact-page", "other"] as const, `${path}.evidenceType`, issues);
  validateEvidenceProvenance(value.provenance, `${path}.provenance`, issues);
  validateEvidenceQualification(value.qualification, `${path}.qualification`, issues);
  if (isRecord(value.provenance) && isRecord(value.qualification) && value.qualification.status === "qualified" && !isEvidenceQualificationEligible(value as EvidenceRef)) {
    addIssue(issues, `${path}.qualification`, "unsupported_verification", "Evidence from operator-only or external discovery cannot qualify as authoritative proof.");
  }
  validateOptionalEnum(value.confidence, CONFIDENCE_VALUES, `${path}.confidence`, issues);
  if (value.claimScopes !== undefined) validateClaimScopes(value.claimScopes, `${path}.claimScopes`, issues);
}

function validateFactAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "ProjectFact must be an object.");
  assertKnownKeysForValidation(value, FACT_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateEnum(value.category, FACT_CATEGORIES, `${path}.category`, issues);
  validateBoundedText(value.key, `${path}.key`, MAX_TEXT_LENGTH, issues);
  validateFactValue(value.value, `${path}.value`, issues);
  validateFactNormalizedValue(value.normalizedValue, `${path}.normalizedValue`, issues);
  validateFactNormalizedConsistency(value.value, value.normalizedValue, `${path}.normalizedValue`, issues);
  validateBoundedText(value.statement, `${path}.statement`, MAX_TEXT_LENGTH, issues);
  validateEnum(value.confidence, CONFIDENCE_VALUES, `${path}.confidence`, issues);
  validateEnum(value.verification, VERIFICATION_STATES, `${path}.verification`, issues);
  validateClaimEvidence(value.evidence, `${path}.evidence`, issues);
  validateStringArray(value.sourceIds, `${path}.sourceIds`, issues);
  validateFactProvenance(value.provenance, `${path}.provenance`, issues);
  validateOptionalText(value.observedAt, `${path}.observedAt`, issues);
  validateOptionalText(value.retrievedAt, `${path}.retrievedAt`, issues);
}

function validateResourceAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "OfficialResource must be an object.");
  assertKnownKeysForValidation(value, RESOURCE_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateEnum(value.category, ["website", "application", "documentation", "repository", "social", "contact", "email", "whitepaper", "document", "api", "developer", "explorer", "support", "other"] as const, `${path}.category`, issues);
  validateResourceLocator(value.locator, `${path}.locator`, issues);
  validateBoundedText(value.label, `${path}.label`, MAX_TEXT_LENGTH, issues);
  validateClaimEvidence(value.evidence, `${path}.evidence`, issues);
  validateEnum(value.confidence, CONFIDENCE_VALUES, `${path}.confidence`, issues);
  validateEnum(value.verification, VERIFICATION_STATES, `${path}.verification`, issues);
  validateResourceOrigin(value.origin, `${path}.origin`, issues);
}

function validateConflictAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "ProjectConflict must be an object.");
  assertKnownKeysForValidation(value, CONFLICT_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  if (!Array.isArray(value.subjects) || value.subjects.length < 2) addIssue(issues, `${path}.subjects`, "invalid_value", "A conflict requires at least two subjects.");
  else value.subjects.forEach((subject, index) => validateConflictSubject(subject, `${path}.subjects[${index}]`, issues));
  validateStringArray(value.evidenceRefIds, `${path}.evidenceRefIds`, issues);
  if (Array.isArray(value.evidenceRefIds)) validateUniqueReferences(value.evidenceRefIds, `${path}.evidenceRefIds`, issues);
  validateBoundedText(value.summary, `${path}.summary`, MAX_SUMMARY_LENGTH, issues);
  validateEnum(value.confidence, CONFIDENCE_VALUES, `${path}.confidence`, issues);
  validateEnum(value.status, ["open", "resolved", "dismissed"] as const, `${path}.status`, issues);
  validateRequiredText(value.detectedAt, `${path}.detectedAt`, issues);
  validateOptionalText(value.resolvedAt, `${path}.resolvedAt`, issues);
}

function validateDiscoveryRunAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "DiscoveryRun must be an object.");
  assertKnownKeysForValidation(value, DISCOVERY_RUN_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateStringArray(value.sourceIds, `${path}.sourceIds`, issues);
  validateEnum(value.state, DISCOVERY_RUN_STATES, `${path}.state`, issues);
  if (value.phase !== null) validateEnum(value.phase, DISCOVERY_PHASES, `${path}.phase`, issues);
  if (value.state === "pending" && value.phase !== null) addIssue(issues, `${path}.phase`, "invalid_value", "Pending runs must not report an execution phase.");
  validateOptionalText(value.startedAt, `${path}.startedAt`, issues);
  validateRequiredText(value.updatedAt, `${path}.updatedAt`, issues);
  validateOptionalText(value.completedAt, `${path}.completedAt`, issues);
  if (!isRecord(value.progress)) addIssue(issues, `${path}.progress`, "invalid_type", "DiscoveryRun.progress must be an object.");
  else {
    assertKnownKeysForValidation(value.progress, ["processedSources", "totalSources", "currentSourceId", "eventCount"], `${path}.progress`, issues);
    validateNonNegativeInteger(value.progress.processedSources, `${path}.progress.processedSources`, issues);
    validateNonNegativeInteger(value.progress.totalSources, `${path}.progress.totalSources`, issues);
    validateOptionalText(value.progress.currentSourceId, `${path}.progress.currentSourceId`, issues);
    validateNonNegativeInteger(value.progress.eventCount, `${path}.progress.eventCount`, issues);
    if (typeof value.progress.processedSources === "number" && typeof value.progress.totalSources === "number" && value.progress.processedSources > value.progress.totalSources) addIssue(issues, `${path}.progress.processedSources`, "invalid_value", "Processed sources cannot exceed total sources.");
  }
  validateNonNegativeInteger(value.warningCount, `${path}.warningCount`, issues);
  validateNonNegativeInteger(value.errorCount, `${path}.errorCount`, issues);
  validateOptionalText(value.intelligenceGenerationId, `${path}.intelligenceGenerationId`, issues);
  if (!isRecord(value.cancellation)) addIssue(issues, `${path}.cancellation`, "invalid_type", "DiscoveryRun.cancellation must be an object.");
  else {
    assertKnownKeysForValidation(value.cancellation, ["requested", "requestedAt", "completedAt"], `${path}.cancellation`, issues);
    validateBoolean(value.cancellation.requested, `${path}.cancellation.requested`, issues);
    validateOptionalText(value.cancellation.requestedAt, `${path}.cancellation.requestedAt`, issues);
    validateOptionalText(value.cancellation.completedAt, `${path}.cancellation.completedAt`, issues);
    if (value.cancellation.requested === false && value.cancellation.requestedAt !== undefined) addIssue(issues, `${path}.cancellation.requestedAt`, "invalid_value", "A cancellation timestamp requires a requested cancellation.");
    if (value.cancellation.requested === false && value.cancellation.completedAt !== undefined) addIssue(issues, `${path}.cancellation.completedAt`, "invalid_value", "Cancellation cannot complete unless cancellation was requested.");
    if (value.cancellation.requested === true && value.cancellation.requestedAt === undefined) addIssue(issues, `${path}.cancellation.requestedAt`, "missing_field", "A requested cancellation must include requestedAt.");
    if (value.cancellation.completedAt !== undefined && value.state !== "cancelled") addIssue(issues, `${path}.cancellation.completedAt`, "invalid_value", "Cancellation can complete only for a cancelled run.");
    if (value.cancellation.requested === true && value.state !== "running" && value.state !== "cancelled") addIssue(issues, `${path}.cancellation.requested`, "invalid_value", "Only running or cancelled runs can carry a cancellation request.");
  }
  if (value.state === "pending") {
    if (value.completedAt !== undefined) addIssue(issues, `${path}.completedAt`, "invalid_value", "Pending runs must not have completedAt.");
  } else if (value.state === "running") {
    if (value.phase === null) addIssue(issues, `${path}.phase`, "invalid_value", "Running runs must report an execution phase.");
    if (value.startedAt === undefined) addIssue(issues, `${path}.startedAt`, "missing_field", "Running runs must include startedAt.");
    if (value.completedAt !== undefined) addIssue(issues, `${path}.completedAt`, "invalid_value", "Running runs must not have completedAt.");
  } else if (DISCOVERY_RUN_STATES.includes(value.state as DiscoveryRunState)) {
    if (value.phase !== null) addIssue(issues, `${path}.phase`, "invalid_value", "Terminal runs must not report an execution phase.");
    if (value.startedAt === undefined) addIssue(issues, `${path}.startedAt`, "missing_field", "Terminal runs must include startedAt.");
    if (value.completedAt === undefined) addIssue(issues, `${path}.completedAt`, "missing_field", "Terminal runs must include completedAt.");
  }
  if (value.state === "cancelled" && isRecord(value.cancellation)) {
    if (value.cancellation.requested !== true) addIssue(issues, `${path}.cancellation.requested`, "invalid_value", "Cancelled runs require a requested cancellation.");
    if (value.cancellation.requestedAt === undefined) addIssue(issues, `${path}.cancellation.requestedAt`, "missing_field", "Cancelled runs require requestedAt.");
    if (value.cancellation.completedAt === undefined) addIssue(issues, `${path}.cancellation.completedAt`, "missing_field", "Cancelled runs require cancellation.completedAt.");
  }
}

function validateDiscoveryEventAt(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "DiscoveryEvent must be an object.");
  assertKnownKeysForValidation(value, DISCOVERY_EVENT_KEYS, path, issues);
  validateSchemaVersion(value.schemaVersion, `${path}.schemaVersion`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateRequiredText(value.runId, `${path}.runId`, issues);
  validateNonNegativeInteger(value.sequence, `${path}.sequence`, issues);
  validateRequiredText(value.emittedAt, `${path}.emittedAt`, issues);
  if (value.phase !== null) validateEnum(value.phase, DISCOVERY_PHASES, `${path}.phase`, issues);
  validateDiscoveryEventKind(value.kind, `${path}.kind`, issues);
  validateOptionalText(value.sourceId, `${path}.sourceId`, issues);
  if (!isRecord(value.payload)) addIssue(issues, `${path}.payload`, "invalid_type", "DiscoveryEvent.payload must be a structured object.");
  else validateEventPayload(value.payload, `${path}.payload`, issues);
}

function validateDiscoveryEventKind(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  validateEnum(value, ["source-accepted", "source-started", "homepage-fetch-started", "homepage-fetched", "robots-discovered", "sitemap-discovered", "page-discovered", "page-fetch-started", "page-fetched", "docs-discovered", "app-discovered", "repository-discovered", "social-discovered", "contact-discovered", "document-discovered", "fact-extracted", "resource-extracted", "conflict-detected", "intelligence-synthesis-started", "intelligence-ready", "warning", "source-partial", "source-failed", "cancelled"] as const, path, issues);
}

function validateIdentity(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Project identity must be an object.");
  assertKnownKeysForValidation(value, ["projectName", "displayName", "organizationName", "description", "projectType"], path, issues);
  validateScalarValue(value.projectName, `${path}.projectName`, issues, "string");
  validateScalarValue(value.displayName, `${path}.displayName`, issues, "string");
  validateScalarValue(value.organizationName, `${path}.organizationName`, issues, "string");
  validateScalarValue(value.description, `${path}.description`, issues, "string");
  validateScalarValue(value.projectType, `${path}.projectType`, issues, "projectType");
}

function validateOverview(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Project overview must be an object.");
  assertKnownKeysForValidation(value, ["whatItDoes", "primaryAudience", "businessContext", "goals"], path, issues);
  validateScalarValue(value.whatItDoes, `${path}.whatItDoes`, issues, "string");
  validateCollectionValue(value.primaryAudience, `${path}.primaryAudience`, issues, validateStringValue);
  validateScalarValue(value.businessContext, `${path}.businessContext`, issues, "string");
  validateCollectionValue(value.goals, `${path}.goals`, issues, validateStringValue);
}

function validateProducts(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  validateNamedStringCollections(value, path, ["products", "services", "features", "platforms"], issues);
}

function validateTechnicalLandscape(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  validateNamedStringCollections(value, path, ["frontend", "backend", "mobile", "apis", "repositories", "technologies", "infrastructure", "networks", "dependencies", "integrations"], issues);
}

function validateNamedStringCollections(value: unknown, path: string, keys: readonly string[], issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Collection group must be an object.");
  assertKnownKeysForValidation(value, keys, path, issues);
  for (const key of keys) validateCollectionValue(value[key], `${path}.${key}`, issues, validateStringValue);
}

function validateScalarValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[], kind: "string" | "projectType") {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Scalar projection must be an object.");
  assertKnownKeysForValidation(value, ["value", "factIds"], path, issues);
  validateStringArray(value.factIds, `${path}.factIds`, issues);
  if (Array.isArray(value.factIds)) validateUniqueReferences(value.factIds, `${path}.factIds`, issues);
  if (value.value === null) return;
  if (kind === "string") validateStringValue(value.value, `${path}.value`, issues);
  else validateEnum(value.value, PROJECT_TYPES, `${path}.value`, issues);
}

function validateCollectionValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[], memberValidator: (value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) => void) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Collection projection must be an object.");
  assertKnownKeysForValidation(value, ["value", "factIds"], path, issues);
  validateStringArray(value.factIds, `${path}.factIds`, issues);
  if (Array.isArray(value.factIds)) validateUniqueReferences(value.factIds, `${path}.factIds`, issues);
  if (!Array.isArray(value.value)) return addIssue(issues, `${path}.value`, "invalid_type", "Collection projection value must be an array.");
  value.value.forEach((member, index) => memberValidator(member, `${path}.value[${index}]`, issues));
}

function validateContactValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Contact must be an object.");
  assertKnownKeysForValidation(value, ["kind", "value", "label"], path, issues);
  validateEnum(value.kind, ["email", "phone", "endpoint"] as const, `${path}.kind`, issues);
  validateRequiredText(value.value, `${path}.value`, issues);
  validateOptionalText(value.label, `${path}.label`, issues);
}

function validateIdentifierValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Identifier must be an object.");
  assertKnownKeysForValidation(value, ["kind", "value", "label"], path, issues);
  validateEnum(value.kind, ["package", "application", "network", "contract-address", "repository", "other"] as const, `${path}.kind`, issues);
  validateRequiredText(value.value, `${path}.value`, issues);
  validateOptionalText(value.label, `${path}.label`, issues);
}

function validateResourceLocator(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Resource locator must be an object.");
  assertKnownKeysForValidation(value, ["kind", "value"], path, issues);
  validateEnum(value.kind, ["url", "email", "phone", "identifier"] as const, `${path}.kind`, issues);
  validateRequiredText(value.value, `${path}.value`, issues);
}

function validateEvidenceProvenance(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Evidence provenance must be an object.");
  assertKnownKeysForValidation(value, ["origin", "declaredBy", "discoveredFromEvidenceRefId"], path, issues);
  validateEnum(value.origin, EVIDENCE_ORIGINS, `${path}.origin`, issues);
  validateEnum(value.declaredBy, ["operator", "discovery", "system"] as const, `${path}.declaredBy`, issues);
  validateOptionalText(value.discoveredFromEvidenceRefId, `${path}.discoveredFromEvidenceRefId`, issues);
}

function validateEvidenceQualification(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Evidence qualification must be an object.");
  assertKnownKeysForValidation(value, ["status", "reason", "capability", "qualifiedAt"], path, issues);
  validateEnum(value.status, ["qualified", "unqualified"] as const, `${path}.status`, issues);
  if (value.status === "qualified") {
    validateEnum(value.capability, ["authoritative-first-party", "authoritative-official-upload", "authoritative-connected-source"] as const, `${path}.capability`, issues);
    validateRequiredText(value.qualifiedAt, `${path}.qualifiedAt`, issues);
  } else {
    validateEnum(value.reason, ["operator-only", "unknown-external", "discovered-external", "insufficient", "unsupported"] as const, `${path}.reason`, issues);
  }
}

function normalizeClaimScopes(value: readonly unknown[]): readonly ProjectEvidenceClaimScope[] {
  const seen = new Set<string>();
  const scopes: ProjectEvidenceClaimScope[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.key !== "string") continue;
    const normalizedValue = normalizeProjectFactValue(requireFactValue(entry.normalizedValue, "EvidenceRef.claimScopes.normalizedValue"));
    const scope = { key: normalizeProjectIntelligenceText(entry.key, 160), normalizedValue };
    const identity = `${scope.key}|${projectMembershipKey(scope.normalizedValue)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    scopes.push(scope);
  }
  return scopes;
}

function validateClaimScopes(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!Array.isArray(value)) return addIssue(issues, path, "invalid_type", "Evidence claim scopes must be an array.");
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return addIssue(issues, `${path}[${index}]`, "invalid_type", "Evidence claim scope must be an object.");
    assertKnownKeysForValidation(entry, ["key", "normalizedValue"], `${path}[${index}]`, issues);
    validateBoundedText(entry.key, `${path}[${index}].key`, 160, issues);
    validateFactValue(entry.normalizedValue, `${path}[${index}].normalizedValue`, issues);
    if (typeof entry.key === "string" && isProjectFactValue(entry.normalizedValue)) {
      const identity = `${entry.key}|${projectMembershipKey(entry.normalizedValue)}`;
      if (seen.has(identity)) addIssue(issues, `${path}[${index}]`, "duplicate_reference", "Evidence claim scopes must be unique.");
      seen.add(identity);
    }
  });
}

function validateFactEvidence(fact: ProjectFact, evidence: readonly EvidenceRef[] | undefined, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!evidence) {
    if (fact.verification === "verified") addIssue(issues, `${path}.${fact.id}.verification`, "unsupported_verification", "A verified fact requires resolvable supporting evidence.");
    return;
  }
  validateClaimVerification(fact.verification, fact.evidence, evidence, `${path}.${fact.id}`, issues, fact.key, fact.normalizedValue);
}

function validateResourceEvidence(resource: OfficialResource, evidence: readonly EvidenceRef[] | undefined, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!evidence) {
    if (resource.verification === "verified") addIssue(issues, `${path}.${resource.id}.verification`, "unsupported_verification", "A verified resource requires resolvable supporting evidence.");
    return;
  }
  validateClaimVerification(resource.verification, resource.evidence, evidence, `${path}.${resource.id}`, issues, `resource:${resource.category}`, normalizeProjectFactValue(resource.locator));
  if (resource.origin.evidenceRefId) validateEvidenceReferences([resource.origin.evidenceRefId], evidence, `${path}.${resource.id}.origin.evidenceRefId`, issues);
}

function validateClaimVerification(verification: ProjectVerificationState, claimEvidence: readonly ProjectClaimEvidence[], evidence: readonly EvidenceRef[], path: string, issues: ProjectIntelligenceValidationIssue[], claimKey?: string, normalizedValue?: ProjectFactValue) {
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  for (const [index, relation] of claimEvidence.entries()) {
    const referenced = byId.get(relation.evidenceRefId);
    if (!referenced) {
      addIssue(issues, `${path}.evidence[${index}].evidenceRefId`, "missing_reference", "Claim evidence must reference an existing EvidenceRef.");
      continue;
    }
  }
  if (verification !== "verified") return;
  const qualifyingSupport = claimEvidence.find((relation) => relation.relation === "supports" && isEvidenceQualificationEligible(byId.get(relation.evidenceRefId)));
  if (!qualifyingSupport) {
    addIssue(issues, `${path}.verification`, "unsupported_verification", "Verified claims require at least one qualifying supporting EvidenceRef.");
    return;
  }
  const supportingEvidence = byId.get(qualifyingSupport.evidenceRefId);
  if (!claimKey || normalizedValue === undefined || !isEvidenceClaimScopeCompatible(supportingEvidence, claimKey, normalizedValue)) {
    addIssue(issues, `${path}.verification`, "unsupported_verification", "Verified claims require qualifying evidence scoped to the exact canonical claim.");
  }
}

export function isEvidenceClaimScopeCompatible(
  evidence: Pick<EvidenceRef, "claimScopes"> | undefined,
  claimKey: string,
  normalizedValue: ProjectFactValue
) {
  const expected = projectMembershipKey(normalizeProjectFactValue(normalizedValue));
  return Boolean(evidence?.claimScopes?.some((scope) => scope.key === claimKey && projectMembershipKey(scope.normalizedValue) === expected));
}

function validatePackProjections(pack: ProjectIntelligencePack, facts: readonly ProjectFact[], issues: ProjectIntelligenceValidationIssue[]) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  validateScalarProjection(pack.identity.projectName, byId, "pack.identity.projectName", issues);
  validateScalarProjection(pack.identity.displayName, byId, "pack.identity.displayName", issues);
  validateScalarProjection(pack.identity.organizationName, byId, "pack.identity.organizationName", issues);
  validateScalarProjection(pack.identity.description, byId, "pack.identity.description", issues);
  validateScalarProjection(pack.identity.projectType, byId, "pack.identity.projectType", issues);
  validateScalarProjection(pack.overview.whatItDoes, byId, "pack.overview.whatItDoes", issues);
  validateScalarProjection(pack.overview.businessContext, byId, "pack.overview.businessContext", issues);
  validateCollectionProjection(pack.overview.primaryAudience, byId, "pack.overview.primaryAudience", issues);
  validateCollectionProjection(pack.overview.goals, byId, "pack.overview.goals", issues);

  for (const [key, projection] of Object.entries(pack.products)) validateCollectionProjection(projection, byId, `pack.products.${key}`, issues);
  for (const [key, projection] of Object.entries(pack.technicalLandscape)) validateCollectionProjection(projection, byId, `pack.technicalLandscape.${key}`, issues);
  validateCollectionProjection(pack.contacts, byId, "pack.contacts", issues);
  validateCollectionProjection(pack.identifiers, byId, "pack.identifiers", issues);
}

function validateScalarProjection<T>(projection: ProjectScalarValue<T>, facts: ReadonlyMap<string, ProjectFact>, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const referenced = referencedFacts(projection.factIds, facts, path, issues);
  if (projection.value === null) {
    if (projection.factIds.length > 0) addIssue(issues, `${path}.factIds`, "inconsistent_projection", "A null scalar projection cannot reference canonical facts.");
    return;
  }
  if (projection.factIds.length === 0) {
    addIssue(issues, `${path}.factIds`, "inconsistent_projection", "A non-null scalar projection must reference canonical facts.");
    return;
  }
  const projectedKey = projectMembershipKey(normalizeProjectionValue(projection.value));
  for (const fact of referenced) {
    const members = factNormalizedMembers(fact);
    if (members.length !== 1 || projectMembershipKey(members[0]) !== projectedKey) {
      addIssue(issues, path, "inconsistent_projection", "Scalar projections must agree with every referenced canonical fact.");
      break;
    }
  }
}

function validateCollectionProjection<T>(projection: ProjectCollectionValue<T>, facts: ReadonlyMap<string, ProjectFact>, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const referenced = referencedFacts(projection.factIds, facts, path, issues);
  const projectedKeys = new Set<string>();
  for (const [index, member] of projection.value.entries()) {
    const key = projectMembershipKey(normalizeProjectionValue(member));
    if (projectedKeys.has(key)) addIssue(issues, `${path}.value[${index}]`, "inconsistent_projection", "Collection projections must not contain duplicate normalized members.");
    projectedKeys.add(key);
  }
  const supportedKeys = new Set(referenced.flatMap((fact) => factNormalizedMembers(fact).map(projectMembershipKey)));
  for (const [index, member] of projection.value.entries()) {
    if (!supportedKeys.has(projectMembershipKey(normalizeProjectionValue(member)))) addIssue(issues, `${path}.value[${index}]`, "inconsistent_projection", "Collection projections cannot introduce members unsupported by referenced canonical facts.");
  }
  if (projection.factIds.length > 0 && !sameMembership(projectedKeys, supportedKeys)) addIssue(issues, path, "inconsistent_projection", "Collection projections must represent the complete normalized membership of their referenced canonical facts.");
  if (projection.factIds.length === 0 && projection.value.length > 0) addIssue(issues, `${path}.factIds`, "inconsistent_projection", "A non-empty collection projection must reference canonical facts.");
}

function referencedFacts(ids: readonly string[], facts: ReadonlyMap<string, ProjectFact>, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const referenced: ProjectFact[] = [];
  for (const [index, id] of ids.entries()) {
    const fact = facts.get(id);
    if (!fact) addIssue(issues, `${path}.factIds[${index}]`, "missing_reference", "Projection fact reference does not resolve.");
    else referenced.push(fact);
  }
  return referenced;
}

function factNormalizedMembers(fact: ProjectFact): ProjectFactValue[] {
  const normalized = fact.normalizedValue;
  return Array.isArray(normalized) ? [...normalized] : [normalized];
}

function sameMembership(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const member of left) if (!right.has(member)) return false;
  return true;
}

function validateFactReferences(ids: readonly string[], facts: readonly ProjectFact[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const knownIds = new Set(facts.map((fact) => fact.id));
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) addIssue(issues, `${path}[${index}]`, "missing_reference", "Fact reference does not resolve.");
  });
}

function validatePackState(pack: ProjectIntelligencePack, facts: readonly ProjectFact[], evidence: readonly EvidenceRef[], resources: readonly OfficialResource[], issues: ProjectIntelligenceValidationIssue[]) {
  const hasMeaningfulContent = facts.length > 0 || evidence.length > 0 || resources.length > 0 || pack.unknowns.length > 0 || pack.conflicts.length > 0 || projectionHasContent(pack);
  const hasUsableIntelligence = facts.length > 0 || resources.length > 0 || projectionHasContent(pack);
  if (pack.state === "empty" && hasMeaningfulContent) addIssue(issues, "pack.state", "invalid_value", "A pack with content cannot be empty.");
  if (pack.state === "ready" && !hasUsableIntelligence) addIssue(issues, "pack.state", "invalid_value", "A ready pack must contain at least one canonical fact, resource, or populated projection.");
}

function projectionHasContent(pack: ProjectIntelligencePack) {
  const scalars = [pack.identity.projectName, pack.identity.displayName, pack.identity.organizationName, pack.identity.description, pack.identity.projectType, pack.overview.whatItDoes, pack.overview.businessContext];
  const collections = [
    ...Object.values(pack.products),
    ...Object.values(pack.technicalLandscape),
    pack.overview.primaryAudience,
    pack.overview.goals,
    pack.contacts,
    pack.identifiers
  ];
  return scalars.some((projection) => projection.value !== null) || collections.some((projection) => projection.value.length > 0);
}

function validateSourceCoverage(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Source coverage must be an object.");
  assertKnownKeysForValidation(value, ["sourceIds", "evidenceRefIds", "coveredFactIds", "uncoveredAreas"], path, issues);
  validateStringArray(value.sourceIds, `${path}.sourceIds`, issues);
  validateStringArray(value.evidenceRefIds, `${path}.evidenceRefIds`, issues);
  validateStringArray(value.coveredFactIds, `${path}.coveredFactIds`, issues);
  validateStringArray(value.uncoveredAreas, `${path}.uncoveredAreas`, issues);
  if (Array.isArray(value.sourceIds)) validateUniqueReferences(value.sourceIds, `${path}.sourceIds`, issues);
  if (Array.isArray(value.evidenceRefIds)) validateUniqueReferences(value.evidenceRefIds, `${path}.evidenceRefIds`, issues);
  if (Array.isArray(value.coveredFactIds)) validateUniqueReferences(value.coveredFactIds, `${path}.coveredFactIds`, issues);
}

function validatePackProvenance(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Pack provenance must be an object.");
  assertKnownKeysForValidation(value, ["generatedBy", "sourceIds", "generationId"], path, issues);
  validateEnum(value.generatedBy, ["operator", "discovery", "system"] as const, `${path}.generatedBy`, issues);
  validateStringArray(value.sourceIds, `${path}.sourceIds`, issues);
  if (Array.isArray(value.sourceIds)) validateUniqueReferences(value.sourceIds, `${path}.sourceIds`, issues);
  validateOptionalText(value.generationId, `${path}.generationId`, issues);
}

function validateGeneration(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Generation metadata must be an object.");
  assertKnownKeysForValidation(value, ["id", "createdAt", "method"], path, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
  validateRequiredText(value.createdAt, `${path}.createdAt`, issues);
  validateEnum(value.method, ["operator", "discovery", "system"] as const, `${path}.method`, issues);
}

function validateConflictSubject(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Conflict subject must be an object.");
  assertKnownKeysForValidation(value, ["kind", "id"], path, issues);
  validateEnum(value.kind, ["fact", "resource"] as const, `${path}.kind`, issues);
  validateRequiredText(value.id, `${path}.id`, issues);
}

function validateClaimEvidence(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!Array.isArray(value)) return addIssue(issues, path, "invalid_type", "Claim evidence must be an array.");
  const evidenceRefIds: string[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return addIssue(issues, `${path}[${index}]`, "invalid_type", "Claim evidence must be an object.");
    assertKnownKeysForValidation(entry, ["evidenceRefId", "relation"], `${path}[${index}]`, issues);
    validateRequiredText(entry.evidenceRefId, `${path}[${index}].evidenceRefId`, issues);
    validateEnum(entry.relation, ["supports", "contradicts", "context"] as const, `${path}[${index}].relation`, issues);
    if (typeof entry.evidenceRefId === "string") evidenceRefIds.push(entry.evidenceRefId);
  });
  validateUniqueReferences(evidenceRefIds, path, issues);
}

function validateFactProvenance(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Fact provenance must be an object.");
  assertKnownKeysForValidation(value, ["origin", "declaredBy"], path, issues);
  validateEnum(value.origin, EVIDENCE_ORIGINS, `${path}.origin`, issues);
  validateEnum(value.declaredBy, ["operator", "discovery", "system"] as const, `${path}.declaredBy`, issues);
}

function validateResourceOrigin(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!isRecord(value)) return addIssue(issues, path, "invalid_type", "Resource origin metadata must be an object.");
  assertKnownKeysForValidation(value, ["discoveredBy", "origin", "sourceId", "evidenceRefId"], path, issues);
  validateEnum(value.discoveredBy, ["operator", "discovery", "system"] as const, `${path}.discoveredBy`, issues);
  validateEnum(value.origin, EVIDENCE_ORIGINS, `${path}.origin`, issues);
  validateOptionalText(value.sourceId, `${path}.sourceId`, issues);
  validateOptionalText(value.evidenceRefId, `${path}.evidenceRefId`, issues);
}

function validateEventPayload(value: Record<string, unknown>, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) addIssue(issues, `${path}.${key}`, "secret_field", "Discovery event payloads cannot contain credential or secret fields.");
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") continue;
    if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) continue;
    addIssue(issues, `${path}.${key}`, "invalid_type", "Discovery event payload values must be scalar values or string arrays.");
  }
}

function validateFactValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) addIssue(issues, path, "invalid_value", "Fact numbers must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateFactValue(entry, `${path}[${index}]`, issues));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) addIssue(issues, `${path}.${key}`, "secret_field", "Project facts cannot contain credential or secret fields.");
      validateFactValue(entry, `${path}.${key}`, issues);
    }
    return;
  }
  addIssue(issues, path, "invalid_type", "Fact values must be JSON-compatible values.");
}

function validateFactNormalizedValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  validateFactValue(value, path, issues);
}

function validateFactNormalizedConsistency(value: unknown, normalizedValue: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (Array.isArray(value)) {
    if (!Array.isArray(normalizedValue)) {
      addIssue(issues, path, "inconsistent_projection", "Array-valued facts must use an array normalizedValue.");
      return;
    }
    const expected = new Set(value.map((entry) => projectMembershipKey(entry)));
    const actual = new Set(normalizedValue.map((entry) => projectMembershipKey(entry)));
    if (!sameMembership(expected, actual)) addIssue(issues, path, "inconsistent_projection", "Fact normalizedValue must represent the canonical fact value.");
    return;
  }
  if (projectMembershipKey(canonicalFactMember(value as ProjectFactValue)) !== projectMembershipKey(normalizedValue)) addIssue(issues, path, "inconsistent_projection", "Fact normalizedValue must represent the canonical fact value.");
}

function validateStringArray(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!Array.isArray(value)) return addIssue(issues, path, "invalid_type", "Expected an array of strings.");
  value.forEach((entry, index) => validateStringValue(entry, `${path}[${index}]`, issues));
}

function validateStringValue(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (typeof value !== "string" || !value.trim()) addIssue(issues, path, "invalid_type", "Expected a non-empty string.");
}

function validateRequiredText(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  validateStringValue(value, path, issues);
}

function validateOptionalText(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (value !== undefined) validateStringValue(value, path, issues);
}

function validateBoundedText(value: unknown, path: string, maxLength: number, issues: ProjectIntelligenceValidationIssue[], optional = false) {
  if (value === undefined && optional) return;
  validateStringValue(value, path, issues);
  if (typeof value === "string" && value.length > maxLength) addIssue(issues, path, "invalid_value", `Text exceeds the ${maxLength}-character bound.`);
  if (typeof value === "string" && value.includes(REDACTED_MARKER)) return;
}

function validateBoolean(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (typeof value !== "boolean") addIssue(issues, path, "invalid_type", "Expected a boolean.");
}

function validateNonNegativeInteger(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) addIssue(issues, path, "invalid_value", "Expected a non-negative integer.");
}

function validateSchemaVersion(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (value !== PROJECT_INTELLIGENCE_SCHEMA_VERSION) addIssue(issues, path, "invalid_value", "Unsupported Project Intelligence schema version.");
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (!allowed.includes(value as T)) addIssue(issues, path, "invalid_value", `Unsupported value: ${String(value)}.`);
}

function validateOptionalEnum<T extends string>(value: unknown, allowed: readonly T[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  if (value !== undefined) validateEnum(value, allowed, path, issues);
}

function validateArray(value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[], itemValidator: (value: unknown, path: string, issues: ProjectIntelligenceValidationIssue[]) => void) {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type", "Expected an array.");
    return [];
  }
  value.forEach((entry, index) => itemValidator(entry, `${path}[${index}]`, issues));
  return value;
}

function validateEvidenceReferences(ids: readonly string[], evidence: readonly EvidenceRef[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const knownIds = new Set(evidence.map((entry) => entry.id));
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) addIssue(issues, `${path}[${index}]`, "missing_reference", "Evidence reference does not resolve.");
  });
}

function validateUniqueObjectIds<T extends { id: string }>(items: readonly T[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) addIssue(issues, `${path}[${index}].id`, "duplicate_id", "Canonical object IDs must be unique within their collection.");
    seen.add(item.id);
  });
}

function validateUniqueReferences(ids: readonly string[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) addIssue(issues, `${path}[${index}]`, "duplicate_reference", "Reference IDs must be unique within a normalized reference list.");
    seen.add(id);
  });
}

function validateEvidenceLineage(evidence: readonly EvidenceRef[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const byId = new Map(evidence.map((entry) => [entry.id, entry]));
  const indexById = new Map(evidence.map((entry, index) => [entry.id, index]));
  const parentById = new Map<string, string>();
  for (const [index, entry] of evidence.entries()) {
    const parentId = entry.provenance.discoveredFromEvidenceRefId;
    if (!parentId) continue;
    if (!byId.has(parentId)) {
      addIssue(issues, `${path}[${index}].provenance.discoveredFromEvidenceRefId`, "missing_reference", "Evidence lineage must reference an existing EvidenceRef.");
      continue;
    }
    if (parentId === entry.id) {
      addIssue(issues, `${path}[${index}].provenance.discoveredFromEvidenceRefId`, "provenance_cycle", "Evidence lineage cannot reference itself.");
      continue;
    }
    parentById.set(entry.id, parentId);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      if (!reported.has(id)) {
        const index = indexById.get(id);
        if (index !== undefined) addIssue(issues, `${path}[${index}].provenance.discoveredFromEvidenceRefId`, "provenance_cycle", "Evidence lineage cannot contain cycles.");
        reported.add(id);
      }
      return;
    }
    visiting.add(id);
    const parentId = parentById.get(id);
    if (parentId) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const entry of evidence) visit(entry.id);
}

function validateSourceCoverageRelationships(
  pack: ProjectIntelligencePack,
  facts: readonly ProjectFact[],
  evidence: readonly EvidenceRef[],
  resources: readonly OfficialResource[],
  conflicts: readonly ProjectConflict[],
  issues: ProjectIntelligenceValidationIssue[]
) {
  const sourceIds = new Set(pack.sourceCoverage.sourceIds);
  const coveredEvidenceIds = new Set(pack.sourceCoverage.evidenceRefIds);
  const coveredFactIds = new Set(pack.sourceCoverage.coveredFactIds);
  const checkSource = (sourceId: string, path: string) => {
    if (!sourceIds.has(sourceId)) addIssue(issues, path, "missing_reference", "Source ID must be present in sourceCoverage.sourceIds.");
  };
  const checkCoveredEvidence = (evidenceRefId: string, path: string) => {
    if (!coveredEvidenceIds.has(evidenceRefId)) addIssue(issues, path, "inconsistent_projection", "Referenced evidence must be included in sourceCoverage.evidenceRefIds.");
  };
  const checkCoveredFact = (factId: string, path: string) => {
    if (!coveredFactIds.has(factId)) addIssue(issues, path, "inconsistent_projection", "Referenced canonical facts must be included in sourceCoverage.coveredFactIds.");
  };

  for (const [index, entry] of evidence.entries()) checkSource(entry.sourceId, `pack.evidence[${index}].sourceId`);
  for (const [index, fact] of facts.entries()) {
    fact.sourceIds.forEach((sourceId) => checkSource(sourceId, `pack.facts[${index}].sourceIds`));
    fact.evidence.forEach((relation, relationIndex) => {
      checkCoveredEvidence(relation.evidenceRefId, `pack.facts[${index}].evidence[${relationIndex}].evidenceRefId`);
    });
  }
  for (const [index, resource] of resources.entries()) {
    if (resource.origin.sourceId) checkSource(resource.origin.sourceId, `pack.officialResources[${index}].origin.sourceId`);
    if (resource.origin.evidenceRefId) checkCoveredEvidence(resource.origin.evidenceRefId, `pack.officialResources[${index}].origin.evidenceRefId`);
    resource.evidence.forEach((relation, relationIndex) => {
      checkCoveredEvidence(relation.evidenceRefId, `pack.officialResources[${index}].evidence[${relationIndex}].evidenceRefId`);
    });
  }
  for (const [index, conflict] of conflicts.entries()) {
    conflict.subjects.forEach((subject, subjectIndex) => {
      if (subject.kind === "fact") checkCoveredFact(subject.id, `pack.conflicts[${index}].subjects[${subjectIndex}].id`);
    });
    conflict.evidenceRefIds.forEach((evidenceRefId, evidenceIndex) => checkCoveredEvidence(evidenceRefId, `pack.conflicts[${index}].evidenceRefIds[${evidenceIndex}]`));
  }
  for (const [index, sourceId] of pack.provenance.sourceIds.entries()) checkSource(sourceId, `pack.provenance.sourceIds[${index}]`);
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], typeName: string) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${typeName} contains unsupported field: ${key}.`);
  }
}

function assertKnownKeysForValidation(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ProjectIntelligenceValidationIssue[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) continue;
    addIssue(issues, `${path}.${key}`, SECRET_KEY.test(key) ? "secret_field" : "unknown_field", SECRET_KEY.test(key) ? "Credential or secret fields are not allowed in Project Intelligence objects." : "Unsupported Project Intelligence field.");
  }
}

function normalizeEvidenceProvenance(value: unknown): ProjectEvidenceProvenance {
  const record = requireRecord(value, "EvidenceRef.provenance");
  assertKnownKeys(record, ["origin", "declaredBy", "discoveredFromEvidenceRefId"], "EvidenceRef.provenance");
  return {
    origin: requireEnum(record.origin, EVIDENCE_ORIGINS, "EvidenceRef.provenance.origin"),
    declaredBy: requireEnum(record.declaredBy, ["operator", "discovery", "system"] as const, "EvidenceRef.provenance.declaredBy"),
    ...(optionalText(record.discoveredFromEvidenceRefId) ? { discoveredFromEvidenceRefId: String(record.discoveredFromEvidenceRefId) } : {})
  };
}

function normalizeEvidenceQualification(value: unknown): ProjectEvidenceQualification {
  const record = requireRecord(value, "EvidenceRef.qualification");
  assertKnownKeys(record, ["status", "reason", "capability", "qualifiedAt"], "EvidenceRef.qualification");
  const status = requireEnum(record.status, ["qualified", "unqualified"] as const, "EvidenceRef.qualification.status");
  if (status === "qualified") {
    return {
      status,
      capability: requireEnum(record.capability, ["authoritative-first-party", "authoritative-official-upload", "authoritative-connected-source"] as const, "EvidenceRef.qualification.capability"),
      qualifiedAt: requiredText(record.qualifiedAt, "EvidenceRef.qualification.qualifiedAt")
    };
  }
  return { status, reason: requireEnum(record.reason, ["operator-only", "unknown-external", "discovered-external", "insufficient", "unsupported"] as const, "EvidenceRef.qualification.reason") };
}

function normalizeFactProvenance(value: unknown): ProjectFactProvenance {
  const record = requireRecord(value, "ProjectFact.provenance");
  assertKnownKeys(record, ["origin", "declaredBy"], "ProjectFact.provenance");
  return {
    origin: requireEnum(record.origin, EVIDENCE_ORIGINS, "ProjectFact.provenance.origin"),
    declaredBy: requireEnum(record.declaredBy, ["operator", "discovery", "system"] as const, "ProjectFact.provenance.declaredBy")
  };
}

function normalizeClaimEvidence(value: unknown): ProjectClaimEvidence[] {
  if (!Array.isArray(value)) throw new Error("Claim evidence must be an array.");
  return value.map((entry, index) => {
    const record = requireRecord(entry, `claim evidence ${index}`);
    assertKnownKeys(record, ["evidenceRefId", "relation"], "ProjectClaimEvidence");
    return {
      evidenceRefId: requiredText(record.evidenceRefId, "ProjectClaimEvidence.evidenceRefId"),
      relation: requireEnum(record.relation, ["supports", "contradicts", "context"] as const, "ProjectClaimEvidence.relation")
    };
  });
}

function normalizeResourceLocator(value: unknown): OfficialResourceLocator {
  const record = requireRecord(value, "OfficialResource.locator");
  assertKnownKeys(record, ["kind", "value"], "OfficialResource.locator");
  return { kind: requireEnum(record.kind, ["url", "email", "phone", "identifier"] as const, "OfficialResource.locator.kind"), value: normalizeProjectIntelligenceText(requiredText(record.value, "OfficialResource.locator.value")) };
}

function normalizeResourceOrigin(value: unknown): OfficialResourceOrigin {
  const record = requireRecord(value, "OfficialResource.origin");
  assertKnownKeys(record, ["discoveredBy", "origin", "sourceId", "evidenceRefId"], "OfficialResource.origin");
  return {
    discoveredBy: requireEnum(record.discoveredBy, ["operator", "discovery", "system"] as const, "OfficialResource.origin.discoveredBy"),
    origin: requireEnum(record.origin, EVIDENCE_ORIGINS, "OfficialResource.origin.origin"),
    ...(optionalText(record.sourceId) ? { sourceId: String(record.sourceId) } : {}),
    ...(optionalText(record.evidenceRefId) ? { evidenceRefId: String(record.evidenceRefId) } : {})
  };
}

function normalizeConflictSubjects(value: unknown): ProjectConflictSubject[] {
  if (!Array.isArray(value)) throw new Error("ProjectConflict.subjects must be an array.");
  return value.map((entry) => {
    const record = requireRecord(entry, "ProjectConflict.subject");
    assertKnownKeys(record, ["kind", "id"], "ProjectConflict.subject");
    return { kind: requireEnum(record.kind, ["fact", "resource"] as const, "ProjectConflict.subject.kind"), id: requiredText(record.id, "ProjectConflict.subject.id") };
  });
}

function normalizeEventPayload(value: Record<string, unknown>): DiscoveryEventPayload {
  const result: Record<string, string | number | boolean | null | readonly string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`DiscoveryEvent.payload contains unsupported secret field: ${key}.`);
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") result[key] = typeof entry === "string" ? normalizeProjectIntelligenceText(entry, MAX_SUMMARY_LENGTH) : entry;
    else if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) result[key] = entry.map((item) => normalizeProjectIntelligenceText(item, MAX_SUMMARY_LENGTH));
    else throw new Error(`DiscoveryEvent.payload.${key} must be scalar or a string array.`);
  }
  return result;
}

function normalizeIdentity(value: unknown): ProjectIdentity {
  const record = requireRecord(value, "ProjectIntelligencePack.identity");
  assertKnownKeys(record, ["projectName", "displayName", "organizationName", "description", "projectType"], "ProjectIdentity");
  return {
    projectName: normalizeScalar(record.projectName),
    displayName: normalizeScalar(record.displayName),
    organizationName: normalizeScalar(record.organizationName),
    description: normalizeScalar(record.description),
    projectType: normalizeScalar(record.projectType)
  } as ProjectIdentity;
}

function normalizeOverview(value: unknown): ProjectOverview {
  const record = requireRecord(value, "ProjectIntelligencePack.overview");
  assertKnownKeys(record, ["whatItDoes", "primaryAudience", "businessContext", "goals"], "ProjectOverview");
  return { whatItDoes: normalizeScalar(record.whatItDoes), primaryAudience: normalizeCollection(record.primaryAudience), businessContext: normalizeScalar(record.businessContext), goals: normalizeCollection(record.goals) } as ProjectOverview;
}

function normalizeProducts(value: unknown): ProjectProducts {
  const record = requireRecord(value, "ProjectIntelligencePack.products");
  assertKnownKeys(record, ["products", "services", "features", "platforms"], "ProjectProducts");
  return { products: normalizeCollection(record.products), services: normalizeCollection(record.services), features: normalizeCollection(record.features), platforms: normalizeCollection(record.platforms) };
}

function normalizeTechnicalLandscape(value: unknown): ProjectTechnicalLandscape {
  const record = requireRecord(value, "ProjectIntelligencePack.technicalLandscape");
  const keys = ["frontend", "backend", "mobile", "apis", "repositories", "technologies", "infrastructure", "networks", "dependencies", "integrations"] as const;
  assertKnownKeys(record, keys, "ProjectTechnicalLandscape");
  return Object.fromEntries(keys.map((key) => [key, normalizeCollection(record[key])])) as ProjectTechnicalLandscape;
}

function normalizeScalar<T>(value: unknown): ProjectScalarValue<T> {
  const record = requireRecord(value, "ProjectScalarValue");
  assertKnownKeys(record, ["value", "factIds"], "ProjectScalarValue");
  return { value: record.value === null ? null : normalizeProjectionValue(record.value) as T, factIds: normalizeIds(record.factIds) };
}

function normalizeCollection<T>(value: unknown): ProjectCollectionValue<T> {
  const record = requireRecord(value, "ProjectCollectionValue");
  assertKnownKeys(record, ["value", "factIds"], "ProjectCollectionValue");
  if (!Array.isArray(record.value)) throw new Error("ProjectCollectionValue.value must be an array.");
  return normalizeProjectCollectionValue({ value: record.value as T[], factIds: normalizeIds(record.factIds) });
}

function normalizeSourceCoverage(value: unknown): ProjectSourceCoverage {
  const record = requireRecord(value, "ProjectIntelligencePack.sourceCoverage");
  assertKnownKeys(record, ["sourceIds", "evidenceRefIds", "coveredFactIds", "uncoveredAreas"], "ProjectSourceCoverage");
  return { sourceIds: normalizeIds(record.sourceIds), evidenceRefIds: normalizeIds(record.evidenceRefIds), coveredFactIds: normalizeIds(record.coveredFactIds), uncoveredAreas: normalizeStringArray(record.uncoveredAreas) };
}

function normalizePackProvenance(value: unknown): ProjectPackProvenance {
  const record = requireRecord(value, "ProjectIntelligencePack.provenance");
  assertKnownKeys(record, ["generatedBy", "sourceIds", "generationId"], "ProjectPackProvenance");
  return { generatedBy: requireEnum(record.generatedBy, ["operator", "discovery", "system"] as const, "ProjectPackProvenance.generatedBy"), sourceIds: normalizeIds(record.sourceIds), ...(optionalText(record.generationId) ? { generationId: String(record.generationId) } : {}) };
}

function normalizeGeneration(value: unknown): ProjectIntelligenceGeneration {
  const record = requireRecord(value, "ProjectIntelligencePack.generation");
  assertKnownKeys(record, ["id", "createdAt", "method"], "ProjectIntelligenceGeneration");
  return { id: requiredText(record.id, "ProjectIntelligenceGeneration.id"), createdAt: requiredText(record.createdAt, "ProjectIntelligenceGeneration.createdAt"), method: requireEnum(record.method, ["operator", "discovery", "system"] as const, "ProjectIntelligenceGeneration.method") };
}

function normalizeArray<T>(value: unknown, normalize: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Expected an array.");
  return value.map(normalize);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Expected an array of strings.");
  return value.map((entry) => normalizeProjectIntelligenceText(requiredText(entry, "string array entry")));
}

function normalizeIds(value: unknown): string[] {
  const ids = normalizeStringArray(value);
  return [...new Set(ids)];
}

function normalizeProjectionValue<T>(value: T): T {
  if (typeof value === "string") return normalizeProjectIntelligenceText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => normalizeProjectionValue(entry)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeProjectionValue(entry)])
    ) as T;
  }
  return value;
}

function canonicalFactNormalizedValue(value: ProjectFactValue): ProjectFactValue {
  if (Array.isArray(value)) return value.map((entry) => canonicalFactMember(entry));
  return canonicalFactMember(value);
}

function canonicalFactMember(value: ProjectFactValue): ProjectFactValue {
  if (typeof value === "string") return normalizeProjectIntelligenceText(value).toLocaleLowerCase();
  if (Array.isArray(value)) return value.map((entry) => canonicalFactMember(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalFactMember(entry)])
    );
  }
  return value;
}

function projectMembershipKey(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(normalizeProjectIntelligenceText(value).toLocaleLowerCase());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireFactValue(value: unknown, label: string): ProjectFactValue {
  if (value === undefined) throw new Error(`${label} is required.`);
  return value as ProjectFactValue;
}

function isProjectFactValue(value: unknown): value is ProjectFactValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isProjectFactValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => !SECRET_KEY.test(key) && isProjectFactValue(entry));
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function requireSchemaVersion(value: unknown, label: string) {
  if (value !== PROJECT_INTELLIGENCE_SCHEMA_VERSION) throw new Error(`${label} is unsupported.`);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${label} is unsupported.`);
  return value as T;
}

function requireEvidenceType(value: unknown): ProjectEvidenceType {
  return requireEnum(value, ["operator-declaration", "website", "documentation", "repository", "uploaded-document", "connected-record", "api-response", "social-profile", "contact-page", "other"] as const, "EvidenceRef.evidenceType");
}

function requiredResourceCategory(value: unknown): OfficialResourceCategory {
  return requireEnum(value, ["website", "application", "documentation", "repository", "social", "contact", "email", "whitepaper", "document", "api", "developer", "explorer", "support", "other"] as const, "OfficialResource.category");
}

function requireDiscoveryEventKind(value: unknown): DiscoveryEventKind {
  return requireEnum(value, ["source-accepted", "source-started", "homepage-fetch-started", "homepage-fetched", "robots-discovered", "sitemap-discovered", "page-discovered", "page-fetch-started", "page-fetched", "docs-discovered", "app-discovered", "repository-discovered", "social-discovered", "contact-discovered", "document-discovered", "fact-extracted", "resource-extracted", "conflict-detected", "intelligence-synthesis-started", "intelligence-ready", "warning", "source-partial", "source-failed", "cancelled"] as const, "DiscoveryEvent.kind");
}

function isConfidence(value: unknown): value is ProjectConfidence {
  return CONFIDENCE_VALUES.includes(value as ProjectConfidence);
}

function addIssue(issues: ProjectIntelligenceValidationIssue[], path: string, code: ProjectIntelligenceValidationIssue["code"], message: string) {
  issues.push({ path, code, message });
}

function result(issues: ProjectIntelligenceValidationIssue[]): ProjectIntelligenceValidation {
  return { valid: issues.length === 0, issues };
}

function resultFromIssues(issues: ProjectIntelligenceValidationIssue[]): ProjectIntelligenceValidation {
  return result(issues);
}

function assertValidOrThrow(validation: ProjectIntelligenceValidation) {
  if (!validation.valid) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
