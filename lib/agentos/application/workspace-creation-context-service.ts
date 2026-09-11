import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_KNOWLEDGE_INGESTION_LIMITS,
  ingestKnowledgeSources,
  promoteKnowledgeCorpus,
  readKnowledgeSnapshot,
  type KnowledgeHostResolver,
  type KnowledgeIngestionProgress,
  type KnowledgeIngestionSourceReport,
  type KnowledgeWebsiteFetcher
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  normalizeWorkspaceKnowledgeSources,
  workspaceKnowledgeSourceIdentity,
  type WorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import { readStoredRunFile, resolveProvisioningRoot, writeAtomicJson, WORKSPACE_PROVISIONING_ROOT } from "@/lib/agentos/application/workspace-provisioning-store";
import { readWorkspaceCreationRunFile, resolveWorkspaceCreationRunRoot, WORKSPACE_CREATION_RUN_ROOT } from "@/lib/agentos/application/workspace-creation-run-store";
import { validateWorkspaceIntelligenceBinding, WORKSPACE_INTELLIGENCE_BINDING_ROOT } from "@/lib/agentos/application/workspace-intelligence-binding-store";
import {
  createProjectIntelligenceExtractionInputFingerprint,
  extractProjectIntelligence,
  summarizeProjectIntelligenceExtraction,
  validateProjectIntelligenceExtraction,
  type ProjectIntelligenceExtraction,
  type ProjectIntelligenceExtractionDocument,
  type ProjectIntelligenceExtractionSummary
} from "@/lib/agentos/application/project-intelligence-extraction-service";
import type { ProjectDiscoveryManifest } from "@/lib/agentos/domains/project-discovery";
import {
  validateProjectIntelligencePack,
  type ProjectIntelligencePack
} from "@/lib/agentos/domains/project-intelligence";
import type {
  WorkspaceArchitectCorpusDocument,
  WorkspaceArchitectKnowledgeInput
} from "@/lib/agentos/domains/workspace-blueprint";
import {
  validateWorkspaceCompositionPlan,
  type WorkspaceCompositionPlan
} from "@/lib/agentos/domains/workspace-composition";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import { redactSecretText } from "@/lib/security/redaction";

const WORKSPACE_CREATION_CONTEXT_ROOT = path.join(missionControlRootPath, "workspace-create");
const WORKSPACE_CREATION_CONTEXT_SCHEMA_VERSION = 1;
const WORKSPACE_CREATION_CONTEXT_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CONTEXT_SOURCES = 24;
const MAX_RELATIVE_UPLOAD_PATH_LENGTH = 400;
const DRAFT_ID_PATTERN = /^[a-f0-9-]{36}$/i;

const MULTIPART_REQUEST_OVERHEAD_BYTES = 1_048_576;

export const WORKSPACE_CREATION_UPLOAD_LIMITS = {
  maxFiles: Math.min(120, DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxFilesPerSource),
  maxBytesPerFile: DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxBytesPerDocument,
  maxBytesPerSource: DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxTotalBytesPerSource,
  maxBytesTotal: DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxTotalBytesPerSource * 4,
  maxRequestBytes: DEFAULT_KNOWLEDGE_INGESTION_LIMITS.maxTotalBytesPerSource * 4 + MULTIPART_REQUEST_OVERHEAD_BYTES
} as const;

export type WorkspaceCreationUploadManifestEntry = {
  sourceId: string;
  relativePath: string;
  fileName?: string;
};

export function validateWorkspaceCreationUploadMetadata(
  files: readonly { name: string; size: number }[],
  manifest: readonly WorkspaceCreationUploadManifestEntry[]
) {
  if (files.length > WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles || manifest.length > WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles) {
    throw new Error("Too many files selected.");
  }
  if (files.length !== manifest.length) {
    throw new Error("Uploaded project context metadata does not match the files supplied.");
  }

  const sourceTotals = new Map<string, number>();
  let totalBytes = 0;
  for (const [index, file] of files.entries()) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Uploaded project context contains an invalid file.");
    if (file.size > WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile) throw new Error("File is too large for project analysis.");
    const manifestEntry = manifest[index];
    const manifestFileName = manifestEntry?.fileName;
    const manifestBaseName = path.posix.basename(manifestEntry?.relativePath.replace(/\\/g, "/") ?? "");
    if (!manifestEntry || manifestBaseName !== file.name || (manifestFileName !== undefined && manifestFileName !== file.name)) {
      throw new Error("Uploaded project context metadata does not match the files supplied.");
    }
    totalBytes += file.size;
    const sourceId = manifestEntry.sourceId;
    const sourceTotal = (sourceTotals.get(sourceId) ?? 0) + file.size;
    sourceTotals.set(sourceId, sourceTotal);
    if (sourceTotal > WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerSource) throw new Error("Project context is too large for analysis.");
  }
  if (totalBytes > WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesTotal) throw new Error("Project context is too large for analysis.");
}

export async function readWorkspaceCreationFileWithinLimits(file: File, limit: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Project context is too large for analysis.");
  const reader = file.stream().getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("Upload reading was cancelled.", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      if (total + chunk.byteLength > limit) throw new Error("Uploaded project context exceeds the size limit.");
      total += chunk.byteLength;
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
}

export async function readWorkspaceCreationRequestBodyWithinLimit(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      if (request.signal.aborted) throw new DOMException("Upload reading was cancelled.", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      if (total + next.value.byteLength > limit) throw new Error("Project context is too large for analysis.");
      total += next.value.byteLength;
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, total);
}

const MAX_UPLOAD_FILES = WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles;
const MAX_UPLOAD_BYTES_PER_FILE = WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile;
const MAX_UPLOAD_BYTES = WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerSource;
const MAX_UPLOAD_BYTES_TOTAL = WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesTotal;

type WorkspaceCreationContextSourceStatus = "attached" | "reading" | "ready" | "partial" | "error" | "unsupported";

export type WorkspaceCreationUpload = {
  sourceId: string;
  relativePath: string;
  fileName: string;
  bytes: Buffer;
};

export type WorkspaceCreationContextSourceReport = {
  sourceId: string;
  sourceKind: WorkspaceKnowledgeSource["kind"];
  status: WorkspaceCreationContextSourceStatus;
  support: "supported" | "partial" | "declaration-only";
  discoveredItems: number;
  fetchedItems: number;
  storedDocuments: number;
  warningCount: number;
  warnings: string[];
  error: string | null;
};

export type WorkspaceCreationContextStageResult = {
  draftContextId: string;
  generationId: string | null;
  runStatus: "ready" | "partial" | "error" | "cancelled" | "reused";
  reused: boolean;
  sources: WorkspaceKnowledgeSource[];
  sourceReports: WorkspaceCreationContextSourceReport[];
  warnings: string[];
  extractionSummary?: ProjectIntelligenceExtractionSummary;
  intelligenceSummary?: WorkspaceCreationIntelligenceSummary;
};

export type WorkspaceCreationContextResult = WorkspaceCreationContextStageResult & {
  knowledge: WorkspaceArchitectKnowledgeInput;
  extraction?: ProjectIntelligenceExtraction;
  discoveryManifests?: ProjectDiscoveryManifest[];
};

export type WorkspaceCreationContextOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: KnowledgeIngestionProgress) => void | Promise<void>;
  websiteFetcher?: KnowledgeWebsiteFetcher;
  networkResolver?: KnowledgeHostResolver;
  /** Explicit reanalysis bypasses the same-intake reuse shortcut. */
  forceRefresh?: boolean;
};

export type WorkspaceCreationIntelligenceSummary = {
  packId: string;
  inputFingerprint: string;
  synthesisStatus: "model" | "fallback";
  state: ProjectIntelligencePack["state"];
  factCount: number;
  evidenceCount: number;
  resourceCount: number;
  conflictCount: number;
  unknownCount: number;
};

type StoredUpload = {
  relativePath: string;
  fileName: string;
  size: number;
  contentHash: string;
};

type StoredContext = {
  schemaVersion: typeof WORKSPACE_CREATION_CONTEXT_SCHEMA_VERSION;
  draftContextId: string;
  actorHash: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  fingerprint: string;
  generationId: string | null;
  sources: WorkspaceKnowledgeSource[];
  uploads: Record<string, StoredUpload[]>;
  sourceReports: WorkspaceCreationContextSourceReport[];
  warnings: string[];
  intakeStatus?: "staged" | "analyzed";
  extraction?: ProjectIntelligenceExtractionSummary;
  intelligenceSummary?: WorkspaceCreationIntelligenceSummary;
};

const contextLocks = new Map<string, Promise<void>>();

/** Persist intake bytes and metadata before a background creation run is acknowledged. */
export async function persistWorkspaceCreationIntake(input: {
  actorId: string;
  draftContextId?: string | null;
  sources: unknown[];
  uploads?: WorkspaceCreationUpload[];
}) {
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error("Workspace context ownership is unavailable.");
  const draftContextId = input.draftContextId ? assertDraftContextId(input.draftContextId) : randomUUID();
  const lockKey = `${actorHash(actorId)}:${draftContextId}`;
  return withContextLock(lockKey, async () => {
    await cleanupExpiredWorkspaceCreationContexts();
    const sources = normalizeWorkspaceKnowledgeSources(input.sources);
    if (sources.length > MAX_CONTEXT_SOURCES) throw new Error("Too many project context sources were supplied.");
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const draftRoot = resolveDraftRoot(actorId, draftContextId);
    const previous = await readStoredContext(draftRoot);
    const uploads = input.uploads ?? [];
    assertActualUploadLimits(uploads);
    const storedUploads = await prepareUploads(draftRoot, sourceById, groupUploads(uploads, sourceById), previous?.uploads ?? {});
    await cleanupRemovedUploadRoots(draftRoot, previous?.uploads ?? {}, sourceById);
    const fingerprint = createContextFingerprint(sources, storedUploads);
    const sameIntake = previous?.fingerprint === fingerprint;
    if (!sameIntake) {
      await removeStoredExtraction(draftRoot);
      await removeStoredIntelligence(draftRoot);
    }
    await writeStoredContext(draftRoot, createStoredContext({
      actorId,
      draftContextId,
      fingerprint,
      generationId: sameIntake ? previous?.generationId ?? null : null,
      sources: sources.map(publicSource),
      uploads: storedUploads,
      sourceReports: sameIntake && previous?.sourceReports.length ? previous.sourceReports : sources.map((source) => ({
        sourceId: source.id,
        sourceKind: source.kind,
        status: "attached",
        support: "partial",
        discoveredItems: 0,
        fetchedItems: 0,
        storedDocuments: 0,
        warningCount: 0,
        warnings: [],
        error: null
      })),
      warnings: sameIntake ? previous?.warnings ?? [] : [],
      extraction: sameIntake ? previous?.extraction : undefined,
      intelligenceSummary: sameIntake ? previous?.intelligenceSummary : undefined,
      intakeStatus: "staged"
    }));
    return { draftContextId, sources: sources.map(publicSource), fingerprint };
  });
}

/**
 * Create an immutable reanalysis context from an existing context. Only the
 * normalized source declarations and protected upload bytes are copied; the
 * corpus, extraction, intelligence pack, and composition plan are always
 * generated in the child namespace.
 */
export async function cloneWorkspaceCreationContext(input: {
  actorId: string;
  sourceDraftContextId: string;
  targetDraftContextId: string;
}) {
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error("Workspace context ownership is unavailable.");
  const sourceDraftContextId = assertDraftContextId(input.sourceDraftContextId);
  const targetDraftContextId = assertDraftContextId(input.targetDraftContextId);
  if (sourceDraftContextId === targetDraftContextId) throw new Error("Workspace reanalysis requires a new context generation.");

  const lockKeys = [`${actorHash(actorId)}:${sourceDraftContextId}`, `${actorHash(actorId)}:${targetDraftContextId}`].sort();
  return withContextLocks(lockKeys, async () => {
    await cleanupExpiredWorkspaceCreationContexts();
    const sourceRoot = resolveDraftRoot(actorId, sourceDraftContextId);
    const targetRoot = resolveDraftRoot(actorId, targetDraftContextId);
    const existing = await readStoredContext(targetRoot);
    if (existing) {
      if (existing.actorHash !== actorHash(actorId)) throw new Error("Workspace context is unavailable.");
      return { draftContextId: targetDraftContextId, sources: existing.sources, fingerprint: existing.fingerprint };
    }
    const source = await readStoredContext(sourceRoot);
    if (!source || source.actorHash !== actorHash(actorId) || Date.parse(source.expiresAt) <= Date.now()) {
      throw new Error("Workspace context is unavailable or expired.");
    }

    const sourceById = new Map(source.sources.map((entry) => [entry.id, entry]));
    const copiedUploads: Record<string, StoredUpload[]> = {};
    try {
      let aggregateBytes = 0;
      for (const [sourceId, entries] of Object.entries(source.uploads)) {
        const sourceEntry = sourceById.get(sourceId);
        if (!sourceEntry || (sourceEntry.kind !== "file" && sourceEntry.kind !== "folder")) throw new Error("Workspace context upload metadata is invalid.");
        if (entries.length > MAX_UPLOAD_FILES) throw new Error("Too many uploaded project files were supplied.");
        let sourceBytes = 0;
        const targetEntries: StoredUpload[] = [];
        const seenPaths = new Set<string>();
        for (const entry of entries) {
          if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_UPLOAD_BYTES_PER_FILE) throw new Error("Uploaded project context exceeds the size limit.");
          sourceBytes += entry.size;
          aggregateBytes += entry.size;
          if (sourceBytes > MAX_UPLOAD_BYTES || aggregateBytes > MAX_UPLOAD_BYTES_TOTAL) throw new Error("Uploaded project context exceeds the size limit.");
          const relativePath = normalizeUploadRelativePath(entry.relativePath, sourceEntry.kind === "file");
          if (seenPaths.has(relativePath)) throw new Error("Uploaded project files must have unique relative paths.");
          seenPaths.add(relativePath);
          const sourcePath = path.join(resolveUploadRoot(sourceRoot, sourceId), ...relativePath.split("/"));
          const targetPath = path.join(resolveUploadRoot(targetRoot, sourceId), ...relativePath.split("/"));
          await assertNoSymlinkAlongPath(sourceRoot, sourcePath);
          const sourceMetadata = await lstat(sourcePath).catch(() => null);
          if (!sourceMetadata?.isFile() || sourceMetadata.size !== entry.size) throw new Error("Workspace context upload material is unavailable.");
          await assertNoSymlinkAlongPath(targetRoot, targetPath);
          await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
          await copyFile(sourcePath, targetPath);
          await syncFile(targetPath);
          if (await hashFileWithinLimits(targetPath, MAX_UPLOAD_BYTES_PER_FILE) !== entry.contentHash) throw new Error("Workspace context upload integrity could not be verified.");
          targetEntries.push({ ...entry, relativePath });
        }
        copiedUploads[sourceId] = targetEntries;
      }
      const cloned = createStoredContext({
        actorId,
        draftContextId: targetDraftContextId,
        fingerprint: createContextFingerprint(source.sources, copiedUploads),
        generationId: null,
        sources: source.sources,
        uploads: copiedUploads,
        sourceReports: source.sources.map((entry) => ({
          sourceId: entry.id,
          sourceKind: entry.kind,
          status: "attached",
          support: "partial",
          discoveredItems: 0,
          fetchedItems: 0,
          storedDocuments: 0,
          warningCount: 0,
          warnings: [],
          error: null
        })),
        warnings: [],
        intakeStatus: "staged"
      });
      await writeStoredContext(targetRoot, cloned);
      return { draftContextId: targetDraftContextId, sources: cloned.sources, fingerprint: cloned.fingerprint };
    } catch (error) {
      await rm(targetRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });
}

export async function stageWorkspaceCreationKnowledge(
  input: {
    actorId: string;
    draftContextId?: string | null;
    sources: unknown[];
    uploads?: WorkspaceCreationUpload[];
  } & WorkspaceCreationContextOptions
): Promise<WorkspaceCreationContextStageResult> {
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error("Workspace context ownership is unavailable.");
  const draftContextId = input.draftContextId ? assertDraftContextId(input.draftContextId) : randomUUID();
  const lockKey = `${actorHash(actorId)}:${draftContextId}`;
  return withContextLock(lockKey, () => stageWorkspaceCreationKnowledgeLocked({ ...input, actorId, draftContextId }));
}

async function stageWorkspaceCreationKnowledgeLocked(
  input: {
    actorId: string;
    draftContextId: string;
    sources: unknown[];
    uploads?: WorkspaceCreationUpload[];
  } & WorkspaceCreationContextOptions
): Promise<WorkspaceCreationContextStageResult> {
  await cleanupExpiredWorkspaceCreationContexts();
  const sources = normalizeWorkspaceKnowledgeSources(input.sources);
  if (sources.length > MAX_CONTEXT_SOURCES) throw new Error("Too many project context sources were supplied.");
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const draftRoot = resolveDraftRoot(input.actorId, input.draftContextId);
  const previous = await readStoredContext(draftRoot);
  if (previous && previous.actorHash !== actorHash(input.actorId)) throw new Error("Workspace context is unavailable.");

  const uploads = input.uploads ?? [];
  assertActualUploadLimits(uploads);
  const uploadGroups = groupUploads(uploads, sourceById);
  const storedUploads = await prepareUploads(draftRoot, sourceById, uploadGroups, previous?.uploads ?? {});
  await cleanupRemovedUploadRoots(draftRoot, previous?.uploads ?? {}, sourceById);
  const fingerprint = createContextFingerprint(sources, storedUploads);
  if (previous?.fingerprint !== fingerprint) {
    await removeStoredExtraction(draftRoot);
    await removeStoredIntelligence(draftRoot);
  }
  const publicSources = sources.map(publicSource);

  if (!input.forceRefresh && previous?.fingerprint === fingerprint && previous.generationId && previous.sourceReports.every((report) => report.status === "ready")) {
    const snapshot = await readKnowledgeSnapshot(
      path.join(draftRoot, "corpus"),
      path.join(draftRoot, "state")
    );
    if (snapshot?.state.generationId === previous.generationId) {
      const extraction = await ensureProjectIntelligenceExtraction({
        draftRoot,
        generationId: previous.generationId,
        inputFingerprint: fingerprint,
        sources,
        documents: snapshot.documents,
        discoveryManifests: snapshot.state.discoveryManifests ?? []
      });
      await writeStoredContext(draftRoot, {
        ...previous,
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + WORKSPACE_CREATION_CONTEXT_TTL_MS).toISOString(),
        extraction: summarizeProjectIntelligenceExtraction(extraction),
        intakeStatus: "analyzed"
      });
      return {
        draftContextId: input.draftContextId,
        generationId: previous.generationId,
        runStatus: "reused",
        reused: true,
        sources: publicSources,
        sourceReports: previous.sourceReports,
        warnings: previous.warnings,
        extractionSummary: summarizeProjectIntelligenceExtraction(extraction),
        intelligenceSummary: previous.intelligenceSummary
      };
    }
  }

  const ingestionSources = sources.map((source) => toIngestionSource(source, draftRoot, storedUploads[source.id] ?? []));
  if (sources.length === 0) {
    const extraction = await ensureProjectIntelligenceExtraction({
      draftRoot,
      generationId: null,
      inputFingerprint: fingerprint,
      sources,
      documents: [],
      discoveryManifests: []
    });
    const emptyContext = createStoredContext({
      actorId: input.actorId,
      draftContextId: input.draftContextId,
      fingerprint,
      generationId: null,
      sources: publicSources,
      uploads: storedUploads,
      sourceReports: [],
      warnings: [],
      extraction: summarizeProjectIntelligenceExtraction(extraction),
      intakeStatus: "analyzed"
    });
    await writeStoredContext(draftRoot, emptyContext);
    return {
      draftContextId: input.draftContextId,
      generationId: null,
      runStatus: "ready",
      reused: false,
      sources: publicSources,
      sourceReports: [],
      warnings: [],
      extractionSummary: summarizeProjectIntelligenceExtraction(extraction),
      intelligenceSummary: emptyContext.intelligenceSummary
    };
  }

  const ingestion = await ingestKnowledgeSources({
    sources: ingestionSources,
    corpusRoot: path.join(draftRoot, "corpus"),
    stateRoot: path.join(draftRoot, "state"),
    signal: input.signal,
    onProgress: input.onProgress,
    websiteFetcher: input.websiteFetcher,
    networkResolver: input.networkResolver
  });
  const sourceReports = ingestion.sourceReports.map((report) => projectSourceReport(report));
  const warnings = ingestion.state.warnings.map((warning) => sanitizeDiagnostic(warning));
  if (ingestion.run.status === "cancelled") {
    const sameIntake = previous?.fingerprint === fingerprint;
    await writeStoredContext(draftRoot, createStoredContext({
      actorId: input.actorId,
      draftContextId: input.draftContextId,
      fingerprint,
      generationId: ingestion.state.generationId ?? (sameIntake ? previous?.generationId ?? null : null),
      sources: publicSources,
      uploads: storedUploads,
      sourceReports,
      warnings,
      intelligenceSummary: sameIntake ? previous?.intelligenceSummary : undefined,
      intakeStatus: "analyzed"
    }));
    return {
      draftContextId: input.draftContextId,
      generationId: ingestion.state.generationId ?? (sameIntake ? previous?.generationId ?? null : null),
      runStatus: "cancelled",
      reused: false,
      sources: publicSources,
      sourceReports,
      warnings
    };
  }
  const storedContext = createStoredContext({
    actorId: input.actorId,
    draftContextId: input.draftContextId,
    fingerprint,
    generationId: ingestion.state.generationId ?? null,
    sources: publicSources,
    uploads: storedUploads,
    sourceReports,
    warnings,
    intelligenceSummary: previous?.fingerprint === fingerprint ? previous.intelligenceSummary : undefined,
    intakeStatus: "analyzed"
  });
  const snapshot = ingestion.state.generationId
    ? await readKnowledgeSnapshot(path.join(draftRoot, "corpus"), path.join(draftRoot, "state"))
    : null;
  const extraction = await ensureProjectIntelligenceExtraction({
    draftRoot,
    generationId: ingestion.state.generationId ?? null,
    inputFingerprint: fingerprint,
    sources,
    documents: snapshot?.documents ?? [],
    discoveryManifests: ingestion.state.discoveryManifests ?? []
  });
  const finalizedContext = { ...storedContext, extraction: summarizeProjectIntelligenceExtraction(extraction) };
  await writeStoredContext(draftRoot, finalizedContext);
  return {
    draftContextId: input.draftContextId,
    generationId: ingestion.state.generationId ?? null,
    runStatus: ingestion.run.status === "partial" ? "partial" : ingestion.run.status === "error" ? "error" : "ready",
    reused: false,
    sources: publicSources,
    sourceReports,
    warnings,
    extractionSummary: summarizeProjectIntelligenceExtraction(extraction),
    intelligenceSummary: finalizedContext.intelligenceSummary
  };
}

export async function readWorkspaceCreationContext(input: {
  actorId: string;
  draftContextId: string;
}): Promise<WorkspaceCreationContextResult> {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) {
    throw new Error("Workspace context is unavailable or expired.");
  }
  if (stored.intakeStatus === "staged" && !stored.generationId) throw new Error("Workspace context is still being analyzed.");

  const snapshot = stored.generationId
    ? await readKnowledgeSnapshot(path.join(draftRoot, "corpus"), path.join(draftRoot, "state"))
    : null;
  const documents = snapshot ? await readBoundedArchitectDocuments(path.join(draftRoot, "corpus"), snapshot.documents) : [];
  const failedSourceIds = new Set(stored.sourceReports.filter((report) => report.status === "error" || report.status === "unsupported").map((report) => report.sourceId));
  const sources = stored.sources.map((source) => failedSourceIds.has(source.id) ? { ...source, status: "error" as const, error: stored.sourceReports.find((report) => report.sourceId === source.id)?.error ?? "Source content could not be read." } : source);
  const runStatus = stored.intakeStatus === "staged"
    ? "partial"
    : stored.sourceReports.some((report) => report.status === "error" || report.status === "unsupported")
    ? stored.sourceReports.some((report) => report.status === "ready" || report.status === "partial") ? "partial" : "error"
    : "ready";
  return {
    ...stored,
    runStatus,
    reused: false,
    knowledge: {
      generationId: stored.generationId,
      sources,
      documents,
      warnings: stored.warnings
    },
    extractionSummary: stored.extraction,
    intelligenceSummary: stored.intelligenceSummary,
    extraction: (await readStoredExtraction(draftRoot)) ?? undefined,
    discoveryManifests: snapshot?.state.discoveryManifests
  };
}

/**
 * Returns only the durable corpus manifest for Architect metadata ranking.
 * Full document bodies remain behind the selected-document reader below.
 */
export async function readWorkspaceCreationContextMetadata(input: {
  actorId: string;
  draftContextId: string;
}): Promise<WorkspaceCreationContextResult> {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) {
    throw new Error("Workspace context is unavailable or expired.");
  }
  if (stored.intakeStatus === "staged" && !stored.generationId) throw new Error("Workspace context is still being analyzed.");
  const snapshot = stored.generationId
    ? await readKnowledgeSnapshot(path.join(draftRoot, "corpus"), path.join(draftRoot, "state"))
    : null;
  const failedSourceIds = new Set(stored.sourceReports.filter((report) => report.status === "error" || report.status === "unsupported").map((report) => report.sourceId));
  const sources = stored.sources.map((source) => failedSourceIds.has(source.id) ? { ...source, status: "error" as const, error: stored.sourceReports.find((report) => report.sourceId === source.id)?.error ?? "Source content could not be read." } : source);
  const runStatus = stored.intakeStatus === "staged"
    ? "partial"
    : stored.sourceReports.some((report) => report.status === "error" || report.status === "unsupported")
      ? stored.sourceReports.some((report) => report.status === "ready" || report.status === "partial") ? "partial" : "error"
      : "ready";
  return {
    ...stored,
    runStatus,
    reused: false,
    knowledge: {
      generationId: stored.generationId,
      sources,
      documents: (snapshot?.documents ?? []).map((document) => ({
        documentId: document.id,
        sourceId: document.sourceId,
        classification: document.classification,
        canonicalLocator: document.canonicalLocator,
        title: redactSecretText(document.title).slice(0, 160),
        summary: `${document.classification} document metadata from the staged project corpus.`,
        contentLength: document.contentLength
      })),
      warnings: stored.warnings
    },
    extractionSummary: stored.extraction,
    intelligenceSummary: stored.intelligenceSummary,
    extraction: (await readStoredExtraction(draftRoot)) ?? undefined,
    discoveryManifests: snapshot?.state.discoveryManifests
  };
}

/** Read only the manifest-selected bodies requested by the Architect. */
export async function readWorkspaceCreationContextDocuments(input: {
  actorId: string;
  draftContextId: string;
  documentIds: readonly string[];
  signal?: AbortSignal;
}): Promise<WorkspaceArchitectCorpusDocument[]> {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) {
    throw new Error("Workspace context is unavailable or expired.");
  }
  const snapshot = stored.generationId
    ? await readKnowledgeSnapshot(path.join(draftRoot, "corpus"), path.join(draftRoot, "state"))
    : null;
  if (!snapshot) return [];
  const selected = new Set(input.documentIds.slice(0, 16));
  if (input.signal?.aborted) throw new DOMException("Architect document reading was cancelled.", "AbortError");
  return readBoundedArchitectDocuments(path.join(draftRoot, "corpus"), snapshot.documents, selected, input.signal);
}

export async function readWorkspaceCreationIntelligencePack(input: { actorId: string; draftContextId: string }) {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) return null;
  const raw = await readFile(path.join(draftRoot, "project-intelligence.json"), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const pack = JSON.parse(raw) as unknown;
    return validateProjectIntelligencePack(pack).valid ? pack as ProjectIntelligencePack : null;
  } catch {
    return null;
  }
}

export async function readWorkspaceCreationIntelligenceSummary(input: { actorId: string; draftContextId: string }) {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) return null;
  return stored.intelligenceSummary ?? null;
}

export async function readWorkspaceCreationCompositionPlan(input: { actorId: string; draftContextId: string }): Promise<WorkspaceCompositionPlan | null> {
  await cleanupExpiredWorkspaceCreationContexts();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const draftRoot = resolveDraftRoot(input.actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(input.actorId) || Date.parse(stored.expiresAt) <= Date.now()) return null;
  const target = path.join(draftRoot, "workspace-composition.json");
  await assertNoSymlinkAlongPath(draftRoot, target);
  let raw: string | null;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!validateWorkspaceCompositionPlan(parsed)) throw new Error("Workspace composition plan failed normalized validation.");
    return parsed;
  } catch {
    throw new Error("Stored workspace composition plan is invalid or tampered with.");
  }
}

export async function persistWorkspaceCreationCompositionPlan(input: { actorId: string; draftContextId: string; plan: WorkspaceCompositionPlan }) {
  const actorId = input.actorId.trim();
  const draftContextId = assertDraftContextId(input.draftContextId);
  if (!validateWorkspaceCompositionPlan(input.plan)) throw new Error("Workspace composition plan failed normalized validation.");
  const lockKey = `${actorHash(actorId)}:${draftContextId}`;
  return withContextLock(lockKey, async () => {
    const draftRoot = resolveDraftRoot(actorId, draftContextId);
    const stored = await readStoredContext(draftRoot);
    if (!stored || stored.actorHash !== actorHash(actorId)) throw new Error("Workspace context is unavailable.");
    const target = path.join(draftRoot, "workspace-composition.json");
    await assertNoSymlinkAlongPath(draftRoot, target);
    await writeAtomicJson(target, input.plan);
    return { planId: input.plan.planId, inputFingerprint: input.plan.inputFingerprint, status: input.plan.status };
  });
}

export async function persistWorkspaceCreationIntelligencePack(input: {
  actorId: string;
  draftContextId: string;
  inputFingerprint: string;
  pack: ProjectIntelligencePack;
  synthesisStatus?: "model" | "fallback";
}) {
  const actorId = input.actorId.trim();
  const draftContextId = assertDraftContextId(input.draftContextId);
  const validation = validateProjectIntelligencePack(input.pack);
  if (!validation.valid) throw new Error("Project Intelligence pack failed normalized validation.");
  if (!/^[a-f0-9]{64}$/i.test(input.inputFingerprint) || input.pack.provenance.generationId !== input.inputFingerprint) {
    throw new Error("Project Intelligence pack provenance does not match its synthesis input.");
  }
  const lockKey = `${actorHash(actorId)}:${draftContextId}`;
  return withContextLock(lockKey, async () => {
    const draftRoot = resolveDraftRoot(actorId, draftContextId);
    const stored = await readStoredContext(draftRoot);
    if (!stored || stored.actorHash !== actorHash(actorId)) throw new Error("Workspace context is unavailable.");
    await assertNoSymlinkAlongPath(WORKSPACE_CREATION_CONTEXT_ROOT, draftRoot);
    await mkdir(draftRoot, { recursive: true, mode: 0o700 });
    const target = path.join(draftRoot, "project-intelligence.json");
    await assertNoSymlinkAlongPath(draftRoot, target);
    await writeAtomicJson(target, input.pack);
    const summary: WorkspaceCreationIntelligenceSummary = {
      packId: input.pack.id,
      inputFingerprint: input.inputFingerprint,
      synthesisStatus: input.synthesisStatus ?? "model",
      state: input.pack.state,
      factCount: input.pack.facts.length,
      evidenceCount: input.pack.evidence.length,
      resourceCount: input.pack.officialResources.length,
      conflictCount: input.pack.conflicts.length,
      unknownCount: input.pack.unknowns.length
    };
    await writeStoredContext(draftRoot, { ...stored, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + WORKSPACE_CREATION_CONTEXT_TTL_MS).toISOString(), intelligenceSummary: summary });
    return summary;
  });
}

/**
 * Promote an actor-owned staged context into a final workspace without
 * recrawling or exposing the staging filesystem layout to callers.
 */
export async function promoteWorkspaceCreationKnowledge(input: {
  actorId: string;
  draftContextId: string;
  targetWorkspacePath: string;
  expectedGenerationId: string;
}) {
  const actorId = input.actorId.trim();
  if (!actorId) throw new Error("Workspace context ownership is unavailable.");
  const draftContextId = assertDraftContextId(input.draftContextId);
  const expectedGenerationId = input.expectedGenerationId.trim();
  if (!expectedGenerationId) throw new Error("Workspace knowledge generation is required.");

  await cleanupExpiredWorkspaceCreationContexts();
  const draftRoot = resolveDraftRoot(actorId, draftContextId);
  const stored = await readStoredContext(draftRoot);
  if (!stored || stored.actorHash !== actorHash(actorId) || Date.parse(stored.expiresAt) <= Date.now()) {
    throw new Error("Workspace context is unavailable or expired.");
  }
  if (stored.generationId !== expectedGenerationId) {
    throw new Error("Workspace context is stale; the knowledge generation changed.");
  }

  const sourceSnapshot = await readKnowledgeSnapshot(
    path.join(draftRoot, "corpus"),
    path.join(draftRoot, "state")
  );
  if (!sourceSnapshot?.state?.generationId || sourceSnapshot.state.generationId !== expectedGenerationId) {
    throw new Error("Workspace context is stale; the staged knowledge generation could not be verified.");
  }

  const targetWorkspacePath = path.resolve(input.targetWorkspacePath);
  await promoteKnowledgeCorpus({
    fromCorpusRoot: path.join(draftRoot, "corpus"),
    fromStateRoot: path.join(draftRoot, "state"),
    toCorpusRoot: path.join(targetWorkspacePath, "knowledge"),
    toStateRoot: path.join(targetWorkspacePath, ".openclaw", "knowledge")
  });

  const promoted = await readKnowledgeSnapshot(
    path.join(targetWorkspacePath, "knowledge"),
    path.join(targetWorkspacePath, ".openclaw", "knowledge")
  );
  if (!promoted?.state?.generationId) {
    throw new Error("Workspace knowledge promotion did not produce an active generation.");
  }

  return {
    stagedGenerationId: expectedGenerationId,
    generationId: promoted.state.generationId,
    sourceIds: stored.sources.map((source) => source.id),
    documentCount: promoted.documents.length
  };
}

async function readBoundedArchitectDocuments(corpusRoot: string, documents: Array<{ id: string; sourceId: string; outputPath: string; title: string; classification: string; canonicalLocator: string; contentLength: number }>, selectedIds?: ReadonlySet<string>, signal?: AbortSignal): Promise<WorkspaceArchitectCorpusDocument[]> {
  const result: WorkspaceArchitectCorpusDocument[] = [];
  for (const document of documents) {
    if (selectedIds && !selectedIds.has(document.id)) continue;
    if (signal?.aborted) throw new DOMException("Architect document reading was cancelled.", "AbortError");
    const relativePath = document.outputPath.replace(/\\/g, "/");
    const normalized = path.posix.normalize(relativePath);
    if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) continue;
    const absolutePath = path.join(corpusRoot, ...normalized.split("/"));
    await assertNoSymlinkAlongPath(corpusRoot, absolutePath);
    const content = await readFile(absolutePath, "utf8").catch(() => null);
    if (content === null) continue;
    result.push({
      documentId: document.id,
      sourceId: document.sourceId,
      classification: document.classification,
      canonicalLocator: document.canonicalLocator,
      title: redactSecretText(document.title).slice(0, 160),
      summary: `${document.classification} document read from the staged project corpus.`,
      content: redactSecretText(content).slice(0, 6_000),
      contentLength: document.contentLength
    });
  }
  return result;
}

async function ensureProjectIntelligenceExtraction(input: {
  draftRoot: string;
  generationId: string | null;
  inputFingerprint: string;
  sources: readonly WorkspaceKnowledgeSource[];
  documents: Array<{ id: string; sourceId: string; sourceKind: WorkspaceKnowledgeSource["kind"]; title: string; classification: string; canonicalLocator: string; retrievedAt: string; outputPath: string }>;
  discoveryManifests: readonly ProjectDiscoveryManifest[];
}): Promise<ProjectIntelligenceExtraction> {
  const documents = await readBoundedExtractionDocuments(input.draftRoot, input.documents);
  const extractionInputFingerprint = createProjectIntelligenceExtractionInputFingerprint({
    generationId: input.generationId,
    baseInputFingerprint: input.inputFingerprint,
    sourceIds: input.sources.map((source) => source.id),
    documents,
    discoveryManifests: input.discoveryManifests
  });
  const existing = await readStoredExtraction(input.draftRoot);
  if (existing?.generationId === input.generationId && existing.inputFingerprint === extractionInputFingerprint) return existing;
  const extraction = extractProjectIntelligence({
    generationId: input.generationId,
    inputFingerprint: extractionInputFingerprint,
    sourceIds: input.sources.map((source) => source.id),
    sources: input.sources,
    documents,
    discoveryManifests: input.discoveryManifests
  });
  await writeStoredExtraction(input.draftRoot, extraction);
  return extraction;
}

async function readBoundedExtractionDocuments(
  draftRoot: string,
  documents: Array<{ id: string; sourceId: string; sourceKind: WorkspaceKnowledgeSource["kind"]; title: string; classification: string; canonicalLocator: string; retrievedAt: string; outputPath: string }>
): Promise<ProjectIntelligenceExtractionDocument[]> {
  const corpusRoot = path.join(draftRoot, "corpus");
  const result: ProjectIntelligenceExtractionDocument[] = [];
  for (const document of documents.slice(0, 48)) {
    const normalized = path.posix.normalize(document.outputPath.replace(/\\/g, "/"));
    if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) continue;
    const absolutePath = path.join(corpusRoot, ...normalized.split("/"));
    await assertNoSymlinkAlongPath(corpusRoot, absolutePath);
    const content = await readFile(absolutePath, "utf8").catch(() => null);
    if (content === null) continue;
    result.push({
      documentId: document.id,
      sourceId: document.sourceId,
      sourceKind: document.sourceKind,
      title: document.title,
      classification: document.classification,
      canonicalLocator: document.canonicalLocator,
      retrievedAt: document.retrievedAt,
      content: content.slice(0, 6_000)
    });
  }
  return result;
}

async function readStoredExtraction(draftRoot: string): Promise<ProjectIntelligenceExtraction | null> {
  const value = await readFile(path.join(draftRoot, "intelligence-extraction.json"), "utf8").catch(() => null);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return validateProjectIntelligenceExtraction(parsed).valid ? parsed as ProjectIntelligenceExtraction : null;
  } catch {
    return null;
  }
}

async function writeStoredExtraction(draftRoot: string, extraction: ProjectIntelligenceExtraction) {
  const validation = validateProjectIntelligenceExtraction(extraction);
  if (!validation.valid) throw new Error("Project intelligence extraction failed normalized validation.");
  await assertNoSymlinkAlongPath(WORKSPACE_CREATION_CONTEXT_ROOT, draftRoot);
  await mkdir(draftRoot, { recursive: true, mode: 0o700 });
  const target = path.join(draftRoot, "intelligence-extraction.json");
  await assertNoSymlinkAlongPath(draftRoot, target);
  await writeAtomicJson(target, extraction);
}

async function removeStoredExtraction(draftRoot: string) {
  await assertNoSymlinkAlongPath(WORKSPACE_CREATION_CONTEXT_ROOT, draftRoot);
  const target = path.join(draftRoot, "intelligence-extraction.json");
  await assertNoSymlinkAlongPath(draftRoot, target);
  await rm(target, { force: true });
}

async function removeStoredIntelligence(draftRoot: string) {
  await assertNoSymlinkAlongPath(WORKSPACE_CREATION_CONTEXT_ROOT, draftRoot);
  const target = path.join(draftRoot, "project-intelligence.json");
  await assertNoSymlinkAlongPath(draftRoot, target);
  await rm(target, { force: true });
  const compositionTarget = path.join(draftRoot, "workspace-composition.json");
  await assertNoSymlinkAlongPath(draftRoot, compositionTarget);
  await rm(compositionTarget, { force: true });
}

function toIngestionSource(source: WorkspaceKnowledgeSource, draftRoot: string, uploads: StoredUpload[]): WorkspaceKnowledgeSource {
  if (source.kind === "repository" && source.locator.kind === "repository" && source.locator.localPath) {
    throw new Error("Repository sources must use a remote URL in Create Workspace.");
  }
  if (source.kind !== "file" && source.kind !== "folder") return source;
  if (uploads.length === 0) throw new Error(`${source.label} has no staged upload content.`);
  const uploadRoot = resolveUploadRoot(draftRoot, source.id);
  if (source.kind === "file" && uploads.length !== 1) throw new Error(`${source.label} must contain exactly one uploaded file.`);
  return {
    ...source,
    locator: source.kind === "file"
      ? { kind: "file", path: path.join(uploadRoot, uploads[0].relativePath) }
      : { kind: "folder", path: uploadRoot }
  };
}

function groupUploads(uploads: WorkspaceCreationUpload[], sourceById: Map<string, WorkspaceKnowledgeSource>) {
  const groups = new Map<string, WorkspaceCreationUpload[]>();
  for (const upload of uploads) {
    const source = sourceById.get(upload.sourceId);
    if (!source) throw new Error("An uploaded file references an unknown project context source.");
    if (source.kind !== "file" && source.kind !== "folder") throw new Error("Only file and folder sources can contain uploads.");
    const current = groups.get(upload.sourceId) ?? [];
    current.push(upload);
    groups.set(upload.sourceId, current);
  }
  return groups;
}

async function prepareUploads(
  draftRoot: string,
  sourceById: Map<string, WorkspaceKnowledgeSource>,
  groups: Map<string, WorkspaceCreationUpload[]>,
  previous: Record<string, StoredUpload[]>
) {
  const stored: Record<string, StoredUpload[]> = {};
  for (const [sourceId, source] of sourceById) {
    const incoming = groups.get(sourceId);
    if (!incoming) {
      if (previous[sourceId]) stored[sourceId] = previous[sourceId];
      continue;
    }
    const seenPaths = new Set<string>();
    const records: StoredUpload[] = [];
    if (incoming.length > MAX_UPLOAD_FILES) throw new Error("Too many files were supplied for one project context source.");
    const totalBytes = incoming.reduce((total, upload) => total + upload.bytes.byteLength, 0);
    if (totalBytes > MAX_UPLOAD_BYTES) throw new Error("The uploaded project context exceeds the size limit.");
    const uploadRoot = resolveUploadRoot(draftRoot, sourceId);
    await assertNoSymlinkAlongPath(draftRoot, uploadRoot);
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true, mode: 0o700 });
    for (const upload of incoming) {
      const relativePath = normalizeUploadRelativePath(upload.relativePath || upload.fileName, source.kind === "file");
      if (seenPaths.has(relativePath)) throw new Error("Uploaded project files must have unique relative paths.");
      seenPaths.add(relativePath);
      if (upload.bytes.byteLength > MAX_UPLOAD_BYTES_PER_FILE) throw new Error(`Uploaded file ${path.basename(relativePath)} exceeds the size limit.`);
      const target = path.join(uploadRoot, ...relativePath.split("/"));
      await assertNoSymlinkAlongPath(uploadRoot, target);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeDurableFile(target, upload.bytes);
      records.push({
        relativePath,
        fileName: sanitizeFileName(upload.fileName || path.basename(relativePath)),
        size: upload.bytes.byteLength,
        contentHash: sha256(upload.bytes)
      });
    }
    stored[sourceId] = records;
  }
  return stored;
}

async function cleanupRemovedUploadRoots(
  draftRoot: string,
  previous: Record<string, StoredUpload[]>,
  sourceById: Map<string, WorkspaceKnowledgeSource>
) {
  for (const sourceId of Object.keys(previous)) {
    if (sourceById.has(sourceId)) continue;
    const uploadRoot = resolveUploadRoot(draftRoot, sourceId);
    await assertNoSymlinkAlongPath(draftRoot, uploadRoot);
    await rm(uploadRoot, { recursive: true, force: true });
  }
}

function createStoredContext(input: {
  actorId: string;
  draftContextId: string;
  fingerprint: string;
  generationId: string | null;
  sources: WorkspaceKnowledgeSource[];
  uploads: Record<string, StoredUpload[]>;
  sourceReports: WorkspaceCreationContextSourceReport[];
  warnings: string[];
  extraction?: ProjectIntelligenceExtractionSummary;
  intelligenceSummary?: WorkspaceCreationIntelligenceSummary;
  intakeStatus?: "staged" | "analyzed";
}): StoredContext {
  const now = new Date().toISOString();
  return {
    schemaVersion: WORKSPACE_CREATION_CONTEXT_SCHEMA_VERSION,
    draftContextId: input.draftContextId,
    actorHash: actorHash(input.actorId),
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + WORKSPACE_CREATION_CONTEXT_TTL_MS).toISOString(),
    fingerprint: input.fingerprint,
    generationId: input.generationId,
    sources: input.sources,
    uploads: input.uploads,
    sourceReports: input.sourceReports,
    warnings: input.warnings.slice(0, 24),
    ...(input.extraction ? { extraction: input.extraction } : {}),
    ...(input.intelligenceSummary ? { intelligenceSummary: input.intelligenceSummary } : {}),
    intakeStatus: input.intakeStatus ?? "analyzed"
  };
}

function publicSource(source: WorkspaceKnowledgeSource) {
  if (source.kind === "file" || source.kind === "folder") {
    return { ...source, locator: { kind: source.kind, path: `staged-upload:${source.id}` } };
  }
  if (source.kind === "repository" && source.locator.kind === "repository" && source.locator.localPath) {
    return { ...source, locator: { kind: "repository" as const, localPath: `staged-repository:${source.id}` } };
  }
  return source;
}

function projectSourceReport(report: KnowledgeIngestionSourceReport): WorkspaceCreationContextSourceReport {
  const unsupported = report.warnings.some((warning) => /unsupported|binary|extraction is not enabled/i.test(warning));
  const status: WorkspaceCreationContextSourceStatus = report.support === "declaration-only" || unsupported
    ? "unsupported"
    : report.status === "ready"
      ? "ready"
      : report.status === "partial"
        ? "partial"
        : report.status === "cancelled"
          ? "error"
          : "error";
  return {
    sourceId: report.sourceId,
    sourceKind: report.sourceKind,
    status,
    support: report.support,
    discoveredItems: report.discoveredItems,
    fetchedItems: report.fetchedItems,
    storedDocuments: report.storedDocuments,
    warningCount: report.warningCount,
    warnings: report.warnings.map(sanitizeDiagnostic).slice(0, 8),
    error: report.error ? sanitizeDiagnostic(report.error) : null
  };
}

function createContextFingerprint(sources: WorkspaceKnowledgeSource[], uploads: Record<string, StoredUpload[]>) {
  return sha256(JSON.stringify({
    sources: sources.map((source) => ({ id: source.id, identity: workspaceKnowledgeSourceIdentity(source), kind: source.kind })).sort((left, right) => left.id.localeCompare(right.id)),
    uploads: Object.entries(uploads).sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, entries]) => ({
      sourceId,
      entries: entries.map(({ relativePath, contentHash, size }) => ({ relativePath, contentHash, size })).sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    }))
  }));
}

function resolveDraftRoot(actorId: string, draftContextId: string) {
  return path.join(WORKSPACE_CREATION_CONTEXT_ROOT, actorHash(actorId), assertDraftContextId(draftContextId));
}

function resolveUploadRoot(draftRoot: string, sourceId: string) {
  return path.join(draftRoot, "uploads", sha256(sourceId).slice(0, 24));
}

function assertDraftContextId(value: string) {
  const normalized = value.trim();
  if (!DRAFT_ID_PATTERN.test(normalized)) throw new Error("Workspace context identifier is invalid.");
  return normalized;
}

function actorHash(actorId: string) {
  return sha256(actorId.trim()).slice(0, 32);
}

function normalizeUploadRelativePath(value: string, fileOnly: boolean) {
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || /^[a-z]:($|\/)/i.test(raw) || raw.startsWith("/")) throw new Error("Uploaded file paths must be relative.");
  const normalized = path.posix.normalize(raw);
  const segments = normalized.split("/");
  if (normalized === "." || segments.includes("..") || normalized.length > MAX_RELATIVE_UPLOAD_PATH_LENGTH) throw new Error("Uploaded file path is unsafe.");
  if (fileOnly && segments.length !== 1) throw new Error("A file source cannot contain nested upload paths.");
  return normalized;
}

function sanitizeFileName(value: string) {
  return value.replace(/\\/g, "/").split("/").pop()?.replace(/[\0\r\n]/g, "").slice(0, 160) || "uploaded-file";
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function readStoredContext(draftRoot: string): Promise<StoredContext | null> {
  const value = await readFile(path.join(draftRoot, "context.json"), "utf8").catch(() => null);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredContext>;
    if (parsed.schemaVersion !== WORKSPACE_CREATION_CONTEXT_SCHEMA_VERSION || typeof parsed.draftContextId !== "string" || typeof parsed.actorHash !== "string" || !Array.isArray(parsed.sources) || !parsed.uploads || !Array.isArray(parsed.sourceReports) || !Array.isArray(parsed.warnings)) return null;
    return parsed as StoredContext;
  } catch {
    return null;
  }
}

async function writeStoredContext(draftRoot: string, context: StoredContext) {
  await assertNoSymlinkAlongPath(WORKSPACE_CREATION_CONTEXT_ROOT, draftRoot);
  await mkdir(draftRoot, { recursive: true, mode: 0o700 });
  const target = path.join(draftRoot, "context.json");
  await assertNoSymlinkAlongPath(draftRoot, target);
  await writeAtomicJson(target, context);
}

function assertActualUploadLimits(uploads: readonly WorkspaceCreationUpload[]) {
  if (uploads.length > MAX_UPLOAD_FILES) throw new Error("Too many uploaded project files were supplied.");
  let total = 0;
  const sourceTotals = new Map<string, number>();
  for (const upload of uploads) {
    const size = upload.bytes.byteLength;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_BYTES_PER_FILE) {
      throw new Error(`Uploaded file ${path.basename(upload.relativePath || upload.fileName)} exceeds the size limit.`);
    }
    total += size;
    const sourceTotal = (sourceTotals.get(upload.sourceId) ?? 0) + size;
    sourceTotals.set(upload.sourceId, sourceTotal);
    if (sourceTotal > MAX_UPLOAD_BYTES) throw new Error("The uploaded project context exceeds the size limit.");
    if (total > MAX_UPLOAD_BYTES_TOTAL) throw new Error("The uploaded project context exceeds the size limit.");
  }
}

async function writeDurableFile(target: string, content: string | Buffer) {
  const handle = await open(target, "w", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function hashFileWithinLimits(filePath: string, limit: number) {
  const hash = createHash("sha256");
  let total = 0;
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > limit) throw new Error("Uploaded project context exceeds the size limit.");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

async function cleanupExpiredWorkspaceCreationContexts() {
  const retained = await readRetainedContextKeys();
  const actorRoots = await readdir(WORKSPACE_CREATION_CONTEXT_ROOT, { withFileTypes: true }).catch(() => []);
  for (const actorRoot of actorRoots) {
    if (!actorRoot.isDirectory() || !/^[a-f0-9]{32}$/i.test(actorRoot.name)) continue;
    const actorPath = path.join(WORKSPACE_CREATION_CONTEXT_ROOT, actorRoot.name);
    const drafts = await readdir(actorPath, { withFileTypes: true }).catch(() => []);
    for (const draft of drafts) {
      if (!draft.isDirectory() || !DRAFT_ID_PATTERN.test(draft.name)) continue;
      if (retained.has(`${actorRoot.name}/${draft.name}`)) continue;
      const draftPath = path.join(actorPath, draft.name);
      const stored = await readStoredContext(draftPath);
      if (stored && Date.parse(stored.expiresAt) > Date.now()) continue;
      const metadata = await lstat(draftPath).catch(() => null);
      if (metadata?.isSymbolicLink()) continue;
      if (!stored && metadata && Date.now() - metadata.mtimeMs < WORKSPACE_CREATION_CONTEXT_TTL_MS) continue;
      await rm(draftPath, { recursive: true, force: true });
    }
  }
}

async function readRetainedContextKeys() {
  const retained = new Set<string>();
  const now = Date.now();
  const recentReviewCutoff = now - WORKSPACE_CREATION_CONTEXT_TTL_MS;
  const creationRoot = resolveWorkspaceCreationRunRoot(WORKSPACE_CREATION_RUN_ROOT);
  const creationFiles = await readdir(creationRoot).catch(() => []);
  for (const fileName of creationFiles) {
    if (!fileName.endsWith(".json")) continue;
    const run = await readWorkspaceCreationRunFile(path.join(creationRoot, fileName));
    if (!run?.draftContextId) continue;
    const isActive = run.snapshot.state === "pending" || run.snapshot.state === "running";
    const isRecentReview = run.snapshot.state === "review-ready" && Date.parse(run.updatedAt) > recentReviewCutoff;
    if (isActive || isRecentReview) retained.add(`${run.actorHash}/${run.draftContextId}`);
  }

  const acceptedProvisioningRunIds = await readAcceptedProvisioningRunIds();
  const provisioningRoot = resolveProvisioningRoot(WORKSPACE_PROVISIONING_ROOT);
  const provisioningFiles = await readdir(provisioningRoot).catch(() => []);
  for (const fileName of provisioningFiles) {
    if (!fileName.endsWith(".json")) continue;
    const run = await readStoredRunFile(path.join(provisioningRoot, fileName));
    if (!run?.draftContextId) continue;
    const isActive = !["ready", "partial", "failed", "cancelled"].includes(run.state);
    if (isActive || acceptedProvisioningRunIds.has(run.runId)) retained.add(`${run.actorHash}/${run.draftContextId}`);
  }
  return retained;
}

async function readAcceptedProvisioningRunIds() {
  const accepted = new Set<string>();
  const bindingFiles = await readdir(path.resolve(WORKSPACE_INTELLIGENCE_BINDING_ROOT)).catch(() => []);
  for (const fileName of bindingFiles) {
    if (!fileName.endsWith(".json")) continue;
    const raw = await readFile(path.join(WORKSPACE_INTELLIGENCE_BINDING_ROOT, fileName), "utf8").catch(() => null);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (validateWorkspaceIntelligenceBinding(parsed)) accepted.add(parsed.provisioningRunId);
    } catch {
      // Malformed bindings are not authoritative and do not retain context.
    }
  }
  return accepted;
}

async function assertNoSymlinkAlongPath(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Workspace context path escaped its staging root.");
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch(() => null);
    if (metadata?.isSymbolicLink()) throw new Error("Workspace context staging does not accept symbolic links.");
  }
}

function sanitizeDiagnostic(value: string) {
  return redactSecretText(value).replace(/https?:\/\/\S+/gi, "[url]").slice(0, 300);
}

function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function withContextLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = contextLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => current);
  contextLocks.set(key, chain);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (contextLocks.get(key) === chain) contextLocks.delete(key);
  }
}

async function withContextLocks<T>(keys: readonly string[], task: () => Promise<T>): Promise<T> {
  if (keys.length === 0) return task();
  const [first, ...rest] = keys;
  return withContextLock(first!, () => withContextLocks(rest, task));
}
