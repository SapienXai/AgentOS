"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Check, Database, Eye, FilePlus2, FileText, Filter, Folder, FolderOpen, HardDrive, Import, ListFilter, Plus, SlidersHorizontal, SquareArrowOutUpRight, Upload, type LucideIcon } from "lucide-react";

import { WorkspaceContextFilesDialog } from "@/components/mission-control/workspace-context-files-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkspaceManagedFile, WorkspaceManagedFileListResponse, WorkspaceManagedFileReadResponse } from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";
import { buildFileViews, fileCollectionIcons, formatBytes, type FileView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, MoreButton, OperationsPageLayout, PageHeader, ProgressBar, SearchToolbar, SectionCard, StatCard, StatGrid, ToolbarButton, ViewToggle } from "@/components/operations/operations-ui";
import { formatFileSortLabel, readClientError, sortFileViews } from "@/components/operations/operations-shared";

export function FilesPageContent({
  snapshot,
  activeWorkspaceId,
  surfaceTheme
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
}) {
  const activeWorkspace = activeWorkspaceId
    ? snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null;
  const visibleWorkspaces = useMemo(
    () => (activeWorkspaceId ? (activeWorkspace ? [activeWorkspace] : []) : snapshot.workspaces),
    [activeWorkspace, activeWorkspaceId, snapshot.workspaces]
  );
  const [filesByWorkspace, setFilesByWorkspace] = useState<Record<string, WorkspaceManagedFile[]>>({});
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("All Files");
  const [sort, setSort] = useState<"name" | "path" | "size" | "collection">("path");
  const [view, setView] = useState<"grid" | "list">("list");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [previewFile, setPreviewFile] = useState<FileView | null>(null);
  const [workspaceFilesOpen, setWorkspaceFilesOpen] = useState(false);
  const [fileReloadKey, setFileReloadKey] = useState(0);

  useEffect(() => {
    if (visibleWorkspaces.length === 0) {
      setFilesByWorkspace({});
      setFileError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFiles(true);
    setFileError(null);

    void (async () => {
      const entries = await Promise.all(
        visibleWorkspaces.map(async (workspace) => {
          try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/files`, {
              cache: "no-store"
            });
            const result = (await response.json()) as WorkspaceManagedFileListResponse & { error?: string };
            if (!response.ok || result.error) {
              throw new Error(result.error || "Workspace files could not be loaded.");
            }
            return { workspaceId: workspace.id, files: result.files, error: null as string | null };
          } catch (error) {
            return {
              workspaceId: workspace.id,
              files: [] as WorkspaceManagedFile[],
              error: `${workspace.name}: ${error instanceof Error ? error.message : "Workspace files could not be loaded."}`
            };
          }
        })
      );

      if (!cancelled) {
        setFilesByWorkspace(
          Object.fromEntries(entries.map((entry) => [entry.workspaceId, entry.files]))
        );
        const errors = entries.map((entry) => entry.error).filter((error): error is string => Boolean(error));
        if (errors.length > 0) {
          setFileError(errors.join(" "));
        }
        setIsLoadingFiles(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileReloadKey, visibleWorkspaces]);

  const fileViews = useMemo(
    () =>
      visibleWorkspaces.flatMap((workspace) =>
        buildFileViews(
          filesByWorkspace[workspace.id] ?? [],
          workspace,
          snapshot.agents.filter((agent) => agent.workspaceId === workspace.id)
        )
      ),
    [filesByWorkspace, snapshot.agents, visibleWorkspaces]
  );

  const filteredFiles = fileViews.filter((file) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [file.name, file.path, file.type, file.owner, file.workspaceName, ...file.tags].join(" ").toLowerCase().includes(query);
    const matchesCollection = collection === "All Files" || file.collection === collection;
    return matchesSearch && matchesCollection;
  }).sort((left, right) => sortFileViews(left, right, sort));
  const selectedFile = filteredFiles.find((file) => file.id === selectedFileId) ?? filteredFiles[0] ?? null;
  const totalSize = fileViews.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  const generatedCount = fileViews.filter((file) => file.collection === "Generated Outputs").length;
  const memoryCount = fileViews.filter((file) => file.collection === "Memory").length;
  const coreCount = fileViews.filter((file) => file.collection === "Core Knowledge").length;
  const collectionItems = ["All Files", ...Array.from(new Set(fileViews.map((file) => file.collection))).sort()];
  const sortModes: Array<typeof sort> = ["path", "name", "collection", "size"];

  const revealFile = async (file: FileView) => {
    if (!file.workspacePath) {
      toast.message("This file is not attached to a workspace.");
      return;
    }

    try {
      const response = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.source?.path ?? file.relativePath, basePath: file.workspacePath })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Unable to reveal file.");
      }
      toast.success("File revealed in Finder.");
    } catch (error) {
      toast.error("File open failed.", {
        description: error instanceof Error ? error.message : "Unknown file error."
      });
    }
  };

  return (
    <>
      <OperationsPageLayout
      main={
        <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Files"
            subtitle="Manage workspace documents, knowledge files, memory, and generated outputs."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Runtime artifact import is not exposed by the current workspace file API."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import from Agent
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Uploads are not exposed by the current workspace file API."
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload Files
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled={!activeWorkspaceId}
                  title={activeWorkspaceId ? "Open the existing workspace file reader/editor." : "Select a workspace to open workspace files."}
                  onClick={() => setWorkspaceFilesOpen(true)}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Workspace Files
                </Button>
              </>
            }
          />

          <StatGrid columns={5}>
            <StatCard label="Total Files" value={String(fileViews.length)} detail={isLoadingFiles ? "Loading workspace files" : `${filteredFiles.length} visible`} icon={FileText} tone="info" />
            <StatCard label="Core Files" value={String(coreCount)} detail={`${Math.round((coreCount / Math.max(1, fileViews.length)) * 100)}% of total`} icon={FilePlus2} tone="success" />
            <StatCard label="Generated Outputs" value={String(generatedCount)} detail="Managed workspace files" icon={BrainCircuit} tone="purple" />
            <StatCard label="Memory Docs" value={String(memoryCount)} detail="Durable context" icon={Database} tone="warning" />
            <StatCard label="Storage Used" value={formatBytes(totalSize)} detail={fileViews.some((file) => file.sizeBytes != null) ? "From file metadata" : "No file sizes reported"} icon={HardDrive} tone="info" />
          </StatGrid>

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search files..."
            surfaceTheme={surfaceTheme}
            right={<ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} />}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Filter} label={`Collection: ${collection}`} active={collection !== "All Files"} onClick={() => setCollection("All Files")} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={ListFilter} label="Workspace managed files" disabled title="Only managed workspace files are exposed by the current file API." />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatFileSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          {fileError ? (
            <div className="rounded-[10px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-3 py-2.5 text-xs text-[hsl(var(--status-warning-foreground))]">{fileError}</div>
          ) : null}

          <div className="grid gap-2.5 xl:grid-cols-[180px_minmax(0,1fr)]">
            <SectionCard title="Collections" action={<button className="text-muted-foreground" disabled title="Custom collections are not exposed by the workspace file API."><Plus className="h-3.5 w-3.5" /></button>}>
              <div className="flex flex-col gap-1 p-2.5">
                {collectionItems.map((item) => {
                  const Icon = fileCollectionIcons[item] ?? Folder;
                  const count = item === "All Files" ? fileViews.length : fileViews.filter((file) => file.collection === item).length;
                  return (
                    <button
                      type="button"
                      key={item}
                      onClick={() => setCollection(item)}
                      className={cn("flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-left text-xs transition-colors", collection === item ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item}</span>
                      </span>
                      <span className="text-[0.68rem] text-muted-foreground">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-auto border-t border-border p-3">
                <div className="mb-2 flex items-center justify-between text-[0.68rem] text-muted-foreground">
                  <span>Storage</span>
                  <span>{fileViews.some((file) => file.sizeBytes != null) ? "Reported" : "Unknown"}</span>
                </div>
                <ProgressBar value={fileViews.some((file) => file.sizeBytes != null) ? Math.min(100, (totalSize / 10_000_000_000) * 100) : 0} />
                <Button variant="secondary" size="sm" className="mt-3 h-7 w-full rounded-[8px] px-2 text-[0.7rem]" disabled title="Storage quota management is not exposed by the current workspace file API.">Manage Storage</Button>
              </div>
            </SectionCard>

            <SectionCard title={`Files (${fileViews.length})`}>
              {isLoadingFiles ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Loading workspace files...</div>
              ) : filteredFiles.length === 0 ? (
                <EmptyState title="No files found" description={fileViews.length === 0 ? "No managed workspace files were returned by the current workspace file API." : "Clear search or collection filters to inspect another file set."} />
              ) : view === "list" ? (
                <FilesTable files={filteredFiles} selectedId={selectedFile?.id} onSelect={setSelectedFileId} onPreview={setPreviewFile} onReveal={revealFile} />
              ) : (
                <div className="grid gap-2.5 p-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {filteredFiles.map((file) => (
                    <button key={file.id} type="button" onClick={() => setSelectedFileId(file.id)} className={cn("rounded-[10px] border p-3 text-left hover:bg-muted/60", file.id === selectedFile?.id ? "border-primary/60 bg-primary/10" : "border-border bg-card")}>
                      <div className="flex items-start gap-2.5">
                        <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-foreground">{file.name}</span>
                          <span className="mt-1 block truncate text-[0.68rem] text-muted-foreground">{file.path}</span>
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">{file.tags.map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border px-3 py-2.5 text-[0.68rem] text-muted-foreground">
                <span>Showing {filteredFiles.length} of {fileViews.length} files</span>
                <span>Workspace managed files only</span>
              </div>
            </SectionCard>
          </div>
        </>
      }
      inspector={selectedFile ? <FileInspector file={selectedFile} onReveal={() => revealFile(selectedFile)} onPreview={() => setPreviewFile(selectedFile)} /> : null}
    />
      <WorkspaceContextFilesDialog
        snapshot={snapshot}
        workspaceId={activeWorkspaceId}
        open={workspaceFilesOpen}
        onOpenChange={setWorkspaceFilesOpen}
      />
      <FilePreviewDialog
        file={previewFile}
        open={Boolean(previewFile)}
        onOpenChange={(open) => setPreviewFile(open ? previewFile : null)}
        onSaved={() => {
          setPreviewFile(null);
          setFileReloadKey((current) => current + 1);
        }}
      />
    </>
  );
}

function FilesTable({
  files,
  selectedId,
  onSelect,
  onPreview,
  onReveal
}: {
  files: FileView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPreview: (file: FileView) => void;
  onReveal: (file: FileView) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[660px] text-left text-[0.72rem]">
        <thead className="border-b border-border text-[0.56rem] uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            <th className="w-8 px-3 py-2.5"><span className="block h-3.5 w-3.5 rounded border border-border" /></th>
            <th className="px-2 py-2.5 font-semibold">Name</th>
            <th className="px-2 py-2.5 font-semibold">Last Updated</th>
            <th className="px-2 py-2.5 font-semibold">Owner / Agent</th>
            <th className="px-2 py-2.5 font-semibold">Size</th>
            <th className="px-2 py-2.5 font-semibold">Tags</th>
            <th className="px-3 py-2.5 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-foreground/80">
          {files.map((file) => (
            <tr
              key={file.id}
              onClick={() => onSelect(file.id)}
              className={cn("cursor-pointer hover:bg-muted/50", file.id === selectedId && "bg-primary/10 outline outline-1 outline-primary/45")}
            >
              <td className="px-3 py-2.5"><span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded border", file.id === selectedId ? "border-primary bg-primary text-primary-foreground" : "border-border")}><Check className="h-2.5 w-2.5" /></span></td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2.5">
                  <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-foreground">{file.name}</span>
                    <span className="mt-0.5 block truncate text-[0.66rem] text-muted-foreground">{file.workspaceName} · {file.path}</span>
                  </span>
                </div>
              </td>
              <td className="px-2 py-2.5">{file.updatedLabel}</td>
              <td className="px-2 py-2.5"><span className="line-clamp-2 max-w-24">{file.owner}</span></td>
              <td className="px-2 py-2.5">{file.sizeLabel}</td>
              <td className="px-2 py-2.5"><div className="flex max-w-28 flex-wrap gap-1">{file.tags.slice(0, 2).map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <FileActionButton
                    label="Preview"
                    disabled={!file.source?.exists}
                    disabledLabel="File is not created yet."
                    icon={Eye}
                    onClick={() => onPreview(file)}
                  />
                  <FileActionButton
                    label="Reveal in Finder"
                    disabled={!file.workspacePath}
                    disabledLabel="Reveal requires a workspace path."
                    icon={FolderOpen}
                    onClick={() => onReveal(file)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileActionButton({
  label,
  disabled,
  disabledLabel,
  icon: Icon,
  onClick
}: {
  label: string;
  disabled: boolean;
  disabledLabel: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  const tooltipLabel = disabled ? disabledLabel : label;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7 rounded-[8px]"
              disabled={disabled}
              title={tooltipLabel}
              aria-label={tooltipLabel}
              onClick={(event) => {
                event.stopPropagation();
                onClick();
              }}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="px-2.5 py-1.5 text-[0.68rem]">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function FileInspector({
  file,
  onReveal,
  onPreview
}: {
  file: FileView;
  onReveal: () => void;
  onPreview: () => void;
}) {
  return (
    <InspectorPanelFrame>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{file.name}</h2>
            <div className="mt-1.5 flex gap-1.5"><MiniBadge>{file.type}</MiniBadge><MiniBadge>{file.sizeLabel}</MiniBadge></div>
          </div>
        </div>
        <MoreButton />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" className="h-8 rounded-[9px] bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90" onClick={onReveal}><SquareArrowOutUpRight className="mr-1.5 h-3.5 w-3.5" />Open</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled={!file.source?.exists} title={file.source?.exists ? "Read this managed workspace file." : "File is not created yet."} onClick={onPreview}>Preview</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Additional file actions require backend support.">More</Button>
      </div>
      <div className="mt-3 border-b border-border px-3 py-2.5 text-xs text-primary">Details</div>
      <>
          <div className="mt-3 rounded-[10px] border border-border bg-muted/35 px-3">
            <KeyValue label="File Path" value={file.path} />
            <KeyValue label="Type" value={file.type} />
            <KeyValue label="Size" value={file.sizeLabel} />
            <KeyValue label="Last Updated" value={file.updatedLabel} />
            <KeyValue label="Workspace" value={file.workspaceName} />
            <KeyValue label="Owner / Agent" value={file.owner} />
            <KeyValue label="Workspace API" value={file.source ? "Managed file" : "Not reported"} />
          </div>
          <div className="mt-3">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tags</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{file.tags.map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div>
          </div>
          <div className="mt-3">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Description</p>
            <p className="mt-1.5 text-xs leading-5 text-foreground/80">{file.source?.description ?? "Workspace context file managed by AgentOS and OpenClaw."}</p>
          </div>
        </>
      <SectionCard title="Quick Actions" className="mt-4">
        <div className="grid grid-cols-2 gap-2 p-2.5">
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Share requires backend support.">Share</Button>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Context selection persistence is not exposed by the workspace file API.">Add to Context</Button>
          <Button variant="destructive" size="sm" className="col-span-2 h-8 rounded-[9px] px-2 text-xs" disabled title="Trash/delete is not exposed by the workspace file API.">Move to Trash</Button>
        </div>
      </SectionCard>
    </InspectorPanelFrame>
  );
}

function FilePreviewDialog({
  file,
  open,
  onOpenChange,
  onSaved
}: {
  file: FileView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRead = Boolean(file?.workspaceId && file?.source?.exists);
  const canSave = Boolean(file?.workspaceId && file?.source?.editable && content !== savedContent && !loading && !saving);

  useEffect(() => {
    if (!open || !file) {
      setContent("");
      setSavedContent("");
      setError(null);
      return;
    }

    if (!canRead) {
      setError("This file cannot be read because it is not created yet or is not attached to a workspace.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(file.workspaceId ?? "")}/files?path=${encodeURIComponent(file.relativePath)}`,
          { cache: "no-store" }
        );
        const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };
        if (!response.ok || result.error) {
          throw new Error(result.error || "Workspace file could not be read.");
        }

        if (!cancelled) {
          setContent(result.content);
          setSavedContent(result.content);
        }
      } catch (error) {
        if (!cancelled) {
          setError(readClientError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRead, file, open]);

  const saveFile = async () => {
    if (!file?.workspaceId) {
      setError("This file is not attached to a workspace.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(file.workspaceId)}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.relativePath,
          content
        })
      });
      const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file could not be saved.");
      }
      setSavedContent(result.content);
      setContent(result.content);
      toast.success("Workspace file saved.");
      onSaved();
    } catch (error) {
      setError(readClientError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(82dvh,780px)] max-w-4xl flex-col rounded-[18px] p-4">
        <DialogHeader>
          <DialogTitle>{file?.name ?? "Workspace File"}</DialogTitle>
          <DialogDescription>
            Reads and saves through the existing workspace file API with workspace path safety checks.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-[10px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
        ) : null}
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={loading || saving || !file?.source?.editable}
          placeholder={loading ? "Loading workspace file..." : "File content"}
          className="min-h-0 flex-1 resize-none rounded-[12px] font-mono text-xs leading-5"
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90"
            disabled={!canSave}
            title={file?.source?.editable ? "Save this managed workspace file." : "This managed file is read-only."}
            onClick={() => void saveFile()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
