import "server-only";
import { WORKSPACE_CREATION_FILES, type WorkspaceCreationDepth } from "@/lib/agentos/domains/workspace-creation-policy";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createWorkspaceCompositionInputFingerprint,
  normalizeWorkspaceCompositionProposal,
  summarizeWorkspaceCompositionPlan,
  validateWorkspaceCompositionPlan,
  WORKSPACE_COMPOSITION_ARTIFACT_PATHS,
  WORKSPACE_COMPOSITION_POLICY_VERSION,
  WORKSPACE_COMPOSITION_SCHEMA_VERSION,
  type WorkspaceCompositionArtifact,
  type WorkspaceCompositionArtifactId,
  type WorkspaceCompositionPlan,
  type WorkspaceCompositionProposalArtifact,
  type WorkspaceCompositionModelExecutionRequest,
  type WorkspaceCompositionModelExecutionResult,
  type WorkspaceCompositionProposal,
  type WorkspaceCompositionExecutionKnownCompleted,
  type WorkspaceCompositionExecutionStarted,
  type WorkspaceCompositionSummary,
  WORKSPACE_COMPOSITION_MAX_ARTIFACTS
} from "@/lib/agentos/domains/workspace-composition";
import type { ProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import type { WorkspaceBlueprint } from "@/lib/agentos/domains/workspace-blueprint";
import { validateProjectIntelligencePack } from "@/lib/agentos/domains/project-intelligence";
import { validateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { runStructuredWorkspaceComposerAgent } from "@/lib/openclaw/application/structured-agent-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { PlannerRuntimeEnsureDependencies } from "@/lib/openclaw/application/planner-runtime-service";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

export const WORKSPACE_COMPOSITION_MARKER_START = "<!-- agentos:managed:start workspace-composition -->";
export const WORKSPACE_COMPOSITION_MARKER_END = "<!-- agentos:managed:end workspace-composition -->";
const MAX_COMPOSITION_BODY_BYTES = 128_000;
const MAX_COMPOSER_RESPONSE_CHARS = 256_000;

export type WorkspaceCompositionExistingFile = {
  path: string;
  content: string;
  currentHash?: string | null;
};

export type WorkspaceComposerInput = {
  profile?: WorkspaceCreationDepth;
  projectIntelligence?: ProjectIntelligencePack | null;
  blueprint: WorkspaceBlueprint;
  operatorIntent: { brief: string; constraints: readonly string[] };
  existingFiles?: readonly WorkspaceCompositionExistingFile[];
  materializationMode?: "empty" | "clone" | "existing";
};

export type WorkspaceComposerOptions = {
  runId?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  modelExecutor?: (request: WorkspaceCompositionModelExecutionRequest) => Promise<WorkspaceCompositionModelExecutionResult>;
  adapter?: OpenClawAdapter;
  runtimeDependencies?: PlannerRuntimeEnsureDependencies;
  onExecutionStarted?: (execution: WorkspaceCompositionExecutionStarted) => Promise<void>;
  onExecutionKnownCompleted?: (execution: WorkspaceCompositionExecutionKnownCompleted) => Promise<void>;
};

export type WorkspaceCompositionResult = {
  plan: WorkspaceCompositionPlan;
  summary: WorkspaceCompositionSummary;
};

export async function composeWorkspaceComposition(input: WorkspaceComposerInput, options: WorkspaceComposerOptions = {}): Promise<WorkspaceCompositionResult> {
  const blueprintValidation = validateWorkspaceBlueprint(input.blueprint);
  if (!blueprintValidation.valid) throw new Error("Workspace composition requires a validated WorkspaceBlueprint.");
  if (input.projectIntelligence && !validateProjectIntelligencePack(input.projectIntelligence).valid) throw new Error("Workspace composition requires a validated Project Intelligence pack.");
  const runId = options.runId?.trim() || randomUUID();
  const existing = normalizeExistingFiles(input.existingFiles ?? []);
  const materializationMode = input.materializationMode ?? input.blueprint.materialization.mode;
  const fingerprint = createWorkspaceCompositionInputFingerprint({
    policyVersion: WORKSPACE_COMPOSITION_POLICY_VERSION,
    ...(input.profile ? { profile: input.profile } : {}),
    packId: input.projectIntelligence?.id ?? null,
    blueprint: input.blueprint,
    operatorIntent: input.operatorIntent,
    materializationMode,
    existingFiles: existing.map((file) => ({ path: file.path, hash: file.currentHash ?? sha256(file.content) }))
  });
  const fallback = createFallbackProposal(input);
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, Math.min(2, options.maxAttempts ?? 2));
  let proposal = fallback;
  let modelExecutionOccurred = false;
  let attempts = 0;
  let failure: WorkspaceCompositionSummary["failure"] = null;
  const modelExecutor = options.modelExecutor ?? ((request) => runStructuredWorkspaceComposerAgent(request, { adapter: options.adapter, runtimeDependencies: options.runtimeDependencies }));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    if (options.signal?.aborted) throw new DOMException("Workspace composition was cancelled.", "AbortError");
    try {
      const idempotencyKey = `workspace-composer:${runId}:${attempt}`;
      await options.onExecutionStarted?.({ runId, attempt, idempotencyKey });
      const response = await withDeadline((signal) => modelExecutor({
        runId,
        attempt,
        idempotencyKey,
        signal,
        timeoutMs: Math.max(5_000, Math.min(options.timeoutMs ?? 90_000, 125_000)),
        systemPrompt: COMPOSER_SYSTEM_POLICY,
        userPrompt: buildComposerPrompt(input, existing, attempt > 1)
      }), Math.max(5_000, Math.min(options.timeoutMs ?? 90_000, 125_000)), options.signal);
      modelExecutionOccurred = true;
      try {
        await options.onExecutionKnownCompleted?.({
          runId,
          attempt,
          idempotencyKey,
          remoteRunId: response.runId,
          remoteSessionKey: response.sessionKey
        });
      } catch {
        throw new Error("Workspace composition execution outcome is ambiguous.");
      }
      const parsed = normalizeWorkspaceCompositionProposal(parseJson(response.text));
      validateProposalReferences(parsed, input);
      proposal = parsed;
      failure = null;
      break;
    } catch (error) {
      if (options.signal?.aborted || /cancelled|canceled|aborted/i.test(redactErrorMessage(error, ""))) throw new DOMException("Workspace composition was cancelled.", "AbortError");
      const message = redactErrorMessage(error, "Workspace composition was unavailable.");
      const ambiguous = /ambiguous/i.test(message);
      failure = { code: ambiguous ? "workspace-composer-execution-ambiguous" : attempt === maxAttempts ? "composition-fallback" : "composition-structured-output-invalid", message: message.slice(0, 300) };
      if (attempt === maxAttempts || ambiguous) break;
    }
  }

  const plan = buildWorkspaceCompositionPlan(input, existing, {
    runId,
    inputFingerprint: fingerprint,
    materializationMode,
    proposal,
    modelExecutionOccurred,
    attempts,
    failure
  });
  if (!validateWorkspaceCompositionPlan(plan)) throw new Error("Workspace composition produced an invalid plan.");
  return { plan, summary: summarizeWorkspaceCompositionPlan(plan, Date.now() - startedAt, failure) };
}

export function createDeterministicWorkspaceComposition(input: WorkspaceComposerInput, options: {
  runId?: string;
  warning?: string;
} = {}): WorkspaceCompositionResult {
  const blueprintValidation = validateWorkspaceBlueprint(input.blueprint);
  if (!blueprintValidation.valid) throw new Error("Workspace composition requires a validated WorkspaceBlueprint.");
  if (input.projectIntelligence && !validateProjectIntelligencePack(input.projectIntelligence).valid) throw new Error("Workspace composition requires a validated Project Intelligence pack.");
  const runId = options.runId?.trim() || randomUUID();
  const existing = normalizeExistingFiles(input.existingFiles ?? []);
  const materializationMode = input.materializationMode ?? input.blueprint.materialization.mode;
  const inputFingerprint = createWorkspaceCompositionInputFingerprint({
    policyVersion: WORKSPACE_COMPOSITION_POLICY_VERSION,
    ...(input.profile ? { profile: input.profile } : {}),
    packId: input.projectIntelligence?.id ?? null,
    blueprint: input.blueprint,
    operatorIntent: input.operatorIntent,
    materializationMode,
    existingFiles: existing.map((file) => ({ path: file.path, hash: file.currentHash ?? sha256(file.content) }))
  });
  const startedAt = Date.now();
  const plan = buildWorkspaceCompositionPlan(input, existing, {
    runId,
    inputFingerprint,
    materializationMode,
    proposal: createFallbackProposal(input),
    modelExecutionOccurred: false,
    attempts: 0,
    failure: { code: options.warning ? "workspace-composer-execution-ambiguous" : "composition-fallback", message: options.warning ?? "Deterministic workspace document content was used." }
  });
  return { plan, summary: summarizeWorkspaceCompositionPlan(plan, Date.now() - startedAt, plan.provenance.source === "fallback" ? { code: plan.warnings.some((warning) => warning.includes("ambiguous")) ? "workspace-composer-execution-ambiguous" : "composition-fallback", message: options.warning ?? "Deterministic workspace document content was used." } : null) };
}

export function createWorkspaceCompositionBlueprintFingerprint(blueprint: WorkspaceBlueprint) {
  return sha256(stableStringify(blueprint));
}

function buildWorkspaceCompositionPlan(
  input: WorkspaceComposerInput,
  existing: readonly WorkspaceCompositionExistingFile[],
  options: {
    runId: string;
    inputFingerprint: string;
    materializationMode: "empty" | "clone" | "existing";
    proposal: WorkspaceCompositionProposal;
    modelExecutionOccurred: boolean;
    attempts: number;
    failure: { code: string; message: string } | null;
  }
): WorkspaceCompositionPlan {
  const proposal = scopeCompositionProposal(input, options.proposal);
  const artifacts = materializePlanArtifacts(proposal, existing);
  const conflicts = artifacts
    .filter((artifact) => artifact.operation === "conflict")
    .map((artifact) => `${artifact.artifactId}: ${artifact.warnings[0] ?? "Existing workspace content requires review."}`)
    .slice(0, 24);
  const warnings = [
    ...options.proposal.warnings,
    ...(options.failure ? [options.failure.message] : [])
  ].map((warning) => redactSecretText(warning).slice(0, 300)).filter(Boolean).slice(0, 24);
  return {
    schemaVersion: WORKSPACE_COMPOSITION_SCHEMA_VERSION,
    policyVersion: WORKSPACE_COMPOSITION_POLICY_VERSION,
    ...(input.profile ? { profile: input.profile } : {}),
    planId: `composition-${options.runId}`,
    inputFingerprint: options.inputFingerprint,
    status: conflicts.length > 0 ? "blocked" : options.modelExecutionOccurred && options.failure === null ? "ready" : "fallback",
    projectIntelligencePackId: input.projectIntelligence?.id ?? null,
    projectIntelligenceGenerationId: input.projectIntelligence?.provenance.generationId ?? input.projectIntelligence?.generation?.id ?? null,
    workspaceBlueprintId: input.blueprint.id,
    workspaceBlueprintFingerprint: createWorkspaceCompositionBlueprintFingerprint(input.blueprint),
    materializationMode: options.materializationMode,
    existingFileHashes: existing.map((file) => ({ path: file.path, hash: file.currentHash ?? sha256(file.content) })),
    artifacts,
    warnings,
    conflicts,
    provenance: {
      source: options.modelExecutionOccurred && options.failure === null ? "model" : "fallback",
      modelExecutionOccurred: options.modelExecutionOccurred,
      attempts: options.attempts,
      composerRunId: options.runId
    }
  };
}

export async function applyWorkspaceCompositionPlan(input: {
  workspacePath: string;
  plan: WorkspaceCompositionPlan;
}): Promise<{ results: Array<{ artifactId: WorkspaceCompositionArtifactId; status: "created" | "updated" | "unchanged" | "preserved" | "conflict"; path: string; message?: string }>; warnings: string[] }> {
  if (!validateWorkspaceCompositionPlan(input.plan)) throw new Error("Workspace composition plan is invalid or tampered with.");
  if (input.plan.status === "blocked") throw new Error("Workspace composition plan contains unresolved conflicts.");
  const workspacePath = path.resolve(input.workspacePath);
  const results: Array<{ artifactId: WorkspaceCompositionArtifactId; status: "created" | "updated" | "unchanged" | "preserved" | "conflict"; path: string; message?: string }> = [];
  const warnings: string[] = [];
  for (const artifact of input.plan.artifacts) {
    const target = resolveSafeWorkspacePath(workspacePath, artifact.path);
    await assertNoSymlinkAlongPath(workspacePath, target);
    const current = await readOptionalTextFile(target);
    if (artifact.operation === "preserve") {
      results.push({ artifactId: artifact.artifactId, status: "preserved", path: artifact.path });
      continue;
    }
    if (artifact.operation === "conflict") {
      results.push({ artifactId: artifact.artifactId, status: "conflict", path: artifact.path, message: artifact.warnings[0] ?? "Composition conflict requires review." });
      warnings.push(`${artifact.artifactId}: composition conflict requires review.`);
      continue;
    }
    const next = artifact.operation === "merge-managed-section" || (artifact.operation === "create" && current !== null)
      ? mergeManagedSection(current ?? "", artifact.content)
      : artifact.content;
    if (current !== null && artifact.expectedMaterializedHash && sha256(current) === artifact.expectedMaterializedHash) {
      results.push({ artifactId: artifact.artifactId, status: "unchanged", path: artifact.path });
      continue;
    }
    if (artifact.expectedExistingHash && current !== null && sha256(current) !== artifact.expectedExistingHash) {
      results.push({ artifactId: artifact.artifactId, status: "conflict", path: artifact.path, message: "The existing workspace file changed after review." });
      warnings.push(`${artifact.artifactId}: stale existing file hash blocked the write.`);
      continue;
    }
    if (current === next) {
      results.push({ artifactId: artifact.artifactId, status: "unchanged", path: artifact.path });
      continue;
    }
    await writeAtomicText(target, next);
    results.push({ artifactId: artifact.artifactId, status: current === null ? "created" : "updated", path: artifact.path });
  }
  return { results, warnings };
}

export async function inspectWorkspaceCompositionFiles(workspacePath: string): Promise<WorkspaceCompositionExistingFile[]> {
  const root = path.resolve(workspacePath);
  const files: WorkspaceCompositionExistingFile[] = [];
  for (const relativePath of Object.values(WORKSPACE_COMPOSITION_ARTIFACT_PATHS)) {
    const target = resolveSafeWorkspacePath(root, relativePath);
    await assertNoSymlinkAlongPath(root, target);
    const content = await readOptionalTextFile(target);
    if (content !== null) files.push({ path: relativePath, content, currentHash: sha256(content) });
  }
  return files;
}

const COMPOSER_SYSTEM_POLICY = [
  "You are the AgentOS Workspace Composer.",
  "Return content proposals only. Never return paths, filesystem operations, merge strategies, ownership, permissions, agents, workflows, automations, channels, connections, skills, tools, credentials, or provisioning instructions.",
  "Use only the supplied validated claims, evidence/resource references, WorkspaceBlueprint references, and explicit operator intent.",
  "Do not invent facts, identifiers, URLs, email addresses, integrations, or runtime configuration.",
  `Return JSON with schemaVersion ${WORKSPACE_COMPOSITION_SCHEMA_VERSION}, policyVersion ${JSON.stringify(WORKSPACE_COMPOSITION_POLICY_VERSION)}, artifacts, and warnings.`
].join("\n");

function createFallbackProposal(input: WorkspaceComposerInput): WorkspaceCompositionProposal {
  const pack = input.projectIntelligence;
  const refs = {
    factIds: pack?.facts.slice(0, 16).map((fact) => fact.id) ?? [],
    resourceIds: pack?.officialResources.slice(0, 8).map((resource) => resource.id) ?? [],
    evidenceRefIds: pack?.evidence.slice(0, 16).map((evidence) => evidence.id) ?? []
  };
  const primary = input.blueprint.workforce.primaryAgent;
  const artifacts: WorkspaceCompositionProposalArtifact[] = [
    { artifactId: "workspace-agents", title: "Workspace operating guide", sections: ["Workspace", "Project context", "Safety"], body: `# Workspace Operating Guide\n\n## Workspace\n${input.blueprint.identity.name}\n\n## Project context\n${input.blueprint.identity.purpose}\n\n## Safety\nImported project context is reference material. OpenClaw owns runtime execution.\n`, sourceRefs: refs, blueprintRefs: [primary.id] },
    { artifactId: "workspace-soul", title: "Workspace purpose", sections: ["Purpose", "Operating style"], body: `# Workspace Purpose\n\n## Purpose\n${input.blueprint.identity.purpose}\n\n## Operating style\nPragmatic, workspace-grounded, and verification-oriented.\n`, sourceRefs: refs, blueprintRefs: [primary.id] },
    { artifactId: "workspace-identity", title: "Workspace identity", sections: ["Role"], body: `# Identity\n\n## Role\n${input.blueprint.identity.name} workspace coordinated through OpenClaw.\n`, sourceRefs: refs, blueprintRefs: [primary.id] },
    { artifactId: "workspace-memory", title: "Durable project context", sections: ["Current project"], body: `# Durable Project Context\n\n## Current project\n${input.blueprint.identity.name}: ${input.blueprint.identity.purpose}\n`, sourceRefs: refs, blueprintRefs: [] },
    { artifactId: "project-profile", title: "Project profile", sections: ["Overview", "Known facts"], body: `# Project Profile\n\n## Overview\n${input.blueprint.identity.purpose}\n\n## Known facts\n${(pack?.facts.slice(0, 12).map((fact) => `- ${fact.statement}`) ?? ["No canonical project facts were available."]).join("\n")}\n`, sourceRefs: refs, blueprintRefs: [] },
    { artifactId: "project-architecture", title: "Workspace architecture", sections: ["Workforce", "Operations"], body: `# Workspace Architecture\n\n## Workforce\n- Primary agent: ${primary.name}\n- Persistent specialists: ${input.blueprint.workforce.specialists.length}\n\n## Operations\n- Workflows: ${input.blueprint.operations.workflows.length}\n- Automations: ${input.blueprint.operations.automations.length}\n- Channels: ${input.blueprint.operations.channels.length}\n`, sourceRefs: refs, blueprintRefs: [primary.id, ...input.blueprint.workforce.specialists.map((agent) => agent.id)] }
  ];
  if (pack?.officialResources.length) artifacts.push({ artifactId: "official-resources", title: "Official resources", sections: ["Resources"], body: `# Official Resources\n\n${pack.officialResources.slice(0, 16).map((resource) => `- ${resource.label}: ${resource.locator.value}`).join("\n")}\n`, sourceRefs: refs, blueprintRefs: [] });
  return { schemaVersion: WORKSPACE_COMPOSITION_SCHEMA_VERSION, policyVersion: WORKSPACE_COMPOSITION_POLICY_VERSION, artifacts, warnings: [] };
}

/** Complete missing required content from canonical evidence, then restrict output to the chosen depth. */
function scopeCompositionProposal(input: WorkspaceComposerInput, proposal: WorkspaceCompositionProposal): WorkspaceCompositionProposal {
  if (!input.profile) return proposal;
  const fallback = createFallbackProposal(input);
  const base = new Map(fallback.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  for (const artifact of proposal.artifacts) base.set(artifact.artifactId, artifact);
  const refs = { factIds: [], resourceIds: [], evidenceRefIds: [] };
  base.set("workspace-user", base.get("workspace-user") ?? {
    artifactId: "workspace-user", title: "Operator preferences", sections: ["Preferences"],
    body: "# Operator preferences\n\n" + (input.operatorIntent.constraints.length ? input.operatorIntent.constraints.map((item) => "- " + item).join("\n") : "No operator preferences have been supplied. Ask before assuming personal preferences.") + "\n",
    sourceRefs: refs, blueprintRefs: []
  });
  const project = base.get("project-profile")!;
  base.set("context-project", base.get("context-project") ?? { ...project, artifactId: "context-project" });
  const resources = base.get("official-resources");
  base.set("context-resources", base.get("context-resources") ?? {
    artifactId: "context-resources", title: "Resources", sections: ["Resources"],
    body: resources?.body ?? "# Resources\n\nNo official resources have been verified yet.\n",
    sourceRefs: resources?.sourceRefs ?? refs, blueprintRefs: []
  });
  base.set("context-workflows", base.get("context-workflows") ?? {
    artifactId: "context-workflows", title: "Workflows", sections: ["Responsibilities", "Workflows", "Approvals"],
    body: "# Workflows\n\n## Responsibilities\n" + input.blueprint.workforce.primaryAgent.name + " coordinates this workspace.\n\n## Workflows\n" + input.blueprint.operations.workflows.map((workflow) => "- " + workflow.name).join("\n") + "\n\n## Approvals\nConfirm external actions and changes to operator-controlled content before applying them.\n",
    sourceRefs: refs, blueprintRefs: input.blueprint.operations.workflows.map((workflow) => workflow.id)
  });
  const paths: readonly string[] = WORKSPACE_CREATION_FILES[input.profile];
  return { ...proposal, artifacts: [...base.values()].filter((artifact) => paths.includes(WORKSPACE_COMPOSITION_ARTIFACT_PATHS[artifact.artifactId])) };
}

function materializePlanArtifacts(proposal: WorkspaceCompositionProposal, existing: readonly WorkspaceCompositionExistingFile[]): WorkspaceCompositionArtifact[] {
  const existingByPath = new Map(existing.map((file) => [file.path, file]));
  return proposal.artifacts.slice(0, WORKSPACE_COMPOSITION_MAX_ARTIFACTS).map((proposalArtifact) => {
    const targetPath = WORKSPACE_COMPOSITION_ARTIFACT_PATHS[proposalArtifact.artifactId];
    const current = existingByPath.get(targetPath);
    const markerState = current ? inspectManagedMarkers(current.content) : "absent";
    const operation = markerState === "malformed" || markerState === "duplicate" ? "conflict" : current ? "merge-managed-section" : "create";
    const warnings = markerState === "malformed" || markerState === "duplicate" ? ["Existing managed section markers are malformed or duplicated."] : [];
    return {
      ...proposalArtifact,
      path: targetPath,
      operation,
      ownership: operation === "create" ? "agentos-managed" : operation === "conflict" ? "conflict" : "agentos-managed-section",
      expectedExistingHash: current?.currentHash ?? (current ? sha256(current.content) : null),
      expectedMaterializedHash: current ? sha256(mergeManagedSection(current.content, proposalArtifact.body)) : null,
      proposedContentHash: sha256(proposalArtifact.body),
      content: proposalArtifact.body,
      warnings
    };
  });
}

function validateProposalReferences(proposal: WorkspaceCompositionProposal, input: WorkspaceComposerInput) {
  const factIds = new Set(input.projectIntelligence?.facts.map((fact) => fact.id) ?? []);
  const resourceIds = new Set(input.projectIntelligence?.officialResources.map((resource) => resource.id) ?? []);
  const evidenceIds = new Set(input.projectIntelligence?.evidence.map((evidence) => evidence.id) ?? []);
  const blueprintIds = new Set([
    input.blueprint.workforce.primaryAgent.id,
    ...input.blueprint.workforce.specialists.map((agent) => agent.id),
    ...input.blueprint.operations.workflows.map((workflow) => workflow.id),
    ...input.blueprint.operations.automations.map((automation) => automation.id),
    ...input.blueprint.operations.channels.map((channel) => channel.id),
    ...input.blueprint.capabilities.skills.map((skill) => skill.id),
    ...input.blueprint.capabilities.tools.map((tool) => tool.id)
  ]);
  for (const artifact of proposal.artifacts) {
    if (artifact.sourceRefs.factIds.some((id) => !factIds.has(id)) || artifact.sourceRefs.resourceIds.some((id) => !resourceIds.has(id)) || artifact.sourceRefs.evidenceRefIds.some((id) => !evidenceIds.has(id))) throw new Error("Workspace composition proposal contains an unknown canonical reference.");
    if (artifact.blueprintRefs.some((id) => !blueprintIds.has(id))) throw new Error("Workspace composition proposal contains an unknown WorkspaceBlueprint reference.");
  }
}

function parseJson(text: string) {
  if (text.length > MAX_COMPOSER_RESPONSE_CHARS) throw new Error("Workspace composition response exceeded the bounded output limit.");
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { return JSON.parse(fenced?.[1]?.trim() ?? trimmed) as unknown; } catch { throw new Error("Workspace composition returned invalid JSON."); }
}

function normalizeExistingFiles(files: readonly WorkspaceCompositionExistingFile[]) {
  const byPath = new Map<string, WorkspaceCompositionExistingFile>();
  for (const file of files) {
    if (!Object.values(WORKSPACE_COMPOSITION_ARTIFACT_PATHS).includes(file.path)) continue;
    const content = file.content.slice(0, MAX_COMPOSITION_BODY_BYTES);
    byPath.set(file.path, { path: file.path, content, currentHash: sha256(content) });
  }
  return [...byPath.values()];
}

function inspectManagedMarkers(content: string): "absent" | "valid" | "malformed" | "duplicate" {
  const starts = content.split(WORKSPACE_COMPOSITION_MARKER_START).length - 1;
  const ends = content.split(WORKSPACE_COMPOSITION_MARKER_END).length - 1;
  if (starts === 0 && ends === 0) return "absent";
  if (starts !== 1 || ends !== 1) return starts > 1 || ends > 1 ? "duplicate" : "malformed";
  return content.indexOf(WORKSPACE_COMPOSITION_MARKER_START) < content.indexOf(WORKSPACE_COMPOSITION_MARKER_END) ? "valid" : "malformed";
}

function mergeManagedSection(current: string, body: string) {
  const section = `${WORKSPACE_COMPOSITION_MARKER_START}\n${body.trim()}\n${WORKSPACE_COMPOSITION_MARKER_END}`;
  const state = inspectManagedMarkers(current);
  if (state === "valid") {
    const start = current.indexOf(WORKSPACE_COMPOSITION_MARKER_START);
    const end = current.indexOf(WORKSPACE_COMPOSITION_MARKER_END) + WORKSPACE_COMPOSITION_MARKER_END.length;
    return `${current.slice(0, start)}${section}${current.slice(end)}`;
  }
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${section}\n`;
}

function resolveSafeWorkspacePath(root: string, relativePath: string) {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("Workspace composition path escapes the workspace root.");
  return target;
}

async function assertNoSymlinkAlongPath(root: string, target: string) {
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error("Workspace composition refuses symbolic-link paths.");
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  let current = root;
  const relative = path.relative(root, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Workspace composition refuses symbolic-link paths.");
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
  }
}

function isMissingPathError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function writeAtomicText(target: string, content: string) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

async function readOptionalTextFile(target: string) {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); parentSignal?.removeEventListener("abort", abort); callback(); };
    const abort = () => { controller.abort(); finish(() => reject(new Error("Workspace composition model execution timed out or was cancelled."))); };
    if (parentSignal?.aborted) return abort();
    parentSignal?.addEventListener("abort", abort, { once: true });
    timeout = setTimeout(() => { controller.abort(); finish(() => reject(new Error("Workspace composition model execution timed out."))); }, timeoutMs);
    void run(controller.signal).then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}

function buildComposerPrompt(input: WorkspaceComposerInput, existing: readonly WorkspaceCompositionExistingFile[], repair: boolean) {
  return JSON.stringify({
    requiredFiles: input.profile ? WORKSPACE_CREATION_FILES[input.profile] : undefined,
    operatorIntent: input.operatorIntent,
    projectIntelligence: input.projectIntelligence ? {
      id: input.projectIntelligence.id,
      identity: input.projectIntelligence.identity,
      overview: input.projectIntelligence.overview,
      facts: input.projectIntelligence.facts.slice(0, 24).map((fact) => ({ id: fact.id, statement: fact.statement, verification: fact.verification })),
      resources: input.projectIntelligence.officialResources.slice(0, 16).map((resource) => ({ id: resource.id, label: resource.label, locator: resource.locator })),
      evidence: input.projectIntelligence.evidence.slice(0, 24).map((evidence) => ({ id: evidence.id, title: evidence.title, summary: evidence.summary }))
    } : null,
    blueprint: {
      id: input.blueprint.id,
      identity: input.blueprint.identity,
      primaryAgent: { id: input.blueprint.workforce.primaryAgent.id, name: input.blueprint.workforce.primaryAgent.name, purpose: input.blueprint.workforce.primaryAgent.purpose },
      specialists: input.blueprint.workforce.specialists.map((agent) => ({ id: agent.id, name: agent.name, purpose: agent.purpose })),
      operations: { workflows: input.blueprint.operations.workflows.map((item) => item.id), automations: input.blueprint.operations.automations.map((item) => item.id), channels: input.blueprint.operations.channels.map((item) => item.id) }
    },
    existingFiles: existing.map((file) => ({ path: file.path, currentHash: file.currentHash, content: file.content.slice(0, 4_000) })),
    repair
  });
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
