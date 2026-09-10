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
  requiredFactValues: Readonly<Record<string, ProjectFact["value"]>>;
  verifiedFactKeys: readonly string[];
  requiredResourceCategories: readonly OfficialResource["category"][];
  requiredContactKinds?: readonly ProjectIntelligencePack["contacts"]["value"][number]["kind"][];
  requiredIdentifierKinds?: readonly ProjectIntelligencePack["identifiers"]["value"][number]["kind"][];
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

const qualifiedFirstPartyRepository = (id: string, sourceId: string, title: string, summary: string, locator: string): EvidenceRef => ({
  ...qualifiedFirstPartyWebsite(id, sourceId, title, summary, locator),
  evidenceType: "repository",
  provenance: { origin: "first-party-repository", declaredBy: "discovery" }
});

const qualifiedFirstPartyPage = (id: string, sourceId: string, title: string, summary: string, locator: string, evidenceType: EvidenceRef["evidenceType"]): EvidenceRef => ({
  ...qualifiedFirstPartyWebsite(id, sourceId, title, summary, locator),
  evidenceType
});

function fact(input: {
  id: string;
  category: ProjectFact["category"];
  key: string;
  value: ProjectFact["value"];
  normalizedValue: ProjectFact["normalizedValue"];
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
  sourceId?: string;
  evidenceRefId?: string;
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
    origin: {
      discoveredBy: "discovery",
      origin: input.origin,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.evidenceRefId ? { evidenceRefId: input.evidenceRefId } : {})
    }
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
  qualifiedFirstPartyWebsite("cc-home", "coincollect-site", "CoinCollect homepage", "CoinCollect provides a self-custody asset dashboard and repeats its wallet analytics message in the primary navigation.", "https://coincollect.test/"),
  qualifiedFirstPartyWebsite("cc-noisy", "coincollect-site", "CoinCollect marketing and navigation copy", "Repeated navigation and marketing copy describes the dashboard, wallet analytics, and on-chain activity views.", "https://coincollect.test/features"),
  qualifiedFirstPartyDocumentation("cc-docs", "coincollect-docs", "CoinCollect developer documentation", "The documentation identifies the supported network, public contract, API, and integration details.", "https://docs.coincollect.test/contracts"),
  qualifiedFirstPartyPage("cc-app", "coincollect-app", "CoinCollect application", "The public application locator is the CoinCollect asset dashboard.", "https://app.coincollect.test/", "website"),
  qualifiedFirstPartyPage("cc-contact", "coincollect-contact", "CoinCollect contact page", "The contact page publishes a public support email address.", "https://coincollect.test/contact", "contact-page"),
  qualifiedFirstPartyPage("cc-social", "coincollect-social", "CoinCollect official social profile", "The official social profile links back to CoinCollect and identifies the project account.", "https://social.coincollect.test/coincollect", "social-profile"),
  qualifiedFirstPartyRepository("cc-repo", "coincollect-repo", "CoinCollect repository", "The repository contains the public dashboard implementation and integration documentation.", "https://github.com/coincollect/coincollect"),
  discoveredExternal("cc-stale", "external-reference", "Historical CoinCollect listing", "A historical listing contains an older contract address.", "https://listing.invalid/coincollect")
] satisfies readonly EvidenceRef[];

const coinCollectFacts = [
  fact({ id: "fact-project-name", category: "identity", key: "projectName", value: "CoinCollect", normalizedValue: "coincollect", statement: "The project is named CoinCollect.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-project-type", category: "identity", key: "projectType", value: "web3", normalizedValue: "web3", statement: "CoinCollect is a Web3 project.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-description", category: "overview", key: "description", value: "CoinCollect is a self-custody asset dashboard for tracking on-chain holdings and activity.", normalizedValue: "coincollect is a self-custody asset dashboard for tracking on-chain holdings and activity.", statement: "CoinCollect describes a self-custody dashboard for on-chain asset visibility.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-audience", category: "overview", key: "primaryAudience", value: ["crypto users", "developers"], normalizedValue: ["crypto users", "developers"], statement: "CoinCollect serves crypto users and developers.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-goals", category: "overview", key: "goals", value: ["Track on-chain assets", "Review wallet activity"], normalizedValue: ["track on-chain assets", "review wallet activity"], statement: "CoinCollect helps users track on-chain assets and review wallet activity.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }, { evidenceRefId: "cc-noisy", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-product", category: "product", key: "products", value: "Self-custody asset dashboard", normalizedValue: "self-custody asset dashboard", statement: "CoinCollect provides a self-custody asset dashboard.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-features", category: "product", key: "features", value: ["Wallet analytics", "On-chain activity views"], normalizedValue: ["wallet analytics", "on-chain activity views"], statement: "CoinCollect includes wallet analytics and on-chain activity views.", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }, { evidenceRefId: "cc-noisy", relation: "supports" }], sourceIds: ["coincollect-site"] }),
  fact({ id: "fact-platform", category: "product", key: "platforms", value: "Web application", normalizedValue: "web application", statement: "CoinCollect is available as a web application.", evidence: [{ evidenceRefId: "cc-app", relation: "supports" }], sourceIds: ["coincollect-app"] }),
  fact({ id: "fact-frontend", category: "technical", key: "frontend", value: "Next.js", normalizedValue: "next.js", statement: "The CoinCollect application uses Next.js for its frontend.", evidence: [{ evidenceRefId: "cc-repo", relation: "supports" }], sourceIds: ["coincollect-repo"] }),
  fact({ id: "fact-backend", category: "technical", key: "backend", value: "Node.js API", normalizedValue: "node.js api", statement: "CoinCollect documents a Node.js API backend.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-api", category: "technical", key: "apis", value: "Public asset API", normalizedValue: "public asset api", statement: "CoinCollect documents a public asset API.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-repository", category: "technical", key: "repositories", value: "https://github.com/coincollect/coincollect", normalizedValue: "https://github.com/coincollect/coincollect", statement: "CoinCollect publishes a public repository.", evidence: [{ evidenceRefId: "cc-repo", relation: "supports" }], sourceIds: ["coincollect-repo"] }),
  fact({ id: "fact-technology", category: "technical", key: "technologies", value: "TypeScript", normalizedValue: "typescript", statement: "The CoinCollect repository uses TypeScript.", evidence: [{ evidenceRefId: "cc-repo", relation: "supports" }], sourceIds: ["coincollect-repo"] }),
  fact({ id: "fact-infrastructure", category: "technical", key: "infrastructure", value: "Managed cloud deployment", normalizedValue: "managed cloud deployment", statement: "CoinCollect documents a managed cloud deployment.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-network-name", category: "technical", key: "networks", value: "Ethereum", normalizedValue: "ethereum", statement: "CoinCollect runs on Ethereum.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-network", category: "identifier", key: "networkIdentifier", value: { kind: "network", value: "Ethereum", label: "Supported network" }, normalizedValue: { kind: "network", value: "ethereum", label: "supported network" }, statement: "CoinCollect publishes Ethereum as a supported network.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-contract", category: "identifier", key: "contractAddress", value: { kind: "contract-address", value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", label: "Current contract" }, normalizedValue: { kind: "contract-address", value: "0xabcdef0123456789abcdef0123456789abcdef01", label: "current contract" }, statement: "CoinCollect publishes a public contract address.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-application-identifier", category: "identifier", key: "applicationIdentifier", value: { kind: "application", value: "https://app.coincollect.test/", label: "Public application" }, normalizedValue: { kind: "application", value: "https://app.coincollect.test/", label: "public application" }, statement: "CoinCollect publishes a public application locator.", evidence: [{ evidenceRefId: "cc-app", relation: "supports" }], sourceIds: ["coincollect-app"] }),
  fact({ id: "fact-repository-identifier", category: "identifier", key: "repositoryIdentifier", value: { kind: "repository", value: "https://github.com/coincollect/coincollect", label: "Source repository" }, normalizedValue: { kind: "repository", value: "https://github.com/coincollect/coincollect", label: "source repository" }, statement: "CoinCollect publishes a repository identifier.", evidence: [{ evidenceRefId: "cc-repo", relation: "supports" }], sourceIds: ["coincollect-repo"] }),
  fact({ id: "fact-contact-email", category: "contact", key: "publicContactEmail", value: { kind: "email", value: "hello@coincollect.test", label: "Public support" }, normalizedValue: { kind: "email", value: "hello@coincollect.test", label: "public support" }, statement: "CoinCollect publishes a public support email address.", evidence: [{ evidenceRefId: "cc-contact", relation: "supports" }], sourceIds: ["coincollect-contact"] }),
  fact({ id: "fact-social", category: "resource", key: "officialSocial", value: "https://social.coincollect.test/coincollect", normalizedValue: "https://social.coincollect.test/coincollect", statement: "CoinCollect publishes an official social profile.", evidence: [{ evidenceRefId: "cc-social", relation: "supports" }], sourceIds: ["coincollect-social"] }),
  fact({ id: "fact-integration", category: "technical", key: "integrations", value: "WalletConnect", normalizedValue: "walletconnect", statement: "CoinCollect documents a WalletConnect integration.", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], sourceIds: ["coincollect-docs"] }),
  fact({ id: "fact-stale-contract", category: "identifier", key: "historicalContractAddress", value: { kind: "contract-address", value: "0x1111111111111111111111111111111111111111", label: "Historical contract" }, normalizedValue: { kind: "contract-address", value: "0x1111111111111111111111111111111111111111", label: "historical contract" }, statement: "A historical external listing publishes a different contract address.", evidence: [{ evidenceRefId: "cc-stale", relation: "supports" }], sourceIds: ["external-reference"], origin: "discovered-external", verification: "discovered" })
] satisfies readonly ProjectFact[];

const coinCollectResources = [
  resource({ id: "cc-website", category: "website", kind: "url", value: "https://coincollect.test/", label: "CoinCollect website", evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], origin: "first-party-website", sourceId: "coincollect-site", evidenceRefId: "cc-home" }),
  resource({ id: "cc-doc-resource", category: "documentation", kind: "url", value: "https://docs.coincollect.test/", label: "CoinCollect documentation", evidence: [{ evidenceRefId: "cc-docs", relation: "supports" }], origin: "first-party-documentation", sourceId: "coincollect-docs", evidenceRefId: "cc-docs" }),
  resource({ id: "cc-app-resource", category: "application", kind: "url", value: "https://app.coincollect.test/", label: "CoinCollect application", evidence: [{ evidenceRefId: "cc-app", relation: "supports" }], origin: "first-party-website", sourceId: "coincollect-app", evidenceRefId: "cc-app" }),
  resource({ id: "cc-contact-resource", category: "contact", kind: "url", value: "https://coincollect.test/contact", label: "CoinCollect contact page", evidence: [{ evidenceRefId: "cc-contact", relation: "supports" }], origin: "first-party-website", sourceId: "coincollect-contact", evidenceRefId: "cc-contact" }),
  resource({ id: "cc-social-resource", category: "social", kind: "url", value: "https://social.coincollect.test/coincollect", label: "CoinCollect official social", evidence: [{ evidenceRefId: "cc-social", relation: "supports" }], origin: "first-party-website", sourceId: "coincollect-social", evidenceRefId: "cc-social" }),
  resource({ id: "cc-repository-resource", category: "repository", kind: "url", value: "https://github.com/coincollect/coincollect", label: "CoinCollect repository", evidence: [{ evidenceRefId: "cc-repo", relation: "supports" }], origin: "first-party-repository", sourceId: "coincollect-repo", evidenceRefId: "cc-repo" }),
  resource({ id: "cc-stale-resource", category: "other", kind: "url", value: "https://listing.invalid/coincollect", label: "Historical listing", evidence: [{ evidenceRefId: "cc-stale", relation: "supports" }], origin: "discovered-external", sourceId: "external-reference", evidenceRefId: "cc-stale", verification: "discovered" })
] satisfies readonly OfficialResource[];

const coinCollectConflicts = [
  conflict("cc-contract-conflict", [{ kind: "fact", id: "fact-contract" }, { kind: "fact", id: "fact-stale-contract" }], ["cc-docs", "cc-stale"], "Current documentation and a historical external listing publish different contract addresses.")
] satisfies readonly ProjectConflict[];

const coinCollectBasePack = pack({
  id: "coincollect",
  projectName: "CoinCollect",
  projectType: "web3",
  audience: ["developers", "crypto users"],
  audienceFactIds: ["fact-audience"],
  facts: coinCollectFacts,
  evidence: coinCollectEvidence,
  resources: coinCollectResources,
  conflicts: coinCollectConflicts,
  sourceIds: ["coincollect-site", "coincollect-docs", "coincollect-app", "coincollect-contact", "coincollect-social", "coincollect-repo", "external-reference"],
  unknowns: ["Current infrastructure deployment details"]
});

const coinCollectPack: ProjectIntelligencePack = {
  ...coinCollectBasePack,
  identity: {
    ...coinCollectBasePack.identity,
    description: { value: "CoinCollect is a self-custody asset dashboard for tracking on-chain holdings and activity.", factIds: ["fact-description"] }
  },
  overview: {
    ...coinCollectBasePack.overview,
    whatItDoes: { value: "CoinCollect is a self-custody asset dashboard for tracking on-chain holdings and activity.", factIds: ["fact-description"] },
    primaryAudience: { value: ["developers", "crypto users"], factIds: ["fact-audience"] },
    goals: { value: ["Review wallet activity", "Track on-chain assets"], factIds: ["fact-goals"] }
  },
  products: {
    products: { value: ["Self-custody asset dashboard"], factIds: ["fact-product"] },
    services: { value: [], factIds: [] },
    features: { value: ["On-chain activity views", "Wallet analytics"], factIds: ["fact-features"] },
    platforms: { value: ["Web application"], factIds: ["fact-platform"] }
  },
  technicalLandscape: {
    frontend: { value: ["Next.js"], factIds: ["fact-frontend"] },
    backend: { value: ["Node.js API"], factIds: ["fact-backend"] },
    mobile: { value: [], factIds: [] },
    apis: { value: ["Public asset API"], factIds: ["fact-api"] },
    repositories: { value: ["https://github.com/coincollect/coincollect"], factIds: ["fact-repository"] },
    technologies: { value: ["TypeScript"], factIds: ["fact-technology"] },
    infrastructure: { value: ["Managed cloud deployment"], factIds: ["fact-infrastructure"] },
    networks: { value: ["Ethereum"], factIds: ["fact-network-name"] },
    dependencies: { value: ["WalletConnect"], factIds: ["fact-integration"] },
    integrations: { value: ["WalletConnect"], factIds: ["fact-integration"] }
  },
  contacts: { value: [{ kind: "email", value: "hello@coincollect.test", label: "Public support" }], factIds: ["fact-contact-email"] },
  identifiers: {
    value: [
      { kind: "network", value: "Ethereum", label: "Supported network" },
      { kind: "contract-address", value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", label: "Current contract" },
      { kind: "application", value: "https://app.coincollect.test/", label: "Public application" },
      { kind: "repository", value: "https://github.com/coincollect/coincollect", label: "Source repository" }
    ],
    factIds: ["fact-network", "fact-contract", "fact-application-identifier", "fact-repository-identifier"]
  }
};

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
  fact({ id: "fact-docs-audience-developers", category: "overview", key: "primaryAudience", value: "developers", normalizedValue: "developers", statement: "RiverKit serves developers.", evidence: [{ evidenceRefId: "docs-api", relation: "supports" }], sourceIds: ["riverkit-docs"] }),
  fact({ id: "fact-docs-audience-data-teams", category: "overview", key: "primaryAudience", value: "data teams", normalizedValue: "data teams", statement: "RiverKit serves data teams.", evidence: [{ evidenceRefId: "docs-repository", relation: "supports" }], sourceIds: ["riverkit-repo"] })
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
      requiredFactValues: {
        projectName: "CoinCollect",
        projectType: "web3",
        contractAddress: { kind: "contract-address", value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01", label: "Current contract" }
      },
      verifiedFactKeys: ["projectName", "projectType", "primaryAudience", "contractAddress"],
      requiredResourceCategories: ["website", "documentation", "application", "contact", "social", "repository"],
      requiredContactKinds: ["email"],
      requiredIdentifierKinds: ["network", "contract-address", "application", "repository"],
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
    pack: pack({ id: "riverkit", projectName: "RiverKit", projectType: "open-source", audience: ["data teams", "developers"], audienceFactIds: ["fact-docs-audience-developers", "fact-docs-audience-data-teams"], facts: docsFacts, evidence: docsEvidence, resources: docsResources, sourceIds: ["riverkit-site", "riverkit-docs", "riverkit-repo"], unknowns: ["Current hosted service availability"] }),
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
