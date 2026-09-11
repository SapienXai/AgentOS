import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { access, copyFile, lstat, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { assertSafeWorkspaceCloneRepoUrl } from "@/lib/openclaw/domains/workspace-bootstrap";
import { discoverProjectWebsite } from "@/lib/agentos/application/project-discovery-engine";
import { isDiscoveryManifest, type ProjectDiscoveryManifest } from "@/lib/agentos/domains/project-discovery";
import {
  isSupportedWorkspaceKnowledgeFile,
  type WorkspaceKnowledgeSource,
  type WorkspaceKnowledgeSourceKind,
  type WorkspaceKnowledgeSourceLocator,
  type WorkspaceKnowledgeSourceProvenance
} from "@/lib/agentos/domains/workspace-knowledge";

const execFileAsync = promisify(execFile);

export const KNOWLEDGE_INGESTION_SCHEMA_VERSION = 2;
export const LEGACY_KNOWLEDGE_INGESTION_SCHEMA_VERSION = 1;
export const MIN_PINNED_GIT_VERSION = "2.37.0";

const CURRENT_FILE = "current.json";
const TRANSACTION_FILE = "transaction.json";
const WRITER_LOCK_FILE = "writer-lock.json";
const GENERATIONS_DIR = "generations";
const GENERATION_MARKER = ".agentos-generation";
const KNOWLEDGE_WRITER_LOCK_SCHEMA_VERSION = 1;
const ACTIVATION_READER_WAIT_MS = 5_000;
const WRITER_HEARTBEAT_MS = 2_000;
const WRITER_STALE_AFTER_MS = 15_000;

export const DEFAULT_KNOWLEDGE_INGESTION_LIMITS = {
  maxPagesPerSource: 24,
  maxDepth: 2,
  maxBytesPerDocument: 1_000_000,
  maxTotalBytesPerSource: 8_000_000,
  maxRedirects: 4,
  requestTimeoutMs: 10_000,
  totalRunTimeoutMs: 120_000,
  maxConcurrentRequests: 2,
  maxFilesPerSource: 200,
  maxTotalFilesPerSource: 500,
  maxSitemaps: 8
} as const;

export type KnowledgeIngestionStatus =
  | "pending"
  | "discovering"
  | "fetching"
  | "normalizing"
  | "staging"
  | "committing"
  | "ready"
  | "partial"
  | "error"
  | "cancelled";

export type KnowledgeIngestionPhase = "validate" | "discover" | "fetch" | "normalize" | "stage" | "commit" | "finalize";

export type KnowledgeSourceSupport = "supported" | "partial" | "declaration-only";

export type KnowledgeDocumentClassification =
  | "README"
  | "documentation"
  | "architecture"
  | "product"
  | "API"
  | "configuration"
  | "research"
  | "legal"
  | "general";

export type KnowledgeDocumentProvenance = {
  sourceId: string;
  sourceKind: WorkspaceKnowledgeSourceKind;
  declaredBy: WorkspaceKnowledgeSourceProvenance;
  origin: string;
  canonicalLocator: string;
};

export type KnowledgeDocument = {
  id: string;
  sourceId: string;
  sourceIds: string[];
  sourceKind: WorkspaceKnowledgeSourceKind;
  title: string;
  classification: KnowledgeDocumentClassification;
  origin: string;
  origins: string[];
  canonicalLocator: string;
  outputPath: string;
  mediaType: string;
  format: string;
  retrievedAt: string;
  contentHash: string;
  contentLength: number;
  normalizedContent: string;
  provenance: KnowledgeDocumentProvenance;
};

export type KnowledgeDocumentMetadata = Omit<KnowledgeDocument, "normalizedContent">;

export type KnowledgeDocumentsFile = {
  schemaVersion: typeof KNOWLEDGE_INGESTION_SCHEMA_VERSION;
  generationId?: string;
  updatedAt: string;
  documents: KnowledgeDocumentMetadata[];
};

export type KnowledgeIngestionSourceReport = {
  runId: string;
  sourceId: string;
  sourceKind: WorkspaceKnowledgeSourceKind;
  support: KnowledgeSourceSupport;
  status: KnowledgeIngestionStatus;
  startedAt: string;
  finishedAt: string;
  discoveredItems: number;
  fetchedItems: number;
  storedDocuments: number;
  skippedItems: number;
  unchangedItems: number;
  warningCount: number;
  errorCount: number;
  warnings: string[];
  error?: string;
};

export type KnowledgeIngestionState = {
  schemaVersion: typeof KNOWLEDGE_INGESTION_SCHEMA_VERSION;
  generationId?: string;
  updatedAt: string;
  lastRunId: string | null;
  lastRunIds: string[];
  sourceReports: KnowledgeIngestionSourceReport[];
  warnings: string[];
  discoveryManifests?: ProjectDiscoveryManifest[];
};

export type KnowledgeIngestionProgress = {
  runId: string;
  sourceId?: string;
  phase: KnowledgeIngestionPhase;
  status: KnowledgeIngestionStatus;
  message: string;
  completed: number;
  total: number;
  warningCount: number;
  sourceKind?: WorkspaceKnowledgeSourceKind;
  activityCode?: string;
  discoveredItems?: number;
  fetchedItems?: number;
  storedDocuments?: number;
  currentLocator?: string | null;
};

export type KnowledgeIngestionLimits = {
  [Key in keyof typeof DEFAULT_KNOWLEDGE_INGESTION_LIMITS]: number;
};

export type KnowledgeWebsiteResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
  finalUrl?: string;
};

export type KnowledgeWebsiteFetcher = {
  resolve(hostname: string): Promise<string[]>;
  fetch(
    url: string,
    options: {
      maxBytes: number;
      timeoutMs: number;
      signal?: AbortSignal;
      resolvedAddresses?: string[];
    }
  ): Promise<KnowledgeWebsiteResponse>;
};

export type KnowledgeHostResolver = (hostname: string) => Promise<string[]>;

export type KnowledgeIngestionTransactionHooks = {
  afterStage?: () => void | Promise<void>;
  beforeCorpusActivation?: () => void | Promise<void>;
  afterCorpusActivation?: () => void | Promise<void>;
  beforeMetadataActivation?: () => void | Promise<void>;
  afterMetadataActivation?: () => void | Promise<void>;
};

export type IngestKnowledgeSourcesInput = {
  sources: WorkspaceKnowledgeSource[];
  corpusRoot: string;
  stateRoot: string;
  signal?: AbortSignal;
  limits?: Partial<KnowledgeIngestionLimits>;
  onProgress?: (progress: KnowledgeIngestionProgress) => void | Promise<void>;
  websiteFetcher?: KnowledgeWebsiteFetcher;
  networkResolver?: KnowledgeHostResolver;
  transactionHooks?: KnowledgeIngestionTransactionHooks;
};

export type KnowledgeIngestionRun = {
  runId: string;
  status: KnowledgeIngestionStatus;
  startedAt: string;
  finishedAt: string;
  discoveredItems: number;
  fetchedItems: number;
  storedDocuments: number;
  skippedItems: number;
  warningCount: number;
  errorCount: number;
  warnings: string[];
  error?: string;
};

export type KnowledgeIngestionResult = {
  run: KnowledgeIngestionRun;
  sourceReports: KnowledgeIngestionSourceReport[];
  documents: KnowledgeDocumentMetadata[];
  state: KnowledgeIngestionState;
};

type SourceWorkResult = {
  source: WorkspaceKnowledgeSource;
  documents: KnowledgeDocument[];
  report: KnowledgeIngestionSourceReport;
  discovery?: ProjectDiscoveryManifest;
};

type SourceContext = {
  runId: string;
  source: WorkspaceKnowledgeSource;
  limits: KnowledgeIngestionLimits;
  signal?: AbortSignal;
  sourceDirectory: string;
  websiteFetcher: KnowledgeWebsiteFetcher;
  resolveHost: KnowledgeHostResolver;
  onProgress?: IngestKnowledgeSourcesInput["onProgress"];
  bytesFetched: number;
};

type TextNormalization = {
  content: string;
  skipped: boolean;
  redacted: boolean;
};

export class KnowledgeIngestionCancelledError extends Error {
  constructor() {
    super("Knowledge ingestion was cancelled.");
    this.name = "KnowledgeIngestionCancelledError";
  }
}

export class KnowledgeIngestionBusyError extends Error {
  constructor(message = "Knowledge corpus is busy with another operation; retry shortly.") {
    super(message);
    this.name = "KnowledgeIngestionBusyError";
  }
}

export function isKnowledgeIngestionBusyError(error: unknown): error is KnowledgeIngestionBusyError {
  return error instanceof KnowledgeIngestionBusyError;
}

class KnowledgeIngestionLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeIngestionLockError";
  }
}

type KnowledgeWriterLockRecord = {
  schemaVersion: typeof KNOWLEDGE_WRITER_LOCK_SCHEMA_VERSION;
  lockId: string;
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: string;
  operation: "ingestion" | "promotion" | "reader-recovery";
  ownerStartIdentity: string | null;
};

type KnowledgeWriterLockHandle = {
  lockPath: string;
  record: KnowledgeWriterLockRecord;
  heartbeat: NodeJS.Timeout;
  inFlight: Promise<void> | null;
  released: boolean;
};

async function acquireKnowledgeWriterLock(input: { stateRoot: string; operation: KnowledgeWriterLockRecord["operation"] }): Promise<KnowledgeWriterLockHandle> {
  await assertNoSymlinkAlongPath(path.dirname(input.stateRoot), input.stateRoot, true);
  await mkdir(input.stateRoot, { recursive: true });
  const lockPath = path.join(input.stateRoot, WRITER_LOCK_FILE);
  const record: KnowledgeWriterLockRecord = {
    schemaVersion: KNOWLEDGE_WRITER_LOCK_SCHEMA_VERSION,
    lockId: randomUUID(),
    pid: process.pid,
    hostname: osHostname(),
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    operation: input.operation,
    ownerStartIdentity: await processStartIdentity(process.pid)
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      const lockHandle = { lockPath, record, heartbeat: undefined as unknown as NodeJS.Timeout, inFlight: null, released: false } as KnowledgeWriterLockHandle;
      lockHandle.heartbeat = setInterval(() => {
        if (lockHandle.released || lockHandle.inFlight) return;
        const refresh = refreshKnowledgeWriterLock(lockHandle);
        lockHandle.inFlight = refresh;
        void refresh.then(
          () => { if (lockHandle.inFlight === refresh) lockHandle.inFlight = null; },
          () => { if (lockHandle.inFlight === refresh) lockHandle.inFlight = null; }
        );
      }, WRITER_HEARTBEAT_MS);
      lockHandle.heartbeat.unref?.();
      return lockHandle;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const existing = await readKnowledgeWriterLock(input.stateRoot);
      if (!existing) continue;
      if (await isKnowledgeWriterLive(existing)) throw new KnowledgeIngestionBusyError();
      const stalePath = `${lockPath}.stale-${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { force: true });
      } catch (renameError) {
        if (!isNodeError(renameError, "ENOENT")) throw renameError;
      }
    }
  }
  throw new KnowledgeIngestionBusyError();
}

async function refreshKnowledgeWriterLock(handle: KnowledgeWriterLockHandle) {
  const current = await readKnowledgeWriterLock(path.dirname(handle.lockPath));
  if (!current || current.lockId !== handle.record.lockId) {
    clearInterval(handle.heartbeat);
    return;
  }
  handle.record.heartbeatAt = new Date().toISOString();
  await writeDurableJson(handle.lockPath, handle.record);
}

async function releaseKnowledgeWriterLock(handle: KnowledgeWriterLockHandle) {
  if (handle.released) return;
  handle.released = true;
  clearInterval(handle.heartbeat);
  if (handle.inFlight) await handle.inFlight.catch(() => undefined);
  const current = await readKnowledgeWriterLock(path.dirname(handle.lockPath));
  if (!current) return;
  if (current.lockId !== handle.record.lockId) throw new KnowledgeIngestionLockError("Knowledge writer lock ownership changed before release.");
  await rm(handle.lockPath, { force: true });
}

async function readKnowledgeWriterLock(stateRoot: string): Promise<KnowledgeWriterLockRecord | null> {
  const lockPath = path.join(stateRoot, WRITER_LOCK_FILE);
  if (!(await pathExists(lockPath))) return null;
  const value = await readJson(lockPath);
  if (!isKnowledgeWriterLock(value)) throw new KnowledgeIngestionLockError("Knowledge writer lock is malformed; refusing recovery.");
  return value;
}

async function isKnowledgeWriterLive(record: KnowledgeWriterLockRecord): Promise<boolean> {
  if (record.hostname !== osHostname()) {
    const heartbeat = Date.parse(record.heartbeatAt);
    return !Number.isFinite(heartbeat) || Date.now() - heartbeat <= WRITER_STALE_AFTER_MS;
  }
  const processAlive = isProcessAlive(record.pid);
  if (!processAlive) return false;
  const currentIdentity = await processStartIdentity(record.pid);
  if (record.ownerStartIdentity && currentIdentity) return record.ownerStartIdentity === currentIdentity;
  if (record.ownerStartIdentity && !currentIdentity) return true;
  return true;
}

async function processStartIdentity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 3_000, maxBuffer: 16 * 1024 });
    const identity = stdout.trim();
    return identity || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}

async function recoverKnowledgeTransactionForReader(corpusRoot: string, stateRoot: string) {
  const deadline = Date.now() + ACTIVATION_READER_WAIT_MS;
  while (true) {
    const writer = await readKnowledgeWriterLock(stateRoot);
    if (writer && await isKnowledgeWriterLive(writer)) {
      // A live writer may be atomically replacing or removing the journal. A
      // transient missing/partial read is not evidence of corruption; wait for
      // the writer to publish or clean up its durable transaction state.
      const transaction = await readKnowledgeTransactionJournalIfValid(stateRoot);
      if (transaction?.phase === "prepared" || !(await pathExists(path.join(stateRoot, TRANSACTION_FILE)))) return;
      if (Date.now() >= deadline) throw new KnowledgeIngestionBusyError("Knowledge corpus activation is in progress; retry the read.");
      await delay(25);
      continue;
    }

    try {
      const recoveryLock = await acquireKnowledgeWriterLock({ stateRoot, operation: "reader-recovery" });
      try {
        await recoverKnowledgeTransaction(corpusRoot, stateRoot, recoveryLock.record.lockId);
      } finally {
        await releaseKnowledgeWriterLock(recoveryLock);
      }
      return;
    } catch (error) {
      if (!isKnowledgeIngestionBusyError(error)) throw error;
      if (Date.now() >= deadline) throw error;
      await delay(25);
    }
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function isKnowledgeIngestionCancelledError(error: unknown): error is KnowledgeIngestionCancelledError {
  return error instanceof KnowledgeIngestionCancelledError;
}

export async function ingestKnowledgeSources(input: IngestKnowledgeSourcesInput): Promise<KnowledgeIngestionResult> {
  const writerLock = await acquireKnowledgeWriterLock({ stateRoot: input.stateRoot, operation: "ingestion" });
  try {
    return await ingestKnowledgeSourcesWithLock(input, writerLock);
  } finally {
    await releaseKnowledgeWriterLock(writerLock);
  }
}

async function ingestKnowledgeSourcesWithLock(input: IngestKnowledgeSourcesInput, writerLock: KnowledgeWriterLockHandle): Promise<KnowledgeIngestionResult> {
  const runId = `knowledge-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  const limits = resolveLimits(input.limits);
  const sources = normalizeIngestionSources(input.sources);
  const sourceDirectories = buildSourceDirectoryMap(sources);
  const websiteFetcher = input.websiteFetcher ?? createDefaultWebsiteFetcher();
  const resolveHost = input.networkResolver ?? websiteFetcher.resolve.bind(websiteFetcher) ?? resolvePublicHostAddresses;
  const runController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    runController.abort();
  }, limits.totalRunTimeoutMs);
  timeout.unref?.();
  if (input.signal) {
    if (input.signal.aborted) runController.abort();
    else input.signal.addEventListener("abort", () => runController.abort(), { once: true });
  }
  const signal = runController.signal;
  await recoverKnowledgeTransaction(input.corpusRoot, input.stateRoot, writerLock.record.lockId);
  const previousSnapshot = await readKnowledgeSnapshotUnsafe(input.corpusRoot, input.stateRoot);
  const previousState = previousSnapshot?.state ?? null;
  const previousDocuments = previousSnapshot?.documents ?? [];
  const stagingRoot = path.join(input.corpusRoot, ".agentos-staging", runId);
  const sourceResults: SourceWorkResult[] = [];
  const runWarnings: string[] = [];

  await assertNoSymlinkAlongPath(input.corpusRoot, stagingRoot, true);
  await mkdir(stagingRoot, { recursive: true });

  try {
    await emitProgress(input.onProgress, {
      runId,
      phase: "validate",
      status: "pending",
      message: "Validating declared knowledge sources.",
      completed: 0,
      total: sources.length,
      warningCount: 0
    });

    throwIfAborted(signal);

    for (const [index, source] of sources.entries()) {
      throwIfAborted(signal);
      const context: SourceContext = {
        runId,
        source,
        limits,
        signal,
        sourceDirectory: sourceDirectories.get(source.id) ?? sourceDirectoryName(source.id),
        websiteFetcher,
        resolveHost,
        onProgress: input.onProgress,
        bytesFetched: 0
      };
      await emitProgress(input.onProgress, {
        runId,
        sourceId: source.id,
        phase: "discover",
        status: "discovering",
        message: `Discovering ${source.label}.`,
        completed: index,
        total: sources.length,
        warningCount: runWarnings.length
      });
      sourceResults.push(await ingestOneSource(context));
    }

    throwIfAborted(signal);

    const currentDocuments = deduplicateDocuments(sourceResults.flatMap((result) => result.documents));
    const mergedDocuments = mergePreviousDocumentsForPartialSources(
      currentDocuments,
      previousDocuments,
      sourceResults,
      input.corpusRoot
    );

    await emitProgress(input.onProgress, {
      runId,
      phase: "stage",
      status: "staging",
      message: "Staging normalized knowledge documents.",
      completed: sources.length,
      total: sources.length,
      warningCount: runWarnings.length
    });
    await stageKnowledgeCorpus({
      stagingRoot,
      corpusRoot: input.corpusRoot,
      documents: mergedDocuments,
      previousDocuments,
      pruneSourceIds: sourceResults.filter((result) => result.report.status === "ready").map((result) => result.source.id)
    });
    await input.transactionHooks?.afterStage?.();

    throwIfAborted(signal);

    await emitProgress(input.onProgress, {
      runId,
      phase: "commit",
      status: "committing",
      message: "Committing the staged knowledge corpus.",
      completed: 0,
      total: sourceResults.length,
      warningCount: runWarnings.length
    });
    const committedReports = await commitSourceResults({ sourceResults, previousDocuments, documents: mergedDocuments, runId, onProgress: input.onProgress });

    const finishedAt = new Date().toISOString();
    const sourceReports = committedReports;
    const warnings = [...runWarnings, ...sourceReports.flatMap((report) => report.warnings)];
    const discoveryManifests = sourceResults.flatMap((result) => result.discovery ? [result.discovery] : []);
    const status = resolveOverallStatus(sourceReports, mergedDocuments.length > 0);
    const errorCount = sourceReports.reduce((total, report) => total + report.errorCount, 0);
    const state: KnowledgeIngestionState = {
      schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
      generationId: `knowledge-generation-${randomUUID()}`,
      updatedAt: finishedAt,
      lastRunId: runId,
      lastRunIds: [runId, ...(previousState?.lastRunIds ?? [])].slice(0, 10),
      sourceReports,
      warnings,
      ...(discoveryManifests.length > 0 ? { discoveryManifests } : {})
    };
    const documentsFile: KnowledgeDocumentsFile = {
      schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
      generationId: state.generationId,
      updatedAt: finishedAt,
      documents: mergedDocuments.map(toDocumentMetadata)
    };
    await activateKnowledgeGeneration({
      corpusRoot: input.corpusRoot,
      stateRoot: input.stateRoot,
      stagingRoot,
      state,
      documents: documentsFile,
      transactionId: runId,
      writerLock,
      hooks: input.transactionHooks
    });

    await emitProgress(input.onProgress, {
      runId,
      phase: "finalize",
      status,
      message: `Knowledge ingestion finished with status ${status}.`,
      completed: sourceReports.length,
      total: sourceReports.length,
      warningCount: warnings.length
    });

    return {
      run: {
        runId,
        status,
        startedAt,
        finishedAt,
        discoveredItems: sourceReports.reduce((total, report) => total + report.discoveredItems, 0),
        fetchedItems: sourceReports.reduce((total, report) => total + report.fetchedItems, 0),
        storedDocuments: mergedDocuments.length,
        skippedItems: sourceReports.reduce((total, report) => total + report.skippedItems, 0),
        warningCount: warnings.length,
        errorCount,
        warnings,
        ...(status === "error" ? { error: "No knowledge source could be ingested successfully." } : {})
      },
      sourceReports,
      documents: documentsFile.documents,
      state
    };
  } catch (error) {
    await recoverKnowledgeTransaction(input.corpusRoot, input.stateRoot, writerLock.record.lockId);
    if (isKnowledgeIngestionCancelledError(error) || signal.aborted) {
      const finishedAt = new Date().toISOString();
      const sourceReports: KnowledgeIngestionSourceReport[] = sourceResults.map((result) => ({
        ...result.report,
        status: result.report.status === "ready" || result.report.status === "partial" ? result.report.status : "cancelled"
      }));
      const state: KnowledgeIngestionState = {
        schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
        ...(previousState?.generationId ? { generationId: previousState.generationId } : {}),
        updatedAt: finishedAt,
        lastRunId: previousState?.lastRunId ?? null,
        lastRunIds: previousState?.lastRunIds ?? [],
        sourceReports,
        warnings: [
          timedOut
            ? "Knowledge ingestion exceeded its total run timeout; the previous corpus was preserved."
            : "Knowledge ingestion was cancelled; the previous corpus was preserved."
        ],
        ...(previousState?.discoveryManifests ? { discoveryManifests: previousState.discoveryManifests } : {})
      };
      return {
        run: {
          runId,
          status: "cancelled",
          startedAt,
          finishedAt,
          discoveredItems: sourceReports.reduce((total, report) => total + report.discoveredItems, 0),
          fetchedItems: sourceReports.reduce((total, report) => total + report.fetchedItems, 0),
          storedDocuments: previousDocuments.length,
          skippedItems: sourceReports.reduce((total, report) => total + report.skippedItems, 0),
          warningCount: state.warnings.length,
          errorCount: 0,
          warnings: state.warnings
        },
        sourceReports,
        documents: previousDocuments,
        state
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (!(await pathExists(path.join(input.stateRoot, TRANSACTION_FILE)))) {
      await cleanupStagingRoot(stagingRoot);
    }
  }
}

export async function readKnowledgeIngestionState(stateRoot: string, corpusRoot = inferCorpusRoot(stateRoot)): Promise<KnowledgeIngestionState | null> {
  await recoverKnowledgeTransactionForReader(corpusRoot, stateRoot);
  return (await readKnowledgeSnapshotUnsafe(corpusRoot, stateRoot))?.state ?? null;
}

export async function readKnowledgeSnapshot(corpusRoot: string, stateRoot: string): Promise<KnowledgeSnapshot | null> {
  await recoverKnowledgeTransactionForReader(corpusRoot, stateRoot);
  return readKnowledgeSnapshotUnsafe(corpusRoot, stateRoot);
}

export async function promoteKnowledgeCorpus(input: {
  fromCorpusRoot: string;
  fromStateRoot: string;
  toCorpusRoot: string;
  toStateRoot: string;
  transactionHooks?: KnowledgeIngestionTransactionHooks;
}): Promise<void> {
  const writerLock = await acquireKnowledgeWriterLock({ stateRoot: input.toStateRoot, operation: "promotion" });
  try {
    await promoteKnowledgeCorpusWithLock(input, writerLock);
  } finally {
    await releaseKnowledgeWriterLock(writerLock);
  }
}

async function promoteKnowledgeCorpusWithLock(input: {
  fromCorpusRoot: string;
  fromStateRoot: string;
  toCorpusRoot: string;
  toStateRoot: string;
  transactionHooks?: KnowledgeIngestionTransactionHooks;
}, writerLock: KnowledgeWriterLockHandle): Promise<void> {
  await recoverKnowledgeTransaction(input.toCorpusRoot, input.toStateRoot, writerLock.record.lockId);
  const sourceSnapshot = input.fromCorpusRoot === input.toCorpusRoot && input.fromStateRoot === input.toStateRoot
    ? await readKnowledgeSnapshotUnsafe(input.fromCorpusRoot, input.fromStateRoot)
    : await readKnowledgeSnapshot(input.fromCorpusRoot, input.fromStateRoot);
  if (!sourceSnapshot?.state) return;
  const targetSnapshot = await readKnowledgeSnapshotUnsafe(input.toCorpusRoot, input.toStateRoot);
  const transactionId = `promotion-${randomUUID()}`;
  const stagingRoot = path.join(input.toCorpusRoot, ".agentos-staging", transactionId);
  await assertNoSymlinkAlongPath(input.toCorpusRoot, stagingRoot, true);
  await mkdir(stagingRoot, { recursive: true });
  try {
    const updatedAt = new Date().toISOString();
    const state: KnowledgeIngestionState = {
      ...sourceSnapshot.state,
      schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
      generationId: `knowledge-generation-${randomUUID()}`,
      updatedAt
    };
    const documents: KnowledgeDocumentsFile = {
      schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
      generationId: state.generationId,
      updatedAt,
      documents: sourceSnapshot.documents
    };
    await stagePromotionCorpus({
      stagingRoot,
      fromCorpusRoot: input.fromCorpusRoot,
      toCorpusRoot: input.toCorpusRoot,
      documents: sourceSnapshot.documents,
      previousDocuments: targetSnapshot?.documents ?? []
    });
    await input.transactionHooks?.afterStage?.();
    await activateKnowledgeGeneration({
      corpusRoot: input.toCorpusRoot,
      stateRoot: input.toStateRoot,
      stagingRoot,
      state,
      documents,
      transactionId,
      writerLock,
      hooks: input.transactionHooks
    });
  } catch (error) {
    await recoverKnowledgeTransaction(input.toCorpusRoot, input.toStateRoot, writerLock.record.lockId);
    throw error;
  } finally {
    if (!(await pathExists(path.join(input.toStateRoot, TRANSACTION_FILE)))) await cleanupStagingRoot(stagingRoot);
  }
}

function normalizeIngestionSources(sources: WorkspaceKnowledgeSource[]) {
  const ids = new Set<string>();
  return sources.map((source) => {
    if (!source || typeof source.id !== "string" || !source.id.trim()) {
      throw new Error("Knowledge ingestion requires sources with stable ids.");
    }
    if (ids.has(source.id)) throw new Error(`Knowledge ingestion source ids must be unique: ${source.id}.`);
    ids.add(source.id);
    if (source.kind === "repository" && source.locator.kind !== "repository") {
      throw new Error(`Repository source ${source.id} has an invalid locator.`);
    }
    return source;
  });
}

function resolveLimits(input: Partial<KnowledgeIngestionLimits> | undefined): KnowledgeIngestionLimits {
  const merged = { ...DEFAULT_KNOWLEDGE_INGESTION_LIMITS, ...(input ?? {}) };
  return {
    maxPagesPerSource: positiveLimit(merged.maxPagesPerSource),
    maxDepth: nonNegativeLimit(merged.maxDepth),
    maxBytesPerDocument: positiveLimit(merged.maxBytesPerDocument),
    maxTotalBytesPerSource: positiveLimit(merged.maxTotalBytesPerSource),
    maxRedirects: nonNegativeLimit(merged.maxRedirects),
    requestTimeoutMs: positiveLimit(merged.requestTimeoutMs),
    totalRunTimeoutMs: positiveLimit(merged.totalRunTimeoutMs),
    maxConcurrentRequests: positiveLimit(merged.maxConcurrentRequests),
    maxFilesPerSource: positiveLimit(merged.maxFilesPerSource),
    maxTotalFilesPerSource: positiveLimit(merged.maxTotalFilesPerSource),
    maxSitemaps: positiveLimit(merged.maxSitemaps)
  };
}

function positiveLimit(value: number) {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
}

function nonNegativeLimit(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

async function ingestOneSource(context: SourceContext): Promise<SourceWorkResult> {
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  let result: { support: KnowledgeSourceSupport; documents: KnowledgeDocument[]; discoveredItems: number; fetchedItems: number; skippedItems: number; warnings?: string[]; error?: string; discovery?: ProjectDiscoveryManifest };

  try {
    throwIfAborted(context.signal);
    await emitProgress(context.onProgress, {
      runId: context.runId,
      sourceId: context.source.id,
      phase: "fetch",
      status: "fetching",
      message: `Fetching ${context.source.label}.`,
      completed: 0,
      total: 1,
      warningCount: 0
    });
    switch (context.source.kind) {
      case "prompt":
        result = await ingestPromptSource(context);
        break;
      case "website":
        result = await ingestWebsiteSource(context);
        break;
      case "repository":
        result = await ingestRepositorySource(context);
        break;
      case "file":
        result = await ingestFileSource(context);
        break;
      case "folder":
        result = await ingestFolderSource(context);
        break;
      case "connector":
        result = {
          support: "declaration-only",
          documents: [],
          discoveredItems: 1,
          fetchedItems: 0,
          skippedItems: 1,
          error: "Connector sources are declaration-only until Phase 7 authentication and connection support."
        };
        break;
    }
    await emitProgress(context.onProgress, {
      runId: context.runId,
      sourceId: context.source.id,
      phase: "normalize",
      status: "normalizing",
      message: `Normalizing ${context.source.label}.`,
      completed: result.documents.length,
      total: Math.max(result.discoveredItems, result.documents.length),
      warningCount: (result.warnings?.length ?? 0) + (result.error && !result.warnings?.includes(result.error) ? 1 : 0)
    });
  } catch (error) {
    if (isKnowledgeIngestionCancelledError(error)) throw error;
    result = {
      support: "partial",
      documents: [],
      discoveredItems: 1,
      fetchedItems: 0,
      skippedItems: 1,
      error: safeErrorMessage(error, `Source ${context.source.id} could not be ingested.`)
    };
  }

  warnings.push(...(result.warnings ?? []));
  if (result.error && !warnings.includes(result.error)) warnings.unshift(result.error);
  const status: KnowledgeIngestionStatus = result.documents.length > 0
    ? result.error || result.skippedItems > 0 ? "partial" : "ready"
    : result.error ? "error" : "ready";
  const finishedAt = new Date().toISOString();
  const report: KnowledgeIngestionSourceReport = {
    runId: context.runId,
    sourceId: context.source.id,
    sourceKind: context.source.kind,
    support: result.support,
    status,
    startedAt,
    finishedAt,
    discoveredItems: result.discoveredItems,
    fetchedItems: result.fetchedItems,
    storedDocuments: result.documents.length,
    skippedItems: result.skippedItems,
    unchangedItems: 0,
    warningCount: warnings.length,
    errorCount: result.error ? 1 : 0,
    warnings,
    ...(result.error ? { error: result.error } : {})
  };
  return { source: context.source, documents: result.documents, report, ...(result.discovery ? { discovery: result.discovery } : {}) };
}

async function ingestPromptSource(context: SourceContext) {
  const locator = requireLocator(context.source, "prompt");
  const normalized = normalizeImportedText(locator.text);
  if (normalized.skipped || !normalized.content) {
    return { support: "partial" as const, documents: [], discoveredItems: 1, fetchedItems: 1, skippedItems: 1, error: "Prompt source was skipped because it contains high-confidence secret material." };
  }
  return {
    support: "supported" as const,
    documents: [createDocument(context, {
      title: context.source.label,
      origin: `prompt:${context.source.id}`,
      canonicalLocator: `prompt:${context.source.id}`,
      relativePath: "prompt.md",
      mediaType: "text/markdown",
      format: "markdown",
      classification: "product",
      content: `# ${context.source.label}\n\n${normalized.content}`
    })],
    discoveredItems: 1,
    fetchedItems: 1,
    skippedItems: normalized.redacted ? 1 : 0,
    ...(normalized.redacted ? { error: "High-confidence secret material was redacted from the prompt source." } : {})
  };
}

async function ingestWebsiteSource(context: SourceContext) {
  const locator = requireLocator(context.source, "website");
  const discovered = await discoverProjectWebsite({
    runId: context.runId,
    sourceId: context.source.id,
    sourceKind: context.source.kind,
    rootUrl: locator.url,
    limits: context.limits,
    signal: context.signal,
    websiteFetcher: context.websiteFetcher,
    resolveHost: context.resolveHost,
    assertPublicAddresses,
    onProgress: context.onProgress
  });
  const documents = discovered.documents.map((page) => createDocument(context, {
    title: page.title,
    origin: page.origin,
    canonicalLocator: `website:${page.canonicalUrl}`,
    relativePath: websiteOutputPath(page.canonicalUrl),
    mediaType: "text/markdown",
    format: "markdown",
    classification: classifyDocument(new URL(page.canonicalUrl).pathname, page.title),
    content: normalizeImportedText(page.content).content
  }));
  return {
    support: discovered.warnings.length > 0 ? "partial" as const : "supported" as const,
    documents,
    discoveredItems: discovered.discoveredItems,
    fetchedItems: discovered.fetchedItems,
    skippedItems: discovered.skippedItems,
    warnings: discovered.warnings,
    ...(discovered.warnings.length > 0 ? { error: discovered.warnings[0] } : {}),
    discovery: discovered.manifest
  };
}

async function ingestRepositorySource(context: SourceContext) {
  const locator = requireLocator(context.source, "repository");
  if (locator.localPath) {
    return ingestRepositoryDirectory(context, locator.localPath);
  }
  if (!locator.remoteUrl) {
    return { support: "partial" as const, documents: [], discoveredItems: 1, fetchedItems: 0, skippedItems: 1, error: "Repository source requires remoteUrl or localPath." };
  }

  const remoteUrl = normalizeKnowledgeRepositoryRemoteUrl(locator.remoteUrl);
  const addresses = await context.resolveHost(remoteUrl.hostname);
  assertPublicAddresses(addresses, "Remote repository host resolves to a blocked or non-public address.");

  const temporaryRoot = await mkdtempSafe("agentos-knowledge-repo-");
  try {
    await runSafeGitClone(remoteUrl, temporaryRoot, context.signal, context.limits.requestTimeoutMs, addresses);
    return await ingestRepositoryDirectory(context, temporaryRoot);
  } catch (error) {
    if (isKnowledgeIngestionCancelledError(error)) throw error;
    return { support: "partial" as const, documents: [], discoveredItems: 1, fetchedItems: 0, skippedItems: 1, error: "Remote repository checkout failed safely; no project code was executed." };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ingestRepositoryDirectory(context: SourceContext, rootInput: string) {
  const root = await resolveSafeInputRoot(rootInput, false);
  const files = await collectRepositoryFiles(root, context);
  const documents: KnowledgeDocument[] = [];
  const warnings: string[] = [];
  let fetchedItems = 0;

  for (const file of files) {
    throwIfAborted(context.signal);
    const extracted = await extractLocalFileSafely(context, file.absolutePath, file.relativePath);
    fetchedItems += 1;
    if (extracted.document) documents.push(extracted.document);
    if (extracted.warning) warnings.push(extracted.warning);
  }

  const overview = await buildRepositoryOverview(root, files, context);
  if (overview) documents.unshift(overview);
  return {
    support: warnings.length > 0 ? "partial" as const : "supported" as const,
    documents,
    discoveredItems: files.length + 1,
    fetchedItems,
    skippedItems: warnings.length,
    warnings,
    ...(warnings.length > 0 ? { error: warnings[0] } : {})
  };
}

async function ingestFileSource(context: SourceContext) {
  const locator = requireLocator(context.source, "file");
  const filePath = await resolveSafeInputFile(locator.path);
  const extracted = await extractLocalFile(context, filePath, path.basename(filePath));
  return {
    support: extracted.document ? "supported" as const : "partial" as const,
    documents: extracted.document ? [extracted.document] : [],
    discoveredItems: 1,
    fetchedItems: 1,
    skippedItems: extracted.warning ? 1 : 0,
    ...(extracted.warning ? { error: extracted.warning } : {})
  };
}

async function ingestFolderSource(context: SourceContext) {
  const locator = requireLocator(context.source, "folder");
  const root = await resolveSafeInputRoot(locator.path, false);
  const files = await collectFolderFiles(root, context);
  const documents: KnowledgeDocument[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    throwIfAborted(context.signal);
    const extracted = await extractLocalFileSafely(context, file.absolutePath, file.relativePath);
    if (extracted.document) documents.push(extracted.document);
    if (extracted.warning) warnings.push(extracted.warning);
  }

  return {
    support: warnings.length > 0 ? "partial" as const : "supported" as const,
    documents,
    discoveredItems: files.length,
    fetchedItems: files.length,
    skippedItems: warnings.length,
    warnings,
    ...(warnings.length > 0 ? { error: warnings[0] } : {})
  };
}

async function extractLocalFile(context: SourceContext, absolutePath: string, relativePath: string) {
  const extension = path.extname(relativePath).toLowerCase();
  const basename = path.basename(relativePath).toLowerCase();
  if (isSensitiveFileName(basename)) {
    return { warning: `Skipped sensitive file ${relativePath}.` };
  }
  if (extension === ".pdf" || extension === ".docx") {
    return { warning: `Skipped ${relativePath}; ${extension.slice(1).toUpperCase()} text extraction is not enabled in this runtime.` };
  }
  if (!isSupportedWorkspaceKnowledgeFile(relativePath)) {
    return { warning: `Skipped unsupported or binary file ${relativePath}.` };
  }

  const fileStat = await lstat(absolutePath);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    return { warning: `Skipped non-regular file ${relativePath}.` };
  }
  if (fileStat.size > context.limits.maxBytesPerDocument) {
    return { warning: `Skipped oversized file ${relativePath}.` };
  }
  if (context.bytesFetched + fileStat.size > context.limits.maxTotalBytesPerSource) {
    return { warning: `Skipped ${relativePath}; the source byte limit was reached.` };
  }

  const raw = await readFile(absolutePath);
  if (raw.byteLength > context.limits.maxBytesPerDocument || context.bytesFetched + raw.byteLength > context.limits.maxTotalBytesPerSource) {
    return { warning: `Skipped ${relativePath}; the source byte limit was reached.` };
  }
  context.bytesFetched += raw.byteLength;
  let content = raw.toString("utf8");
  if (raw.includes(0) || content.includes("\ufffd")) {
    return { warning: `Skipped binary file ${relativePath}.` };
  }

  const format = formatFromExtension(extension, basename);
  let title = path.basename(relativePath, extension) || path.basename(relativePath);
  const canonicalLocator = `file:${normalizePathForIdentity(relativePath)}`;
  let normalizedContent: TextNormalization;

  if (format === "html") {
    const parsed = parseHtmlDocument(content, `file://${absolutePath}`);
    title = parsed.title ?? title;
    content = parsed.markdown;
    normalizedContent = normalizeImportedText(content);
  } else if (format === "json") {
    try {
      content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
    } catch {
      return { warning: `Skipped malformed JSON file ${relativePath}.` };
    }
    normalizedContent = normalizeImportedText(content);
  } else {
    normalizedContent = normalizeImportedText(content);
  }

  if (normalizedContent.skipped || !normalizedContent.content) {
    return { warning: `Skipped ${relativePath} because it contains high-confidence secret material.` };
  }
  const warning = normalizedContent.redacted ? `Redacted high-confidence secret material from ${relativePath}.` : undefined;
  const document = createDocument(context, {
    title,
    origin: absolutePath,
    canonicalLocator,
    relativePath: outputRelativePath(relativePath, format),
    mediaType: mediaTypeFromFormat(format),
    format,
    classification: classifyDocument(relativePath, title),
    content: normalizedContent.content
  });
  return { document, warning };
}

async function extractLocalFileSafely(context: SourceContext, absolutePath: string, relativePath: string) {
  try {
    return await extractLocalFile(context, absolutePath, relativePath);
  } catch {
    return { warning: `Could not read ${relativePath}.` };
  }
}

async function buildRepositoryOverview(root: string, files: DiscoveredFile[], context: SourceContext) {
  const lines = [`# ${context.source.label}`, "", "## Repository overview", "", `- Root: ${context.source.locator.kind === "repository" ? context.source.locator.localPath ?? context.source.locator.remoteUrl ?? "repository" : "repository"}`, `- Files selected for knowledge extraction: ${files.length}`, "", "## Selected project files", ""];
  for (const file of files.slice(0, context.limits.maxFilesPerSource)) lines.push(`- ${file.relativePath}`);

  const packageJson = files.find((file) => file.relativePath === "package.json");
  if (packageJson) {
    try {
      const parsed = JSON.parse(await readFile(packageJson.absolutePath, "utf8")) as { scripts?: Record<string, string>; packageManager?: string };
      lines.push("", "## Package metadata", "", `- Package manager: ${parsed.packageManager ?? "not declared"}`);
      for (const [name, command] of Object.entries(parsed.scripts ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`- Script ${name}: ${command}`);
      }
    } catch {
      // The package manifest itself is handled as a document; an overview does not need to fail.
    }
  }
  const normalized = normalizeImportedText(lines.join("\n"));
  if (normalized.skipped) return null;
  return createDocument(context, {
    title: `${context.source.label} repository overview`,
    origin: root,
    canonicalLocator: `repository-overview:${context.source.id}`,
    relativePath: "repository-overview.md",
    mediaType: "text/markdown",
    format: "markdown",
    classification: "architecture",
    content: normalized.content
  });
}

type DiscoveredFile = { absolutePath: string; relativePath: string };

async function collectRepositoryFiles(root: string, context: SourceContext) {
  const files = await walkSafeFiles(root, context, (relativePath) => isRepositoryKnowledgeFile(relativePath));
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectFolderFiles(root: string, context: SourceContext) {
  const files = await walkSafeFiles(root, context, () => true);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function walkSafeFiles(root: string, context: SourceContext, include: (relativePath: string) => boolean) {
  const files: DiscoveredFile[] = [];
  let totalBytes = 0;
  async function visit(currentPath: string, relativeDirectory: string) {
    if (files.length >= context.limits.maxFilesPerSource || files.length >= context.limits.maxTotalFilesPerSource) return;
    throwIfAborted(context.signal);
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= context.limits.maxFilesPerSource || files.length >= context.limits.maxTotalFilesPerSource) break;
      const relativePath = relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name;
      if (shouldIgnoreRelativePath(relativePath)) continue;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !include(relativePath)) continue;
      const metadata = await lstat(absolutePath);
      if (metadata.size > context.limits.maxBytesPerDocument || totalBytes + metadata.size > context.limits.maxTotalBytesPerSource) continue;
      totalBytes += metadata.size;
      files.push({ absolutePath, relativePath });
    }
  }
  await visit(root, "");
  return files;
}

function isRepositoryKnowledgeFile(relativePath: string) {
  const normalized = normalizePathForIdentity(relativePath);
  const basename = path.posix.basename(normalized).toLowerCase();
  if (!isSupportedWorkspaceKnowledgeFile(normalized)) return false;
  if (basename.startsWith("readme")) return true;
  if (normalized === "package.json" || normalized === "pyproject.toml" || normalized === "cargo.toml" || normalized === "go.mod" || normalized === "requirements.txt" || basename === "makefile") return true;
  if (normalized.split("/").includes("docs")) return true;
  return /(^|\/)(architecture|adr|api|product|research|legal)(-|_|\/|\.)/i.test(normalized);
}

function shouldIgnoreRelativePath(relativePath: string) {
  const segments = normalizePathForIdentity(relativePath).split("/").map((segment) => segment.toLowerCase());
  if (segments.some((segment) => [".git", "node_modules", "vendor", "dist", "build", ".next", "coverage", "cache", "__pycache__", ".venv", ".ssh", ".openclaw", ".aws", ".gnupg"].includes(segment))) return true;
  return false;
}

function isSensitiveFileName(basename: string) {
  return basename === ".env" || basename.startsWith(".env.") || basename === ".npmrc" || basename === "credentials.json" || basename === "credentials.yml" || basename === "credentials.yaml" || basename.includes("private-key") || basename.includes("private_key");
}

function formatFromExtension(extension: string, basename: string) {
  if (basename === "makefile") return "text";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".json") return "json";
  if (extension === ".yaml" || extension === ".yml") return "yaml";
  if (extension === ".toml") return "toml";
  if (extension === ".csv") return "csv";
  return "text";
}

function mediaTypeFromFormat(format: string) {
  return ({ markdown: "text/markdown", html: "text/html", json: "application/json", yaml: "application/yaml", toml: "application/toml", csv: "text/csv", text: "text/plain" } as Record<string, string>)[format] ?? "text/plain";
}

function outputRelativePath(relativePath: string, format: string) {
  const normalized = normalizePathForIdentity(relativePath);
  if (format === "html") return normalized.replace(/\.(html?|HTML?)$/, ".md");
  return normalized;
}

function classifyDocument(relativePath: string, title: string): KnowledgeDocumentClassification {
  const value = `${relativePath} ${title}`.toLowerCase();
  const basename = path.basename(relativePath).toLowerCase();
  if (basename.startsWith("readme")) return "README";
  if (/architecture|(^|[\/_-])adr([\/_-]|$)/.test(value)) return "architecture";
  if (/\bapi\b|openapi|swagger/.test(value)) return "API";
  if (/product|roadmap|offer|pricing/.test(value)) return "product";
  if (/config|settings|package\.json|pyproject|toml|yaml|yml/.test(value)) return "configuration";
  if (/research|study|analysis/.test(value)) return "research";
  if (/legal|privacy|terms|license/.test(value)) return "legal";
  if (/docs|documentation|guide|manual/.test(value)) return "documentation";
  return "general";
}

function createDocument(context: SourceContext, input: { title: string; origin: string; canonicalLocator: string; relativePath: string; mediaType: string; format: string; classification: KnowledgeDocumentClassification; content: string }): KnowledgeDocument {
  const content = normalizeImportedText(input.content).content;
  const contentHash = sha256(content);
  const canonicalLocator = input.canonicalLocator;
  const identity = sha256(`knowledge-document:v1:${context.source.id}:${canonicalLocator}`);
  const outputPath = path.posix.join("sources", context.sourceDirectory, sanitizeOutputRelativePath(input.relativePath));
  return {
    id: `knowledge-document-${identity.slice(0, 24)}`,
    sourceId: context.source.id,
    sourceIds: [context.source.id],
    sourceKind: context.source.kind,
    title: input.title.trim() || context.source.label,
    classification: input.classification,
    origin: input.origin,
    origins: [input.origin],
    canonicalLocator,
    outputPath,
    mediaType: input.mediaType,
    format: input.format,
    retrievedAt: new Date().toISOString(),
    contentHash,
    contentLength: Buffer.byteLength(content, "utf8"),
    normalizedContent: content,
    provenance: {
      sourceId: context.source.id,
      sourceKind: context.source.kind,
      declaredBy: context.source.provenance,
      origin: input.origin,
      canonicalLocator
    }
  };
}

function deduplicateDocuments(documents: KnowledgeDocument[]) {
  const byLocator = new Map<string, KnowledgeDocument>();
  const byHash = new Map<string, KnowledgeDocument>();
  for (const document of documents) {
    const existingLocator = byLocator.get(document.canonicalLocator);
    const existingHash = byHash.get(document.contentHash);
    const existing = existingLocator ?? existingHash;
    if (existing) {
      existing.sourceIds = Array.from(new Set([...existing.sourceIds, ...document.sourceIds]));
      existing.origins = Array.from(new Set([...existing.origins, ...document.origins]));
      continue;
    }
    byLocator.set(document.canonicalLocator, document);
    byHash.set(document.contentHash, document);
  }
  return Array.from(byLocator.values()).sort((left, right) => left.outputPath.localeCompare(right.outputPath));
}

function mergePreviousDocumentsForPartialSources(current: KnowledgeDocument[], previous: KnowledgeDocumentMetadata[], sourceResults: SourceWorkResult[], corpusRoot: string) {
  const currentById = new Set(current.map((document) => document.id));
  const currentByHash = new Set(current.map((document) => document.contentHash));
  const retained: KnowledgeDocument[] = [...current];
  const partialSourceIds = new Set(sourceResults.filter((result) => result.report.status === "partial" || result.report.status === "error").map((result) => result.source.id));
  for (const document of previous) {
    if (!partialSourceIds.has(document.sourceId) || currentById.has(document.id) || currentByHash.has(document.contentHash)) continue;
    const filePath = safeCorpusPath(corpusRoot, document.outputPath);
    if (!pathExistsSyncSafe(filePath)) continue;
    retained.push({ ...document, normalizedContent: "" });
  }
  return retained.sort((left, right) => left.outputPath.localeCompare(right.outputPath));
}

async function stageKnowledgeCorpus(input: {
  stagingRoot: string;
  corpusRoot: string;
  documents: KnowledgeDocument[];
  previousDocuments: KnowledgeDocumentMetadata[];
  pruneSourceIds: string[];
}) {
  const stagedSources = path.join(input.stagingRoot, "sources");
  await mkdir(stagedSources, { recursive: true });
  await copySafeCorpusTree(path.join(input.corpusRoot, "sources"), stagedSources);
  const desiredPaths = new Set(input.documents.map((document) => document.outputPath));
  const previousByPath = new Map(input.previousDocuments.map((document) => [document.outputPath, document]));

  for (const document of input.documents) {
    const targetPath = safeCorpusPath(input.corpusRoot, document.outputPath);
    const stagedPath = safeCorpusPath(input.stagingRoot, document.outputPath);
    await validateManagedTarget(targetPath, document, input.previousDocuments);
    if (!document.normalizedContent) continue;
    await assertNoSymlinkAlongPath(input.stagingRoot, stagedPath, true);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, document.normalizedContent, "utf8");
  }

  for (const document of input.previousDocuments) {
    if (!input.pruneSourceIds.includes(document.sourceId) || desiredPaths.has(document.outputPath)) continue;
    const targetPath = safeCorpusPath(input.corpusRoot, document.outputPath);
    const stagedPath = safeCorpusPath(input.stagingRoot, document.outputPath);
    if (!(await pathExists(targetPath))) continue;
    const metadata = await lstat(targetPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Knowledge output path is not a regular file: ${document.outputPath}.`);
    if (sha256(await readFile(targetPath, "utf8")) === document.contentHash) await rm(stagedPath, { force: true });
  }

  for (const [outputPath, document] of previousByPath) {
    if (desiredPaths.has(outputPath) || !input.pruneSourceIds.includes(document.sourceId)) continue;
    await assertNoSymlinkAlongPath(input.corpusRoot, safeCorpusPath(input.corpusRoot, outputPath));
  }
}

async function stagePromotionCorpus(input: {
  stagingRoot: string;
  fromCorpusRoot: string;
  toCorpusRoot: string;
  documents: KnowledgeDocumentMetadata[];
  previousDocuments: KnowledgeDocumentMetadata[];
}) {
  const stagedSources = path.join(input.stagingRoot, "sources");
  await mkdir(stagedSources, { recursive: true });
  await copySafeCorpusTree(path.join(input.toCorpusRoot, "sources"), stagedSources);
  for (const document of input.documents) {
    const sourcePath = safeCorpusPath(input.fromCorpusRoot, document.outputPath);
    const targetPath = safeCorpusPath(input.toCorpusRoot, document.outputPath);
    const stagedPath = safeCorpusPath(input.stagingRoot, document.outputPath);
    await assertNoSymlinkAlongPath(input.fromCorpusRoot, sourcePath);
    await validateManagedTarget(targetPath, document, input.previousDocuments);
    if (!(await pathExists(sourcePath))) throw new Error(`Knowledge corpus promotion source is missing ${document.outputPath}.`);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await copyFile(sourcePath, stagedPath);
  }
}

async function copySafeCorpusTree(sourceRoot: string, targetRoot: string) {
  if (!(await pathExists(sourceRoot))) return;
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === GENERATION_MARKER) continue;
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    const metadata = await lstat(sourcePath);
    if (metadata.isSymbolicLink()) throw new Error("Knowledge corpus contains a symbolic link.");
    if (metadata.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copySafeCorpusTree(sourcePath, targetPath);
    } else if (metadata.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    } else {
      throw new Error("Knowledge corpus contains an unsupported filesystem entry.");
    }
  }
}

async function validateManagedTarget(targetPath: string, document: KnowledgeDocument | KnowledgeDocumentMetadata, previousDocuments: KnowledgeDocumentMetadata[]) {
  await assertNoSymlinkAlongPath(path.dirname(path.dirname(targetPath)), targetPath, true);
  if (!(await pathExists(targetPath))) return;
  const metadata = await lstat(targetPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Knowledge output path is not a regular file: ${document.outputPath}.`);
  const currentHash = sha256(await readFile(targetPath, "utf8"));
  if (currentHash === document.contentHash) return;
  const wasManaged = previousDocuments.some((previous) => previous.outputPath === document.outputPath && previous.contentHash === currentHash);
  if (!wasManaged) throw new Error(`Knowledge output path would overwrite an unrelated file: ${document.outputPath}.`);
}

async function commitSourceResults(input: { sourceResults: SourceWorkResult[]; previousDocuments: KnowledgeDocumentMetadata[]; documents: KnowledgeDocument[]; runId: string; onProgress?: IngestKnowledgeSourcesInput["onProgress"] }) {
  const reports: KnowledgeIngestionSourceReport[] = [];
  const documentsBySource = new Map<string, KnowledgeDocument[]>();
  for (const document of input.documents) {
    for (const sourceId of document.sourceIds) {
      const current = documentsBySource.get(sourceId) ?? [];
      current.push(document);
      documentsBySource.set(sourceId, current);
    }
  }

  for (const [index, result] of input.sourceResults.entries()) {
    const sourceDocuments = documentsBySource.get(result.source.id) ?? [];
    const report = { ...result.report, storedDocuments: sourceDocuments.length };
    const desiredDocuments = sourceDocuments.filter((document) => document.sourceId === result.source.id);
    const unchangedItems = desiredDocuments.filter((document) => input.previousDocuments.some((previous) => previous.id === document.id && previous.contentHash === document.contentHash)).length;
    reports.push({ ...report, unchangedItems });
    await emitProgress(input.onProgress, {
      runId: input.runId,
      sourceId: result.source.id,
      phase: "commit",
      status: report.status,
      message: `Committed source ${result.source.label}.`,
      completed: index + 1,
      total: input.sourceResults.length,
      warningCount: report.warningCount
    });
  }
  return reports;
}

type KnowledgeGenerationPointer = {
  schemaVersion: typeof KNOWLEDGE_INGESTION_SCHEMA_VERSION;
  generationId: string;
};

type KnowledgeTransactionJournal = {
  schemaVersion: typeof KNOWLEDGE_INGESTION_SCHEMA_VERSION;
  transactionId: string;
  generationId: string;
  previousPointer: KnowledgeGenerationPointer | null;
  phase: "prepared" | "activating" | "corpus-activated" | "metadata-activated";
  stagingRelativePath: string;
  lockId?: string;
  ownerPid?: number;
  ownerHostname?: string;
  ownerStartIdentity?: string | null;
};

export type KnowledgeSnapshot = {
  state: KnowledgeIngestionState;
  documents: KnowledgeDocumentMetadata[];
};

async function activateKnowledgeGeneration(input: {
  corpusRoot: string;
  stateRoot: string;
  stagingRoot: string;
  state: KnowledgeIngestionState;
  documents: KnowledgeDocumentsFile;
  transactionId: string;
  writerLock: KnowledgeWriterLockHandle;
  hooks?: KnowledgeIngestionTransactionHooks;
}) {
  const generationId = input.state.generationId;
  if (!generationId || input.documents.generationId !== generationId) throw new Error("Knowledge generation metadata is inconsistent.");
  await assertNoSymlinkAlongPath(path.dirname(input.stateRoot), input.stateRoot, true);
  await assertNoSymlinkAlongPath(path.dirname(input.corpusRoot), input.corpusRoot, true);
  await mkdir(input.stateRoot, { recursive: true });
  await mkdir(input.corpusRoot, { recursive: true });
  const generationRoot = path.join(input.stateRoot, GENERATIONS_DIR, generationId);
  const stagedSources = path.join(input.stagingRoot, "sources");
  const activeSources = path.join(input.corpusRoot, "sources");
  const backupSources = path.join(input.stagingRoot, ".backups", "sources");
  const currentPointer = await readKnowledgeGenerationPointer(input.stateRoot);
  const journal: KnowledgeTransactionJournal = {
    schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
    transactionId: input.transactionId,
    generationId,
    previousPointer: currentPointer,
    phase: "prepared",
    stagingRelativePath: path.relative(input.corpusRoot, input.stagingRoot),
    lockId: input.writerLock.record.lockId,
    ownerPid: input.writerLock.record.pid,
    ownerHostname: input.writerLock.record.hostname,
    ownerStartIdentity: input.writerLock.record.ownerStartIdentity
  };

  try {
    await mkdir(generationRoot, { recursive: true });
    await writeDurableJson(path.join(generationRoot, "state.json"), input.state);
    await writeDurableJson(path.join(generationRoot, "documents.json"), input.documents);
    await writeDurableJson(path.join(generationRoot, "generation.json"), { schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION, generationId });
    await writeDurableJson(path.join(input.stateRoot, TRANSACTION_FILE), journal);
    await writeDurableFile(path.join(stagedSources, GENERATION_MARKER), `${generationId}\n`);
    await input.hooks?.beforeCorpusActivation?.();
    journal.phase = "activating";
    await writeDurableJson(path.join(input.stateRoot, TRANSACTION_FILE), journal);
    await mkdir(path.dirname(backupSources), { recursive: true });
    if (await pathExists(activeSources)) {
      await assertNoSymlinkAlongPath(input.corpusRoot, activeSources);
      await rename(activeSources, backupSources);
    }
    await rename(stagedSources, activeSources);
    journal.phase = "corpus-activated";
    await writeDurableJson(path.join(input.stateRoot, TRANSACTION_FILE), journal);
    await input.hooks?.afterCorpusActivation?.();
    await input.hooks?.beforeMetadataActivation?.();
    await writeDurableJson(path.join(input.stateRoot, CURRENT_FILE), {
      schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
      generationId
    } satisfies KnowledgeGenerationPointer);
    journal.phase = "metadata-activated";
    await writeDurableJson(path.join(input.stateRoot, TRANSACTION_FILE), journal);
    await input.hooks?.afterMetadataActivation?.();
    await writeKnowledgeCompatibilityMirrors(input.stateRoot, input.state, input.documents);
    await cleanupKnowledgeTransaction(input, backupSources);
  } catch (error) {
    if (!(await pathExists(path.join(input.stateRoot, TRANSACTION_FILE)))) await rm(generationRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function cleanupKnowledgeTransaction(input: { corpusRoot: string; stateRoot: string; stagingRoot: string; state: KnowledgeIngestionState }, backupSources: string) {
  await rm(backupSources, { recursive: true, force: true });
  await cleanupStagingRoot(input.stagingRoot);
  await cleanupOldKnowledgeGenerations(input.stateRoot, input.state.generationId ?? "");
  await rm(path.join(input.stateRoot, TRANSACTION_FILE), { force: true });
}

async function recoverKnowledgeTransaction(corpusRoot: string, stateRoot: string, ownerLockId?: string) {
  const transactionPath = path.join(stateRoot, TRANSACTION_FILE);
  if (!(await pathExists(transactionPath))) return;
  const journal = await readKnowledgeTransactionJournal(stateRoot);
  const currentLock = await readKnowledgeWriterLock(stateRoot);
  if (ownerLockId) {
    if (!currentLock || currentLock.lockId !== ownerLockId) throw new KnowledgeIngestionBusyError("Knowledge transaction recovery lost writer ownership.");
  } else if (currentLock && await isKnowledgeWriterLive(currentLock)) {
    throw new KnowledgeIngestionBusyError("Knowledge transaction recovery is owned by a live writer.");
  }
  if (journal.lockId && journal.lockId !== ownerLockId && await isTransactionOwnerLive(journal)) {
    throw new KnowledgeIngestionBusyError("Knowledge transaction recovery is owned by a live writer.");
  }
  const stagingRoot = path.resolve(corpusRoot, journal.stagingRelativePath);
  if (!isPathWithin(corpusRoot, stagingRoot) || path.basename(stagingRoot) !== journal.transactionId) throw new Error("Knowledge transaction recovery found an invalid staging path.");
  const activeSources = path.join(corpusRoot, "sources");
  const backupSources = path.join(stagingRoot, ".backups", "sources");
  const current = await readKnowledgeGenerationPointer(stateRoot);
  if (current?.generationId === journal.generationId) {
    if ((await readGenerationMarker(activeSources)) !== journal.generationId) throw new Error("Knowledge transaction recovery found an activated generation without its corpus marker.");
    await rm(backupSources, { recursive: true, force: true }).catch(() => undefined);
    await cleanupStagingRoot(stagingRoot);
    await cleanupOldKnowledgeGenerations(stateRoot, journal.generationId);
    await rm(path.join(stateRoot, TRANSACTION_FILE), { force: true });
    return;
  }

  const activeMarker = await readGenerationMarker(activeSources);
  if (activeMarker === journal.generationId) {
    await rm(activeSources, { recursive: true, force: true });
  } else if (activeMarker !== null && activeMarker !== journal.previousPointer?.generationId) {
    throw new Error("Knowledge transaction recovery found an unexpected active corpus.");
  }
  if (await pathExists(backupSources)) {
    if (await pathExists(activeSources)) throw new Error("Knowledge transaction recovery cannot restore the previous corpus safely.");
    await rename(backupSources, activeSources);
  }
  await restoreKnowledgePointer(stateRoot, journal.previousPointer);
  await rm(path.join(stateRoot, GENERATIONS_DIR, journal.generationId), { recursive: true, force: true }).catch(() => undefined);
  await cleanupStagingRoot(stagingRoot);
  await rm(path.join(stateRoot, TRANSACTION_FILE), { force: true });
}

async function readKnowledgeTransactionJournal(stateRoot: string): Promise<KnowledgeTransactionJournal> {
  const value = await readJson(path.join(stateRoot, TRANSACTION_FILE));
  if (!isKnowledgeTransactionJournal(value)) throw new Error("Knowledge transaction recovery found an invalid journal.");
  return value;
}

async function readKnowledgeTransactionJournalIfValid(stateRoot: string): Promise<KnowledgeTransactionJournal | null> {
  const value = await readJson(path.join(stateRoot, TRANSACTION_FILE));
  return isKnowledgeTransactionJournal(value) ? value : null;
}

async function isTransactionOwnerLive(journal: KnowledgeTransactionJournal) {
  if (typeof journal.ownerPid !== "number" || typeof journal.ownerHostname !== "string") return false;
  const owner: KnowledgeWriterLockRecord = {
    schemaVersion: KNOWLEDGE_WRITER_LOCK_SCHEMA_VERSION,
    lockId: journal.lockId ?? "legacy-transaction-owner",
    pid: journal.ownerPid,
    hostname: journal.ownerHostname,
    startedAt: "1970-01-01T00:00:00.000Z",
    heartbeatAt: "1970-01-01T00:00:00.000Z",
    operation: "ingestion",
    ownerStartIdentity: journal.ownerStartIdentity ?? null
  };
  return isKnowledgeWriterLive(owner);
}

function isKnowledgeWriterLock(value: unknown): value is KnowledgeWriterLockRecord {
  return isRecord(value)
    && value.schemaVersion === KNOWLEDGE_WRITER_LOCK_SCHEMA_VERSION
    && typeof value.lockId === "string"
    && typeof value.pid === "number"
    && Number.isInteger(value.pid)
    && value.pid > 0
    && typeof value.hostname === "string"
    && typeof value.startedAt === "string"
    && Number.isFinite(Date.parse(value.startedAt))
    && typeof value.heartbeatAt === "string"
    && Number.isFinite(Date.parse(value.heartbeatAt))
    && (value.operation === "ingestion" || value.operation === "promotion" || value.operation === "reader-recovery")
    && (value.ownerStartIdentity === null || typeof value.ownerStartIdentity === "string");
}

async function readKnowledgeSnapshotUnsafe(corpusRoot: string, stateRoot: string): Promise<KnowledgeSnapshot | null> {
  const pointer = await readKnowledgeGenerationPointer(stateRoot);
  if (pointer) {
    const current = await readKnowledgeGeneration(stateRoot, pointer.generationId);
    if (current && (await readGenerationMarker(path.join(corpusRoot, "sources"))) === pointer.generationId) return current;
    return null;
  }
  return readLegacyKnowledgeSnapshot(stateRoot);
}

async function readKnowledgeGeneration(stateRoot: string, generationId: string): Promise<KnowledgeSnapshot | null> {
  if (!/^knowledge-generation-[a-f0-9-]+$/i.test(generationId)) return null;
  const generationRoot = path.join(stateRoot, GENERATIONS_DIR, generationId);
  const state = parseKnowledgeState(await readJson(path.join(generationRoot, "state.json")), generationId);
  const documents = parseKnowledgeDocuments(await readJson(path.join(generationRoot, "documents.json")), generationId);
  return state && documents ? { state, documents } : null;
}

async function readLegacyKnowledgeSnapshot(stateRoot: string): Promise<KnowledgeSnapshot | null> {
  const state = parseKnowledgeState(await readJson(path.join(stateRoot, "state.json")));
  const documentsValue = await readJson(path.join(stateRoot, "documents.json"));
  const documents = parseKnowledgeDocuments(documentsValue);
  if (!state || !documents) return null;
  const documentsGenerationId = isRecord(documentsValue) && typeof documentsValue.generationId === "string" ? documentsValue.generationId : null;
  if ((state.generationId ?? null) !== documentsGenerationId) return null;
  return { state, documents };
}

function parseKnowledgeState(value: unknown, expectedGenerationId?: string): KnowledgeIngestionState | null {
  if (!isRecord(value) || (value.schemaVersion !== KNOWLEDGE_INGESTION_SCHEMA_VERSION && value.schemaVersion !== LEGACY_KNOWLEDGE_INGESTION_SCHEMA_VERSION)) return null;
  if (expectedGenerationId && (value.schemaVersion !== KNOWLEDGE_INGESTION_SCHEMA_VERSION || value.generationId !== expectedGenerationId)) return null;
  const reports = Array.isArray(value.sourceReports) ? value.sourceReports.filter(isKnowledgeIngestionSourceReport) : [];
  return {
    schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
    ...(typeof value.generationId === "string" ? { generationId: value.generationId } : {}),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    lastRunId: typeof value.lastRunId === "string" ? value.lastRunId : null,
    lastRunIds: Array.isArray(value.lastRunIds) ? value.lastRunIds.filter((entry): entry is string => typeof entry === "string") : [],
    sourceReports: reports,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((entry): entry is string => typeof entry === "string") : [],
    ...(Array.isArray(value.discoveryManifests) ? { discoveryManifests: value.discoveryManifests.filter(isDiscoveryManifest) } : {})
  };
}

function parseKnowledgeDocuments(value: unknown, expectedGenerationId?: string): KnowledgeDocumentMetadata[] | null {
  if (!isRecord(value) || (value.schemaVersion !== KNOWLEDGE_INGESTION_SCHEMA_VERSION && value.schemaVersion !== LEGACY_KNOWLEDGE_INGESTION_SCHEMA_VERSION) || !Array.isArray(value.documents)) return null;
  if (expectedGenerationId && (value.schemaVersion !== KNOWLEDGE_INGESTION_SCHEMA_VERSION || value.generationId !== expectedGenerationId)) return null;
  return value.documents.filter(isKnowledgeDocumentMetadata);
}

async function readKnowledgeGenerationPointer(stateRoot: string): Promise<KnowledgeGenerationPointer | null> {
  const currentPath = path.join(stateRoot, CURRENT_FILE);
  if (!(await pathExists(currentPath))) return null;
  const value = await readJson(currentPath);
  if (!isKnowledgeGenerationPointer(value)) throw new Error("Knowledge generation pointer is malformed; refusing recovery.");
  return { schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION, generationId: value.generationId };
}

async function restoreKnowledgePointer(stateRoot: string, pointer: KnowledgeGenerationPointer | null) {
  const currentPath = path.join(stateRoot, CURRENT_FILE);
  if (pointer) await writeDurableJson(currentPath, pointer);
  else await rm(currentPath, { force: true });
}

function isKnowledgeTransactionJournal(value: unknown): value is KnowledgeTransactionJournal {
  return isRecord(value)
    && value.schemaVersion === KNOWLEDGE_INGESTION_SCHEMA_VERSION
    && typeof value.transactionId === "string"
    && typeof value.generationId === "string"
    && (value.previousPointer === null || isKnowledgeGenerationPointer(value.previousPointer))
    && typeof value.stagingRelativePath === "string"
    && (value.phase === "prepared" || value.phase === "activating" || value.phase === "corpus-activated" || value.phase === "metadata-activated")
    && (value.lockId === undefined || typeof value.lockId === "string")
    && (value.ownerPid === undefined || (typeof value.ownerPid === "number" && Number.isInteger(value.ownerPid) && value.ownerPid > 0))
    && (value.ownerHostname === undefined || typeof value.ownerHostname === "string")
    && (value.ownerStartIdentity === undefined || value.ownerStartIdentity === null || typeof value.ownerStartIdentity === "string");
}

function isKnowledgeGenerationPointer(value: unknown): value is KnowledgeGenerationPointer {
  return isRecord(value) && value.schemaVersion === KNOWLEDGE_INGESTION_SCHEMA_VERSION && typeof value.generationId === "string";
}

async function readGenerationMarker(sourcesRoot: string): Promise<string | null> {
  const marker = await readFile(path.join(sourcesRoot, GENERATION_MARKER), "utf8").catch(() => null);
  return marker?.trim() || null;
}

async function writeKnowledgeCompatibilityMirrors(stateRoot: string, state: KnowledgeIngestionState, documents: KnowledgeDocumentsFile) {
  await writeDurableJson(path.join(stateRoot, "state.json"), state);
  await writeDurableJson(path.join(stateRoot, "documents.json"), documents);
}

async function writeDurableJson(filePath: string, value: unknown) {
  await writeDurableFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeDurableFile(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function cleanupOldKnowledgeGenerations(stateRoot: string, activeGenerationId: string) {
  const generationRoot = path.join(stateRoot, GENERATIONS_DIR);
  const entries = await readdir(generationRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && /^knowledge-generation-[a-f0-9-]+$/i.test(entry.name) && entry.name !== activeGenerationId) {
      await rm(path.join(generationRoot, entry.name), { recursive: true, force: true });
    }
  }
}

async function cleanupStagingRoot(stagingRoot: string) {
  await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  const stagingParent = path.dirname(stagingRoot);
  try {
    if ((await readdir(stagingParent)).length === 0) await rm(stagingParent, { force: true });
  } catch {
    // Best-effort cleanup must not mask the ingestion result.
  }
}

function inferCorpusRoot(stateRoot: string) {
  return path.resolve(stateRoot, "..", "..", "knowledge");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isKnowledgeIngestionSourceReport(value: unknown): value is KnowledgeIngestionSourceReport {
  return isRecord(value) && typeof value.sourceId === "string" && typeof value.status === "string" && Array.isArray(value.warnings);
}

function isKnowledgeDocumentMetadata(value: unknown): value is KnowledgeDocumentMetadata {
  return isRecord(value) && typeof value.id === "string" && typeof value.sourceId === "string" && typeof value.outputPath === "string" && typeof value.contentHash === "string" && typeof value.canonicalLocator === "string";
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function toDocumentMetadata(document: KnowledgeDocument): KnowledgeDocumentMetadata {
  const metadata = { ...document };
  Reflect.deleteProperty(metadata, "normalizedContent");
  return metadata as KnowledgeDocumentMetadata;
}

function resolveOverallStatus(reports: KnowledgeIngestionSourceReport[], hasDocuments: boolean): KnowledgeIngestionStatus {
  if (reports.some((report) => report.status === "partial" || report.status === "error")) return hasDocuments ? "partial" : "error";
  return "ready";
}

async function emitProgress(callback: IngestKnowledgeSourcesInput["onProgress"], progress: KnowledgeIngestionProgress) {
  await callback?.(progress);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new KnowledgeIngestionCancelledError();
}

function safeErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/https?:\/\/\S+/gi, "[url]").replace(/(?:token|password|secret|key)[^\s]*/gi, "[redacted]");
  return message && message.length < 300 ? message : fallback;
}

function normalizeImportedText(value: string): TextNormalization {
  const normalized = value.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  if (PRIVATE_KEY_PATTERN.test(normalized)) return { content: "", skipped: true, redacted: false };
  let content = normalized;
  let redacted = false;
  content = content.replace(AUTHORIZATION_PATTERN, (_match, prefix: string) => {
    redacted = true;
    return `${prefix}[REDACTED]`;
  });
  content = content.replace(SECRET_ASSIGNMENT_PATTERN, (match: string, prefix: string, valuePart: string, suffix: string) => {
    const quoted = valuePart.startsWith("\"") && valuePart.endsWith("\"") || valuePart.startsWith("'") && valuePart.endsWith("'");
    const rawValue = quoted ? valuePart.slice(1, -1) : valuePart;
    if (isPlaceholderSecret(rawValue)) return match;
    redacted = true;
    return `${prefix}${quoted ? valuePart[0] : ""}[REDACTED]${quoted ? valuePart[0] : ""}${suffix}`;
  });
  content = content.split("\n").map((line) => line.trimEnd()).join("\n").trim();
  return { content: content ? `${content}\n` : "", skipped: false, redacted };
}

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i;
const AUTHORIZATION_PATTERN = /(\bAuthorization\s*:\s*Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;
const SECRET_ASSIGNMENT_PATTERN = /((?:^|\n)\s*(?:export\s+)?["']?(?:[A-Z][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY)|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|private[_-]?key|token|secret|authorization|cookie))["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"'#`,]+)([^\n]*)/gi;

function isPlaceholderSecret(value: string) {
  return /^\$\{|<[^>]+>|\[REDACTED\]|your[-_ ]|example[-_ ]|replace[-_ ]/i.test(value);
}

function parseHtmlDocument(html: string, baseUrl: string, allowedHost?: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const canonicalMatch = html.match(/<link\b[^>]*\brel=["']?canonical["']?[^>]*\bhref=["']([^"']+)["'][^>]*>/i) ?? html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?canonical["']?[^>]*>/i);
  const links: string[] = [];
  let content = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*(?:cookie|consent|gdpr|subscribe|newsletter)[^>]*>[\s\S]*?<\/[^>]+>/gi, " ");
  content = content.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes: string, inner: string) => {
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const label = stripInlineHtml(inner);
    if (href) {
      try {
        const resolved = new URL(decodeHtmlEntities(href), baseUrl);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
          resolved.hash = "";
          links.push(resolved.toString());
          const keepLink = !allowedHost || resolved.hostname.toLowerCase() === allowedHost.toLowerCase();
          return label ? (keepLink ? `[${label}](${resolved.toString()})` : label) : "";
        }
      } catch {
        // Invalid links remain omitted from discovery.
      }
    }
    return label;
  });
  content = content
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => `\n\n\`\`\`\n${decodeHtmlEntities(stripInlineHtml(inner))}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${stripInlineHtml(inner)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => `\n- ${stripInlineHtml(inner)}\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|header|tr|table|ul|ol|blockquote)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => `\`${stripInlineHtml(inner)}\``)
    .replace(/<[^>]+>/g, " ");
  return {
    title: titleMatch ? stripInlineHtml(titleMatch[1]) : undefined,
    canonicalUrl: canonicalMatch ? new URL(decodeHtmlEntities(canonicalMatch[1]), baseUrl).toString() : undefined,
    links: Array.from(new Set(links)),
    markdown: decodeHtmlEntities(content)
  };
}

function stripInlineHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([\da-f]+));/gi, (match, decimal: string, hexadecimal: string) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": " " } as Record<string, string>)[match.toLowerCase()] ?? match;
  });
}

function createDefaultWebsiteFetcher(): KnowledgeWebsiteFetcher {
  return {
    resolve: resolvePublicHostAddresses,
    fetch: fetchPublicHttpUrl
  };
}

async function fetchPublicHttpUrl(urlValue: string, options: Parameters<KnowledgeWebsiteFetcher["fetch"]>[1]) {
  const url = normalizeHttpUrl(urlValue);
  const addresses = options.resolvedAddresses ?? await createDefaultWebsiteFetcher().resolve(url.hostname);
  assertPublicAddresses(addresses);
  const address = addresses[0];
  const requestFunction = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<KnowledgeWebsiteResponse>((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const request = requestFunction({
      hostname: address,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname || "/"}${url.search}`,
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "Accept-Encoding": "identity",
        Host: url.host,
        "User-Agent": "AgentOS-Knowledge-Ingestion/1.0"
      },
      ...(url.protocol === "https:" && !isIP(stripIpv6Brackets(url.hostname)) ? { servername: url.hostname } : {})
    }, (response) => {
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value])) as Record<string, string | undefined>;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > options.maxBytes) {
          request.destroy(new Error("Website document byte limit reached."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error("Website request timed out.")));
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    if (options.signal) {
      const abort = () => request.destroy(new KnowledgeIngestionCancelledError());
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }
    request.end();
  });
}

export function normalizeHttpUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Website URLs must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("Website URLs cannot contain credentials.");
  url.hash = "";
  if (!url.pathname) url.pathname = "/";
  return url;
}

export function normalizeKnowledgeRepositoryRemoteUrl(value: string): URL {
  assertSafeWorkspaceCloneRepoUrl(value);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Remote repository ingestion accepts HTTPS URLs only.");
  if (url.username || url.password || hasUrlCredentials(value)) throw new Error("Remote repository URLs with embedded credentials are not accepted.");
  if (url.port && url.port !== "443") throw new Error("Remote repository ingestion accepts the HTTPS default port only.");
  if (url.search) throw new Error("Remote repository URLs cannot contain query parameters.");
  url.hash = "";
  return url;
}

export function isBlockedIpAddress(value: string): boolean {
  const address = stripIpv6Brackets(value).split("%")[0];
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && parts[2] === 113) || a >= 224;
  }
  if (version !== 6) return true;
  const groups = ipv6ToGroups(address);
  if (groups === null) return true;
  const first = Number.parseInt(groups[0], 16);
  const isUnspecified = groups.every((group) => group === "0000");
  const isLoopback = groups.slice(0, 7).every((group) => group === "0000") && groups[7] === "0001";
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isMulticast = (first & 0xff00) === 0xff00;
  const isDocumentation = groups[0] === "2001" && groups[1] === "0db8";
  const isMapped = groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff";
  if (!isMapped) return isUnspecified || isLoopback || isUniqueLocal || isLinkLocal || isMulticast || isDocumentation;
  const mapped = groups.slice(6).map((group) => Number.parseInt(group, 16));
  return isBlockedIpAddress(`${mapped[0] / 256 | 0}.${mapped[0] % 256}.${mapped[1] / 256 | 0}.${mapped[1] % 256}`);
}

export function assertPublicAddresses(addresses: string[], message = "Website host resolves to a blocked or non-public address.") {
  if (addresses.length === 0 || addresses.some(isBlockedIpAddress)) throw new Error(message);
}

export async function resolvePublicHostAddresses(hostname: string): Promise<string[]> {
  const normalized = stripIpv6Brackets(hostname);
  if (isIP(normalized)) {
    const addresses = [normalized];
    assertPublicAddresses(addresses);
    return addresses;
  }
  const entries = await lookup(normalized, { all: true, verbatim: true });
  const addresses = entries.map((entry) => entry.address);
  assertPublicAddresses(addresses);
  return addresses;
}

function websiteOutputPath(value: string) {
  const url = normalizeHttpUrl(value);
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "page");
  if (segments.length === 0) return "home.md";
  const last = segments.at(-1) ?? "page";
  if (/\.[a-z0-9]{1,8}$/i.test(last)) segments[segments.length - 1] = last.replace(/\.[a-z0-9]{1,8}$/i, ".md");
  else segments.push("index.md");
  return path.posix.join(...segments);
}

function requireLocator<T extends WorkspaceKnowledgeSourceLocator["kind"]>(source: WorkspaceKnowledgeSource, kind: T): Extract<WorkspaceKnowledgeSourceLocator, { kind: T }> {
  if (source.locator.kind !== kind) throw new Error(`Source ${source.id} has locator kind ${source.locator.kind}, expected ${kind}.`);
  return source.locator as Extract<WorkspaceKnowledgeSourceLocator, { kind: T }>;
}

function buildSourceDirectoryMap(sources: WorkspaceKnowledgeSource[]) {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const source of sources) {
    const base = sourceDirectoryName(source.id);
    const name = used.has(base) ? `${base}-${sha256(source.id).slice(0, 8)}` : base;
    used.add(name);
    map.set(source.id, name);
  }
  return map;
}

function sourceDirectoryName(sourceId: string) {
  return slugify(sourceId) || `source-${sha256(sourceId).slice(0, 12)}`;
}

function sanitizeOutputRelativePath(value: string) {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return `document-${sha256(value).slice(0, 12)}.md`;
  return normalized.split("/").map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "-") || "document").join("/");
}

function normalizePathForIdentity(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function safeCorpusPath(root: string, relativePath: string) {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, "/"));
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) throw new Error("Knowledge output path escaped its corpus root.");
  return path.join(root, ...normalized.split("/"));
}

async function assertNoSymlinkAlongPath(root: string, target: string, allowMissingTarget = false) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Knowledge path escaped its root.");
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const metadata = await lstat(current).catch(() => null);
    if (!metadata) {
      if (allowMissingTarget || index === parts.length - 1) return;
      continue;
    }
    if (metadata.isSymbolicLink()) throw new Error("Knowledge path contains a symbolic link.");
  }
}

async function resolveSafeInputRoot(inputPath: string, allowFile: boolean) {
  const normalized = path.resolve(inputPath);
  assertSafeInputPath(normalized);
  const metadata = await lstat(normalized);
  if (metadata.isSymbolicLink()) throw new Error("Knowledge input roots cannot be symbolic links.");
  if (allowFile ? !metadata.isFile() : !metadata.isDirectory()) throw new Error("Knowledge input path has the wrong filesystem type.");
  return realpath(normalized);
}

async function resolveSafeInputFile(inputPath: string) {
  return resolveSafeInputRoot(inputPath, true);
}

function assertSafeInputPath(inputPath: string) {
  const normalized = path.resolve(inputPath);
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  const forbiddenRoots = ["/etc", "/private/etc", "/System", "/private/var", "/usr", "/bin", "/sbin", "/Library"];
  if (forbiddenRoots.some((root) => isPathWithin(root, normalized))) throw new Error("Knowledge ingestion cannot read system directories.");
  if (home && [".ssh", ".openclaw", ".aws", ".gnupg"].some((segment) => isPathWithin(path.join(home, segment), normalized))) throw new Error("Knowledge ingestion cannot read credential directories.");
  if (normalized.split(path.sep).some((segment) => [".ssh", ".openclaw", ".aws", ".gnupg"].includes(segment.toLowerCase()))) throw new Error("Knowledge ingestion cannot read credential directories.");
  if (isSensitiveFileName(path.basename(normalized).toLowerCase())) throw new Error("Knowledge ingestion cannot read credential files.");
}

function isPathWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export type KnowledgeGitCommandRunner = (
  file: string,
  args: string[],
  options: {
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  }
) => Promise<{ stdout: string; stderr: string }>;

export async function runSafeGitClone(
  repoUrl: URL | string,
  targetDir: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  resolvedAddresses: string[],
  commandRunner: KnowledgeGitCommandRunner = execFileAsync
) {
  throwIfAborted(signal);
  const normalizedUrl = typeof repoUrl === "string" ? normalizeKnowledgeRepositoryRemoteUrl(repoUrl) : normalizeKnowledgeRepositoryRemoteUrl(repoUrl.toString());
  assertPublicAddresses(resolvedAddresses, "Remote repository host resolves to a blocked or non-public address.");
  const isolatedHome = await mkdtempSafe("agentos-knowledge-git-home-");
  const gitEnv = {
    ...createSafeGitEnvironment(),
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
    CURL_HOME: isolatedHome
  } as unknown as NodeJS.ProcessEnv;
  const commandOptions = {
    timeout: Math.max(timeoutMs, 30_000),
    maxBuffer: 1024 * 1024,
    env: gitEnv,
    signal
  };
  try {
    const version = await commandRunner("git", ["--version"], commandOptions);
    if (!isGitVersionAtLeast(version.stdout, MIN_PINNED_GIT_VERSION)) throw new Error("Remote repository ingestion requires Git 2.37.0 or newer for DNS pinning.");
    const hostname = stripIpv6Brackets(normalizedUrl.hostname);
    const resolveHost = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
    const port = normalizedUrl.port || "443";
    const resolveValue = `${resolveHost}:${port}:${resolvedAddresses.map(formatCurlResolveAddress).join(",")}`;
    await commandRunner("git", [
      "-c", `http.curloptResolve=${resolveValue}`,
      "-c", "http.sslVerify=true",
      "-c", "http.sslVersion=",
      "-c", "http.sslCipherList=",
      "-c", "http.proxy=",
      "-c", "https.proxy=",
      "-c", "http.followRedirects=false",
      "-c", "credential.helper=",
      "-c", "protocol.file.allow=never",
      "-c", "core.hooksPath=/dev/null",
      "clone",
      "--depth", "1",
      "--no-tags",
      "--no-recurse-submodules",
      "--",
      normalizedUrl.toString(),
      targetDir
    ], commandOptions);
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw new KnowledgeIngestionCancelledError();
    if (error instanceof Error && error.message.includes("requires Git 2.37.0")) throw error;
    throw new Error("Remote repository checkout failed.");
  } finally {
    await rm(isolatedHome, { recursive: true, force: true }).catch(() => undefined);
  }
  throwIfAborted(signal);
}

function createSafeGitEnvironment(): NodeJS.ProcessEnv {
  const blocked = /^(?:GIT_CONFIG_|GIT_ASKPASS$|GIT_SSH|SSH_|GIT_CREDENTIAL|GIT_.*PROXY|GIT_TRACE|GIT_DEBUG|GIT_SSL_(?:NO_VERIFY|VERSION|CIPHER_LIST|CERT$|KEY$|CERT_PASSWORD_PROTECTED$))/i;
  const proxy = /^(?:HTTP_PROXY|HTTPS_PROXY|FTP_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|ftp_proxy|all_proxy|no_proxy)$/;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !blocked.test(key) && !proxy.test(key)));
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1"
  } as unknown as NodeJS.ProcessEnv;
}

function formatCurlResolveAddress(address: string) {
  const normalized = stripIpv6Brackets(address);
  return isIP(normalized) === 6 ? `[${normalized}]` : normalized;
}

function isGitVersionAtLeast(actual: string, minimum: string) {
  const actualParts = actual.match(/git version (\d+)\.(\d+)(?:\.(\d+))?/i);
  const minimumParts = minimum.split(".").map(Number);
  if (!actualParts) return false;
  const current = [Number(actualParts[1]), Number(actualParts[2]), Number(actualParts[3] ?? 0)];
  for (let index = 0; index < minimumParts.length; index += 1) {
    if (current[index] !== minimumParts[index]) return current[index] > minimumParts[index];
  }
  return true;
}

function isAbortError(error: unknown) {
  return isRecord(error) && (error.name === "AbortError" || error.code === "ABORT_ERR");
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === code;
}

async function mkdtempSafe(prefix: string) {
  const base = path.join(process.env.TMPDIR ?? "/tmp", prefix);
  return mkdtemp(base);
}

function pathExistsSyncSafe(filePath: string) {
  return Boolean(filePath) && existsSync(filePath);
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasUrlCredentials(value: string) {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function stripIpv6Brackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function ipv6ToGroups(value: string): string[] | null {
  const parts = value.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const expand = (part: string) => {
    if (!part) return [];
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
      return [((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16)];
    }
    return [part];
  };
  const leftParts = left.map(expand);
  const rightParts = right.map(expand);
  if (leftParts.some((part) => part === null) || rightParts.some((part) => part === null)) return null;
  const leftExpanded = leftParts.flatMap((part) => part ?? []);
  const rightExpanded = rightParts.flatMap((part) => part ?? []);
  if (leftExpanded.length + rightExpanded.length > 8) return null;
  const missing = parts.length === 2 ? 8 - leftExpanded.length - rightExpanded.length : 0;
  if (parts.length === 1 && leftExpanded.length !== 8) return null;
  const groups = [...leftExpanded, ...Array.from({ length: missing }, () => "0"), ...rightExpanded];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0").toLowerCase());
}
