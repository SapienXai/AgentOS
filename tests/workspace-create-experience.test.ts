import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  formatWorkspaceChannelSetup,
  presentWorkspaceBlueprint
} from "@/lib/agentos/ui/workspace-create-presenter";
import { friendlyCreationPhase, friendlyProvisioningPhase, presentWorkspaceCreationExperience } from "@/lib/agentos/ui/workspace-creation-experience-presenter";
import { createInitialWorkspaceCreationSnapshot } from "@/lib/agentos/domains/workspace-creation-run";
import { presentWorkspaceCreationDiscovery } from "@/lib/agentos/domains/workspace-creation-discovery";
import type { WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";

const componentPath = "components/mission-control/workspace-create/create-workspace-experience.tsx";

function minimalResult(overrides: Partial<WorkspaceArchitectResult["reasoning"]> = {}): WorkspaceArchitectResult {
  return {
    blueprint: {
      schemaVersion: 1,
      status: "ready",
      id: "blueprint-test",
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
      identity: { name: "Acme", purpose: "Operate Acme", projectType: "general" },
      brief: "Build an Acme workspace.",
      operatorConstraints: [],
      materialization: { mode: "empty" },
      knowledge: {
        sources: [],
        generationId: null,
        sourceIds: [],
        coverage: { sourceCount: 0, readySourceCount: 0, documentCount: 0 },
        retrieval: { mode: "none", queries: [], evidenceRefs: [] }
      },
      workforce: {
        primaryAgent: {
          id: "acme-operator",
          role: "Operator",
          name: "Acme Operator",
          enabled: true,
          persistence: "primary",
          isPrimary: true,
          purpose: "Operate the workspace.",
          responsibilities: [],
          outputs: [],
          skillIds: [],
          toolIds: [],
          policy: { preset: "worker", missingToolBehavior: "fallback", installScope: "none", fileAccess: "workspace-only", networkAccess: "restricted" },
          justification: "Primary operator.",
          evidenceRefs: []
        },
        specialists: [],
        allowEphemeralSubagents: true,
        maxParallelRuns: 2
      },
      capabilities: { skills: [], tools: [] },
      memory: { ownership: "openclaw-native", search: "native-gateway-preferred", seedRequired: false, durableFacts: [], rationale: "OpenClaw owns memory." },
      connections: [],
      operations: { workflows: [], automations: [], channels: [] },
      safety: { workspaceOnly: true, generationSideEffectFree: true, importedKnowledgeUntrusted: true, notes: [] },
      recommendations: [],
      assumptions: [],
      warnings: [],
      evidence: [],
      operatorOverrides: { lockedPaths: [], lockedDecisions: [] },
      provenance: {
        architectRunId: "run-test",
        inputFingerprint: "a".repeat(64),
        knowledgeGenerationId: null,
        sourceIds: [],
        createdAt: "2026-09-10T00:00:00.000Z",
        modelId: "test/architect",
        runtime: "bounded-local",
        reasoningMode: "model-runtime",
        failureKind: "none",
        policyVersion: "phase6-intelligence-aware-architect-v1"
      }
    },
    summary: "Acme workspace",
    assumptions: [],
    warnings: [],
    recommendations: [],
    validation: { valid: true, issues: [] },
    freshness: {
      status: "unknown",
      blueprintGenerationId: null,
      currentGenerationId: null,
      reason: "Unknown"
    },
    reasoning: {
      status: "model",
      mode: "model-runtime",
      attempts: 1,
      modelId: "test/architect",
      warning: null,
      failureKind: "none",
      ...overrides
    }
  };
}

test("blueprint presenter keeps minimum topology compact and preserves fallback state", () => {
  const model = presentWorkspaceBlueprint(minimalResult({ status: "fallback", mode: "deterministic-safe-fallback", failureKind: "gateway" }));

  assert.equal(model.primaryAgent.name, "Acme Operator");
  assert.deepEqual(model.specialists, []);
  assert.deepEqual(model.automations, []);
  assert.deepEqual(model.channels, []);
  assert.equal(model.fallback, true);
});

test("blueprint presenter preserves structured partial-context and fallback diagnostics", () => {
  const model = presentWorkspaceBlueprint(minimalResult({ status: "fallback", mode: "deterministic-safe-fallback", failureKind: "timeout", failureCode: "architect-timeout", retryability: "transient" }), {
    partialContext: true,
    attempts: 2,
    elapsedMs: 12_000,
    retryAvailable: true,
    failureCategory: "architect-timeout"
  });
  assert.equal(model.partialContext, true);
  assert.equal(model.contextWarning, "Architecture generated from partial project context.");
  assert.equal(model.attempts, 2);
  assert.equal(model.elapsedMs, 12_000);
  assert.equal(model.retryAvailable, true);
  assert.equal(model.failureCategory, "architect-timeout");
});

test("blueprint presenter carries structured extraction coverage into review", () => {
  const model = presentWorkspaceBlueprint(minimalResult(), {
    extraction: {
      status: "partial",
      extractionId: "intelligence-extraction-test",
      generationId: "knowledge-generation-test",
      evidenceCount: 4,
      factCount: 3,
      resourceCount: 2,
      verifiedFactCount: 1,
      verifiedResourceCount: 1,
      conflictCount: 1,
      warningCount: 1,
      unknownCount: 2
    }
  });
  assert.equal(model.extraction?.status, "partial");
  assert.equal(model.extraction?.verifiedFactCount, 1);
});

test("channel setup copy distinguishes WhatsApp QR sessions from token channels", () => {
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "qr-session", requiresCredentials: false, requiresAuthentication: true }), "Setup required · QR sign-in");
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "token", requiresCredentials: true, requiresAuthentication: true }), "Setup required · Token");
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "none", requiresCredentials: false, requiresAuthentication: false }), "Ready to use");
});

test("creation experience presenter uses friendly stages and preserves structured attention", () => {
  const run = {
    runId: "run-presenter",
    snapshot: {
      ...createInitialWorkspaceCreationSnapshot(1),
      state: "review-ready" as const,
      stage: "review-preparation" as const,
      context: { ...createInitialWorkspaceCreationSnapshot(1).context, status: "partial" as const },
      architect: { ...createInitialWorkspaceCreationSnapshot(1).architect, partialContext: true },
      composition: { ...createInitialWorkspaceCreationSnapshot(1).composition!, status: "fallback" as const, artifactCount: 2, inputFingerprint: "a".repeat(64) }
    }
  } as never;
  const model = presentWorkspaceCreationExperience({ run, result: minimalResult(), sources: [] });
  assert.equal(model.stage, "review");
  assert.equal(model.phaseLabel, "Review your workspace");
  assert.match(model.attentionItems.join("\n"), /partial project context/);
  assert.match(model.attentionItems.join("\n"), /deterministic safe fallback/);
  assert.equal(model.currentActivity, "Reading project context");
  assert.equal(model.coverage.status, "partial");
  assert.deepEqual(model.metrics, { pagesRead: 0, documentsRead: 0, factsFound: 0, officialResources: 0 });
  assert.equal(friendlyCreationPhase("workspace-composition"), "Preparing workspace");
  assert.equal(friendlyProvisioningPhase("applying-composition"), "Preparing workspace");
});

test("final review metrics use durable Project Intelligence rather than extraction candidates", () => {
  const snapshot = createInitialWorkspaceCreationSnapshot(1);
  snapshot.extraction = { ...snapshot.extraction, factCount: 15, resourceCount: 79 };
  snapshot.intelligence = {
    ...snapshot.intelligence,
    review: {
      projectName: "CoinCollect",
      description: "A fictional project.",
      projectType: "software",
      understanding: [],
      facts: Array.from({ length: 15 }, (_, index) => ({ id: `fact-${index}`, key: "projectName", statement: "The project has a name.", verification: "verified" as const, conflicted: false })),
      resources: Array.from({ length: 8 }, (_, index) => ({ id: `resource-${index}`, label: `Resource ${index}`, category: "documentation", locator: `https://example.test/${index}`, verification: "discovered" as const, conflicted: false, origin: "first-party-documentation" })),
      conflicts: [],
      unknowns: [],
      sourceCount: 1,
      evidenceCount: 15
    }
  };
  const run = { runId: "run-durable-metrics", snapshot, events: [] } as never;
  const model = presentWorkspaceCreationExperience({ run, result: minimalResult(), sources: [] });
  assert.deepEqual(model.metrics, { pagesRead: 0, documentsRead: 0, factsFound: 15, officialResources: 8 });
});

test("live creation discovery is derived from bounded events and keeps aggregate metrics current", () => {
  const snapshot = createInitialWorkspaceCreationSnapshot(1);
  snapshot.context.sourceProgress = [{ sourceId: "website", sourceKind: "website", state: "ready", discoveredItems: 4, fetchedItems: 3, storedDocuments: 2, warningCount: 0, currentActivity: "Source read", currentLocator: "https://acme.example/docs" }];
  snapshot.extraction = { ...snapshot.extraction, factCount: 2, resourceCount: 3, conflictCount: 1 };
  const run = {
    runId: "run-signals",
    snapshot,
    oldestRetainedSequence: 1,
    events: [
      { sequence: 1, activityCode: "page-fetch-started", sourceId: "website", activityData: { currentLocator: "https://acme.example/" } },
      { sequence: 2, activityCode: "page-fetched", sourceId: "website", activityData: { currentLocator: "https://acme.example/" } },
      { sequence: 3, activityCode: "fact-extracted", sourceId: "website", activityData: { currentActivity: "The project publishes a public name." } },
      { sequence: 4, activityCode: "conflict-detected", sourceId: "website", activityData: { currentActivity: "Project name conflict" } }
    ]
  } as never;
  const model = presentWorkspaceCreationDiscovery(run);
  assert.equal(model.aggregate.pages, 3);
  assert.equal(model.aggregate.documents, 2);
  assert.equal(model.aggregate.facts, 2);
  assert.equal(model.aggregate.resources, 3);
  assert.equal(model.aggregate.conflicts, 1);
  assert.equal(model.signals.filter((signal) => signal.kind === "page").length, 1);
  assert.ok(model.signals.some((signal) => signal.state === "attention"));
});

test("live creation discovery surfaces normalized snapshot findings when event history has no signal entries", () => {
  const snapshot = createInitialWorkspaceCreationSnapshot(1);
  snapshot.extraction = { ...snapshot.extraction, factCount: 15, resourceCount: 79, conflictCount: 1 };
  snapshot.intelligence = {
    ...snapshot.intelligence,
    review: {
      projectName: "CoinCollect",
      description: "A fictional collection workspace.",
      projectType: "software",
      understanding: [],
      facts: [{ id: "fact-1", key: "projectName", statement: "The project is named CoinCollect.", verification: "verified", conflicted: false }],
      resources: [{ id: "resource-1", label: "Developer docs", category: "documentation", locator: "https://coincollect.example/docs", verification: "discovered", conflicted: false, origin: "authoritative-connected-source" }],
      conflicts: [{ id: "conflict-1", summary: "A stale resource names an older project.", status: "open", subjectCount: 2 }],
      unknowns: [],
      sourceCount: 1,
      evidenceCount: 3
    }
  };
  const run = { runId: "run-snapshot-findings", snapshot, events: [] } as never;

  const model = presentWorkspaceCreationDiscovery(run);
  assert.deepEqual(model.signals.slice(0, 3).map((signal) => signal.label), [
    "The project is named CoinCollect.",
    "Developer docs · documentation",
    "Conflict · A stale resource names an older project."
  ]);
  assert.equal(model.signals[0]?.state, "verified");
  assert.equal(model.signals[1]?.state, "found");
  assert.equal(model.signals[2]?.state, "attention");
  assert.ok(model.signals.some((signal) => /more canonical claims found/.test(signal.label)));
  assert.ok(model.signals.some((signal) => /more project resources found/.test(signal.label)));
});

test("review presenter exposes only bounded intelligence and composition projections", () => {
  const result = minimalResult();
  const review = presentWorkspaceBlueprint(result, {
    intelligence: {
      ...createInitialWorkspaceCreationSnapshot(1).intelligence,
      status: "model",
      review: {
        projectName: "Acme",
        description: "A useful project.",
        projectType: "software",
        understanding: ["A useful project."],
        facts: [{ id: "fact-1", key: "projectName", statement: "The project is named Acme.", verification: "verified", conflicted: false }],
        resources: [{ id: "resource-1", label: "Documentation", category: "documentation", locator: "https://acme.example/docs", verification: "discovered", conflicted: false, origin: "first-party-documentation" }],
        conflicts: [{ id: "conflict-1", summary: "Two names were found.", status: "open", subjectCount: 2 }],
        unknowns: [],
        sourceCount: 1,
        evidenceCount: 2
      }
    }
  });
  assert.equal(review.projectIntelligence?.projectName, "Acme");
  assert.equal(review.projectIntelligence?.facts[0]?.verification, "verified");
  assert.equal(review.projectIntelligence?.conflicts[0]?.status, "open");
  assert.equal(review.project.name, "Acme");
  assert.equal(review.project.keyFacts[0]?.key, "projectName");
  assert.deepEqual(review.project.understanding, ["A useful project."]);
  assert.equal(review.sourceSummary.evidenceCount, 2);
  assert.equal(review.coverage.status, "full");
  assert.equal(review.technicalDetails.intelligenceStatus, "model");
});

test("project highlight identity keys remain unique when canonical claims repeat", () => {
  const review = presentWorkspaceBlueprint(minimalResult(), {
    intelligence: {
      ...createInitialWorkspaceCreationSnapshot(1).intelligence,
      status: "model",
      review: {
        projectName: "CoinCollect",
        description: "A fictional project.",
        projectType: "software",
        understanding: [],
        facts: [
          { id: "contract-fact-1", key: "contractAddress", statement: "The project publishes a public contract address.", verification: "discovered", conflicted: false },
          { id: "contract-fact-2", key: "contractAddress", statement: "The project publishes a public contract address.", verification: "discovered", conflicted: false }
        ],
        resources: [],
        conflicts: [],
        unknowns: [],
        sourceCount: 1,
        evidenceCount: 2
      }
    }
  });

  const ids = review.project.highlights.map((highlight) => highlight.id);
  assert.deepEqual(ids, ["contract-fact-1", "contract-fact-2"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("create mode is Blueprint-first and does not enter the legacy Planner", async () => {
  const [wrapperSource, source, contextRoute] = await Promise.all([
    readFile("components/mission-control/workspace-wizard/workspace-wizard-dialog.tsx", "utf8"),
    readFile(componentPath, "utf8"),
    readFile("app/api/workspaces/context/route.ts", "utf8")
  ]);

  assert.match(wrapperSource, /if \(!props\.workspaceEditId\)/);
  assert.match(wrapperSource, /<CreateWorkspaceExperience/);
  assert.match(source, /fetch\("\/api\/workspaces\/creation-runs"/);
  assert.match(source, /Why this agent/);
  assert.match(source, /Sources analyzed/);
  assert.match(source, /Trigger:/);
  assert.match(source, /Outputs:/);
  assert.match(source, /Skills/);
  assert.match(source, /Tools/);
  assert.match(source, /fetch\(`\/api\/workspaces\/creation-runs\/\$\{runId\}\?afterSequence=/);
  assert.match(source, /fetch\(`\/api\/workspaces\/creation-runs\/\$\{runId\}\/cancel`/);
  assert.match(source, /fetch\(`\/api\/workspaces\/creation-runs\/\$\{creationRun\.runId\}\/revise`/);
  assert.match(source, /WORKSPACE_KNOWLEDGE_FILE_ACCEPT/);
  assert.match(source, /Project context/);
  assert.match(source, /Included from your project/);
  assert.match(source, /workspace-architect-chip-enter/);
  assert.match(source, /PikoLoader/);
  assert.match(source, /Minimize workspace creation/);
  assert.match(source, /Reopen workspace creation/);
  assert.match(source, /onOutsideInteraction/);
  assert.match(source, /fetch\("\/api\/workspaces\/provision"/);
  assert.match(source, /Live provisioning signals/);
  assert.match(source, /Open Workspace/);
  assert.match(source, />Minimize</);
  assert.match(source, /canProvisionBlueprint/);
  assert.match(source, /setProgressPhase\(shouldStageContext \? "reading-context" : "designing-workspace"\)/);
  assert.match(source, /activeStage === "review-preparation"/);
  assert.match(source, /Architecture generated from partial project context/);
  assert.match(source, /Workspace plan needs to be rebuilt/);
  assert.match(source, /Start over/);
  assert.match(source, /View project evidence/);
  assert.match(source, /Use basic draft/);
  assert.match(source, /key=\{highlight\.id\}/);
  assert.doesNotMatch(source, /key=\{`\$\{highlight\.label\}:\$\{highlight\.statement\}`\}/);
  assert.doesNotMatch(source, /AI project intelligence unavailable/);
  assert.match(source, /provisioningRun\?\.state === "ready" \|\| provisioningRun\?\.state === "partial"/);
  assert.doesNotMatch(source, /setInterval|2[,_]?400/);
  assert.doesNotMatch(source, /Marketing intent|Management intent|Autonomous operation/);
  assert.doesNotMatch(source, /briefSignals/);
  assert.doesNotMatch(source, /file\.text\(/);
  assert.doesNotMatch(source, /documents: knowledgePayload/);
  assert.doesNotMatch(source, /fetch\(`\/api\/planner/);
  assert.match(contextRoute, /validateWorkspaceCreationUploadMetadata/);
  assert.match(contextRoute, /content-length/);
  assert.match(contextRoute, /readWorkspaceCreationFileWithinLimits/);
  assert.ok(contextRoute.indexOf("contentLengthHeader") < contextRoute.indexOf("const body = await readWorkspaceCreationRequestBodyWithinLimit"));
  assert.ok(contextRoute.indexOf("validateWorkspaceCreationUploadMetadata(files") < contextRoute.indexOf("readWorkspaceCreationFileWithinLimits(\n"));
});

test("Architect API routes use workspace authorization and never provision the final workspace", async () => {
  const [generateRoute, reviseRoute] = await Promise.all([
    readFile("app/api/workspaces/architect/route.ts", "utf8"),
    readFile("app/api/workspaces/architect/revise/route.ts", "utf8")
  ]);

  assert.match(generateRoute, /requireAgentOsProductPermission\(request, "workspace\.manage"\)/);
  assert.match(reviseRoute, /requireAgentOsProductPermission\(request, "workspace\.manage"\)/);
  assert.match(generateRoute, /generateWorkspaceBlueprint/);
  assert.match(reviseRoute, /reviseWorkspaceBlueprint/);
  assert.match(generateRoute, /readWorkspaceCreationContext/);
  assert.match(reviseRoute, /readWorkspaceCreationContext/);
  assert.doesNotMatch(generateRoute, /documents/);
  assert.doesNotMatch(reviseRoute, /documents/);
  assert.doesNotMatch(generateRoute, /createWorkspaceProject/);
  assert.doesNotMatch(reviseRoute, /createWorkspaceProject/);
});
