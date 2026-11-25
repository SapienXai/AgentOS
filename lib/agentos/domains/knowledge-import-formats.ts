import { WORKSPACE_MANAGED_FILE_MAX_BYTES } from "@/lib/openclaw/workspace-file-types";

export const KNOWLEDGE_IMPORT_FORMATS = ["md", "txt", "csv", "json", "docx", "xlsx", "pdf"] as const;
export const KNOWLEDGE_IMPORT_ACCEPT = KNOWLEDGE_IMPORT_FORMATS.map(format => "." + format).join(",");
export const KNOWLEDGE_IMPORT_INPUT_BYTES = 4 * 1024 * 1024;
export const KNOWLEDGE_IMPORT_TEXT_BYTES = WORKSPACE_MANAGED_FILE_MAX_BYTES;
export type KnowledgeImportFormat = typeof KNOWLEDGE_IMPORT_FORMATS[number];

export function isAssignableDocument(relativePath: string) {
  return /^docs\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.md$/.test(relativePath) &&
    !relativePath.startsWith("docs/sources/") && !relativePath.startsWith("docs/library/reference/");
}

export function knowledgeFormatFromPath(path: string): KnowledgeImportFormat | "note" | "reference" | null {
  if (path.startsWith("docs/sources/")) return "reference";
  const format = /^docs\/library\/([^/]+)\//.exec(path)?.[1];
  return format === "note" || format === "reference" || KNOWLEDGE_IMPORT_FORMATS.includes(format as KnowledgeImportFormat)
    ? format as KnowledgeImportFormat | "note" | "reference" : null;
}
