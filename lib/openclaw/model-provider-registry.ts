import type {
  AddModelsProviderCategory,
  AddModelsProviderAuthMethod,
  AddModelsProviderConnectKind,
  AddModelsProviderId,
  BuiltInAddModelsProviderId
} from "@/lib/openclaw/types";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

export type ModelProviderDescriptor = {
  id: AddModelsProviderId;
  label: string;
  shortLabel: string;
  description: string;
  category: AddModelsProviderCategory;
  connectKind: AddModelsProviderConnectKind;
  authMethods?: readonly AddModelsProviderAuthMethod[];
  accent: string;
  helperText: string;
  kind?: "builtin" | "explicit" | "action";
  searchPlaceholder?: string;
};

/**
 * Presentation-only provider overrides. OpenClaw supplies provider existence,
 * capabilities, authentication, and model inventory; this map only keeps
 * familiar product language and artwork stable when a provider is known.
 */
export type ModelProviderPresentationOverride = {
  displayName?: string;
  shortLabel?: string;
  accent?: string;
};

export const modelProviderPresentationRegistry: Readonly<Record<string, ModelProviderPresentationOverride>> = {
  openai: { displayName: "OpenAI", shortLabel: "OpenAI" },
  openrouter: { displayName: "OpenRouter", shortLabel: "OpenRouter" },
  ollama: { displayName: "Ollama", shortLabel: "Ollama" },
  anthropic: { displayName: "Anthropic", shortLabel: "Anthropic" },
  google: { displayName: "Google", shortLabel: "Google" },
  "google-vertex": { displayName: "Google Vertex", shortLabel: "Google Vertex" },
  "github-copilot": { displayName: "GitHub Copilot", shortLabel: "GitHub Copilot" },
  huggingface: { displayName: "Hugging Face", shortLabel: "Hugging Face" },
  litellm: { displayName: "LiteLLM", shortLabel: "LiteLLM" },
  lmstudio: { displayName: "LM Studio", shortLabel: "LM Studio" },
  minimax: { displayName: "MiniMax", shortLabel: "MiniMax" },
  "minimax-portal": { displayName: "MiniMax Portal", shortLabel: "MiniMax Portal" },
  "opencode-go": { displayName: "OpenCode Go", shortLabel: "OpenCode Go" },
  "ollama-cloud": { displayName: "Ollama Cloud", shortLabel: "Ollama Cloud" },
  vllm: { displayName: "vLLM", shortLabel: "vLLM" },
  deepseek: { displayName: "DeepSeek", shortLabel: "DeepSeek" },
  mistral: { displayName: "Mistral", shortLabel: "Mistral" },
  xai: { displayName: "xAI", shortLabel: "xAI" }
};

/**
 * Legacy compatibility targets for the pre-8.2 onboarding/adapter flow. The
 * post-onboarding management surface must use OpenClaw setup/auth metadata and
 * auth profiles instead; this map is not a provider capability registry.
 */
export type ModelProviderCredentialTarget = {
  configPath: string;
};

export const modelProviderCredentialRegistry: Partial<Record<AddModelsProviderId, ModelProviderCredentialTarget>> = {
  openrouter: {
    configPath: "env.vars.OPENROUTER_API_KEY"
  },
  openai: {
    configPath: "env.vars.OPENAI_API_KEY"
  },
  anthropic: {
    configPath: "env.vars.ANTHROPIC_API_KEY"
  },
  google: {
    configPath: "env.vars.GEMINI_API_KEY"
  },
  xai: {
    configPath: "env.vars.XAI_API_KEY"
  },
  deepseek: {
    configPath: "env.vars.DEEPSEEK_API_KEY"
  },
  mistral: {
    configPath: "env.vars.MISTRAL_API_KEY"
  }
};

const unsupportedLegacyProviderIds = new Set(["codex", "openai-codex"]);

export function isUnsupportedLegacyProviderId(value: unknown): boolean {
  return typeof value === "string" && unsupportedLegacyProviderIds.has(value.trim().toLowerCase());
}

export function getModelProviderCredentialTarget(provider: AddModelsProviderId) {
  return modelProviderCredentialRegistry[provider] ?? null;
}

/**
 * Legacy descriptors kept for first-run and backwards-compatible Add Models
 * flows. Do not use this array to discover providers or capabilities in the
 * post-onboarding Models surface.
 */
export const modelProviderRegistry: Array<ModelProviderDescriptor & { id: BuiltInAddModelsProviderId; kind: "builtin" }> = [
  {
    id: "openai",
    kind: "builtin",
    label: "OpenAI / ChatGPT",
    shortLabel: "OpenAI",
    description: "Use an OpenAI API key or connect ChatGPT through OpenClaw's Codex runtime.",
    category: "primary",
    connectKind: "apiKey",
    authMethods: ["api-key", "chatgpt-oauth"],
    accent: "from-[#d8f5eb] via-[#ebfbf5] to-white",
    helperText: `OpenClaw ${OPENCLAW_RECOMMENDED_VERSION} uses provider openai with runtime codex for ChatGPT OAuth.`
  },
  {
    id: "openrouter",
    kind: "builtin",
    label: "OpenRouter",
    shortLabel: "OpenRouter",
    description: "Add an API key, discover the full catalog, and curate the models you want.",
    category: "primary",
    connectKind: "apiKey",
    accent: "from-[#fff2d7] via-[#fff7ea] to-white",
    helperText: "Best for broad model access and curated remote routes.",
    searchPlaceholder: "Search OpenRouter models"
  },
  {
    id: "ollama",
    kind: "builtin",
    label: "Ollama Local",
    shortLabel: "Ollama",
    description: "Discover models already available on this machine and add them instantly.",
    category: "primary",
    connectKind: "local",
    accent: "from-[#deefff] via-[#f2f8ff] to-white",
    helperText: "Local-first discovery with helpful pull commands when empty."
  },
  {
    id: "anthropic",
    kind: "builtin",
    label: "Anthropic",
    shortLabel: "Anthropic",
    description: "Paste an API key and add Claude models through the same flow.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#efe9ff] via-[#f7f3ff] to-white",
    helperText: "Simple API key connection."
  },
  {
    id: "google",
    kind: "builtin",
    label: "Gemini",
    shortLabel: "Gemini",
    description: "Add a Gemini API key, discover Google models, and pick the routes you want.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e6f7ff] via-[#f4fbff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search Gemini models"
  },
  {
    id: "deepseek",
    kind: "builtin",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    description: "Add a DeepSeek API key, discover the catalog, and add the models you need.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e7eeff] via-[#f4f7ff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search DeepSeek models"
  },
  {
    id: "mistral",
    kind: "builtin",
    label: "Mistral",
    shortLabel: "Mistral",
    description: "Add a Mistral API key, discover Mistral and Codestral models, and curate your routes.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#f2e8ff] via-[#fbf7ff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search Mistral models"
  },
  {
    id: "xai",
    kind: "builtin",
    label: "xAI",
    shortLabel: "xAI",
    description: "Use an xAI API key to bring Grok models into AgentOS.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#ffe6ea] via-[#fff3f5] to-white",
    helperText: "Simple API key connection."
  }
];

export const primaryModelProviders = modelProviderRegistry.filter((provider) => provider.category === "primary");

export const otherModelProviders = modelProviderRegistry.filter((provider) => provider.category === "other");

export function getModelProviderDescriptor(providerId: AddModelsProviderId) {
  const descriptor = modelProviderRegistry.find((provider) => provider.id === providerId);

  return descriptor ?? buildExplicitModelProviderDescriptor(providerId);
}

export function getBuiltInModelProviderDescriptor(providerId: BuiltInAddModelsProviderId) {
  return modelProviderRegistry.find((provider) => provider.id === providerId);
}

export function isBuiltInAddModelsProviderId(value: unknown): value is BuiltInAddModelsProviderId {
  return typeof value === "string" && modelProviderRegistry.some((provider) => provider.id === value);
}

export function isAddModelsProviderId(value: unknown): value is AddModelsProviderId {
  return typeof value === "string" &&
    !isUnsupportedLegacyProviderId(value) &&
    isValidExplicitProviderId(value);
}

export function normalizeAddModelsProviderId(value: unknown): AddModelsProviderId | null {
  if (value === "gemini") {
    return "google";
  }

  if (isBuiltInAddModelsProviderId(value) || isAddModelsProviderId(value)) {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidateId = (value as { id?: unknown }).id;

    if (candidateId === "gemini") {
      return "google";
    }

    if (isBuiltInAddModelsProviderId(candidateId) || isAddModelsProviderId(candidateId)) {
      return candidateId;
    }
  }

  return null;
}

export function formatModelProviderLabel(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  const presentation = modelProviderPresentationRegistry[normalized];
  const descriptor = modelProviderRegistry.find((provider) => provider.id === normalized);

  if (presentation?.shortLabel || presentation?.displayName) {
    return presentation.shortLabel ?? presentation.displayName ?? providerId;
  }
  if (descriptor) {
    return descriptor.shortLabel;
  }

  return providerId
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function isValidExplicitProviderId(value: string) {
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(value);
}

export function normalizeExplicitProviderId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

  return isUnsupportedLegacyProviderId(normalized) ? "" : normalized;
}

export function buildExplicitModelProviderDescriptor(providerId: string, label?: string | null): ModelProviderDescriptor {
  const resolvedLabel = label?.trim() || formatModelProviderLabel(providerId);

  return {
    id: providerId,
    kind: "explicit",
    label: resolvedLabel,
    shortLabel: resolvedLabel,
    description: "Use an explicit OpenAI-compatible provider configured in OpenClaw.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e6fbfb] via-[#f4ffff] to-white",
    helperText: "OpenClaw config-backed provider namespace.",
    searchPlaceholder: `Search ${resolvedLabel} models`
  };
}
