import assert from "node:assert/strict";
import { test } from "node:test";

import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";
import {
  assessWorkspaceFreshness,
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
