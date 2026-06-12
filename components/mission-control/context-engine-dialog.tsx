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
        closeClassName="right-6 top-6 h-10 w-10 text-slate-300 hover:bg-white/[0.06] hover:text-white"
        className="grid h-[min(calc(100vh-48px),980px)] max-h-[calc(100vh-48px)] w-[min(94vw,1320px)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[20px] border border-violet-300/28 bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.16),transparent_28%),linear-gradient(135deg,rgba(16,20,31,0.98),rgba(8,11,19,0.98)_62%,rgba(13,15,25,0.98))] p-0 text-slate-100 shadow-[0_0_0_1px_rgba(167,139,250,0.14),0_32px_110px_rgba(0,0,0,0.72)]"
      >
        <DialogHeader className="relative border-b border-white/[0.06] px-10 pb-5 pt-8">
          <div className="flex items-start justify-between gap-8 pr-14">
            <div className="flex min-w-0 items-start gap-5">
              <div className="relative mt-1 flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-violet-500/15 text-violet-200 shadow-[0_0_40px_rgba(124,58,237,0.34)]">
                <Hexagon className="h-12 w-12 fill-violet-500/55 stroke-violet-300" />
                <span className="absolute h-2.5 w-2.5 rounded-full bg-violet-200 shadow-[0_0_18px_rgba(196,181,253,0.8)]" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-display text-[1.65rem] font-semibold leading-8 text-white">
                  Context Engine
                </DialogTitle>
                <DialogDescription className="mt-1 text-base text-slate-300/78">
                  Control what this agent sees
                </DialogDescription>
                <div className="mt-3 flex flex-wrap gap-2">
                  <HeaderChip icon={<Sparkles className="h-3.5 w-3.5" />} value={engineSnapshot?.model.label ?? "Unknown model"} tone="violet" />
                  <HeaderChip icon={<Grid2X2 className="h-3.5 w-3.5" />} value={engineSnapshot?.model.contextWindow ? `${formatContextWindow(engineSnapshot.model.contextWindow)} window` : "Unknown window"} tone="blue" />
                  <HeaderChip icon={<Clock3 className="h-3.5 w-3.5" />} value={formatContextUsage(engineSnapshot)} tone={engineSnapshot?.budget.usedPercent == null ? "muted" : "amber"} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <TopActionButton
                icon={<Eye className="h-4 w-4" />}
                label="Preview"
                onClick={() => setActiveTab("preview")}
              />
              <TopActionButton
                icon={<Grid2X2 className="h-4 w-4" />}
                label="Compact"
                disabled
                title={engineSnapshot?.capabilities.compaction.reason ?? "OpenClaw compaction is not available."}
              />
              <Button
                type="button"
                className="h-12 rounded-[10px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-5 text-[15px] text-white shadow-[0_14px_34px_rgba(124,58,237,0.38)] hover:bg-violet-500"
                disabled={!engineSnapshot || isSavingContext || !hasContextChanges}
                onClick={() => void saveContext()}
              >
                {isSavingContext ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[230px_minmax(0,1fr)] gap-5 overflow-y-auto px-5 py-5">
          <aside className="min-h-[620px] rounded-[10px] border border-white/[0.09] bg-black/18 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <nav className="space-y-1">
              {tabItems.map((item) => {
                const Icon = item.icon;
                const selected = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "group relative flex h-[64px] w-full items-center gap-3 px-5 text-left text-[15px] transition-colors",
                      selected
                        ? "bg-violet-500/18 text-violet-100"
                        : "text-slate-300 hover:bg-white/[0.045] hover:text-white"
                    )}
                    onClick={() => setActiveTab(item.id)}
                  >
                    {selected ? <span className="absolute left-0 top-2 h-12 w-1 rounded-r-full bg-violet-400 shadow-[0_0_20px_rgba(167,139,250,0.7)]" /> : null}
                    <Icon className={cn("h-5 w-5", selected ? "text-violet-200" : "text-slate-400 group-hover:text-slate-200")} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="h-full min-h-[620px]">
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

        <DialogFooter className="border-t border-white/[0.07] px-5 py-3">
          <div className="flex w-full items-center justify-between rounded-[10px] border border-white/[0.055] bg-white/[0.025] px-4 py-3">
            <Button
              type="button"
              variant="secondary"
              className="h-12 rounded-[9px] border-white/10 bg-white/[0.055] px-5 text-slate-300 hover:bg-white/[0.09] hover:text-white"
              disabled={!engineSnapshot || !hasContextChanges || isSavingContext}
              onClick={resetDraft}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button
              type="button"
              className="h-12 rounded-[10px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-7 text-base text-white shadow-[0_14px_34px_rgba(124,58,237,0.36)] hover:bg-violet-500"
              disabled={!engineSnapshot || isSavingContext || !hasContextChanges}
              onClick={() => void saveContext()}
            >
              {isSavingContext ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
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
    <div className="grid h-full min-h-0 grid-rows-[210px_minmax(0,1fr)] gap-4">
      <ContextBudgetCard snapshot={snapshot} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(360px,0.95fr)] gap-4">
        <section className="min-h-0 rounded-[10px] border border-white/[0.1] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
            <div>
              <h3 className="text-[17px] font-semibold text-white">B. Project Context Files</h3>
              <p className="mt-0.5 text-sm text-slate-400">Files injected into the agent context</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-[9px] border-white/10 bg-white/[0.055] px-4 text-sm text-slate-100 hover:bg-white/[0.09]"
              disabled={!createableMissingFile}
              title={createableMissingFile ? `Create ${createableMissingFile.path}` : "No createable missing context files."}
              onClick={onAddFile}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add File
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(190px,1fr)_130px_118px_92px_42px] border-b border-white/[0.07] px-4 py-3 text-[13px] text-slate-400">
            <span>File</span>
            <span>Tokens</span>
            <span>Status</span>
            <span>Enabled</span>
            <span />
          </div>
          <ScrollArea className="h-[calc(100%-146px)]">
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
          <div className="flex items-center justify-end gap-4 border-t border-white/[0.07] px-5 py-4 text-sm text-slate-400">
            <span>Total</span>
            <span className="text-base font-semibold text-white">{formatTokenValue(enabledProjectTokenTotal)} tokens</span>
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
    <section className="rounded-[10px] border border-white/[0.1] bg-white/[0.035] px-7 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[17px] font-semibold text-white">A. Context Budget</h3>
        <p className="text-[15px] font-medium text-slate-100">
          {usedLabel} / {limitLabel} tokens
        </p>
      </div>
      <div className="mt-4 h-[18px] overflow-hidden rounded-[5px] bg-slate-800/80">
        <div
          className="h-full rounded-[5px] bg-[linear-gradient(90deg,#8b5cf6,#c084fc,#fb7185,#fb923c)] transition-[width]"
          style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
        />
      </div>
      <div className="mt-5 grid grid-cols-6 gap-4">
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

  return (
    <div className="rounded-[10px] border border-white/[0.1] bg-slate-950/36 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={cn("h-6 w-6", tone)} />
        <p className="min-h-10 text-[14px] leading-5 text-slate-300">{item.label}</p>
      </div>
      <p className="mt-2 text-center text-[16px] font-semibold text-white">{formatTokenValue(item.tokens)}</p>
      {item.source !== "reported" ? (
        <p className="mt-1 text-center text-[9px] uppercase tracking-[0.14em] text-slate-500">{item.source}</p>
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
        "relative grid min-h-[56px] grid-cols-[minmax(190px,1fr)_130px_118px_92px_42px] items-center px-4 text-sm transition-colors",
        selected ? "bg-violet-500/16 shadow-[inset_3px_0_0_rgba(139,92,246,0.95)]" : "hover:bg-white/[0.035]"
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileText className="h-5 w-5 shrink-0 text-slate-300" />
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{file.label}</p>
          <p className="truncate font-mono text-[10px] text-slate-500">{file.path}</p>
        </div>
      </div>
      <span className="text-slate-300">{file.rawTokens == null ? "-" : `${formatTokenValue(file.rawTokens)} tokens`}</span>
      <StatusBadge status={file.status} />
      <button
        type="button"
        role="switch"
        aria-checked={file.enabled}
        disabled={!file.canToggle}
        title={file.canToggle ? "Toggle context inclusion" : file.statusReason ?? "This file cannot be toggled."}
        className={cn(
          "relative h-6 w-11 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-55",
          file.enabled ? "border-violet-300/35 bg-violet-500 shadow-[0_0_18px_rgba(139,92,246,0.35)]" : "border-slate-600 bg-slate-700"
        )}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span
          className={cn(
            "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
            file.enabled ? "translate-x-[19px]" : "translate-x-[2px]"
          )}
        />
      </button>
      <button
        type="button"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
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
          className="absolute right-3 top-10 z-20 w-44 rounded-[10px] border border-white/[0.1] bg-slate-950 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.45)]"
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
      <div className="border-b border-white/[0.07] px-5 py-4">
        <h3 className="text-[17px] font-semibold text-white">C. Selected File</h3>
      </div>
      {!file ? (
        <EmptyState title="No file selected" detail="Select a context file to inspect the exact source and preview." />
      ) : (
        <div className="flex h-[calc(100%-57px)] min-h-0 flex-col">
          <div className="px-5 py-4">
            <div className="flex items-center gap-3">
              <FileText className="h-7 w-7 text-slate-200" />
              <div className="min-w-0">
                <h4 className="truncate text-xl font-semibold text-white">{file.label}</h4>
                <p className="truncate font-mono text-[11px] text-slate-500">{file.path}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <InspectorLabel label="Status:" />
              <StatusBadge status={file.status} />
              <InspectorLabel label="Raw tokens:" />
              <InspectorValue value={file.rawTokens == null ? "Unknown" : formatTokenValue(file.rawTokens)} source={file.tokenSource} />
              <InspectorLabel label="Injected tokens:" />
              <InspectorValue value={file.injectedTokens == null ? "Unknown" : formatTokenValue(file.injectedTokens)} source={file.tokenSource} />
              <InspectorLabel label="Scope:" />
              <span className="capitalize text-white">{file.scope}</span>
              <InspectorLabel label="Last updated:" />
              <span className="text-slate-300">{file.lastUpdatedAt ? new Date(file.lastUpdatedAt).toLocaleString() : "Unknown"}</span>
            </div>
            {file.statusReason ? (
              <p className="mt-3 rounded-[10px] border border-amber-300/16 bg-amber-400/[0.07] px-3 py-2 text-xs leading-5 text-amber-100/85">
                {file.statusReason}
              </p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 border-t border-white/[0.07] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate-400">{inspectorMode === "edit" ? "Edit" : "Preview"}</p>
              {isLoadingFile ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
            </div>
            {error ? (
              <p className="mb-3 rounded-[10px] border border-rose-300/18 bg-rose-400/[0.08] px-3 py-2 text-xs text-rose-100">
                {error}
              </p>
            ) : null}
            {inspectorMode === "edit" ? (
              <Textarea
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                disabled={!canEditActiveFile}
                spellCheck={false}
                className="h-[210px] resize-none rounded-[8px] border-white/[0.1] bg-slate-950/62 font-mono text-xs leading-5 text-slate-100 focus-visible:ring-violet-300/35"
                placeholder={isLoadingFile ? "Loading context file..." : "Write context file content"}
              />
            ) : (
              <CodePreview content={buildInjectedPreviewContent(file, content || savedContent)} />
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 border-t border-white/[0.07] px-5 py-4">
            {inspectorMode === "edit" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-[9px] border-white/10 bg-white/[0.055] text-slate-200 hover:bg-white/[0.09]"
                  disabled={!hasUnsavedFileChanges || isSavingFile}
                  onClick={onRevertFile}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-[9px] border-white/10 bg-white/[0.055] text-slate-200 hover:bg-white/[0.09]"
                  onClick={onPreview}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-[9px] bg-violet-500 text-white hover:bg-violet-400"
                  disabled={!hasUnsavedFileChanges || !canEditActiveFile || isSavingFile}
                  onClick={onSaveFile}
                >
                  {isSavingFile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save File
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-[9px] border-white/10 bg-white/[0.055] text-slate-200 hover:bg-white/[0.09]"
                  disabled={!file.editable}
                  onClick={onEdit}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 rounded-[9px] border-white/10 bg-white/[0.055] text-slate-200 hover:bg-white/[0.09]"
                  onClick={onPreview}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 rounded-[9px] border border-rose-300/25 bg-rose-500/15 text-rose-200 hover:bg-rose-500/22"
                  disabled={!file.canToggle || !file.enabled}
                  onClick={onExclude}
                >
                  <Ban className="mr-2 h-4 w-4" />
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
      <div className="grid grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-4">
          <p className="text-sm font-medium text-white">System prompt</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{snapshot?.preview.systemPromptSummary ?? "No preview is available."}</p>
          <div className="mt-5">
            <p className="text-sm font-medium text-white">Active project context files</p>
            <FileSummaryList files={files.filter((file) => file.enabled)} empty="No files are enabled in the saved context plan." />
          </div>
        </div>
        <div className="rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-4">
          <p className="text-sm font-medium text-white">Token estimate</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatTokenValue(snapshot?.preview.totalTokens ?? null)}</p>
          <p className="mt-2 text-sm text-slate-400">{snapshot?.preview.status === "exact" ? "From OpenClaw context report" : "Estimated by AgentOS from available metadata"}</p>
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
        "inline-flex h-8 items-center gap-2 rounded-[8px] border bg-white/[0.035] px-3 text-xs font-medium",
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
      className="h-12 rounded-[10px] border-white/10 bg-white/[0.045] px-5 text-[15px] text-slate-100 hover:bg-white/[0.08]"
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="mr-2">{icon}</span>
      {label}
    </Button>
  );
}

function StatusBadge({ status }: { status: ContextEngineFileStatus }) {
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs font-medium capitalize", statusTone[status])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
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
    <div className="h-[210px] overflow-hidden rounded-[8px] border border-white/[0.1] bg-slate-950/62 p-3 font-mono text-xs leading-5 text-slate-300">
      {lines.map((line, index) => (
        <div key={`${index}:${line}`} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
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
    <section className="h-full rounded-[10px] border border-white/[0.1] bg-white/[0.035] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      <div className="mt-6">{children}</div>
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
    <div className="rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 truncate text-lg font-semibold text-white">{value}</p>
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
    <div className="grid grid-cols-2 gap-4">
      <CapabilityList title={leftTitle} values={leftValues} />
      <CapabilityList title={rightTitle} values={rightValues} />
    </div>
  );
}

function CapabilityList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-4">
      <p className="text-sm font-medium text-white">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} className="rounded-[7px] border-white/[0.08] bg-white/[0.055] text-[10px] text-slate-300">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-slate-500">No values available.</span>
        )}
      </div>
    </div>
  );
}

function FileSummaryList({ files, empty }: { files: ContextEngineFile[]; empty: string }) {
  if (files.length === 0) {
    return <p className="mt-3 rounded-[10px] border border-white/[0.08] bg-slate-950/42 p-4 text-sm text-slate-500">{empty}</p>;
  }

  return (
    <div className="mt-3 divide-y divide-white/[0.06] rounded-[10px] border border-white/[0.08] bg-slate-950/42">
      {files.map((file) => (
        <div key={file.path} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
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
    <div className="mt-5 space-y-2">
      {diagnostics.slice(0, 4).map((diagnostic) => (
        <p key={diagnostic} className="rounded-[10px] border border-amber-300/16 bg-amber-400/[0.07] px-3 py-2 text-xs leading-5 text-amber-100/82">
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

function InspectorLabel({ label }: { label: string }) {
  return <span className="text-slate-400">{label}</span>;
}

function InspectorValue({ value, source }: { value: string; source: ContextEngineTokenSource }) {
  return (
    <span className="text-white">
      {value}
      {source !== "reported" ? <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">{source}</span> : null}
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

function sumKnownTokens(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => typeof value === "number");

  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}
