import assert from "node:assert/strict";
import { test } from "node:test";

import { createDeterministicWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";
import { generateWorkspaceBlueprint, validateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { goldenProjectFixtures } from "@/tests/fixtures/project-intelligence";
import { validateProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import { validateWorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";

test("deterministic production certification covers Web3, SaaS, and documentation-heavy projects", async () => {
  for (const fixture of goldenProjectFixtures) {
    assert.equal(validateProjectIntelligencePack(fixture.pack).valid, true, fixture.name);
    const result = await generateWorkspaceBlueprint({
      brief: `Create a reviewable workspace for ${fixture.expectation.name}.`,
      mode: "automatic",
      materialization: { mode: "empty" },
      operatorConstraints: [],
      knowledge: {
        sources: fixture.pack.sourceCoverage.sourceIds.map((sourceId) => createWorkspaceKnowledgeSource({
          id: sourceId,
          kind: "file",
          label: sourceId,
          summary: `Deterministic certification source ${sourceId}.`,
          locator: { kind: "file", path: `/tmp/${sourceId}.md` },
          provenance: "wizard"
        }))
      },
      projectIntelligence: {
        pack: fixture.pack,
        operatorIntent: {
          brief: `Create a reviewable workspace for ${fixture.expectation.name}.`,
          constraints: [],
          mode: "automatic",
          materialization: { mode: "empty" }
        },
        contextStatus: {
          intelligenceStatus: "model",
          packState: fixture.pack.state,
          partialContext: false,
          warnings: []
        }
      }
    }, {
      runId: `production-certification-${fixture.name}`,
      modelExecutor: async () => ({
        text: JSON.stringify({
          identity: { name: fixture.expectation.name, purpose: `Operate ${fixture.expectation.name}.`, projectType: fixture.expectation.projectType },
          workforce: { specialists: [] },
          operations: { workflows: [], automations: [], channels: [] },
          capabilities: { skills: [], tools: [] },
          memory: { durableFacts: [] },
          connections: [],
          recommendations: [],
          assumptions: [],
          warnings: [],
          confidence: "high"
        }),
        runtime: "model-runtime",
        runId: `fake-model-${fixture.name}`,
        modelId: "deterministic-certification-model"
      })
    });
    assert.equal(result.validation.valid, true, fixture.name);
    assert.equal(validateWorkspaceBlueprint(result.blueprint).valid, true, fixture.name);
    assert.equal(result.blueprint.identity.name, fixture.expectation.name);
    assert.equal(result.blueprint.projectContextRefs?.packId, fixture.pack.id);

    const composition = createDeterministicWorkspaceComposition({
      projectIntelligence: fixture.pack,
      blueprint: result.blueprint,
      operatorIntent: { brief: result.blueprint.brief, constraints: [] },
      materializationMode: "empty"
    }, { runId: `production-composition-${fixture.name}` });
    assert.equal(validateWorkspaceCompositionPlan(composition.plan), true, fixture.name);
    assert.equal(composition.plan.provenance.source, "fallback");
    assert.equal(composition.plan.provenance.modelExecutionOccurred, false);
    assert.equal(composition.plan.workspaceBlueprintId, result.blueprint.id);
  }
});
