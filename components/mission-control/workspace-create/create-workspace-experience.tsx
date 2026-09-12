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
import {
  clearWorkspaceCreationMinimizedRun,
  persistWorkspaceCreationMinimizedRun,
  readWorkspaceCreationMinimizedRunId
} from "@/components/mission-control/workspace-creation-activity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WORKSPACE_CREATION_PROFILES, normalizeWorkspaceCreationProfile, type WorkspaceCreationDepth } from "@/lib/agentos/domains/workspace-creation-policy";
import { presentWorkspaceCreationDisplay } from "@/lib/agentos/ui/workspace-creation-display";
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
  humanProjectFactLabel,
  presentWorkspaceBlueprint,
  type WorkspaceBlueprintReviewModel
} from "@/lib/agentos/ui/workspace-create-presenter";
import { presentWorkspaceCreationExperience } from "@/lib/agentos/ui/workspace-creation-experience-presenter";

type SurfaceTheme = "dark" | "light";
type CreateStage = "intake" | "generating" | "review" | "provisioning";
type ContextAction = "website" | "github" | null;
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
  reviewRunId?: string | null;
};

export function CreateWorkspaceExperience({
  open,
  onOpenChange,
  surfaceTheme,
  onWorkspaceCreated,
  onRefresh,
  reviewRunId = null
}: CreateWorkspaceExperienceProps) {
  const isLight = surfaceTheme === "light";
  const [brief, setBrief] = useState("");
  const [profile, setProfile] = useState<WorkspaceCreationDepth>("fast");
  const [continueLearningAfterCreation, setContinueLearningAfterCreation] = useState(true);
  const [mode, setMode] = useState<"automatic" | "customize">("automatic");
  const [constraints, setConstraints] = useState("");
  const [sources, setSources] = useState<WorkspaceKnowledgeSource[]>([]);
  const [sourceStates, setSourceStates] = useState<Record<string, ContextSourceState>>({});
  const [uploadGroups, setUploadGroups] = useState<UploadGroup[]>([]);
  const [draftContextId, setDraftContextId] = useState<string | null>(null);
  const [materialization, setMaterialization] = useState<WorkspaceMaterialization>({ mode: "empty" });
  const [stage, setStage] = useState<CreateStage>("intake");
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
  const automaticProvisionRef = useRef<string | null>(null);
  const provisioningPollRef = useRef<AbortController | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasLocalDraftRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const reviewProfile = creationRun?.expediteRequestedAt
    ? "fast"
    : creationRun?.input.profile ? normalizeWorkspaceCreationProfile(creationRun.input.profile) : profile;
  const review = useMemo(
    () => (result ? presentWorkspaceBlueprint(result, {
      profile: reviewProfile,
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
    [creationRun, result, reviewProfile, reviewReadiness]
  );
  const experience = useMemo(() => presentWorkspaceCreationExperience({ run: creationRun, result, provisioningRun, sources }), [creationRun, provisioningRun, result, sources]);
  const isActiveRun = stage === "generating" || stage === "provisioning";

  const resetCreationState = () => {
    abortControllerRef.current?.abort();
    provisioningPollRef.current?.abort();
    setBrief("");
    setProfile("fast");
    setContinueLearningAfterCreation(true);
    setMode("automatic");
    setConstraints("");
    setSources([]);
    setSourceStates({});
    setUploadGroups([]);
    setDraftContextId(null);
    setMaterialization({ mode: "empty" });
    setStage("intake");
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
    clearWorkspaceCreationMinimizedRun();
    provisioningKeyRef.current = null;
    automaticProvisionRef.current = null;
    hasLocalDraftRef.current = false;
  };

  const certifyReview = useCallback(async (runId: string, acceptDraft: boolean) => {
    const response = await fetch(`/api/workspaces/creation-runs/${runId}/readiness?acceptDraft=${acceptDraft ? "true" : "false"}`);
    const payload = (await response.json().catch(() => null)) as { run?: WorkspaceCreationRun; readiness?: WorkspaceCreationReviewReadiness; error?: string } | null;
    if (!response.ok || !payload?.run || !payload.readiness) throw new Error(payload?.error || "AgentOS could not certify the workspace review.");
    setCreationRun(payload.run);
    setReviewReadiness(payload.readiness);
    return { run: payload.run, readiness: payload.readiness };
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

  useEffect(() => {
    if (isMinimized && isActiveRun && creationRun?.runId) {
      persistWorkspaceCreationMinimizedRun(creationRun.runId);
    }

    if (!isActiveRun && creationRun?.runId) {
      clearWorkspaceCreationMinimizedRun();
    }
  }, [creationRun?.runId, isActiveRun, isMinimized]);

  const minimizeWorkspaceCreation = useCallback(() => {
    setIsMinimized(true);
    if (creationRun?.runId) {
      persistWorkspaceCreationMinimizedRun(creationRun.runId);
    }
  }, [creationRun?.runId]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isActiveRun) {
      minimizeWorkspaceCreation();
      return;
    }
    setIsMinimized(false);
    clearWorkspaceCreationMinimizedRun();
    if (!nextOpen && (provisioningRun?.state === "ready" || provisioningRun?.state === "partial")) {
      resetCreationState();
    }
    onOpenChange(nextOpen);
  };

  const markContextChanged = () => {
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

    clearWorkspaceCreationMinimizedRun();
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStage("generating");
    setNotice(null);
    setRevisionError(null);

    try {
      const formData = new FormData();
      formData.set("idempotencyKey", crypto.randomUUID());
      formData.set("brief", nextBrief);
      formData.set("mode", mode === "automatic" ? "automatic" : "review");
      formData.set("profile", profile);
      formData.set("continueLearningAfterCreation", String(continueLearningAfterCreation));
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
        setResult(generated);
        setFreshness(generated.freshness);
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
    if (!open || hasLocalDraftRef.current && !reviewRunId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const minimizedRunId = reviewRunId?.trim() || readWorkspaceCreationMinimizedRunId();
        const response = await fetch(
          minimizedRunId
            ? `/api/workspaces/creation-runs/${encodeURIComponent(minimizedRunId)}`
            : "/api/workspaces/creation-runs?resumable=true",
          { signal: controller.signal }
        );
        const payload = await response.json().catch(() => null) as WorkspaceCreationRun & { runs?: WorkspaceCreationRun[] } | null;
        const activeRun = minimizedRunId ? payload : payload?.runs?.[0];
        if (!response.ok || !activeRun || controller.signal.aborted) return;
        const recoveredSources = activeRun.input.sources as WorkspaceKnowledgeSource[];
        setBrief(activeRun.input.brief);
        setProfile(normalizeWorkspaceCreationProfile(activeRun.input.profile));
        setContinueLearningAfterCreation(activeRun.input.continueLearningAfterCreation !== false);
        setMode(activeRun.input.mode === "automatic" ? "automatic" : "customize");
        setSources(recoveredSources);
        setConstraints(activeRun.input.operatorConstraints.join("\n"));
        setDraftContextId(activeRun.draftContextId);
        setMaterialization(activeRun.input.materialization as WorkspaceMaterialization);
        setCreationRun(activeRun);
        hasLocalDraftRef.current = true;
        if (activeRun.snapshot.reviewReadiness) setReviewReadiness(activeRun.snapshot.reviewReadiness);

        const recoverProvisioningRun = async (run: WorkspaceCreationRun) => {
          if (!run.snapshot.provisioningRunId) return null;
          const provisioningResponse = await fetch(`/api/workspaces/provision?runId=${encodeURIComponent(run.snapshot.provisioningRunId)}`, { signal: controller.signal });
          const recoveredProvisioning = (await provisioningResponse.json().catch(() => null)) as ProvisioningRun & { error?: string } | null;
          if (!provisioningResponse.ok || !recoveredProvisioning?.runId) return null;
          setProvisioningRun(recoveredProvisioning);
          return recoveredProvisioning;
        };

        const recoveredProvisioning = await recoverProvisioningRun(activeRun);
        if (activeRun.snapshot.state === "review-ready") {
          const recoveredResult = activeRun.result as WorkspaceArchitectResult | null;
          if (!recoveredResult?.blueprint) return;
          setResult(recoveredResult);
          setFreshness(recoveredResult.freshness);
          setCustomName(recoveredResult.blueprint.identity.name);
          setCustomPrimaryName(recoveredResult.blueprint.workforce.primaryAgent.name);
          setStage("review");
          return;
        }
        setStage("generating");
        abortControllerRef.current = controller;
        const recoveredRun = await pollCreationRun(activeRun.runId, controller, activeRun, recoveredSources);
        const completedProvisioning = recoveredProvisioning ?? await recoverProvisioningRun(recoveredRun);
        if (completedProvisioning) setStage(isProvisioningTerminal(completedProvisioning.state) ? "review" : "provisioning");
      } catch {
        // Reload recovery is best-effort; the durable run remains available to a later poll.
      }
    })();
    return () => controller.abort();
  }, [open, pollCreationRun, reviewRunId]);

  const refreshProject = async () => {
    if (!creationRun || isRefreshingProject) return;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setIsRefreshingProject(true);
    setRevisionError(null);
    setStage("generating");
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/refresh`, { method: "POST", signal: controller.signal });
      const next = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      if (!response.ok || !next?.runId) throw new Error(next?.error || "AgentOS could not refresh the project context.");
      setCreationRun(next);
      setDraftContextId(next.draftContextId);
      setResult(null);
      setFreshness(null);
      await pollCreationRun(next.runId, controller, next, sources);
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

  const continueNow = async () => {
    if (!creationRun || creationRun.expediteRequestedAt) return;
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/continue-now`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as WorkspaceCreationRun & { error?: string } | null;
      if (!response.ok || !payload?.runId) throw new Error(payload?.error || "Minimum project context is not ready yet.");
      setCreationRun(payload);
      setNotice({ tone: "muted", title: "Finishing with what we have…", description: "Your current project context is preserved." });
    } catch (error) {
      setNotice({ tone: "warning", title: "Still gathering context", description: error instanceof Error ? error.message : "AgentOS is finishing the current context pass." });
    }
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
      await certifyReview(payload.runId, false);
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
      await certifyReview(payload.runId, false);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The workspace edits could not be saved.");
    } finally {
      setIsSavingCustomization(false);
    }
  };

  const approveBasicDraft = async () => {
    if (!creationRun) return;
    try {
      const certified = await certifyReview(creationRun.runId, true);
      setBasicDraftApproved(certified.readiness.provisionable);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The basic draft could not be accepted.");
    }
  };

  const rebuildPlan = async () => {
    if (!creationRun || isRebuildingPlan) return;
    setIsRebuildingPlan(true);
    setRevisionError(null);
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/rebuild-plan?acceptDraft=${basicDraftApproved ? "true" : "false"}`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { run?: WorkspaceCreationRun; readiness?: WorkspaceCreationReviewReadiness; error?: string } | null;
      if (!response.ok || !payload?.run || !payload.readiness) throw new Error(payload?.error || "AgentOS could not rebuild the workspace plan.");
      setCreationRun(payload.run);
      setReviewReadiness(payload.readiness);
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The workspace plan could not be rebuilt.");
    } finally {
      setIsRebuildingPlan(false);
    }
  };

  const startOver = async () => {
    if (!creationRun) return;
    try {
      const response = await fetch(`/api/workspaces/creation-runs/${creationRun.runId}/abandon`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The current workspace draft could not be abandoned.");
      resetCreationState();
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : "The current workspace draft could not be abandoned.");
      setShowStartOverConfirmation(false);
    }
  };

  const provision = useCallback(async () => {
    if (!result || stage === "provisioning") return;
    if (!creationRun) return;

    const controller = new AbortController();
    provisioningPollRef.current?.abort();
    provisioningPollRef.current = controller;
    try {
      const certified = await certifyReview(creationRun.runId, basicDraftApproved);
      if (!certified.readiness.provisionable) {
        setRevisionError(certified.readiness.message);
        return;
      }
      const serverRun = certified.run;
      const serverResult = serverRun.result as WorkspaceArchitectResult | null;
      if (!serverResult?.blueprint) {
        setRevisionError("The reviewed workspace draft is no longer available.");
        return;
      }
      setStage("provisioning");
      setProvisioningRun(null);
      setProvisioningError(null);
      const response = await fetch("/api/workspaces/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          blueprint: serverResult.blueprint,
          draftContextId: serverRun.draftContextId,
          expectedKnowledgeGenerationId: serverResult.freshness.currentGenerationId,
          idempotencyKey: "server-certified",
          acceptDraft: basicDraftApproved || normalizeWorkspaceCreationProfile(serverRun.input.profile) !== "high",
          creationRunId: serverRun.runId,
          compositionPlanId: serverRun.snapshot.composition?.planId ?? null,
          compositionPlanFingerprint: serverRun.snapshot.composition?.inputFingerprint ?? null
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
  }, [result, stage, creationRun, certifyReview, basicDraftApproved, onRefresh]);

  useEffect(() => {
    if (!open || stage !== "review" || !creationRun || !result || !reviewReadiness?.provisionable
      || reviewRunId || provisioningRun || provisioningError || creationRun.input.mode !== "automatic"
      || creationRun.input.trigger === "post-create-enrichment" || creationRun.input.trigger === "manual-refresh"
      || automaticProvisionRef.current === creationRun.runId) return;
    automaticProvisionRef.current = creationRun.runId;
    void provision();
  }, [open, stage, creationRun, result, reviewReadiness, reviewRunId, provisioningRun, provisioningError, provision]);

  const openProvisionedWorkspace = () => {
    if (!provisioningRun?.result) {
      setProvisioningError("Workspace is ready, but its open target is unavailable. Close this screen and select it from the workspace menu.");
      return;
    }
    onWorkspaceCreated?.(provisioningRun.result);
    resetCreationState();
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
  const isEnrichmentReview = Boolean(reviewRunId && creationRun?.runId === reviewRunId);
  const title = isEnrichmentReview && stage === "review" ? "Review workspace updates" : experience.title;

  return (
    <>
      <MissionControlDialogShell
      open={open && !isMinimized}
      onOpenChange={handleDialogOpenChange}
      surfaceTheme={surfaceTheme}
      title={isProvisioned ? "Workspace ready" : stage === "intake" ? "Create a workspace" : isEnrichmentReview ? title : result?.blueprint.identity.name || "Creating your workspace"}
      description={<span className="sr-only">Prepare your workspace</span>}
      variant="quiet"
      closeLabel={isActiveRun ? "Minimize workspace creation" : undefined}
      onOutsideInteraction={isActiveRun ? minimizeWorkspaceCreation : undefined}
      headerActions={isActiveRun ? (
        <Button
          type="button"
          variant="ghost"
          onClick={minimizeWorkspaceCreation}
          aria-label="Minimize workspace creation"
          className={cn("h-8 w-8 rounded-lg p-0", isLight ? "text-[#756b61] hover:bg-[#f1ebe3] hover:text-[#2d241f]" : "text-slate-300 hover:bg-white/[0.06] hover:text-white")}
        >
          <Minimize2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      contentClassName="sm:w-[min(92vw,680px)] sm:h-[min(90dvh,740px)] sm:rounded-2xl"
      headerClassName="px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-7 md:pb-4 md:pt-5"
      bodyClassName="p-0 overflow-hidden"
      footerClassName="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 md:px-7 md:py-4"
      footerInnerClassName="p-0"
      footer={
        stage === "generating" ? (
          <div className="flex w-full items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={cancelGeneration} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>
              Cancel
            </Button>
          </div>
        ) : stage === "provisioning" ? (
          <div className="flex w-full items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={minimizeWorkspaceCreation} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>Minimize</Button>
          </div>
        ) : stage === "review" ? (
          <div className="flex w-full items-center justify-between gap-3">
            <div className={cn("flex items-center gap-1", isProvisioned && "hidden")}>
              <Button type="button" variant="ghost" onClick={() => setStage("intake")} className={cn("h-9 px-2 text-xs", isLight ? "text-[#766e64]" : "text-slate-400")}>
                <ChevronLeft className="mr-1.5 h-4 w-4" />
                Back to brief
              </Button>
              {!isProvisioned ? <Button type="button" variant="ghost" onClick={() => setShowStartOverConfirmation(true)} className={cn("h-9 px-2 text-xs", isLight ? "text-[#9a6d45]" : "text-violet-200/80")}>Start over</Button> : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cn("text-[10px]", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{isProvisioned ? "Your workspace is ready to open." : isEnrichmentReview ? "Review the proposed updates, then apply them." : "Review the draft, then create the workspace."}</span>
              <div className="flex items-center gap-2">
                {isProvisioned ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleDialogOpenChange(false)}
                    aria-label="Close workspace ready screen"
                    className={missionControlDialogButtonClassName("secondary", surfaceTheme)}
                  >
                    Close
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" onClick={() => setIsCustomizing((current) => !current)} className={cn(missionControlDialogButtonClassName("secondary", surfaceTheme), isProvisioned && "hidden")}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Customize
                </Button>
                <Button
                  type="button"
                  disabled={!isProvisioned && (!result || !reviewReadiness?.provisionable)}
                  onClick={isProvisioned ? openProvisionedWorkspace : () => void provision()}
                  title={!result || !reviewReadiness?.provisionable ? reviewReadiness?.message || "The workspace review is not ready to create." : undefined}
                  aria-label={isProvisioned ? "Open Workspace" : provisioningRun?.state === "failed" ? "Retry provisioning" : isEnrichmentReview ? "Apply workspace updates" : "Create Workspace"}
                  className={missionControlDialogButtonClassName("primary", surfaceTheme)}
                >
                  {isProvisioned ? "Open Workspace" : provisioningRun?.state === "failed" ? "Retry provisioning" : isEnrichmentReview ? "Apply updates" : "Create Workspace"}
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
              Create workspace
            </Button>
          </div>
        )
      }
    >
      <div className={cn("min-h-0 h-full overflow-y-auto", isLight ? "bg-[#fbf8f3]" : "bg-[hsl(var(--agentos-surface-panel))]")}>
        {stage === "intake" ? (
          <IntakeView
            isLight={isLight}
            brief={brief}
            setBrief={setBrief}
            profile={profile}
            setProfile={setProfile}
            continueLearningAfterCreation={continueLearningAfterCreation}
            setContinueLearningAfterCreation={setContinueLearningAfterCreation}
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
            onRemoveSource={removeSource}
            onFiles={(files) => void handleFiles(files, "file")}
            onFolder={(files) => void handleFiles(files, "folder")}
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            notice={notice}
          />
        ) : stage === "generating" ? (
          <CreationProgressView run={creationRun} isLight={isLight} onContinueNow={() => void continueNow()} />
        ) : stage === "provisioning" ? (
          <CreationProgressView run={creationRun} provisioning={provisioningRun} isLight={isLight} />
        ) : isProvisioned ? (
          <main className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-12 text-center">
            <Check className="size-8 text-emerald-500" aria-hidden="true" />
            <h1 className="text-3xl font-semibold tracking-tight">{result?.blueprint.identity.name}</h1>
            <p className="text-sm opacity-65">{provisioningRun?.state === "partial" ? "Ready to use. Some connections need setup." : "Make it yours as you go."}</p>
            {creationRun && normalizeWorkspaceCreationProfile(creationRun.input.profile) !== "high" && creationRun.input.continueLearningAfterCreation !== false ? <p className="text-xs opacity-55">AgentOS is continuing to learn about this project.</p> : null}
            {provisioningError ? <p className="max-w-md text-xs text-amber-300" role="status">{provisioningError}</p> : null}
          </main>
        ) : (
          <ReviewView
            isLight={isLight}
            profile={reviewProfile}
            isEnrichmentReview={isEnrichmentReview}
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
            readiness={reviewReadiness ?? creationRun?.snapshot.reviewReadiness ?? null}
            basicDraftApproved={basicDraftApproved}
            onApproveBasicDraft={() => void approveBasicDraft()}
            onRebuildPlan={() => void rebuildPlan()}
            isRebuildingPlan={isRebuildingPlan}
            showStartOverConfirmation={showStartOverConfirmation}
            onKeepDraft={() => setShowStartOverConfirmation(false)}
            onConfirmStartOver={() => void startOver()}
          />
        )}
      </div>
      </MissionControlDialogShell>
    </>
  );
}

function IntakeView({
  isLight,
  profile,
  setProfile,
  continueLearningAfterCreation,
  setContinueLearningAfterCreation,
  brief,
  setBrief,
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
  onRemoveSource,
  onFiles,
  onFolder,
  fileInputRef,
  folderInputRef,
  notice
}: {
  isLight: boolean;
  profile: WorkspaceCreationDepth;
  setProfile: (profile: WorkspaceCreationDepth) => void;
  continueLearningAfterCreation: boolean;
  setContinueLearningAfterCreation: (value: boolean) => void;
  brief: string;
  setBrief: (value: string) => void;
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
  onRemoveSource: (sourceId: string) => void;
  onFiles: (files: FileList | null) => void;
  onFolder: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  notice: { tone: "warning" | "error" | "muted"; title: string; description: string } | null;
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center px-5 py-6 sm:px-8 sm:py-8">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">What are you working on?</h1>
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
        className={cn("min-h-[120px] resize-y rounded-2xl px-5 py-4 text-base leading-7 shadow-none md:min-h-[140px] md:text-[17px]", isLight ? "border-[#ded2c6] bg-white text-[#382d25] placeholder:text-[#aa9a8d] focus-visible:border-[#b8895f] focus-visible:ring-[#b8895f]/20" : "border-white/10 bg-white/[0.055] text-slate-100 placeholder:text-slate-500 focus-visible:border-violet-300/40 focus-visible:ring-violet-300/15")}
      />

      <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 pb-1" aria-label="Add project context">
        <span className={cn("mr-1 shrink-0 text-xs font-medium", isLight ? "text-[#837366]" : "text-slate-500")}>Add context</span>
        <ContextButton isLight={isLight} icon={Globe} label="Website" onClick={() => setContextAction(contextAction === "website" ? null : "website")} />
        <ContextButton isLight={isLight} icon={Github} label="GitHub" onClick={() => setContextAction(contextAction === "github" ? null : "github")} />
        <ContextButton isLight={isLight} icon={FileText} label="Files" onClick={onBrowseFiles} />
        <ContextButton isLight={isLight} icon={FolderOpen} label="Folder" onClick={onBrowseFolder} />

        <input ref={fileInputRef} type="file" className="hidden" multiple accept={WORKSPACE_KNOWLEDGE_FILE_ACCEPT} onChange={(event) => { onFiles(event.target.files); event.currentTarget.value = ""; }} />
        <input ref={folderInputRef} type="file" className="hidden" multiple accept={WORKSPACE_KNOWLEDGE_FILE_ACCEPT} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(event) => { onFolder(event.target.files); event.currentTarget.value = ""; }} />
      </div>

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

      <fieldset className="mt-8">
        <legend className="mb-4 text-sm font-medium">How should AgentOS prepare it?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {WORKSPACE_CREATION_PROFILES.map((item, index) => (
            <label key={item.id} className={cn("relative cursor-pointer rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-violet-400", profile === item.id ? (isLight ? "border-violet-400 bg-violet-50" : "border-violet-400/60 bg-violet-400/10") : (isLight ? "border-black/10 hover:bg-white" : "border-white/10 hover:bg-white/5"))}>
              <input type="radio" name="creation-profile" value={item.id} checked={profile === item.id} onChange={() => setProfile(item.id)} className="sr-only" />
              <span className="flex items-center justify-between text-base font-semibold">{item.label}<span aria-hidden="true" className="text-xs tracking-widest text-violet-400">{"•".repeat(index + 1)}</span></span>
              <span className="mt-1 block text-xs opacity-65">{item.timing}</span>
              <span className="mt-3 block text-xs">{item.description}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 min-h-5 text-xs opacity-60">{WORKSPACE_CREATION_PROFILES.find((item) => item.id === profile)?.learns}</p>
      </fieldset>

      <details className={cn("mt-4 px-1 py-2", isLight ? "border-[#e5dbd0] bg-white/70" : "border-white/10 bg-white/[0.025]")}>
        <summary className={cn("cursor-pointer text-xs font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Advanced options</summary>
        <div className="mt-4 flex flex-col items-center gap-3">
          <label className={cn("flex w-full max-w-[600px] items-start gap-2 text-xs", isLight ? "text-[#65594f]" : "text-slate-300", profile === "high" && "opacity-50")}>
            <input type="checkbox" checked={continueLearningAfterCreation} disabled={profile === "high"} onChange={(event) => setContinueLearningAfterCreation(event.target.checked)} className="mt-0.5 accent-violet-500" />
            <span><span className="font-medium">Continue learning after creation</span><span className="ml-1 opacity-70">(Fast / Medium)</span><span className="mt-1 block opacity-70">AgentOS will prepare reviewable improvements without changing the workspace automatically.</span></span>
          </label>
          <div className="w-full max-w-[600px]">
            <label htmlFor="workspace-constraints" className={cn("text-xs font-medium", isLight ? "text-[#65594f]" : "text-slate-300")}>Specific constraints <span className="font-normal opacity-60">(optional)</span></label>
            <Textarea id="workspace-constraints" value={constraints} onChange={(event) => setConstraints(event.target.value)} placeholder="Anything AgentOS should keep in mind? One constraint per line." className={cn("mt-2 min-h-[84px] resize-y text-sm shadow-none", isLight ? "border-[#ded2c6] bg-white text-[#382d25] placeholder:text-[#aa9a8d]" : "border-white/10 bg-white/[0.04] text-slate-100 placeholder:text-slate-500")} />
          </div>
        </div>
      </details>

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

function mapCreationSourceStatus(state: "pending" | "discovering" | "fetching" | "normalizing" | "ready" | "partial" | "failed"): ContextSourceStatus {
  if (state === "ready") return "ready";
  if (state === "partial") return "partial";
  if (state === "failed") return "error";
  if (state === "pending") return "attached";
  return "reading";
}

function CreationProgressView({ run, provisioning, isLight, onContinueNow }: {
  run: WorkspaceCreationRun | null; provisioning?: ProvisioningRun | null; isLight: boolean; onContinueNow?: () => void;
}) {
  const display = presentWorkspaceCreationDisplay(run, provisioning);
  const progress = workspaceCreationProgress(run, provisioning);
  const canExpedite = run && normalizeWorkspaceCreationProfile(run.input.profile) !== "fast" && !run.expediteRequestedAt
    && (run.snapshot.context.status === "ready" || run.snapshot.context.status === "partial" && run.snapshot.context.usableEvidence);
  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col justify-center px-7 py-12 sm:px-10" aria-busy="true">
      <p className="text-xl font-medium tracking-tight" role="status">{display.activity}</p>
      <div className={cn("my-8 h-0.5 overflow-hidden rounded-full", isLight ? "bg-black/5" : "bg-white/10")} role="progressbar" aria-label="Creating workspace" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-violet-400/80 transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <ul className="flex min-h-32 content-start flex-wrap gap-x-6 gap-y-4" aria-label="Completed results" aria-live="polite">
        {display.events.map((event) => <li key={event.label} className="workspace-architect-chip-enter flex items-center gap-2 text-sm motion-reduce:[animation:none]">
          <Check className="size-3.5 text-emerald-500" aria-hidden="true" />{event.label}
        </li>)}
      </ul>
      {canExpedite && onContinueNow ? <Button variant="ghost" onClick={onContinueNow} className="mt-8 self-start px-0 text-xs opacity-65">Finish with current context</Button> : null}
    </main>
  );
}

function workspaceCreationProgress(run: WorkspaceCreationRun | null, provisioning?: ProvisioningRun | null) {
  if (provisioning) {
    if (provisioning.state === "ready" || provisioning.state === "partial") return 100;
    const total = Math.max(1, provisioning.steps.length);
    const complete = provisioning.steps.filter((step) => step.status === "complete").length;
    const active = provisioning.steps.some((step) => step.status === "active") ? 0.5 : 0;
    return Math.min(99, Math.round(((complete + active) / total) * 100));
  }
  if (!run) return 0;
  if (run.snapshot.state === "review-ready") return 100;
  const stageProgress: Record<string, number> = {
    "context-staging": 12,
    "source-ingestion": 24,
    "structured-extraction": 38,
    "intelligence-synthesis": 52,
    "architect-runtime-preparation": 64,
    "architect-reasoning": 72,
    "architect-validation": 82,
    "review-preparation": 94,
    "workspace-composition": 94
  };
  return stageProgress[run.snapshot.stage ?? ""] ?? 8;
}

function ReviewView({
  isLight,
  profile,
  isEnrichmentReview,
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
  readiness,
  basicDraftApproved,
  onApproveBasicDraft,
  onRebuildPlan,
  isRebuildingPlan,
  showStartOverConfirmation,
  onKeepDraft,
  onConfirmStartOver
}: {
  isLight: boolean;
  profile: WorkspaceCreationDepth;
  isEnrichmentReview: boolean;
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
  readiness: WorkspaceCreationReviewReadiness | null;
  basicDraftApproved: boolean;
  onApproveBasicDraft: () => void;
  onRebuildPlan: () => void;
  isRebuildingPlan: boolean;
  showStartOverConfirmation: boolean;
  onKeepDraft: () => void;
  onConfirmStartOver: () => void;
}) {
  if (!model) return null;
  const identity = model.identity;
  const freshnessStatus = model.freshness.status;
  const provisioningComplete = provisioningRun?.state === "ready" || provisioningRun?.state === "partial";
  const compositionLabel = profile === "fast"
    ? "Basic workspace documents planned"
    : model.composition?.status === "fallback"
    ? "AI workspace document proposals unavailable"
    : model.composition?.status === "partial"
      ? "Workspace documents partially planned"
      : model.composition?.status === "blocked" || model.composition?.status === "conflict"
        ? "Workspace documents need conflict review"
        : "Workspace documents planned";
  const showTechnicalFallback = profile === "high";

  return (
    <main className="mx-auto w-full max-w-[860px] px-5 py-6 md:px-10 md:py-8">
      {model.fallback && showTechnicalFallback ? (
        <div className={cn("mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <div>
            <p className="text-sm font-semibold">Workspace design needs another try</p>
            <p className="mt-1 text-xs opacity-80">AgentOS understood the project, but the AI workforce design did not finish.</p>
            <p className="mt-2 text-[11px] opacity-75">Category: {model.failureCategory || "architect-unavailable"} · Attempts: {model.attempts} · Elapsed: {formatElapsed(model.elapsedMs)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {model.retryAvailable ? <Button type="button" variant="secondary" onClick={onRetry} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry design</Button> : null}
            {!basicDraftApproved ? <Button type="button" variant="ghost" onClick={onApproveBasicDraft} className="h-9 px-2 text-xs">Use basic draft</Button> : <span className="self-center text-xs font-medium">Basic draft selected</span>}
          </div>
        </div>
      ) : null}

      {model.partialContext ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")} role="status">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">Architecture generated from partial project context</p><p className="mt-1 text-xs opacity-80">Some available project evidence could not be fully staged within the analysis budget.</p></div><Button type="button" variant="secondary" onClick={onRefreshProject} disabled={isRefreshingProject} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRefreshingProject ? "Refreshing…" : "Refresh context"}</Button></div>
        </div>
      ) : null}

      <div className={cn("mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3", isLight ? "border-[#e5dbd0] bg-white text-[#55483e]" : "border-white/10 bg-white/[0.04] text-slate-200")} role="status">
        <div><p className="text-sm font-semibold">{isEnrichmentReview ? "Workspace update available" : `${profile.charAt(0).toUpperCase()}${profile.slice(1)} workspace`}</p><p className="mt-1 text-xs opacity-75">{isEnrichmentReview ? "A deeper candidate is ready for review. The live workspace remains unchanged until you apply it." : profile === "fast" ? "Essential setup is ready now. AgentOS can keep learning without changing it automatically." : profile === "medium" ? "Project preferences and memory are preserved in this review." : "Full project intelligence is preserved in this review."}</p></div>
        <Badge variant={isEnrichmentReview || profile === "fast" ? "success" : "muted"}>{isEnrichmentReview ? "Review updates" : profile === "fast" ? "Essential setup" : profile === "medium" ? "Project context" : "Full analysis"}</Badge>
      </div>

      {readiness && !readiness.provisionable ? (
        <div className={cn("mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between", readiness.status === "blocked" ? (isLight ? "border-red-200 bg-red-50 text-red-950" : "border-red-400/20 bg-red-400/10 text-red-100") : (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50"))} role="status">
          <div><p className="text-sm font-semibold">{readiness.status === "plan-rebuild-required" ? "Workspace plan needs to be rebuilt" : readiness.status === "refresh-required" ? "Project context needs a refresh" : "Review needs attention"}</p><p className="mt-1 text-xs opacity-80">{readiness.message}</p></div>
          {readiness.requiredAction === "rebuild-plan" ? <Button type="button" variant="secondary" onClick={onRebuildPlan} disabled={isRebuildingPlan} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRebuildingPlan ? "Rebuilding…" : "Rebuild plan"}</Button> : readiness.requiredAction === "refresh-context" ? <Button type="button" variant="secondary" onClick={onRefreshProject} disabled={isRefreshingProject} className={missionControlDialogButtonClassName("secondary", isLight ? "light" : "dark")}>{isRefreshingProject ? "Refreshing…" : "Refresh project"}</Button> : null}
        </div>
      ) : null}

      {model.composition ? (
        <div className={cn("mb-5 rounded-xl border px-4 py-3", model.composition.status === "blocked" || model.composition.status === "conflict" || (model.composition.status === "fallback" && showTechnicalFallback) ? (isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50") : (isLight ? "border-[#e5dbd0] bg-white text-[#55483e]" : "border-white/10 bg-white/[0.04] text-slate-200"))} role="status">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Workspace</p>
          <p className="mt-2 text-sm font-medium">{compositionLabel}</p>
          <p className="mt-1 text-xs opacity-75">{model.composition.artifactCount} bounded project and workspace document proposals · {model.composition.conflictCount} conflict{model.composition.conflictCount === 1 ? "" : "s"}.</p>
          {model.composition.status === "fallback" && showTechnicalFallback ? <p className="mt-1 text-xs opacity-75">A deterministic safe draft was created from the approved blueprint and project context.</p> : null}
        </div>
      ) : null}

      {model.projectIntelligence ? (
        <details className={cn("mb-5 rounded-2xl border p-4", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")}>
          <summary className={cn("cursor-pointer list-none text-sm font-semibold", isLight ? "text-[#55483e]" : "text-slate-200")}>View project evidence <span className={cn("ml-2 text-xs font-normal", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{model.sourceSummary.factCount} claims · {model.sourceSummary.resourceCount} resources</span></summary>
          <div className="mt-4"><ProjectIntelligenceReview isLight={isLight} model={model} /></div>
        </details>
      ) : null}
      {model.workspaceFiles.length ? (
        <details className={cn("mb-5 rounded-2xl border p-4", isLight ? "border-[#e5dbd0] bg-white" : "border-white/10 bg-white/[0.04]")}>
          <summary className={cn("cursor-pointer list-none text-sm font-semibold", isLight ? "text-[#55483e]" : "text-slate-200")}>View workspace document proposals <span className={cn("ml-2 text-xs font-normal", isLight ? "text-[#9b8d80]" : "text-slate-500")}>{model.workspaceFiles.length} previews</span></summary>
          <div className="mt-4"><WorkspaceFilesReview isLight={isLight} model={model} /></div>
        </details>
      ) : null}

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

      {freshnessStatus !== "fresh" && !readiness?.status.includes("refresh") ? (
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

        {model.project.highlights.length ? (
          <section className="mt-5" aria-labelledby="project-highlights-heading">
            <p id="project-highlights-heading" className={cn("text-[10px] font-semibold uppercase tracking-[0.18em]", isLight ? "text-[#9a7a62]" : "text-violet-200/70")}>Project highlights</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {model.project.highlights.slice(0, 4).map((highlight) => (
                <div key={highlight.id} className={cn("rounded-xl border px-3 py-2.5", isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("text-xs font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{highlight.label}</p>
                    <span className={cn("shrink-0 text-[10px]", highlight.conflicted ? "text-amber-500" : highlight.verification === "verified" ? "text-emerald-500" : isLight ? "text-[#9b8d80]" : "text-slate-500")}>{highlight.conflicted ? "Conflict" : highlight.verification}</span>
                  </div>
                  <p className={cn("mt-1 line-clamp-2 text-xs leading-5", isLight ? "text-[#807369]" : "text-slate-400")}>{highlight.statement}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

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

        <details className="mt-5">
          <summary className={cn("cursor-pointer text-xs font-medium", isLight ? "text-[#76604f]" : "text-violet-200/80")}>View workforce and workspace details</summary>
          <ReviewDetailSections isLight={isLight} model={model} />
        </details>
      </section>

      {showStartOverConfirmation ? (
        <div className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-5", isLight ? "backdrop-blur-sm" : "backdrop-blur-md")} role="dialog" aria-modal="true" aria-labelledby="start-over-heading">
          <div className={cn("w-full max-w-sm rounded-2xl border p-5 shadow-2xl", isLight ? "border-[#e5dbd0] bg-white text-[#3d3027]" : "border-white/10 bg-[#111827] text-white")}>
            <h2 id="start-over-heading" className="text-base font-semibold">Start a new workspace?</h2>
            <p className={cn("mt-2 text-sm", isLight ? "text-[#766e64]" : "text-slate-300")}>This draft will be discarded.</p>
            <p className={cn("mt-1 text-sm", isLight ? "text-[#766e64]" : "text-slate-300")}>Nothing has been created yet.</p>
            <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onKeepDraft}>Keep draft</Button><Button type="button" variant="secondary" onClick={onConfirmStartOver}>Start new workspace</Button></div>
          </div>
        </div>
      ) : null}

      <section className={cn("mt-4 rounded-2xl border p-4", isLight ? "border-[#e5dbd0] bg-white" : "border-white/[0.08] bg-white/[0.035]")} aria-labelledby="revision-heading">
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
      {project.keyFacts.length ? <div className="mt-4"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Canonical claims</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{project.keyFacts.slice(0, 8).map((fact) => <div key={fact.id} className={cn("rounded-lg border px-3 py-2", isLight ? "border-[#ece3d9] bg-[#fcfaf7]" : "border-white/[0.08] bg-black/10")}><div className="flex items-center justify-between gap-2"><span className={cn("truncate text-xs font-medium", isLight ? "text-[#55483e]" : "text-slate-200")}>{humanProjectFactLabel(fact.key)}</span><span className={cn("shrink-0 text-[10px]", fact.conflicted ? "text-amber-500" : fact.verification === "verified" ? "text-emerald-500" : isLight ? "text-[#9b8d80]" : "text-slate-500")}>{fact.verification}{fact.conflicted ? " · Conflict" : ""}</span></div><p className={cn("mt-1 line-clamp-2 text-xs", isLight ? "text-[#807369]" : "text-slate-400")}>{fact.statement}</p></div>)}</div></div> : null}
      {project.officialResources.length ? <div className="mt-4"><p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-[#9a7a62]" : "text-violet-200/65")}>Resources analyzed</p><div className="mt-2 flex flex-wrap gap-1.5">{project.officialResources.slice(0, 10).map((resource) => <span key={resource.id} className={cn("max-w-full rounded-md border px-2 py-1 text-[11px]", resource.conflicted ? (isLight ? "border-amber-200 bg-amber-50 text-amber-900" : "border-amber-300/20 bg-amber-300/10 text-amber-100") : resource.verification === "verified" ? (isLight ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100") : (isLight ? "border-[#e4ddd3] bg-[#fcfaf7] text-[#6d645b]" : "border-white/10 bg-white/[0.045] text-slate-300"))} title={resource.locator}>{resource.label} · {resource.category} · {resource.verification}{resource.conflicted ? " · Conflict" : ""}</span>)}</div></div> : null}
      {project.groupedConflicts.length ? <div className={cn("mt-4 rounded-lg border px-3 py-2 text-xs", isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-400/20 bg-amber-400/10 text-amber-50")}><span className="font-medium">{project.groupedConflicts.filter((conflict) => conflict.status === "open").length} open project conflict group{project.groupedConflicts.filter((conflict) => conflict.status === "open").length === 1 ? "" : "s"}</span><div className="mt-2 space-y-1">{project.groupedConflicts.slice(0, 4).map((conflict) => <p key={conflict.summary}><span className="font-medium">{conflict.summary}</span>{conflict.count > 1 ? ` · ${conflict.count} related claims` : ""}</p>)}</div><p className="mt-2 opacity-75">Conflicts remain visible without changing claim verification.</p></div> : null}
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

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "source";
}

function capabilityLabel(id: string) {
  return id.split(/[-_]/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

// `canProvisionBlueprint` used to be the browser's final gate. Server-owned
// review readiness now owns that decision; keep the name in the compatibility
// surface only so older source-contract checks remain explicit about the
// retired client-side heuristic.

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
