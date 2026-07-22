"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  Ban,
  Bot,
  Clock3,
  Eye,
  FileText,
  FolderOpen,
  Grid2X2,
  Hexagon,
  History,
  Home,
  Loader2,
  Maximize2,
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
import { Textarea } from "@/components/ui/textarea";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { applyContextEngineDraftState, useContextEngineDraft } from "@/components/mission-control/use-context-engine-draft";
import { useContextEngineLoader } from "@/components/mission-control/use-context-engine-loader";
import type {
  ContextEngineBudgetItem,
  ContextEngineEffectiveContextSection,
  ContextEngineFile,
  ContextEngineFileStatus,
  ContextEngineSaveInput,
  ContextEngineSnapshot,
  ContextEngineTokenSource
} from "@/lib/openclaw/context-engine-types";
import {
  compactPath,
  formatAgentDisplayName,
  formatContextWindow,
  formatRelativeTime,
  formatTokens
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type ContextEngineTab = "overview" | "project" | "skills" | "memory" | "attachments" | "preview";
type InspectorMode = "preview" | "edit";
type ContextEngineSurfaceTheme = "dark" | "light";
type ContextEngineThemeStyle = CSSProperties & Record<`--ce-${string}`, string>;

const contextEngineThemeStyles: Record<ContextEngineSurfaceTheme, ContextEngineThemeStyle> = {
  dark: {
    "--ce-surface": "radial-gradient(circle at 10% 0%, rgba(124,58,237,0.16), transparent 28%), linear-gradient(135deg, rgba(16,20,31,0.99), rgba(8,11,19,0.99) 62%, rgba(13,15,25,0.99))",
    "--ce-panel": "rgba(255,255,255,0.04)",
    "--ce-panel-strong": "rgba(2,6,23,0.62)",
    "--ce-panel-hover": "rgba(255,255,255,0.085)",
    "--ce-border": "rgba(255,255,255,0.11)",
    "--ce-border-subtle": "rgba(255,255,255,0.07)",
    "--ce-text-strong": "#f8fafc",
    "--ce-text": "#dbe4f0",
    "--ce-text-muted": "#9ba9ba",
    "--ce-text-subtle": "#69788b",
    "--ce-accent": "#c4b5fd",
    "--ce-accent-strong": "#a78bfa",
    "--ce-accent-soft": "rgba(139,92,246,0.17)",
    "--ce-blue": "#bae6fd",
    "--ce-success-bg": "rgba(52,211,153,0.11)",
    "--ce-success-border": "rgba(110,231,183,0.3)",
    "--ce-success-text": "#a7f3d0",
    "--ce-warning-bg": "rgba(251,191,36,0.1)",
    "--ce-warning-border": "rgba(252,211,77,0.28)",
    "--ce-warning-text": "#fde68a",
    "--ce-danger-bg": "rgba(244,63,94,0.1)",
    "--ce-danger-border": "rgba(253,164,175,0.3)",
    "--ce-danger-text": "#fecdd3",
    "--ce-neutral-bg": "rgba(100,116,139,0.24)",
    "--ce-neutral-border": "rgba(148,163,184,0.26)",
    "--ce-neutral-text": "#cbd5e1"
  },
  light: {
    "--ce-surface": "radial-gradient(circle at 10% 0%, rgba(124,58,237,0.1), transparent 30%), linear-gradient(135deg, rgba(255,253,251,0.99), rgba(248,244,240,0.99) 62%, rgba(252,249,246,0.99))",
    "--ce-panel": "rgba(255,255,255,0.72)",
    "--ce-panel-strong": "rgba(255,255,255,0.92)",
    "--ce-panel-hover": "rgba(109,40,217,0.09)",
    "--ce-border": "rgba(91,70,57,0.2)",
    "--ce-border-subtle": "rgba(91,70,57,0.13)",
    "--ce-text-strong": "#241b16",
    "--ce-text": "#493a31",
    "--ce-text-muted": "#736258",
    "--ce-text-subtle": "#927f73",
    "--ce-accent": "#6d28d9",
    "--ce-accent-strong": "#7c3aed",
    "--ce-accent-soft": "rgba(109,40,217,0.1)",
    "--ce-blue": "#0369a1",
    "--ce-success-bg": "#dcfce7",
    "--ce-success-border": "#86efac",
    "--ce-success-text": "#166534",
    "--ce-warning-bg": "#fef3c7",
    "--ce-warning-border": "#fcd34d",
    "--ce-warning-text": "#854d0e",
    "--ce-danger-bg": "#ffe4e6",
    "--ce-danger-border": "#fda4af",
    "--ce-danger-text": "#9f1239",
    "--ce-neutral-bg": "#f1f5f9",
    "--ce-neutral-border": "#cbd5e1",
    "--ce-neutral-text": "#475569"
  }
};

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
  { id: "preview", label: "Effective Context", icon: Eye }
];

const statusTone: Record<ContextEngineFileStatus, string> = {
  enabled: "border-[var(--ce-success-border)] bg-[var(--ce-success-bg)] text-[var(--ce-success-text)]",
  disabled: "border-[var(--ce-neutral-border)] bg-[var(--ce-neutral-bg)] text-[var(--ce-neutral-text)]",
  missing: "border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] text-[var(--ce-danger-text)]",
  truncated: "border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] text-[var(--ce-warning-text)]",
  error: "border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] text-[var(--ce-danger-text)]"
};

const budgetIcons: Record<ContextEngineBudgetItem["id"], typeof TerminalSquare> = {
  system: TerminalSquare,
  project: FolderOpen,
  skills: Puzzle,
  tools: Wrench,
  history: Clock3,
  attachments: Paperclip
};

const contextEditorTextareaClassName =
  "!border-[var(--ce-border)] !bg-[var(--ce-panel-strong)] !text-[var(--ce-text-strong)] caret-[var(--ce-accent)] placeholder:!text-[var(--ce-text-subtle)] selection:bg-violet-500/25 disabled:!text-[var(--ce-text-muted)] disabled:!opacity-70";

export function ContextEngineDialog({
  agentId,
  open,
  onOpenChange,
  surfaceTheme = "dark"
}: {
  agentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceTheme?: ContextEngineSurfaceTheme;
}) {
  const [engineSnapshot, setEngineSnapshot] = useState<ContextEngineSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ContextEngineTab>("project");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ContextEngineFile | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("preview");
  const [expandedFileOpen, setExpandedFileOpen] = useState(false);
  const [actionMenuPath, setActionMenuPath] = useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    draftEnabledByPath,
    setDraftEnabledByPath,
    displayFiles,
    hasContextChanges,
    replaceDraftFromFiles,
    toggleDraftFile
  } = useContextEngineDraft(engineSnapshot?.files ?? []);
  const {
    loadSnapshot,
    loadFile,
    saveConfiguration,
    saveFile: saveContextFile
  } = useContextEngineLoader(agentId);
  const projectFiles = useMemo(
    () => displayFiles.filter((file) => isProjectContextFile(file)),
    [displayFiles]
  );
  const selectedFileForPath = selectedFile?.path === selectedPath ? selectedFile : null;
  const activeFile = selectedFileForPath
    ? applyContextEngineDraftState([selectedFileForPath], draftEnabledByPath)[0]
    : displayFiles.find((file) => file.path === selectedPath) ?? null;
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
      const result = await loadSnapshot();

      setEngineSnapshot(result);
      replaceDraftFromFiles(result.files);
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
  }, [agentId, loadSnapshot, replaceDraftFromFiles]);

  useEffect(() => {
    if (!open || !agentId) {
      setEngineSnapshot(null);
      setSelectedPath(null);
      setSelectedFile(null);
      replaceDraftFromFiles([]);
      setContent("");
      setSavedContent("");
      setError(null);
      setActiveTab("project");
      setInspectorMode("preview");
      setExpandedFileOpen(false);
      setActionMenuPath(null);
      return;
    }

    void refreshSnapshot();
  }, [agentId, open, refreshSnapshot, replaceDraftFromFiles]);

  useEffect(() => {
    if (!open || !agentId || !selectedPath) {
      return;
    }

    let cancelled = false;
    setSelectedFile(null);
    setContent("");
    setSavedContent("");
    setIsLoadingFile(true);
    setError(null);

    void (async () => {
      try {
        const result = await loadFile(selectedPath);

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
  }, [agentId, loadFile, open, selectedPath]);

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
        const result = await saveConfiguration(payload);

        setEngineSnapshot(result);
        replaceDraftFromFiles(result.files);
        setSelectedFile((current) => {
          if (!current) {
            return current;
          }

          return result.files.find((file) => file.path === current.path) ?? current;
        });
        toast.success("Context configuration saved.", {
          description: result.capabilities.nativeFileToggles.supported
            ? "OpenClaw native context configuration was updated."
            : "AgentOS saved sidecar context preferences for this agent. OpenClaw runtime reports still determine what was actually injected."
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
    [agentId, draftEnabledByPath, engineSnapshot, replaceDraftFromFiles, saveConfiguration]
  );

  const saveFile = useCallback(async () => {
    if (!agentId || !activeFile || !canEditActiveFile) {
      return;
    }

    setIsSavingFile(true);
    setError(null);

    try {
      const result = await saveContextFile({
        path: activeFile.path,
        content
      });

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
  }, [activeFile, agentId, canEditActiveFile, content, saveContextFile, setDraftEnabledByPath]);

  const resetDraft = useCallback(() => {
    if (!engineSnapshot) {
      return;
    }

    replaceDraftFromFiles(engineSnapshot.files, "saved");
    toast.message("Context reset.", {
      description: "Restored the last saved Context Engine configuration."
    });
  }, [engineSnapshot, replaceDraftFromFiles]);

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
  }, [activeFile, draftEnabledByPath, saveContext, setDraftEnabledByPath]);

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
    <>
      <PikoLoader
        open={isSavingContext || isSavingFile}
        title={isSavingFile ? "Saving context file" : "Saving context configuration"}
        description={
          isSavingFile
            ? "Writing the selected context file and refreshing its runtime state."
            : "Applying the selected context files to this agent."
        }
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="context-engine-dialog"
        style={contextEngineThemeStyles[surfaceTheme]}
        overlayClassName="bg-black/78 backdrop-blur-lg"
        closeClassName="right-3 top-3 z-20 h-9 w-9 text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] hover:text-[var(--ce-text-strong)] sm:h-8 sm:w-8"
        className="grid h-dvh max-h-dvh w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-0 bg-[image:var(--ce-surface)] p-0 text-[var(--ce-text)] shadow-[0_0_0_1px_rgba(124,58,237,0.12),0_24px_80px_rgba(0,0,0,0.42)]"
      >
        <DialogHeader className="relative space-y-0 border-b border-[var(--ce-border-subtle)] px-4 py-3 sm:px-6 sm:pb-2 sm:pt-3">
          <div className="flex items-start justify-between gap-3 pr-10 sm:gap-5 sm:pr-9">
            <div className="flex min-w-0 items-start gap-3">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ce-accent-soft)] text-[var(--ce-accent)] shadow-[0_0_20px_rgba(124,58,237,0.2)]">
                <Hexagon className="h-6 w-6 fill-[var(--ce-accent-soft)] stroke-[var(--ce-accent)]" />
                <span className="absolute h-1.5 w-1.5 rounded-full bg-[var(--ce-accent)] shadow-[0_0_12px_rgba(124,58,237,0.55)]" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-display text-[17px] font-semibold leading-5 text-[var(--ce-text-strong)]">
                  Context Engine
                </DialogTitle>
                <div className="mt-0.5 flex min-w-0 items-center gap-x-2 gap-y-1 sm:mt-1 sm:flex-wrap">
                  <DialogDescription className="text-xs text-[var(--ce-text-muted)]">
                    {engineSnapshot
                      ? `Control what ${formatAgentDisplayName(engineSnapshot.agent)} sees`
                      : "Control what this agent sees"}
                  </DialogDescription>
                  <div className="hidden flex-wrap items-center gap-1.5 sm:flex">
                    <HeaderChip icon={<Sparkles className="h-3 w-3" />} value={engineSnapshot?.model.label ?? "Unknown model"} tone="violet" />
                    <HeaderChip icon={<Grid2X2 className="h-3 w-3" />} value={engineSnapshot?.model.contextWindow ? `${formatContextWindow(engineSnapshot.model.contextWindow)} window` : "Unknown window"} tone="blue" />
                    <HeaderChip icon={<Clock3 className="h-3 w-3" />} value={formatContextUsage(engineSnapshot)} tone={engineSnapshot?.budget.usedPercent == null ? "muted" : "amber"} />
                    <HeaderChip
                      icon={<FileText className="h-3 w-3" />}
                      value={formatConfigurationPersistence(engineSnapshot)}
                      tone={engineSnapshot?.configuration.persistenceStatus === "recovered" ? "amber" : "muted"}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <TopActionButton
                icon={<Eye className="h-3.5 w-3.5" />}
                label="Effective Context"
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

        <div className="flex min-h-0 flex-col overflow-hidden lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-4 lg:px-4 lg:py-3">
          <aside className="shrink-0 border-b border-[var(--ce-border)] bg-[var(--ce-panel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] lg:min-h-[465px] lg:rounded-[10px] lg:border lg:py-4">
            <nav className="flex overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:py-0">
              {tabItems.map((item) => {
                const Icon = item.icon;
                const selected = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "group relative flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-xs transition-colors lg:h-12 lg:w-full lg:gap-2.5 lg:rounded-none lg:px-4 lg:text-sm",
                      selected
                        ? "bg-[var(--ce-accent-soft)] text-[var(--ce-accent)]"
                        : "text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] hover:text-[var(--ce-text-strong)]"
                    )}
                    onClick={() => setActiveTab(item.id)}
                  >
                    {selected ? <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-t-full bg-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.65)] lg:bottom-auto lg:left-0 lg:right-auto lg:top-1.5 lg:h-9 lg:w-1 lg:rounded-r-full" /> : null}
                    <Icon className={cn("h-4 w-4 lg:h-[18px] lg:w-[18px]", selected ? "text-[var(--ce-accent)]" : "text-[var(--ce-text-muted)] group-hover:text-[var(--ce-text)]")} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="min-h-0 flex-1 overflow-y-auto p-3 lg:h-full lg:min-h-[465px] lg:overflow-visible lg:p-0">
            {activeTab === "project" ? (
              <ProjectContextTab
                surfaceTheme={surfaceTheme}
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
                onToggleFile={toggleDraftFile}
                onActionMenuChange={setActionMenuPath}
                onAddFile={openCreateFlow}
                onEdit={() => setInspectorMode("edit")}
                onPreview={() => setInspectorMode("preview")}
                expandedFileOpen={expandedFileOpen}
                onExpandedFileOpenChange={setExpandedFileOpen}
                onOpenExpandedFile={() => setExpandedFileOpen(true)}
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

        <DialogFooter className="gap-0 border-t border-[var(--ce-border-subtle)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:py-1.5">
          <div className="flex w-full items-center justify-between rounded-[8px] bg-[var(--ce-panel)] px-1.5 py-1">
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-[7px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 text-xs text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] hover:text-[var(--ce-text-strong)] sm:h-7 sm:px-2.5 sm:text-[11px]"
              disabled={!engineSnapshot || !hasContextChanges || isSavingContext}
              onClick={resetDraft}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
            <Button
              type="button"
              className="h-9 rounded-[7px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] px-4 text-xs text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] hover:bg-violet-500 sm:h-7 sm:px-3 sm:text-[11px]"
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
    </>
  );
}

function ProjectContextTab({
  surfaceTheme,
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
  expandedFileOpen,
  onExpandedFileOpenChange,
  onOpenExpandedFile,
  onExclude,
  onContentChange,
  onRevertFile,
  onSaveFile
}: {
  surfaceTheme: ContextEngineSurfaceTheme;
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
  expandedFileOpen: boolean;
  onExpandedFileOpenChange: (open: boolean) => void;
  onOpenExpandedFile: () => void;
  onExclude: () => void;
  onContentChange: (content: string) => void;
  onRevertFile: () => void;
  onSaveFile: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3 lg:h-full xl:grid xl:grid-rows-[96px_minmax(0,1fr)]">
      <ContextBudgetCard snapshot={snapshot} />
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.22fr)_minmax(285px,0.95fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-[var(--ce-border)] bg-[var(--ce-panel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:h-full">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--ce-border-subtle)] px-3 py-2.5 sm:items-start sm:px-4 sm:py-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--ce-text-strong)] sm:text-[15px]">Project Context Files</h3>
              <p className="mt-0.5 hidden text-xs text-[var(--ce-text-muted)] sm:block">Files injected into the agent context</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-[8px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 text-xs text-[var(--ce-text-strong)] hover:bg-[var(--ce-panel-hover)] sm:h-8"
              disabled={!createableMissingFile}
              title={createableMissingFile ? `Create ${createableMissingFile.path}` : "No createable missing context files."}
              onClick={onAddFile}
            >
              <Plus className="h-4 w-4 sm:mr-1.5 sm:h-3.5 sm:w-3.5" />
              <span className="sr-only sm:not-sr-only">Add File</span>
            </Button>
          </div>
          <div className="hidden grid-cols-[minmax(150px,1fr)_105px_132px_32px] border-b border-[var(--ce-border-subtle)] px-3 py-2 text-[11px] text-[var(--ce-text-muted)] sm:grid">
            <span>File</span>
            <span>Tokens</span>
            <span>State</span>
            <span />
          </div>
          <div className="min-h-0 sm:max-h-[360px] sm:overflow-y-auto xl:flex-1 xl:max-h-none">
            {isLoadingSnapshot && files.length === 0 ? (
              <div className="flex h-40 items-center justify-center gap-2 text-sm text-[var(--ce-text-muted)]">
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
          </div>
          <div className="shrink-0 flex items-center justify-between border-t border-[var(--ce-border-subtle)] px-3 py-2 text-xs text-[var(--ce-text-muted)] sm:grid sm:grid-cols-[minmax(150px,1fr)_105px_132px_32px]">
            <span className="text-[11px] uppercase tracking-[0.18em]">Total</span>
            <span className="font-semibold text-[var(--ce-text-strong)]">{formatTokenValue(enabledProjectTokenTotal)} tokens</span>
            <span className="hidden sm:block" />
            <span className="hidden sm:block" />
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
          onOpenExpandedFile={onOpenExpandedFile}
          onExclude={onExclude}
          onContentChange={onContentChange}
          onRevertFile={onRevertFile}
          onSaveFile={onSaveFile}
        />
        <ExpandedFileEditorDialog
          surfaceTheme={surfaceTheme}
          open={expandedFileOpen}
          onOpenChange={onExpandedFileOpenChange}
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
    <section className="rounded-[9px] border border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:px-4 sm:py-2">
      <div className="grid gap-2 sm:grid-cols-[max-content_minmax(220px,1fr)] sm:items-center sm:gap-4">
        <h3 className="whitespace-nowrap text-xs font-semibold text-[var(--ce-text-strong)] sm:text-[13px]">Context Budget</h3>
        <div className="relative h-5 overflow-hidden rounded-full border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)]">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#8b5cf6,#c084fc,#fb7185,#fb923c)] transition-[width]"
            style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center px-3 text-[11px] font-semibold leading-none text-[var(--ce-text-strong)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
            {usedLabel} / {limitLabel} tokens
          </span>
        </div>
      </div>
      <div className="mt-2 hidden grid-cols-3 gap-2 sm:grid lg:grid-cols-6">
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
    <div className="rounded-[7px] border border-[var(--ce-border)] bg-[var(--ce-panel-strong)] px-2 py-1">
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0", tone)} />
        <p className="truncate text-[10px] leading-3 text-[var(--ce-text)]">{item.label}</p>
      </div>
      <p
        className={cn(
          "mt-0.5 truncate text-center font-semibold leading-4",
          hasTokenValue ? "text-[11px] text-[var(--ce-text-strong)]" : "text-[10px] text-[var(--ce-text)]"
        )}
        title={valueLabel}
      >
        {valueLabel}
      </p>
      {sourceLabel ? (
        <p className="truncate text-center text-[7px] uppercase tracking-[0.1em] text-[var(--ce-text-subtle)]">{sourceLabel}</p>
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
        "relative grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-2 px-3 py-2 text-xs transition-colors sm:min-h-11 sm:grid-cols-[minmax(150px,1fr)_105px_132px_32px] sm:gap-0 sm:py-0",
        selected ? "bg-[var(--ce-accent-soft)] shadow-[inset_3px_0_0_var(--ce-accent-strong)]" : "hover:bg-[var(--ce-panel-hover)]"
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ContextFileListIcon file={file} />
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--ce-text-strong)]">{file.label}</p>
          <p className="truncate font-mono text-[10px] text-[var(--ce-text-subtle)]">{file.path}</p>
          <p className="mt-0.5 text-[10px] text-[var(--ce-text-muted)] sm:hidden">
            {file.rawTokens == null ? "Tokens unknown" : `${formatTokenValue(file.rawTokens)} tokens`}
          </p>
        </div>
      </div>
      <span className="hidden text-[var(--ce-text)] sm:block">{file.rawTokens == null ? "-" : `${formatTokenValue(file.rawTokens)} tokens`}</span>
      <ContextFileStateControl file={file} onToggle={onToggle} />
      <button
        type="button"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ce-text-muted)] transition-colors hover:bg-[var(--ce-panel-hover)] hover:text-[var(--ce-text-strong)] sm:h-7 sm:w-7"
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
          className="absolute right-2 top-12 z-20 w-44 rounded-[10px] border border-[var(--ce-border)] bg-[var(--ce-panel-strong)] p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.45)] sm:top-9 sm:w-40"
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

function ContextFileListIcon({ file }: { file: ContextEngineFile }) {
  if (file.scope === "agent") {
    return <Bot className="h-4 w-4 shrink-0 text-[var(--ce-accent)]" />;
  }

  if (file.scope === "workspace") {
    return <Home className="h-4 w-4 shrink-0 text-[var(--ce-blue)]" />;
  }

  return <FileText className="h-4 w-4 shrink-0 text-[var(--ce-text)]" />;
}

function ContextFileStateControl({ file, onToggle }: { file: ContextEngineFile; onToggle: () => void }) {
  if (file.status === "missing") {
    return (
      <span
        className="inline-flex h-9 w-fit items-center rounded-full border border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] px-2.5 text-[11px] font-medium text-[var(--ce-danger-text)] sm:h-7"
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
        "inline-flex h-10 w-12 flex-col items-center justify-center gap-0.5 rounded-[7px] px-1 py-0.5 text-[10px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:h-auto sm:w-[64px] sm:items-start",
        enabled
          ? "text-[var(--ce-success-text)] hover:bg-[var(--ce-success-bg)]"
          : "text-[var(--ce-neutral-text)] hover:bg-[var(--ce-neutral-bg)]"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span
        className={cn(
          "relative h-4 w-8 rounded-full border transition-colors",
          enabled
            ? "border-[var(--ce-success-border)] bg-emerald-500"
            : "border-[var(--ce-neutral-border)] bg-slate-500"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-0" : "translate-x-4"
          )}
        />
      </span>
      <span className="hidden sm:inline">{enabled ? "Enabled" : "Disabled"}</span>
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
  onOpenExpandedFile,
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
  onOpenExpandedFile: () => void;
  onExclude: () => void;
  onContentChange: (content: string) => void;
  onRevertFile: () => void;
  onSaveFile: () => void;
}) {
  return (
    <section className="min-h-0 overflow-hidden rounded-[10px] border border-[var(--ce-border)] bg-[var(--ce-panel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="border-b border-[var(--ce-border-subtle)] px-3 py-2">
        <h3 className="text-[13px] font-semibold text-[var(--ce-text-strong)]">Selected File</h3>
      </div>
      {!file ? (
        <EmptyState title="No file selected" detail="Select a context file to inspect the exact source and preview." />
      ) : (
        <div className="flex h-[calc(100%-37px)] min-h-0 flex-col">
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--ce-text)]" />
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold leading-4 text-[var(--ce-text-strong)]">{file.label}</h4>
                <p className="truncate font-mono text-[9px] leading-3 text-[var(--ce-text-subtle)]">{file.path}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4 [&>*:nth-child(n+5)]:hidden sm:[&>*:nth-child(n+5)]:grid">
              <CompactInspectorItem label="Status">
                <StatusBadge status={file.status} compact />
              </CompactInspectorItem>
              <CompactInspectorItem label="Scope">
                <span className="capitalize text-[var(--ce-text-strong)]">{file.scope}</span>
              </CompactInspectorItem>
              <CompactInspectorItem label="Raw">
                <InspectorValue value={file.rawTokens == null ? "Unknown" : formatTokenValue(file.rawTokens)} source={file.tokenSource} compact />
              </CompactInspectorItem>
              <CompactInspectorItem label="Injected">
                <InspectorValue value={file.injectedTokens == null ? "Unknown" : formatTokenValue(file.injectedTokens)} source={file.tokenSource} compact />
              </CompactInspectorItem>
              <CompactInspectorItem label="Preference">
                <span className="text-[var(--ce-text-strong)]">{formatPreferenceSource(file)}</span>
              </CompactInspectorItem>
              <CompactInspectorItem label="Runtime">
                <span className="text-[var(--ce-text-strong)]">{formatRuntimeInclusionSource(file)}</span>
              </CompactInspectorItem>
            </div>
            {file.statusReason ? (
              <p className="mt-1.5 rounded-[8px] border border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] px-2 py-1 text-[10px] leading-[14px] text-[var(--ce-warning-text)]">
                {file.statusReason}
              </p>
            ) : null}
          </div>

          <div className="flex min-h-[180px] flex-1 flex-col border-t border-[var(--ce-border-subtle)] px-3 py-2 xl:min-h-0">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] text-[var(--ce-text-muted)]">{inspectorMode === "edit" ? "Edit" : "Preview"}</p>
              {isLoadingFile ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ce-text-subtle)]" /> : null}
            </div>
            {error ? (
              <p className="mb-1.5 rounded-[8px] border border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] px-2 py-1 text-[10px] text-[var(--ce-danger-text)]">
                {error}
              </p>
            ) : null}
            {inspectorMode === "edit" ? (
              <Textarea
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                disabled={!canEditActiveFile}
                spellCheck={false}
                className={cn(
                  "min-h-[104px] flex-1 resize-none rounded-[8px] font-mono text-[11px] leading-4 focus-visible:ring-violet-300/35",
                  contextEditorTextareaClassName
                )}
                placeholder={isLoadingFile ? "Loading context file..." : "Write context file content"}
              />
            ) : isLoadingFile && !content && !savedContent ? (
              <LoadingFilePreview />
            ) : (
              <CodePreview content={buildInjectedPreviewContent(file, content || savedContent)} />
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-[var(--ce-border-subtle)] px-3 py-2">
            {inspectorMode === "edit" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 min-w-0 rounded-[7px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-2 text-[11px] text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-7"
                  disabled={!hasUnsavedFileChanges || isSavingFile}
                  onClick={onRevertFile}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Revert
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 min-w-0 rounded-[7px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-2 text-[11px] text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-7"
                  onClick={onOpenExpandedFile}
                >
                  <Maximize2 className="mr-1 h-3 w-3" />
                  Open
                </Button>
                <Button
                  type="button"
                  className="h-9 min-w-0 rounded-[7px] bg-violet-600 px-2 text-[11px] text-white hover:bg-violet-500 sm:h-7"
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
                  className="h-9 min-w-0 rounded-[7px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-2 text-[11px] text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-7"
                  disabled={!file.editable}
                  onClick={onEdit}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 min-w-0 rounded-[7px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-2 text-[11px] text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-7"
                  onClick={onOpenExpandedFile}
                >
                  <Maximize2 className="mr-1 h-3 w-3" />
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-9 min-w-0 rounded-[7px] border border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] px-2 text-[11px] text-[var(--ce-danger-text)] hover:brightness-95 sm:h-7"
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

function ExpandedFileEditorDialog({
  surfaceTheme,
  open,
  onOpenChange,
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
  surfaceTheme: ContextEngineSurfaceTheme;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const previewContent = file ? buildInjectedPreviewContent(file, content || savedContent) : "";

  return (
    <Dialog open={open && Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent
        style={contextEngineThemeStyles[surfaceTheme]}
        overlayClassName="bg-black/70 backdrop-blur-md"
        closeClassName="right-3 top-3 z-20 h-9 w-9 text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] hover:text-[var(--ce-text-strong)] sm:h-8 sm:w-8"
        className="grid h-[100dvh] max-h-[100dvh] w-screen max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none border-x-0 border-y border-[var(--ce-border)] bg-[image:var(--ce-surface)] p-0 text-[var(--ce-text)] shadow-[0_24px_90px_rgba(0,0,0,0.45)] sm:h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-24px)] sm:w-[calc(100vw-24px)] sm:rounded-[14px] sm:border lg:h-[min(calc(100dvh-56px),820px)] lg:max-h-[calc(100dvh-56px)] lg:w-[min(calc(100vw-40px),1120px)]"
      >
        <DialogHeader className="space-y-0 border-b border-[var(--ce-border-subtle)] px-4 py-3 pr-12">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <FileText className="h-4 w-4 shrink-0 text-[var(--ce-accent)]" />
              <div className="min-w-0">
                <DialogTitle className="truncate text-sm font-semibold leading-5 text-[var(--ce-text-strong)]">
                  {file?.label ?? "Context file"}
                </DialogTitle>
                <DialogDescription className="truncate font-mono text-[10px] leading-4 text-[var(--ce-text-subtle)]">
                  {file?.path ?? "No file selected"}
                </DialogDescription>
              </div>
            </div>
            {file ? (
              <div className="hidden shrink-0 items-center gap-2 sm:flex">
                <StatusBadge status={file.status} compact />
                <span className="rounded-full border border-[var(--ce-border-subtle)] bg-[var(--ce-panel)] px-2 py-1 text-[10px] capitalize text-[var(--ce-text)]">
                  {file.scope}
                </span>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 gap-0 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden border-r border-[var(--ce-border-subtle)] bg-[var(--ce-panel)] p-4 lg:block">
            {file ? (
              <div className="space-y-3">
                <div className="grid gap-2 text-[11px] leading-4">
                  <CompactInspectorItem label="Raw tokens">
                    <InspectorValue value={file.rawTokens == null ? "Unknown" : formatTokenValue(file.rawTokens)} source={file.tokenSource} compact />
                  </CompactInspectorItem>
                  <CompactInspectorItem label="Injected">
                    <InspectorValue value={file.injectedTokens == null ? "Unknown" : formatTokenValue(file.injectedTokens)} source={file.tokenSource} compact />
                  </CompactInspectorItem>
                  <CompactInspectorItem label="Updated">
                    <span className="text-[var(--ce-text-strong)]">{formatRelativeTime(file.lastUpdatedAt)}</span>
                  </CompactInspectorItem>
                  <CompactInspectorItem label="Preference">
                    <span className="text-[var(--ce-text-strong)]">{formatPreferenceSource(file)}</span>
                  </CompactInspectorItem>
                  <CompactInspectorItem label="Runtime source">
                    <span className="text-[var(--ce-text-strong)]">{formatRuntimeInclusionSource(file)}</span>
                  </CompactInspectorItem>
                  <CompactInspectorItem label="Editable">
                    <span className={file.editable ? "text-[var(--ce-success-text)]" : "text-[var(--ce-text-muted)]"}>
                      {file.editable ? "Yes" : "Read only"}
                    </span>
                  </CompactInspectorItem>
                </div>
                {file.statusReason ? (
                  <p className="rounded-[8px] border border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] px-2 py-1.5 text-[10px] leading-[15px] text-[var(--ce-warning-text)]">
                    {file.statusReason}
                  </p>
                ) : null}
                {hasUnsavedFileChanges ? (
                  <p className="rounded-[8px] border border-[var(--ce-accent-strong)] bg-[var(--ce-accent-soft)] px-2 py-1.5 text-[10px] leading-[15px] text-[var(--ce-accent)]">
                    Unsaved file edits are only written when Save File succeeds.
                  </p>
                ) : null}
              </div>
            ) : null}
          </aside>

          <section className="flex min-h-0 flex-col p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[var(--ce-text-strong)]">{inspectorMode === "edit" ? "Edit file" : "Preview injected content"}</p>
                <p className="mt-0.5 hidden text-[11px] text-[var(--ce-text-subtle)] sm:block">
                  {inspectorMode === "edit" ? "Changes use the same safe file validation as the compact inspector." : "Preview includes the metadata wrapper AgentOS shows for this context file."}
                </p>
              </div>
              {isLoadingFile ? <Loader2 className="h-4 w-4 animate-spin text-[var(--ce-text-subtle)]" /> : null}
            </div>
            {error ? (
              <p className="mb-3 rounded-[8px] border border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] px-2.5 py-2 text-[11px] text-[var(--ce-danger-text)]">
                {error}
              </p>
            ) : null}
            {inspectorMode === "edit" ? (
              <Textarea
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                disabled={!canEditActiveFile}
                spellCheck={false}
                className={cn(
                  "min-h-0 flex-1 resize-none rounded-[9px] p-3 font-mono text-xs leading-5 focus-visible:ring-violet-300/35",
                  contextEditorTextareaClassName
                )}
                placeholder={isLoadingFile ? "Loading context file..." : "Write context file content"}
              />
            ) : isLoadingFile && !content && !savedContent ? (
              <LoadingFilePreview className="min-h-0 flex-1" />
            ) : (
              <CodePreview
                content={previewContent}
                className="min-h-0 flex-1 p-3 text-xs leading-5"
                lineLimit={Number.POSITIVE_INFINITY}
              />
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-[var(--ce-border-subtle)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:py-3">
          <div className="flex w-full items-center justify-between gap-3">
            <div className="hidden min-w-0 text-[11px] text-[var(--ce-text-subtle)] sm:block">
              {file ? (
                <span className="truncate">
                  {hasUnsavedFileChanges ? "Unsaved changes" : "No unsaved changes"} · {file.enabled ? "Enabled" : "Disabled"}
                </span>
              ) : null}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
              <Button
                type="button"
                variant="secondary"
                className="h-10 rounded-[8px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 text-xs text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-8"
                disabled={!hasUnsavedFileChanges || isSavingFile}
                onClick={onRevertFile}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Revert
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-10 rounded-[8px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 text-xs text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)] sm:h-8"
                disabled={inspectorMode === "preview" && !file?.editable}
                onClick={inspectorMode === "edit" ? onPreview : onEdit}
              >
                {inspectorMode === "edit" ? <Eye className="mr-1.5 h-3.5 w-3.5" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
                {inspectorMode === "edit" ? "Preview" : "Edit"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-10 rounded-[8px] border border-[var(--ce-danger-border)] bg-[var(--ce-danger-bg)] px-3 text-xs text-[var(--ce-danger-text)] hover:brightness-95 sm:h-8"
                disabled={!file?.canToggle || !file.enabled}
                onClick={onExclude}
              >
                <Ban className="mr-1.5 h-3.5 w-3.5" />
                Exclude
              </Button>
              <Button
                type="button"
                className="h-10 rounded-[8px] bg-violet-600 px-3 text-xs text-white hover:bg-violet-500 sm:h-8"
                disabled={!hasUnsavedFileChanges || !canEditActiveFile || isSavingFile}
                onClick={onSaveFile}
              >
                {isSavingFile ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save File
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      <div className="flex h-full items-center justify-center gap-2 rounded-[10px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel)] text-[var(--ce-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading context data
      </div>
    );
  }

  if (tab === "overview") {
    return (
      <InfoPanel title="Overview" subtitle="Current agent, workspace, model, and runtime report state.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          <OverviewMetric label="Agent" value={snapshot ? formatAgentDisplayName(snapshot.agent) : "Unknown"} />
          <OverviewMetric label="Workspace" value={snapshot?.workspace.name ?? "Unknown"} detail={snapshot?.workspace.path ? compactPath(snapshot.workspace.path) : undefined} />
          <OverviewMetric label="Model" value={snapshot?.model.label ?? "Unknown"} detail={snapshot?.model.provider ?? undefined} />
          <OverviewMetric label="Runtime report" value={snapshot?.runtimeReport.status === "exact" ? "Exact" : "Degraded"} detail={snapshot?.runtimeReport.source.replace(/-/g, " ")} />
          <OverviewMetric
            label="Preferences"
            value={formatConfigurationPersistence(snapshot)}
            detail={snapshot?.configuration.storagePath}
          />
        </div>
        <DiagnosticsList
          diagnostics={[
            ...(snapshot?.configuration.persistenceWarning ? [snapshot.configuration.persistenceWarning] : []),
            ...(snapshot?.diagnostics ?? [])
          ]}
        />
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
    <InfoPanel title="Effective Context" subtitle="What AgentOS can verify about the next model context, grouped by source of truth.">
      <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
        <div className="grid gap-2 sm:grid-cols-2">
          {(snapshot?.effectiveContext.sections ?? []).map((section) => (
            <EffectiveContextSectionCard key={section.id} section={section} />
          ))}
        </div>
        <div className="rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-3">
          <p className="text-xs font-medium text-[var(--ce-text-strong)]">Effective context total</p>
          <p className="mt-2 text-2xl font-semibold text-[var(--ce-text-strong)]">{formatTokenValue(snapshot?.preview.totalTokens ?? null)}</p>
          <p className="mt-1.5 text-xs text-[var(--ce-text-muted)]">
            {snapshot?.effectiveContext.status === "exact" ? "Exact OpenClaw context report" : "Estimated by AgentOS from available metadata"}
          </p>
          <DiagnosticsList diagnostics={snapshot?.effectiveContext.diagnostics ?? []} />
        </div>
      </div>
    </InfoPanel>
  );
}

function EffectiveContextSectionCard({ section }: { section: ContextEngineEffectiveContextSection }) {
  return (
    <div className="min-w-0 rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-[var(--ce-text-strong)]">{section.label}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--ce-text-subtle)]">{formatEffectiveContextSource(section.source)}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]", effectiveContextStatusClassName(section.status))}>
          {section.status}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--ce-text)]">{section.detail}</p>
      {section.items.length > 0 ? (
        <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
          {section.items.slice(0, 8).map((item) => (
            <li key={item} className="truncate rounded-[7px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel)] px-2 py-1 font-mono text-[10px] text-[var(--ce-text)]" title={item}>
              {item}
            </li>
          ))}
          {section.items.length > 8 ? (
            <li className="px-2 text-[10px] text-[var(--ce-text-subtle)]">+{section.items.length - 8} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function formatEffectiveContextSource(source: ContextEngineEffectiveContextSection["source"]) {
  switch (source) {
    case "openclaw-report":
      return "OpenClaw report";
    case "agentos-sidecar":
      return "AgentOS sidecar";
    case "agentos-estimate":
      return "AgentOS estimate";
    case "unsupported":
      return "Unsupported";
  }
}

function effectiveContextStatusClassName(status: ContextEngineEffectiveContextSection["status"]) {
  switch (status) {
    case "exact":
      return "border-[var(--ce-success-border)] bg-[var(--ce-success-bg)] text-[var(--ce-success-text)]";
    case "estimated":
      return "border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] text-[var(--ce-warning-text)]";
    case "unavailable":
      return "border-[var(--ce-neutral-border)] bg-[var(--ce-neutral-bg)] text-[var(--ce-neutral-text)]";
  }
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
        "inline-flex h-5 items-center gap-1 rounded-[6px] border bg-[var(--ce-panel)] px-2 text-[10px] font-medium",
        tone === "violet" && "border-[var(--ce-accent-strong)] text-[var(--ce-accent)]",
        tone === "blue" && "border-[var(--ce-border)] text-[var(--ce-blue)]",
        tone === "amber" && "border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] text-[var(--ce-warning-text)]",
        tone === "muted" && "border-[var(--ce-border)] text-[var(--ce-text-muted)]"
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
      className="h-8 rounded-[8px] border-[var(--ce-border)] bg-[var(--ce-panel)] px-3 text-xs text-[var(--ce-text-strong)] hover:bg-[var(--ce-panel-hover)]"
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
        danger
          ? "text-[var(--ce-danger-text)] hover:bg-[var(--ce-danger-bg)]"
          : "text-[var(--ce-text)] hover:bg-[var(--ce-panel-hover)]"
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function LoadingFilePreview({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-[104px] flex-1 items-center justify-center gap-2 rounded-[8px] border border-[var(--ce-border)] bg-[var(--ce-panel-strong)] p-2.5 text-[11px] leading-4 text-[var(--ce-text-muted)]",
        className
      )}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading context file
    </div>
  );
}

function CodePreview({
  content,
  className,
  lineLimit = 12
}: {
  content: string;
  className?: string;
  lineLimit?: number;
}) {
  const lines = (content || "No preview content is available.").split("\n").slice(0, lineLimit);

  return (
    <div
      className={cn(
        "min-h-[104px] flex-1 overflow-auto rounded-[8px] border border-[var(--ce-border)] bg-[var(--ce-panel-strong)] p-2.5 font-mono text-[11px] leading-4 text-[var(--ce-text)]",
        className
      )}
    >
      {lines.map((line, index) => (
        <div key={`${index}:${line}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
          <span className="select-none text-right text-[var(--ce-text-subtle)]">{index + 1}</span>
          <span className={cn(lineLimit <= 12 ? "truncate" : "whitespace-pre-wrap break-words", index === 0 && "text-[var(--ce-accent)]")}>
            {line || " "}
          </span>
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
    <section className="min-h-full rounded-[10px] border border-[var(--ce-border)] bg-[var(--ce-panel)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] sm:p-4 lg:h-full">
      <h3 className="text-sm font-semibold text-[var(--ce-text-strong)] sm:text-base">{title}</h3>
      <p className="mt-1 text-xs text-[var(--ce-text-muted)]">{subtitle}</p>
      <div className="mt-3 sm:mt-4">{children}</div>
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
    <div className="rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ce-text-subtle)]">{label}</p>
      <p className="mt-1.5 truncate text-base font-semibold text-[var(--ce-text-strong)]">{value}</p>
      {detail ? <p className="mt-1 truncate text-xs text-[var(--ce-text-subtle)]">{detail}</p> : null}
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <CapabilityList title={leftTitle} values={leftValues} />
      <CapabilityList title={rightTitle} values={rightValues} />
    </div>
  );
}

function CapabilityList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-3">
      <p className="text-xs font-medium text-[var(--ce-text-strong)]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge key={value} className="rounded-[7px] border-[var(--ce-border-subtle)] bg-[var(--ce-panel)] text-[10px] text-[var(--ce-text)]">
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-[var(--ce-text-subtle)]">No values available.</span>
        )}
      </div>
    </div>
  );
}

function FileSummaryList({ files, empty }: { files: ContextEngineFile[]; empty: string }) {
  if (files.length === 0) {
    return <p className="mt-2 rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-3 text-xs text-[var(--ce-text-subtle)]">{empty}</p>;
  }

  return (
    <div className="mt-2 divide-y divide-white/[0.06] rounded-[9px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)]">
      {files.map((file) => (
        <div key={file.path} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
          <span className="truncate text-[var(--ce-text)]">{file.path}</span>
          <span className="shrink-0 text-[var(--ce-text-subtle)]">{formatTokenValue(file.injectedTokens)} tokens</span>
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
        <p key={diagnostic} className="rounded-[9px] border border-[var(--ce-warning-border)] bg-[var(--ce-warning-bg)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--ce-warning-text)]">
          {diagnostic}
        </p>
      ))}
    </div>
  );
}

function UnavailableState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--ce-border-subtle)] bg-[var(--ce-panel-strong)] p-4 sm:p-6">
      <p className="text-sm font-medium text-[var(--ce-text-strong)] sm:text-base">{title}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--ce-text-muted)] sm:text-sm sm:leading-6">{detail}</p>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-medium text-[var(--ce-text)]">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--ce-text-subtle)]">{detail}</p>
    </div>
  );
}

function CompactInspectorItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] items-center gap-1">
      <span className="text-[var(--ce-text-subtle)]">{label}</span>
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
    <span className="text-[var(--ce-text-strong)]">
      {value}
      {source !== "reported" ? (
        <span className={cn("uppercase text-[var(--ce-text-subtle)]", compact ? "ml-1 text-[8px] tracking-[0.08em]" : "ml-2 text-[10px] tracking-[0.12em]")}>
          {source}
        </span>
      ) : null}
    </span>
  );
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
    return "text-[var(--ce-accent)]";
  }
  if (id === "project") {
    return "text-[var(--ce-blue)]";
  }
  if (id === "skills") {
    return "text-[var(--ce-success-text)]";
  }
  if (id === "tools") {
    return "text-[var(--ce-warning-text)]";
  }
  if (id === "history") {
    return "text-[var(--ce-blue)]";
  }
  return "text-[var(--ce-accent)]";
}

function formatContextUsage(snapshot: ContextEngineSnapshot | null) {
  if (!snapshot || snapshot.budget.usedPercent == null) {
    return "Unknown context used";
  }

  return `${snapshot.budget.usedPercent}% context used`;
}

function formatConfigurationPersistence(snapshot: ContextEngineSnapshot | null) {
  if (!snapshot) {
    return "Preferences unknown";
  }

  switch (snapshot.configuration.persistenceStatus) {
    case "loaded":
      return "AgentOS preferences loaded";
    case "recovered":
      return "Preferences recovered";
    case "missing":
    default:
      return "Default preferences";
  }
}

function formatPreferenceSource(file: ContextEngineFile) {
  return file.preferenceSource === "agentos-sidecar" ? "AgentOS sidecar" : "Default";
}

function formatRuntimeInclusionSource(file: ContextEngineFile) {
  return file.runtimeInclusionSource === "openclaw-report" ? "OpenClaw reported" : "Not reported";
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
