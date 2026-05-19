"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Braces, FileText, Loader2, PlusCircle, RefreshCw, Save, Undo2, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  WorkspaceManagedFile,
  WorkspaceManagedFileCategory,
  WorkspaceManagedFileListResponse,
  WorkspaceManagedFileReadResponse
} from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";

type WorkspaceDialogAgent = MissionControlSnapshot["agents"][number];

const categoryLabels: Record<WorkspaceManagedFileCategory, string> = {
  context: "Context",
  memory: "Memory",
  identity: "Identity",
  tools: "Tools",
  boot: "Boot",
  skills: "Skills",
  "project-config": "Project Config",
  "agent-policy-config": "Agent Policy/Config"
};

export function WorkspaceContextFilesDialog({
  snapshot,
  workspaceId,
  open,
  onOpenChange
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useMemo(
    () => snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [snapshot.workspaces, workspaceId]
  );
  const [files, setFiles] = useState<WorkspaceManagedFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceManagedFile | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxFileBytes, setMaxFileBytes] = useState<number | null>(null);
  const hasUnsavedChanges = content !== savedContent;
  const activeFile = selectedFile ?? files.find((file) => file.path === selectedPath) ?? null;
  const canEditActiveFile = Boolean(activeFile?.editable && !isLoadingFile);
  const workspaceAgents = useMemo(() => {
    if (!workspaceId) {
      return [];
    }

    const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
    const workspaceAgentOrder = new Map(
      (workspace?.agentIds ?? []).map((agentId, index) => [agentId, index])
    );

    return agents.toSorted(
      (left, right) =>
        (workspaceAgentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (workspaceAgentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    );
  }, [snapshot.agents, workspace?.agentIds, workspaceId]);
  const fileNavigation = useMemo(
    () => buildFileNavigation(files, workspaceAgents),
    [files, workspaceAgents]
  );

  const refreshFiles = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setIsLoadingList(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        cache: "no-store"
      });
      const result = (await response.json()) as WorkspaceManagedFileListResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file list could not be loaded.");
      }

      setFiles(result.files);
      setMaxFileBytes(result.maxFileBytes);
      setSelectedPath((current) => {
        if (current && result.files.some((file) => file.path === current)) {
          return current;
        }

        return chooseInitialFilePath(result.files);
      });
    } catch (loadError) {
      setFiles([]);
      setSelectedPath(null);
      setSelectedFile(null);
      setContent("");
      setSavedContent("");
      setError(loadError instanceof Error ? loadError.message : "Workspace file list could not be loaded.");
    } finally {
      setIsLoadingList(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open || !workspaceId) {
      setFiles([]);
      setSelectedPath(null);
      setSelectedFile(null);
      setContent("");
      setSavedContent("");
      setError(null);
      return;
    }

    void refreshFiles();
  }, [open, refreshFiles, workspaceId]);

  useEffect(() => {
    if (!open || !workspaceId || !selectedPath) {
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(selectedPath)}`,
          { cache: "no-store" }
        );
        const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };

        if (!response.ok || result.error) {
          throw new Error(result.error || "Workspace file could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        setSelectedFile(result.file);
        setFiles((current) => replaceWorkspaceFile(current, result.file));
        setContent(result.content);
        setSavedContent(result.content);
        setMaxFileBytes(result.maxFileBytes);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setSelectedFile(null);
        setContent("");
        setSavedContent("");
        setError(loadError instanceof Error ? loadError.message : "Workspace file could not be loaded.");
      } finally {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedPath, workspaceId]);

  const selectFile = useCallback(
    (file: WorkspaceManagedFile) => {
      if (file.path === selectedPath) {
        return;
      }

      if (hasUnsavedChanges && !window.confirm("Discard unsaved changes?")) {
        return;
      }

      setSelectedPath(file.path);
      setSelectedFile(file);
    },
    [hasUnsavedChanges, selectedPath]
  );
  const selectAgent = useCallback(
    (agentId: string) => {
      const agentFiles = fileNavigation.agentFilesByAgentId.get(agentId) ?? [];
      const firstFile = agentFiles[0];

      if (!firstFile) {
        return;
      }

      selectFile(firstFile);
    },
    [fileNavigation.agentFilesByAgentId, selectFile]
  );

  const saveFile = useCallback(async () => {
    if (!workspaceId || !activeFile || !activeFile.editable) {
      return;
    }

    if (maxFileBytes && new Blob([content]).size > maxFileBytes) {
      setError(`File exceeds ${formatFileSize(maxFileBytes)}.`);
      return;
    }

    if (activeFile.language === "json") {
      try {
        JSON.parse(content);
      } catch (jsonError) {
        setError(jsonError instanceof Error ? `Invalid JSON: ${jsonError.message}` : "Invalid JSON.");
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      const wasCreated = !activeFile.exists;
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: activeFile.path,
          content
        })
      });
      const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file could not be saved.");
      }

      setSelectedFile(result.file);
      setFiles((current) => replaceWorkspaceFile(current, result.file));
      setContent(result.content);
      setSavedContent(result.content);
      setMaxFileBytes(result.maxFileBytes);
      toast.success(wasCreated ? "Workspace file created." : "Workspace file saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Workspace file could not be saved.";
      setError(message);
      toast.error("Workspace file save failed.", {
        description: message
      });
    } finally {
      setIsSaving(false);
    }
  }, [activeFile, content, maxFileBytes, workspaceId]);

  const discardChanges = useCallback(() => {
    setContent(savedContent);
    setError(null);
  }, [savedContent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-48px))] max-w-[min(1120px,calc(100vw-32px))] flex-col gap-0 overflow-hidden rounded-[24px] p-0">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-lg">OpenClaw Workspace Files</DialogTitle>
          <DialogDescription className="truncate">
            {workspace ? `${workspace.name} · ${workspace.path}` : "Workspace context, memory, policy, and config files."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-white/10 bg-white/[0.02] p-3 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">Files</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refreshFiles()}
                disabled={isLoadingList || !workspaceId}
                className="h-8 rounded-xl px-2 text-xs"
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoadingList && "animate-spin")} />
                Refresh
              </Button>
            </div>

            {isLoadingList ? (
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading workspace files
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-slate-400">
                No editable OpenClaw workspace files were found.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <SectionHeading
                    label="Workspace Core Files"
                    detail={`${fileNavigation.workspaceFiles.length} files`}
                  />
                  <div className="space-y-1">
                    {fileNavigation.workspaceFiles.map((file) => (
                      <FileListButton
                        key={file.path}
                        file={file}
                        active={file.path === activeFile?.path}
                        onSelect={selectFile}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <SectionHeading label="Agents" detail={`${workspaceAgents.length} members`} />
                  <div className="space-y-1">
                    {workspaceAgents.length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-slate-400">
                        No agents are assigned to this workspace.
                      </div>
                    ) : (
                      workspaceAgents.map((agent) => {
                        const agentFiles = fileNavigation.agentFilesByAgentId.get(agent.id) ?? [];
                        const isActiveAgent = activeFile
                          ? getWorkspaceManagedFileAgentId(activeFile, workspaceAgents) === agent.id
                          : false;

                        return (
                          <button
                            key={agent.id}
                            type="button"
                            onClick={() => selectAgent(agent.id)}
                            disabled={agentFiles.length === 0}
                            className={cn(
                              "w-full rounded-2xl border px-3 py-2 text-left transition-colors disabled:cursor-default disabled:opacity-60",
                              isActiveAgent
                                ? "border-cyan-300/35 bg-cyan-300/10 text-white"
                                : "border-white/5 bg-white/[0.025] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Users className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">{agent.name}</span>
                                <span className="mt-0.5 block truncate text-[10px] text-slate-500">{agent.id}</span>
                              </span>
                              <Badge variant="muted" className="rounded-full px-1.5 py-0 text-[10px]">
                                {agentFiles.length}
                              </Badge>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <SectionHeading label="Agent Files" detail="Identity and policy" />
                  {fileNavigation.agentGroups.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-slate-400">
                      No agent-specific editable files were found.
                    </div>
                  ) : (
                    fileNavigation.agentGroups.map((group) => (
                      <div key={group.agent.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-2">
                        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 px-1">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-200">{group.agent.name}</p>
                            <p className="truncate text-[10px] text-slate-500">{group.agent.id}</p>
                          </div>
                          <Badge variant="muted" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
                            {group.files.length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {group.files.map((file) => (
                            <FileListButton
                              key={file.path}
                              file={file}
                              active={file.path === activeFile?.path}
                              onSelect={selectFile}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate font-display text-base text-white">
                    {activeFile?.path ?? "Select a workspace file"}
                  </p>
                  {activeFile ? (
                    <>
                      <Badge variant="muted" className="rounded-full px-2 py-0.5 text-[10px] uppercase">
                        {activeFile.language}
                      </Badge>
                      {!activeFile.exists && activeFile.createable ? (
                        <Badge variant="muted" className="rounded-full px-2 py-0.5 text-[10px] uppercase">
                          New file
                        </Badge>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {activeFile?.description ??
                    (activeFile?.size ? `${formatFileSize(activeFile.size)}` : "Markdown and JSON only.")}
                </p>
              </div>
              {activeFile?.source ? (
                <Badge variant="muted" className="shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase">
                  {activeFile.source}
                </Badge>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 p-5">
              {error ? (
                <div className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              {!activeFile ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-sm text-slate-400">
                  Select an OpenClaw workspace file.
                </div>
              ) : isLoadingFile ? (
                <div className="flex h-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.02] text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading file
                </div>
              ) : activeFile.editable ? (
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  className="h-full min-h-[360px] resize-none rounded-2xl font-mono text-xs leading-5"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] px-6 text-center text-sm text-slate-400">
                  {activeFile.reason ?? "This file is not editable from AgentOS."}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-white/10 px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={discardChanges}
                disabled={!hasUnsavedChanges || isSaving}
              >
                <Undo2 className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Button
                type="button"
                onClick={() => void saveFile()}
                disabled={!canEditActiveFile || (activeFile?.exists !== false && !hasUnsavedChanges) || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : activeFile?.exists ? (
                  <Save className="mr-2 h-4 w-4" />
                ) : (
                  <PlusCircle className="mr-2 h-4 w-4" />
                )}
                {activeFile?.exists ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">{label}</p>
      {detail ? <p className="shrink-0 text-[10px] text-slate-600">{detail}</p> : null}
    </div>
  );
}

function FileListButton({
  file,
  active,
  onSelect
}: {
  file: WorkspaceManagedFile;
  active: boolean;
  onSelect: (file: WorkspaceManagedFile) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      className={cn(
        "w-full rounded-2xl border px-3 py-2 text-left transition-colors",
        active
          ? "border-cyan-300/40 bg-cyan-300/10 text-white"
          : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.04]"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {file.language === "json" ? (
          <Braces className="h-3.5 w-3.5 shrink-0 text-cyan-200" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{file.label}</span>
        <Badge variant="muted" className="rounded-full px-1.5 py-0 text-[10px]">
          {categoryLabels[file.category]}
        </Badge>
        {!file.exists && file.createable ? (
          <Badge variant="muted" className="rounded-full px-1.5 py-0 text-[10px]">
            Create
          </Badge>
        ) : null}
      </span>
      <span className="mt-1 block truncate text-[10px] text-slate-500">{file.path}</span>
    </button>
  );
}

function buildFileNavigation(files: WorkspaceManagedFile[], agents: WorkspaceDialogAgent[]) {
  const workspaceFiles: WorkspaceManagedFile[] = [];
  const agentFilesByAgentId = new Map<string, WorkspaceManagedFile[]>(
    agents.map((agent) => [agent.id, []])
  );

  for (const file of files) {
    const agentId = getWorkspaceManagedFileAgentId(file, agents);

    if (!agentId) {
      workspaceFiles.push(file);
      continue;
    }

    const agentFiles = agentFilesByAgentId.get(agentId) ?? [];
    agentFiles.push(file);
    agentFilesByAgentId.set(agentId, agentFiles);
  }

  return {
    workspaceFiles,
    agentFilesByAgentId,
    agentGroups: agents
      .map((agent) => ({
        agent,
        files: agentFilesByAgentId.get(agent.id) ?? []
      }))
      .filter((group) => group.files.length > 0)
  };
}

function getWorkspaceManagedFileAgentId(file: WorkspaceManagedFile, agents: WorkspaceDialogAgent[]) {
  const agentDirMatch = /^\.openclaw\/agents\/([^/]+)\/agent\//.exec(file.path);
  if (agentDirMatch?.[1] && agents.some((agent) => agent.id === agentDirMatch[1])) {
    return agentDirMatch[1];
  }

  const policyOwner = agents.find(
    (agent) => file.path === `skills/${buildAgentPolicySkillId(agent.id)}/SKILL.md`
  );

  return policyOwner?.id ?? null;
}

function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function chooseInitialFilePath(files: WorkspaceManagedFile[]) {
  return (
    files.find((file) => file.path === "AGENTS.md")?.path ??
    files.find((file) => file.exists)?.path ??
    files[0]?.path ??
    null
  );
}

function replaceWorkspaceFile(files: WorkspaceManagedFile[], nextFile: WorkspaceManagedFile) {
  if (!files.some((file) => file.path === nextFile.path)) {
    return [...files, nextFile];
  }

  return files.map((file) => (file.path === nextFile.path ? nextFile : file));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}
