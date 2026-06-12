import type {
  AddModelsProviderId,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider
} from "@/lib/agentos/contracts";
import {
  OPENCLAW_SURFACE_CATALOG,
  getSurfaceCatalogEntry
} from "@/lib/openclaw/surface-catalog";

export type IntegrationId =
  | "telegram"
  | "discord"
  | "gmail"
  | "slack"
  | "google-chat"
  | "email"
  | "notion"
  | "google-drive"
  | "github"
  | "linear"
  | "chrome"
  | "webhooks"
  | "cron"
  | "x-twitter"
  | "openrouter"
  | "ollama";

export type IntegrationCategory =
  | "Communication"
  | "Productivity"
  | "Developer Tools"
  | "Browser / Automation"
  | "AI / Model Providers";

export type IntegrationManagedBy = "openclaw" | "agentos" | "external-config" | "unsupported";

export type IntegrationProviderType = "chat" | "inbox" | "trigger" | "model-provider" | "tool" | "external-app";

export type IntegrationActionCapability = {
  supported: boolean;
  reason: string;
};

export type IntegrationDescriptor = {
  id: IntegrationId;
  name: string;
  category: IntegrationCategory;
  description: string;
  managedBy: IntegrationManagedBy;
  providerType: IntegrationProviderType;
  surfaceProvider?: MissionControlSurfaceProvider;
  surfaceKind?: MissionControlSurfaceKind;
  modelProvider?: AddModelsProviderId;
  toolHints?: string[];
  permissions: string[];
  setupRequirements: string[];
  configure: IntegrationActionCapability;
  reconnect: IntegrationActionCapability;
  disable: IntegrationActionCapability;
  docsUrl?: string | null;
};

const modelProviderDocsUrl = "https://docs.openclaw.ai/cli/models";

function openClawSurfaceDescriptor(input: {
  id: IntegrationId;
  provider: MissionControlSurfaceProvider;
  name?: string;
  category: IntegrationCategory;
  description?: string;
  permissions: string[];
}) {
  const catalogEntry = getSurfaceCatalogEntry(input.provider);
  const requiredFields = catalogEntry.provisionFields
    .filter((field) => field.required)
    .map((field) => field.label);

  return {
    id: input.id,
    name: input.name ?? catalogEntry.label,
    category: input.category,
    description: input.description ?? catalogEntry.description,
    managedBy: "openclaw",
    providerType: catalogEntry.kind,
    surfaceProvider: input.provider,
    surfaceKind: catalogEntry.kind,
    permissions: input.permissions,
    setupRequirements: requiredFields.length > 0
      ? requiredFields
      : catalogEntry.provisionFields.map((field) => field.label).slice(0, 4),
    configure: {
      supported: catalogEntry.supportsProvisioning,
      reason: catalogEntry.supportsProvisioning
        ? "Managed by the existing AgentOS workspace integration setup flow."
        : "OpenClaw does not expose provisioning fields for this integration yet."
    },
    reconnect: {
      supported: true,
      reason: "Uses OpenClaw Gateway channels.status when available, with the existing adapter fallback."
    },
    disable: {
      supported: true,
      reason: "Can disconnect the workspace integration binding through the existing workspace channels API."
    },
    docsUrl: null
  } satisfies IntegrationDescriptor;
}

export const integrationRegistry: readonly IntegrationDescriptor[] = [
  openClawSurfaceDescriptor({
    id: "telegram",
    provider: "telegram",
    category: "Communication",
    permissions: ["Chat routing", "Group routing", "Bot token required", "Route discovery"]
  }),
  openClawSurfaceDescriptor({
    id: "discord",
    provider: "discord",
    category: "Communication",
    permissions: ["Server routing", "Channel routing", "Bot token required", "Route discovery"]
  }),
  openClawSurfaceDescriptor({
    id: "gmail",
    provider: "gmail",
    category: "Communication",
    permissions: ["Inbox access", "Webhook triggers", "Draft/send workflow", "OAuth or Pub/Sub configuration"]
  }),
  openClawSurfaceDescriptor({
    id: "slack",
    provider: "slack",
    category: "Productivity",
    permissions: ["Workspace chat", "Channel alerts", "Bot token required"]
  }),
  openClawSurfaceDescriptor({
    id: "google-chat",
    provider: "googlechat",
    name: "Google Chat",
    category: "Communication",
    permissions: ["Space alerts", "Webhook delivery", "Webhook URL required"]
  }),
  openClawSurfaceDescriptor({
    id: "email",
    provider: "email",
    name: "Email",
    category: "Communication",
    permissions: ["Inbox access", "Outbound mail when configured", "OAuth or IMAP/SMTP configuration"]
  }),
  {
    id: "notion",
    name: "Notion",
    category: "Productivity",
    description: "Sync knowledge bases, briefs, and planning pages.",
    managedBy: "unsupported",
    providerType: "external-app",
    permissions: ["Unavailable until an AgentOS/OpenClaw Notion connector exists."],
    setupRequirements: ["OpenClaw connector support"],
    configure: {
      supported: false,
      reason: "No Notion setup route or OpenClaw connector is exposed in this codebase."
    },
    reconnect: {
      supported: false,
      reason: "No Notion health check method is exposed in this codebase."
    },
    disable: {
      supported: false,
      reason: "No Notion connection record exists to disable."
    },
    docsUrl: null
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "Productivity",
    description: "Use shared documents and generated outputs as workspace context.",
    managedBy: "unsupported",
    providerType: "external-app",
    permissions: ["Unavailable until a Drive connector is exposed."],
    setupRequirements: ["OpenClaw connector support"],
    configure: {
      supported: false,
      reason: "Workspace files are local AgentOS/OpenClaw files; no Google Drive connector is exposed yet."
    },
    reconnect: {
      supported: false,
      reason: "No Google Drive health check method is exposed in this codebase."
    },
    disable: {
      supported: false,
      reason: "No Google Drive connection record exists to disable."
    },
    docsUrl: null
  },
  {
    id: "github",
    name: "GitHub",
    category: "Developer Tools",
    description: "Connect repositories, issues, pull requests, and release automation.",
    managedBy: "unsupported",
    providerType: "external-app",
    permissions: ["Unavailable until a GitHub connector is exposed."],
    setupRequirements: ["OpenClaw connector support"],
    configure: {
      supported: false,
      reason: "No GitHub setup route or OpenClaw connector is exposed in this codebase."
    },
    reconnect: {
      supported: false,
      reason: "No GitHub health check method is exposed in this codebase."
    },
    disable: {
      supported: false,
      reason: "No GitHub connection record exists to disable."
    },
    docsUrl: null
  },
  {
    id: "linear",
    name: "Linear",
    category: "Developer Tools",
    description: "Sync tasks, roadmaps, and delivery queues.",
    managedBy: "unsupported",
    providerType: "external-app",
    permissions: ["Unavailable until a Linear connector is exposed."],
    setupRequirements: ["OpenClaw connector support"],
    configure: {
      supported: false,
      reason: "No Linear setup route or OpenClaw connector is exposed in this codebase."
    },
    reconnect: {
      supported: false,
      reason: "No Linear health check method is exposed in this codebase."
    },
    disable: {
      supported: false,
      reason: "No Linear connection record exists to disable."
    },
    docsUrl: null
  },
  {
    id: "chrome",
    name: "Chrome / Browser Automation",
    category: "Browser / Automation",
    description: "Give browser agents controlled web automation access.",
    managedBy: "agentos",
    providerType: "tool",
    toolHints: ["browser", "chrome", "web_search", "web_fetch"],
    permissions: ["Agent tool declarations", "Runtime tool usage metadata"],
    setupRequirements: ["Agent with browser-capable tools"],
    configure: {
      supported: false,
      reason: "Browser automation is inferred from agent tool configuration; no dedicated connector setup flow exists."
    },
    reconnect: {
      supported: false,
      reason: "OpenClaw exposes tool catalogs, but no browser connector retest action is wired here."
    },
    disable: {
      supported: false,
      reason: "Disable browser tools from the agent capability editor instead of this integration card."
    },
    docsUrl: null
  },
  openClawSurfaceDescriptor({
    id: "webhooks",
    provider: "webhook",
    name: "Webhooks",
    category: "Browser / Automation",
    permissions: ["Inbound triggers", "Shared hook token", "Path configuration"]
  }),
  openClawSurfaceDescriptor({
    id: "cron",
    provider: "cron",
    name: "Cron",
    category: "Browser / Automation",
    permissions: ["Scheduled triggers", "Run log metadata", "Webhook token required"]
  }),
  {
    id: "x-twitter",
    name: "X / Twitter",
    category: "Browser / Automation",
    description: "Monitor social trends and route campaign signals.",
    managedBy: "unsupported",
    providerType: "external-app",
    permissions: ["Unavailable until an X/Twitter connector is exposed."],
    setupRequirements: ["OpenClaw connector support"],
    configure: {
      supported: false,
      reason: "No X/Twitter setup route or OpenClaw connector is exposed in this codebase."
    },
    reconnect: {
      supported: false,
      reason: "No X/Twitter health check method is exposed in this codebase."
    },
    disable: {
      supported: false,
      reason: "No X/Twitter connection record exists to disable."
    },
    docsUrl: null
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "AI / Model Providers",
    description: "Route agents across broad hosted model catalogs.",
    managedBy: "openclaw",
    providerType: "model-provider",
    modelProvider: "openrouter",
    permissions: ["Model catalog discovery", "Configured model routes", "API key stored by OpenClaw"],
    setupRequirements: ["OpenRouter API key", "At least one configured model route"],
    configure: {
      supported: true,
      reason: "Uses the existing Add Models provider setup flow."
    },
    reconnect: {
      supported: true,
      reason: "Uses the existing /api/models/providers status action."
    },
    disable: {
      supported: false,
      reason: "Model provider removal/disable is not exposed by AgentOS or OpenClaw here yet."
    },
    docsUrl: modelProviderDocsUrl
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "AI / Model Providers",
    description: "Use local models for private and low-cost background tasks.",
    managedBy: "openclaw",
    providerType: "model-provider",
    modelProvider: "ollama",
    permissions: ["Local model discovery", "Configured model routes"],
    setupRequirements: ["Ollama installed locally", "At least one pulled local model"],
    configure: {
      supported: true,
      reason: "Uses the existing Add Models provider setup flow."
    },
    reconnect: {
      supported: true,
      reason: "Uses the existing /api/models/providers status action."
    },
    disable: {
      supported: false,
      reason: "Ollama is a local runtime dependency; disabling is not exposed by AgentOS here."
    },
    docsUrl: modelProviderDocsUrl
  }
];

const integrationById = new Map<IntegrationId, IntegrationDescriptor>(
  integrationRegistry.map((integration) => [integration.id, integration])
);

export function getIntegrationDescriptor(id: IntegrationId) {
  return integrationById.get(id) ?? null;
}

export function isIntegrationId(value: unknown): value is IntegrationId {
  return typeof value === "string" && integrationById.has(value as IntegrationId);
}

export function normalizeIntegrationLookupKey(value: string) {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");

  if (normalized === "webhook") {
    return "webhooks";
  }

  if (normalized === "googlechat") {
    return "google-chat";
  }

  if (normalized === "browser") {
    return "chrome";
  }

  if (normalized === "x" || normalized === "twitter") {
    return "x-twitter";
  }

  return normalized;
}

export function findIntegrationBySurfaceProvider(provider: MissionControlSurfaceProvider) {
  const key = normalizeIntegrationLookupKey(provider);
  return integrationRegistry.find((integration) => integration.id === key || integration.surfaceProvider === provider) ?? null;
}

export function isKnownOpenClawSurfaceProvider(provider: MissionControlSurfaceProvider) {
  return OPENCLAW_SURFACE_CATALOG.some((entry) => entry.provider === provider);
}
