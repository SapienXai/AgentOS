import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createEmptyProjectIntelligencePack,
  getProjectConflictSummary,
  isEvidenceQualificationEligible,
  normalizeProjectCollectionValue,
  normalizeProjectFact,
  validateDiscoveryEvent,
  validateDiscoveryRun,
  validateEvidenceRef,
  validateOfficialResource,
  validateProjectFact,
  validateProjectIntelligencePack,
  type EvidenceRef,
  type ProjectFact
} from "@/lib/agentos/domains/project-intelligence";
import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";

function validationMessages(value: ReturnType<typeof validateProjectIntelligencePack>) {
  return value.issues.map((issue) => `${issue.code}:${issue.path}`);
}

function firstFixture() {
  const fixture = goldenProjectFixtures[0];
  assert.ok(fixture);
  return fixture;
}

function factPatch(fact: ProjectFact, patch: Partial<ProjectFact>): ProjectFact {
  return { ...fact, ...patch };
}

test("golden fixtures are versioned, broad, and valid as normalized packs", () => {
  for (const fixture of goldenProjectFixtures) {
    const validation = validateProjectIntelligencePack(fixture.pack);
    assert.equal(validation.valid, true, `${fixture.name}: ${validationMessages(validation).join(", ")}`);
    assert.equal(fixture.pack.schemaVersion, 1);
    assert.equal(fixture.pack.state, "ready");
    assert.equal(fixture.pack.identity.projectType.value, fixture.expectation.projectType);
    assert.equal(fixture.pack.identity.projectName.value, fixture.expectation.name);
    assert.deepEqual(fixture.pack.conflicts.flatMap((entry) => entry.subjects.map((subject) => subject.id)), fixture.expectation.conflictSubjectIds);

    const factKeys = new Set(fixture.facts.map((fact) => fact.key));
    for (const requiredKey of fixture.expectation.requiredFactKeys) assert.equal(factKeys.has(requiredKey), true, `${fixture.name} is missing ${requiredKey}`);
    for (const [key, expectedValue] of Object.entries(fixture.expectation.requiredFactValues)) {
      const matched = fixture.facts.find((fact) => fact.key === key);
      assert.ok(matched, `${fixture.name} is missing ${key}`);
      assert.deepEqual(matched.value, expectedValue);
    }
    for (const category of fixture.expectation.requiredResourceCategories) assert.equal(fixture.resources.some((resource) => resource.category === category), true, `${fixture.name} is missing ${category}`);
    for (const fact of fixture.facts.filter((entry) => fixture.expectation.verifiedFactKeys.includes(entry.key))) assert.equal(fact.verification, "verified");
    for (const kind of fixture.expectation.requiredContactKinds ?? []) assert.equal(fixture.pack.contacts.value.some((contact) => contact.kind === kind), true, `${fixture.name} is missing ${kind} contact`);
    for (const kind of fixture.expectation.requiredIdentifierKinds ?? []) assert.equal(fixture.pack.identifiers.value.some((identifier) => identifier.kind === kind), true, `${fixture.name} is missing ${kind} identifier`);
  }

  const coinCollect = firstFixture();
  assert.equal(coinCollect.pack.identity.projectType.value, "web3");
  assert.equal(goldenProjectFixtures[1]?.pack.identity.projectType.value, "saas");
  assert.equal(goldenProjectFixtures[2]?.pack.identity.projectType.value, "open-source");
  assert.deepEqual(coinCollect.pack.technicalLandscape.networks.value, ["Ethereum"]);
  assert.deepEqual(coinCollect.pack.products.features.value, ["On-chain activity views", "Wallet analytics"]);
  assert.equal(coinCollect.pack.identity.description.value?.includes("self-custody"), true);
  assert.equal(coinCollect.pack.overview.whatItDoes.value, coinCollect.pack.identity.description.value);
  assert.equal(coinCollect.pack.contacts.value[0]?.value, "hello@coincollect.test");
  assert.equal(coinCollect.pack.identifiers.value.some((identifier) => identifier.kind === "contract-address"), true);
  assert.equal(coinCollect.pack.officialResources.some((resource) => resource.locator.value === "https://app.coincollect.test/"), true);
  assert.equal(coinCollect.pack.officialResources.some((resource) => resource.locator.value === "https://social.coincollect.test/coincollect"), true);
});

test("facts are the canonical claim layer and scalar projections must agree", () => {
  const fixture = firstFixture();
  const valid = validateProjectIntelligencePack(fixture.pack);
  assert.equal(valid.valid, true);

  const contradictory = structuredClone(fixture.pack);
  contradictory.identity.projectName = { value: "Different Name", factIds: ["fact-project-name"] };
  const validation = validateProjectIntelligencePack(contradictory);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "inconsistent_projection" && issue.path === "pack.identity.projectName"));

  const unreferenced = structuredClone(fixture.pack);
  unreferenced.identity.displayName = { value: "CoinCollect", factIds: [] };
  const unreferencedValidation = validateProjectIntelligencePack(unreferenced);
  assert.equal(unreferencedValidation.valid, false);
  assert.ok(unreferencedValidation.issues.some((issue) => issue.path === "pack.identity.displayName.factIds"));
});

test("collection projections validate membership without destroying presentation order", () => {
  const fixture = firstFixture();
  const ordered = structuredClone(fixture.pack);
  ordered.overview.primaryAudience.value = ["developers", "crypto users"];
  assert.equal(validateProjectIntelligencePack(ordered).valid, true);
  assert.deepEqual(normalizeProjectCollectionValue(ordered.overview.primaryAudience).value, ["developers", "crypto users"]);

  const unsupported = structuredClone(ordered);
  unsupported.overview.primaryAudience.value = ["developers", "crypto users", "unrelated visitors"];
  const validation = validateProjectIntelligencePack(unsupported);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "inconsistent_projection" && issue.path.includes("primaryAudience")));

  const duplicate = structuredClone(ordered);
  duplicate.overview.primaryAudience.value = ["developers", "crypto users", "developers"];
  const duplicateValidation = validateProjectIntelligencePack(duplicate);
  assert.equal(duplicateValidation.valid, false);
  assert.ok(duplicateValidation.issues.some((issue) => issue.path === "pack.overview.primaryAudience.value[2]"));
});

test("evidence existence, support, and qualification remain distinct", () => {
  const fixture = firstFixture();
  const fact = fixture.facts.find((entry) => entry.id === "fact-project-name");
  assert.ok(fact);

  const contextOnly = factPatch(fact, { evidence: [{ evidenceRefId: "cc-home", relation: "context" }], verification: "verified" });
  const contextValidation = validateProjectFact(contextOnly, fixture.facts, fixture.evidence);
  assert.equal(contextValidation.valid, false);
  assert.ok(contextValidation.issues.some((issue) => issue.code === "unsupported_verification"));

  const unqualifiedEvidence: EvidenceRef = {
    ...fixture.evidence[2],
    id: "unqualified-proof",
    qualification: { status: "unqualified", reason: "discovered-external" }
  };
  const unsupported = factPatch(fact, { evidence: [{ evidenceRefId: unqualifiedEvidence.id, relation: "supports" }], verification: "verified" });
  const unsupportedValidation = validateProjectFact(unsupported, [unsupported], [unqualifiedEvidence]);
  assert.equal(unsupportedValidation.valid, false);
  assert.ok(unsupportedValidation.issues.some((issue) => issue.code === "unsupported_verification"));

  const inferred = factPatch(fact, { evidence: [{ evidenceRefId: "cc-home", relation: "supports" }], verification: "inferred" });
  assert.equal(validateProjectFact(inferred, [inferred], fixture.evidence).valid, true);

  const officialUpload: EvidenceRef = {
    ...fixture.evidence[0],
    id: "official-upload",
    sourceId: "operator-upload",
    evidenceType: "uploaded-document",
    provenance: { origin: "uploaded-file", declaredBy: "operator" },
    qualification: { status: "qualified", capability: "authoritative-official-upload", qualifiedAt: "2026-09-10T00:00:00.000Z" }
  };
  const authoritativeConnected: EvidenceRef = {
    ...fixture.evidence[0],
    id: "authoritative-connected",
    sourceId: "official-connector",
    evidenceType: "connected-record",
    provenance: { origin: "connected-source", declaredBy: "system" },
    qualification: { status: "qualified", capability: "authoritative-connected-source", qualifiedAt: "2026-09-10T00:00:00.000Z" }
  };
  assert.equal(isEvidenceQualificationEligible(officialUpload), true);
  assert.equal(isEvidenceQualificationEligible(authoritativeConnected), true);
  assert.equal(isEvidenceQualificationEligible(unqualifiedEvidence), false);
  const mismatchedCapability: EvidenceRef = {
    ...officialUpload,
    qualification: { status: "qualified", capability: "authoritative-first-party", qualifiedAt: "2026-09-10T00:00:00.000Z" }
  };
  assert.equal(isEvidenceQualificationEligible(mismatchedCapability), false);
});

test("official resources derive verification from evidence and do not carry trust truth", () => {
  const fixture = firstFixture();
  const resource = fixture.resources[0];
  assert.ok(resource);
  assert.equal(validateOfficialResource(resource, fixture.evidence).valid, true);

  const unqualified = structuredClone(resource);
  unqualified.verification = "verified";
  unqualified.evidence = [{ evidenceRefId: "cc-stale", relation: "supports" }];
  const validation = validateOfficialResource(unqualified, fixture.evidence);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "unsupported_verification"));

  const trustField = { ...resource, trust: "verified" } as unknown;
  const trustValidation = validateOfficialResource(trustField, fixture.evidence);
  assert.equal(trustValidation.valid, false);
  assert.ok(trustValidation.issues.some((issue) => issue.code === "unknown_field"));
});

test("conflicts are orthogonal to readiness and verification", () => {
  const fixture = firstFixture();
  const summary = getProjectConflictSummary(fixture.pack);
  assert.deepEqual(summary, { total: 1, open: 1, resolved: 0, dismissed: 0, hasOpenConflicts: true });
  assert.equal(fixture.pack.state, "ready");
  assert.equal(fixture.facts.find((fact) => fact.id === "fact-contract")?.verification, "verified");
  assert.equal(fixture.facts.find((fact) => fact.id === "fact-stale-contract")?.verification, "discovered");
});

test("discovery lifecycle state and execution phase are separate contracts", () => {
  const running = {
    schemaVersion: 1,
    id: "run-1",
    sourceIds: ["source-1"],
    state: "running",
    phase: "fetch",
    startedAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    progress: { processedSources: 1, totalSources: 2, eventCount: 2 },
    warningCount: 0,
    errorCount: 0,
    cancellation: { requested: false }
  };
  assert.equal(validateDiscoveryRun(running).valid, true);

  const mixed = { ...running, state: "pending", phase: "discovery" };
  assert.equal(validateDiscoveryRun(mixed).valid, false);

  const event = {
    schemaVersion: 1,
    id: "event-1",
    runId: "run-1",
    sequence: 1,
    emittedAt: "2026-09-10T00:00:00.000Z",
    phase: "extraction",
    kind: "fact-extracted",
    payload: { factId: "fact-1", confidence: "high" }
  };
  assert.equal(validateDiscoveryEvent(event).valid, true);
  assert.equal(validateDiscoveryEvent({ ...event, phase: "failed" }).valid, false);
  assert.equal(validateDiscoveryEvent({ ...event, payload: { apiKey: "secret" } }).valid, false);
});

test("canonical object-valued facts support contact and identifier projections without double serialization", () => {
  const fixture = firstFixture();
  assert.equal(validateProjectIntelligencePack(fixture.pack).valid, true);
  const contactFact = fixture.facts.find((fact) => fact.id === "fact-contact-email");
  assert.ok(contactFact);
  assert.equal(typeof contactFact.normalizedValue, "object");
  assert.equal(Array.isArray(contactFact.normalizedValue), false);
  assert.deepEqual(contactFact.normalizedValue, { kind: "email", value: "hello@coincollect.test", label: "public support" });
  const normalizedContactFact = normalizeProjectFact(contactFact);
  assert.deepEqual(normalizedContactFact.normalizedValue, contactFact.normalizedValue);
  assert.deepEqual(
    normalizeProjectCollectionValue({
      value: [
        { kind: "email", value: " HELLO@coincollect.test ", label: "Public support" },
        { kind: "email", value: "hello@coincollect.test", label: "Public support" }
      ],
      factIds: ["fact-contact-email"]
    }).value,
    [{ kind: "email", value: "HELLO@coincollect.test", label: "Public support" }]
  );

  const contradictory = structuredClone(fixture.pack);
  contradictory.contacts = { ...contradictory.contacts, value: [{ kind: "email", value: "other@coincollect.test", label: "Public support" }] };
  const validation = validateProjectIntelligencePack(contradictory);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.path === "pack.contacts.value[0]" && issue.code === "inconsistent_projection"));
});

test("canonical object IDs and reference lists are unique within their normalized collections", () => {
  const fixture = firstFixture();
  for (const collection of ["facts", "evidence", "officialResources", "conflicts"] as const) {
    const duplicate = structuredClone(fixture.pack);
    const items = duplicate[collection] as unknown[];
    items.push(structuredClone(items[0]));
    const validation = validateProjectIntelligencePack(duplicate);
    assert.equal(validation.valid, false, collection);
    assert.ok(validation.issues.some((issue) => issue.code === "duplicate_id" && issue.path.startsWith(`pack.${collection}`)), collection);
  }

  const duplicateProjection = structuredClone(fixture.pack);
  duplicateProjection.identity.projectName.factIds = ["fact-project-name", "fact-project-name"];
  const projectionValidation = validateProjectIntelligencePack(duplicateProjection);
  assert.equal(projectionValidation.valid, false);
  assert.ok(projectionValidation.issues.some((issue) => issue.code === "duplicate_reference" && issue.path === "pack.identity.projectName.factIds[1]"));
});

test("evidence discovery lineage resolves, rejects self-links, and rejects cycles", () => {
  const fixture = firstFixture();
  const missing = structuredClone(fixture.pack);
  const missingEvidence = missing.evidence[1];
  assert.ok(missingEvidence);
  missingEvidence.provenance.discoveredFromEvidenceRefId = "missing-evidence";
  const missingValidation = validateProjectIntelligencePack(missing);
  assert.equal(missingValidation.valid, false);
  assert.ok(missingValidation.issues.some((issue) => issue.code === "missing_reference" && issue.path.includes("discoveredFromEvidenceRefId")));

  const self = structuredClone(fixture.pack);
  const selfEvidence = self.evidence[1];
  assert.ok(selfEvidence);
  selfEvidence.provenance.discoveredFromEvidenceRefId = selfEvidence.id;
  const selfValidation = validateProjectIntelligencePack(self);
  assert.equal(selfValidation.valid, false);
  assert.ok(selfValidation.issues.some((issue) => issue.code === "provenance_cycle"));

  const cycle = structuredClone(fixture.pack);
  const first = cycle.evidence[0];
  const second = cycle.evidence[1];
  assert.ok(first && second);
  first.provenance.discoveredFromEvidenceRefId = second.id;
  second.provenance.discoveredFromEvidenceRefId = first.id;
  const cycleValidation = validateProjectIntelligencePack(cycle);
  assert.equal(cycleValidation.valid, false);
  assert.ok(cycleValidation.issues.some((issue) => issue.code === "provenance_cycle"));
});

test("source coverage keeps claim, evidence, resource, conflict, and pack provenance references internally consistent", () => {
  const fixture = firstFixture();
  const missingSource = structuredClone(fixture.pack);
  missingSource.sourceCoverage.sourceIds = missingSource.sourceCoverage.sourceIds.filter((sourceId) => sourceId !== "coincollect-docs");
  const missingSourceValidation = validateProjectIntelligencePack(missingSource);
  assert.equal(missingSourceValidation.valid, false);
  assert.ok(missingSourceValidation.issues.some((issue) => issue.code === "missing_reference" && issue.message.includes("sourceCoverage.sourceIds")));

  const missingCoverage = structuredClone(fixture.pack);
  missingCoverage.sourceCoverage.evidenceRefIds = missingCoverage.sourceCoverage.evidenceRefIds.filter((evidenceRefId) => evidenceRefId !== "cc-docs");
  const missingCoverageValidation = validateProjectIntelligencePack(missingCoverage);
  assert.equal(missingCoverageValidation.valid, false);
  assert.ok(missingCoverageValidation.issues.some((issue) => issue.code === "inconsistent_projection" && issue.message.includes("sourceCoverage.evidenceRefIds")));

  const missingOriginEvidence = structuredClone(fixture.pack);
  const resource = missingOriginEvidence.officialResources[0];
  assert.ok(resource);
  resource.origin.evidenceRefId = "missing-resource-evidence";
  const missingOriginEvidenceValidation = validateProjectIntelligencePack(missingOriginEvidence);
  assert.equal(missingOriginEvidenceValidation.valid, false);
  assert.ok(missingOriginEvidenceValidation.issues.some((issue) => issue.code === "missing_reference" && issue.path.includes("origin.evidenceRefId")));
});

test("discovery run lifecycle timestamps and cancellation fields remain internally consistent", () => {
  const base = {
    schemaVersion: 1,
    id: "run-1",
    sourceIds: ["source-1"],
    updatedAt: "2026-09-10T00:00:00.000Z",
    progress: { processedSources: 0, totalSources: 1, eventCount: 0 },
    warningCount: 0,
    errorCount: 0,
    cancellation: { requested: false }
  };
  assert.equal(validateDiscoveryRun({ ...base, state: "pending", phase: null }).valid, true);
  assert.equal(validateDiscoveryRun({ ...base, state: "running", phase: "discovery", startedAt: "2026-09-10T00:00:00.000Z" }).valid, true);
  assert.equal(validateDiscoveryRun({ ...base, state: "ready", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" }).valid, true);
  assert.equal(validateDiscoveryRun({ ...base, state: "partial", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" }).valid, true);
  assert.equal(validateDiscoveryRun({ ...base, state: "failed", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" }).valid, true);
  assert.equal(validateDiscoveryRun({ ...base, state: "cancelled", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z", cancellation: { requested: true, requestedAt: "2026-09-10T00:00:30.000Z", completedAt: "2026-09-10T00:01:00.000Z" } }).valid, true);

  assert.equal(validateDiscoveryRun({ ...base, state: "pending", phase: null, completedAt: "2026-09-10T00:01:00.000Z" }).valid, false);
  assert.equal(validateDiscoveryRun({ ...base, state: "running", phase: null }).valid, false);
  assert.equal(validateDiscoveryRun({ ...base, state: "running", phase: "fetch", startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" }).valid, false);
  assert.equal(validateDiscoveryRun({ ...base, state: "ready", phase: "finalization", startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" }).valid, false);
  assert.equal(validateDiscoveryRun({ ...base, state: "cancelled", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z", cancellation: { requested: true, requestedAt: "2026-09-10T00:00:30.000Z" } }).valid, false);
  assert.equal(validateDiscoveryRun({ ...base, state: "ready", phase: null, startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z", cancellation: { requested: true, requestedAt: "2026-09-10T00:00:30.000Z" } }).valid, false);
});

test("normalized domain boundaries reject unknown fields and secret fields", () => {
  const fixture = firstFixture();
  const fact = fixture.facts[0];
  assert.ok(fact);
  const unknown = { ...fact, unexpectedField: "not part of the normalized claim contract" };
  const unknownValidation = validateProjectFact(unknown, fixture.facts, fixture.evidence);
  assert.equal(unknownValidation.valid, false);
  assert.ok(unknownValidation.issues.some((issue) => issue.code === "unknown_field"));

  const secretField = { ...fact, apiKey: "do-not-store" };
  const secretValidation = validateProjectFact(secretField, fixture.facts, fixture.evidence);
  assert.equal(secretValidation.valid, false);
  assert.ok(secretValidation.issues.some((issue) => issue.code === "secret_field"));

  const privateKeyValue = { ...fact, value: { privateKey: "do-not-store" } };
  const privateKeyValidation = validateProjectFact(privateKeyValue, fixture.facts, fixture.evidence);
  assert.equal(privateKeyValidation.valid, false);
  assert.ok(privateKeyValidation.issues.some((issue) => issue.code === "secret_field"));
});

test("normalization may redact and canonicalize, while validation remains non-mutating", () => {
  const fixture = firstFixture();
  const original = {
    ...fixture.facts[0],
    statement: "Project statement with apiKey=do-not-store",
    value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"
  };
  const before = structuredClone(original);
  const normalized = normalizeProjectFact(original);
  assert.deepEqual(original, before);
  assert.match(normalized.statement, /\[redacted\]/);
  assert.equal(normalized.value, "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01");
  assert.equal(normalized.statement.includes("do-not-store"), false);

  const evidence = fixture.evidence[0];
  assert.ok(evidence);
  const unknownEvidenceValidation = validateEvidenceRef({ ...evidence, privateKey: "do-not-store" });
  assert.equal(unknownEvidenceValidation.valid, false);
});

test("empty packs remain valid and unknown information is representable", () => {
  const empty = createEmptyProjectIntelligencePack({ id: "empty", now: "2026-09-10T00:00:00.000Z" });
  assert.equal(validateProjectIntelligencePack(empty).valid, true);
  assert.equal(empty.state, "empty");

  const partial = structuredClone(empty);
  partial.state = "partial";
  partial.unknowns = ["Current deployment region is unknown"];
  assert.equal(validateProjectIntelligencePack(partial).valid, true);

  const evidenceOnly = structuredClone(empty);
  evidenceOnly.state = "ready";
  evidenceOnly.evidence = [structuredClone(firstFixture().evidence[0])];
  evidenceOnly.sourceCoverage = { sourceIds: ["coincollect-site"], evidenceRefIds: ["cc-home"], coveredFactIds: [], uncoveredAreas: [] };
  evidenceOnly.provenance = { generatedBy: "discovery", sourceIds: ["coincollect-site"] };
  assert.equal(validateProjectIntelligencePack(evidenceOnly).valid, false);

  const unknownOnly = structuredClone(empty);
  unknownOnly.state = "ready";
  unknownOnly.unknowns = ["Only an unresolved question"];
  assert.equal(validateProjectIntelligencePack(unknownOnly).valid, false);
});

test("Project Intelligence remains a separate normalized domain from WorkspaceBlueprint", () => {
  const fixture = firstFixture();
  assert.equal("knowledge" in fixture.pack, false);
  assert.equal("workforce" in fixture.pack, false);
  assert.equal("operations" in fixture.pack, false);
  assert.equal("conflicted" in fixture.pack, false);
});
