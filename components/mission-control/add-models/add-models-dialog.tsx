"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { CircleCheckBig, Copy, LoaderCircle, RefreshCw, SquareTerminal } from "lucide-react";

import { CustomProviderCard } from "@/components/mission-control/add-models/custom-provider-card";
import { GlobalModelPicker } from "@/components/mission-control/add-models/global-model-picker";
import { ModelPicker } from "@/components/mission-control/add-models/model-picker";
import { ProviderCard } from "@/components/mission-control/add-models/provider-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  modelProviderRegistry,
  buildExplicitModelProviderDescriptor,
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId,
  normalizeAddModelsProviderId,
  normalizeExplicitProviderId
} from "@/lib/openclaw/model-provider-registry";
import { getModelProviderAdapter, ModelProviderActionError } from "@/lib/openclaw/model-provider-adapters";
import { modelMatchesAddModelsProvider } from "@/lib/openclaw/domains/model-provider-connection";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsFlowState,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

type ProviderDraft = {
  flowState: AddModelsFlowState;
  connection: AddModelsProviderConnectionStatus | null;
  statusMessage: string | null;
  errorMessage: string | null;
  emptyState: AddModelsEmptyState | null;
  manualCommand: string | null;
  docsUrl: string | null;
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  providerName: string;
  providerId: string;
  apiKey: string;
  endpoint: string;
  manualModelId: string;
  search: string;
  loaded: boolean;
};

type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;

const initialDraftState = (): ProviderDraft => ({
  flowState: "idle",
  connection: null,
  statusMessage: null,
  errorMessage: null,
  emptyState: null,
  manualCommand: null,
  docsUrl: null,
  models: [],
  selectedModelIds: [],
  providerName: "",
  providerId: "",
  apiKey: "",
  endpoint: "",
  manualModelId: "",
  search: "",
  loaded: false
});

const CATALOG_PAGE_SIZE = 5;

export function AddModelsDialog({
  open,
  onOpenChange,
  snapshot,
  initialProvider = null,
  onSnapshotChange,
  onProviderSnapshotReady,
  surfaceTheme = "dark"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  initialProvider?: AddModelsProviderId | null;
  onSnapshotChange: (snapshot: MissionControlSnapshot) => void;
  onProviderSnapshotReady?: (snapshot: MissionControlSnapshot) => void;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const normalizedInitialProvider = normalizeAddModelsProviderId(initialProvider);
  const [activeTab, setActiveTab] = useState<"catalog" | "providers">("providers");
  const [activeProvider, setActiveProvider] = useState<AddModelsProviderId | null>(normalizedInitialProvider);
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<string, ProviderDraft>>>({});
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const [isAddingCatalogModels, setIsAddingCatalogModels] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [globalCatalogModels, setGlobalCatalogModels] = useState<GlobalCatalogModel[]>([]);
  const [isLoadingGlobalCatalog, setIsLoadingGlobalCatalog] = useState(false);
  const [globalCatalogError, setGlobalCatalogError] = useState<string | null>(null);
  const [activeSetupMode, setActiveSetupMode] = useState<"standard" | "custom-openai-compatible">("standard");
  const [explicitProviderIds, setExplicitProviderIds] = useState<string[]>([]);
  const handleInitialProviderOpen = useEffectEvent((providerId: AddModelsProviderId) => {
    setActiveSetupMode("standard");
    setActiveTab("providers");
    void selectProvider(providerId);
  });
  const loadGlobalCatalog = useEffectEvent(async () => {
    setIsLoadingGlobalCatalog(true);
    setGlobalCatalogError(null);

    try {
      const response = await fetch("/api/models/catalog");
      const payload = (await response.json().catch(() => null)) as
        | {
            models?: GlobalCatalogModel[];
            error?: string;
          }
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "OpenClaw catalog could not be loaded.");
      }

      setGlobalCatalogModels(Array.isArray(payload.models) ? payload.models : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw catalog could not be loaded.";
      setGlobalCatalogModels([]);
      setGlobalCatalogError(message);
      toast.error("OpenClaw catalog could not be loaded.", {
        description: message
      });
    } finally {
      setIsLoadingGlobalCatalog(false);
    }
  });
  const loadExplicitProviders = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/models/providers");
      const payload = (await response.json().catch(() => null)) as
        | {
            providers?: Array<{
              id?: string;
              baseUrl?: string | null;
              modelCount?: number;
            }>;
            error?: string;
          }
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Custom providers could not be loaded.");
      }

      const providerSummaries = Array.isArray(payload.providers) ? payload.providers : [];
      const providerIds = providerSummaries
        .map((provider) => normalizeAddModelsProviderId(provider.id))
        .filter((providerId): providerId is AddModelsProviderId => Boolean(providerId));

      setExplicitProviderIds(providerIds);
      setProviderDrafts((current) => {
        const next = { ...current };

        for (const provider of providerSummaries) {
          const providerId = normalizeAddModelsProviderId(provider.id);

          if (!providerId) {
            continue;
          }

          const currentDraft = resolveDraft(next[providerId]);
          next[providerId] = {
            ...currentDraft,
            endpoint: provider.baseUrl ?? currentDraft.endpoint,
            connection: {
              provider: providerId,
              connected: Boolean(provider.baseUrl),
              canConnect: true,
              needsTerminal: false,
              source: "explicit-provider-config",
              detail: provider.baseUrl
                ? `${provider.modelCount ?? 0} configured model${provider.modelCount === 1 ? "" : "s"} in OpenClaw. Endpoint: ${provider.baseUrl}.`
                : "Custom provider is configured in OpenClaw."
            },
            loaded: currentDraft.loaded
          };
        }

        return next;
      });
    } catch (error) {
      toast.error("Custom providers could not be loaded.", {
        description: error instanceof Error ? error.message : "OpenClaw provider config could not be read."
      });
    }
  });

  useEffect(() => {
    if (!open) {
      setActiveTab("providers");
      setActiveProvider(null);
      setActiveSetupMode("standard");
      setCatalogSearch("");
      setCatalogVisibleCount(CATALOG_PAGE_SIZE);
      setGlobalCatalogModels([]);
      setGlobalCatalogError(null);
      setIsLoadingGlobalCatalog(false);
      setProviderDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).map(([providerId, draft]) => [
            providerId,
            {
              ...draft,
              flowState: "idle",
              statusMessage: null,
              errorMessage: null,
              selectedModelIds: [],
              providerName: "",
              providerId: "",
              apiKey: "",
              endpoint: "",
              manualModelId: "",
              search: ""
            }
          ])
    ) as Partial<Record<string, ProviderDraft>>
      );
      setIsOpeningTerminal(false);
      setIsAddingCatalogModels(false);
      return;
    }

    if (normalizedInitialProvider) {
      handleInitialProviderOpen(normalizedInitialProvider);
    } else {
      setActiveSetupMode("standard");
      setActiveTab("providers");
    }

    void loadExplicitProviders();
  }, [open, normalizedInitialProvider]);

  useEffect(() => {
    if (!open || activeTab !== "catalog" || globalCatalogModels.length > 0 || isLoadingGlobalCatalog) {
      return;
    }

    void loadGlobalCatalog();
  }, [open, activeTab, globalCatalogModels.length, isLoadingGlobalCatalog]);

  const explicitProviderDescriptors = useMemo(
    () =>
      explicitProviderIds.map((providerId) =>
        buildExplicitModelProviderDescriptor(providerId, resolveDraft(providerDrafts[providerId]).providerName)
      ),
    [explicitProviderIds, providerDrafts]
  );
  const providerDescriptors = useMemo(
    () => [...modelProviderRegistry, ...explicitProviderDescriptors],
    [explicitProviderDescriptors]
  );
  const activeProviderId = isAddModelsProviderId(activeProvider) ? activeProvider : null;
  const activeDraft = activeProviderId ? resolveDraft(providerDrafts[activeProviderId]) : initialDraftState();
  const activeDescriptor = activeProviderId
    ? activeSetupMode === "custom-openai-compatible"
      ? buildExplicitModelProviderDescriptor(resolveCustomDraftProviderId(activeDraft), activeDraft.providerName || "Custom provider")
      : getModelProviderDescriptor(activeProviderId)
    : null;
  const activeProviderLabel =
    activeSetupMode === "custom-openai-compatible"
      ? activeDraft.providerName || "Custom provider"
      : activeDescriptor?.shortLabel ?? "provider";
  const activeConnection = activeProviderId
    ? resolveConnectionDetail(snapshot, providerDrafts, activeProviderId)
    : null;
  const showLoadingHero =
    Boolean(activeProviderId && activeDescriptor) &&
    (activeDraft.flowState === "discovery-loading" ||
      (activeDraft.flowState === "connecting" && !activeDraft.manualCommand) ||
      (activeDraft.statusMessage?.startsWith("Checking ") === true && !activeConnection?.connected));
  const loadingHeroTitle =
    activeDraft.flowState === "discovery-loading"
      ? `Discovering ${activeProviderLabel} models...`
      : activeDraft.flowState === "connecting"
        ? activeDraft.statusMessage || `Connecting ${activeProviderLabel}...`
        : activeDraft.statusMessage || `Checking ${activeProviderLabel}...`;
  const loadingHeroCopy =
    activeDraft.flowState === "discovery-loading"
      ? "Pulling the provider catalog into AgentOS."
      : activeDraft.flowState === "connecting"
        ? "Preparing the provider connection."
        : "Checking provider status before discovery.";
  const shouldShowDiscoveryCta = Boolean(
    activeProviderId && activeDescriptor && activeSetupMode !== "custom-openai-compatible"
  );
  const isDiscovering = activeDraft.flowState === "discovery-loading";
  const discoveryActionLabel =
    activeDraft.models.length > 0 ? "Refresh discovery" : "Discover models";
  const discoveryButtonLabel = isDiscovering ? "Discovering..." : discoveryActionLabel;
  const discoveryDescription = activeConnection?.connected
    ? "The provider is connected. Pull the available models into this workspace before choosing one."
    : activeSetupMode === "custom-openai-compatible"
      ? "Configure the explicit OpenAI-compatible provider first, then pull the available models into this workspace."
      : activeDescriptor?.connectKind === "oauth"
      ? "Use your account login first, then pull the available models into this workspace."
      : "Connect the provider first, then pull the available models into this workspace.";
  const showGatewayRecoveryCommand = Boolean(
    activeDraft.errorMessage &&
    activeDraft.manualCommand &&
    (/gateway/i.test(activeDraft.errorMessage) || /\bgateway\s+status\b/i.test(activeDraft.manualCommand))
  );
  const catalogModels = useMemo(() => {
    const configuredModelIds = new Set(snapshot.models.map((model) => model.id));

    return globalCatalogModels
      .map((model) => ({
        ...model,
        alreadyAdded: configuredModelIds.has(model.id)
      }))
      .sort((left, right) => {
        const leftAlreadyAdded = left.alreadyAdded;
        const rightAlreadyAdded = right.alreadyAdded;

        if (leftAlreadyAdded !== rightAlreadyAdded) {
          return leftAlreadyAdded ? 1 : -1;
        }

        const providerDelta = left.provider.localeCompare(right.provider);
        if (providerDelta !== 0) {
          return providerDelta;
        }

        const leftUnavailable = !isSelectableModel(left);
        const rightUnavailable = !isSelectableModel(right);

        if (leftUnavailable !== rightUnavailable) {
          return leftUnavailable ? 1 : -1;
        }

        const leftPriority = Number(left.recommended) + Number(left.local);
        const rightPriority = Number(right.recommended) + Number(right.local);
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        const nameDelta = left.name.localeCompare(right.name);
        if (nameDelta !== 0) {
          return nameDelta;
        }

        return left.id.localeCompare(right.id);
      });
  }, [globalCatalogModels, snapshot.models]);
  const catalogSelectedModelIds = useMemo(
    () => Object.values(providerDrafts).flatMap((draft) => draft?.selectedModelIds ?? []),
    [providerDrafts]
  );
  const catalogModelById = useMemo(
    () => new Map(catalogModels.map((model) => [model.id, model] as const)),
    [catalogModels]
  );
  const catalogProviderCount = useMemo(() => new Set(catalogModels.map((model) => model.provider)).size, [catalogModels]);
  const catalogAddedCount = useMemo(
    () => catalogModels.filter((model) => model.alreadyAdded).length,
    [catalogModels]
  );
  const catalogSelectedModelGroups = useMemo(() => {
    const selectedModelIds = new Set(catalogSelectedModelIds);
    const groups = new Map<string, string[]>();

    for (const model of catalogModels) {
      const providerId = model.provider;

      if (!selectedModelIds.has(model.id) || model.alreadyAdded) {
        continue;
      }

      const current = groups.get(providerId) ?? [];
      current.push(model.id);
      groups.set(providerId, current);
    }

    return groups;
  }, [catalogModels, catalogSelectedModelIds]);
  async function selectProvider(providerId: AddModelsProviderId) {
    setActiveProvider(providerId);
    setActiveSetupMode("standard");
    setActiveTab("providers");

    const draft = resolveDraft(providerDrafts[providerId]);

    if (draft.loaded && draft.models.length > 0) {
      return;
    }

    const status = await runStatus(providerId);

    if (providerId === "ollama" && status?.connection.connected) {
      await discoverProvider(providerId, true);
    }
  }

  async function runStatus(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);

    updateDraft(providerId, {
      flowState: "idle",
      errorMessage: null
    });

    try {
      const result = await adapter.getConnectionStatus();
      const currentDraft = resolveDraft(providerDrafts[providerId]);
      applyActionResult(providerId, result, result.emptyState ? "discovery-empty" : "idle", {
        models: currentDraft.loaded && currentDraft.models.length > 0 ? currentDraft.models : result.models
      });

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      return result;
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Provider status could not be loaded.",
        loaded: true
      });

      return null;
    }
  }

  async function connectProvider(
    providerId: AddModelsProviderId,
    options?: {
      force?: boolean;
      endpoint?: string;
      providerName?: string;
      modelId?: string;
    }
  ) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage:
        providerId === "openai-codex"
          ? options?.force
            ? "Refreshing Codex app-server setup..."
            : "Checking Codex app-server setup..."
          : providerId === "openai" && options?.endpoint
            ? "Connecting OpenAI-compatible endpoint..."
          : `Connecting ${getModelProviderDescriptor(providerId).shortLabel}...`
    });

    try {
      const result = await adapter.connect({
        apiKey: draft.apiKey,
        endpoint: options?.endpoint,
        providerName: options?.providerName,
        modelId: options?.modelId,
        force: options?.force
      });

      applyActionResult(
        providerId,
        result,
        providerId === "openai-codex" ? "connecting" : result.models.length ? "discovery-success" : "idle",
        {
          apiKey: "",
          endpoint: providerId === "openai" && options?.endpoint ? options.endpoint : draft.endpoint
        }
      );

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Provider connection failed."
      });
    }
  }

  async function connectCustomProvider() {
    const customDraft = resolveDraft(providerDrafts.custom);
    const providerId = resolveCustomDraftProviderId(customDraft);
    const providerName = customDraft.providerName.trim() || formatModelProviderLabel(providerId);

    updateDraft("custom", {
      flowState: "connecting",
      errorMessage: null,
      statusMessage: `Connecting ${providerName}...`
    });

    updateDraft(providerId, {
      ...customDraft,
      flowState: "connecting",
      errorMessage: null,
      statusMessage: `Connecting ${providerName}...`,
      providerName,
      providerId
    });

    try {
      const adapter = getModelProviderAdapter(providerId);
      const result = await adapter.connect({
        apiKey: customDraft.apiKey,
        endpoint: customDraft.endpoint,
        providerName,
        modelId: customDraft.manualModelId
      });

      setExplicitProviderIds((current) => current.includes(providerId) ? current : [...current, providerId]);
      setActiveProvider(providerId);
      setActiveSetupMode("standard");
      applyActionResult(
        providerId,
        result,
        result.models.length ? "discovery-success" : result.emptyState ? "discovery-empty" : "idle",
        {
          providerName,
          providerId,
          apiKey: "",
          endpoint: customDraft.endpoint,
          manualModelId: customDraft.manualModelId
        }
      );
      updateDraft("custom", {
        flowState: "idle",
        statusMessage: null,
        errorMessage: null,
        apiKey: "",
        manualModelId: ""
      });

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Custom provider connection failed.";
      updateDraft("custom", {
        flowState: "auth-error",
        errorMessage: message
      });
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: message
      });
    }
  }

  async function switchProviderAccount(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage: "Preparing ChatGPT account switch..."
    });

    try {
      const result = await adapter.switchAccount();

      applyActionResult(providerId, result, "connecting");

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }
    } catch (error) {
      const actionResult = readProviderActionErrorResult(error);
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Provider account switch failed.",
        manualCommand: actionResult?.manualCommand ?? null,
        docsUrl: actionResult?.docsUrl ?? null
      });
    }
  }

  async function discoverProvider(providerId: AddModelsProviderId, force = false) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    if (!force && draft.flowState === "discovery-loading") {
      return;
    }

    updateDraft(providerId, {
      flowState: "discovery-loading",
      errorMessage: null,
      statusMessage:
        providerId === "ollama"
          ? "Checking the local Ollama runtime..."
          : "Discovering available models..."
    });

    try {
      const result = await adapter.discoverModels();
      applyActionResult(
        providerId,
        result,
        result.models.length > 0
          ? "discovery-success"
          : result.emptyState
            ? "discovery-empty"
            : "idle"
      );

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      return result;
    } catch (error) {
      const actionResult = readProviderActionErrorResult(error);
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Model discovery failed.",
        manualCommand: actionResult?.manualCommand ?? null,
        docsUrl: actionResult?.docsUrl ?? null
      });

      return null;
    }
  }

  async function addSelectedModels(
    providerId: AddModelsProviderId,
    options?: {
      silent?: boolean;
      selectedModelIds?: string[];
    }
  ) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);
    const sourceSelectedModelIds = options?.selectedModelIds ?? draft.selectedModelIds;
    const selectedModelIds = sourceSelectedModelIds.filter((modelId) => {
      const model = catalogModelById.get(modelId) ?? draft.models.find((entry) => entry.id === modelId);
      if (!model) {
        return false;
      }

      return !model.alreadyAdded;
    });

    if (selectedModelIds.length === 0) {
      return false;
    }

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage: "Adding selected models..."
    });

    try {
      const result = await adapter.addModels(selectedModelIds);

      applyActionResult(providerId, result, "add-success", {
        selectedModelIds: options?.selectedModelIds
          ? draft.selectedModelIds.filter((modelId) => !selectedModelIds.includes(modelId))
          : []
      });

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      if (!options?.silent) {
        toast.success("Models added.", {
          description: result.message
        });
      }

      return true;
    } catch (error) {
      const actionResult = readProviderActionErrorResult(error);
      updateDraft(providerId, {
        flowState: "add-error",
        errorMessage: error instanceof Error ? error.message : "Models could not be added.",
        connection: actionResult?.connection ?? draft.connection,
        models: actionResult?.models ?? draft.models,
        manualCommand: actionResult?.manualCommand ?? null,
        docsUrl: actionResult?.docsUrl ?? null
      });

      return false;
    }
  }

  async function addSelectedCatalogModels() {
    const selectedProviderIds = [...catalogSelectedModelGroups.keys()];

    if (selectedProviderIds.length === 0) {
      return;
    }

    setIsAddingCatalogModels(true);

    try {
      let successCount = 0;

      for (const [providerId, modelIds] of catalogSelectedModelGroups.entries()) {
        const didAddModels = isAddModelsProviderId(providerId)
          ? await addSelectedModels(providerId, {
              silent: true,
              selectedModelIds: modelIds
            })
          : await addCatalogProviderModels(providerId, modelIds);

        if (didAddModels) {
          successCount += modelIds.length;
        }
      }

      if (successCount > 0) {
        toast.success("Models added.", {
          description:
            `Added ${successCount} model${successCount === 1 ? "" : "s"} from ${selectedProviderIds.length} provider${selectedProviderIds.length === 1 ? "" : "s"}.`
        });
      } else {
        toast.error("Models could not be added.", {
          description: "Select a different catalog entry or open the Providers tab and try again."
        });
      }
    } catch (error) {
      toast.error("Models could not be added.", {
        description: error instanceof Error ? error.message : "Select a different catalog entry or open the Providers tab and try again."
      });
    } finally {
      setIsAddingCatalogModels(false);
    }
  }

  async function addCatalogProviderModels(providerId: string, modelIds: string[]) {
    const selectedModelIds = modelIds.filter((modelId) => {
      const model = catalogModelById.get(modelId);
      return model && !model.alreadyAdded;
    });

    if (selectedModelIds.length === 0) {
      return false;
    }

    const response = await fetch("/api/models/catalog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        provider: providerId,
        modelIds: selectedModelIds
      })
    });
    const result = (await response.json().catch(() => null)) as
      | {
          error?: string;
          message?: string;
          snapshot?: MissionControlSnapshot;
        }
      | null;

    if (!response.ok || !result) {
      throw new Error(result?.error || result?.message || "Catalog models could not be added.");
    }

    if (result.snapshot) {
      onSnapshotChange(result.snapshot);
    }

    setProviderDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([draftProviderId, draft]) => [
          draftProviderId,
          draft
            ? {
                ...draft,
                selectedModelIds: draft.selectedModelIds.filter((modelId) => !selectedModelIds.includes(modelId))
              }
            : draft
        ])
      ) as Partial<Record<AddModelsProviderId, ProviderDraft>>
    );

    return true;
  }

  async function openTerminal(command: string) {
    try {
      setIsOpeningTerminal(true);

      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Terminal could not be opened.");
      }

      toast.success("Terminal opened.", {
        description: "Finish the provider login there, then return here to discover models."
      });
    } catch (error) {
      toast.error("Unable to open Terminal.", {
        description: error instanceof Error ? error.message : "Unknown terminal error."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied.", {
        description: "Command copied to your clipboard."
      });
    } catch {
      toast.error("Copy failed.", {
        description: "Clipboard access is not available."
      });
    }
  }

  function updateDraft(providerId: string, patch: Partial<ProviderDraft>) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...resolveDraft(current[providerId]),
        ...patch
      }
    }));
  }

  function readProviderActionErrorResult(error: unknown) {
    return error instanceof ModelProviderActionError ? error.result : null;
  }

  function applyActionResult(
    providerId: AddModelsProviderId,
    result: AddModelsProviderActionResult,
    flowState: AddModelsFlowState,
    overrides?: Partial<ProviderDraft>
  ) {
    updateDraft(providerId, {
      flowState,
      connection: result.connection,
      statusMessage: result.message,
      errorMessage: null,
      emptyState: result.emptyState ?? null,
      manualCommand: result.manualCommand ?? null,
      docsUrl: result.docsUrl ?? null,
      models: result.models,
      loaded: true,
      ...overrides
    });

    if (result.snapshot) {
      onProviderSnapshotReady?.(result.snapshot);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[80dvh] max-h-[80dvh] w-[calc(100vw-16px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:h-[min(80dvh,700px)] sm:max-h-[min(80dvh,700px)] sm:w-[min(760px,calc(100vw-40px))]",
          surfaceTheme === "light" && "agentos-light-modal"
        )}
      >
        <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(12,18,31,0.96),rgba(9,13,24,0.98))] px-4 py-3.5 pr-10">
          <DialogTitle className="text-[1.05rem]">Add Models</DialogTitle>
          <DialogDescription className="max-w-[560px] text-[11px] leading-[1rem] text-slate-400">
            Connect or refresh providers first, then browse the catalog when you want to add models in bulk.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "catalog" | "providers")}
          className="min-h-0 flex flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-white/10 px-4 py-3">
            <TabsList className="h-8 rounded-[16px] p-0.5">
              <TabsTrigger value="providers" className="rounded-[13px] px-2.5 py-1 text-[10px]">
                Providers
              </TabsTrigger>
              <TabsTrigger value="catalog" className="rounded-[13px] px-2.5 py-1 text-[10px]">
                Catalog
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TabsContent value="providers" className="!mt-0 m-0 h-full">
              <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4">
                <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(9,13,24,0.96))] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[0.84rem] text-white">All providers</p>
                      <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">
                        Connect or refresh a provider, then return to the catalog when you want to add models in one pass.
                      </p>
                    </div>
                    <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                      {providerDescriptors.length + 1} total
                    </Badge>
                  </div>

                  <div className="relative mt-2.5">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[rgba(13,20,34,0.96)] to-transparent" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[rgba(13,20,34,0.96)] to-transparent" />
                    <div className="-mx-1 overflow-x-auto overscroll-x-contain pb-1">
                      <div className="flex min-w-max gap-2.5 px-1">
                        {providerDescriptors.map((provider) => (
                          <div key={provider.id} className="w-[236px] shrink-0 snap-start sm:w-[244px]">
                            <ProviderCard
                              descriptor={provider}
                              active={activeProviderId === provider.id && activeSetupMode === "standard"}
                              compact
                              surfaceTheme={surfaceTheme}
                              connected={resolveConnectionDetail(snapshot, providerDrafts, provider.id).connected}
                              detail={resolveConnectionDetail(snapshot, providerDrafts, provider.id).detail}
                              onClick={() => {
                                void selectProvider(provider.id);
                              }}
                            />
                          </div>
                        ))}
                        <div className="w-[236px] shrink-0 snap-start sm:w-[244px]">
                          <CustomProviderCard
                            active={activeProviderId === "custom" && activeSetupMode === "custom-openai-compatible"}
                            compact
                            surfaceTheme={surfaceTheme}
                            connected={false}
                            detail={resolveCustomEndpointDetail(resolveDraft(providerDrafts.custom)?.endpoint)}
                            onClick={() => {
                              setActiveProvider("custom");
                              setActiveSetupMode("custom-openai-compatible");
                              setActiveTab("providers");
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="pointer-events-none absolute bottom-1.5 right-3 z-10 rounded-full border border-white/10 bg-slate-950/70 px-2 py-0.5 text-[8px] uppercase tracking-[0.14em] text-slate-400">
                      Scroll -&gt;
                    </div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
                  {activeProviderId && activeDescriptor ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-display text-[0.88rem] text-white">
                            {activeSetupMode === "custom-openai-compatible"
                              ? "Custom OpenAI-compatible provider"
                              : activeDescriptor.label}
                          </p>
                        </div>
                        <Badge
                          variant={activeConnection?.connected ? "success" : "muted"}
                          className={cn(
                            "px-1.5 py-0.5 text-[9px] tracking-[0.12em]",
                            isLight &&
                              activeConnection?.connected &&
                              "border-emerald-300 bg-emerald-50 text-emerald-800",
                            isLight &&
                              !activeConnection?.connected &&
                              "border-[#e3dbd0] bg-white/70 text-[#71675d]"
                          )}
                        >
                          {activeConnection?.connected ? "Connected" : "Not connected"}
                          </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {buildProgressSteps(activeProviderId, activeDraft, activeConnection).map((step) => (
                          <div
                            key={step.label}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]",
                              step.status === "done"
                                ? isLight
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                  : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                                : step.status === "active"
                                  ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
                                  : "border-white/10 bg-white/[0.03] text-slate-500"
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                step.status === "done"
                                  ? "bg-emerald-300"
                                  : step.status === "active"
                                    ? "bg-cyan-300"
                                    : "bg-slate-600"
                              )}
                            />
                            {step.label}
                          </div>
                        ))}
                      </div>

                      {activeDraft.statusMessage && !showLoadingHero ? (
                        <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2">
                          <p className="text-[11px] text-slate-200">{activeDraft.statusMessage}</p>
                        </div>
                      ) : null}

                      {activeDraft.errorMessage ? (
                        <div className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11px] text-rose-100">
                          {activeDraft.errorMessage}
                        </div>
                      ) : null}

                      {showGatewayRecoveryCommand ? (
                        <div className="mt-3 rounded-[16px] border border-amber-300/20 bg-amber-300/[0.08] px-3 py-2">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-medium text-amber-50">Gateway recovery</p>
                              <p className="mt-1 max-w-[480px] text-[10px] leading-[0.98rem] text-amber-100/78">
                                Automatic Gateway auth repair did not finish. Inspect Gateway status, then retry adding models.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isOpenClawTerminalCommand(activeDraft.manualCommand) ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="h-7 rounded-full px-2.5 text-[10px]"
                                  disabled={isOpeningTerminal}
                                  onClick={() => {
                                    void openTerminal(activeDraft.manualCommand || "");
                                  }}
                                >
                                  {isOpeningTerminal ? (
                                    <>
                                      <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                                      Opening...
                                    </>
                                  ) : (
                                    <>
                                      <SquareTerminal className="mr-1.5 h-3 w-3" />
                                      Open Terminal
                                    </>
                                  )}
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-full px-2.5 text-[10px]"
                                onClick={() => {
                                  void copyText(activeDraft.manualCommand || "");
                                }}
                              >
                                <Copy className="mr-1.5 h-3 w-3" />
                                Copy command
                              </Button>
                            </div>
                          </div>
                          <div className="mt-2.5 overflow-x-auto rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2">
                            <code className="text-[10px] text-slate-200">{activeDraft.manualCommand}</code>
                          </div>
                        </div>
                      ) : null}

                      {!showLoadingHero ? (
                        <>
                          {activeProviderId === "openai-codex" ? (
                            <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-display text-[0.88rem] text-white">Use Codex app-server</p>
                                  <p className="mt-1 max-w-[500px] text-[10px] leading-[0.98rem] text-slate-400">
                                    OpenClaw {OPENCLAW_RECOMMENDED_VERSION} uses the Codex app-server plugin for ChatGPT-backed models.
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  className="h-8 rounded-full px-3 text-[10px]"
                                  disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                                  onClick={() => {
                                    if (activeConnection?.connected) {
                                      void runStatus(activeProviderId);
                                      return;
                                    }

                                    void connectProvider(activeProviderId);
                                  }}
                                >
                                  {activeDraft.flowState === "connecting" && !activeDraft.manualCommand ? (
                                    <>
                                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                      Connecting...
                                    </>
                                  ) : (
                                    activeConnection?.connected ? "Refresh status" : "Connect ChatGPT"
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-8 rounded-full px-3 text-[10px]"
                                  disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                                  onClick={() => {
                                    if (activeConnection?.connected) {
                                      void switchProviderAccount(activeProviderId);
                                      return;
                                    }

                                    void connectProvider(activeProviderId, { force: true });
                                  }}
                                >
                                  {activeConnection?.connected ? "Switch account" : "Refresh setup"}
                                </Button>
                              </div>

                              {activeDraft.manualCommand ? (
                                <div className="mt-3 rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.07] p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-medium text-cyan-50">Finish setup in Terminal</p>
                                      <p className="mt-1 max-w-[480px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                                        Open Terminal, complete the Codex app-server setup, then return here and check discovery.
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        disabled={isOpeningTerminal}
                                        onClick={() => {
                                          void openTerminal(activeDraft.manualCommand || "");
                                        }}
                                      >
                                        {isOpeningTerminal ? (
                                          <>
                                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                                            Opening...
                                          </>
                                        ) : (
                                          <>
                                            <SquareTerminal className="mr-1.5 h-3 w-3" />
                                            Open Terminal
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        onClick={() => {
                                          void copyText(activeDraft.manualCommand || "");
                                        }}
                                      >
                                        <Copy className="mr-1.5 h-3 w-3" />
                                        Copy command
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        onClick={() => {
                                          void discoverProvider(activeProviderId);
                                        }}
                                      >
                                        <RefreshCw className="mr-1.5 h-3 w-3" />
                                        I&apos;ve connected it
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="mt-2.5 overflow-x-auto rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2">
                                    <code className="text-[10px] text-slate-200">{activeDraft.manualCommand}</code>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {activeDescriptor.connectKind === "apiKey" ? (
                            <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                              {activeSetupMode === "custom-openai-compatible" ? (
                                <div className="mb-3 rounded-[16px] border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-2">
                                  <p className="text-[11px] font-medium text-cyan-50">Custom OpenAI-compatible provider</p>
                                  <p className="mt-1 max-w-[500px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                                    OpenClaw stores this as an explicit provider under <code>models.providers.&lt;id&gt;</code>. Use a `/v1` base URL and an API key from your provider.
                                  </p>
                                </div>
                              ) : null}
                              <div className="flex flex-wrap items-end gap-3">
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <>
                                    <div className="min-w-[220px] flex-1">
                                      <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">
                                        Base URL
                                      </label>
                                      <Input
                                        type="url"
                                        value={activeDraft.endpoint}
                                        onChange={(event) => updateDraft(activeProviderId, { endpoint: event.target.value })}
                                        placeholder="https://api.entrim.ai/v1"
                                        className="mt-1.5 h-8 text-[11px]"
                                      />
                                    </div>
                                    <div className="min-w-[180px] flex-1">
                                      <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">
                                        Manual model ID
                                      </label>
                                      <Input
                                        value={activeDraft.manualModelId}
                                        onChange={(event) => updateDraft(activeProviderId, { manualModelId: event.target.value })}
                                        placeholder="Optional if discovery is empty"
                                        className="mt-1.5 h-8 text-[11px]"
                                      />
                                    </div>
                                  </>
                                ) : null}
                                {activeSetupMode !== "custom-openai-compatible" ? (
                                  <div className="min-w-0 flex-1">
                                    <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">
                                      API key
                                    </label>
                                    <Input
                                      type="password"
                                      value={activeDraft.apiKey}
                                      onChange={(event) => updateDraft(activeProviderId, { apiKey: event.target.value })}
                                      placeholder={activeProviderId === "openrouter" ? "sk-or-v1-..." : "Paste API key"}
                                      className="mt-1.5 h-8 text-[11px]"
                                    />
                                  </div>
                                ) : null}
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <div className="min-w-[220px] flex-1">
                                    <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">
                                      API key
                                    </label>
                                    <Input
                                      type="password"
                                      value={activeDraft.apiKey}
                                      onChange={(event) => updateDraft(activeProviderId, { apiKey: event.target.value })}
                                      placeholder="Paste provider API key"
                                      className="mt-1.5 h-8 text-[11px]"
                                    />
                                  </div>
                                ) : null}
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <p className="w-full text-[9px] leading-[0.9rem] text-slate-500">
                                    Provider ID is inferred as {resolveCustomDraftProviderId(activeDraft) || "provider-id"} from the base URL. Models are saved as {resolveCustomDraftProviderId(activeDraft) || "provider-id"}/&lt;model&gt;.
                                  </p>
                                ) : null}
                                <Button
                                  type="button"
                                  className="h-8 rounded-full px-3 text-[10px]"
                                  disabled={
                                    activeDraft.flowState === "connecting" ||
                                    !activeDraft.apiKey.trim() ||
                                    (activeSetupMode === "custom-openai-compatible" &&
                                      (!activeDraft.endpoint.trim() ||
                                        !resolveCustomDraftProviderId(activeDraft).trim()))
                                  }
                                  onClick={() => {
                                    if (activeSetupMode === "custom-openai-compatible") {
                                      void connectCustomProvider();
                                      return;
                                    }

                                    void connectProvider(activeProviderId);
                                  }}
                                >
                                  {activeDraft.flowState === "connecting" ? (
                                    <>
                                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                      Connecting...
                                    </>
                                  ) : activeSetupMode === "custom-openai-compatible"
                                    ? "Connect custom provider"
                                    : `Connect ${activeDescriptor.shortLabel}`}
                                </Button>
                              </div>
                              {activeDraft.manualCommand ? (
                                <div className="mt-3 rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.07] p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-medium text-cyan-50">Finish setup in Terminal</p>
                                      <p className="mt-1 max-w-[480px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                                        Open Terminal, paste the provider API key there, then return here and check discovery.
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        disabled={isOpeningTerminal}
                                        onClick={() => {
                                          void openTerminal(activeDraft.manualCommand || "");
                                        }}
                                      >
                                        {isOpeningTerminal ? (
                                          <>
                                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                                            Opening...
                                          </>
                                        ) : (
                                          <>
                                            <SquareTerminal className="mr-1.5 h-3 w-3" />
                                            Open Terminal
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        onClick={() => {
                                          void copyText(activeDraft.manualCommand || "");
                                        }}
                                      >
                                        <Copy className="mr-1.5 h-3 w-3" />
                                        Copy command
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 rounded-full px-2.5 text-[10px]"
                                        onClick={() => {
                                          void discoverProvider(activeProviderId);
                                        }}
                                      >
                                        <RefreshCw className="mr-1.5 h-3 w-3" />
                                        I&apos;ve connected it
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="mt-2.5 overflow-x-auto rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2">
                                    <code className="text-[10px] text-slate-200">{activeDraft.manualCommand}</code>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {shouldShowDiscoveryCta ? (
                            <div
                              className={cn(
                                "mt-4 rounded-[24px] border p-4",
                                isLight
                                  ? "border-cyan-200 bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(239,249,251,0.94))] shadow-[0_18px_42px_rgba(122,91,68,0.12)]"
                                  : "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(17,28,47,0.98),rgba(10,16,28,0.98))] shadow-[0_18px_42px_rgba(7,11,20,0.28)]"
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-display text-[0.92rem] text-white">
                                    {isDiscovering ? "Discovering models..." : discoveryActionLabel}
                                  </p>
                                  <p className="mt-1 max-w-[520px] text-[11px] leading-[1rem] text-slate-400">
                                    {isDiscovering
                                      ? "OpenClaw is pulling the provider catalog into this workspace."
                                      : discoveryDescription}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="default"
                                    className="h-11 rounded-full px-5 text-[12px] font-medium"
                                    disabled={isDiscovering}
                                    onClick={() => {
                                      void discoverProvider(activeProviderId);
                                    }}
                                  >
                                    {isDiscovering ? (
                                      <>
                                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                        Discovering...
                                      </>
                                    ) : (
                                      <>
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        {discoveryButtonLabel}
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-11 rounded-full px-4 text-[10px]"
                                    onClick={() => {
                                      void runStatus(activeProviderId);
                                    }}
                                  >
                                    Refresh status
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {activeDraft.emptyState ? (
                            <EmptyStateCard
                              emptyState={activeDraft.emptyState}
                              onCopyCommand={(command) => {
                                void copyText(command);
                              }}
                            />
                          ) : null}

                          {activeDraft.models.length > 0 ? (
                            <div className="mt-5">
                              <ModelPicker
                                provider={activeProviderId}
                                models={activeDraft.models}
                                selectedModelIds={activeDraft.selectedModelIds}
                                search={activeDraft.search}
                                onSearchChange={(value) => updateDraft(activeProviderId, { search: value })}
                                onToggleModel={(modelId) => {
                                  const selected = activeDraft.selectedModelIds.includes(modelId);
                                  updateDraft(activeProviderId, {
                                    selectedModelIds: selected
                                      ? activeDraft.selectedModelIds.filter((entry) => entry !== modelId)
                                      : [...activeDraft.selectedModelIds, modelId]
                                  });
                                }}
                                onAddSelected={() => {
                                  void addSelectedModels(activeProviderId);
                                }}
                                isAdding={
                                  activeDraft.flowState === "connecting" &&
                                  activeDraft.statusMessage === "Adding selected models..."
                                }
                                surfaceTheme={surfaceTheme}
                              />
                            </div>
                          ) : null}

                          {activeDraft.flowState === "add-success" ? (
                            <div
                              className={cn(
                                "mt-3 flex items-center gap-2.5 rounded-[16px] border px-3 py-2",
                                isLight
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                  : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-50"
                              )}
                            >
                              <CircleCheckBig className={cn("h-3.5 w-3.5", isLight ? "text-emerald-700" : "text-emerald-200")} />
                              <p className="text-[11px]">
                                {activeDraft.statusMessage || "Models were added successfully."}
                              </p>
                            </div>
                          ) : null}

                          {activeDraft.docsUrl ? (
                            <a
                              href={activeDraft.docsUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex text-[10px] text-slate-300 underline underline-offset-4"
                            >
                              OpenClaw model docs
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <div
                          className={cn(
                            "mt-4 flex min-h-[260px] items-center justify-center overflow-hidden rounded-[24px] border px-4 py-10 text-center",
                            isLight
                              ? "border-cyan-200 bg-[radial-gradient(circle_at_top,rgba(207,244,250,0.9),rgba(255,252,248,0.98)_70%)] shadow-[0_22px_52px_rgba(122,91,68,0.12)]"
                              : "border-cyan-300/20 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),rgba(8,15,28,0.98)_70%)] shadow-[0_22px_52px_rgba(7,11,20,0.32)]"
                          )}
                        >
                          <div className="relative flex max-w-[340px] flex-col items-center">
                            <div className="absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent blur-sm animate-pulse" />
                            <div className="absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent blur-sm animate-pulse [animation-delay:180ms]" />
                            <div className="absolute left-8 top-8 h-24 w-24 rounded-full border border-cyan-300/15 bg-cyan-300/[0.04] blur-[1px] animate-pulse" />
                            <div className="absolute right-10 top-14 h-16 w-16 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:120ms]" />
                            <div className="absolute bottom-10 left-1/2 h-20 w-20 -translate-x-1/2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:240ms]" />
                            <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] shadow-[0_0_0_8px_rgba(34,211,238,0.05)]">
                              <LoaderCircle className="h-8 w-8 animate-spin text-cyan-200" />
                            </div>
                            <p className="font-display text-[1.1rem] leading-[1.2rem] tracking-[0.01em] text-white">
                              {loadingHeroTitle}
                            </p>
                            <p className="mt-2 max-w-[280px] text-[11px] leading-[1rem] text-slate-400">
                              {loadingHeroCopy}
                            </p>
                            <div className="mt-4 flex gap-1.5">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/90" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/60 [animation-delay:120ms]" />
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/30 [animation-delay:240ms]" />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex min-h-[180px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
                      <div>
                        <p className="font-display text-[0.88rem] text-white">Choose a provider to begin</p>
                        <p className="mt-1.5 max-w-[360px] text-[11px] leading-[0.98rem] text-slate-400">
                          Start with ChatGPT, OpenRouter, Gemini, DeepSeek, Mistral, or Ollama Local. The flow will
                          guide you through connect, discovery, selection, and add.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="!mt-0 m-0 h-full">
              <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4">
                <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[0.84rem] text-white">OpenClaw catalog</p>
                      <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">
                        Search the full OpenClaw model catalog, then load five more whenever you want to extend the list.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogModels.length} models
                      </Badge>
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogProviderCount} providers
                      </Badge>
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogAddedCount} added
                      </Badge>
                    </div>
                  </div>
                </div>

                {globalCatalogError ? (
                  <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/[0.08] px-4 py-3 text-[11px] text-rose-100">
                    {globalCatalogError}
                  </div>
                ) : null}

                <GlobalModelPicker
                  models={catalogModels}
                  selectedModelIds={catalogSelectedModelIds}
                  search={catalogSearch}
                  onSearchChange={setCatalogSearch}
                  onToggleModel={(providerId, modelId) => {
                    const currentDraft = resolveDraft(providerDrafts[providerId]);
                    updateDraft(providerId, {
                      selectedModelIds: currentDraft.selectedModelIds.includes(modelId)
                        ? currentDraft.selectedModelIds.filter((entry) => entry !== modelId)
                        : [...currentDraft.selectedModelIds, modelId]
                    });
                  }}
                  onAddSelected={() => {
                    void addSelectedCatalogModels();
                  }}
                  onOpenProviders={(providerId) => {
                    setActiveTab("providers");

                    if (isAddModelsProviderId(providerId)) {
                      void selectProvider(providerId);
                    }
                  }}
                  onLoadMore={() => setCatalogVisibleCount((current) => current + CATALOG_PAGE_SIZE)}
                  visibleModelCount={catalogVisibleCount}
                  isAdding={isAddingCatalogModels}
                  isLoading={isLoadingGlobalCatalog && catalogModels.length === 0}
                />

                {!isLoadingGlobalCatalog && catalogModels.length === 0 && !globalCatalogError ? (
                  <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-center text-[11px] text-slate-400">
                    OpenClaw did not return any supported models yet. Check your installation or refresh providers.
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EmptyStateCard({
  emptyState,
  onCopyCommand
}: {
  emptyState: AddModelsEmptyState;
  onCopyCommand: (command: string) => void;
}) {
  return (
    <div className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
      <p className="font-display text-[0.88rem] text-white">{emptyState.title}</p>
      <p className="mt-1 max-w-[520px] text-[11px] leading-[0.98rem] text-slate-400">{emptyState.description}</p>

      {emptyState.commands?.length ? (
        <div className="mt-3 space-y-1.5">
          {emptyState.commands.map((command) => (
            <div
              key={command}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2"
            >
              <code className="text-[10px] text-slate-200">{command}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-full px-2.5 text-[10px]"
                onClick={() => onCopyCommand(command)}
              >
                <Copy className="mr-1.5 h-3 w-3" />
                Copy
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resolveDraft(draft?: ProviderDraft): ProviderDraft {
  return draft ? draft : initialDraftState();
}

function resolveCustomDraftProviderId(draft: ProviderDraft) {
  const explicitProviderId = normalizeExplicitProviderId(draft.providerId);

  if (explicitProviderId) {
    return explicitProviderId;
  }

  const inferredProviderId = inferProviderIdFromBaseUrl(draft.endpoint);

  if (!inferredProviderId) {
    return "";
  }

  return isBuiltInAddModelsProviderId(inferredProviderId)
    ? `${inferredProviderId}-custom`
    : inferredProviderId;
}

function inferProviderIdFromBaseUrl(endpoint: string) {
  const trimmed = endpoint.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const hostname = new URL(trimmed).hostname.toLowerCase();
    const hostnameParts = hostname.split(".").filter(Boolean);
    const meaningfulParts = hostnameParts.filter((part) => !["api", "gateway", "llm", "models"].includes(part));
    const providerCandidate = meaningfulParts.length >= 2
      ? meaningfulParts[meaningfulParts.length - 2]
      : meaningfulParts[0] ?? hostnameParts[0] ?? "";

    return normalizeExplicitProviderId(providerCandidate || hostname);
  } catch {
    return normalizeExplicitProviderId(trimmed);
  }
}

function resolveCustomEndpointDetail(endpoint?: string) {
  const trimmed = endpoint?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return `Custom endpoint: ${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return `Custom endpoint: ${trimmed}`;
  }
}

function isSelectableModel(model: AddModelsCatalogModel) {
  return !model.missing && model.available !== false;
}

function resolveConnectionDetail(
  snapshot: MissionControlSnapshot,
  drafts: Partial<Record<string, ProviderDraft>>,
  providerId: AddModelsProviderId
) {
  const cachedConnection = drafts[providerId]?.connection;

  if (cachedConnection) {
    return cachedConnection;
  }

  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider) => provider.provider === providerId
  );
  const localModelCount = snapshot.models.filter((model) => modelMatchesProvider(providerId, model.id, model.provider)).length;

  if (providerId === "ollama") {
    return {
      provider: providerId,
      connected: localModelCount > 0,
      canConnect: true,
      needsTerminal: false,
      detail:
        localModelCount > 0
          ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} already visible in AgentOS.`
          : "Detect local models from this machine."
    };
  }

  const connected = Boolean(readinessProvider?.connected);

  return {
    provider: providerId,
    connected,
    canConnect: true,
    needsTerminal: providerId === "openai-codex",
    detail: connected
      ? readinessProvider?.detail || getModelProviderDescriptor(providerId).helperText
      : localModelCount > 0
        ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${getModelProviderDescriptor(providerId).shortLabel} to use them.`
        : getModelProviderDescriptor(providerId).helperText
  };
}

function modelMatchesProvider(providerId: AddModelsProviderId, modelId: string, modelProvider?: string | null) {
  return modelMatchesAddModelsProvider(providerId, modelId, modelProvider);
}

function buildProgressSteps(
  providerId: AddModelsProviderId,
  draft: ProviderDraft,
  connection: AddModelsProviderConnectionStatus | null
) {
  const connectDone =
    providerId === "ollama"
      ? Boolean(connection?.connected || draft.emptyState)
      : Boolean(connection?.connected || draft.manualCommand);
  const discoverDone = draft.models.length > 0 || Boolean(draft.emptyState);
  const selectDone = draft.selectedModelIds.length > 0;
  const addDone = draft.flowState === "add-success";

  return [
    { label: "Choose provider", status: "done" },
    {
      label: providerId === "ollama" ? "Local check" : "Connect",
      status: draft.flowState === "connecting" && !connectDone ? "active" : connectDone ? "done" : "pending"
    },
    {
      label: "Discover",
      status: draft.flowState === "discovery-loading" ? "active" : discoverDone ? "done" : "pending"
    },
    {
      label: "Select",
      status: addDone ? "done" : selectDone ? "active" : "pending"
    },
    {
      label: "Add",
      status: addDone ? "done" : draft.flowState === "add-error" ? "active" : "pending"
    }
  ] as const;
}
