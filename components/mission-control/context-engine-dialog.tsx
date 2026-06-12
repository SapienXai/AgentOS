"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  Clock3,
  Eye,
  FileText,
  FolderOpen,
  Grid2X2,
  Hexagon,
  History,
  Home,
  Loader2,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  RotateCcw,
  Save,
  Sparkles,
  TerminalSquare,
  Wrench
} from "lucide-react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type {
  ContextEngineBudgetItem,
  ContextEngineFile,
  ContextEngineFileReadResponse,
  ContextEngineFileStatus,
  ContextEngineSaveInput,
  ContextEngineSnapshot,
  ContextEngineTokenSource
} from "@/lib/openclaw/context-engine-types";
import {
  compactPath,
  formatAgentDisplayName,
  formatContextWindow,
  formatTokens
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type ContextEngineTab = "overview" | "project" | "skills" | "memory" | "attachments" | "preview";
type InspectorMode = "preview" | "edit";

const tabItems: Array<{
  id: ContextEngineTab;
  label: string;
  icon: typeof Home;
}> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "project", label: "Project Context", icon: FileText },
  { id: "skills", label: "Skills & Tools", icon: Wrench },
  { id: "memory", label: "Memory & History", icon: History },
  { id: "attachments", label: "Attachments", icon: Paperclip },
  { id: "preview", label: "Preview", icon: Eye }
];

const statusTone: Record<ContextEngineFileStatus, string> = {
  enabled: "border-emerald-300/25 bg-emerald-400/10 text-emerald-200",
  disabled: "border-slate-500/25 bg-slate-700/40 text-slate-300",
  missing: "border-rose-300/30 bg-rose-400/10 text-rose-200",
  truncated: "border-amber-300/30 bg-amber-400/10 text-amber-200",
  error: "border-rose-300/30 bg-rose-400/10 text-rose-200"
};

const budgetIcons: Record<ContextEngineBudgetItem["id"], typeof TerminalSquare> = {
  system: TerminalSquare,
  project: FolderOpen,
  skills: Puzzle,
  tools: Wrench,
  history: Clock3,
  attachments: Paperclip
};

export function ContextEngineDialog({
  agentId,
  open,
  onOpenChange
}: {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [engineSnapshot, setEngineSnapshot] = useState<ContextEngineSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ContextEngineTab>("project");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ContextEngineFile | null>(null);
  const [draftEnabledByPath, setDraftEnabledByPath] = useState<Record<string, boolean>>({});
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("preview");
  const [actionMenuPath, setActionMenuPath] = useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayFiles = useMemo(
    () => (engineSnapshot ? applyDraftFileState(engineSnapshot.files, draftEnabledByPath) : []),
    [draftEnabledByPath, engineSnapshot]
  );
  const projectFiles = useMemo(
    () => displayFiles.filter((file) => isProjectContextFile(file)),
    [displayFiles]
  );
  const activeFile = selectedFile
    ? applyDraftFileState([selectedFile], draftEnabledByPath)[0]
    : displayFiles.find((file) => file.path === selectedPath) ?? null;
  const hasContextChanges = useMemo(
    () => displayFiles.some((file) => file.enabled !== file.savedEnabled),
    [displayFiles]
  );
  const hasUnsavedFileChanges = content !== savedContent;
  const canEditActiveFile = Boolean(activeFile?.editable && !isLoadingFile);
  const createableMissingFile = projectFiles.find((file) => !file.exists && file.createable) ?? null;
  const enabledProjectTokenTotal = sumKnownTokens(
    projectFiles.filter((file) => file.enabled).map((file) => file.injectedTokens)
  );

  const refreshSnapshot = useCallback(async () => {
    if (!agentId) {
      return;
    }

    setIsLoadingSnapshot(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context`, {
        cache: "no-store"
      });
      const result = (await response.json()) as ContextEngineSnapshot & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Context Engine snapshot could not be loaded.");
      }

      setEngineSnapshot(result);
      setDraftEnabledByPath(Object.fromEntries(result.files.map((file) => [file.path, file.enabled])));
      setSelectedPath((current) => {
        if (current && result.files.some((file) => file.path === current)) {
          return current;
        }

        return chooseInitialFilePath(result.files);
      });
    } catch (loadError) {
      setEngineSnapshot(null);
      setSelectedPath(null);
      setSelectedFile(null);
      setContent("");
      setSavedContent("");
      setError(loadError instanceof Error ? loadError.message : "Context Engine snapshot could not be loaded.");
    } finally {
      setIsLoadingSnapshot(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!open || !agentId) {
      setEngineSnapshot(null);
      setSelectedPath(null);
      setSelectedFile(null);
      setDraftEnabledByPath({});
      setContent("");
      setSavedContent("");
      setError(null);
      setActiveTab("project");
      setInspectorMode("preview");
      setActionMenuPath(null);
      return;
    }

    void refreshSnapshot();
  }, [agentId, open, refreshSnapshot]);

  useEffect(() => {
    if (!open || !agentId || !selectedPath) {
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/context/file?path=${encodeURIComponent(selectedPath)}`,
          { cache: "no-store" }
        );
        const result = (await response.json()) as ContextEngineFileReadResponse & { error?: string };

        if (!response.ok || result.error) {
          throw new Error(result.error || "Context file could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        setSelectedFile(result.file);
        setEngineSnapshot((current) =>
          current
            ? {
                ...current,
                files: replaceContextFile(current.files, result.file),
                maxFileBytes: result.maxFileBytes
              }
            : current
        );
        setContent(result.content);
        setSavedContent(result.content);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setSelectedFile(null);
        setContent("");
        setSavedContent("");
        setError(loadError instanceof Error ? loadError.message : "Context file could not be loaded.");
      } finally {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agentId, open, selectedPath]);

  const saveContext = useCallback(
    async (nextDraft?: Record<string, boolean>) => {
      if (!agentId || !engineSnapshot) {
        return;
      }

      const draft = nextDraft ?? draftEnabledByPath;
      const payload: ContextEngineSaveInput = {
        files: engineSnapshot.files.map((file) => ({
          path: file.path,
          enabled: Boolean(draft[file.path] ?? file.enabled)
        }))
      };

      setIsSavingContext(true);
      setError(null);

      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const result = (await response.json()) as ContextEngineSnapshot & { error?: string };

        if (!response.ok || result.error) {
          throw new Error(result.error || "Context configuration could not be saved.");
        }

        setEngineSnapshot(result);
        setDraftEnabledByPath(Object.fromEntries(result.files.map((file) => [file.path, file.enabled])));
        setSelectedFile((current) => {
          if (!current) {
            return current;
          }

          return result.files.find((file) => file.path === current.path) ?? current;
        });
        toast.success("Context configuration saved.", {
          description: result.capabilities.nativeFileToggles.supported
            ? "OpenClaw native context configuration was updated."
            : "AgentOS saved the context configuration for this agent."
        });
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : "Context configuration could not be saved.";
        setError(message);
        toast.error("Context configuration was not saved.", {
          description: message
        });
      } finally {
        setIsSavingContext(false);
      }
    },
    [agentId, draftEnabledByPath, engineSnapshot]
  );

  const saveFile = useCallback(async () => {
    if (!agentId || !activeFile || !canEditActiveFile) {
      return;
    }

    setIsSavingFile(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/context/file`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: activeFile.path,
          content
        })
      });
      const result = (await response.json()) as ContextEngineFileReadResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Context file could not be saved.");
      }

      setSelectedFile(result.file);
      setEngineSnapshot((current) =>
        current
          ? {
              ...current,
              files: replaceContextFile(current.files, result.file),
              maxFileBytes: result.maxFileBytes
            }
          : current
      );
      setDraftEnabledByPath((current) => ({
        ...current,
        [result.file.path]: result.file.enabled
      }));
      setContent(result.content);
      setSavedContent(result.content);
      setInspectorMode("preview");
      toast.success("Context file saved.", {
        description: result.file.path
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Context file could not be saved.";
      setError(message);
      toast.error("Context file was not saved.", {
        description: message
      });
    } finally {
      setIsSavingFile(false);
    }
  }, [activeFile, agentId, canEditActiveFile, content]);

  const resetDraft = useCallback(() => {
    if (!engineSnapshot) {
      return;
    }

    setDraftEnabledByPath(Object.fromEntries(engineSnapshot.files.map((file) => [file.path, file.savedEnabled])));
    toast.message("Context reset.", {
      description: "Restored the last saved Context Engine configuration."
    });
  }, [engineSnapshot]);

  const toggleFile = useCallback((file: ContextEngineFile) => {
    if (!file.canToggle) {
      return;
    }

    setDraftEnabledByPath((current) => ({
      ...current,
      [file.path]: !Boolean(current[file.path] ?? file.enabled)
    }));
  }, []);

  const excludeActiveFile = useCallback(() => {
    if (!activeFile?.canToggle) {
      return;
    }

    const nextDraft = {
      ...draftEnabledByPath,
      [activeFile.path]: false
    };
    setDraftEnabledByPath(nextDraft);
    void saveContext(nextDraft);
  }, [activeFile, draftEnabledByPath, saveContext]);

  const openCreateFlow = useCallback(() => {
    if (!createableMissingFile) {
      toast.message("No createable context files are missing.", {
        description: "All allowlisted project context files already exist or are read-only."
      });
      return;
    }

    setActiveTab("project");
    setSelectedPath(createableMissingFile.path);
    setInspectorMode("edit");
  }, [createableMissingFile]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-black/78 backdrop-blur-lg"
        closeClassName="right-3 top-3 h-7 w-7 text-slate-300 hover:bg-white/[0.06] hover:text-white"
        className="grid h-[min(calc(100vh-72px),760px)] max-h-[calc(100vh-72px)] w-[min(90vw,1060px)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl border border-violet-300/28 bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.16),transparent_28%),linear-gradient(135deg,rgba(16,20,31,0.98),rgba(8,11,19,0.98)_62%,rgba(13,15,25,0.98))] p-0 text-slate-100 shadow-[0_0_0_1px_rgba(167,139,250,0.14),0_24px_80px_rgba(0,0,0,0.68)]"
      >
        <DialogHeader className="relative space-y-0 border-b border-white/[0.06] px-6 pb-2 pt-3">
          <div className="flex items-start justify-between gap-5 pr-9">
            <div className="flex min-w-0 items-start gap-3">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-violet-500/15 text-violet-200 shadow-[0_0_20px_rgba(124,58,237,0.3)]">
                <Hexagon className="h-6 w-6 fill-violet-500/55 stroke-violet-300" />
                <span className="absolute h-1.5 w-1.5 rounded-full bg-violet-200 shadow-[0_0_12px_rgba(196,181,253,0.8)]" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-display text-[17px] font-semibold leading-5 text-white">
                  Context Engine
                </DialogTitle>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <DialogDescription className="text-xs text-slate-300/78">
                    Control what this agent sees
                  </DialogDescription>
                  <HeaderChip icon={<Sparkles className="h-3 w-3" />} value={engineSnapshot?.model.label ?? "Unknown model"} tone="violet" />
                  <HeaderChip icon={<Grid2X2 className="h-3 w-3" />} value={engineSnapshot?.model.contextWindow ? `${formatContextWindow(engineSnapshot.model.contextWindow)} window` : "Unknown window"} tone="blue" />
                  <HeaderChip icon={<Clock3 className="h-3 w-3" />} value={formatContextUsage(engineSnapshot)} tone={engineSnapshot?.budget.usedPercent == null ? "muted" : "amber"} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TopActionButton
                icon={<Eye className="h-3.5 w-3.5" />}
                label="Preview"
                onClick={() => setActiveTab("preview")}
              />
              <TopActionButton
                icon={<Grid2X2 className="h-3.5 w-3.5" />}
                label="Compact"
                disabled
                title={engineSnapshot?.capabilities.compaction.reason ?? "OpenClaw compaction is not available."}
              />
              <Button
                type="button"
                className="h-8 rounded-[8px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-3 text-xs text-white shadow-[0_8px_20px_rgba(124,58,237,0.32)] hover:bg-violet-500"
                disabled={!engineSnapshot || isSavingContext || !hasContextChanges}
                onClick={() => void saveContext()}
              >
                {isSavingContext ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[180px_minmax(0,1fr)] gap-4 overflow-y-auto px-4 py-3">
          <aside className="min-h-[465px] rounded-[10px] border border-white/[0.09] bg-black/18 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <nav className="space-y-1">
              {tabItems.map((item) => {
                const Icon = item.icon;
                const selected = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "group relative flex h-12 w-full items-center gap-2.5 px-4 text-left text-sm transition-colors",
                      selected
                        ? "bg-violet-500/18 text-violet-100"
                        : "text-slate-300 hover:bg-white/[0.045] hover:text-white"
                    )}
                    onClick={() => setActiveTab(item.id)}
                  >
                    {selected ? <span className="absolute left-0 top-1.5 h-9 w-1 rounded-r-full bg-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.65)]" /> : null}
                    <Icon className={cn("h-[18px] w-[18px]", selected ? "text-violet-200" : "text-slate-400 group-hover:text-slate-200")} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="h-full min-h-[465px]">
            {activeTab === "project" ? (
              <ProjectContextTab
                snapshot={engineSnapshot}
                files={projectFiles}
                selectedPath={selectedPath}
                activeFile={activeFile}
                content={content}
                savedContent={savedContent}
                inspectorMode={inspectorMode}
                error={error}
                isLoadingSnapshot={isLoadingSnapshot}
                isLoadingFile={isLoadingFile}
                isSavingFile={isSavingFile}
                actionMenuPath={actionMenuPath}
                enabledProjectTokenTotal={enabledProjectTokenTotal}
                createableMissingFile={createableMissingFile}
                hasUnsavedFileChanges={hasUnsavedFileChanges}
                canEditActiveFile={canEditActiveFile}
                onSelectFile={(file) => {
                  setSelectedPath(file.path);
                  setInspectorMode("preview");
                  setActionMenuPath(null);
                }}
                onToggleFile={toggleFile}
                onActionMenuChange={setActionMenuPath}
                onAddFile={openCreateFlow}
                onEdit={() => setInspectorMode("edit")}
                onPreview={() => setInspectorMode("preview")}
                onExclude={excludeActiveFile}
                onContentChange={setContent}
                onRevertFile={() => setContent(savedContent)}
                onSaveFile={() => void saveFile()}
              />
            ) : (
              <SecondaryTabPanel
                tab={activeTab}
                snapshot={engineSnapshot}
                files={projectFiles}
                isLoading={isLoadingSnapshot}
              />
            )}
          </main>
        </div>

        <DialogFooter className="gap-0 border-t border-white/[0.07] px-4 py-1.5">
          <div className="flex w-full items-center justify-between rounded-[8px] bg-white/[0.018] px-1.5 py-1">
            <Button
              type="button"
              variant="secondary"
              className="h-7 rounded-[7px] border-white/10 bg-white/[0.05] px-2.5 text-[11px] text-slate-300 hover:bg-white/[0.09] hover:text-white"
              disabled={!engineSnapshot || !hasContextChanges || isSavingContext}
              onClick={resetDraft}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              type="button"
              className="h-7 rounded-[7px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-3 text-[11px] text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] hover:bg-violet-500"
              disabled={!engineSnapshot || isSavingContext || !hasContextChanges}
              onClick={() => void saveContext()}
            >
              {isSavingContext ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save Context
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectContextTab({
  snapshot,
  files,
  selectedPath,
  activeFile,
  content,
  savedContent,
  inspectorMode,
  error,
  isLoadingSnapshot,
  isLoadingFile,
  isSavingFile,
  actionMenuPath,
  enabledProjectTokenTotal,
  createableMissingFile,
  hasUnsavedFileChanges,
  canEditActiveFile,
  onSelectFile,
  onToggleFile,
  onActionMenuChange,
  onAddFile,
  onEdit,
  onPreview,
  onExclude,
  onContentChange,
  onRevertFile,
  onSaveFile
}: {
  snapshot: ContextEngineSnapshot | null;
  files: ContextEngineFile[];
  selectedPath: string | null;
  activeFile: ContextEngineFile | null;
  content: string;
  savedContent: string;
  inspectorMode: InspectorMode;
  error: string | null;
  isLoadingSnapshot: boolean;
  isLoadingFile: boolean;
  isSavingFile: boolean;
  actionMenuPath: string | null;
  enabledProjectTokenTotal: number | null;
  createableMissingFile: ContextEngineFile | null;
  hasUnsavedFileChanges: boolean;
  canEditActiveFile: boolean;
  onSelectFile: (file: ContextEngineFile) => void;
  onToggleFile: (file: ContextEngineFile) => void;
  onActionMenuChange: (path: string | null) => void;
  onAddFile: () => void;
  onEdit: () => void;
  onPreview: () => void;
  onExclude: () => void;
  onContentChange: (content: string) => void;
  onRevertFile: () => void;
  onSaveFile: () => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[96px_minmax(0,1fr)] gap-3">
      <ContextBudgetCard snapshot={snapshot} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1.22fr)_minmax(285px,0.95fr)] gap-3">
        <section className="min-h-0 rounded-[10px] border border-white/[0.1] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
            <div>
              <h3 className="text-[15px] font-semibold text-white">B. Project Context Files</h3>
              <p className="mt-0.5 text-xs text-slate-400">Files injected into the agent context</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded-[8px] border-white/10 bg-white/[0.055] px-3 text-xs text-slate-100 hover:bg-white/[0.09]"
              disabled={!createableMissingFile}
              title={createableMissingFile ? `Create ${createableMissingFile.path}` : "No createable missing context files."}
              onClick={onAddFile}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add File
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(150px,1fr)_105px_132px_32px] border-b border-white/[0.07] px-3 py-2 text-[11px] text-slate-400">
            <span>File</span>
            <span>Tokens</span>
            <span>State</span>
            <span />
          </div>
          <ScrollArea className="h-[calc(100%-112px)]">
            {isLoadingSnapshot && files.length === 0 ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading context files
              </div>
            ) : files.length === 0 ? (
              <EmptyState title="No context files" detail="No allowlisted project context files were found for this workspace." />
            ) : (
              <div className="divide-y divide-white/[0.055]">
                {files.map((file) => (
                  <ContextFileRow
                    key={file.path}
                    file={file}
                    selected={selectedPath === file.path}
                    actionMenuOpen={actionMenuPath === file.path}
                    onSelect={() => onSelectFile(file)}
                    onToggle={() => onToggleFile(file)}
                    onActionMenu={() => onActionMenuChange(actionMenuPath === file.path ? null : file.path)}
                    onPreview={() => {
                      onSelectFile(file);
                      onActionMenuChange(null);
                    }}
                    onEdit={() => {
                      onSelectFile(file);
                      onActionMenuChange(null);
                      onEdit();
                    }}
                    onExclude={() => {
                      onSelectFile(file);
                      onActionMenuChange(null);
                      if (file.canToggle) {
                        onToggleFile(file);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="flex items-center justify-end gap-3 border-t border-white/[0.07] px-4 py-3 text-xs text-slate-400">
            <span>Total</span>
            <span className="text-sm font-semibold text-white">{formatTokenValue(enabledProjectTokenTotal)} tokens</span>
          </div>
        </section>

        <SelectedFileInspector
          file={activeFile}
          content={content}
          savedContent={savedContent}
          inspectorMode={inspectorMode}
          error={error}
          isLoadingFile={isLoadingFile}
          isSavingFile={isSavingFile}
          hasUnsavedFileChanges={hasUnsavedFileChanges}
          canEditActiveFile={canEditActiveFile}
          onEdit={onEdit}
          onPreview={onPreview}
          onExclude={onExclude}
          onContentChange={onContentChange}
          onRevertFile={onRevertFile}
          onSaveFile={onSaveFile}
        />
      </div>
    </div>
  );
}

function ContextBudgetCard({ snapshot }: { snapshot: ContextEngineSnapshot | null }) {
  const budget = snapshot?.budget;
  const usedLabel = budget?.usedTokens == null ? "Unknown" : Intl.NumberFormat().format(budget.usedTokens);
  const limitLabel = budget?.limit == null ? "unknown" : Intl.NumberFormat().format(budget.limit);
  const percent = budget?.usedPercent ?? 0;

  return (
    <section className="rounded-[9px] border border-white/[0.1] bg-white/[0.035] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="grid grid-cols-[max-content_minmax(220px,1fr)] items-center gap-4">
        <h3 className="whitespace-nowrap text-[13px] font-semibold text-white">A. Context Budget</h3>
        <div className="relative h-5 overflow-hidden rounded-full border border-white/[0.07] bg-slate-800/80">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cf6,#c084fc,#fb7185,#fb923c)] transition-[width]"
            style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center px-3 text-[11px] font-semibold leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
            {usedLabel} / {limitLabel} tokens
          </span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-6 gap-2">
        {(budget?.items ?? defaultBudgetItems()).map((item) => (
          <BudgetPill key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function BudgetPill({ item }: { item: ContextEngineBudgetItem }) {
  const Icon = budgetIcons[item.id];
  const tone = resolveBudgetTone(item.id);
  const valueLabel = formatBudgetItemValue(item);
  const sourceLabel = formatBudgetItemSource(item);
  const hasTokenValue = typeof item.tokens === "number";

  return (
    <div className="rounded-[7px] border border-white/[0.1] bg-slate-950/36 px-2 py-1">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0", tone)} />
        <p className="truncate text-[10px] leading-3 text-slate-300">{item.label}</p>
      </div>
      <p
        className={cn(
          "mt-0.5 truncate text-center font-semibold leading-4",
          hasTokenValue ? "text-[11px] text-white" : "text-[10px] text-slate-300"
        )}
        title={valueLabel}
      >
        {valueLabel}
      </p>
      {sourceLabel ? (
        <p className="truncate text-center text-[7px] uppercase tracking-[0.1em] text-slate-500">{sourceLabel}</p>
      ) : null}
    </div>
  );
}

function ContextFileRow({
  file,
  selected,
  actionMenuOpen,
  onSelect,
  onToggle,
  onActionMenu,
  onPreview,
  onEdit,
  onExclude
}: {
  file: ContextEngineFile;
  selected: boolean;
  actionMenuOpen: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onActionMenu: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onExclude: () => void;
}) {
  return (
    <div
      className={cn(
        "relative grid min-h-11 grid-cols-[minmax(150px,1fr)_105px_132px_32px] items-center px-3 text-xs transition-colors",
        selected ? "bg-violet-500/16 shadow-[inset_3px_0_0_rgba(139,92,246,0.95)]" : "hover:bg-white/[0.035]"
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-slate-300" />
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{file.label}</p>
          <p className="truncate font-mono text-[10px] text-slate-500">{file.path}</p>
        </div>
      </div>
      <span className="text-slate-300">{file.rawTokens == null ? "-" : `${formatTokenValue(file.rawTokens)} tokens`}</span>
      <ContextFileStateControl file={file} onToggle={onToggle} />
      <button
        type="button"
        className="relative flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
        onClick={(event) => {
          event.stopPropagation();
          onActionMenu();
        }}
        aria-label={`Actions for ${file.label}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {actionMenuOpen ? (
        <div
          className="absolute right-2 top-9 z-20 w-40 rounded-[10px] border border-white/[0.1] bg-slate-950 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.45)]"
          onClick={(event) => event.stopPropagation()}
        >
          <ActionMenuButton label="Preview" icon={<Eye className="h-4 w-4" />} onClick={onPreview} />
          <ActionMenuButton label={file.exists ? "Edit" : "Create missing file"} icon={<Pencil className="h-4 w-4" />} disabled={!file.editable} onClick={onEdit} />
          <ActionMenuButton label={file.enabled ? "Exclude" : "Include"} icon={<Ban className="h-4 w-4" />} disabled={!file.canToggle} danger={file.enabled} onClick={onExclude} />
        </div>
      ) : null}
    </div>
  );
}

function ContextFileStateControl({ file, onToggle }: { file: ContextEngineFile; onToggle: () => void }) {
  if (file.status === "missing") {
    return (
      <span
        className="inline-flex h-7 w-fit items-center rounded-full border border-rose-300/24 bg-rose-500/12 px-2.5 text-[11px] font-medium text-rose-200"
        title={file.statusReason ?? "This context file is missing."}
      >
        Missing
      </span>
    );
  }

  const enabled = file.enabled;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={!file.canToggle}
      title={file.canToggle ? "Toggle context inclusion" : file.statusReason ?? "This file cannot be toggled."}
      aria-label={`Context file state: ${enabled ? "Enabled" : "Disabled"}`}
      className={cn(
        "inline-flex w-[64px] flex-col items-start justify-center gap-0.5 rounded-[7px] px-1 py-0.5 text-[10px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        enabled
          ? "text-emerald-200 hover:bg-emerald-500/8"
          : "text-slate-300 hover:bg-slate-500/8"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        className={cn(
          "relative h-4 w-8 rounded-full border transition-colors",
          enabled ? "border-emerald-300/35 bg-emerald-500" : "border-slate-500/45 bg-slate-700"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-0" : "translate-x-4"
          )}
        />
      </span>
      <span>{enabled ? "Enabled" : "Disabled"}</span>
    </button>
  );
}

function SelectedFileInspector({
  file,
  content,
  savedContent,
  inspectorMode,
  error,
  isLoadingFile,
  isSavingFile,
  hasUnsavedFileChanges,
  canEditActiveFile,
  onEdit,
  onPreview,
  onExclude,
  onContentChange,
  onRevertFile,
  onSaveFile
}: {
  file: ContextEngineFile | null;
  content: string;
  savedContent: string;
  inspectorMode: InspectorMode;
  error: string | null;
  isLoadingFile: boolean;
  isSavingFile: boolean;
  hasUnsavedFileChanges: boolean;
  canEditActiveFile: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onExclude: () => void;
  onContentChange: (content: string) => void;
  onRevertFile: () => void;
  onSaveFile: () => void;
}) {
  return (
    <section className="min-h-0 rounded-[10px] border border-white/[0.1] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="border-b border-white/[0.07] px-3 py-2">
        <h3 className="text-[13px] font-semibold text-white">C. Selected File</h3>
      </div>
      {!file ? (
        <EmptyState title="No file selected" detail="Select a context file to inspect the exact source and preview." />
      ) : (
        <div className="flex h-[calc(100%-37px)] min-h-0 flex-col">
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-200" />
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold leading-4 text-white">{file.label}</h4>
                <p className="truncate font-mono text-[9px] leading-3 text-slate-500">{file.path}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4">
              <CompactInspectorItem label="Status">
                <StatusBadge status={file.status} compact />
              </CompactInspectorItem>
              <CompactInspectorItem label="Scope">
                <span className="capitalize text-white">{file.scope}</span>
              </CompactInspectorItem>
              <CompactInspectorItem label="Raw">
                <InspectorValue value={file.rawTokens == null ? "Unknown" : formatTokenValue(file.rawTokens)} source={file.tokenSource} compact />
              </CompactInspectorItem>
              <CompactInspectorItem label="Injected">
                <InspectorValue value={file.injectedTokens == null ? "Unknown" : formatTokenValue(file.injectedTokens)} source={file.tokenSource} compact />
              </CompactInspectorItem>
            </div>
            {file.statusReason ? (
              <p className="mt-1.5 rounded-[8px] border border-amber-300/16 bg-amber-400/[0.07] px-2 py-1 text-[10px] leading-[14px] text-amber-100/85">
                {file.statusReason}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-white/[0.07] px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">{inspectorMode === "edit" ? "Edit" : "Preview"}</p>
              {isLoadingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : null}
            </div>
            {error ? (
              <p className="mb-1.5 rounded-[8px] border border-rose-300/18 bg-rose-400/[0.08] px-2 py-1 text-[10px] text-rose-100">
                {error}
              </p>
            ) : null}
            {inspectorMode === "edit" ? (
              <Textarea
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                disabled={!canEditActiveFile}
                spellCheck={false}
                className="min-h-[104px] flex-1 resize-none rounded-[8px] border-white/[0.1] bg-slate-950/62 font-mono text-[11px] leading-4 text-slate-100 focus-visible:ring-violet-300/35"
                placeholder={isLoadingFile ? "Loading context file..." : "Write context file content"}
              />
            ) : (
              <CodePreview content={buildInjectedPreviewContent(file, content || savedContent)} />
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5 border-t border-white/[0.07] px-3 py-2">
            {inspectorMode === "edit" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 min-w-0 rounded-[7px] border-white/10 bg-white/[0.055] px-2 text-[11px] text-slate-200 hover:bg-white/[0.09]"
                  disabled={!hasUnsavedFileChanges || isSavingFile}
                  onClick={onRevertFile}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 min-w-0 rounded-[7px] border-white/10 bg-white/[0.055] px-2 text-[11px] text-slate-200 hover:bg-white/[0.09]"
                  onClick={onPreview}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Preview
                </Button>
                <Button
                  type="button"
                  className="h-7 min-w-0 rounded-[7px] bg-violet-500 px-2 text-[11px] text-white hover:bg-violet-400"
                  disabled={!hasUnsavedFileChanges || !canEditActiveFile || isSavingFile}
                  onClick={onSaveFile}
                >
                  {isSavingFile ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                  Save File
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 min-w-0 rounded-[7px] border-white/10 bg-white/[0.055] px-2 text-[11px] text-slate-200 hover:bg-white/[0.09]"
                  disabled={!file.editable}
                  onClick={onEdit}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-7 min-w-0 rounded-[7px] border-white/10 bg-white/[0.055] px-2 text-[11px] text-slate-200 hover:bg-white/[0.09]"
                  onClick={onPreview}
                >
                  <Eye className="mr-1 h-3 w-3" />
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-7 min-w-0 rounded-[7px] border border-rose-300/25 bg-rose-500/15 px-2 text-[11px] text-rose-200 hover:bg-rose-500/22"
                  disabled={!file.canToggle || !file.enabled}
                  onClick={onExclude}
                >
                  <Ban className="mr-1 h-3 w-3" />
                  Exclude
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SecondaryTabPanel({
  tab,
  snapshot,
  files,
  isLoading
}: {
  tab: ContextEngineTab;
  snapshot: ContextEngineSnapshot | null;
  files: ContextEngineFile[];
  isLoading: boolean;
}) {
  if (isLoading && !snapshot) {
    return (
      <div className="flex h-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.035] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading context data
      </div>
    );
  }

  if (tab === "overview") {
    return (
      <InfoPanel title="Overview" subtitle="Current agent, workspace, model, and runtime report state.">
        <div className="grid grid-cols-4 gap-4">
          <OverviewMetric label="Agent" value={snapshot ? formatAgentDisplayName(snapshot.agent) : "Unknown"} />
          <OverviewMetric label="Workspace" value={snapshot?.workspace.name ?? "Unknown"} detail={snapshot?.workspace.path ? compactPath(snapshot.workspace.path) : undefined} />
          <OverviewMetric label="Model" value={snapshot?.model.label ?? "Unknown"} detail={snapshot?.model.provider ?? undefined} />
          <OverviewMetric label="Runtime report" value={snapshot?.runtimeReport.status === "exact" ? "Exact" : "Degraded"} detail={snapshot?.runtimeReport.source.replace(/-/g, " ")} />
        </div>
        <DiagnosticsList diagnostics={snapshot?.diagnostics ?? []} />
      </InfoPanel>
    );
  }

  if (tab === "skills") {
    return (
      <InfoPanel title="Skills & Tools" subtitle="Declared and effective capabilities visible in AgentOS.">
        <TwoColumnList leftTitle="Skills" leftValues={snapshot?.policy.effectiveSkills ?? []} rightTitle="Tools" rightValues={snapshot?.policy.effectiveTools ?? []} />
        <DiagnosticsList diagnostics={snapshot?.capabilities.nativeFileToggles.reason ? [snapshot.capabilities.nativeFileToggles.reason] : []} />
      </InfoPanel>
    );
  }

  if (tab === "memory") {
    const memoryFiles = files.filter((file) => file.owner === "memory");
    return (
      <InfoPanel title="Memory & History" subtitle="Durable memory files and latest session context state.">
        <FileSummaryList files={memoryFiles} empty="No memory files are available for this workspace." />
        <DiagnosticsList diagnostics={[snapshot?.preview.historySummary ?? "Session history is unavailable until an OpenClaw context report exists."]} />
      </InfoPanel>
    );
  }

  if (tab === "attachments") {
    return (
      <InfoPanel title="Attachments" subtitle="Attachment context sources for the selected agent.">
        <UnavailableState
          title="Attachment context is not exposed yet"
          detail={snapshot?.preview.attachmentsSummary ?? "The current OpenClaw gateway methods do not expose attachment context to AgentOS."}
        />
      </InfoPanel>
    );
  }

  return (
    <InfoPanel title="Preview" subtitle="What AgentOS can verify about the next model context.">
      <div className="grid grid-cols-[1.1fr_0.9fr] gap-3">
        <div className="rounded-[9px] border border-white/[0.08] bg-slate-950/42 p-3">
          <p className="text-xs font-medium text-white">System prompt</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{snapshot?.preview.systemPromptSummary ?? "No preview is available."}</p>
          <div className="mt-4">
            <p className="text-xs font-medium text-white">Active project context files</p>
            <FileSummaryList files={files.filter((file) => file.enabled)} empty="No files are enabled in the saved context plan." />
          </div>
        </div>
        <div className="rounded-[9px] border border-white/[0.08] bg-slate-950/42 p-3">
          <p className="text-xs font-medium text-white">Token estimate</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatTokenValue(snapshot?.preview.totalTokens ?? null)}</p>
          <p className="mt-1.5 text-xs text-slate-400">{snapshot?.preview.status === "exact" ? "From OpenClaw context report" : "Estimated by AgentOS from available metadata"}</p>
          <DiagnosticsList diagnostics={snapshot?.preview.diagnostics ?? []} />
        </div>
      </div>
    </InfoPanel>
  );
}

function HeaderChip({
  icon,
  value,
  tone
}: {
  icon: React.ReactNode;
  value: string;
  tone: "violet" | "blue" | "amber" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[6px] border bg-white/[0.035] px-2 text-[10px] font-medium",
        tone === "violet" && "border-violet-300/18 text-violet-200",
        tone === "blue" && "border-blue-300/18 text-blue-200",
        tone === "amber" && "border-amber-300/18 text-amber-200",
        tone === "muted" && "border-slate-500/18 text-slate-400"
      )}
    >
      {icon}
      {value}
    </span>
  );
}

function TopActionButton({
  icon,
  label,
  disabled,
  title,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="h-8 rounded-[8px] border-white/10 bg-white/[0.045] px-3 text-xs text-slate-100 hover:bg-white/[0.08]"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="mr-1.5">{icon}</span>
      {label}
    </Button>
  );
}

function StatusBadge({ status, compact = false }: { status: ContextEngineFileStatus; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-[6px] border font-medium capitalize",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
        statusTone[status]
      )}
    >
      <span className={cn("rounded-full bg-current", compact ? "h-1 w-1" : "h-1.5 w-1.5")} />
      {status}
    </span>
  );
}

function ActionMenuButton({
  icon,
  label,
  disabled,
  danger,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        danger ? "text-rose-200 hover:bg-rose-400/10" : "text-slate-200 hover:bg-white/[0.07]"
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function CodePreview({ content }: { content: string }) {
  const lines = (content || "No preview content is available.").split("\n").slice(0, 12);

  return (
    <div className="min-h-[104px] flex-1 overflow-hidden rounded-[8px] border border-white/[0.1] bg-slate-950/62 p-2.5 font-mono text-[11px] leading-4 text-slate-300">
      {lines.map((line, index) => (
        <div key={`${index}:${line}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
          <span className="select-none text-right text-slate-600">{index + 1}</span>
          <span className={cn("truncate", index === 0 && "text-violet-200")}>{line || " "}</span>
        </div>
      ))}
    </div>
  );
}

function InfoPanel({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="h-full rounded-[10px] border border-white/[0.1] bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function OverviewMetric({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-[9px] border border-white/[0.08] bg-slate-950/42 p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1.5 truncate text-base font-semibold text-white">{value}</p>
      {detail ? <p className="mt-1 truncate text-xs text-slate-500">{detail}</p> : null}
    </div>
  );
}

function TwoColumnList({
  leftTitle,
  leftValues,
  rightTitle,
  rightValues
}: {
  leftTitle: string;
  leftValues: string[];
  rightTitle: string;
  rightValues: string[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <CapabilityList title={leftTitle} values={leftValues} />
      <CapabilityList title={rightTitle} values={rightValues} />
    </div>
  );
}

function CapabilityList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-[9px] border border-white/[0.08] bg-slate-950/42 p-3">
      <p className="text-xs font-medium text-white">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} className="rounded-[7px] border-white/[0.08] bg-white/[0.055] text-[10px] text-slate-300">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-slate-500">No values available.</span>
        )}
      </div>
    </div>
  );
}

function FileSummaryList({ files, empty }: { files: ContextEngineFile[]; empty: string }) {
  if (files.length === 0) {
    return <p className="mt-2 rounded-[9px] border border-white/[0.08] bg-slate-950/42 p-3 text-xs text-slate-500">{empty}</p>;
  }

  return (
    <div className="mt-2 divide-y divide-white/[0.06] rounded-[9px] border border-white/[0.08] bg-slate-950/42">
      {files.map((file) => (
        <div key={file.path} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="truncate text-slate-200">{file.path}</span>
          <span className="shrink-0 text-slate-500">{formatTokenValue(file.injectedTokens)} tokens</span>
        </div>
      ))}
    </div>
  );
}

function DiagnosticsList({ diagnostics }: { diagnostics: string[] }) {
  if (diagnostics.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-1.5">
      {diagnostics.slice(0, 4).map((diagnostic) => (
        <p key={diagnostic} className="rounded-[9px] border border-amber-300/16 bg-amber-400/[0.07] px-2.5 py-1.5 text-[11px] leading-4 text-amber-100/82">
          {diagnostic}
        </p>
      ))}
    </div>
  );
}

function UnavailableState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-6">
      <p className="text-base font-medium text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function CompactInspectorItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function InspectorValue({
  value,
  source,
  compact = false
}: {
  value: string;
  source: ContextEngineTokenSource;
  compact?: boolean;
}) {
  return (
    <span className="text-white">
      {value}
      {source !== "reported" ? (
        <span className={cn("uppercase text-slate-500", compact ? "ml-1 text-[8px] tracking-[0.08em]" : "ml-2 text-[10px] tracking-[0.12em]")}>
          {source}
        </span>
      ) : null}
    </span>
  );
}

function applyDraftFileState(files: ContextEngineFile[], draftEnabledByPath: Record<string, boolean>) {
  return files.map((file) => {
    const enabled = Boolean(draftEnabledByPath[file.path] ?? file.enabled);
    const status = resolveDraftStatus(file, enabled);

    return {
      ...file,
      enabled,
      status,
      injectedTokens: enabled ? file.injectedTokens : 0,
      statusReason: status === "disabled" ? "This file is excluded in the unsaved Context Engine draft." : file.statusReason
    };
  });
}

function resolveDraftStatus(file: ContextEngineFile, enabled: boolean): ContextEngineFileStatus {
  if (!file.exists) {
    return "missing";
  }

  if (!enabled) {
    return "disabled";
  }

  return file.status === "disabled" ? "enabled" : file.status;
}

function chooseInitialFilePath(files: ContextEngineFile[]) {
  return (
    files.find((file) => file.path === "AGENTS.md")?.path ??
    files.find((file) => file.owner === "agent-profile")?.path ??
    files[0]?.path ??
    null
  );
}

function replaceContextFile(files: ContextEngineFile[], nextFile: ContextEngineFile) {
  return files.map((file) => (file.path === nextFile.path ? nextFile : file));
}

function isProjectContextFile(file: ContextEngineFile) {
  return (
    file.owner === "workspace-global" ||
    file.owner === "agent-profile" ||
    file.owner === "agent-policy" ||
    file.owner === "memory"
  );
}

function buildInjectedPreviewContent(file: ContextEngineFile, content: string) {
  if (!file.enabled) {
    return `# ${file.label}\n\nThis file is currently excluded from the AgentOS Context Engine configuration.`;
  }

  if (!file.exists) {
    return `# ${file.label}\n\nThis file is missing. Create it before it can be injected.`;
  }

  if (file.status === "truncated" && typeof file.injectedTokens === "number") {
    const maxChars = file.injectedTokens * 4;
    return `${content.slice(0, maxChars)}\n\n[Truncated preview based on OpenClaw reported injected token count.]`;
  }

  return content || `# ${file.label}\n\nNo content was loaded for this file.`;
}

function defaultBudgetItems(): ContextEngineBudgetItem[] {
  return [
    { id: "system", label: "System Prompt", tokens: null, source: "unknown" },
    { id: "project", label: "Project Context", tokens: null, source: "unknown" },
    { id: "skills", label: "Skills", tokens: null, source: "unknown" },
    { id: "tools", label: "Tools", tokens: null, source: "unknown" },
    { id: "history", label: "History", tokens: null, source: "unknown" },
    { id: "attachments", label: "Attachments", tokens: null, source: "unknown" }
  ];
}

function resolveBudgetTone(id: ContextEngineBudgetItem["id"]) {
  if (id === "system") {
    return "text-violet-300";
  }
  if (id === "project") {
    return "text-blue-300";
  }
  if (id === "skills") {
    return "text-emerald-300";
  }
  if (id === "tools") {
    return "text-amber-300";
  }
  if (id === "history") {
    return "text-cyan-300";
  }
  return "text-fuchsia-300";
}

function formatContextUsage(snapshot: ContextEngineSnapshot | null) {
  if (!snapshot || snapshot.budget.usedPercent == null) {
    return "Unknown context used";
  }

  return `${snapshot.budget.usedPercent}% context used`;
}

function formatTokenValue(value: number | null | undefined) {
  return typeof value === "number" ? formatTokens(value) : "-";
}

function formatBudgetItemValue(item: ContextEngineBudgetItem) {
  if (typeof item.tokens === "number") {
    return formatTokens(item.tokens);
  }

  if (item.id === "project") {
    return "No files";
  }

  if (item.id === "attachments") {
    return "Not exposed";
  }

  return "Not reported";
}

function formatBudgetItemSource(item: ContextEngineBudgetItem) {
  if (typeof item.tokens !== "number") {
    return item.source === "unknown" ? "unavailable" : item.source;
  }

  return item.source === "reported" ? null : item.source;
}

function sumKnownTokens(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => typeof value === "number");

  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}
