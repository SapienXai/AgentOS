import "server-only";

import {
  findWorkspaceCreationRunById,
  listWorkspaceCreationRuns,
  resolveWorkspaceCreationRunRoot
} from "@/lib/agentos/application/workspace-creation-run-store";
import {
  readWorkspaceCreationCompositionPlan,
  readWorkspaceCreationIntelligencePack
} from "@/lib/agentos/application/workspace-creation-context-service";
import {
  readWorkspaceIntelligenceBinding,
  type WorkspaceIntelligenceBinding
} from "@/lib/agentos/application/workspace-intelligence-binding-store";
import {
  findRunById,
  resolveProvisioningRoot,
  type StoredWorkspaceProvisioningRun
} from "@/lib/agentos/application/workspace-provisioning-store";
import { summarizeWorkspaceDrift, type WorkspaceDriftSummary } from "@/lib/agentos/domains/workspace-freshness";
import { validateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import type { WorkspaceArchitectResult, WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import { validateWorkspaceCompositionPlan, type WorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";

export type WorkspaceIntelligenceLiveStatus = "current" | "update-available" | "partial" | "unknown";

export type WorkspaceIntelligenceStatus = {
  workspaceId: string;
  status: WorkspaceIntelligenceLiveStatus;
  reason: string;
  checkedAt: string;
  binding: Pick<WorkspaceIntelligenceBinding, "workspaceId" | "provisioningRunId" | "sourceGenerationId" | "projectIntelligenceGenerationId" | "blueprintId" | "blueprintFingerprint" | "compositionPlanId" | "compositionPlanFingerprint" | "status"> | null;
  live: {
    provisioningRunId: string;
    projectIntelligenceGenerationId: string | null;
    blueprintId: string;
    blueprintFingerprint: string;
    compositionPlanId: string | null;
    compositionPlanFingerprint: string | null;
  } | null;
  candidate: {
    creationRunId: string;
    projectIntelligenceGenerationId: string | null;
    blueprintId: string;
    compositionPlanId: string | null;
    compositionPlanFingerprint: string | null;
  } | null;
  drift: WorkspaceDriftSummary | null;
  enrichment?: {
    status: "idle" | "running" | "current" | "update-available" | "failed";
    creationRunId: string | null;
    durationMs: number | null;
  };
};

export type WorkspaceIntelligenceStatusDependencies = {
  creationRootPath?: string;
  provisioningRootPath?: string;
  bindingRootPath?: string;
  now?: () => Date;
  readBinding?: typeof readWorkspaceIntelligenceBinding;
  findProvisioningRun?: typeof findRunById;
  findCreationRun?: typeof findWorkspaceCreationRunById;
  listCreationRuns?: typeof listWorkspaceCreationRuns;
  readPack?: typeof readWorkspaceCreationIntelligencePack;
  readComposition?: typeof readWorkspaceCreationCompositionPlan;
};

type ResolvedDependencies = Required<Pick<WorkspaceIntelligenceStatusDependencies, "creationRootPath" | "provisioningRootPath" | "now" | "readBinding" | "findProvisioningRun" | "findCreationRun" | "listCreationRuns" | "readPack" | "readComposition">> & {
  bindingRootPath: string | undefined;
};

export async function getWorkspaceIntelligenceStatus(
  input: { actorId: string; workspaceId: string; candidateCreationRunId?: string | null },
  dependencies: WorkspaceIntelligenceStatusDependencies = {}
): Promise<WorkspaceIntelligenceStatus> {
  const resolved = resolveDependencies(dependencies);
  const workspaceId = input.workspaceId.trim();
  const checkedAt = resolved.now().toISOString();
  if (!workspaceId) return emptyStatus("", checkedAt, "A workspace identity is required.");

  const binding = await resolved.readBinding({ actorId: input.actorId, workspaceId, rootPath: resolved.bindingRootPath });
  if (!binding) return emptyStatus(workspaceId, checkedAt, "No accepted Project Intelligence binding is recorded for this workspace.");

  const liveRun = await resolved.findProvisioningRun(resolved.provisioningRootPath, input.actorId, binding.provisioningRunId);
  if (!liveRun || liveRun.run.workspaceId !== workspaceId || liveRun.run.blueprintFingerprint !== binding.blueprintFingerprint) {
    return statusWithBinding(workspaceId, checkedAt, binding, "The live workspace binding could not be matched to its durable provisioning record.", "unknown", null, null);
  }
  const liveBlueprint = validatedBlueprint(liveRun.run);
  if (!liveBlueprint) return statusWithBinding(workspaceId, checkedAt, binding, "The live workspace blueprint is unavailable or invalid.", "unknown", null, null);

  const livePack = liveRun.run.draftContextId
    ? await resolved.readPack({ actorId: input.actorId, draftContextId: liveRun.run.draftContextId }).catch(() => null)
    : null;
  const liveComposition = validatedComposition(liveRun.run.compositionPlan) ? liveRun.run.compositionPlan : null;
  const live = {
    provisioningRunId: liveRun.run.runId,
    projectIntelligenceGenerationId: binding.projectIntelligenceGenerationId,
    blueprintId: liveBlueprint.id,
    blueprintFingerprint: binding.blueprintFingerprint,
    compositionPlanId: liveComposition?.planId ?? binding.compositionPlanId,
    compositionPlanFingerprint: liveComposition?.inputFingerprint ?? binding.compositionPlanFingerprint
  };

  const explicitCandidateRunId = input.candidateCreationRunId?.trim() || null;
  const enrichmentLocators: Awaited<ReturnType<typeof listWorkspaceCreationRuns>> = [];
  if (!explicitCandidateRunId) {
    const allRuns = await resolved.listCreationRuns(resolved.creationRootPath, input.actorId, false);
    for (const locator of allRuns) {
      const parentRunId = locator.run.lineage?.parentRunId;
      if (locator.run.lineage?.trigger !== "post-create-enrichment" || !parentRunId) continue;
      const parent = await resolved.findCreationRun(resolved.creationRootPath, input.actorId, parentRunId);
      if (parent?.run.snapshot.provisioningRunId === binding.provisioningRunId) enrichmentLocators.push(locator);
    }
    enrichmentLocators.sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt));
  }
  const candidateRunId = explicitCandidateRunId ?? enrichmentLocators[0]?.run.runId ?? null;
  if (!candidateRunId) {
    return statusWithBinding(workspaceId, checkedAt, binding, binding.status === "partial" ? "The live workspace binding is recorded as partial." : "The live workspace matches its accepted intelligence binding.", binding.status === "partial" ? "partial" : "current", live, null);
  }

  const candidateLocator = explicitCandidateRunId
    ? await resolved.findCreationRun(resolved.creationRootPath, input.actorId, candidateRunId)
    : enrichmentLocators[0] ?? null;
  const candidateResult = candidateLocator && isWorkspaceArchitectResult(candidateLocator.run.result) ? candidateLocator.run.result : null;
  if (!candidateLocator || !candidateResult || candidateLocator.run.snapshot.state !== "review-ready") {
    return statusWithBinding(workspaceId, checkedAt, binding, "AgentOS is continuing to learn from the original project context.", "current", live, null, null, {
      status: candidateLocator?.run.snapshot.state === "failed" ? "failed" : "running",
      creationRunId: candidateLocator?.run.runId ?? candidateRunId,
      durationMs: candidateLocator ? Math.max(0, Date.parse(checkedAt) - Date.parse(candidateLocator.run.createdAt)) : null
    });
  }

  const candidatePack = candidateLocator.run.draftContextId
    ? await resolved.readPack({ actorId: input.actorId, draftContextId: candidateLocator.run.draftContextId }).catch(() => null)
    : null;
  const candidateComposition = candidateLocator.run.draftContextId
    ? await resolved.readComposition({ actorId: input.actorId, draftContextId: candidateLocator.run.draftContextId }).catch(() => null)
    : null;
  const partial = candidateLocator.run.snapshot.context.status === "partial" || candidateLocator.run.snapshot.drift?.status === "partial";
  const drift = summarizeWorkspaceDrift({
    previousPack: livePack,
    currentPack: candidatePack,
    previousBlueprint: liveBlueprint,
    currentBlueprint: candidateResult.blueprint,
    previousComposition: liveComposition,
    currentComposition: candidateComposition,
    partial
  });
  const candidate = {
    creationRunId: candidateLocator.run.runId,
    projectIntelligenceGenerationId: candidatePack?.provenance.generationId ?? candidatePack?.generation?.id ?? null,
    blueprintId: candidateResult.blueprint.id,
    compositionPlanId: candidateComposition?.planId ?? null,
    compositionPlanFingerprint: candidateComposition?.inputFingerprint ?? null
  };
  const status: WorkspaceIntelligenceLiveStatus = partial
    ? "partial"
    : drift.status === "detected"
      ? "update-available"
      : drift.status === "unknown"
        ? "unknown"
        : "current";
  const reason = partial
    ? "A candidate architecture uses usable but incomplete project context."
    : status === "update-available"
      ? "The candidate architecture differs from the intelligence currently bound to this workspace."
      : status === "unknown"
        ? "The candidate could not be compared completely with the live workspace binding."
        : "The candidate has no semantic drift from the intelligence currently bound to this workspace.";
  return statusWithBinding(workspaceId, checkedAt, binding, reason, status, live, candidate, drift, {
    status: status === "update-available" ? "update-available" : status === "unknown" ? "failed" : "current",
    creationRunId: candidateLocator.run.runId,
    durationMs: Math.max(0, Date.parse(checkedAt) - Date.parse(candidateLocator.run.createdAt))
  });
}

function resolveDependencies(input: WorkspaceIntelligenceStatusDependencies): ResolvedDependencies {
  return {
    creationRootPath: resolveWorkspaceCreationRunRoot(input.creationRootPath),
    provisioningRootPath: resolveProvisioningRoot(input.provisioningRootPath),
    bindingRootPath: input.bindingRootPath,
    now: input.now ?? (() => new Date()),
    readBinding: input.readBinding ?? readWorkspaceIntelligenceBinding,
    findProvisioningRun: input.findProvisioningRun ?? findRunById,
    findCreationRun: input.findCreationRun ?? findWorkspaceCreationRunById,
    listCreationRuns: input.listCreationRuns ?? listWorkspaceCreationRuns,
    readPack: input.readPack ?? readWorkspaceCreationIntelligencePack,
    readComposition: input.readComposition ?? readWorkspaceCreationCompositionPlan
  };
}

function emptyStatus(workspaceId: string, checkedAt: string, reason: string): WorkspaceIntelligenceStatus {
  return { workspaceId, status: "unknown", reason, checkedAt, binding: null, live: null, candidate: null, drift: null, enrichment: { status: "idle", creationRunId: null, durationMs: null } };
}

function statusWithBinding(
  workspaceId: string,
  checkedAt: string,
  binding: WorkspaceIntelligenceBinding,
  reason: string,
  status: WorkspaceIntelligenceLiveStatus,
  live: WorkspaceIntelligenceStatus["live"],
  candidate: WorkspaceIntelligenceStatus["candidate"],
  drift: WorkspaceDriftSummary | null = null,
  enrichment: WorkspaceIntelligenceStatus["enrichment"] = { status: "idle", creationRunId: null, durationMs: null }
): WorkspaceIntelligenceStatus {
  return {
    workspaceId,
    status,
    reason,
    checkedAt,
    binding: {
      workspaceId: binding.workspaceId,
      provisioningRunId: binding.provisioningRunId,
      sourceGenerationId: binding.sourceGenerationId,
      projectIntelligenceGenerationId: binding.projectIntelligenceGenerationId,
      blueprintId: binding.blueprintId,
      blueprintFingerprint: binding.blueprintFingerprint,
      compositionPlanId: binding.compositionPlanId,
      compositionPlanFingerprint: binding.compositionPlanFingerprint,
      status: binding.status
    },
    live,
    candidate,
    drift,
    enrichment
  };
}

function validatedBlueprint(run: StoredWorkspaceProvisioningRun) {
  if (!validateWorkspaceBlueprint(run.blueprint)) return null;
  return run.blueprint as WorkspaceBlueprint;
}

function validatedComposition(value: WorkspaceCompositionPlan | null | undefined) {
  return value && validateWorkspaceCompositionPlan(value) ? value : null;
}

function isWorkspaceArchitectResult(value: unknown): value is WorkspaceArchitectResult {
  return Boolean(value && typeof value === "object" && "blueprint" in value && validateWorkspaceBlueprint(value.blueprint));
}
