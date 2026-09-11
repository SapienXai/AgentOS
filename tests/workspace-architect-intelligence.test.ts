import assert from "node:assert/strict";
import { test } from "node:test";

import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import type { WorkspaceArchitectCorpusDocument } from "@/lib/agentos/domains/workspace-blueprint";
import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";

function source(id: string) {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "website",
    label: id,
    summary: "A staged project source.",
    locator: { kind: "website", url: `https://${id}.test/` },
    provenance: "operator"
  });
}

function intelligenceFor(fixture: (typeof goldenProjectFixtures)[number]) {
  return {
    pack: fixture.pack,
    operatorIntent: {
      brief: `Build a workspace for ${fixture.expectation.name}.`,
      constraints: [],
      mode: "review" as const,
      materialization: { mode: "empty" as const }
    },
    contextStatus: {
      intelligenceStatus: "model" as const,
      packState: fixture.pack.state,
      partialContext: false,
      warnings: []
    }
  };
}

test("Architect consumes validated Project Intelligence and records bounded claim provenance", async () => {
  for (const fixture of goldenProjectFixtures) {
    const firstEvidence = fixture.evidence[0];
    const result = await generateWorkspaceBlueprint({
      brief: `Build a workspace for ${fixture.expectation.name}.`,
      knowledge: {
        sources: [source(firstEvidence.sourceId)],
        documents: [{
          documentId: `${firstEvidence.sourceId}-document`,
          sourceId: firstEvidence.sourceId,
          title: firstEvidence.title,
          classification: "documentation",
          canonicalLocator: firstEvidence.canonicalLocator,
          content: firstEvidence.summary
        }]
      },
      projectIntelligence: intelligenceFor(fixture)
    }, {
      runId: `architect-${fixture.name}`,
      modelExecutor: async (request) => {
        assert.match(request.userPrompt, /projectIntelligence/);
        return { text: JSON.stringify({ workforce: { specialists: [] }, operations: { workflows: [], automations: [], channels: [] } }), runtime: "model-runtime" };
      }
    });
    assert.equal(result.reasoning.status, "model");
    assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues));
    assert.equal(result.blueprint.identity.name, fixture.expectation.name);
    assert.equal(result.blueprint.projectContextRefs?.packId, fixture.pack.id);
    assert.equal(result.blueprint.projectContextRefs?.conflictIds.length, fixture.pack.conflicts.length);
  }
});

test("Architect keeps partial intelligence and open conflicts visible while preserving one-agent defaults", async () => {
  const fixture = goldenProjectFixtures[0];
  const result = await generateWorkspaceBlueprint({
    brief: "Build a workspace for CoinCollect.",
    knowledge: { sources: [source("coincollect-site")] },
    projectIntelligence: {
      ...intelligenceFor(fixture),
      contextStatus: { intelligenceStatus: "fallback", packState: fixture.pack.state, partialContext: true, warnings: ["Context staging stopped at its shared budget."] }
    }
  }, {
    runId: "architect-partial-intelligence",
    modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
  });
  assert.equal(result.blueprint.identity.name, "CoinCollect");
  assert.equal(result.blueprint.workforce.specialists.length, 0);
  assert.match(result.blueprint.warnings.join(" "), /partial project context/i);
  assert.match(result.blueprint.warnings.join(" "), /open Project Intelligence conflicts/i);
  assert.equal(result.blueprint.provenance.reasoningMode, "model-runtime");
});

test("unknown Architect evidence references are rejected and bounded retries end in a safe fallback", async () => {
  const fixture = goldenProjectFixtures[1];
  let calls = 0;
  const result = await generateWorkspaceBlueprint({
    brief: "Build a workspace for OrbitDesk.",
    knowledge: { sources: [source("orbitdesk-site")] },
    projectIntelligence: intelligenceFor(fixture)
  }, {
    runId: "architect-unknown-reference",
    maxRetries: 2,
    modelExecutor: async () => {
      calls += 1;
      return { text: JSON.stringify({ workforce: { specialists: [{ id: "bad-specialist", justification: { reason: "Unknown evidence", boundary: "persistent-responsibility", evidenceRefs: ["missing-evidence"] } }] } }), runtime: "model-runtime" };
    }
  });
  assert.equal(calls, 3);
  assert.equal(result.reasoning.status, "fallback");
  assert.equal(result.blueprint.workforce.specialists.length, 0);
  assert.equal(result.reasoning.failureKind, "structured-output");
});

test("social resource evidence does not become an external channel without operator communication intent", async () => {
  const fixture = goldenProjectFixtures[0];
  const result = await generateWorkspaceBlueprint({
    brief: "Build a workspace for CoinCollect.",
    knowledge: { sources: [source("coincollect-social")] },
    projectIntelligence: intelligenceFor(fixture)
  }, {
    runId: "architect-social-resource",
    modelExecutor: async () => ({ text: JSON.stringify({ operations: { channels: [{ id: "social", type: "slack", purpose: "Use the social presence", intent: "evidence-backed-request", evidenceRefs: ["cc-social"] }] } }), runtime: "model-runtime" })
  });
  assert.equal(result.blueprint.operations.channels.length, 0);
});

test("targeted Architect selection can choose an evidence-bearing late document instead of first-N corpus order", async () => {
  const fixture = goldenProjectFixtures[1];
  const documents: WorkspaceArchitectCorpusDocument[] = Array.from({ length: 18 }, (_, index) => ({
    documentId: `noise-${index}`,
    sourceId: "noise",
    title: `Noise ${index}`,
    classification: "general",
    content: "Boilerplate project material."
  }));
  documents.push({
    documentId: "saas-home-document",
    sourceId: "orbitdesk-site",
    title: "OrbitDesk evidence-bearing home",
    classification: "product",
    canonicalLocator: "https://orbitdesk.test/",
    content: "OrbitDesk helps support teams coordinate customer requests."
  });
  let prompt = "";
  await generateWorkspaceBlueprint({
    brief: "Build a workspace for OrbitDesk.",
    knowledge: { sources: [source("orbitdesk-site")], documents },
    projectIntelligence: intelligenceFor(fixture)
  }, {
    runId: "architect-late-document",
    modelExecutor: async (request) => {
      prompt = request.userPrompt;
      return { text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" };
    }
  });
  assert.match(prompt, /OrbitDesk evidence-bearing home/);
});

test("Architect ranks full metadata before bounded body reads and preserves deterministic late-document selection", async () => {
  const fixture = goldenProjectFixtures[1];
  const criticalEvidence = { ...fixture.evidence[0], documentId: "critical-document" };
  const projectIntelligence = {
    ...intelligenceFor(fixture),
    pack: { ...fixture.pack, evidence: [criticalEvidence, ...fixture.pack.evidence.slice(1)] }
  };
  const documents: WorkspaceArchitectCorpusDocument[] = Array.from({ length: 120 }, (_, index) => ({
    documentId: `noise-${index}`,
    sourceId: "orbitdesk-site",
    title: `Generic document ${index}`,
    classification: "general",
    contentLength: 40
  }));
  documents[100] = {
    documentId: "critical-document",
    sourceId: "orbitdesk-site",
    title: "OrbitDesk architecture reference",
    classification: "documentation",
    canonicalLocator: criticalEvidence.canonicalLocator,
    contentLength: 120
  };
  const readIds: string[][] = [];
  let prompt = "";
  const input = {
    brief: "Build a workspace for OrbitDesk.",
    knowledge: { sources: [source("orbitdesk-site")], documents },
    projectIntelligence
  };
  const options = {
    runId: "architect-full-manifest",
    readKnowledgeDocuments: async (ids: readonly string[]) => {
      readIds.push([...ids]);
      return [{ ...documents[100], content: "OrbitDesk architecture uses an authoritative support-request workflow." }];
    },
    modelExecutor: async (request: { userPrompt: string }) => {
      prompt = request.userPrompt;
      return { text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" as const };
    }
  };
  await generateWorkspaceBlueprint(input, options);
  const firstSelection = readIds[0] ?? [];
  assert.ok(firstSelection.includes("critical-document"));
  assert.ok(firstSelection.length <= 16);
  assert.match(prompt, /OrbitDesk architecture reference/);
  assert.match(prompt, /authoritative support-request workflow/);
});
