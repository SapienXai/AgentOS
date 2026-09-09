import "server-only";

import path from "node:path";

import {
  ingestKnowledgeSources,
  readKnowledgeIngestionState,
  type IngestKnowledgeSourcesInput,
  type KnowledgeIngestionLimits,
  type KnowledgeIngestionProgress,
  type KnowledgeIngestionResult,
  type KnowledgeIngestionState,
  type KnowledgeWebsiteFetcher
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";

export type WorkspaceKnowledgeIngestionOptions = {
  signal?: AbortSignal;
  limits?: Partial<KnowledgeIngestionLimits>;
  onProgress?: (progress: KnowledgeIngestionProgress) => void | Promise<void>;
  websiteFetcher?: KnowledgeWebsiteFetcher;
};

/** Ingest the knowledge declarations owned by a workspace manifest. */
export async function ingestWorkspaceKnowledge(
  workspacePath: string,
  options: WorkspaceKnowledgeIngestionOptions = {}
): Promise<KnowledgeIngestionResult> {
  const manifest = await readWorkspaceProjectManifest(workspacePath);
  const input: IngestKnowledgeSourcesInput = {
    sources: manifest.knowledgeSources,
    corpusRoot: path.join(workspacePath, "knowledge"),
    stateRoot: path.join(workspacePath, ".openclaw", "knowledge"),
    ...options
  };
  return ingestKnowledgeSources(input);
}

/** Read the last persisted ingestion state without starting an ingestion run. */
export function getWorkspaceKnowledgeIngestionState(workspacePath: string): Promise<KnowledgeIngestionState | null> {
  return readKnowledgeIngestionState(
    path.join(workspacePath, ".openclaw", "knowledge"),
    path.join(workspacePath, "knowledge")
  );
}
