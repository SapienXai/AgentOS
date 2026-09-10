"use client";

import {
  Bot,
  Check,
  ChevronLeft,
  CircleAlert,
  FileText,
  FolderOpen,
  Github,
  Globe,
  Link2,
  LoaderCircle,
  MessageCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  MissionControlDialogShell,
  missionControlDialogButtonClassName,
  missionControlDialogControlClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createWorkspaceKnowledgeSource,
  WORKSPACE_KNOWLEDGE_FILE_ACCEPT,
  type WorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import type { WorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import type {
  WorkspaceArchitectResult,
  WorkspaceBlueprintFreshnessResult
} from "@/lib/agentos/domains/workspace-blueprint";
import {
  formatWorkspaceChannelSetup,
  formatWorkspaceSchedule,
  formatWorkspaceSourceKind,
  presentWorkspaceBlueprint,
  type WorkspaceBlueprintReviewModel
} from "@/lib/agentos/ui/workspace-create-presenter";

type SurfaceTheme = "dark" | "light";
type CreateStage = "intake" | "generating" | "review";
type ContextAction = "website" | "github" | "connect" | null;
type SourceDraft = { kind: "website" | "repository"; value: string };
type ContextSourceStatus = "attached" | "reading" | "ready" | "partial" | "error" | "unsupported";
type ContextSourceState = {
  status: ContextSourceStatus;
  warning?: string;
  storedDocuments?: number;
};
type UploadGroup = { sourceId: string; files: File[] };
type ContextStageResult = {
  draftContextId: string;
  generationId: string | null;
  runStatus: "ready" | "partial" | "error" | "cancelled" | "reused";
  reused: boolean;
  sourceReports: Array<{
    sourceId: string;
    status: ContextSourceStatus;
    storedDocuments: number;
    warnings: string[];
    error: string | null;
  }>;
  warnings: string[];
};

type CreateWorkspaceExperienceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceTheme: SurfaceTheme;
};

const progressLabels = [
  "Staging project context",
  "Reading supplied sources",
  "Designing the workspace",
  "Preparing the blueprint"
];

type ProgressChipState = "pending" | "active" | "done";

type ProgressChip = {
  label: string;
  step: number;
};

export function CreateWorkspaceExperience({
  open,
  onOpenChange,
  surfaceTheme
}: CreateWorkspaceExperienceProps) {
  const isLight = surfaceTheme === "light";
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<"automatic" | "customize">("automatic");
  const [constraints, setConstraints] = useState("");
  const [sources, setSources] = useState<WorkspaceKnowledgeSource[]>([]);
  const [sourceStates, setSourceStates] = useState<Record<string, ContextSourceState>>({});
  const [uploadGroups, setUploadGroups] = useState<UploadGroup[]>([]);
  const [draftContextId, setDraftContextId] = useState<string | null>(null);
  const [contextDirty, setContextDirty] = useState(false);
  const [materialization, setMaterialization] = useState<WorkspaceMaterialization>({ mode: "empty" });
  const [stage, setStage] = useState<CreateStage>("intake");
  const [progressStep, setProgressStep] = useState(0);
  const [result, setResult] = useState<WorkspaceArchitectResult | null>(null);
  const [freshness, setFreshness] = useState<WorkspaceBlueprintFreshnessResult | null>(null);
  const [contextAction, setContextAction] = useState<ContextAction>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>({ kind: "website", value: "" });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "warning" | "error" | "muted"; title: string; description: string } | null>(null);
  const [revisionValue, setRevisionValue] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrimaryName, setCustomPrimaryName] = useState("");
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const review = useMemo(
    () => (result ? presentWorkspaceBlueprint(result) : null),
    [result]
  );

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      setBrief("");
      setMode("automatic");
      setConstraints("");
      setSources([]);
      setSourceStates({});
      setUploadGroups([]);
      setDraftContextId(null);
      setContextDirty(false);
      setMaterialization({ mode: "empty" });
      setStage("intake");
      setProgressStep(0);
      setResult(null);
      setFreshness(null);
      setContextAction(null);
      setSourceDraft({ kind: "website", value: "" });
      setSourceError(null);
      setNotice(null);
      setRevisionValue("");
      setRevisionError(null);
      setIsCustomizing(false);
    }
  }, [open]);

  useEffect(() => {
    if (stage !== "generating") return;
    const interval = window.setInterval(() => {
      setProgressStep((current) => Math.min(current + 1, progressLabels.length - 1));
    }, 2_400);
    return () => window.clearInterval(interval);
  }, [stage]);

  const markContextChanged = () => {
    setContextDirty(true);
    if (result) {
      const currentFreshness = freshness ?? result.freshness;
      setFreshness({
        blueprintGenerationId: currentFreshness.blueprintGenerationId,
        currentGenerationId: currentFreshness.currentGenerationId,
        status: "stale",
        reason: "Project context changed after this blueprint was produced."
      });
    }
  };

  const stageContext = async (controller: AbortController): Promise<ContextStageResult | null> => {
    if (!contextDirty && draftContextId) return null;
    if (!sources.length && !draftContextId) return null;

    setProgressStep(0);
    setSourceStates((current) => Object.fromEntries(sources.map((source) => [source.id, { ...current[source.id], status: "reading" as const }])));
    const formData = new FormData();
    if (draftContextId) formData.set("draftContextId", draftContextId);
    formData.set("sources", JSON.stringify(sources));
    const manifest: Array<{ sourceId: string; relativePath: string; fileName: string }> = [];
    for (const group of uploadGroups) {
      for (const file of group.files) {
        const relativePath = file.webkitRelativePath || file.name;
        manifest.push({ sourceId: group.sourceId, relativePath, fileName: file.name });
        formData.append("files", file, file.name);
      }
    }
    formData.set("uploadManifest", JSON.stringify(manifest));
    const response = await fetch("/api/workspaces/context", {
      method: "POST",
      body: formData,
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => null)) as ContextStageResult & { error?: string } | null;
    if (!response.ok || !payload?.draftContextId) throw new Error(payload?.error || "AgentOS could not read the project context.");
    setDraftContextId(payload.draftContextId);
    setSourceStates(Object.fromEntries(payload.sourceReports.map((report) => [report.sourceId, {
      status: report.status,
      warning: report.error || report.warnings[0],
      storedDocuments: report.storedDocuments
    }])));
    if (payload.runStatus === "cancelled") throw new DOMException("Context staging was cancelled.", "AbortError");
    setContextDirty(false);
    return payload;
  };

  const generate = async () => {
    const nextBrief = brief.trim();
    if (!nextBrief || stage === "generating") return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStage("generating");
    setProgressStep(0);
    setNotice(null);
    setRevisionError(null);

    try {
      const stagedContext = await stageContext(controller);
      if (stagedContext) setProgressStep(2);
      const stagedDraftContextId = stagedContext?.draftContextId ?? draftContextId;
      const response = await fetch("/api/workspaces/architect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          brief: nextBrief,
          mode: mode === "automatic" ? "automatic" : "review",
          operatorConstraints: constraints
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          materialization,
          ...(stagedDraftContextId ? { draftContextId: stagedDraftContextId } : {})
        })
      });
      const payload = (await response.json().catch(() => null)) as WorkspaceArchitectResult & { error?: string } | null;
      if (!response.ok || !payload?.blueprint) {
        throw new Error(payload?.error || "AgentOS could not design the workspace.");
      }

      setResult(payload);
      setFreshness(payload.freshness);
      setContextDirty(false);
      setStage("review");
      setRevisionValue("");
      setIsCustomizing(false);
      setCustomName(payload.blueprint.identity.name);
      setCustomPrimaryName(payload.blueprint.workforce.primaryAgent.name);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setStage("intake");
        setNotice({
          tone: "warning",
          title: "Generation cancelled",
          description: "Your brief and context are still here when you are ready to try again."
        });
        return;
      }

      setStage("intake");
      setNotice({
        tone: "error",
        title: "Architect temporarily unavailable",
        description: error instanceof Error ? error.message : "Try again without losing your project context."
      });
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  };

  const cancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  const revise = async () => {
    if (!result || !revisionValue.trim() || isRevising) return;

    setIsRevising(true);
    setRevisionError(null);
    try {
      const response = await fetch("/api/workspaces/architect/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprint: result.blueprint,
          ...(draftContextId ? { draftContextId } : {}),
          instruction: revisionValue.trim(),
          operatorConstraints: constraints
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        })
      });
      const payload = (await response.json().catch(() => null)) as WorkspaceArchitectResult & { error?: string } | null;
      if (!response.ok || !payload?.blueprint) {
        throw new Error(payload?.error || "AgentOS could not revise the workspace draft.");
      }

      setResult(payload);
      setFreshness(payload.freshness);
      setRevisionValue("");
      setCustomName(payload.blueprint.identity.name);
      setCustomPrimaryName(payload.blueprint.workforce.primaryAgent.name);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The revision could not be applied.");
    } finally {
      setIsRevising(false);
    }
  };

  const saveCustomization = async () => {
    if (!result || isSavingCustomization) return;
    const nextName = customName.trim();
    const nextPrimaryName = customPrimaryName.trim();
    if (!nextName || !nextPrimaryName) return;

    setIsSavingCustomization(true);
    setRevisionError(null);
    try {
      const response = await fetch("/api/workspaces/architect/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprint: result.blueprint,
          ...(draftContextId ? { draftContextId } : {}),
          operatorEdits: {
            identity: { name: nextName },
            workforce: { primaryAgent: { name: nextPrimaryName } }
          },
        })
      });
      const payload = (await response.json().catch(() => null)) as WorkspaceArchitectResult & { error?: string } | null;
      if (!response.ok || !payload?.blueprint) {
        throw new Error(payload?.error || "The workspace edits could not be saved.");
      }

      setResult(payload);
      setFreshness(payload.freshness);
      setIsCustomizing(false);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The workspace edits could not be saved.");
    } finally {
      setIsSavingCustomization(false);
    }
  };

  const addUrlSource = () => {
    const value = sourceDraft.value.trim();
    if (!value) {
      setSourceError("Add a URL first.");
      return;
    }

    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      setSourceError("Use a valid http or https URL.");
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      setSourceError("Use a valid http or https URL.");
      return;
    }

    if (sourceDraft.kind === "repository" && !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      setSourceError("Add a GitHub repository URL.");
      return;
    }

    if (sourceDraft.kind === "repository" && url.pathname.split("/").filter(Boolean).length < 2) {
      setSourceError("Add a GitHub repository URL.");
      return;
    }

    const kind = sourceDraft.kind;
    const label = kind === "repository" ? url.pathname.replace(/^\/+|\/+$/g, "") || "GitHub repository" : url.hostname;
    const source = createWorkspaceKnowledgeSource({
      id: `${kind}-${slugify(label)}-${Date.now()}`,
      kind,
      label,
      summary: kind === "repository" ? "User-selected GitHub repository source." : "User-selected website source.",
      locator: kind === "repository" ? { kind: "repository", remoteUrl: url.toString() } : { kind: "website", url: url.toString() },
      provenance: "operator"
    });
    setSources((current) => [...current, source]);
    setSourceStates((current) => ({ ...current, [source.id]: { status: "attached" } }));
    if (kind === "repository") setMaterialization({ mode: "clone", repoUrl: url.toString() });
    setContextAction(null);
    setSourceDraft({ kind: "website", value: "" });
    setSourceError(null);
    markContextChanged();
  };

  const handleFiles = (fileList: FileList | null, kind: "file" | "folder") => {
    if (!fileList?.length) return;
    const files = Array.from(fileList).slice(0, kind === "folder" ? 120 : 12);
    const folderName = files[0]?.webkitRelativePath?.split("/")[0] || files[0]?.name || "Local project";
    const source = createWorkspaceKnowledgeSource({
      id: `${kind}-${slugify(folderName)}-${Date.now()}`,
      kind,
      label: kind === "folder" ? folderName : files.length === 1 ? files[0].name : `${files.length} project files`,
      summary: kind === "folder" ? `${files.length} local project files attached for reading.` : `${files.length} project file${files.length === 1 ? "" : "s"} attached for reading.`,
      locator: { kind, path: `upload:${kind}-${Date.now()}` },
      provenance: "operator"
    });
    setSources((current) => [...current, source]);
    setSourceStates((current) => ({ ...current, [source.id]: { status: "attached" } }));
    setUploadGroups((current) => [...current, { sourceId: source.id, files }]);
    setContextAction(null);
    markContextChanged();
  };

  const removeSource = (sourceId: string) => {
    setSources((current) => current.filter((source) => source.id !== sourceId));
    setSourceStates((current) => { const next = { ...current }; delete next[sourceId]; return next; });
    setUploadGroups((current) => current.filter((group) => group.sourceId !== sourceId));
    const removed = sources.find((source) => source.id === sourceId);
    if (removed?.locator.kind === "repository" && materialization.mode === "clone" && removed.locator.remoteUrl === materialization.repoUrl) {
      setMaterialization({ mode: "empty" });
    }
    markContextChanged();
  };

  const reviewModel = review
    ? {
        ...review,
        freshness: freshness ?? review.freshness
      }
    : null;

  const title = stage === "review" ? (reviewModel?.fallback ? "Basic draft created" : "Workspace ready") : "Create Workspace";
  const description = stage === "review"
    ? "Review the workspace AgentOS designed from your project."
    : "Give AgentOS the project. It will understand the rest.";

  return (
    <MissionControlDialogShell
      open={open}
      onOpenChange={onOpenChange}
      surfaceTheme={surfaceTheme}
      title={title}
      description={description}
      icon={stage === "review" ? Bot : Sparkles}
      chips={stage === "review" ? <Badge variant={reviewModel?.fallback ? "warning" : "success"}>{reviewModel?.fallback ? "Draft" : "Review"}</Badge> : null}
      contentClassName="left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen transform-none rounded-none border-x-0 md:left-1/2 md:top-1/2 md:h-[min(calc(100vh-72px),780px)] md:max-h-[calc(100vh-72px)] md:w-[min(92vw,900px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border-x"
      headerClassName="px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-7 md:pb-4 md:pt-5"
      bodyClassName="p-0 overflow-hidden"
      footerClassName="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:px-7 md:py-4"
      footerInnerClassName="p-0"
      footer={
        stage === "generating" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <span className={cn("text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>AgentOS is designing the first draft.</span>
            <Button type="button" variant="secondary" onClick={cancelGeneration} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>
              Cancel
            </Button>
          </div>
        ) : stage === "review" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStage("intake")} className={cn("h-9 px-2 text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>
              <ChevronLeft className="mr-1.5 h-4 w-4" />
              Back to brief
            </Button>
            <div className="flex flex-col items-end gap-1">
              <span className={cn("text-[10px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>Final creation is a Phase 6 action.</span>
              <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={() => setIsCustomizing((current) => !current)} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Customize
              </Button>
              <Button
                type="button"
                disabled
                title="Final workspace provisioning will be added in Phase 6."
                aria-label="Create Workspace is not available until provisioning is implemented"
                className={missionControlDialogButtonClassName("primary", surfaceTheme)}
              >
                Create Workspace
              </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full items-center justify-end gap-3">
            <Button
              type="button"
              disabled={!brief.trim()}
              onClick={() => void generate()}
              className={missionControlDialogButtonClassName("primary", surfaceTheme) + " h-10 px-4 text-sm"}
            >
              <WandSparkles className="mr-2 h-4 w-4" />
              Generate Workspace
            </Button>
          </div>
        )
      }
    >
      <div className={cn("min-h-0 h-full overflow-y-auto", isLight ? "bg-[#fbf8f3]" : "bg-[linear-gradient(180deg,rgba(10,14,25,0.96),rgba(5,8,16,0.98))")}>
        {stage === "intake" ? (
          <IntakeView
            isLight={isLight}
            brief={brief}
            setBrief={setBrief}
            mode={mode}
            setMode={setMode}
            constraints={constraints}
            setConstraints={setConstraints}
            sources={sources}
            sourceStates={sourceStates}
            contextAction={contextAction}
            setContextAction={(next) => { setContextAction(next); setSourceError(null); setSourceDraft({ kind: next === "github" ? "repository" : "website", value: "" }); }}
            sourceDraft={sourceDraft}
            setSourceDraft={setSourceDraft}
            sourceError={sourceError}
            addUrlSource={addUrlSource}
            onBrowseFiles={() => fileInputRef.current?.click()}
            onBrowseFolder={() => folderInputRef.current?.click()}
            onConnect={() => setContextAction("connect")}
            onRemoveSource={removeSource}
            onFiles={(files) => void handleFiles(files, "file")}
            onFolder={(files) => void handleFiles(files, "folder")}
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            notice={notice}
          />
        ) : stage === "generating" ? (
          <GeneratingView isLight={isLight} activeStep={progressStep} sources={sources} brief={brief} />
        ) : (
          <ReviewView
            isLight={isLight}
            model={reviewModel}
            revisionValue={revisionValue}
            setRevisionValue={setRevisionValue}
            onRevise={() => void revise()}
            isRevising={isRevising}
            revisionError={revisionError}
            onRetry={() => { setStage("intake"); void generate(); }}
            isCustomizing={isCustomizing}
            customName={customName}
            setCustomName={setCustomName}
            customPrimaryName={customPrimaryName}
            setCustomPrimaryName={setCustomPrimaryName}
            onCloseCustomization={() => setIsCustomizing(false)}
            onSaveCustomization={() => void saveCustomization()}
            isSavingCustomization={isSavingCustomization}
          />
        )}
      </div>
    </MissionControlDialogShell>
  );
}

function IntakeView({
  isLight,
  brief,
  setBrief,
  mode,
  setMode,
  constraints,
  setConstraints,
  sources,
  sourceStates,
  contextAction,
  setContextAction,
  sourceDraft,
  setSourceDraft,
  sourceError,
  addUrlSource,
  onBrowseFiles,
  onBrowseFolder,
  onConnect,
  onRemoveSource,
  onFiles,
  onFolder,
  fileInputRef,
  folderInputRef,
  notice
}: {
  isLight: boolean;
  brief: string;
  setBrief: (value: string) => void;
  mode: "automatic" | "customize";
  setMode: (mode: "automatic" | "customize") => void;
  constraints: string;
  setConstraints: (value: string) => void;
  sources: WorkspaceKnowledgeSource[];
  sourceStates: Record<string, ContextSourceState>;
  contextAction: ContextAction;
  setContextAction: (action: ContextAction) => void;
  sourceDraft: SourceDraft;
  setSourceDraft: (draft: SourceDraft) => void;
  sourceError: string | null;
  addUrlSource: () => void;
  onBrowseFiles: () => void;
  onBrowseFolder: () => void;
  onConnect: () => void;
  onRemoveSource: (sourceId: string) => void;
  onFiles: (files: FileList | null) => void;
  onFolder: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  notice: { tone: "warning" | "error" | "muted"; title: string; description: string } | null;
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[820px] flex-col justify-center px-5 py-8 md:px-12 md:py-14">
      <div className="mb-8 text-center md:mb-10">
        <p className={cn("text-[10px] font-semibold uppercase tracking-[0.24em]", isLight ? "text-[#9a7a62]" : "text-violet-300/75")}>Workspace creation</p>
        <h1 className={cn("mt-3 font-display text-3xl font-semibold tracking-[-0.04em] md:text-[2.75rem]", isLight ? "text-[#32271f]" : "text-white")}>What are you working on?</h1>
        <p className={cn("mx-auto mt-3 max-w-xl text-sm leading-6", isLight ? "text-[#786b60]" : "text-slate-400")}>Tell AgentOS about the project. Add context when you have it; the Architect will shape the first useful workspace.</p>
      </div>

      {notice ? (
        <div className={cn("mb-4 rounded-xl border px-4 py-3", notice.tone === "error" ? (isLight ? "border-red-200 bg-red-50 text-red-900" : "border-red-400/20 bg-red-400/10 text-red-100") : notice.tone === "warning" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-400/20 bg-amber-400/10 text-amber-100") : (isLight ? "border-[#e5dbd0] bg-white text-[#65594f]" : "border-white/10 bg-white/[0.04] text-slate-200"))} role="status">
          <p className="text-sm font-medium">{notice.title}</p>
          <p className="mt-1 text-xs opacity-80">{notice.description}</p>
        </div>
      ) : null}

      <Textarea
        autoFocus
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder="Describe the project, business, team, or job you want AgentOS to work on…"
        aria-label="What are you working on?"
        className={cn("min-h-[190px] resize-y rounded-2xl px-5 py-4 text-base leading-7 shadow-none md:min-h-[210px] md:text-[17px]", isLight ? "border-[#ded2c6] bg-white text-[#382d25] placeholder:text-[#aa9a8d] focus-visible:border-[#b8895f] focus-visible:ring-[#b8895f]/20" : "border-white/10 bg-white/[0.055] text-slate-100 placeholder:text-slate-500 focus-visible:border-violet-300/40 focus-visible:ring-violet-300/15")}
      />

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 pb-1" aria-label="Add project context">
        <span className={cn("mr-1 shrink-0 text-xs font-medium", isLight ? "text-[#837366]" : "text-slate-500")}>Add context</span>
        <ContextButton isLight={isLight} icon={Globe} label="Website" onClick={() => setContextAction(contextAction === "website" ? null : "website")} />
        <ContextButton isLight={isLight} icon={Github} label="GitHub" onClick={() => setContextAction(contextAction === "github" ? null : "github")} />
        <ContextButton isLight={isLight} icon={FileText} label="Files" onClick={onBrowseFiles} />
        <ContextButton isLight={isLight} icon={FolderOpen} label="Folder" onClick={onBrowseFolder} />
        <ContextButton isLight={isLight} icon={Link2} label="Connect" onClick={onConnect} />
        <input ref={fileInputRef} type="file" className="hidden" multiple accept={WORKSPACE_KNOWLEDGE_FILE_ACCEPT} onChange={(event) => { onFiles(event.target.files); event.currentTarget.value = ""; }} />
        <input ref={folderInputRef} type="file" className="hidden" multiple accept={WORKSPACE_KNOWLEDGE_FILE_ACCEPT} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(event) => { onFolder(event.target.files); event.currentTarget.value = ""; }} />
      </div>
      <p className={cn("mt-2 text-[11px]", isLight ? "text-[#9b8d80]" : "text-slate-600")}>Supported files: Markdown, text, JSON, YAML, TOML, HTML, XML, CSV, README, and Makefile.</p>

      {contextAction === "website" || contextAction === "github" ? (
        <div className={cn("mt-2 flex gap-2 rounded-xl border p-2", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")}>
          <input
            autoFocus
            value={sourceDraft.value}
            onChange={(event) => setSourceDraft({ ...sourceDraft, value: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Enter") addUrlSource(); }}
            placeholder={contextAction === "github" ? "github.com/owner/repository" : "https://your-project.com"}
            aria-label={contextAction === "github" ? "GitHub repository URL" : "Website URL"}
            className={missionControlDialogControlClassName(isLight ? "border-[#dfd2c6] bg-[#fbf8f3] text-[#382d25] placeholder:text-[#aa9a8d] focus:border-[#b8895f] focus:ring-[#b8895f]/20" : "")}
          />
          <Button type="button" onClick={addUrlSource} className={missionControlDialogButtonClassName("primary", isLight ? "light" : "dark")}>Add</Button>
        </div>
      ) : null}

      {contextAction === "connect" ? (
        <div className={cn("mt-2 flex items-start gap-3 rounded-xl border px-3 py-3 text-xs", isLight ? "border-[#e5dbd0] bg-white text-[#71645a]" : "border-white/10 bg-white/[0.04] text-slate-400")}>
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
          <div className="min-w-0">
            <p className={cn("font-medium", isLight ? "text-[#44372d]" : "text-slate-200")}>Live connections come after the workspace design.</p>
            <p className="mt-1 leading-5">No credentials are requested here. AgentOS will show recommended setup in the review.</p>
          </div>
          <button type="button" onClick={() => setContextAction(null)} className="ml-auto rounded-md p-1 hover:bg-black/5" aria-label="Close connection information"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {sourceError ? <p className="mt-2 text-xs text-red-500" role="alert">{sourceError}</p> : null}

      {sources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Attached context">
          {sources.map((source) => (
            <span key={source.id} className={cn("inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs", isLight ? "border-[#e5dbd0] bg-white text-[#55483e]" : "border-white/10 bg-white/[0.05] text-slate-300")}>
              <span aria-hidden="true">{source.kind === "website" ? "🌐" : source.kind === "repository" ? "◈" : source.kind === "folder" ? "▱" : "▤"}</span>
              <span className="max-w-[220px] truncate" title={source.label}>{source.label}</span>
              <SourceStatusIndicator state={sourceStates[source.id]} />
              <button type="button" onClick={() => onRemoveSource(source.id)} className="ml-0.5 rounded p-0.5 text-current/60 hover:bg-black/5 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${source.label}`}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-7 flex flex-col items-center gap-3">
        <div className={cn("inline-flex rounded-lg border p-1", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.035]")} role="group" aria-label="Architect mode">
          <ModeButton isLight={isLight} active={mode === "automatic"} onClick={() => setMode("automatic")} label="Automatic" />
          <ModeButton isLight={isLight} active={mode === "customize"} onClick={() => setMode("customize")} label="Customize" />
        </div>
        {mode === "customize" ? (
          <div className="w-full max-w-[600px]">
            <label htmlFor="workspace-constraints" className={cn("text-xs font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Specific constraints <span className="font-normal opacity-60">(optional)</span></label>
            <Textarea id="workspace-constraints" value={constraints} onChange={(event) => setConstraints(event.target.value)} placeholder="Anything AgentOS should keep in mind? One constraint per line." className={cn("mt-2 min-h-[84px] resize-y text-sm shadow-none", isLight ? "border-[#ded2c6] bg-white text-[#382d25] placeholder:text-[#aa9a8d]" : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500")} />
          </div>
        ) : (
          <p className={cn("text-center text-xs", isLight ? "text-[#8a7b6e]" : "text-slate-500")}>Automatic chooses the smallest useful architecture from your project.</p>
        )}
      </div>

      <p className={cn("mt-8 text-center text-xs", isLight ? "text-[#9b8d80]" : "text-slate-600")}>Understand <span className="px-1">→</span> Organize <span className="px-1">→</span> Design <span className="px-1">→</span> Review</p>
    </main>
  );
}

function SourceStatusIndicator({ state }: { state?: ContextSourceState }) {
  const status = state?.status ?? "attached";
  const label = status === "ready"
    ? "Context ready"
    : status === "reading"
      ? "Reading context"
      : status === "partial"
        ? "Partially read"
        : status === "unsupported"
          ? "Unsupported format"
          : status === "error"
            ? "Could not read"
            : "Attached; not read yet";
  return (
    <span className="inline-flex items-center gap-1" title={state?.warning || label}>
      {status === "ready" ? <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> : status === "reading" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-violet-400 motion-reduce:animate-none" aria-hidden="true" /> : <CircleAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />}
      <span className="text-[10px] opacity-70">{status === "ready" ? "Ready" : status === "reading" ? "Reading" : status === "partial" ? "Partial" : status === "unsupported" ? "Unsupported" : status === "error" ? "Error" : "Attached"}</span>
    </span>
  );
}

function GeneratingView({ isLight, activeStep, sources, brief }: { isLight: boolean; activeStep: number; sources: WorkspaceKnowledgeSource[]; brief: string }) {
  const chips = buildProgressChips(sources, brief);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[640px] flex-col justify-center px-5 py-12 md:px-10">
      <div className={cn("rounded-2xl border p-5 md:p-7", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-live="polite" aria-busy="true">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", isLight ? "bg-[#f3e7db] text-[#9a6d45]" : "bg-violet-400/10 text-violet-200")}><Sparkles className="h-5 w-5" /></div>
          <div>
            <p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>Designing your workspace</p>
            <p className={cn("mt-1 text-xs", isLight ? "text-[#84766b]" : "text-slate-400")}>{sources.length ? `Using ${sources.length} context source${sources.length === 1 ? "" : "s"}.` : "Starting from your brief."}</p>
          </div>
        </div>
        <div className="mt-7 space-y-4">
          {progressLabels.map((label, index) => {
            const completed = index < activeStep;
            const active = index === activeStep;
            return (
              <div key={label} className="flex items-center gap-3">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", completed ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-500" : active ? (isLight ? "border-[#b8895f] bg-[#f3e7db] text-[#9a6d45]" : "border-violet-300/50 bg-violet-400/10 text-violet-200") : (isLight ? "border-[#e5dbd0] text-[#b6a89c]" : "border-white/10 text-slate-600"))} aria-hidden="true">
                  {completed ? <Check className="h-3 w-3" /> : active ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <span className="size-1 rounded-full bg-current" />}
                </span>
                <span className={cn("text-sm", completed || active ? (isLight ? "text-[#4d4036]" : "text-slate-200") : (isLight ? "text-[#a99b8f]" : "text-slate-600"))}>{label}</span>
              </div>
            );
          })}
        </div>
        <ProgressChipRail isLight={isLight} chips={chips} activeStep={activeStep} />
      </div>
    </main>
  );
}

function ProgressChipRail({ isLight, chips, activeStep }: { isLight: boolean; chips: ProgressChip[]; activeStep: number }) {
  return (
    <div className="mt-7 border-t pt-5" style={{ borderColor: isLight ? "rgba(185, 145, 114, 0.18)" : "rgba(255,255,255,0.08)" }} aria-live="polite" aria-label="Current analysis signals">
      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Live analysis</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip, index) => {
          const state: ProgressChipState = activeStep > chip.step ? "done" : activeStep === chip.step ? "active" : "pending";
          return (
            <span
              key={`${chip.label}:${state}`}
              className={cn(
                "workspace-architect-chip-enter inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]",
                state === "done" && (isLight ? "border-emerald-300/60 bg-emerald-50 text-emerald-800" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"),
                state === "active" && (isLight ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]" : "border-violet-300/30 bg-violet-300/10 text-violet-100"),
                state === "pending" && (isLight ? "border-[#e4ddd3] bg-white/70 text-[#9a8d82]" : "border-white/10 bg-white/[0.035] text-slate-500")
              )}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <span className={cn("size-1.5 rounded-full", state === "done" ? "bg-emerald-400" : state === "active" ? "bg-violet-300 motion-safe:animate-pulse" : isLight ? "bg-[#cdbcae]" : "bg-slate-600")} aria-hidden="true" />
              {chip.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function buildProgressChips(sources: WorkspaceKnowledgeSource[], brief: string): ProgressChip[] {
  const chips: ProgressChip[] = sources.slice(0, 4).map((source) => ({
    label: `${formatWorkspaceSourceKind(source.kind)} · ${source.label}`,
    step: 0
  }));

  if (sources.length > 0) {
    chips.push({ label: `${sources.length} source${sources.length === 1 ? "" : "s"} staged`, step: 1 });
  }

  const briefSignals = [
    { pattern: /marketing/i, label: "Marketing intent" },
    { pattern: /management/i, label: "Management intent" },
    { pattern: /autonom/i, label: "Autonomous operation" }
  ];
  for (const signal of briefSignals) {
    if (signal.pattern.test(brief)) chips.push({ label: signal.label, step: 2 });
  }
  chips.push({ label: "Blueprint safety check", step: 3 });
  return chips;
}

function ReviewView({
  isLight,
  model,
  revisionValue,
  setRevisionValue,
  onRevise,
  isRevising,
  revisionError,
  onRetry,
  isCustomizing,
  customName,
  setCustomName,
  customPrimaryName,
  setCustomPrimaryName,
  onCloseCustomization,
  onSaveCustomization,
  isSavingCustomization
}: {
  isLight: boolean;
  model: WorkspaceBlueprintReviewModel | null;
  revisionValue: string;
  setRevisionValue: (value: string) => void;
  onRevise: () => void;
  isRevising: boolean;
  revisionError: string | null;
  onRetry: () => void;
  isCustomizing: boolean;
  customName: string;
  setCustomName: (value: string) => void;
  customPrimaryName: string;
  setCustomPrimaryName: (value: string) => void;
  onCloseCustomization: () => void;
  onSaveCustomization: () => void;
  isSavingCustomization: boolean;
}) {
  if (!model) return null;
  const identity = model.identity;
  const freshnessStatus = model.freshness.status;
  const fallbackDiagnostic = model.warnings.find((warning) => /Architect/i.test(warning));

  return (
    <main className="mx-auto w-full max-w-[860px] px-5 py-6 md:px-10 md:py-8">
      {model.fallback ? (
        <div className={cn("mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <div>
            <p className="text-sm font-semibold">AgentOS couldn’t fully analyze the project.</p>
            <p className="mt-1 text-xs opacity-80">{fallbackDiagnostic || "This is a safe minimal draft. You can review it or retry without losing context."}</p>
          </div>
          <Button type="button" variant="secondary" onClick={onRetry} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
        </div>
      ) : null}

      {freshnessStatus !== "fresh" ? (
        <div className={cn("mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3", freshnessStatus === "stale" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-[#e5dbd0] bg-white text-[#61554b]" : "border-white/10 bg-white/[0.04] text-slate-300"))} role="status">
          <div><p className="text-sm font-medium">{freshnessStatus === "stale" ? "Project context changed." : "Project context freshness is unknown."}</p><p className="mt-1 text-xs opacity-75">{freshnessStatus === "stale" ? "Review the workspace again before continuing." : "AgentOS could not prove a current knowledge generation."}</p></div>
          {freshnessStatus === "stale" ? <Button type="button" variant="secondary" onClick={onRetry} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>Refresh Blueprint</Button> : null}
        </div>
      ) : null}

      {isCustomizing ? (
        <section className={cn("mb-5 rounded-xl border p-4", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-labelledby="customize-heading">
          <div className="flex items-start justify-between gap-3"><div><h2 id="customize-heading" className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>Customize the draft</h2><p className={cn("mt-1 text-xs", isLight ? "text-[#84766b]" : "text-slate-400")}>Change the exception; AgentOS keeps the rest of the architecture intact.</p></div><button type="button" onClick={onCloseCustomization} aria-label="Close customization" className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs"><span className={cn("font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Workspace name</span><input value={customName} onChange={(event) => setCustomName(event.target.value)} className={cn(missionControlDialogControlClassName("mt-1.5"), isLight ? "border-[#dfd2c6] bg-[#fbf8f3] text-[#382d25]" : "")} /></label>
            <label className="text-xs"><span className={cn("font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Primary agent</span><input value={customPrimaryName} onChange={(event) => setCustomPrimaryName(event.target.value)} className={cn(missionControlDialogControlClassName("mt-1.5"), isLight ? "border-[#dfd2c6] bg-[#fbf8f3] text-[#382d25]" : "")} /></label>
          </div>
          <div className="mt-4 flex justify-end"><Button type="button" onClick={onSaveCustomization} disabled={isSavingCustomization || !customName.trim() || !customPrimaryName.trim()} className={missionControlDialogButtonClassName("primary", isLight ? "light" : "dark")}>{isSavingCustomization ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}{isSavingCustomization ? "Saving…" : "Save changes"}</Button></div>
        </section>
      ) : null}

      <section className={cn("rounded-2xl border p-5 md:p-6", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", isLight ? "text-[#9a7a62]" : "text-violet-300/75")}>Workspace identity</p><h1 className={cn("mt-2 break-words font-display text-2xl font-semibold tracking-[-0.03em]", isLight ? "text-[#32271f]" : "text-white")}>{identity.name}</h1><p className={cn("mt-2 max-w-2xl text-sm leading-6", isLight ? "text-[#766e64]" : "text-slate-300")}>{identity.purpose}</p></div>
          <Badge variant="muted" className="shrink-0">{identity.projectType}</Badge>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ReviewSection isLight={isLight} title="Primary agent" icon={Bot}>
            <p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-slate-100")}>{model.primaryAgent.name}</p>
            <p className={cn("mt-1 text-xs leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{model.primaryAgent.purpose}</p>
            {model.primaryAgent.skillIds.length || model.primaryAgent.toolIds.length ? <p className={cn("mt-3 text-xs", isLight ? "text-[#766e64]" : "text-slate-300")}>{model.primaryAgent.skillIds.length + model.primaryAgent.toolIds.length} selected {model.primaryAgent.skillIds.length + model.primaryAgent.toolIds.length === 1 ? "capability" : "capabilities"}.</p> : null}
          </ReviewSection>

          <ReviewSection isLight={isLight} title="Knowledge" icon={FileText}>
            <p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-slate-100")}>{model.knowledge.coverage.sourceCount} source{model.knowledge.coverage.sourceCount === 1 ? "" : "s"}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{model.knowledge.sources.map((source) => <span key={source.id} className={cn("rounded-md px-2 py-1 text-[11px]", isLight ? "bg-[#f6f0e9] text-[#6c5b4e]" : "bg-white/[0.06] text-slate-300")}>{formatWorkspaceSourceKind(source.kind)} · {source.label}</span>)}</div>
          </ReviewSection>
        </div>

        <BlueprintSignalRail isLight={isLight} model={model} />

        <ReviewDetailSections isLight={isLight} model={model} />
      </section>

      <section className={cn("mt-4 rounded-2xl border p-4", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.035]")} aria-labelledby="revision-heading">
        <div className="flex items-center gap-2"><WandSparkles className={cn("h-4 w-4", isLight ? "text-[#9a6d45]" : "text-violet-300")} /><h2 id="revision-heading" className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>Want to change something?</h2></div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={revisionValue} onChange={(event) => setRevisionValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onRevise(); }} placeholder="Keep this to one agent and remove the automation…" aria-label="Tell AgentOS what to change" className={cn(missionControlDialogControlClassName("h-10"), isLight ? "border-[#dfd2c6] bg-[#fbf8f3] text-[#382d25] placeholder:text-[#aa9a8d]" : "")} /><Button type="button" variant="secondary" onClick={onRevise} disabled={!revisionValue.trim() || isRevising} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRevising ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}{isRevising ? "Updating…" : "Revise"}</Button></div>
        {revisionError ? <p className="mt-2 text-xs text-red-500" role="alert">{revisionError}</p> : null}
      </section>
    </main>
  );
}

function BlueprintSignalRail({ isLight, model }: { isLight: boolean; model: WorkspaceBlueprintReviewModel }) {
  const signals = buildBlueprintSignals(model);
  if (!signals.length) return null;

  return (
    <section className="mt-5 border-t pt-4" style={{ borderColor: isLight ? "rgba(185, 145, 114, 0.18)" : "rgba(255,255,255,0.08)" }} aria-label="Blueprint signals">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Blueprint signals</p>
        <p className={cn("text-[10px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>Selections surfaced from the brief and staged context</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {signals.map((signal, index) => (
          <span
            key={signal}
            className={cn(
              "workspace-architect-chip-enter inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]",
              index === 0
                ? (isLight ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]" : "border-violet-300/30 bg-violet-300/10 text-violet-100")
                : (isLight ? "border-[#e4ddd3] bg-[#fcfaf7] text-[#6d645b]" : "border-white/10 bg-white/[0.045] text-slate-300")
            )}
            style={{ animationDelay: `${index * 55}ms` }}
          >
            <span className="max-w-[18rem] truncate">{signal}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function buildBlueprintSignals(model: WorkspaceBlueprintReviewModel) {
  const signals = [
    ...model.knowledge.sources.map((source) => `${formatWorkspaceSourceKind(source.kind)} · ${source.label}`),
    ...model.specialists.map((agent) => `Agent · ${agent.name}`),
    ...model.automations.map((automation) => `Automation · ${automation.name}`),
    ...model.channels.map((channel) => `Channel · ${channel.name || channel.type}`),
    ...model.connections.map((connection) => `Connection · ${connection.provider}`),
    ...model.capabilities.skills.map((skill) => `Skill · ${capabilityLabel(skill.id)}`),
    ...model.capabilities.tools.map((tool) => `Tool · ${capabilityLabel(tool.id)}`)
  ];
  return [...new Set(signals)].slice(0, 12);
}

function ReviewDetailSections({ isLight, model }: { isLight: boolean; model: WorkspaceBlueprintReviewModel }) {
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {model.capabilities.skills.length || model.capabilities.tools.length ? <ReviewSection isLight={isLight} title="Capabilities" icon={Sparkles}><p className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{[...model.capabilities.skills.map((item) => capabilityLabel(item.id)), ...model.capabilities.tools.map((item) => capabilityLabel(item.id))].join(" · ")}</p></ReviewSection> : null}
      <ReviewSection isLight={isLight} title="Memory" icon={FileText}><p className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{model.memory.durableFacts.length ? `${model.memory.durableFacts.length} durable fact${model.memory.durableFacts.length === 1 ? "" : "s"} proposed` : "No custom project memory yet."}</p></ReviewSection>
      {model.connections.length ? <ReviewSection isLight={isLight} title="Connections" icon={Link2}><div className="space-y-1.5">{model.connections.map((connection) => <p key={connection.id} className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}><span className="font-medium">{connection.provider}</span><span className="ml-2 text-xs opacity-70">{connection.status === "recommended" ? "Recommended" : connection.status === "required" ? "Required" : "Selected"}</span></p>)}</div></ReviewSection> : null}
      {model.specialists.length ? <ReviewSection isLight={isLight} title="Additional agents" icon={Bot}><div className="space-y-2">{model.specialists.map((agent) => <div key={agent.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{agent.name}</p><p className={cn("text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{agent.purpose}</p></div>)}</div></ReviewSection> : <QuietReviewLine isLight={isLight} label="Additional agents" value="No additional agents needed." />}
      {model.automations.length ? <ReviewSection isLight={isLight} title="Automations" icon={RefreshCw}><div className="space-y-2">{model.automations.map((automation) => <div key={automation.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{automation.name}</p><p className={cn("text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{formatWorkspaceSchedule(automation.scheduleKind, automation.scheduleValue)}</p></div>)}</div></ReviewSection> : <QuietReviewLine isLight={isLight} label="Automations" value="No automations added." />}
      {model.channels.length ? <ReviewSection isLight={isLight} title="Channels" icon={MessageCircle}><div className="space-y-2">{model.channels.map((channel) => <div key={channel.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{channel.name || channel.type}</p><p className={cn("text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{formatWorkspaceChannelSetup(channel)}</p></div>)}</div></ReviewSection> : null}
      {model.warnings.length ? <ReviewSection isLight={isLight} title="Warnings" icon={FileText} tone="warning"><div className="space-y-1.5">{model.warnings.slice(0, 4).map((warning) => <p key={warning} className="text-xs leading-5">{warning}</p>)}</div></ReviewSection> : null}
      {model.recommendations.length ? <ReviewSection isLight={isLight} title="Recommendations" icon={WandSparkles}><div className="space-y-1.5">{model.recommendations.slice(0, 4).map((recommendation) => <p key={recommendation} className={cn("text-xs leading-5", isLight ? "text-[#71645a]" : "text-slate-400")}>{recommendation}</p>)}</div></ReviewSection> : null}
    </div>
  );
}

function ReviewSection({ isLight, title, icon: Icon, children, tone = "default" }: { isLight: boolean; title: string; icon: typeof Bot; children: React.ReactNode; tone?: "default" | "warning" }) {
  return <section className={cn("rounded-xl border p-4", tone === "warning" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10"))}><div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 opacity-70" /><h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">{title}</h3></div><div className="mt-3">{children}</div></section>;
}

function QuietReviewLine({ isLight, label, value }: { isLight: boolean; label: string; value: string }) {
  return <div className={cn("flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-xs", isLight ? "bg-[#fcfaf7] text-[#89796c]" : "bg-black/10 text-slate-500")}><span className="font-medium">{label}</span><span>{value}</span></div>;
}

function ContextButton({ isLight, icon: Icon, label, onClick }: { isLight: boolean; icon: typeof Globe; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", isLight ? "border-[#e5dbd0] bg-white text-[#65594f] hover:border-[#c9ad92] hover:bg-[#fcfaf7]" : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-violet-300/30 hover:bg-violet-400/[0.08] hover:text-white")}><Icon className="h-3.5 w-3.5" />{label}</button>;
}

function ModeButton({ isLight, active, label, onClick }: { isLight: boolean; active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("h-8 rounded-md px-4 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? (isLight ? "bg-[#f3e7db] text-[#6d4b32] shadow-sm" : "bg-violet-400/15 text-violet-100") : (isLight ? "text-[#8b7b6d] hover:text-[#58483d]" : "text-slate-500 hover:text-slate-200"))}>
    {label}{active && label === "Automatic" ? <span className="ml-1.5 text-[10px] opacity-70">Recommended</span> : null}
  </button>;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "source";
}

function capabilityLabel(id: string) {
  return id.split(/[-_]/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
