import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  formatWorkspaceChannelSetup,
  presentWorkspaceBlueprint
} from "@/lib/agentos/ui/workspace-create-presenter";
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
        policyVersion: "phase4.1-structured-architect-v1"
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

test("channel setup copy distinguishes WhatsApp QR sessions from token channels", () => {
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "qr-session", requiresCredentials: false, requiresAuthentication: true }), "Setup required · QR sign-in");
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "token", requiresCredentials: true, requiresAuthentication: true }), "Setup required · Token");
  assert.equal(formatWorkspaceChannelSetup({ authenticationKind: "none", requiresCredentials: false, requiresAuthentication: false }), "Ready to use");
});

test("create mode is Blueprint-first and does not enter the legacy Planner", async () => {
  const [wrapperSource, source, contextRoute] = await Promise.all([
    readFile("components/mission-control/workspace-wizard/workspace-wizard-dialog.tsx", "utf8"),
    readFile(componentPath, "utf8"),
    readFile("app/api/workspaces/context/route.ts", "utf8")
  ]);

  assert.match(wrapperSource, /if \(!props\.workspaceEditId\)/);
  assert.match(wrapperSource, /<CreateWorkspaceExperience/);
  assert.match(source, /fetch\("\/api\/workspaces\/architect"/);
  assert.match(source, /fetch\("\/api\/workspaces\/context"/);
  assert.match(source, /const stagedDraftContextId = stagedContext\?\.draftContextId \?\? draftContextId/);
  assert.match(source, /draftContextId: stagedDraftContextId/);
  assert.match(source, /fetch\("\/api\/workspaces\/architect\/revise"/);
  assert.match(source, /WORKSPACE_KNOWLEDGE_FILE_ACCEPT/);
  assert.match(source, /Project context/);
  assert.match(source, /Blueprint signals/);
  assert.match(source, /workspace-architect-chip-enter/);
  assert.match(source, /fetch\("\/api\/workspaces\/provision"/);
  assert.match(source, /Live provisioning signals/);
  assert.match(source, /Open Workspace/);
  assert.match(source, /Run in background/);
  assert.match(source, /canProvisionBlueprint/);
  assert.match(source, /setProgressPhase\("reading-context"\)/);
  assert.match(source, /setProgressPhase\("designing-workspace"\)/);
  assert.match(source, /setProgressPhase\("preparing-review"\)/);
  assert.match(source, /provisioningRun\?\.state === "ready" \|\| provisioningRun\?\.state === "partial"/);
  assert.doesNotMatch(source, /setInterval|2[,_]?400/);
  assert.doesNotMatch(source, /Marketing intent|Management intent|Autonomous operation/);
  assert.doesNotMatch(source, /briefSignals/);
  assert.doesNotMatch(source, /file\.text\(/);
  assert.doesNotMatch(source, /documents: knowledgePayload/);
  assert.doesNotMatch(source, /fetch\(`\/api\/planner/);
  assert.match(contextRoute, /validateWorkspaceCreationUploadMetadata/);
  assert.match(contextRoute, /content-length/);
  assert.ok(contextRoute.indexOf("content-length") < contextRoute.indexOf("request.formData()"));
  assert.ok(contextRoute.indexOf("validateWorkspaceCreationUploadMetadata") < contextRoute.indexOf("arrayBuffer()"));
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
