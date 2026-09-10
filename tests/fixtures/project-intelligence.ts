import {
  createEmptyProjectIntelligencePack,
  type EvidenceRef,
  type OfficialResource,
  type ProjectConflict,
  type ProjectFact,
  type ProjectIntelligencePack,
  type ProjectType
} from "@/lib/agentos/domains/project-intelligence";

export type GoldenProjectExpectation = {
  name: string;
  projectType: ProjectType;
  requiredFactKeys: readonly string[];
  requiredFactValues: Readonly<Record<string, string>>;
  verifiedFactKeys: readonly string[];
  requiredResourceCategories: readonly OfficialResource["category"][];
  conflictSubjectIds: readonly string[];
  forbiddenFactCategories: readonly string[];
};

export type GoldenProjectFixture = {
  name: string;
  pack: ProjectIntelligencePack;
  facts: readonly ProjectFact[];
  evidence: readonly EvidenceRef[];
  resources: readonly OfficialResource[];
  conflicts: readonly ProjectConflict[];
  expectation: GoldenProjectExpectation;
};

const qualifiedFirstPartyWebsite = (id: string, sourceId: string, title: string, summary: string, locator: string): EvidenceRef => ({
  schemaVersion: 1,
  id,
  sourceId,
  canonicalLocator: locator,
  title,
  summary,
  evidenceType: "website",
  provenance: { origin: "first-party-website", declaredBy: "discovery" },
  qualification: { status: "qualified", capability: "authoritative-first-party", qualifiedAt: "2026-09-10T00:00:00.000Z" },
  confidence: "high"
});

const qualifiedFirstPartyDocumentation = (id: string, sourceId: string, title: string, summary: string, locator: string): EvidenceRef => ({
  schemaVersion: 1,
  id,
  sourceId,
  documentId: `${sourceId}-document`,
  canonicalLocator: locator,
  title,
  summary,
  evidenceType: "documentation",
  provenance: { origin: "first-party-documentation", declaredBy: "discovery" },
  qualification: { status: "qualified", capability: "authoritative-first-party", qualifiedAt: "2026-09-10T00:00:00.000Z" },
  confidence: "high"
});

const discoveredExternal = (id: string, sourceId: string, title: string, summary: string, locator: string): EvidenceRef => ({
  schemaVersion: 1,
  id,
  sourceId,
  canonicalLocator: locator,
  title,
  summary,
  evidenceType: "other",
  provenance: { origin: "discovered-external", declaredBy: "discovery" },
  qualification: { status: "unqualified", reason: "discovered-external" },
  confidence: "low"
});

function fact(input: {
  id: string;
  category: ProjectFact["category"];
  key: string;
  value: ProjectFact["value"];
  normalizedValue: string | readonly string[];
  statement: string;
  evidence: ProjectFact["evidence"];
  sourceIds: readonly string[];
  origin?: ProjectFact["provenance"]["origin"];
  verification?: ProjectFact["verification"];
}): ProjectFact {
  return {
    schemaVersion: 1,
    id: input.id,
    category: input.category,
    key: input.key,
    value: input.value,
    normalizedValue: input.normalizedValue,
    statement: input.statement,
    confidence: "high",
    verification: input.verification ?? "verified",
    evidence: input.evidence,
    sourceIds: input.sourceIds,
    provenance: { origin: input.origin ?? "first-party-website", declaredBy: "discovery" },
    observedAt: "2026-09-10T00:00:00.000Z",
    retrievedAt: "2026-09-10T00:00:00.000Z"
  };
}

function resource(input: {
  id: string;
  category: OfficialResource["category"];
  kind: OfficialResource["locator"]["kind"];
  value: string;
  label: string;
  evidence: OfficialResource["evidence"];
  origin: OfficialResource["origin"]["origin"];
  verification?: OfficialResource["verification"];
}): OfficialResource {
  return {
    schemaVersion: 1,
    id: input.id,
    category: input.category,
    locator: { kind: input.kind, value: input.value },
    label: input.label,
    evidence: input.evidence,
    confidence: "high",
    verification: input.verification ?? "verified",
    origin: { discoveredBy: "discovery", origin: input.origin }
  };
}

function conflict(id: string, subjects: ProjectConflict["subjects"], evidenceRefIds: readonly string[], summary: string): ProjectConflict {
  return {
    schemaVersion: 1,
    id,
    subjects,
    evidenceRefIds,
    summary,
    confidence: "medium",
    status: "open",
    detectedAt: "2026-09-10T00:00:00.000Z"
  };
}

function pack(input: {
  id: string;
  facts: readonly ProjectFact[];
  evidence: readonly EvidenceRef[];
  resources: readonly OfficialResource[];
  conflicts?: readonly ProjectConflict[];
  projectName: string;
  projectType: ProjectType;
  audience?: readonly string[];
  audienceFactIds?: readonly string[];
  sourceIds: readonly string[];
  unknowns?: readonly string[];
}): ProjectIntelligencePack {
  const base = createEmptyProjectIntelligencePack({ id: input.id, now: "2026-09-10T00:00:00.000Z" });
  return {
    ...base,
    state: "ready",
    identity: {
      ...base.identity,
      projectName: { value: input.projectName, factIds: ["fact-project-name"] },
      displayName: { value: input.projectName, factIds: ["fact-project-name"] },
      projectType: { value: input.projectType, factIds: ["fact-project-type"] }
    },
    overview: {
      ...base.overview,
      primaryAudience: { value: input.audience ?? [], factIds: input.audienceFactIds ?? [] }
    },
    officialResources: input.resources,
    facts: input.facts,
    evidence: input.evidence,
    unknowns: input.unknowns ?? [],
    conflicts: input.conflicts ?? [],
    sourceCoverage: {
      sourceIds: input.sourceIds,
      evidenceRefIds: input.evidence.map((entry) => entry.id),
      coveredFactIds: input.facts.map((entry) => entry.id),
      uncoveredAreas: input.unknowns ?? []
    },
    provenance: { generatedBy: "discovery", sourceIds: input.sourceIds, generationId: `${input.id}-generation` },
    generation: { id: `${input.id}-generation`, createdAt: "2026-09-10T00:00:00.000Z", method: "discovery" },
    updatedAt: "2026-09-10T00:00:00.000Z"
  };
}

const coinCollectEvidence = [
  qualifiedFirstPartyWebsite("cc-home", "coincollect-site", "CoinCollect homepage", "CoinCollect provides a self-custody asset dashboard.", "https://coincollect.test/"),
  qualifiedFirstPartyDocumentation("cc-docs", "coincollect-docs", "CoinCollect developer documentation", "The documentation identifies the supported network and contract.", "https://docs.coincollect.test/contracts"),
  discoveredExternal("cc-stale", "external-reference", "Historical CoinCollect listing", "A historical listing contains an older contract address.", "https://listing.invalid/coincollect")
] satisfies readonly EvidenceRef[];

const coinCollectFacts = [
  fact({ id: "fact-project-name", category: "identity", key: "projectName", value: "CoinCollect", normalizedValue: "coincollect", statement: "The project is named CoinCollect.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-project-type", category: "identity", key: "projectType", value: "web3", normalizedValue: "web3", statement: "CoinCollect is a Web3 project.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-audience", category: "overview", key: "primaryAudience", value: ["crypto users", "developers"], normalizedValue: ["crypto users", "developers"], statement: "CoinCollect serves crypto users and developers.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-contract", category: "identifier", key: "contractAddress", value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", normalizedValue: "0xabcdef0123456789abcdef0123456789abcdef01", statement: "CoinCollect publishes a public contract address.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-stale-contract", category: "identifier", key: "historicalContractAddress", value: "0x1111111111111111111111111111111111111111", normalizedValue: "0x1111111111111111111111111111111111111111", statement: "A historical external listing publishes a different contract address.", evidence: [{ evidenceRefId: "cc-stale", relation: "supports" }], sourceIds: ["external-reference"], origin: "discovered-external", verification: "discovered" })
] satisfies readonly ProjectFact[];

const coinCollectResources = [
  resource({ id: "cc-website", category: "website", kind: "url", value: "https://coincollect.test/", label: "CoinCollect website", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], origin: "first-party-website" }),
  resource({ id: "cc-doc-resource", category: "documentation", kind: "url", value: "https://docs.coincollect.test/", label: "CoinCollect documentation", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], origin: "first-party-documentation" }),
  resource({ id: "cc-stale-resource", category: "other", kind: "url", value: "https://listing.invalid/coincollect", label: "Historical listing", evidence: [{ evidenceRefId: "cc-stale", relation: "supports" }], origin: "discovered-external", verification: "discovered" })
] satisfies readonly OfficialResource[];

const coinCollectConflicts = [
  conflict("cc-contract-conflict", [{ kind: "fact", id: "fact-contract" }, { kind: "fact", id: "fact-stale-contract" }], ["cc-docs", "cc-stale"], "Current documentation and a historical external listing publish different contract addresses.")
] satisfies readonly ProjectConflict[];

const coinCollectPack = pack({
  id: "coincollect",
  projectName: "CoinCollect",
  projectType: "web3",
  audience: ["developers", "crypto users"],
  audienceFactIds: ["fact-audience"],
  facts: coinCollectFacts,
  evidence: coinCollectEvidence,
  resources: coinCollectResources,
  conflicts: coinCollectConflicts,
  sourceIds: ["coincollect-site", "coincollect-docs", "external-reference"],
  unknowns: ["Current infrastructure deployment details"]
});

const saasEvidence = [
  qualifiedFirstPartyWebsite("saas-home", "orbitdesk-site", "OrbitDesk homepage", "OrbitDesk helps support teams coordinate customer requests.", "https://orbitdesk.test/"),
  qualifiedFirstPartyDocumentation("saas-docs", "orbitdesk-docs", "OrbitDesk API documentation", "The documentation describes the public application and API surfaces.", "https://docs.orbitdesk.test/api")
] satisfies readonly EvidenceRef[];

const saasFacts = [
  fact({ id: "fact-project-name", category: "identity", key: "projectName", value: "OrbitDesk", normalizedValue: "orbitdesk", statement: "The project is named OrbitDesk.", evidence: [{ evidenceRefId: "saas-home", relation: "supports" }], sourceIds: ["orbitdesk-site"] }),
  fact({ id: "fact-project-type", category: "identity", key: "projectType", value: "saas", normalizedValue: "saas", statement: "OrbitDesk is a SaaS product.", evidence: [{ evidenceRefId: "saas-home", relation: "supports" }], sourceIds: ["orbitdesk-site"] }),
  fact({ id: "fact-saas-audience", category: "overview", key: "primaryAudience", value: ["support teams"], normalizedValue: ["support teams"], statement: "OrbitDesk serves support teams.", evidence: [{ evidenceRefId: "saas-home", relation: "supports" }], sourceIds: ["orbitdesk-site"] })
] satisfies readonly ProjectFact[];

const saasResources = [
  resource({ id: "saas-website", category: "website", kind: "url", value: "https://orbitdesk.test/", label: "OrbitDesk website", evidence: [{ evidenceRefId: "saas-home", relation: "supports" }], origin: "first-party-website" }),
  resource({ id: "saas-docs-resource", category: "documentation", kind: "url", value: "https://docs.orbitdesk.test/", label: "OrbitDesk documentation", evidence: [{ evidenceRefId: "saas-docs", relation: "supports" }], origin: "first-party-documentation" })
] satisfies readonly OfficialResource[];

const saasPack = pack({ id: "orbitdesk", projectName: "OrbitDesk", projectType: "saas", audience: ["support teams"], audienceFactIds: ["fact-saas-audience"], facts: saasFacts, evidence: saasEvidence, resources: saasResources, sourceIds: ["orbitdesk-site", "orbitdesk-docs"] });

const docsEvidence = [
  qualifiedFirstPartyWebsite("docs-home", "riverkit-site", "RiverKit homepage", "RiverKit is an open-source data ingestion toolkit.", "https://riverkit.test/"),
  qualifiedFirstPartyDocumentation("docs-api", "riverkit-docs", "RiverKit API reference", "The API reference documents the ingestion and adapter interfaces.", "https://docs.riverkit.test/api"),
  qualifiedFirstPartyDocumentation("docs-repository", "riverkit-repo", "RiverKit repository", "The repository contains the canonical implementation and contribution guide.", "https://github.com/riverkit/riverkit")
] satisfies readonly EvidenceRef[];

const docsFacts = [
  fact({ id: "fact-project-name", category: "identity", key: "projectName", value: "RiverKit", normalizedValue: "riverkit", statement: "The project is named RiverKit.", evidence: [{ evidenceRefId: "docs-home", relation: "supports" }], sourceIds: ["riverkit-site"] }),
  fact({ id: "fact-project-type", category: "identity", key: "projectType", value: "open-source", normalizedValue: "open-source", statement: "RiverKit is open-source software.", evidence: [{ evidenceRefId: "docs-repository", relation: "supports" }], sourceIds: ["riverkit-repo"] }),
  fact({ id: "fact-docs-audience", category: "overview", key: "primaryAudience", value: ["developers", "data teams"], normalizedValue: ["developers", "data teams"], statement: "RiverKit serves developers and data teams.", evidence: [{ evidenceRefId: "docs-api", relation: "supports" }], sourceIds: ["riverkit-docs"] })
] satisfies readonly ProjectFact[];

const docsResources = [
  resource({ id: "docs-website", category: "website", kind: "url", value: "https://riverkit.test/", label: "RiverKit website", evidence: [{ evidenceRefId: "docs-home", relation: "supports" }], origin: "first-party-website" }),
  resource({ id: "docs-api-resource", category: "api", kind: "url", value: "https://docs.riverkit.test/api", label: "RiverKit API reference", evidence: [{ evidenceRefId: "docs-api", relation: "supports" }], origin: "first-party-documentation" }),
  resource({ id: "docs-repository-resource", category: "repository", kind: "url", value: "https://github.com/riverkit/riverkit", label: "RiverKit repository", evidence: [{ evidenceRefId: "docs-repository", relation: "supports" }], origin: "first-party-repository" })
] satisfies readonly OfficialResource[];

export const goldenProjectFixtures: readonly GoldenProjectFixture[] = [
  {
    name: "coincollect-web3",
    pack: coinCollectPack,
    facts: coinCollectFacts,
    evidence: coinCollectEvidence,
    resources: coinCollectResources,
    conflicts: coinCollectConflicts,
    expectation: {
      name: "CoinCollect",
      projectType: "web3",
      requiredFactKeys: ["projectName", "projectType", "primaryAudience", "contractAddress"],
      requiredFactValues: { projectName: "CoinCollect", projectType: "web3", contractAddress: "0xabcdef0123456789abcdef0123456789abcdef01" },
      verifiedFactKeys: ["projectName", "projectType", "primaryAudience", "contractAddress"],
      requiredResourceCategories: ["website", "documentation"],
      conflictSubjectIds: ["fact-contract", "fact-stale-contract"],
      forbiddenFactCategories: ["credential", "secret"]
    }
  },
  {
    name: "generic-saas",
    pack: saasPack,
    facts: saasFacts,
    evidence: saasEvidence,
    resources: saasResources,
    conflicts: [],
    expectation: {
      name: "OrbitDesk",
      projectType: "saas",
      requiredFactKeys: ["projectName", "projectType", "primaryAudience"],
      requiredFactValues: { projectName: "OrbitDesk", projectType: "saas" },
      verifiedFactKeys: ["projectName", "projectType", "primaryAudience"],
      requiredResourceCategories: ["website", "documentation"],
      conflictSubjectIds: [],
      forbiddenFactCategories: ["credential", "secret", "identifier"]
    }
  },
  {
    name: "documentation-heavy-software",
    pack: pack({ id: "riverkit", projectName: "RiverKit", projectType: "open-source", audience: ["data teams", "developers"], audienceFactIds: ["fact-docs-audience"], facts: docsFacts, evidence: docsEvidence, resources: docsResources, sourceIds: ["riverkit-site", "riverkit-docs", "riverkit-repo"], unknowns: ["Current hosted service availability"] }),
    facts: docsFacts,
    evidence: docsEvidence,
    resources: docsResources,
    conflicts: [],
    expectation: {
      name: "RiverKit",
      projectType: "open-source",
      requiredFactKeys: ["projectName", "projectType", "primaryAudience"],
      requiredFactValues: { projectName: "RiverKit", projectType: "open-source" },
      verifiedFactKeys: ["projectName", "projectType", "primaryAudience"],
      requiredResourceCategories: ["website", "api", "repository"],
      conflictSubjectIds: [],
      forbiddenFactCategories: ["credential", "secret"]
    }
  }
];
