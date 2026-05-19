import "server-only";

import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { workspacePathMatchesId } from "@/lib/openclaw/domains/workspace-id";
import type {
  WorkspaceManagedFile,
  WorkspaceManagedFileCategory,
  WorkspaceManagedFileLanguage,
  WorkspaceManagedFileListResponse,
  WorkspaceManagedFileReadResponse,
  WorkspaceManagedFileSource
} from "@/lib/openclaw/workspace-file-types";
import type { WorkspaceProject } from "@/lib/openclaw/types";

export const WORKSPACE_MANAGED_FILE_MAX_BYTES = 512 * 1024;

type WorkspaceFileSpec = {
  path: string;
  category: WorkspaceManagedFileCategory;
  language: WorkspaceManagedFileLanguage;
  description: string;
  createable?: boolean;
};

type WorkspaceFileDescriptor = {
  category: WorkspaceManagedFileCategory;
  language: WorkspaceManagedFileLanguage;
  source: WorkspaceManagedFileSource;
  description?: string;
  createable: boolean;
};

const officialWorkspaceFileSpecs: WorkspaceFileSpec[] = [
  {
    path: "AGENTS.md",
    category: "context",
    language: "markdown",
    description: "OpenClaw operating instructions loaded into Project Context."
  },
  {
    path: "SOUL.md",
    category: "context",
    language: "markdown",
    description: "OpenClaw persona, tone, and operating boundaries."
  },
  {
    path: "USER.md",
    category: "context",
    language: "markdown",
    description: "OpenClaw user profile context loaded with the workspace."
  },
  {
    path: "IDENTITY.md",
    category: "identity",
    language: "markdown",
    description: "Workspace identity and display profile."
  },
  {
    path: "TOOLS.md",
    category: "tools",
    language: "markdown",
    description: "Workspace tool conventions. Guidance only, not tool permissions."
  },
  {
    path: "HEARTBEAT.md",
    category: "boot",
    language: "markdown",
    description: "Heartbeat checklist used by OpenClaw heartbeat runs."
  },
  {
    path: "BOOT.md",
    category: "boot",
    language: "markdown",
    description: "Startup checklist used by the OpenClaw boot-md hook."
  },
  {
    path: "BOOTSTRAP.md",
    category: "boot",
    language: "markdown",
    description: "One-time first-run bootstrap ritual."
  },
  {
    path: "MEMORY.md",
    category: "memory",
    language: "markdown",
    description: "Curated long-term workspace memory."
  },
  {
    path: ".openclaw/project.json",
    category: "project-config",
    language: "json",
    description: "AgentOS/OpenClaw workspace project metadata."
  },
  {
    path: ".openclaw/workspace-state.json",
    category: "project-config",
    language: "json",
    description: "OpenClaw workspace bootstrap state.",
    createable: false
  }
];

const officialSpecByPath = new Map(officialWorkspaceFileSpecs.map((spec) => [spec.path, spec]));
const blockedPathTokenPattern = /(^|[-_.])(auth|credential|credentials|secret|secrets|token|tokens|key|keys|session|sessions|provider|providers|env|oauth|cookie|cookies)([-_.]|$)/i;
const safeOpenClawRootFileNames = new Set([
  "project.json",
  "workspace-state.json",
  "workspace.json",
  "workspace.md",
  "project.md",
  "metadata.json",
  "metadata.md",
  "README.md"
]);
const safeAgentScopedFileNames = new Set([
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
  "POLICY.md",
  "policy.md",
  "policy.json",
  "profile.md",
  "profile.json",
  "metadata.md",
  "metadata.json",
  "README.md"
]);

export async function listWorkspaceManagedFiles(workspaceId: string): Promise<WorkspaceManagedFileListResponse> {
  const workspace = await resolveWorkspace(workspaceId);
  const files = await listWorkspaceManagedFilesForPath(workspace.path);

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    files,
    maxFileBytes: WORKSPACE_MANAGED_FILE_MAX_BYTES
  };
}

export async function readWorkspaceManagedFile(input: {
  workspaceId: string;
  path: string;
}): Promise<WorkspaceManagedFileReadResponse> {
  const workspace = await resolveWorkspace(input.workspaceId);
  const result = await readWorkspaceManagedFileForPath(workspace.path, input.path);

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    ...result
  };
}

export async function readWorkspaceManagedFileForPath(
  workspacePath: string,
  inputPath: string
): Promise<Omit<WorkspaceManagedFileReadResponse, "workspaceId" | "workspacePath">> {
  const { file, absolutePath } = await resolveWorkspaceManagedFileForPath(workspacePath, inputPath);

  if (!file.exists) {
    if (!file.createable) {
      throw new Error("Workspace file does not exist.");
    }

    return {
      file,
      content: "",
      maxFileBytes: WORKSPACE_MANAGED_FILE_MAX_BYTES
    };
  }

  if (!file.editable) {
    throw new Error(file.reason ?? "Workspace file is not editable.");
  }

  const content = await readFile(absolutePath, "utf8");

  return {
    file,
    content,
    maxFileBytes: WORKSPACE_MANAGED_FILE_MAX_BYTES
  };
}

export async function writeWorkspaceManagedFile(input: {
  workspaceId: string;
  path: string;
  content: string;
}): Promise<WorkspaceManagedFileReadResponse> {
  const workspace = await resolveWorkspace(input.workspaceId);
  const result = await writeWorkspaceManagedFileForPath(workspace.path, input.path, input.content);

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    ...result
  };
}

export async function writeWorkspaceManagedFileForPath(
  workspacePath: string,
  inputPath: string,
  content: string
): Promise<Omit<WorkspaceManagedFileReadResponse, "workspaceId" | "workspacePath">> {
  const { file, absolutePath, workspaceRealPath } = await resolveWorkspaceManagedFileForPath(
    workspacePath,
    inputPath
  );

  if (!file.exists && !file.createable) {
    throw new Error("Workspace file cannot be created from this surface.");
  }

  if (Buffer.byteLength(content, "utf8") > WORKSPACE_MANAGED_FILE_MAX_BYTES) {
    throw new Error(`Workspace file exceeds ${formatBytes(WORKSPACE_MANAGED_FILE_MAX_BYTES)}.`);
  }

  if (file.language === "json") {
    try {
      JSON.parse(content);
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.");
    }
  }

  const parentPath = path.dirname(absolutePath);
  await mkdir(parentPath, { recursive: true });
  await assertRealPathInsideWorkspace(parentPath, workspaceRealPath);

  if (file.exists) {
    await assertExistingFileSafe(absolutePath, workspaceRealPath);
  }

  await writeFile(absolutePath, content, "utf8");

  return readWorkspaceManagedFileForPath(workspacePath, file.path);
}

export async function listWorkspaceManagedFilesForPath(workspacePath: string) {
  const workspaceRealPath = await realpath(workspacePath);
  const fileMap = new Map<string, WorkspaceManagedFile>();

  for (const spec of officialWorkspaceFileSpecs) {
    fileMap.set(spec.path, await buildFileEntry(workspacePath, workspaceRealPath, spec.path, {
      category: spec.category,
      language: spec.language,
      source: "official",
      description: spec.description,
      createable: spec.createable !== false
    }));
  }

  for (const relativePath of await discoverSafeWorkspaceFilePaths(workspacePath)) {
    if (fileMap.has(relativePath)) {
      continue;
    }

    const descriptor = describeAllowedWorkspaceFile(relativePath, "discovered");
    if (!descriptor) {
      continue;
    }

    fileMap.set(relativePath, await buildFileEntry(workspacePath, workspaceRealPath, relativePath, descriptor));
  }

  return Array.from(fileMap.values()).sort(compareWorkspaceManagedFiles);
}

export async function resolveWorkspaceManagedFileForPath(workspacePath: string, inputPath: string) {
  const normalizedPath = normalizeWorkspaceRelativePath(inputPath);
  const descriptor = describeAllowedWorkspaceFile(normalizedPath, officialSpecByPath.has(normalizedPath) ? "official" : "discovered");

  if (!descriptor) {
    throw new Error("Workspace file is not in the editable OpenClaw workspace allowlist.");
  }

  const workspaceRealPath = await realpath(workspacePath);
  const absolutePath = resolveWorkspaceChildPath(workspacePath, normalizedPath);
  const file = await buildFileEntry(workspacePath, workspaceRealPath, normalizedPath, descriptor);

  return {
    file,
    absolutePath,
    workspaceRealPath
  };
}

async function resolveWorkspace(workspaceId: string) {
  const normalizedWorkspaceId = workspaceId.trim();

  if (!normalizedWorkspaceId) {
    throw new Error("Workspace id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ includeHidden: true });
  const workspace = findWorkspaceById(snapshot.workspaces, normalizedWorkspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  return workspace;
}

function findWorkspaceById(workspaces: WorkspaceProject[], workspaceId: string) {
  return (
    workspaces.find((workspace) => workspace.id === workspaceId) ??
    workspaces.find((workspace) => workspacePathMatchesId(workspace.path, workspaceId))
  );
}

async function discoverSafeWorkspaceFilePaths(workspacePath: string) {
  const discovered = new Set<string>();

  await collectFiles(workspacePath, "memory", discovered, {
    maxDepth: 4,
    include: (relativePath) => relativePath.endsWith(".md")
  });
  await collectFiles(workspacePath, "docs", discovered, {
    maxDepth: 4,
    include: (relativePath) => relativePath.endsWith(".md") || relativePath.endsWith(".json")
  });
  await collectFiles(workspacePath, "skills", discovered, {
    maxDepth: 4,
    include: (relativePath) => relativePath.endsWith("/SKILL.md")
  });
  await collectFiles(workspacePath, ".agents/skills", discovered, {
    maxDepth: 4,
    include: (relativePath) => relativePath.endsWith("/SKILL.md")
  });
  await collectFiles(workspacePath, ".openclaw", discovered, {
    maxDepth: 4,
    include: (relativePath) => Boolean(describeAllowedOpenClawRelativePath(relativePath))
  });

  return Array.from(discovered);
}

async function collectFiles(
  workspacePath: string,
  relativeDirectory: string,
  output: Set<string>,
  options: {
    maxDepth: number;
    include: (relativePath: string) => boolean;
  },
  currentDepth = 0
) {
  if (currentDepth > options.maxDepth || output.size > 500) {
    return;
  }

  const absoluteDirectory = resolveWorkspaceChildPath(workspacePath, relativeDirectory);

  let entries: Dirent<string>[];
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && relativeDirectory !== ".openclaw") {
      continue;
    }

    const childRelativePath = toPosixPath(path.join(relativeDirectory, entry.name));

    if (isBlockedWorkspacePath(childRelativePath) || entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectFiles(workspacePath, childRelativePath, output, options, currentDepth + 1);
      continue;
    }

    if (entry.isFile() && options.include(childRelativePath)) {
      output.add(childRelativePath);
    }
  }
}

async function buildFileEntry(
  workspacePath: string,
  workspaceRealPath: string,
  relativePath: string,
  descriptor: WorkspaceFileDescriptor
): Promise<WorkspaceManagedFile> {
  const absolutePath = resolveWorkspaceChildPath(workspacePath, relativePath);
  const label = path.posix.basename(relativePath);

  try {
    const fileStat = await lstat(absolutePath);
    if (fileStat.isSymbolicLink()) {
      return {
        path: relativePath,
        label,
        category: descriptor.category,
        language: descriptor.language,
        exists: true,
        createable: false,
        editable: false,
        size: null,
        source: descriptor.source,
        description: descriptor.description,
        reason: "Symlinks are not editable here."
      };
    }

    if (!fileStat.isFile()) {
      return {
        path: relativePath,
        label,
        category: descriptor.category,
        language: descriptor.language,
        exists: true,
        createable: false,
        editable: false,
        size: null,
        source: descriptor.source,
        description: descriptor.description,
        reason: "Only regular Markdown and JSON files are editable."
      };
    }

    await assertRealPathInsideWorkspace(absolutePath, workspaceRealPath);

    return {
      path: relativePath,
      label,
      category: descriptor.category,
      language: descriptor.language,
      exists: true,
      createable: false,
      editable: fileStat.size <= WORKSPACE_MANAGED_FILE_MAX_BYTES,
      size: fileStat.size,
      source: descriptor.source,
      description: descriptor.description,
      reason: fileStat.size > WORKSPACE_MANAGED_FILE_MAX_BYTES
        ? `File is larger than ${formatBytes(WORKSPACE_MANAGED_FILE_MAX_BYTES)}.`
        : undefined
    };
  } catch {
    return {
      path: relativePath,
      label,
      category: descriptor.category,
      language: descriptor.language,
      exists: false,
      createable: descriptor.createable,
      editable: descriptor.createable,
      size: null,
      source: descriptor.source,
      description: descriptor.description
    };
  }
}

function describeAllowedWorkspaceFile(
  relativePath: string,
  source: WorkspaceManagedFileSource
): WorkspaceFileDescriptor | null {
  const official = officialSpecByPath.get(relativePath);
  if (official) {
    return {
      category: official.category,
      language: official.language,
      source: "official",
      description: official.description,
      createable: official.createable !== false
    };
  }

  if (isBlockedWorkspacePath(relativePath)) {
    return null;
  }

  const parts = relativePath.split("/");
  const language = inferLanguage(relativePath);

  if (!language) {
    return null;
  }

  if (parts[0] === "memory" && parts.length >= 2 && language === "markdown") {
    return {
      category: "memory",
      language,
      source,
      createable: true
    };
  }

  if (parts[0] === "docs" && parts.length >= 2) {
    return {
      category: "context",
      language,
      source,
      createable: true
    };
  }

  if (parts[0] === "skills" && parts.at(-1) === "SKILL.md") {
    return {
      category: parts[1]?.startsWith("agent-policy-") ? "agent-policy-config" : "skills",
      language: "markdown",
      source,
      createable: true
    };
  }

  if (parts[0] === ".agents" && parts[1] === "skills" && parts.at(-1) === "SKILL.md") {
    return {
      category: "skills",
      language: "markdown",
      source,
      createable: true
    };
  }

  const openClawDescriptor = describeAllowedOpenClawRelativePath(relativePath);
  if (openClawDescriptor) {
    return {
      ...openClawDescriptor,
      source,
      createable: openClawDescriptor.createable
    };
  }

  return null;
}

function describeAllowedOpenClawRelativePath(relativePath: string): Omit<WorkspaceFileDescriptor, "source"> | null {
  if (!relativePath.startsWith(".openclaw/")) {
    return null;
  }

  if (isBlockedWorkspacePath(relativePath)) {
    return null;
  }

  const parts = relativePath.split("/");
  const language = inferLanguage(relativePath);
  if (!language) {
    return null;
  }

  if (parts.length === 2) {
    if (!safeOpenClawRootFileNames.has(parts[1])) {
      return null;
    }

    return {
      category: "project-config",
      language,
      createable: parts[1] === "project.json"
    };
  }

  if (
    parts.length === 5 &&
    parts[0] === ".openclaw" &&
    parts[1] === "agents" &&
    parts[3] === "agent"
  ) {
    if (!safeAgentScopedFileNames.has(parts[4])) {
      return null;
    }

    return {
      category: "agent-policy-config",
      language,
      createable: false
    };
  }

  return null;
}

function normalizeWorkspaceRelativePath(inputPath: string) {
  const raw = inputPath.trim().replace(/\\/g, "/");

  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("Workspace file path is invalid.");
  }

  const normalized = path.posix.normalize(raw);

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Workspace file path is outside the workspace.");
  }

  return normalized;
}

function resolveWorkspaceChildPath(workspacePath: string, relativePath: string) {
  const absolutePath = path.resolve(workspacePath, relativePath);
  const absoluteWorkspacePath = path.resolve(workspacePath);
  const workspacePrefix = `${absoluteWorkspacePath}${path.sep}`;

  if (absolutePath !== absoluteWorkspacePath && !absolutePath.startsWith(workspacePrefix)) {
    throw new Error("Workspace file path is outside the workspace.");
  }

  return absolutePath;
}

async function assertExistingFileSafe(absolutePath: string, workspaceRealPath: string) {
  const fileStat = await lstat(absolutePath);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error("Only regular workspace files can be edited.");
  }

  await assertRealPathInsideWorkspace(absolutePath, workspaceRealPath);
}

async function assertRealPathInsideWorkspace(absolutePath: string, workspaceRealPath: string) {
  const targetRealPath = await realpath(absolutePath);
  const workspacePrefix = `${workspaceRealPath}${path.sep}`;

  if (targetRealPath !== workspaceRealPath && !targetRealPath.startsWith(workspacePrefix)) {
    throw new Error("Workspace file path resolves outside the workspace.");
  }
}

function isBlockedWorkspacePath(relativePath: string) {
  return relativePath
    .split("/")
    .some((part) => blockedPathTokenPattern.test(part));
}

function inferLanguage(relativePath: string): WorkspaceManagedFileLanguage | null {
  if (relativePath.endsWith(".md")) {
    return "markdown";
  }

  if (relativePath.endsWith(".json")) {
    return "json";
  }

  return null;
}

function compareWorkspaceManagedFiles(left: WorkspaceManagedFile, right: WorkspaceManagedFile) {
  const leftCategoryIndex = workspaceFileCategoryOrder.indexOf(left.category);
  const rightCategoryIndex = workspaceFileCategoryOrder.indexOf(right.category);

  if (leftCategoryIndex !== rightCategoryIndex) {
    return leftCategoryIndex - rightCategoryIndex;
  }

  if (left.source !== right.source) {
    return left.source === "official" ? -1 : 1;
  }

  return left.path.localeCompare(right.path);
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

const workspaceFileCategoryOrder: WorkspaceManagedFileCategory[] = [
  "context",
  "memory",
  "identity",
  "tools",
  "boot",
  "skills",
  "project-config",
  "agent-policy-config"
];
