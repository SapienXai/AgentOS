import type {
  AddModelsProviderCategory,
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
  accent: string;
  helperText: string;
  kind?: "builtin" | "explicit" | "action";
  searchPlaceholder?: string;
};

export const modelProviderRegistry: Array<ModelProviderDescriptor & { id: BuiltInAddModelsProviderId; kind: "builtin" }> = [
  {
    id: "openai-codex",
    kind: "builtin",
    label: "ChatGPT",
    shortLabel: "ChatGPT",
    description: "Use OpenClaw's Codex app-server provider and pull in Codex-ready models.",
    category: "primary",
    connectKind: "oauth",
    accent: "from-[#d8f5eb] via-[#ebfbf5] to-white",
    helperText: `OpenClaw ${OPENCLAW_RECOMMENDED_VERSION} uses the Codex app-server plugin for this route.`
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
    id: "openai",
    kind: "builtin",
    label: "OpenAI API",
    shortLabel: "OpenAI",
    description: "Connect a standard OpenAI API key for direct GPT model access.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e8f8e8] via-[#f4fbf4] to-white",
    helperText: "Use this for API-key-based OpenAI routing."
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
  return typeof value === "string" && isValidExplicitProviderId(value);
}

export function normalizeAddModelsProviderId(value: unknown): AddModelsProviderId | null {
  if (value === "codex") {
    return "openai-codex";
  }

  if (value === "gemini") {
    return "google";
  }

  if (isBuiltInAddModelsProviderId(value) || isAddModelsProviderId(value)) {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidateId = (value as { id?: unknown }).id;

    if (candidateId === "codex") {
      return "openai-codex";
    }

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
  if (providerId === "codex") {
    return "Codex";
  }

  const descriptor = modelProviderRegistry.find((provider) => provider.id === providerId);

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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
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
