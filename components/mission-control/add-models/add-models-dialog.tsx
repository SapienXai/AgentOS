"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  Boxes,
  CircleCheckBig,
  Copy,
  Database,
  HardDrive,
  HelpCircle,
  Library,
  LoaderCircle,
  RefreshCw,
  Settings,
  SquareTerminal,
  Trash2
} from "lucide-react";

import { CustomProviderCard } from "@/components/mission-control/add-models/custom-provider-card";
import { GlobalModelPicker } from "@/components/mission-control/add-models/global-model-picker";
import { ModelPicker } from "@/components/mission-control/add-models/model-picker";
import { ProviderLogo } from "@/components/mission-control/provider-logo";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
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
  discoveryLoaded: boolean;
};

type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;
type SidebarFilter = "available" | "providers" | "catalog" | "local-models" | "defaults";

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
  loaded: false,
  discoveryLoaded: false
});

const CATALOG_PAGE_SIZE = 5;
const CATALOG_REQUEST_TIMEOUT_MS = 20_000;

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
  const [sidebarFilter, setSidebarFilter] = useState<SidebarFilter>("providers");
  const [explicitProviderIds, setExplicitProviderIds] = useState<string[]>([]);
  const [switchAccountProviderId, setSwitchAccountProviderId] = useState<AddModelsProviderId | null>(null);
  const globalCatalogLoadStartedRef = useRef(false);
  const handleInitialProviderOpen = useEffectEvent((providerId: AddModelsProviderId) => {
    setActiveSetupMode("standard");
    setActiveTab("providers");
    setSidebarFilter("providers");
    void selectProvider(providerId);
  });
  async function requestGlobalCatalog(force = false) {
    if (globalCatalogLoadStartedRef.current && !force) {
      return;
    }

    globalCatalogLoadStartedRef.current = true;
    setIsLoadingGlobalCatalog(true);
    setGlobalCatalogError(null);

    try {
      const response = await fetch("/api/models/catalog", {
        signal: AbortSignal.timeout(CATALOG_REQUEST_TIMEOUT_MS)
      });
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
      const message =
        error instanceof DOMException && error.name === "TimeoutError"
          ? "OpenClaw catalog request timed out. Check Gateway status and try again."
          : error instanceof Error
            ? error.message
            : "OpenClaw catalog could not be loaded.";
      setGlobalCatalogModels([]);
      setGlobalCatalogError(message);
      toast.error("OpenClaw catalog could not be loaded.", {
        description: message
      });
    } finally {
      setIsLoadingGlobalCatalog(false);
    }
  }
  const loadGlobalCatalogFromEffect = useEffectEvent(() => {
    void requestGlobalCatalog();
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

      setExplicitProviderIds((current) => Array.from(new Set([...current, ...providerIds])));
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
      setSidebarFilter("providers");
      setActiveProvider(null);
      setActiveSetupMode("standard");
      setCatalogSearch("");
      setCatalogVisibleCount(CATALOG_PAGE_SIZE);
      setGlobalCatalogModels([]);
      setGlobalCatalogError(null);
      setIsLoadingGlobalCatalog(false);
      globalCatalogLoadStartedRef.current = false;
      setSwitchAccountProviderId(null);
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
      setSidebarFilter("providers");
    }

    void loadExplicitProviders();
  }, [open, normalizedInitialProvider]);

  useEffect(() => {
    if (!open || activeTab !== "catalog" || globalCatalogModels.length > 0) {
      return;
    }

    loadGlobalCatalogFromEffect();
  }, [open, activeTab, globalCatalogModels.length]);

  const snapshotExplicitProviderIds = useMemo(
    () =>
      Array.from(
        new Set(
          snapshot.models
            .map((model) => normalizeAddModelsProviderId(model.provider || model.id.split("/")[0]))
            .filter(
              (providerId): providerId is AddModelsProviderId =>
                Boolean(providerId) && !isBuiltInAddModelsProviderId(providerId)
            )
        )
      ),
    [snapshot.models]
  );
  const effectiveExplicitProviderIds = useMemo(
    () => Array.from(new Set([...explicitProviderIds, ...snapshotExplicitProviderIds])),
    [explicitProviderIds, snapshotExplicitProviderIds]
  );
  const explicitProviderDescriptors = useMemo(
    () =>
      effectiveExplicitProviderIds.map((providerId) =>
        buildExplicitModelProviderDescriptor(providerId, resolveDraft(providerDrafts[providerId]).providerName)
      ),
    [effectiveExplicitProviderIds, providerDrafts]
  );
  const providerDescriptors = useMemo(() => [...modelProviderRegistry, ...explicitProviderDescriptors], [explicitProviderDescriptors]);
  const providerDescriptorsByStatus = useMemo(() => {
    const buckets = {
      connected: [] as typeof providerDescriptors,
      detected: [] as typeof providerDescriptors,
      notConnected: [] as typeof providerDescriptors
    };

    for (const provider of providerDescriptors) {
      const connection = resolveConnectionDetail(snapshot, providerDrafts, provider.id);
      const rank = getProviderSortRank(provider.id, connection.connected);

      if (rank === 0) {
        buckets.connected.push(provider);
      } else if (rank === 1) {
        buckets.detected.push(provider);
      } else {
        buckets.notConnected.push(provider);
      }
    }

    const sortBucket = (bucket: typeof providerDescriptors) =>
      bucket.sort((left, right) => formatModelProviderLabel(left.id).localeCompare(formatModelProviderLabel(right.id)));

    return {
      connected: sortBucket(buckets.connected),
      detected: sortBucket(buckets.detected),
      notConnected: sortBucket(buckets.notConnected)
    };
  }, [providerDescriptors, providerDrafts, snapshot]);
  const providerCards = useMemo(
    () =>
      providerDescriptors
        .map((provider) => {
          const connection = resolveConnectionDetail(snapshot, providerDrafts, provider.id);

          return {
            provider,
            connection,
            statusRank: getProviderSortRank(provider.id, connection.connected)
          };
        })
        .sort((left, right) => {
          if (left.statusRank !== right.statusRank) {
            return left.statusRank - right.statusRank;
          }

          return formatModelProviderLabel(left.provider.id).localeCompare(formatModelProviderLabel(right.provider.id));
        }),
    [providerDescriptors, providerDrafts, snapshot]
  );
  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;
  const defaultModelProviderId = defaultModelId ? normalizeAddModelsProviderId(defaultModelId.split("/")[0] ?? null) : null;
  const defaultProviderId = providerCards[0]?.provider.id ?? null;
  const activeProviderId = isAddModelsProviderId(activeProvider) ? activeProvider : null;
  useEffect(() => {
    if (!open || activeProviderId || !defaultProviderId) {
      return;
    }

    setActiveProvider(defaultProviderId);
  }, [open, activeProviderId, defaultProviderId]);
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
  const switchAccountProvider = switchAccountProviderId ? getModelProviderDescriptor(switchAccountProviderId) : null;
  const switchAccountDraft = switchAccountProviderId ? resolveDraft(providerDrafts[switchAccountProviderId]) : null;
  const switchAccountCommand = switchAccountDraft?.manualCommand ?? null;
  const connectedProviderCount = providerDescriptorsByStatus.connected.length;
  const availableProviderCards = providerCards.filter(({ connection }) => connection.connected);
  const localProviderCards = providerCards.filter(({ provider }) => provider.connectKind === "local");
  const defaultProviderCards = defaultModelProviderId
    ? providerCards.filter(({ provider }) => provider.id === defaultModelProviderId)
    : [];
  const sidebarVisibleProviderCards =
    sidebarFilter === "available"
      ? availableProviderCards.length > 0
        ? availableProviderCards
        : providerCards
      : sidebarFilter === "local-models"
        ? localProviderCards.length > 0
          ? localProviderCards
          : providerCards
        : sidebarFilter === "defaults"
          ? defaultProviderCards.length > 0
            ? defaultProviderCards
            : providerCards
          : providerCards;
  const sidebarFilterLabel =
    sidebarFilter === "available"
      ? "Available"
      : sidebarFilter === "local-models"
        ? "Local models"
        : sidebarFilter === "defaults"
          ? "Defaults"
          : sidebarFilter === "catalog"
            ? "Catalog"
            : "Providers";
  const sidebarFilterDescription =
    sidebarFilter === "available"
      ? "Connected providers ready to use."
      : sidebarFilter === "local-models"
        ? "Local providers detected on this machine."
        : sidebarFilter === "defaults"
          ? "Providers behind the current default model."
          : sidebarFilter === "catalog"
            ? "Browse the global model catalog."
            : "Show all provider cards.";
  const selectedProviderModelCount = activeProviderId
    ? snapshot.models.filter((model) => modelMatchesProvider(activeProviderId, model.id, model.provider)).length +
      activeDraft.models.length
    : 0;
  const selectedProviderMaxContext = activeProviderId
    ? Math.max(
        0,
        ...snapshot.models
          .filter((model) => modelMatchesProvider(activeProviderId, model.id, model.provider))
          .map((model) => model.contextWindow ?? 0),
        ...activeDraft.models.map((model) => model.contextWindow ?? 0)
      )
    : 0;
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
    activeProviderId &&
      activeDescriptor &&
      activeSetupMode !== "custom-openai-compatible" &&
      activeDraft.models.length === 0
  );
  const showProviderConnectionForm = Boolean(activeProviderId && activeDescriptor && activeDescriptor.connectKind === "apiKey");
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
  function focusSidebarFilter(filter: SidebarFilter) {
    setSidebarFilter(filter);

    if (filter === "catalog") {
      setActiveTab("catalog");
      return;
    }

    setActiveTab("providers");

    const targetProviderId =
      filter === "available"
        ? availableProviderCards[0]?.provider.id ?? providerCards[0]?.provider.id ?? null
        : filter === "local-models"
          ? localProviderCards[0]?.provider.id ?? providerCards[0]?.provider.id ?? null
          : filter === "defaults"
            ? defaultModelProviderId ?? providerCards[0]?.provider.id ?? null
            : providerCards[0]?.provider.id ?? null;

    if (targetProviderId) {
      void selectProvider(targetProviderId);
    }
  }
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
      applyActionResult(providerId, result, result.emptyState ? "discovery-empty" : "idle");

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
    setProviderDrafts((current) => {
      const currentDraft = resolveDraft(current[providerId]);
      const shouldPreserveDiscoveredModels = result.action === "status" && result.models.length === 0;

      return {
        ...current,
        [providerId]: {
          ...currentDraft,
          flowState,
          connection: result.connection,
          statusMessage: result.message,
          errorMessage: null,
          emptyState: result.emptyState ?? null,
          manualCommand: result.manualCommand ?? null,
          docsUrl: result.docsUrl ?? null,
          models: shouldPreserveDiscoveredModels ? currentDraft.models : result.models,
          loaded: true,
          discoveryLoaded:
            currentDraft.discoveryLoaded || result.action === "discover" || result.models.length > 0,
          ...overrides
        }
      };
    });

    if (result.snapshot) {
      onProviderSnapshotReady?.(result.snapshot);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(90dvh,900px)] max-h-[90dvh] w-[calc(100vw-48px)] max-w-[1420px] flex-col gap-0 overflow-hidden rounded-[26px] p-0 sm:w-[min(1420px,calc(100vw-64px))]",
          isLight
            ? "agentos-light-modal border-border bg-card text-card-foreground shadow-[0_35px_100px_rgba(63,47,34,0.18),0_0_0_1px_rgba(120,92,66,0.08)]"
            : "border-white/12 bg-[#070b14] text-white shadow-[0_35px_130px_rgba(0,0,0,0.68),0_0_80px_rgba(124,58,237,0.13)]"
        )}
      >
        <DialogHeader
          className={cn(
            "relative shrink-0 border-b px-6 py-4 pr-14",
            isLight
              ? "border-border bg-[radial-gradient(circle_at_8%_0%,hsl(var(--primary)/0.10),transparent_28%),linear-gradient(180deg,hsl(var(--card)),hsl(var(--muted)/0.64))]"
              : "border-white/10 bg-[radial-gradient(circle_at_8%_0%,rgba(124,58,237,0.16),transparent_28%),linear-gradient(180deg,rgba(11,17,30,0.98),rgba(7,11,20,0.98))]"
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-[14px] border",
                isLight
                  ? "border-primary/20 bg-primary/10 text-primary shadow-[0_18px_42px_rgba(124,58,237,0.10)]"
                  : "border-violet-300/25 bg-[linear-gradient(145deg,rgba(124,58,237,0.88),rgba(76,29,149,0.92))] text-white shadow-[0_0_38px_rgba(124,58,237,0.28)]"
              )}
            >
              <Library className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className={cn("font-display text-[1.35rem] leading-none tracking-[-0.03em]", isLight ? "text-foreground" : "text-white")}>
                Model Library
              </DialogTitle>
              <DialogDescription className={cn("mt-1.5 max-w-[560px] text-[0.78rem] leading-4", isLight ? "text-muted-foreground" : "text-slate-300")}>
                Manage providers and discover models.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "catalog" | "providers")}
          className={cn(
            "min-h-0 flex flex-1 flex-col lg:grid lg:grid-cols-[190px_minmax(0,1fr)]",
            isLight
              ? "bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.45))]"
              : "bg-[linear-gradient(180deg,rgba(5,8,17,0.98),rgba(4,7,14,0.99))]"
          )}
        >
          <div className={cn("flex shrink-0 flex-col border-b px-3 py-3 lg:min-h-0 lg:border-b-0 lg:border-r", isLight ? "border-border bg-card/65" : "border-white/10 bg-slate-950/25")}>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-pressed={sidebarFilter === "available"}
                onClick={() => focusSidebarFilter("available")}
                className={cn(
                  "group flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                  sidebarFilter === "available"
                    ? isLight
                      ? "border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_rgba(124,58,237,0.08)]"
                      : "border-violet-400/35 bg-violet-500/15 text-white shadow-[0_12px_28px_rgba(124,58,237,0.18)]"
                    : isLight
                      ? "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/50"
                      : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                )}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] border", sidebarFilter === "available" ? (isLight ? "border-primary/20 bg-white/70" : "border-violet-300/25 bg-white/[0.08]") : isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/40")}>
                    <Boxes className={cn("h-4 w-4", sidebarFilter === "available" ? (isLight ? "text-primary" : "text-violet-200") : isLight ? "text-muted-foreground" : "text-slate-300")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("block text-[0.82rem] font-medium leading-none", isLight ? "text-inherit" : "text-inherit")}>Available</span>
                      <Badge
                        variant="muted"
                        className={cn(
                          "h-6 shrink-0 rounded-full px-2.5 text-[0.64rem]",
                          sidebarFilter === "available"
                            ? isLight
                              ? "border-primary/15 bg-white/60 text-primary"
                              : "border-violet-300/20 bg-white/[0.08] text-white"
                            : isLight
                              ? "bg-card text-muted-foreground"
                              : "bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {availableProviderCards.length}
                      </Badge>
                    </span>
                    <span className={cn("mt-1 block text-[0.66rem] leading-none", sidebarFilter === "available" ? (isLight ? "text-primary/75" : "text-violet-100/75") : isLight ? "text-muted-foreground" : "text-slate-400")}>
                      Connected providers
                    </span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={sidebarFilter === "providers"}
                onClick={() => focusSidebarFilter("providers")}
                className={cn(
                  "group flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                  sidebarFilter === "providers"
                    ? isLight
                      ? "border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_rgba(124,58,237,0.08)]"
                      : "border-violet-400/35 bg-violet-500/15 text-white shadow-[0_12px_28px_rgba(124,58,237,0.18)]"
                    : isLight
                      ? "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/50"
                      : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                )}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] border", sidebarFilter === "providers" ? (isLight ? "border-primary/20 bg-white/70" : "border-violet-300/25 bg-white/[0.08]") : isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/40")}>
                    <Database className={cn("h-4 w-4", sidebarFilter === "providers" ? (isLight ? "text-primary" : "text-violet-200") : isLight ? "text-muted-foreground" : "text-slate-300")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("block text-[0.82rem] font-medium leading-none", isLight ? "text-inherit" : "text-inherit")}>Providers</span>
                      <Badge
                        variant="muted"
                        className={cn(
                          "h-6 shrink-0 rounded-full px-2.5 text-[0.64rem]",
                          sidebarFilter === "providers"
                            ? isLight
                              ? "border-primary/15 bg-white/60 text-primary"
                              : "border-violet-300/20 bg-white/[0.08] text-white"
                            : isLight
                              ? "bg-card text-muted-foreground"
                              : "bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {providerCards.length}
                      </Badge>
                    </span>
                    <span className={cn("mt-1 block text-[0.66rem] leading-none", sidebarFilter === "providers" ? (isLight ? "text-primary/75" : "text-violet-100/75") : isLight ? "text-muted-foreground" : "text-slate-400")}>
                      All provider cards
                    </span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={sidebarFilter === "catalog"}
                onClick={() => focusSidebarFilter("catalog")}
                className={cn(
                  "group flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                  sidebarFilter === "catalog"
                    ? isLight
                      ? "border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_rgba(124,58,237,0.08)]"
                      : "border-violet-400/35 bg-violet-500/15 text-white shadow-[0_12px_28px_rgba(124,58,237,0.18)]"
                    : isLight
                      ? "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/50"
                      : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                )}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] border", sidebarFilter === "catalog" ? (isLight ? "border-primary/20 bg-white/70" : "border-violet-300/25 bg-white/[0.08]") : isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/40")}>
                    <Library className={cn("h-4 w-4", sidebarFilter === "catalog" ? (isLight ? "text-primary" : "text-violet-200") : isLight ? "text-muted-foreground" : "text-slate-300")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("block text-[0.82rem] font-medium leading-none", isLight ? "text-inherit" : "text-inherit")}>Catalog</span>
                      <Badge
                        variant="muted"
                        className={cn(
                          "h-6 shrink-0 rounded-full px-2.5 text-[0.64rem]",
                          sidebarFilter === "catalog"
                            ? isLight
                              ? "border-primary/15 bg-white/60 text-primary"
                              : "border-violet-300/20 bg-white/[0.08] text-white"
                            : isLight
                              ? "bg-card text-muted-foreground"
                              : "bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {globalCatalogModels.length > 0 ? globalCatalogModels.length : "—"}
                      </Badge>
                    </span>
                    <span className={cn("mt-1 block text-[0.66rem] leading-none", sidebarFilter === "catalog" ? (isLight ? "text-primary/75" : "text-violet-100/75") : isLight ? "text-muted-foreground" : "text-slate-400")}>
                      Browse global models
                    </span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={sidebarFilter === "local-models"}
                onClick={() => focusSidebarFilter("local-models")}
                className={cn(
                  "group flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                  sidebarFilter === "local-models"
                    ? isLight
                      ? "border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_rgba(124,58,237,0.08)]"
                      : "border-violet-400/35 bg-violet-500/15 text-white shadow-[0_12px_28px_rgba(124,58,237,0.18)]"
                    : isLight
                      ? "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/50"
                      : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                )}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] border", sidebarFilter === "local-models" ? (isLight ? "border-primary/20 bg-white/70" : "border-violet-300/25 bg-white/[0.08]") : isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/40")}>
                    <HardDrive className={cn("h-4 w-4", sidebarFilter === "local-models" ? (isLight ? "text-primary" : "text-violet-200") : isLight ? "text-muted-foreground" : "text-slate-300")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("block text-[0.82rem] font-medium leading-none", isLight ? "text-inherit" : "text-inherit")}>Local Models</span>
                      <Badge
                        variant="muted"
                        className={cn(
                          "h-6 shrink-0 rounded-full px-2.5 text-[0.64rem]",
                          sidebarFilter === "local-models"
                            ? isLight
                              ? "border-primary/15 bg-white/60 text-primary"
                              : "border-violet-300/20 bg-white/[0.08] text-white"
                            : isLight
                              ? "bg-card text-muted-foreground"
                              : "bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {localProviderCards.length}
                      </Badge>
                    </span>
                    <span className={cn("mt-1 block text-[0.66rem] leading-none", sidebarFilter === "local-models" ? (isLight ? "text-primary/75" : "text-violet-100/75") : isLight ? "text-muted-foreground" : "text-slate-400")}>
                      Detected on this machine
                    </span>
                  </span>
                </span>
              </button>

              <button
                type="button"
                aria-pressed={sidebarFilter === "defaults"}
                onClick={() => focusSidebarFilter("defaults")}
                className={cn(
                  "group flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                  sidebarFilter === "defaults"
                    ? isLight
                      ? "border-primary/25 bg-primary/10 text-primary shadow-[0_12px_30px_rgba(124,58,237,0.08)]"
                      : "border-violet-400/35 bg-violet-500/15 text-white shadow-[0_12px_28px_rgba(124,58,237,0.18)]"
                    : isLight
                      ? "border-transparent bg-transparent text-foreground hover:border-border hover:bg-accent/50"
                      : "border-transparent bg-white/[0.02] text-slate-300 hover:border-white/10 hover:bg-white/[0.05]"
                )}
              >
                <span className="flex min-w-0 items-start gap-2.5">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px] border", sidebarFilter === "defaults" ? (isLight ? "border-primary/20 bg-white/70" : "border-violet-300/25 bg-white/[0.08]") : isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/40")}>
                    <Settings className={cn("h-4 w-4", sidebarFilter === "defaults" ? (isLight ? "text-primary" : "text-violet-200") : isLight ? "text-muted-foreground" : "text-slate-300")} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("block text-[0.82rem] font-medium leading-none", isLight ? "text-inherit" : "text-inherit")}>Defaults</span>
                      <Badge
                        variant="muted"
                        className={cn(
                          "h-6 shrink-0 rounded-full px-2.5 text-[0.64rem]",
                          sidebarFilter === "defaults"
                            ? isLight
                              ? "border-primary/15 bg-white/60 text-primary"
                              : "border-violet-300/20 bg-white/[0.08] text-white"
                            : isLight
                              ? "bg-card text-muted-foreground"
                              : "bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {defaultModelProviderId ? 1 : "—"}
                      </Badge>
                    </span>
                    <span className={cn("mt-1 block text-[0.66rem] leading-none", sidebarFilter === "defaults" ? (isLight ? "text-primary/75" : "text-violet-100/75") : isLight ? "text-muted-foreground" : "text-slate-400")}>
                      Current default route
                    </span>
                  </span>
                </span>
              </button>
            </div>
            <div className={cn("mt-auto hidden rounded-[16px] border p-3 text-[0.66rem] leading-4 lg:block", isLight ? "border-border bg-muted/35 text-muted-foreground" : "border-white/10 bg-white/[0.035] text-slate-400")}>
              <HelpCircle className={cn("mb-1.5 h-4 w-4", isLight ? "text-muted-foreground" : "text-slate-300")} />
              {sidebarFilterDescription}
              <span className={cn("mt-2 block font-medium", isLight ? "text-primary" : "text-violet-300")}>{sidebarFilterLabel} filter</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TabsContent value="providers" className="!mt-0 m-0 h-full">
              <div className="grid min-h-full gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className={cn("font-display text-[1.05rem]", isLight ? "text-foreground" : "text-white")}>{sidebarFilterLabel}</p>
                      <p className={cn("mt-0.5 text-[0.76rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{sidebarFilterDescription}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={cn("px-2.5 py-1 text-[0.66rem]", isLight ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-200")}>
                        <span className="mr-2 h-2 w-2 rounded-full bg-emerald-400" />
                        {connectedProviderCount} Connected
                      </Badge>
                      <Badge variant="muted" className="px-2.5 py-1 text-[0.66rem]">
                        {activeDraft.loaded ? "Selected provider loaded" : "Select a provider"}
                      </Badge>
                      <Button
                        type="button"
                        className={cn(
                          "h-7 rounded-[9px] px-2.5 text-[0.66rem] font-medium",
                          isLight
                            ? "border border-border bg-card text-foreground shadow-none hover:border-primary/25 hover:bg-accent"
                            : "bg-violet-600 text-white hover:bg-violet-500"
                        )}
                        disabled={!activeProviderId || isDiscovering}
                        onClick={() => {
                          if (activeProviderId) {
                            void discoverProvider(activeProviderId, true);
                          }
                        }}
                      >
                        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLight ? "text-primary" : "text-white")} />
                        Refresh selected
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    {sidebarVisibleProviderCards.map(({ provider, connection }) => {
                      const providerModelCount =
                        snapshot.models.filter((model) => modelMatchesProvider(provider.id, model.id, model.provider)).length +
                        resolveDraft(providerDrafts[provider.id]).models.length;
                      const active = activeProviderId === provider.id && activeSetupMode === "standard";
                      const isChatGPTProvider = provider.id === "openai-codex";
                      const showSwitchAccountAction = isChatGPTProvider && connection.connected;

                      return (
                        <div key={provider.id} className="h-full">
                          <div
                            className={cn(
                              "flex h-[164px] flex-col overflow-hidden rounded-[14px] border transition",
                              active
                                ? isLight
                                  ? "border-primary/45 bg-primary/10 shadow-[0_18px_44px_rgba(124,58,237,0.12)]"
                                  : "border-violet-400 bg-[radial-gradient(circle_at_8%_0%,rgba(124,58,237,0.20),transparent_36%),linear-gradient(180deg,rgba(20,27,48,0.92),rgba(10,15,28,0.92))] shadow-[0_0_0_1px_rgba(168,85,247,0.22),0_0_34px_rgba(124,58,237,0.16)]"
                                : isLight
                                  ? "border-border bg-card hover:border-primary/25 hover:bg-accent/60"
                                  : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(10,15,28,0.86))] hover:border-violet-300/35 hover:bg-white/[0.055]"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                void selectProvider(provider.id);
                              }}
                              className="min-h-0 w-full flex-1 overflow-hidden p-2.5 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-inset"
                            >
                              <div className="flex items-start justify-between gap-3">
                                {provider.kind === "explicit" ? (
                                  <span
                                    className={cn(
                                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border",
                                      isLight
                                        ? "border-primary/20 bg-primary/10 text-primary"
                                        : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
                                    )}
                                    aria-hidden="true"
                                  >
                                    <SquareTerminal className="h-4 w-4" />
                                  </span>
                                ) : (
                                  <ProviderLogo provider={provider.id} className="h-9 w-9 rounded-[11px]" />
                                )}
                                <Badge
                                  className={cn(
                                    "px-2 py-0.5 text-[0.62rem]",
                                    connection.connected
                                      ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                                      : provider.connectKind === "local"
                                        ? isLight ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-cyan-300/20 bg-cyan-400/10 text-cyan-200"
                                        : isLight ? "border-amber-300 bg-amber-50 text-amber-800" : "border-amber-300/20 bg-amber-400/10 text-amber-200"
                                  )}
                                >
                                  {connection.connected ? "Connected" : provider.connectKind === "local" ? "Detected" : "Not connected"}
                                </Badge>
                              </div>
                              <p className={cn("mt-2.5 font-display text-[0.87rem]", isLight ? "text-foreground" : "text-white")}>{provider.label}</p>
                              <p className={cn("mt-1 line-clamp-2 text-[0.72rem] leading-[1.15]", isLight ? "text-muted-foreground" : "text-slate-300")}>{provider.description}</p>
                              <div className={cn("mt-2 text-[0.64rem] leading-4", isLight ? "text-muted-foreground" : "text-slate-400")}>
                                <p className="line-clamp-1">
                                  {providerModelCount} model{providerModelCount === 1 ? "" : "s"}
                                </p>
                                <p className="line-clamp-1">{connection.detail || provider.helperText}</p>
                              </div>
                            </button>

                            <div className="flex min-h-8 shrink-0 items-end px-2.5 pb-2.5">
                              <div className="flex min-w-0 w-full items-center gap-1.5">
                                <span className={cn("inline-flex h-6 min-w-0 items-center truncate rounded-[9px] border px-2.5 text-[0.64rem] font-medium", isLight ? "border-border bg-muted/45 text-foreground" : "border-white/10 bg-white/[0.04] text-white")}>
                                  {connection.connected ? "Configured" : provider.connectKind === "local" ? "Detected" : "Needs setup"}
                                </span>
                                {showSwitchAccountAction ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className={cn(
                                      "h-6 min-w-0 shrink px-2.5 text-[0.64rem] shadow-none",
                                      isLight
                                        ? "border border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                                        : "border border-white/10 bg-white/[0.04] text-white hover:border-violet-300/30 hover:bg-violet-400/10"
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSwitchAccountProviderId(provider.id);
                                      void switchProviderAccount(provider.id);
                                    }}
                                  >
                                    <span className="truncate">Switch account</span>
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <CustomProviderCard
                      active={activeProviderId === "custom" && activeSetupMode === "custom-openai-compatible"}
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

                <div className={cn("rounded-[18px] border p-3", isLight ? "border-border bg-card shadow-card" : "border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))]")}>
                  {activeProviderId && activeDescriptor ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className={cn("font-display text-[0.88rem]", isLight ? "text-foreground" : "text-white")}>
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
                                  ? isLight ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
                                  : isLight ? "border-border bg-muted/40 text-muted-foreground" : "border-white/10 bg-white/[0.03] text-slate-500"
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
                        <div className={cn("mt-3 rounded-[16px] border px-3 py-2", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.04]")}>
                          <p className={cn("text-[11px]", isLight ? "text-foreground" : "text-slate-200")}>{activeDraft.statusMessage}</p>
                        </div>
                      ) : null}

                      {activeDraft.errorMessage ? (
                        <div className={cn("mt-3 rounded-[16px] border px-3 py-2 text-[11px]", isLight ? "border-rose-200 bg-rose-50 text-rose-800" : "border-rose-400/20 bg-rose-400/[0.08] text-rose-100")}>
                          {activeDraft.errorMessage}
                        </div>
                      ) : null}

                      {showGatewayRecoveryCommand ? (
                        <div className={cn("mt-3 rounded-[16px] border px-3 py-2", isLight ? "border-amber-200 bg-amber-50" : "border-amber-300/20 bg-amber-300/[0.08]")}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className={cn("text-[11px] font-medium", isLight ? "text-amber-900" : "text-amber-50")}>Gateway recovery</p>
                              <p className={cn("mt-1 max-w-[480px] text-[10px] leading-[0.98rem]", isLight ? "text-amber-800" : "text-amber-100/78")}>
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
                          <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-amber-200 bg-white/70" : "border-white/10 bg-slate-950/60")}>
                            <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>{activeDraft.manualCommand}</code>
                          </div>
                        </div>
                      ) : null}

                      {!showLoadingHero ? (
                        <>
                          {activeProviderId === "openai-codex" ? (
                            <div className={cn("mt-4 rounded-[20px] border p-3", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.03]")}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className={cn("font-display text-[0.88rem]", isLight ? "text-foreground" : "text-white")}>Use Codex app-server</p>
                                  <p className={cn("mt-1 max-w-[500px] text-[10px] leading-[0.98rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
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
                                <div className={cn("mt-3 rounded-[16px] border p-3", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/15 bg-cyan-300/[0.07]")}>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Finish setup in Terminal</p>
                                      <p className={cn("mt-1 max-w-[480px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
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
                                  <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-cyan-200 bg-white/70" : "border-white/10 bg-slate-950/60")}>
                                    <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>{activeDraft.manualCommand}</code>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {false ? (
                            <div className={cn("mt-4 rounded-[20px] border p-3", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.03]")}>
                              {activeSetupMode === "custom-openai-compatible" ? (
                                <div className={cn("mb-3 rounded-[16px] border px-3 py-2", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/20 bg-cyan-300/[0.07]")}>
                                  <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Custom OpenAI-compatible provider</p>
                                  <p className={cn("mt-1 max-w-[500px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
                                    OpenClaw stores this as an explicit provider under <code>models.providers.&lt;id&gt;</code>. Use a `/v1` base URL and an API key from your provider.
                                  </p>
                                </div>
                              ) : null}
                              <div className="flex flex-wrap items-end gap-3">
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <>
                                    <div className="min-w-[220px] flex-1">
                                      <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                        Base URL
                                      </label>
                                      <Input
                                        type="url"
                                        value={activeDraft.endpoint}
                                        onChange={(event) => updateDraft(activeProviderId!, { endpoint: event.target.value })}
                                        placeholder="https://api.entrim.ai/v1"
                                        className="mt-1.5 h-8 text-[11px]"
                                      />
                                    </div>
                                    <div className="min-w-[180px] flex-1">
                                      <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                        Manual model ID
                                      </label>
                                      <Input
                                        value={activeDraft.manualModelId}
                                        onChange={(event) => updateDraft(activeProviderId!, { manualModelId: event.target.value })}
                                        placeholder="Optional if discovery is empty"
                                        className="mt-1.5 h-8 text-[11px]"
                                      />
                                    </div>
                                  </>
                                ) : null}
                                {activeSetupMode !== "custom-openai-compatible" ? (
                                  <div className="min-w-0 flex-1">
                                    <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                      API key
                                    </label>
                                    <Input
                                      type="password"
                                      value={activeDraft.apiKey}
                                      onChange={(event) => updateDraft(activeProviderId!, { apiKey: event.target.value })}
                                      placeholder={activeProviderId === "openrouter" ? "sk-or-v1-..." : "Paste API key"}
                                      className="mt-1.5 h-8 text-[11px]"
                                    />
                                  </div>
                                ) : null}
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <div className="min-w-[220px] flex-1">
                                    <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                      API key
                                    </label>
                                    <Input
                                      type="password"
                                      value={activeDraft.apiKey}
                                      onChange={(event) => updateDraft(activeProviderId!, { apiKey: event.target.value })}
                                      placeholder="Paste provider API key"
                                      className="mt-1.5 h-8 text-[11px]"
                                    />
                                  </div>
                                ) : null}
                                {activeSetupMode === "custom-openai-compatible" ? (
                                  <p className={cn("w-full text-[9px] leading-[0.9rem]", isLight ? "text-muted-foreground" : "text-slate-500")}>
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

                                    void connectProvider(activeProviderId!);
                                  }}
                                >
                                  {activeDraft.flowState === "connecting" ? (
                                    <>
                                      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                      Connecting...
                                    </>
                                  ) : activeSetupMode === "custom-openai-compatible"
                                    ? "Connect custom provider"
                                    : `Connect ${activeDescriptor!.shortLabel}`}
                                </Button>
                              </div>
                              {activeDraft.manualCommand ? (
                                <div className={cn("mt-3 rounded-[16px] border p-3", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/15 bg-cyan-300/[0.07]")}>
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Finish setup in Terminal</p>
                                      <p className={cn("mt-1 max-w-[480px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
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
                                          void discoverProvider(activeProviderId!);
                                        }}
                                      >
                                        <RefreshCw className="mr-1.5 h-3 w-3" />
                                        I&apos;ve connected it
                                      </Button>
                                    </div>
                                  </div>
                                  <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-cyan-200 bg-white/70" : "border-white/10 bg-slate-950/60")}>
                                    <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>{activeDraft.manualCommand}</code>
                                  </div>
                                </div>
                              ) : null}
                            </div>
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
                            <p className={cn("font-display text-[1.1rem] leading-[1.2rem] tracking-[0.01em]", isLight ? "text-foreground" : "text-white")}>
                              {loadingHeroTitle}
                            </p>
                            <p className={cn("mt-2 max-w-[280px] text-[11px] leading-[1rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
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
                    <div className={cn("flex min-h-[180px] items-center justify-center rounded-[20px] border border-dashed px-4 py-6 text-center", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.02]")}>
                      <div>
                        <p className={cn("font-display text-[0.88rem]", isLight ? "text-foreground" : "text-white")}>Choose a provider to begin</p>
                        <p className={cn("mt-1.5 max-w-[360px] text-[11px] leading-[0.98rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
                          Start with ChatGPT, OpenRouter, Gemini, DeepSeek, Mistral, or Ollama Local. The flow will
                          guide you through connect, discovery, selection, and add.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                </div>
                <aside
                  className={cn(
                    "border-t p-4 xl:border-l xl:border-t-0",
                    isLight
                      ? "border-border bg-card/80"
                      : "border-white/10 bg-[linear-gradient(180deg,rgba(10,15,28,0.92),rgba(6,9,18,0.96))]"
                  )}
                >
                  {activeProviderId && activeDescriptor ? (
                    <div className="sticky top-0">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={cn("font-display text-[1.05rem]", isLight ? "text-foreground" : "text-white")}>
                            {activeSetupMode === "custom-openai-compatible" ? "Custom provider" : activeDescriptor.label}
                          </p>
                          <p className={cn("mt-0.5 text-[0.72rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
                            {activeSetupMode === "custom-openai-compatible" ? "OpenAI-compatible endpoint" : activeDescriptor.description}
                          </p>
                        </div>
                        <ProviderLogo provider={activeProviderId} className="h-12 w-12 rounded-[13px]" />
                      </div>

                      <Badge
                        className={cn(
                          "mt-3 px-2.5 py-1 text-[0.68rem]",
                          activeConnection?.connected
                            ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                            : isLight ? "border-amber-300 bg-amber-50 text-amber-800" : "border-amber-300/20 bg-amber-400/10 text-amber-200"
                        )}
                      >
                        <span className={cn("mr-2 h-2 w-2 rounded-full", activeConnection?.connected ? "bg-emerald-400" : "bg-amber-400")} />
                        {activeConnection?.connected ? "Connected" : "Not connected"}
                      </Badge>

                      <div className="mt-4 space-y-4">
                        {showProviderConnectionForm ? (
                          <div className={cn("rounded-[24px] border p-4", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.03]")}>
                            {activeSetupMode === "custom-openai-compatible" ? (
                              <div className={cn("mb-3 rounded-[16px] border px-3 py-2", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/20 bg-cyan-300/[0.07]")}>
                                <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Custom OpenAI-compatible provider</p>
                                <p className={cn("mt-1 max-w-[500px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
                                  OpenClaw stores this as an explicit provider under <code>models.providers.&lt;id&gt;</code>. Use a `/v1` base URL and an API key from your provider.
                                </p>
                              </div>
                            ) : (
                              <div className={cn("mb-3 rounded-[16px] border px-3 py-2", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/20 bg-cyan-300/[0.07]")}>
                                <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>
                                  Connect {activeDescriptor.shortLabel} to start discovering models.
                                </p>
                                <p className={cn("mt-1 max-w-[500px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
                                  Enter the provider API key here. Discovery will unlock after the connection is ready.
                                </p>
                              </div>
                            )}

                            <div className="space-y-3">
                              {activeSetupMode === "custom-openai-compatible" ? (
                                <div className="space-y-2">
                                  <div>
                                    <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
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
                                  <div>
                                    <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                      Manual model ID
                                    </label>
                                    <Input
                                      value={activeDraft.manualModelId}
                                      onChange={(event) => updateDraft(activeProviderId, { manualModelId: event.target.value })}
                                      placeholder="Optional if discovery is empty"
                                      className="mt-1.5 h-8 text-[11px]"
                                    />
                                  </div>
                                  <div>
                                    <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
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
                                  <p className={cn("text-[9px] leading-[0.9rem]", isLight ? "text-muted-foreground" : "text-slate-500")}>
                                    Provider ID is inferred as {resolveCustomDraftProviderId(activeDraft) || "provider-id"} from the base URL. Models are saved as {resolveCustomDraftProviderId(activeDraft) || "provider-id"}/&lt;model&gt;.
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <label className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-muted-foreground" : "text-slate-500")}>
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
                              )}

                              <Button
                                type="button"
                                className="h-8 rounded-full px-3 text-[10px]"
                                disabled={
                                  activeDraft.flowState === "connecting" ||
                                  !activeDraft.apiKey.trim() ||
                                  (activeSetupMode === "custom-openai-compatible" &&
                                    (!activeDraft.endpoint.trim() || !resolveCustomDraftProviderId(activeDraft).trim()))
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
                          </div>
                        ) : null}

                        {activeDraft.manualCommand ? (
                          <div className={cn("rounded-[16px] border p-3", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/15 bg-cyan-300/[0.07]")}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Finish setup in Terminal</p>
                                <p className={cn("mt-1 max-w-[480px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
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
                            <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-cyan-200 bg-white/70" : "border-white/10 bg-slate-950/60")}>
                              <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>{activeDraft.manualCommand}</code>
                            </div>
                          </div>
                        ) : null}

                        {shouldShowDiscoveryCta ? (
                          <div
                            className={cn(
                              "rounded-[24px] border p-4",
                              isLight
                                ? "border-cyan-200 bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(239,249,251,0.94))] shadow-[0_18px_42px_rgba(122,91,68,0.12)]"
                                : "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(17,28,47,0.98),rgba(10,16,28,0.98))] shadow-[0_18px_42px_rgba(7,11,20,0.28)]"
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className={cn("font-display text-[0.92rem]", isLight ? "text-foreground" : "text-white")}>
                                  {isDiscovering ? "Discovering models..." : discoveryActionLabel}
                                </p>
                                <p className={cn("mt-1 max-w-[520px] text-[11px] leading-[1rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
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
                            surfaceTheme={surfaceTheme}
                          />
                        ) : null}

                        {activeDraft.models.length > 0 ? (
                          <div>
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
                              "flex items-center gap-2.5 rounded-[16px] border px-3 py-2",
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
                            className={cn("inline-flex text-[10px] underline underline-offset-4", isLight ? "text-primary" : "text-slate-300")}
                          >
                            OpenClaw model docs
                          </a>
                        ) : null}
                      </div>

                      <div className={cn("mt-4 border-t pt-4", isLight ? "border-border" : "border-white/10")}>
                        <p className={cn("font-display text-[0.84rem]", isLight ? "text-foreground" : "text-white")}>Overview</p>
                        <div className="mt-3 space-y-3">
                          <InspectorMetric label="Models discovered" value={String(selectedProviderModelCount)} surfaceTheme={surfaceTheme} />
                          <InspectorMetric label="Context window support" value={selectedProviderMaxContext > 0 ? `Up to ${Intl.NumberFormat().format(selectedProviderMaxContext / 1000)}k` : "Unknown"} surfaceTheme={surfaceTheme} />
                          <InspectorMetric label="Discovery state" value={activeDraft.discoveryLoaded ? "Loaded this session" : "Not refreshed"} surfaceTheme={surfaceTheme} />
                          <InspectorMetric label="Status" value={activeConnection?.connected ? "Healthy" : "Needs setup"} tone={activeConnection?.connected ? "success" : "warning"} surfaceTheme={surfaceTheme} />
                        </div>
                      </div>

                      <div className={cn("mt-4 border-t pt-4", isLight ? "border-border" : "border-white/10")}>
                        <p className={cn("font-display text-[0.84rem]", isLight ? "text-foreground" : "text-white")}>Actions</p>
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition",
                              isLight
                                ? "border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                                : "border-white/10 bg-white/[0.04] hover:border-violet-300/30 hover:bg-violet-400/10"
                            )}
                            onClick={() => {
                              void discoverProvider(activeProviderId, true);
                            }}
                          >
                            <RefreshCw className={cn("h-4 w-4", isLight ? "text-primary" : "text-slate-300")} />
                            <span>
                              <span className={cn("block text-[0.78rem] font-medium", isLight ? "text-foreground" : "text-white")}>Refresh models</span>
                              <span className={cn("block text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Discover new models</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition",
                              isLight
                                ? "border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                                : "border-white/10 bg-white/[0.04] hover:border-violet-300/30 hover:bg-violet-400/10"
                            )}
                            onClick={() => {
                              void runStatus(activeProviderId);
                            }}
                          >
                            <Settings className={cn("h-4 w-4", isLight ? "text-primary" : "text-slate-300")} />
                            <span>
                              <span className={cn("block text-[0.78rem] font-medium", isLight ? "text-foreground" : "text-white")}>Manage connection</span>
                              <span className={cn("block text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>API key, base URL, and settings</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            disabled
                            className={cn(
                              "flex w-full cursor-not-allowed items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left opacity-70",
                              isLight ? "border-rose-200 bg-rose-50" : "border-rose-400/20 bg-rose-500/[0.07]"
                            )}
                            title="Disconnect requires an OpenClaw provider removal capability."
                          >
                            <Trash2 className={cn("h-4 w-4", isLight ? "text-rose-700" : "text-rose-300")} />
                            <span>
                              <span className={cn("block text-[0.78rem] font-medium", isLight ? "text-rose-800" : "text-rose-200")}>Disconnect</span>
                              <span className={cn("block text-[0.66rem]", isLight ? "text-rose-700" : "text-rose-300/80")}>Remove this provider</span>
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={cn("flex h-full min-h-[260px] items-center justify-center rounded-[16px] border border-dashed text-center", isLight ? "border-border bg-muted/35" : "border-white/10")}>
                      <div>
                        <Database className={cn("mx-auto h-8 w-8", isLight ? "text-muted-foreground" : "text-slate-500")} />
                        <p className={cn("mt-2 text-xs", isLight ? "text-foreground" : "text-slate-300")}>Select a provider</p>
                        <p className={cn("mt-1 text-[11px]", isLight ? "text-muted-foreground" : "text-slate-500")}>Provider details and actions appear here.</p>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="!mt-0 m-0 h-full">
              <div className="space-y-3 px-3 py-3">
                <div className={cn("rounded-[16px] border p-3", isLight ? "border-border bg-card shadow-card" : "border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))]")}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className={cn("font-display text-[0.78rem]", isLight ? "text-foreground" : "text-white")}>OpenClaw catalog</p>
                      <p className={cn("mt-1 text-[9px] leading-[0.95rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
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
                  <div className={cn("flex items-center justify-between gap-3 rounded-[18px] border px-4 py-3 text-[11px]", isLight ? "border-rose-200 bg-rose-50 text-rose-800" : "border-rose-400/20 bg-rose-400/[0.08] text-rose-100")}>
                    <span>{globalCatalogError}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-7 shrink-0 rounded-full px-3 text-[9px]"
                      disabled={isLoadingGlobalCatalog}
                      onClick={() => {
                        void requestGlobalCatalog(true);
                      }}
                    >
                      Try again
                    </Button>
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
                  surfaceTheme={surfaceTheme}
                />

                {!isLoadingGlobalCatalog && catalogModels.length === 0 && !globalCatalogError ? (
                  <div className={cn("rounded-[18px] border border-dashed px-4 py-5 text-center text-[11px]", isLight ? "border-border bg-muted/35 text-muted-foreground" : "border-white/10 bg-white/[0.02] text-slate-400")}>
                    OpenClaw did not return any supported models yet. Check your installation or refresh providers.
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </div>
        </Tabs>
        <Dialog
          open={switchAccountProviderId !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSwitchAccountProviderId(null);
            }
          }}
        >
          <DialogContent
            className={cn(
              "w-[min(92vw,420px)] rounded-[22px] p-0",
              isLight
                ? "border-border bg-card text-card-foreground shadow-[0_30px_90px_rgba(63,47,34,0.18),0_0_0_1px_rgba(120,92,66,0.08)]"
                : "border-white/10 bg-[#070a14] text-white shadow-[0_30px_90px_rgba(0,0,0,0.5)]"
            )}
          >
            <div className={cn("border-b px-4 py-3.5", isLight ? "border-border" : "border-white/10")}>
              <DialogTitle className={cn("font-display text-[1rem]", isLight ? "text-foreground" : "text-white")}>Switch account</DialogTitle>
              <DialogDescription className={cn("mt-1 text-[0.78rem] leading-5", isLight ? "text-muted-foreground" : "text-slate-400")}>
                {switchAccountProvider?.label || "This provider"} will refresh its OpenClaw account connection.
              </DialogDescription>
            </div>
            <div className="px-4 py-4">
              <div className={cn("rounded-[16px] border px-3 py-2.5", isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-300/15 bg-cyan-300/[0.07]")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={cn("text-[11px] font-medium", isLight ? "text-cyan-900" : "text-cyan-50")}>Finish setup in Terminal</p>
                    <p className={cn("mt-1 max-w-[420px] text-[10px] leading-[0.98rem]", isLight ? "text-cyan-800" : "text-cyan-100/80")}>
                      Open Terminal, paste the command there, then return here and check discovery.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 rounded-full px-2.5 text-[10px]"
                      disabled={isOpeningTerminal || !switchAccountCommand}
                      onClick={() => {
                        void openTerminal(switchAccountCommand || "");
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
                      disabled={!switchAccountCommand}
                      onClick={() => {
                        void copyText(switchAccountCommand || "");
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
                      disabled={!switchAccountProviderId}
                      onClick={() => {
                        if (!switchAccountProviderId) {
                          return;
                        }

                        void discoverProvider(switchAccountProviderId);
                      }}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      I&apos;ve connected it
                    </Button>
                  </div>
                </div>
                <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-cyan-200 bg-white/70" : "border-white/10 bg-slate-950/60")}>
                  <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>
                    {switchAccountCommand || "Preparing terminal command..."}
                  </code>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 rounded-full px-3 text-[10px]"
                  onClick={() => setSwitchAccountProviderId(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-8 rounded-full px-3 text-[10px]"
                  onClick={() => {
                    if (!switchAccountProviderId) {
                      return;
                    }
                    setSwitchAccountProviderId(null);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function EmptyStateCard({
  emptyState,
  onCopyCommand,
  surfaceTheme = "dark"
}: {
  emptyState: AddModelsEmptyState;
  onCopyCommand: (command: string) => void;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className={cn("mt-3 rounded-[20px] border p-3", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.03]")}>
      <p className={cn("font-display text-[0.88rem]", isLight ? "text-foreground" : "text-white")}>{emptyState.title}</p>
      <p className={cn("mt-1 max-w-[520px] text-[11px] leading-[0.98rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{emptyState.description}</p>

      {emptyState.commands?.length ? (
        <div className="mt-3 space-y-1.5">
          {emptyState.commands.map((command) => (
            <div
              key={command}
              className={cn("flex flex-wrap items-center justify-between gap-2 rounded-[14px] border px-3 py-2", isLight ? "border-border bg-card" : "border-white/10 bg-slate-950/60")}
            >
              <code className={cn("text-[10px]", isLight ? "text-foreground" : "text-slate-200")}>{command}</code>
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

function InspectorMetric({
  label,
  value,
  tone = "default",
  surfaceTheme = "dark"
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="flex items-center justify-between gap-3 text-[0.82rem]">
      <span className={cn(isLight ? "text-muted-foreground" : "text-slate-400")}>{label}</span>
      <span
        className={cn(
          "text-right font-medium",
          tone === "success"
            ? isLight ? "text-emerald-700" : "text-emerald-300"
            : tone === "warning"
              ? isLight ? "text-amber-800" : "text-amber-300"
              : isLight ? "text-foreground" : "text-slate-100"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function resolveDraft(draft?: ProviderDraft): ProviderDraft {
  return draft ? { ...initialDraftState(), ...draft } : initialDraftState();
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
): AddModelsProviderConnectionStatus {
  const cachedConnection = drafts[providerId]?.connection;

  if (cachedConnection) {
    return cachedConnection;
  }

  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider) => provider.provider === providerId
  );
  const providerModels = snapshot.models.filter((model) => modelMatchesProvider(providerId, model.id, model.provider));
  const localModelCount = providerModels.length;

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

  if (!isBuiltInAddModelsProviderId(providerId) && localModelCount > 0) {
    const hasAvailableModel = providerModels.some((model) => !model.missing && model.available !== false);

    return {
      provider: providerId,
      connected: hasAvailableModel,
      canConnect: true,
      needsTerminal: false,
      source: "explicit-provider-config",
      detail: hasAvailableModel
        ? `${localModelCount} configured model${localModelCount === 1 ? "" : "s"} available through OpenClaw.`
        : `${localModelCount} configured model${localModelCount === 1 ? "" : "s"} need provider recovery.`
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

function getProviderSortRank(providerId: AddModelsProviderId, connected: boolean) {
  if (connected) {
    return 0;
  }

  if (providerId === "ollama") {
    return 1;
  }

  return 2;
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
