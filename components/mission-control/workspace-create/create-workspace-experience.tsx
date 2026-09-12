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
  Minimize2,
  Pencil,
  RefreshCw,
  Sparkles,
  WandSparkles,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  MissionControlDialogShell,
  missionControlDialogButtonClassName,
  missionControlDialogControlClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PikoLoader } from "@/components/ui/piko-loader";
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
import type { WorkspaceCreationRun } from "@/lib/agentos/domains/workspace-creation-run";
import type { WorkspaceCreationReviewReadiness } from "@/lib/agentos/domains/workspace-creation-review";
import type { WorkspaceCreateResult } from "@/lib/agentos/contracts";
import {
  formatWorkspaceChannelSetup,
  formatWorkspaceSchedule,
  formatWorkspaceSourceKind,
  presentWorkspaceBlueprint,
  type WorkspaceBlueprintReviewModel
} from "@/lib/agentos/ui/workspace-create-presenter";
import { presentWorkspaceCreationExperience, type WorkspaceCreationExperienceModel } from "@/lib/agentos/ui/workspace-creation-experience-presenter";

type SurfaceTheme = "dark" | "light";
type CreateStage = "intake" | "generating" | "review" | "provisioning";
type ContextAction = "website" | "github" | "connect" | null;
type SourceDraft = { kind: "website" | "repository"; value: string };
type ContextSourceStatus = "attached" | "reading" | "ready" | "partial" | "error" | "unsupported";
type ContextSourceState = {
  status: ContextSourceStatus;
  warning?: string;
  storedDocuments?: number;
  discoveredItems?: number;
  fetchedItems?: number;
  currentActivity?: string | null;
  currentLocator?: string | null;
};
type UploadGroup = { sourceId: string; files: File[] };
type ProvisioningRun = {
  runId: string;
  state: "pending" | "validating" | "materializing" | "bootstrapping" | "applying-composition" | "promoting-knowledge" | "provisioning-agents" | "binding-knowledge" | "applying-capabilities" | "recording-declarations" | "verifying" | "ready" | "partial" | "failed" | "cancelled";
  result: WorkspaceCreateResult | null;
  warnings: string[];
  error: { code: string; message: string } | null;
  progress: { label: string; detail: string } | null;
  steps: Array<{ id: string; label: string; status: "pending" | "active" | "complete" | "failed" }>;
  signals: string[];
  knowledge: { promotedGenerationId: string | null; sourceIds: string[]; documentCount: number } | null;
  pendingSetup: { channels: string[]; connections: string[]; automations: string[] };
};

type CreateWorkspaceExperienceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  surfaceTheme: SurfaceTheme;
  onWorkspaceCreated?: (result: WorkspaceCreateResult) => void;
  onRefresh?: () => Promise<void>;
};

const progressSteps = [
  { id: "reading-context", label: "Reading project context" },
  { id: "designing-workspace", label: "Designing your workspace" },
  { id: "preparing-review", label: "Preparing your review" }
] as const;

type GenerationPhase = (typeof progressSteps)[number]["id"];
type ProgressChipState = ContextSourceStatus;

type ProgressChip = {
  label: string;
  state: ProgressChipState;
};

export function CreateWorkspaceExperience({
  open,
  onOpenChange,
  surfaceTheme,
  onWorkspaceCreated,
  onRefresh
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
  const [progressPhase, setProgressPhase] = useState<GenerationPhase>("designing-workspace");
  const [contextWasRequested, setContextWasRequested] = useState(false);
  const [result, setResult] = useState<WorkspaceArchitectResult | null>(null);
  const [creationRun, setCreationRun] = useState<WorkspaceCreationRun | null>(null);
  const [reviewReadiness, setReviewReadiness] = useState<WorkspaceCreationReviewReadiness | null>(null);
  const [freshness, setFreshness] = useState<WorkspaceBlueprintFreshnessResult | null>(null);
  const [contextAction, setContextAction] = useState<ContextAction>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceDraft>({ kind: "website", value: "" });
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "warning" | "error" | "muted"; title: string; description: string } | null>(null);
  const [revisionValue, setRevisionValue] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [isRefreshingProject, setIsRefreshingProject] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrimaryName, setCustomPrimaryName] = useState("");
  const [isSavingCustomization, setIsSavingCustomization] = useState(false);
  const [provisioningRun, setProvisioningRun] = useState<ProvisioningRun | null>(null);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [basicDraftApproved, setBasicDraftApproved] = useState(false);
  const [isRebuildingPlan, setIsRebuildingPlan] = useState(false);
  const [showStartOverConfirmation, setShowStartOverConfirmation] = useState(false);
  const provisioningKeyRef = useRef<string | null>(null);
  const provisioningPollRef = useRef<AbortController | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLocalDraftRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const review = useMemo(
    () => (result ? presentWorkspaceBlueprint(result, {
      partialContext: creationRun?.snapshot.context.status === "partial",
      attempts: creationRun?.snapshot.architect.attempts,
      elapsedMs: creationRun?.snapshot.architect.elapsedMs,
      retryAvailable: creationRun?.snapshot.architect.retryAvailable,
      failureCategory: creationRun?.snapshot.architect.failure?.code ?? null,
      extraction: creationRun?.snapshot.extraction ?? null,
      intelligence: creationRun?.snapshot.intelligence ?? null,
      composition: creationRun?.snapshot.composition ?? null,
      readiness: reviewReadiness ?? creationRun?.snapshot.reviewReadiness ?? null
    }) : null),
    [creationRun, result, reviewReadiness]
  );
  const experience = useMemo(() => presentWorkspaceCreationExperience({ run: creationRun, result, provisioningRun, sources }), [creationRun, provisioningRun, result, sources]);
  const isActiveRun = stage === "generating" || stage === "provisioning";

  const resetCreationState = () => {
    abortControllerRef.current?.abort();
    provisioningPollRef.current?.abort();
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
    setProgressPhase("designing-workspace");
    setContextWasRequested(false);
    setResult(null);
    setCreationRun(null);
    setReviewReadiness(null);
    setFreshness(null);
    setContextAction(null);
    setSourceDraft({ kind: "website", value: "" });
    setSourceError(null);
    setNotice(null);
    setRevisionValue("");
    setRevisionError(null);
    setIsRefreshingProject(false);
    setIsCustomizing(false);
    setProvisioningRun(null);
    setProvisioningError(null);
    setBasicDraftApproved(false);
    setIsRebuildingPlan(false);
    setShowStartOverConfirmation(false);
    setIsMinimized(false);
    provisioningKeyRef.current = null;
    hasLocalDraftRef.current = false;
  };

  const certifyReview = useCallback(async (runId: string, acceptDraft: boolean) => {
    const response = await fetch(`/api/workspaces/creation-runs/${runId}/readiness?acceptDraft=${acceptDraft ? "true" : "false"}`);
    const payload = (await response.json().catch(() => null)) as { run?: WorkspaceCreationRun; readiness?: WorkspaceCreationReviewReadiness; error?: string } | null;
    if (!response.ok || !payload?.run || !payload.readiness) throw new Error(payload?.error || "AgentOS could not certify the workspace review.");
    setCreationRun(payload.run);
    setReviewReadiness(payload.readiness);
    return payload;
  }, []);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      setIsMinimized(false);
      provisioningPollRef.current?.abort();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isActiveRun) setIsMinimized(false);
  }, [isActiveRun, open]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isActiveRun) {
      setIsMinimized(true);
      return;
    }
    setIsMinimized(false);
    onOpenChange(nextOpen);
  };

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

  const generate = async () => {
    const nextBrief = brief.trim();
    if (!nextBrief || stage === "generating") return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const shouldStageContext = contextDirty || (!draftContextId && sources.length > 0);
    setStage("generating");
    setContextWasRequested(shouldStageContext);
    setProgressPhase(shouldStageContext ? "reading-context" : "designing-workspace");
    setNotice(null);
    setRevisionError(null);

    try {
      const formData = new FormData();
      formData.set("idempotencyKey", crypto.randomUUID());
      formData.set("brief", nextBrief);
      formData.set("mode", mode === "automatic" ? "automatic" : "review");
      formData.set("operatorConstraints", JSON.stringify(constraints.split("\n").map((line) => line.trim()).filter(Boolean)));
      formData.set("materialization", JSON.stringify(materialization));
      formData.set("sources", JSON.stringify(sources));
      if (draftContextId) formData.set("draftContextId", draftContextId);
      const manifest: Array<{ sourceId: string; relativePath: string; fileName: string }> = [];
      for (const group of uploadGroups) {
        for (const file of group.files) {
          manifest.push({ sourceId: group.sourceId, relativePath: file.webkitRelativePath || file.name, fileName: file.name });
          formData.append("files", file, file.name);
        }
      }
      formData.set("uploadManifest", JSON.stringify(manifest));
      const response = await fetch("/api/workspaces/creation-runs", { method: "POST", body: formData, signal: controller.signal });
      const initial = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      if (!response.ok || !initial?.runId) throw new Error(initial?.error || "AgentOS could not start workspace creation.");
      hasLocalDraftRef.current = true;
      setCreationRun(initial);
      setDraftContextId(initial.draftContextId);
      await pollCreationRun(initial.runId, controller, initial, sources);
      setProvisioningRun(null);
      setProvisioningError(null);
      provisioningKeyRef.current = null;
      setContextDirty(false);
      setStage("review");
      setRevisionValue("");
      setIsCustomizing(false);
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

  const pollCreationRun = useCallback(async (runId: string, controller: AbortController, initial: WorkspaceCreationRun, sourceList: WorkspaceKnowledgeSource[]) => {
    let afterSequence = initial.events.at(-1)?.sequence ?? 0;
    for (;;) {
      if (controller.signal.aborted) throw new DOMException("Workspace creation was cancelled.", "AbortError");
      const response = await fetch(`/api/workspaces/creation-runs/${runId}?afterSequence=${afterSequence}`, { signal: controller.signal });
      const payload = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      if (!response.ok || !payload?.runId) throw new Error(payload?.error || "AgentOS could not read workspace creation progress.");
      setCreationRun(payload);
      if (payload.snapshot.reviewReadiness) setReviewReadiness(payload.snapshot.reviewReadiness);
      afterSequence = payload.events.at(-1)?.sequence ?? afterSequence;
      const activeStage = payload.snapshot.stage;
      setProgressPhase(activeStage === "context-staging" || activeStage === "source-ingestion" ? "reading-context" : activeStage === "review-preparation" ? "preparing-review" : "designing-workspace");
      if (payload.snapshot.context.sourceProgress?.length) {
        setSourceStates((existing) => Object.fromEntries(payload.snapshot.context.sourceProgress.map((progress) => [progress.sourceId, {
          ...existing[progress.sourceId],
          status: mapCreationSourceStatus(progress.state),
          discoveredItems: progress.discoveredItems,
          fetchedItems: progress.fetchedItems,
          storedDocuments: progress.storedDocuments,
          currentActivity: progress.currentActivity,
          currentLocator: progress.currentLocator
        }])))
      }
      if (payload.snapshot.context.status === "partial") {
        setSourceStates((existing) => Object.fromEntries(sourceList.map((source) => [source.id, { ...existing[source.id], ...(existing[source.id] ? {} : { status: "partial" as const }), warning: "Architecture generated from partial project context." }])));
      }
      if (payload.snapshot.state === "review-ready") {
        const generated = payload.result as WorkspaceArchitectResult | null;
        if (!generated?.blueprint) throw new Error("Workspace creation completed without a reviewable blueprint.");
        setProgressPhase("preparing-review");
        setResult(generated);
        setFreshness(generated.freshness);
        setContextDirty(false);
        setStage("review");
        setRevisionValue("");
        setIsCustomizing(false);
        setCustomName(generated.blueprint.identity.name);
        setCustomPrimaryName(generated.blueprint.workforce.primaryAgent.name);
        return payload;
      }
      if (payload.snapshot.state === "cancelled") throw new DOMException("Workspace creation was cancelled.", "AbortError");
      if (payload.snapshot.state === "failed") throw new Error(payload.snapshot.architect.failure?.message || "Workspace creation failed.");
      await wait(450, controller.signal);
    }
  }, []);

  useEffect(() => {
    if (!open || hasLocalDraftRef.current) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/workspaces/creation-runs?resumable=true", { signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as { runs?: WorkspaceCreationRun[] } | null;
        const activeRun = payload?.runs?.[0];
        if (!response.ok || !activeRun || controller.signal.aborted) return;
        const recoveredSources = activeRun.input.sources as WorkspaceKnowledgeSource[];
        setBrief(activeRun.input.brief);
        setMode(activeRun.input.mode === "automatic" ? "automatic" : "customize");
        setSources(recoveredSources);
        setConstraints(activeRun.input.operatorConstraints.join("\n"));
        setDraftContextId(activeRun.draftContextId);
        setMaterialization(activeRun.input.materialization as WorkspaceMaterialization);
        setCreationRun(activeRun);
        hasLocalDraftRef.current = true;
        if (activeRun.snapshot.reviewReadiness) setReviewReadiness(activeRun.snapshot.reviewReadiness);
        setStage("generating");
        setContextWasRequested(recoveredSources.length > 0);
        abortControllerRef.current = controller;
        const recoveredRun = await pollCreationRun(activeRun.runId, controller, activeRun, recoveredSources);
        if (recoveredRun.snapshot.provisioningRunId) {
          const provisioningResponse = await fetch(`/api/workspaces/provision?runId=${encodeURIComponent(recoveredRun.snapshot.provisioningRunId)}`, { signal: controller.signal });
          const recoveredProvisioning = (await provisioningResponse.json().catch(() => null)) as ProvisioningRun & { error?: string } | null;
          if (provisioningResponse.ok && recoveredProvisioning?.runId) {
            setProvisioningRun(recoveredProvisioning);
            if (!isProvisioningTerminal(recoveredProvisioning.state)) setStage("provisioning");
          }
        }
      } catch {
        // Reload recovery is best-effort; the durable run remains available to a later poll.
      }
    })();
    return () => controller.abort();
  }, [open, pollCreationRun]);

  const refreshProject = async () => {
    if (!creationRun || isRefreshingProject) return;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setIsRefreshingProject(true);
    setRevisionError(null);
    setStage("generating");
    setContextWasRequested(sources.length > 0);
    setProgressPhase(sources.length > 0 ? "reading-context" : "designing-workspace");
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/refresh`, { method: "POST", signal: controller.signal });
      const next = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      if (!response.ok || !next?.runId) throw new Error(next?.error || "AgentOS could not refresh the project context.");
      setCreationRun(next);
      setDraftContextId(next.draftContextId);
      setResult(null);
      setFreshness(null);
      await pollCreationRun(next.runId, controller, next, sources);
      setContextDirty(false);
    } catch (error) {
      if (!controller.signal.aborted) setRevisionError(error instanceof Error ? error.message : "The project context could not be refreshed.");
      if (!controller.signal.aborted) setStage("review");
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsRefreshingProject(false);
    }
  };

  const cancelGeneration = () => {
    const runId = creationRun?.runId;
    if (runId) {
      void fetch(`/api/workspaces/creation-runs/${runId}/cancel`, { method: "POST", keepalive: true }).catch(() => undefined);
    }
    abortControllerRef.current?.abort();
  };

  const revise = async () => {
    if (!result || !revisionValue.trim() || isRevising) return;

    setIsRevising(true);
    setRevisionError(null);
    try {
      if (!creationRun) throw new Error("The saved workspace creation run is unavailable.");
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: revisionValue.trim(),
          operatorConstraints: constraints
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        })
      });
      const payload = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      const revised = payload?.result as WorkspaceArchitectResult | null;
      if (!response.ok || !payload?.runId || !revised?.blueprint) {
        throw new Error(payload?.error || "AgentOS could not revise the workspace draft.");
      }

      setCreationRun(payload);
      setResult(revised);
      setFreshness(revised.freshness);
      setReviewReadiness(null);
      setBasicDraftApproved(false);
      setProvisioningRun(null);
      setProvisioningError(null);
      provisioningKeyRef.current = null;
      setRevisionValue("");
      setCustomName(revised.blueprint.identity.name);
      setCustomPrimaryName(revised.blueprint.workforce.primaryAgent.name);
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
      if (!creationRun) throw new Error("The saved workspace creation run is unavailable.");
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorEdits: {
            identity: { name: nextName },
            workforce: { primaryAgent: { name: nextPrimaryName } }
          },
        })
      });
      const payload = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      const revised = payload?.result as WorkspaceArchitectResult | null;
      if (!response.ok || !payload?.runId || !revised?.blueprint) {
        throw new Error(payload?.error || "The workspace edits could not be saved.");
      }

      setCreationRun(payload);
      setResult(revised);
      setFreshness(revised.freshness);
      setReviewReadiness(null);
      setBasicDraftApproved(false);
      setProvisioningRun(null);
      setProvisioningError(null);
      provisioningKeyRef.current = null;
      setIsCustomizing(false);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The workspace edits could not be saved.");
    } finally {
      setIsSavingCustomization(false);
    }
  };

  const provision = async () => {
    if (!result || stage === "provisioning") return;
    if (!canProvisionBlueprint(result, freshness ?? result.freshness, draftContextId)) return;

    const controller = new AbortController();
    provisioningPollRef.current?.abort();
    provisioningPollRef.current = controller;
    const idempotencyKey = provisioningKeyRef.current ?? `workspace-provision:${result.blueprint.id}:${result.blueprint.updatedAt}`;
    provisioningKeyRef.current = idempotencyKey;
    setStage("provisioning");
    setProvisioningRun(null);
    setProvisioningError(null);

    try {
      const response = await fetch("/api/workspaces/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          blueprint: result.blueprint,
          draftContextId,
          expectedKnowledgeGenerationId: (freshness ?? result.freshness).currentGenerationId,
          idempotencyKey,
          acceptDraft: result.blueprint.status === "draft",
          creationRunId: creationRun?.runId ?? null,
          compositionPlanId: creationRun?.snapshot.composition?.planId ?? null,
          compositionPlanFingerprint: creationRun?.snapshot.composition?.inputFingerprint ?? null
        })
      });
      const payload = (await response.json().catch(() => null)) as ProvisioningRun & { error?: string } | null;
      if (!response.ok || !payload?.runId) throw new Error(payload?.error || "AgentOS could not start workspace provisioning.");

      let current = payload;
      setProvisioningRun(current);
      while (!isProvisioningTerminal(current.state)) {
        await wait(450, controller.signal);
        const statusResponse = await fetch(`/api/workspaces/provision?runId=${encodeURIComponent(current.runId)}`, { signal: controller.signal });
        const statusPayload = (await statusResponse.json().catch(() => null)) as ProvisioningRun & { error?: string } | null;
        if (!statusResponse.ok || !statusPayload?.runId) throw new Error(statusPayload?.error || "AgentOS could not read workspace provisioning status.");
        current = statusPayload;
        setProvisioningRun(current);
      }

      if (current.state === "failed" || current.state === "cancelled") {
        setProvisioningError(current.error?.message || "Workspace provisioning did not complete.");
      } else {
        await onRefresh?.().catch(() => undefined);
      }
      setStage("review");
    } catch (error) {
      if (controller.signal.aborted) return;
      setProvisioningError(error instanceof Error ? error.message : "Workspace provisioning did not complete.");
      setStage("review");
    } finally {
      if (provisioningPollRef.current === controller) provisioningPollRef.current = null;
    }
  };

  const openProvisionedWorkspace = () => {
    if (!provisioningRun?.result) return;
    onWorkspaceCreated?.(provisioningRun.result);
    onOpenChange(false);
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

  const isProvisioned = provisioningRun?.state === "ready" || provisioningRun?.state === "partial";
  const title = experience.title;
  const description = experience.description;

  return (
    <>
      <PikoLoader
        open={open && isActiveRun}
        title={stage === "provisioning" ? "Creating your workspace" : "Understanding your project"}
        description={stage === "provisioning" ? "Setting up the approved workspace." : experience.currentActivity}
      />
      {open && isMinimized && isActiveRun ? (
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          aria-label="Reopen workspace creation"
          className={cn(
            "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-2 text-left shadow-[0_16px_40px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-transform hover:-translate-x-1/2 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70",
            isLight ? "border-[#e4d7ca] bg-white/95 text-[#4d4036]" : "border-white/15 bg-[#111827]/95 text-slate-100"
          )}
        >
          <span className={cn("flex size-6 items-center justify-center rounded-full", isLight ? "bg-[#f3e7db] text-[#9a6d45]" : "bg-violet-400/15 text-violet-200")}>
            <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold">Workspace creation</span>
            <span className={cn("block max-w-[190px] truncate text-[10px]", isLight ? "text-[#8b7b6e]" : "text-slate-400")}>{experience.phaseLabel}</span>
          </span>
          <span className={cn("ml-1 text-[10px] font-medium", isLight ? "text-[#9a6d45]" : "text-violet-200")}>View</span>
        </button>
      ) : null}
      <MissionControlDialogShell
      open={open && !isMinimized}
      onOpenChange={handleDialogOpenChange}
      surfaceTheme={surfaceTheme}
      title={title}
      description={description}
      icon={stage === "review" ? Bot : Sparkles}
      closeLabel={isActiveRun ? "Minimize workspace creation" : undefined}
      onOutsideInteraction={isActiveRun ? () => setIsMinimized(true) : undefined}
      headerActions={isActiveRun ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setIsMinimized(true)}
          aria-label="Minimize workspace creation"
          className={cn("h-8 w-8 rounded-lg p-0", isLight ? "text-[#756b61] hover:bg-[#f1ebe3] hover:text-[#2d241f]" : "text-slate-300 hover:bg-white/[0.06] hover:text-white")}
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      chips={stage === "review" ? <Badge variant={isProvisioned ? provisioningRun?.state === "partial" ? "warning" : "success" : reviewModel?.fallback ? "warning" : "muted"}>{isProvisioned ? provisioningRun?.state === "partial" ? "Partial" : "Ready" : reviewModel?.fallback ? "Draft" : "Review"}</Badge> : stage === "provisioning" ? <Badge variant="muted">Working</Badge> : null}
      contentClassName="left-0 top-0 h-[100dvh] max-h-[100dvh] w-screen transform-none rounded-none border-x-0 md:left-1/2 md:top-1/2 md:h-[min(calc(100vh-72px),780px)] md:max-h-[calc(100vh-72px)] md:w-[min(92vw,900px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border-x"
      headerClassName="px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-7 md:pb-4 md:pt-5"
      bodyClassName="p-0 overflow-hidden"
      footerClassName="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:px-7 md:py-4"
      footerInnerClassName="p-0"
      footer={
        stage === "generating" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <span className={cn("text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>{experience.phaseLabel}.</span>
            <Button type="button" variant="secondary" onClick={cancelGeneration} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>
              Cancel
            </Button>
          </div>
        ) : stage === "provisioning" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <span className={cn("text-xs", isLight ? "text-[#766e64]" : "text-slate-400")} aria-live="polite">{experience.phaseLabel}.</span>
            <Button type="button" variant="secondary" onClick={() => setIsMinimized(true)} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>Minimize</Button>
          </div>
        ) : stage === "review" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStage("intake")} className={cn("h-9 px-2 text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>
              <ChevronLeft className="mr-1.5 h-4 w-4" />
              Back to brief
            </Button>
            <div className="flex flex-col items-end gap-1">
              <span className={cn("text-[10px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{isProvisioned ? "Your workspace is ready to open." : "Review the draft, then create the workspace."}</span>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={() => setIsCustomizing((current) => !current)} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Customize
                </Button>
                <Button
                  type="button"
                  disabled={!result || !canProvisionBlueprint(result, freshness ?? result.freshness, draftContextId)}
                  onClick={isProvisioned ? openProvisionedWorkspace : () => void provision()}
                  title={!result || !canProvisionBlueprint(result, freshness ?? result.freshness, draftContextId) ? "Review the workspace draft and its project context before creating it." : undefined}
                  aria-label={isProvisioned ? "Open Workspace" : provisioningRun?.state === "failed" ? "Retry provisioning" : "Create Workspace"}
                  className={missionControlDialogButtonClassName("primary", surfaceTheme)}
                >
                  {isProvisioned ? "Open Workspace" : provisioningRun?.state === "failed" ? "Retry provisioning" : "Create Workspace"}
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
          <GeneratingView isLight={isLight} activePhase={progressPhase} contextWasRequested={contextWasRequested} sources={sources} sourceStates={sourceStates} experience={experience} />
        ) : stage === "provisioning" ? (
          <ProvisioningView isLight={isLight} run={provisioningRun} experience={experience} />
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
            onRefreshProject={() => void refreshProject()}
            isRefreshingProject={isRefreshingProject}
            isCustomizing={isCustomizing}
            customName={customName}
            setCustomName={setCustomName}
            customPrimaryName={customPrimaryName}
            setCustomPrimaryName={setCustomPrimaryName}
            onCloseCustomization={() => setIsCustomizing(false)}
            onSaveCustomization={() => void saveCustomization()}
            isSavingCustomization={isSavingCustomization}
            provisioningRun={provisioningRun}
            provisioningError={provisioningError}
            experience={experience}
          />
        )}
      </div>
      </MissionControlDialogShell>
    </>
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

      <details className={cn("mt-7 rounded-xl border px-4 py-3", isLight ? "border-[#e5dbd0] bg-white/70" : "border-white/10 bg-white/[0.025]")}>
        <summary className={cn("cursor-pointer text-xs font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Advanced options</summary>
        <div className="mt-4 flex flex-col items-center gap-3">
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
      </details>

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

function GeneratingView({ isLight, activePhase, contextWasRequested, sources, sourceStates, experience }: { isLight: boolean; activePhase: GenerationPhase; contextWasRequested: boolean; sources: WorkspaceKnowledgeSource[]; sourceStates: Record<string, ContextSourceState>; experience: WorkspaceCreationExperienceModel }) {
  const chips = buildProgressChips(sources, sourceStates);
  const currentStep = progressSteps.findIndex((step) => step.id === activePhase);
  const activeLabel = progressSteps.find((step) => step.id === activePhase)?.label ?? "Working on the first draft";
  const visibleActivities = contextWasRequested ? experience.activities : experience.activities.filter((activity) => activity.id !== "reading");
  const discovery = experience.discovery;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[820px] flex-col justify-center px-5 py-8 md:px-10 md:py-12">
      <div className={cn("rounded-2xl border p-5 md:p-7", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", isLight ? "bg-[#f3e7db] text-[#9a6d45]" : "bg-violet-400/10 text-violet-200")}><Sparkles className="h-5 w-5" /></div>
          <div>
            <p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>{discovery.currentActivity || experience.phaseLabel || activeLabel}</p>
            <p className={cn("mt-1 text-xs", isLight ? "text-[#84766b]" : "text-slate-400")}>{sources.length ? `Using ${sources.length} context source${sources.length === 1 ? "" : "s"}.` : "Starting from your brief."}</p>
          </div>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-4" aria-label="Project understanding metrics">
          {[["Pages", discovery.aggregate.pages], ["Documents", discovery.aggregate.documents], ["Facts", discovery.aggregate.facts], ["Resources", discovery.aggregate.resources]].map(([label, count]) => <div key={label} className={cn("rounded-xl border px-3 py-2.5", isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10")}><p className={cn("text-[10px] uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>{label}</p><p className={cn("mt-1 text-lg font-semibold", isLight ? "text-[#44372d]" : "text-slate-100")}>{count}</p></div>)}
        </div>
        <div className="mt-7 grid gap-6 md:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <div className="space-y-4">
          {visibleActivities.map((activity, index) => {
            const completed = activity.status === "complete" || index < currentStep;
            const active = activity.status === "active" || index === currentStep;
            return (
              <div key={activity.id} className="flex items-center gap-3">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", completed ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-500" : active ? (isLight ? "border-[#b8895f] bg-[#f3e7db] text-[#9a6d45]" : "border-violet-300/50 bg-violet-400/10 text-violet-200") : (isLight ? "border-[#e5dbd0] text-[#b6a89c]" : "border-white/10 text-slate-600"))} aria-hidden="true">
                  {completed ? <Check className="h-3 w-3" /> : active ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <span className="size-1 rounded-full bg-current" />}
                </span>
                <span className={cn("text-sm", completed || active ? (isLight ? "text-[#4d4036]" : "text-slate-200") : (isLight ? "text-[#a99b8f]" : "text-slate-600"))}>{activity.label}</span>
              </div>
            );
          })}
          </div>
          <section className={cn("min-h-[180px] rounded-xl border p-4", isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10")} aria-label="Live project signals">
            <div className="flex items-center justify-between gap-3"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Live project signals</p>{discovery.historyTruncated ? <span className={cn("text-[10px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>Recent activity</span> : null}</div>
            {discovery.currentLocator ? <p className={cn("mt-2 truncate text-xs", isLight ? "text-[#766e64]" : "text-slate-400")} title={discovery.currentLocator}>Reading {discovery.currentLocator}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {discovery.signals.slice(0, 12).map((signal, index) => (
                <span
                  key={signal.id}
                  title={signal.label}
                  className={cn(
                    "workspace-architect-chip-enter inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]",
                    signal.state === "attention" && (isLight ? "border-amber-300/70 bg-amber-50 text-amber-900" : "border-amber-300/25 bg-amber-300/10 text-amber-100"),
                    signal.state === "verified" && (isLight ? "border-emerald-300/60 bg-emerald-50 text-emerald-800" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"),
                    signal.state === "reading" && (isLight ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]" : "border-violet-300/30 bg-violet-300/10 text-violet-100"),
                    signal.state === "inferred" && (isLight ? "border-sky-300/60 bg-sky-50 text-sky-800" : "border-sky-300/25 bg-sky-300/10 text-sky-100"),
                    signal.state === "found" && (isLight ? "border-[#e4ddd3] bg-white/70 text-[#6d645b]" : "border-white/10 bg-white/[0.045] text-slate-300")
                  )}
                  style={{ animationDelay: `${index * 65}ms` }}
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", signal.state === "attention" ? "bg-amber-400" : signal.state === "verified" ? "bg-emerald-400" : signal.state === "reading" ? "bg-violet-300 motion-safe:animate-pulse" : signal.state === "inferred" ? "bg-sky-400" : isLight ? "bg-[#b8895f]" : "bg-slate-500")} aria-hidden="true" />
                  <span className="max-w-[250px] truncate">{signal.label}</span>
                  <span className="sr-only">{signal.state}</span>
                </span>
              ))}
              {!discovery.signals.length ? <p className={cn("text-xs", isLight ? "text-[#9b8d80]" : "text-slate-500")}>The first useful project signal will appear here.</p> : null}
            </div>
          </section>
        </div>
        <ProgressChipRail isLight={isLight} chips={chips} />
      </div>
    </main>
  );
}

function ProgressChipRail({ isLight, chips }: { isLight: boolean; chips: ProgressChip[] }) {
  const stagedChip = chips.find((chip) => /staged$/.test(chip.label));
  const sourceChips = chips.filter((chip) => chip !== stagedChip);
  return (
    <div className="mt-7 border-t pt-5" style={{ borderColor: isLight ? "rgba(185, 145, 114, 0.18)" : "rgba(255,255,255,0.08)" }} aria-live="polite" aria-label="Project context status">
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Project context</p>
        {stagedChip ? <span className={cn("text-[10px]", isLight ? "text-[#7c6b5c]" : "text-slate-400")}>{stagedChip.label}</span> : null}
      </div>
      {sourceChips.length ? <details className="mt-2">
        <summary className={cn("cursor-pointer text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>View source progress ({sourceChips.length})</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
        {sourceChips.map((chip, index) => {
          const state = chip.state;
          return (
            <span
              key={`${chip.label}:${state}`}
              className={cn(
                "workspace-architect-chip-enter inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]",
                state === "ready" && (isLight ? "border-emerald-300/60 bg-emerald-50 text-emerald-800" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"),
                state === "partial" && (isLight ? "border-amber-300/70 bg-amber-50 text-amber-900" : "border-amber-300/25 bg-amber-300/10 text-amber-100"),
                state === "reading" && (isLight ? "border-[#d8b184] bg-[#f8efe3] text-[#7c5a34]" : "border-violet-300/30 bg-violet-300/10 text-violet-100"),
                (state === "attached" || state === "error" || state === "unsupported") && (isLight ? "border-[#e4ddd3] bg-white/70 text-[#9a8d82]" : "border-white/10 bg-white/[0.035] text-slate-500")
              )}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <span className={cn("size-1.5 rounded-full", state === "ready" ? "bg-emerald-400" : state === "partial" || state === "error" || state === "unsupported" ? "bg-amber-400" : state === "reading" ? "bg-violet-300 motion-safe:animate-pulse" : isLight ? "bg-[#cdbcae]" : "bg-slate-600")} aria-hidden="true" />
              {chip.label}
            </span>
          );
        })}
        </div>
      </details> : null}
    </div>
  );
}

function buildProgressChips(sources: WorkspaceKnowledgeSource[], sourceStates: Record<string, ContextSourceState>): ProgressChip[] {
  const chips: ProgressChip[] = sources.slice(0, 6).map((source) => {
    const state = sourceStates[source.id]?.status ?? "attached";
    const storedDocuments = sourceStates[source.id]?.storedDocuments;
    const progress = sourceStates[source.id];
    const counts = progress?.fetchedItems || progress?.discoveredItems ? ` · ${progress.fetchedItems ?? 0}/${progress.discoveredItems ?? 0} items` : "";
    return {
      label: `${formatWorkspaceSourceKind(source.kind)} · ${source.label}${storedDocuments ? ` · ${storedDocuments} document${storedDocuments === 1 ? "" : "s"} found` : ""}${counts} · ${formatContextSourceStatus(state)}`,
      state
    };
  });

  const stagedCount = sources.filter((source) => {
    const state = sourceStates[source.id]?.status;
    return state === "ready" || state === "partial";
  }).length;
  if (stagedCount > 0) {
    chips.push({ label: `${stagedCount} source${stagedCount === 1 ? "" : "s"} staged`, state: "ready" });
  }
  return chips;
}

function mapCreationSourceStatus(state: "pending" | "discovering" | "fetching" | "normalizing" | "ready" | "partial" | "failed"): ContextSourceStatus {
  if (state === "ready") return "ready";
  if (state === "partial") return "partial";
  if (state === "failed") return "error";
  if (state === "pending") return "attached";
  return "reading";
}

function formatContextSourceStatus(status: ContextSourceStatus) {
  switch (status) {
    case "reading": return "Reading";
    case "ready": return "Ready";
    case "partial": return "Partial";
    case "error": return "Failed";
    case "unsupported": return "Unsupported";
    default: return "Attached";
  }
}

function ProvisioningView({ isLight, run, experience }: { isLight: boolean; run: ProvisioningRun | null; experience: WorkspaceCreationExperienceModel }) {
  const steps = experience.activities;
  const signals = run?.signals ?? [];
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center px-5 py-12 md:px-10">
      <div className={cn("rounded-2xl border p-5 md:p-7", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-3">
          <div className={cn("flex size-10 items-center justify-center rounded-xl", isLight ? "bg-[#f3e7db] text-[#9a6d45]" : "bg-violet-400/10 text-violet-200")}><LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" /></div>
          <div className="min-w-0"><p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>{experience.phaseLabel}</p><p className={cn("mt-1 text-xs", isLight ? "text-[#84766b]" : "text-slate-400")}>{run?.progress?.detail || "AgentOS is starting the approved workspace bootstrap."}</p></div>
        </div>
        <div className="mt-7 space-y-3">
          {steps.map((step, index) => <div key={step.id} className="flex items-center gap-3"><span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", step.status === "complete" ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-500" : step.status === "attention" ? "border-amber-400/50 bg-amber-400/10 text-amber-500" : step.status === "active" ? (isLight ? "border-[#b8895f] bg-[#f3e7db] text-[#9a6d45]" : "border-violet-300/50 bg-violet-400/10 text-violet-200") : (isLight ? "border-[#e5dbd0] text-[#b6a89c]" : "border-white/10 text-slate-600"))} aria-hidden="true">{step.status === "complete" ? <Check className="h-3 w-3" /> : step.status === "active" ? <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : step.status === "attention" ? <CircleAlert className="h-3 w-3" /> : <span className="size-1 rounded-full bg-current" />}</span><span className={cn("text-sm", step.status === "pending" ? (isLight ? "text-[#a99b8f]" : "text-slate-600") : (isLight ? "text-[#4d4036]" : "text-slate-200"))}>{step.label}</span><span className="sr-only">Step {index + 1} of {steps.length}</span></div>)}
        </div>
        {signals.length ? <div className="mt-7 border-t pt-5" style={{ borderColor: isLight ? "rgba(185, 145, 114, 0.18)" : "rgba(255,255,255,0.08)" }}><p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Live provisioning signals</p><div className="mt-2 flex flex-wrap gap-1.5">{signals.map((signal, index) => <span key={signal} className={cn("workspace-architect-chip-enter inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]", isLight ? "border-[#e4ddd3] bg-[#fcfaf7] text-[#6d645b]" : "border-white/10 bg-white/[0.045] text-slate-300")} style={{ animationDelay: `${index * 55}ms` }}><span className={cn("size-1.5 rounded-full", isLight ? "bg-[#cdbcae]" : "bg-slate-600")} aria-hidden="true" />{signal}</span>)}</div></div> : null}
      </div>
    </main>
  );
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
  onRefreshProject,
  isRefreshingProject,
  isCustomizing,
  customName,
  setCustomName,
  customPrimaryName,
  setCustomPrimaryName,
  onCloseCustomization,
  onSaveCustomization,
  isSavingCustomization,
  provisioningRun,
  provisioningError,
  experience
}: {
  isLight: boolean;
  model: WorkspaceBlueprintReviewModel | null;
  revisionValue: string;
  setRevisionValue: (value: string) => void;
  onRevise: () => void;
  isRevising: boolean;
  revisionError: string | null;
  onRetry: () => void;
  onRefreshProject: () => void;
  isRefreshingProject: boolean;
  isCustomizing: boolean;
  customName: string;
  setCustomName: (value: string) => void;
  customPrimaryName: string;
  setCustomPrimaryName: (value: string) => void;
  onCloseCustomization: () => void;
  onSaveCustomization: () => void;
  isSavingCustomization: boolean;
  provisioningRun: ProvisioningRun | null;
  provisioningError: string | null;
  experience: WorkspaceCreationExperienceModel;
}) {
  if (!model) return null;
  const identity = model.identity;
  const freshnessStatus = model.freshness.status;
  const fallbackDiagnostic = model.warnings.find((warning) => /Architect/i.test(warning));
  const provisioningComplete = provisioningRun?.state === "ready" || provisioningRun?.state === "partial";
  const compositionLabel = model.composition?.status === "fallback"
    ? "AI workspace document proposals unavailable"
    : model.composition?.status === "partial"
      ? "Workspace documents partially planned"
      : model.composition?.status === "blocked" || model.composition?.status === "conflict"
        ? "Workspace documents need conflict review"
        : "Workspace documents planned";

  return (
    <main className="mx-auto w-full max-w-[860px] px-5 py-6 md:px-10 md:py-8">
      {model.fallback ? (
        <div className={cn("mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <div>
            <p className="text-sm font-semibold">AI architecture unavailable</p>
            <p className="mt-1 text-xs opacity-80">Minimal fallback draft created. {fallbackDiagnostic || "You can review it or retry without losing context."}</p>
            <p className="mt-2 text-[11px] opacity-75">Category: {model.failureCategory || "architect-unavailable"} · Attempts: {model.attempts} · Elapsed: {formatElapsed(model.elapsedMs)}</p>
          </div>
          {model.retryAvailable ? <Button type="button" variant="secondary" onClick={onRetry} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button> : null}
        </div>
      ) : null}

      {model.partialContext ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Architecture generated from partial project context</p><p className="mt-1 text-xs opacity-80">Some available project evidence could not be fully staged within the analysis budget.</p></div><Button type="button" variant="secondary" onClick={onRefreshProject} disabled={isRefreshingProject} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRefreshingProject ? "Refreshing…" : "Refresh context"}</Button></div>
        </div>
      ) : null}

      {model.intelligence?.status === "fallback" ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <p className="text-sm font-semibold">AI project intelligence unavailable</p>
          <p className="mt-1 text-xs opacity-80">Canonical extracted evidence was preserved and a partial intelligence pack was created.</p>
        </div>
      ) : null}

      {model.composition ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", model.composition.status === "blocked" || model.composition.status === "conflict" || model.composition.status === "fallback" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-[#e5dbd0] bg-white text-[#55483e]" : "border-white/10 bg-white/[0.04] text-slate-200"))} role="status">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Workspace</p>
          <p className="mt-2 text-sm font-medium">{compositionLabel}</p>
          <p className="mt-1 text-xs opacity-75">{model.composition.artifactCount} bounded project and workspace document proposals · {model.composition.conflictCount} conflict{model.composition.conflictCount === 1 ? "" : "s"}.</p>
          {model.composition.status === "fallback" ? <p className="mt-1 text-xs opacity-75">A deterministic safe draft was created from the approved blueprint and project context.</p> : null}
        </div>
      ) : null}

      {experience.attentionItems.length ? (
        <section className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} aria-labelledby="needs-attention-heading">
          <h2 id="needs-attention-heading" className="text-sm font-semibold">Needs attention</h2>
          <ul className="mt-2 space-y-1 text-xs opacity-85">{experience.attentionItems.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}

      {model.extraction?.status === "partial" ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <p className="text-sm font-semibold">Project evidence is partial</p>
          <p className="mt-1 text-xs opacity-80">Some bounded project material was not included in the structured evidence summary.</p>
        </div>
      ) : null}

      {model.extraction && ["empty", "partial", "ready"].includes(model.extraction.status) ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-[#e5dbd0] bg-white text-[#55483e]" : "border-white/10 bg-white/[0.04] text-slate-200")} role="status">
          <p className="text-sm font-medium">Project evidence summary</p>
          <p className="mt-1 text-xs opacity-75">{model.extraction.factCount} fact{model.extraction.factCount === 1 ? "" : "s"} · {model.extraction.resourceCount} resource{model.extraction.resourceCount === 1 ? "" : "s"} · {model.extraction.verifiedFactCount} verified claim{model.extraction.verifiedFactCount === 1 ? "" : "s"}</p>
        </div>
      ) : null}

      <ProjectIntelligenceReview isLight={isLight} model={model} />
      <WorkspaceFilesReview isLight={isLight} model={model} />

      {provisioningComplete ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", provisioningRun.state === "partial" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-50"))} role="status">
          <p className="text-sm font-semibold">{provisioningRun.state === "partial" ? "Workspace created with setup pending." : "Workspace created successfully."}</p>
          <p className="mt-1 text-xs opacity-80">{provisioningRun.state === "partial" ? "The workspace is usable now. Finish the listed channels, connections, or automations when you are ready." : "Open the workspace to continue with your team."}</p>
          {provisioningRun.signals.length ? <div className="mt-3 flex flex-wrap gap-1.5">{provisioningRun.signals.slice(0, 8).map((signal, index) => <span key={signal} className={cn("workspace-architect-chip-enter inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] leading-4 motion-reduce:[animation:none]", isLight ? "border-emerald-200 bg-white/70 text-emerald-800" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100")} style={{ animationDelay: `${index * 55}ms` }}>{signal}</span>)}</div> : null}
          {provisioningRun.pendingSetup.channels.length || provisioningRun.pendingSetup.connections.length || provisioningRun.pendingSetup.automations.length ? <p className="mt-3 text-xs font-medium">Some setup remains in the workspace review.</p> : null}
        </div>
      ) : null}

      {provisioningRun?.state === "failed" || provisioningError ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-red-200 bg-red-50 text-red-950" : "border-red-400/20 bg-red-400/10 text-red-100")} role="alert">
          <p className="text-sm font-semibold">Workspace provisioning needs attention.</p>
          <p className="mt-1 text-xs opacity-80">{provisioningError || provisioningRun?.error?.message || "The workspace could not be completed."}</p>
        </div>
      ) : null}

      {freshnessStatus !== "fresh" ? (
        <div className={cn("mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3", freshnessStatus === "stale" ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-[#e5dbd0] bg-white text-[#61554b]" : "border-white/10 bg-white/[0.04] text-slate-300"))} role="status">
          <div><p className="text-sm font-medium">{freshnessStatus === "stale" ? "Project context changed." : "Project context freshness is unknown."}</p><p className="mt-1 text-xs opacity-75">{freshnessStatus === "stale" ? "Review the workspace again before continuing." : "AgentOS could not prove a current knowledge generation."}</p></div>
          <Button type="button" variant="secondary" onClick={onRefreshProject} disabled={isRefreshingProject} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRefreshingProject ? "Refreshing…" : "Refresh project context"}</Button>
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
          <div className="min-w-0"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.2em]", isLight ? "text-[#9a7a62]" : "text-violet-300/75")}>Project</p><h1 className={cn("mt-2 break-words font-display text-2xl font-semibold tracking-[-0.03em]", isLight ? "text-[#32271f]" : "text-white")}>{identity.name}</h1><p className={cn("mt-2 max-w-2xl text-sm leading-6", isLight ? "text-[#766e64]" : "text-slate-300")}>{identity.purpose}</p></div>
          <Badge variant="muted" className="shrink-0">{identity.projectType}</Badge>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ReviewSection isLight={isLight} title="AI Workforce" icon={Bot}>
            <p className={cn("text-sm font-semibold", isLight ? "text-[#3d3027]" : "text-slate-100")}>{model.primaryAgent.name}</p>
            <p className={cn("mt-1 text-xs font-medium", isLight ? "text-[#6f5a4a]" : "text-violet-200/75")}>{model.primaryAgent.role}</p>
            <p className={cn("mt-1 text-xs leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{model.primaryAgent.purpose}</p>
            {model.primaryAgent.responsibilities.length ? <p className={cn("mt-3 text-xs leading-5", isLight ? "text-[#71645a]" : "text-slate-300")}>Responsible for {model.primaryAgent.responsibilities.slice(0, 2).join(" and ")}.</p> : null}
            {model.primaryAgent.outputs.length ? <p className={cn("mt-2 text-xs leading-5", isLight ? "text-[#89796c]" : "text-slate-400")}>Outputs: {model.primaryAgent.outputs.slice(0, 2).join(" · ")}.</p> : null}
            {model.primaryAgent.justification ? <details className="mt-3 text-xs"><summary className={cn("cursor-pointer font-medium", isLight ? "text-[#76604f]" : "text-violet-200/80")}>Why this agent</summary><p className={cn("mt-2 leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{model.primaryAgent.justification}</p></details> : null}
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
    <section className="mt-5 border-t pt-4" style={{ borderColor: isLight ? "rgba(185, 145, 114, 0.18)" : "rgba(255,255,255,0.08)" }} aria-label="Included from your project">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Included from your project</p>
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

function ProjectIntelligenceReview({ isLight, model }: { isLight: boolean; model: WorkspaceBlueprintReviewModel }) {
  if (!model.projectIntelligence) return null;
  const project = model.project;
  return (
    <section className={cn("mb-5 rounded-2xl border p-5", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-labelledby="project-understanding-heading">
      <div className="flex items-start justify-between gap-3"><div><p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-300/75")}>Project understanding</p><h2 id="project-understanding-heading" className={cn("mt-1 text-base font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>{project.name || model.identity.name}</h2></div><span className={cn("text-[11px]", isLight ? "text-[#89796c]" : "text-slate-500")}>{model.sourceSummary.sourceCount} source{model.sourceSummary.sourceCount === 1 ? "" : "s"} · {model.sourceSummary.evidenceCount} evidence</span></div>
      {project.description ? <p className={cn("mt-3 max-w-2xl text-sm leading-6", isLight ? "text-[#766e64]" : "text-slate-300")}>{project.description}</p> : null}
      {project.understanding.length ? <div className="mt-4"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>What we understand</p><div className="mt-2 space-y-1.5">{project.understanding.slice(0, 4).map((item) => <p key={item} className={cn("text-xs leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{item}</p>)}</div></div> : null}
      {project.keyFacts.length ? <div className="mt-4"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Canonical claims</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{project.keyFacts.slice(0, 8).map((fact) => <div key={fact.id} className={cn("rounded-lg border px-3 py-2", isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10")}><div className="flex items-center justify-between gap-2"><span className={cn("truncate text-xs font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{fact.key}</span><span className={cn("shrink-0 text-[10px]", fact.conflicted ? "text-amber-500" : fact.verification === "verified" ? "text-emerald-500" : isLight ? "text-[#9b8d80]" : "text-slate-500")}>{fact.verification}{fact.conflicted ? " · Conflict" : ""}</span></div><p className={cn("mt-1 line-clamp-2 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{fact.statement}</p></div>)}</div></div> : null}
      {project.officialResources.length ? <div className="mt-4"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Resources analyzed</p><div className="mt-2 flex flex-wrap gap-1.5">{project.officialResources.slice(0, 10).map((resource) => <span key={resource.id} className={cn("max-w-full rounded-md border px-2 py-1 text-[11px]", resource.conflicted ? (isLight ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-300/20 bg-amber-300/10 text-amber-100") : resource.verification === "verified" ? (isLight ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100") : (isLight ? "border-[#e4ddd3] bg-[#fcfaf7] text-[#6d645b]" : "border-white/10 bg-white/[0.045] text-slate-300"))} title={resource.locator}>{resource.label} · {resource.category} · {resource.verification}{resource.conflicted ? " · Conflict" : ""}</span>)}</div></div> : null}
      {project.conflicts.length ? <div className={cn("mt-4 rounded-lg border px-3 py-2 text-xs", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")}><span className="font-medium">{project.conflicts.filter((conflict) => conflict.status === "open").length} open project conflict{project.conflicts.filter((conflict) => conflict.status === "open").length === 1 ? "" : "s"}</span><span className="ml-2 opacity-75">Conflicts remain visible without changing claim verification.</span></div> : null}
      {model.coverage.status !== "none" ? <p className={cn("mt-4 text-[11px]", model.coverage.status === "partial" ? "text-amber-500" : isLight ? "text-[#89796c]" : "text-slate-500")}>{model.coverage.status === "full" ? "Good coverage" : "Limited coverage"}{model.coverage.reason ? ` · ${model.coverage.reason}` : ""}</p> : null}
    </section>
  );
}

function WorkspaceFilesReview({ isLight, model }: { isLight: boolean; model: WorkspaceBlueprintReviewModel }) {
  if (!model.workspaceFiles.length) return null;
  return (
    <section className={cn("mb-5 rounded-2xl border p-5", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")} aria-labelledby="workspace-files-heading">
      <div className="flex items-baseline justify-between gap-3"><div><p className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-300/75")}>Workspace files</p><h2 id="workspace-files-heading" className={cn("mt-1 text-base font-semibold", isLight ? "text-[#3d3027]" : "text-white")}>Planned workspace documents</h2></div><span className={cn("text-[11px]", isLight ? "text-[#89796c]" : "text-slate-500")}>{model.workspaceFiles.length} bounded previews</span></div>
      <div className="mt-3 divide-y" style={{ borderColor: isLight ? "#ece3d9" : "rgba(255,255,255,0.08)" }}>{model.workspaceFiles.map((artifact) => <div key={artifact.artifactId} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><FileText className={cn("mt-0.5 h-4 w-4 shrink-0", artifact.operation === "conflict" ? "text-amber-400" : isLight ? "text-[#9a6d45]" : "text-violet-300")} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{artifact.title}</p><span className={cn("text-[10px] uppercase tracking-[0.12em]", artifact.operation === "conflict" ? "text-amber-500" : isLight ? "text-[#9b8d80]" : "text-slate-500")}>{artifact.operation.replace("merge-managed-section", "update")}</span></div><p className={cn("mt-1 truncate text-xs", isLight ? "text-[#807369]" : "text-slate-400")} title={artifact.path}>{artifact.path}</p><p className={cn("mt-1 line-clamp-2 text-xs", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{artifact.preview}</p></div></div>)}</div>
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
  const agentNames = new Map([model.primaryAgent, ...model.specialists].map((agent) => [agent.id, agent.name]));
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {model.capabilities.skills.length || model.capabilities.tools.length ? <ReviewSection isLight={isLight} title="Capabilities" icon={Sparkles}><div className="grid gap-3 sm:grid-cols-2"><div><p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Skills</p><p className={cn("mt-1 text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{model.capabilities.skills.length ? model.capabilities.skills.map((item) => capabilityLabel(item.id)).join(" · ") : "None selected"}</p></div><div><p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Tools</p><p className={cn("mt-1 text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{model.capabilities.tools.length ? model.capabilities.tools.map((item) => capabilityLabel(item.id)).join(" · ") : "None selected"}</p></div></div></ReviewSection> : null}
      <ReviewSection isLight={isLight} title="Memory" icon={FileText}><p className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{model.memory.durableFacts.length ? `${model.memory.durableFacts.length} durable fact${model.memory.durableFacts.length === 1 ? "" : "s"} proposed` : "No custom project memory yet."}</p></ReviewSection>
      {model.connections.length ? <ReviewSection isLight={isLight} title="Connections" icon={Link2}><div className="space-y-1.5">{model.connections.map((connection) => <p key={connection.id} className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}><span className="font-medium">{connection.provider}</span><span className="ml-2 text-xs opacity-70">{connection.status === "recommended" ? "Recommended" : connection.status === "required" ? "Required" : "Selected"}</span></p>)}</div></ReviewSection> : null}
      {model.specialists.length ? <ReviewSection isLight={isLight} title="Additional agents" icon={Bot}><div className="space-y-3">{model.specialists.map((agent) => <div key={agent.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{agent.name}</p><p className={cn("mt-1 text-xs font-medium", isLight ? "text-[#6f5a4a]" : "text-violet-200/75")}>{agent.role}</p><p className={cn("mt-1 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{agent.purpose}</p>{agent.responsibilities.length ? <p className={cn("mt-2 text-xs leading-5", isLight ? "text-[#71645a]" : "text-slate-300")}>Responsible for {agent.responsibilities.slice(0, 2).join(" and ")}.</p> : null}{agent.outputs.length ? <p className={cn("mt-1 text-xs leading-5", isLight ? "text-[#89796c]" : "text-slate-400")}>Outputs: {agent.outputs.slice(0, 2).join(" · ")}.</p> : null}{agent.justification ? <details className="mt-2 text-xs"><summary className={cn("cursor-pointer font-medium", isLight ? "text-[#76604f]" : "text-violet-200/80")}>Why this agent</summary><p className={cn("mt-1 leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{agent.justification}</p></details> : null}</div>)}</div></ReviewSection> : <QuietReviewLine isLight={isLight} label="Additional agents" value="No additional agents needed." />}
      {model.workflows.length ? <ReviewSection isLight={isLight} title="Workflows" icon={WandSparkles}><div className="space-y-3">{model.workflows.map((workflow) => <div key={workflow.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{workflow.name}</p><p className={cn("mt-1 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{workflow.goal}</p><p className={cn("mt-1 text-[11px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>Trigger: {workflow.trigger} · Owner: {agentNames.get(workflow.ownerAgentId) ?? "Primary agent"}</p>{workflow.outputs.length ? <p className={cn("mt-1 text-[11px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>Output: {workflow.outputs.slice(0, 2).join(" · ")}</p> : null}</div>)}</div></ReviewSection> : null}
      {model.automations.length ? <ReviewSection isLight={isLight} title="Automations" icon={RefreshCw}><div className="space-y-3">{model.automations.map((automation) => <div key={automation.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{automation.name}</p><p className={cn("mt-1 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{automation.mission}</p><p className={cn("mt-1 text-[11px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{formatWorkspaceSchedule(automation.scheduleKind, automation.scheduleValue)} · {agentNames.get(automation.agentId) ?? "Primary agent"} · {automation.enabled ? "Enabled" : "Selected"}</p></div>)}</div></ReviewSection> : <QuietReviewLine isLight={isLight} label="Automations" value="No automations added." />}
      {model.channels.length ? <ReviewSection isLight={isLight} title="Channels" icon={MessageCircle}><div className="space-y-2">{model.channels.map((channel) => <div key={channel.id}><p className={cn("text-sm font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{channel.name || channel.type}</p><p className={cn("text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{formatWorkspaceChannelSetup(channel)}</p></div>)}</div></ReviewSection> : null}
      <ReviewSection isLight={isLight} title="Sources analyzed" icon={Globe}><p className={cn("text-sm", isLight ? "text-[#55483e]" : "text-slate-200")}>{model.sourceSummary.sourceCount} source{model.sourceSummary.sourceCount === 1 ? "" : "s"} · {model.sourceSummary.evidenceCount} evidence · {model.sourceSummary.factCount} fact{model.sourceSummary.factCount === 1 ? "" : "s"} · {model.sourceSummary.resourceCount} resource{model.sourceSummary.resourceCount === 1 ? "" : "s"}</p><p className={cn("mt-2 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{model.coverage.status === "none" ? "No project material was staged." : model.coverage.status === "partial" ? `Limited coverage${model.coverage.reason ? ` · ${model.coverage.reason}` : ""}` : "Good coverage"}</p></ReviewSection>
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

function canProvisionBlueprint(
  result: WorkspaceArchitectResult,
  currentFreshness: WorkspaceBlueprintFreshnessResult,
  draftContextId: string | null
) {
  if (!result.validation.valid || result.blueprint.status === "blocked" || currentFreshness.status === "stale") return false;
  if (currentFreshness.status === "fresh") return true;
  return result.blueprint.knowledge.sourceIds.length === 0 || Boolean(draftContextId && result.blueprint.knowledge.generationId === null);
}

function isProvisioningTerminal(state: ProvisioningRun["state"]) {
  return state === "ready" || state === "partial" || state === "failed" || state === "cancelled";
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Provisioning polling was cancelled.", "AbortError"));
    }, { once: true });
  });
}

function formatElapsed(value: number) {
  if (!value || value < 1_000) return "under 1s";
  return `${Math.round(value / 1_000)}s`;
}
