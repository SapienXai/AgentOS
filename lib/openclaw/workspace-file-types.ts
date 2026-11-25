export const WORKSPACE_MANAGED_FILE_MAX_BYTES = 512 * 1024;

export type WorkspaceManagedFileCategory =
  | "context"
  | "memory"
  | "identity"
  | "tools"
  | "boot"
  | "skills"
  | "project-config"
  | "agent-policy-config";

export type WorkspaceManagedFileLanguage = "markdown" | "json";

export type WorkspaceManagedFileSource = "official" | "discovered" | "virtual";

export type WorkspaceManagedFile = {
  path: string;
  label: string;
  category: WorkspaceManagedFileCategory;
  language: WorkspaceManagedFileLanguage;
  exists: boolean;
  createable: boolean;
  editable: boolean;
  size: number | null;
  source: WorkspaceManagedFileSource;
  description?: string;
  usage?: string;
  runtimeBehavior?: string;
  reason?: string;
};

export type WorkspaceManagedFileListResponse = {
  workspaceId: string;
  workspacePath: string;
  files: WorkspaceManagedFile[];
  maxFileBytes: number;
};

export type WorkspaceManagedFileReadResponse = {
  workspaceId: string;
  workspacePath: string;
  file: WorkspaceManagedFile;
  content: string;
  maxFileBytes: number;
};
