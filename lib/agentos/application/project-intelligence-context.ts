import { createHash } from "node:crypto";

import type {
  EvidenceRef,
  OfficialResource,
  ProjectFact
} from "@/lib/agentos/domains/project-intelligence";
import { redactSecretText } from "@/lib/security/redaction";

export type ProjectIntelligenceContextLimits = {
  maxExcerpts: number;
  maxExcerptCharacters: number;
  maxTotalCharacters: number;
};

export const PROJECT_INTELLIGENCE_CONTEXT_LIMITS: ProjectIntelligenceContextLimits = {
  maxExcerpts: 10,
  maxExcerptCharacters: 2_000,
  maxTotalCharacters: 20_000
} as const;

export type ProjectIntelligenceContextExcerpt = {
  documentId: string;
  sourceId: string;
  title: string;
  classification: string;
  canonicalLocator?: string;
  excerpt: string;
  selectionKind: "root-surface" | "evidence-bearing" | "architecture-classification" | "operator-match" | "diversity";
  evidenceRefIds: readonly string[];
  factIds: readonly string[];
  resourceIds: readonly string[];
};

export type ProjectIntelligenceContextDocument = {
  documentId?: string;
  sourceId: string;
  title?: string;
  classification?: string;
  canonicalLocator?: string;
  content: string;
};

export function selectProjectIntelligenceContextExcerpts(input: {
  documents: readonly ProjectIntelligenceContextDocument[];
  evidence?: readonly EvidenceRef[];
  facts?: readonly ProjectFact[];
  resources?: readonly OfficialResource[];
  operatorText?: string;
  limits?: Partial<typeof PROJECT_INTELLIGENCE_CONTEXT_LIMITS>;
}): ProjectIntelligenceContextExcerpt[] {
  const limits = { ...PROJECT_INTELLIGENCE_CONTEXT_LIMITS, ...input.limits };
  const factByEvidenceId = new Map<string, string[]>();
  for (const fact of input.facts ?? []) {
    for (const relation of fact.evidence) {
      const ids = factByEvidenceId.get(relation.evidenceRefId) ?? [];
      ids.push(fact.id);
      factByEvidenceId.set(relation.evidenceRefId, ids);
    }
  }
  const resourceByEvidenceId = new Map<string, string[]>();
  for (const resource of input.resources ?? []) {
    for (const relation of resource.evidence) {
      const ids = resourceByEvidenceId.get(relation.evidenceRefId) ?? [];
      ids.push(resource.id);
      resourceByEvidenceId.set(relation.evidenceRefId, ids);
    }
  }
  const operatorTerms = tokenize(input.operatorText ?? "");
  const candidates = input.documents.map((document, index) => {
    const documentId = document.documentId?.trim() || `${document.sourceId}:document-${index + 1}`;
    const title = safeText(document.title || document.canonicalLocator || documentId, 160);
    const classification = safeText(document.classification || "other", 80).toLowerCase();
    const relatedEvidence = (input.evidence ?? []).filter((entry) => entry.documentId === document.documentId || entry.sourceId === document.sourceId && entry.canonicalLocator === document.canonicalLocator);
    const evidenceContent = relatedEvidence.map((entry) => entry.excerpt || entry.summary).filter(Boolean).join(" ");
    const content = safeText([evidenceContent, document.content].filter(Boolean).join(" "), limits.maxExcerptCharacters);
    const evidenceRefIds = relatedEvidence.map((entry) => entry.id).slice(0, 64);
    const factIds = unique(evidenceRefIds.flatMap((id) => factByEvidenceId.get(id) ?? [])).slice(0, 64);
    const resourceIds = unique(evidenceRefIds.flatMap((id) => resourceByEvidenceId.get(id) ?? [])).slice(0, 32);
    const searchable = `${title} ${classification} ${content}`.toLowerCase();
    const root = /^(?:home|homepage|root|index)$|home(?:page)?|^root\b/i.test(`${title} ${classification}`);
    const evidenceBearing = evidenceRefIds.length > 0 || factIds.length > 0 || resourceIds.length > 0;
    const architectureClass = /architecture|readme|developer|api|integration|product|feature|operations?|technical|documentation|docs?/i.test(`${title} ${classification}`);
    const operatorMatch = operatorTerms.some((term) => searchable.includes(term));
    const score = (evidenceBearing ? 100 : 0) + (root ? 40 : 0) + (architectureClass ? 30 : 0) + (operatorMatch ? 20 : 0) + Math.max(0, 10 - Math.min(index, 10));
    const selectionKind: ProjectIntelligenceContextExcerpt["selectionKind"] = evidenceBearing
      ? "evidence-bearing"
      : root
        ? "root-surface"
        : architectureClass
          ? "architecture-classification"
          : operatorMatch
            ? "operator-match"
            : "diversity";
    return { document, documentId, title, classification, content, evidenceRefIds, factIds, resourceIds, score, selectionKind, index };
  }).sort((left, right) => right.score - left.score || left.documentId.localeCompare(right.documentId) || left.index - right.index);

  const selected: ProjectIntelligenceContextExcerpt[] = [];
  const seenContent = new Set<string>();
  let totalCharacters = 0;
  for (const candidate of candidates) {
    if (selected.length >= limits.maxExcerpts) break;
    const contentKey = sha256(candidate.content.toLowerCase().replace(/\s+/g, " ").slice(0, 360));
    if (seenContent.has(contentKey)) continue;
    const excerpt = candidate.content.slice(0, limits.maxExcerptCharacters);
    if (!excerpt || totalCharacters + excerpt.length > limits.maxTotalCharacters) continue;
    seenContent.add(contentKey);
    selected.push({
      documentId: candidate.documentId,
      sourceId: candidate.document.sourceId,
      title: candidate.title,
      classification: candidate.classification,
      ...(safeCanonicalLocator(candidate.document.canonicalLocator) ? { canonicalLocator: safeCanonicalLocator(candidate.document.canonicalLocator) } : {}),
      excerpt,
      selectionKind: candidate.selectionKind,
      evidenceRefIds: candidate.evidenceRefIds,
      factIds: candidate.factIds,
      resourceIds: candidate.resourceIds
    });
    totalCharacters += excerpt.length;
  }
  return selected;
}

export function contextExcerptFingerprint(excerpts: readonly ProjectIntelligenceContextExcerpt[]) {
  return sha256(JSON.stringify(excerpts));
}

function tokenize(value: string) {
  return unique(value.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 4)).slice(0, 24);
}

function safeText(value: string, maxLength: number) {
  return redactSecretText(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeCanonicalLocator(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) if (/token|key|secret|auth|session|signature|code/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return `${url.protocol}//${url.host}${url.pathname || "/"}`.slice(0, 500);
  } catch {
    return undefined;
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
