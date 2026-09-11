import assert from "node:assert/strict";
import { test } from "node:test";

import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";
import {
  assessWorkspaceFreshness,
  canonicalResourceLocatorForComparison,
  stableWorkspaceFingerprint,
  summarizeWorkspaceDrift
} from "@/lib/agentos/domains/workspace-freshness";
import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";

function blueprint(generationId: string | null, sourceIds = ["source-1"]): Pick<WorkspaceBlueprint, "knowledge" | "provenance"> {
  return {
    knowledge: {
      sources: [],
      generationId,
      sourceIds,
      coverage: { sourceCount: sourceIds.length, readySourceCount: sourceIds.length, documentCount: 1 },
      retrieval: { mode: "none", queries: [], evidenceRefs: [] }
    },
    provenance: { knowledgeGenerationId: generationId }
  } as unknown as Pick<WorkspaceBlueprint, "knowledge" | "provenance">;
}

test("freshness is fresh only when source and artifact identities agree", () => {
  const fresh = assessWorkspaceFreshness({
    blueprint: blueprint("generation-1"),
    currentKnowledgeGenerationId: "generation-1",
    expectedBlueprintFingerprint: "blueprint-1",
    compositionPlan: { workspaceBlueprintFingerprint: "blueprint-1", inputFingerprint: "composition-1" } as never,
    checkedAt: "2026-09-11T00:00:00.000Z"
  });
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.checkedAt, "2026-09-11T00:00:00.000Z");

  const staleGeneration = assessWorkspaceFreshness({
    blueprint: blueprint("generation-1"),
    currentKnowledgeGenerationId: "generation-2"
  });
  assert.equal(staleGeneration.status, "stale");

  const staleComposition = assessWorkspaceFreshness({
    blueprint: blueprint("generation-1"),
    currentKnowledgeGenerationId: "generation-1",
    expectedBlueprintFingerprint: "blueprint-2",
    compositionPlan: { workspaceBlueprintFingerprint: "blueprint-1", inputFingerprint: "composition-1" } as never
  });
  assert.equal(staleComposition.status, "stale");
});

test("freshness distinguishes partial context from unknown current evidence", () => {
  const partial = assessWorkspaceFreshness({
    blueprint: blueprint("generation-1"),
    currentKnowledgeGenerationId: "generation-1",
    partialContext: true
  });
  assert.equal(partial.status, "partial");

  const unknown = assessWorkspaceFreshness({
    blueprint: blueprint("generation-1"),
    currentKnowledgeGenerationId: null
  });
  assert.equal(unknown.status, "unknown");
});

test("drift reports bounded canonical artifact categories without changing presentation order", () => {
  const previousPack = goldenProjectFixtures[1].pack;
  const currentPack = structuredClone(previousPack);
  currentPack.facts = currentPack.facts.map((fact, index) => index === 0 ? { ...fact, normalizedValue: "changed-project-meaning", statement: `${fact.statement} Updated.` } : fact);
  currentPack.officialResources = [...currentPack.officialResources, {
    ...currentPack.officialResources[0],
    id: "orbitdesk-new-resource",
    label: "OrbitDesk status"
  }];
  currentPack.conflicts = [{
    schemaVersion: 1,
    id: "orbitdesk-conflict",
    subjects: [{ kind: "fact", id: currentPack.facts[0].id }],
    evidenceRefIds: [currentPack.evidence[0].id],
    summary: "A bounded test conflict.",
    confidence: "low",
    status: "open",
    detectedAt: "2026-09-11T00:00:00.000Z"
  }];
  const drift = summarizeWorkspaceDrift({ previousPack, currentPack });
  assert.equal(drift.status, "detected");
  assert.deepEqual(drift.categories, ["facts", "resources", "conflicts"]);
  assert.ok(drift.changes.length <= 24);
  assert.equal(new Set(drift.categories).size, drift.categories.length);

  const partial = summarizeWorkspaceDrift({ previousPack, currentPack, partial: true });
  assert.equal(partial.status, "partial");
  assert.ok(partial.warning);

  assert.notEqual(
    stableWorkspaceFingerprint({ members: ["first", "second"] }),
    stableWorkspaceFingerprint({ members: ["second", "first"] }),
    "fingerprints preserve intentional collection order"
  );
});

test("semantic drift ignores generation metadata and retrieval noise", () => {
  const previousPack = structuredClone(goldenProjectFixtures[1].pack);
  const currentPack = structuredClone(previousPack);
  currentPack.id = "orbitdesk-refresh-2";
  currentPack.createdAt = "2026-09-11T00:00:00.000Z";
  currentPack.updatedAt = "2026-09-11T00:00:00.000Z";
  currentPack.provenance = { ...currentPack.provenance, generationId: "orbitdesk-refresh-generation" };
  currentPack.generation = { ...currentPack.generation!, id: "orbitdesk-refresh-generation", createdAt: "2026-09-11T00:00:00.000Z" };
  currentPack.evidence = currentPack.evidence.map((entry) => ({ ...entry, id: `${entry.id}-refresh`, retrievedAt: "2026-09-11T01:00:00.000Z" }));
  currentPack.facts = currentPack.facts.map((fact) => ({ ...fact, id: `${fact.id}-refresh`, evidence: fact.evidence.map((reference) => ({ ...reference, evidenceRefId: `${reference.evidenceRefId}-refresh` })), retrievedAt: "2026-09-11T01:00:00.000Z" }));
  currentPack.officialResources = currentPack.officialResources.map((resource) => ({ ...resource, id: `${resource.id}-refresh`, evidence: resource.evidence.map((reference) => ({ ...reference, evidenceRefId: `${reference.evidenceRefId}-refresh` })) }));
  assert.equal(summarizeWorkspaceDrift({ previousPack, currentPack }).status, "none");
});

function semanticBlueprint(): WorkspaceBlueprint {
  const policy = {
    preset: "worker",
    missingToolBehavior: "fallback",
    installScope: "none",
    fileAccess: "workspace-only",
    networkAccess: "restricted"
  } as const;
  const primaryAgent = {
    id: "primary",
    role: "operator",
    name: "Workspace Operator",
    enabled: true,
    persistence: "primary",
    isPrimary: true,
    purpose: "Coordinate the workspace.",
    responsibilities: ["Coordinate work"],
    outputs: ["Decisions"],
    skillIds: ["planning"],
    toolIds: ["files"],
    policy,
    justification: "Generated because the project needs coordination.",
    evidenceRefs: ["evidence-old"]
  };
  const specialist = {
    id: "researcher",
    role: "researcher",
    name: "Researcher",
    enabled: true,
    persistence: "specialist",
    isPrimary: false,
    purpose: "Research the project.",
    responsibilities: ["Research sources"],
    outputs: ["Research notes"],
    skillIds: ["research"],
    toolIds: ["browser"],
    policy,
    justification: "Generated because research is recurring.",
    evidenceRefs: ["evidence-old"]
  };
  return {
    schemaVersion: 1,
    status: "ready",
    id: "blueprint-1",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    identity: { name: "Example", purpose: "Operate the project.", projectType: "saas" },
    brief: "Build a calm operating workspace.",
    operatorConstraints: ["Ask before external communication."],
    materialization: { mode: "empty" },
    knowledge: {
      sources: [],
      generationId: "generation-1",
      sourceIds: ["source-1"],
      coverage: { sourceCount: 1, readySourceCount: 1, documentCount: 1 },
      retrieval: { mode: "native-memory-search", queries: ["project"], evidenceRefs: ["evidence-old"] }
    },
    workforce: { primaryAgent, specialists: [specialist], allowEphemeralSubagents: true, maxParallelRuns: 2 },
    capabilities: {
      skills: [{ id: "planning", status: "selected", source: "openclaw-preset", rationale: "Evidence-old", evidenceRefs: ["evidence-old"] }],
      tools: [{ id: "files", status: "selected", rationale: "Evidence-old", evidenceRefs: ["evidence-old"] }]
    },
    memory: { ownership: "openclaw-native", search: "native-gateway-preferred", seedRequired: false, durableFacts: ["The project is a SaaS."], rationale: "Generated memory rationale." },
    connections: [{ id: "github", provider: "github", status: "recommended", purpose: "Repository sync", sourceId: "source-old", credentials: "not-in-blueprint" }],
    operations: {
      workflows: [{ id: "review", name: "Review", goal: "Review work", trigger: "manual", ownerAgentId: "primary", collaboratorAgentIds: ["researcher"], successDefinition: "Notes recorded", outputs: ["Notes"], enabled: true, evidenceRefs: ["evidence-old"] }],
      automations: [{ id: "daily", name: "Daily", description: "Daily review", enabled: true, scheduleKind: "cron", scheduleValue: "0 9 * * *", agentId: "primary", mission: "Review the project", thinking: "low", announce: false, selection: "recommended", evidenceRefs: ["evidence-old"] }],
      channels: [{ id: "slack", type: "slack", name: "Slack", purpose: "Operator updates", target: "#ops", enabled: true, announce: false, authenticationKind: "token", requiresCredentials: true, requiresAuthentication: true, primaryAgentId: "primary", selection: "recommended", evidenceRefs: ["evidence-old"] }]
    },
    safety: { workspaceOnly: true, generationSideEffectFree: true, importedKnowledgeUntrusted: true, notes: ["Generated safety note."] },
    recommendations: ["Generated recommendation."],
    assumptions: ["Generated assumption."],
    warnings: ["Generated warning."],
    evidence: [],
    operatorOverrides: { lockedPaths: [], lockedDecisions: [] },
    provenance: {
      architectRunId: "run-1",
      inputFingerprint: "input-1",
      knowledgeGenerationId: "generation-1",
      sourceIds: ["source-1"],
      createdAt: "2026-09-11T00:00:00.000Z",
      modelId: "model-1",
      runtime: "native-openclaw",
      reasoningMode: "openclaw-agent",
      failureKind: "none",
      policyVersion: "phase6-intelligence-aware-architect-v1"
    }
  } as unknown as WorkspaceBlueprint;
}

function assertNoBlueprintDrift(mutator: (current: WorkspaceBlueprint) => void) {
  const previous = semanticBlueprint();
  const current = structuredClone(previous);
  mutator(current);
  assert.equal(summarizeWorkspaceDrift({ previousBlueprint: previous, currentBlueprint: current }).status, "none");
}

function assertBlueprintDrift(mutator: (current: WorkspaceBlueprint) => void) {
  const previous = semanticBlueprint();
  const current = structuredClone(previous);
  mutator(current);
  const drift = summarizeWorkspaceDrift({ previousBlueprint: previous, currentBlueprint: current });
  assert.equal(drift.status, "detected");
  assert.deepEqual(drift.categories, ["blueprint"]);
}

test("Blueprint semantic drift excludes evidence and explanatory metadata", () => {
  assertNoBlueprintDrift((current) => {
    current.knowledge.retrieval.evidenceRefs = ["evidence-new"];
    current.workforce.primaryAgent.evidenceRefs = ["evidence-new"];
    current.workforce.primaryAgent.justification = "A different generated explanation.";
    current.workforce.specialists[0]!.evidenceRefs = ["evidence-new"];
    current.workforce.specialists[0]!.justification = "Another explanation.";
    current.capabilities.skills[0]!.evidenceRefs = ["evidence-new"];
    current.capabilities.skills[0]!.rationale = "Another skill explanation.";
    current.capabilities.tools[0]!.evidenceRefs = ["evidence-new"];
    current.capabilities.tools[0]!.rationale = "Another tool explanation.";
    current.operations.workflows[0]!.evidenceRefs = ["evidence-new"];
    current.operations.automations[0]!.evidenceRefs = ["evidence-new"];
    current.operations.channels[0]!.evidenceRefs = ["evidence-new"];
    current.connections[0]!.sourceId = "source-new";
    current.memory.rationale = "A different memory rationale.";
    current.safety.notes = ["A different safety note."];
  });
});

test("Blueprint semantic drift retains real workforce and operation changes", () => {
  assertBlueprintDrift((current) => { current.workforce.primaryAgent.role = "lead"; });
  assertBlueprintDrift((current) => { current.workforce.specialists.push({ ...current.workforce.specialists[0]!, id: "writer" }); });
  assertBlueprintDrift((current) => { current.workforce.specialists.pop(); });
  assertBlueprintDrift((current) => { current.workforce.specialists[0]!.responsibilities = ["Publish research"]; });
  assertBlueprintDrift((current) => { current.operations.workflows[0]!.trigger = "event"; });
  assertBlueprintDrift((current) => { current.operations.automations[0]!.scheduleValue = "0 10 * * *"; });
  assertBlueprintDrift((current) => { current.operations.channels.push({ ...current.operations.channels[0]!, id: "telegram", type: "telegram" }); });
  assertBlueprintDrift((current) => { current.connections[0]!.status = "required"; });
  assertBlueprintDrift((current) => { current.workforce.primaryAgent.toolIds = ["browser"]; });
  assertBlueprintDrift((current) => { current.brief = "Operate a materially different project."; });
});

test("resource locator comparison is kind-aware and preserves URL path case", () => {
  assert.equal(canonicalResourceLocatorForComparison({ kind: "url", value: "https://Example.com/API" }), "https://example.com/API");
  assert.equal(canonicalResourceLocatorForComparison({ kind: "url", value: "HTTPS://example.com/API" }), "https://example.com/API");
  assert.equal(canonicalResourceLocatorForComparison({ kind: "url", value: "https://github.com/coincollect/coincollect/" }), "https://github.com/coincollect/coincollect");
  assert.equal(canonicalResourceLocatorForComparison({ kind: "email", value: "hello@Example.COM" }), "hello@example.com");
  assert.equal(canonicalResourceLocatorForComparison({ kind: "identifier", value: "0xAbCdEf" }), "0xAbCdEf");

  const previousPack = structuredClone(goldenProjectFixtures[0].pack);
  previousPack.officialResources[0]!.locator = { kind: "url", value: "https://Example.com/API" };
  const withResourceValue = (value: string) => {
    const currentPack = structuredClone(previousPack);
    currentPack.officialResources[0]!.locator = { kind: "url", value };
    return summarizeWorkspaceDrift({ previousPack, currentPack });
  };
  assert.equal(withResourceValue("https://example.com/API").status, "none");
  assert.equal(withResourceValue("HTTPS://example.com/API").status, "none");
  assert.equal(withResourceValue("https://example.com/api").status, "detected");

  const repository = previousPack.officialResources.find((resource) => resource.category === "repository")!;
  const repositoryPack = structuredClone(previousPack);
  repositoryPack.officialResources = previousPack.officialResources.map((resource) => resource.id === repository.id
    ? { ...resource, locator: { ...resource.locator, value: `${resource.locator.value}/` } }
    : resource);
  assert.equal(summarizeWorkspaceDrift({ previousPack, currentPack: repositoryPack }).status, "none");
});

test("public identifier changes remain visible to resource drift", () => {
  const previousPack = structuredClone(goldenProjectFixtures[0].pack);
  const currentPack = structuredClone(previousPack);
  currentPack.officialResources = [{
    ...previousPack.officialResources[0]!,
    locator: { kind: "identifier", value: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" }
  }];
  const changed = structuredClone(currentPack);
  changed.officialResources[0]!.locator = { kind: "identifier", value: "0x1111111111111111111111111111111111111111" };
  assert.equal(summarizeWorkspaceDrift({ previousPack: currentPack, currentPack: changed }).status, "detected");
});
