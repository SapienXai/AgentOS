import { WORKSPACE_MANAGED_FILE_MAX_BYTES } from "@/lib/openclaw/workspace-file-types";

export const KNOWLEDGE_IMPORT_FORMATS = ["md", "txt", "csv", "json", "docx", "xlsx", "pdf", "yaml", "toml", "html", "xml"] as const;
export const KNOWLEDGE_IMPORT_ACCEPT = [...KNOWLEDGE_IMPORT_FORMATS.map(format => "." + format), ".markdown", ".yml", ".htm", "README", "Makefile"].join(",");
export const KNOWLEDGE_IMPORT_INPUT_BYTES = 4 * 1024 * 1024;
export const KNOWLEDGE_IMPORT_TEXT_BYTES = WORKSPACE_MANAGED_FILE_MAX_BYTES;
export type KnowledgeImportFormat = typeof KNOWLEDGE_IMPORT_FORMATS[number];

export function isAssignableDocument(relativePath: string) {
  return /^docs\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.md$/.test(relativePath) &&
    !relativePath.startsWith("docs/sources/") && !relativePath.startsWith("docs/library/reference/");
}

export function knowledgeFormatFromPath(path: string): KnowledgeImportFormat | "note" | "reference" | "web" | null {
  if (path.startsWith("docs/sources/")) return "reference";
  const format = /^docs\/library\/([^/]+)\//.exec(path)?.[1];
  return format === "note" || format === "reference" || format === "web" || KNOWLEDGE_IMPORT_FORMATS.includes(format as KnowledgeImportFormat)
    ? format as KnowledgeImportFormat | "note" | "reference" | "web" : null;
}

export const MAX_KNOWLEDGE_ASSIGNMENT_CHANGES = 32;

export type KnowledgeAssignmentChange = {
  path: string;
  selected: boolean;
};

export function documentLabel(path: string) {
  const name = path.split("/").at(-1) ?? path;
  return name.replace(/-[a-f0-9]{8,20}(?=\.(?:md|json)$)/, "").replace(/\.(?:md|json)$/, "").replaceAll("-", " ");
}

export function deferredSetupDocumentsKey(workspaceId: string) {
  return "workforce:setup-documents:" + workspaceId;
}
