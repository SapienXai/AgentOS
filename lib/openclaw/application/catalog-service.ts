import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawCommandOptions,
  OpenClawListModelsInput,
  OpenClawToolsCatalogInput,
  OpenClawToolsCatalogPayload
} from "@/lib/openclaw/client/types";
import type { OpenClawToolCatalogEntry } from "@/lib/openclaw/tool-catalog";

export type OpenClawCapabilityToolEntry = OpenClawToolCatalogEntry & {
  pluginId?: string;
  pluginName?: string;
};

export function listOpenClawSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
  return getOpenClawAdapter().listSkills(options);
}

export function listOpenClawPlugins(options: OpenClawCommandOptions = {}) {
  return getOpenClawAdapter().listPlugins(options);
}

export function listOpenClawTools(
  input: OpenClawToolsCatalogInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().getToolsCatalog(input, options);
}

/**
 * Normalize live OpenClaw tool discovery for AgentOS operator surfaces.
 * The static tool catalog is intentionally not consulted here; callers decide
 * whether to use it only when this live Gateway capability is unavailable.
 */
export function normalizeOpenClawToolsCatalog(payload: OpenClawToolsCatalogPayload): OpenClawCapabilityToolEntry[] {
  const entries = new Map<string, OpenClawCapabilityToolEntry>();
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];

  for (const group of groups) {
    const groupSource = group?.source === "plugin" ? "plugin" : "builtin";
    const groupPluginId = normalizeCatalogText(group?.pluginId);

    for (const tool of Array.isArray(group?.tools) ? group.tools : []) {
      const name = normalizeCatalogText(tool?.id);
      if (!name || entries.has(name)) {
        continue;
      }

      const category = tool?.source === "plugin" || groupSource === "plugin" ? "plugin" : "builtin";
      const pluginId = normalizeCatalogText(tool?.pluginId) ?? groupPluginId;
      const pluginName = category === "plugin" ? normalizeCatalogText(group?.label) : null;
      const entry: OpenClawCapabilityToolEntry = {
        name,
        description:
          normalizeCatalogText(tool?.description) ??
          normalizeCatalogText(tool?.label) ??
          "No description available.",
        source: category === "plugin" ? pluginName ?? "OpenClaw plugin" : "OpenClaw Gateway",
        category,
        ...(pluginId ? { pluginId } : {}),
        ...(pluginName ? { pluginName } : {})
      };

      entries.set(name, entry);
    }
  }

  return Array.from(entries.values());
}

export function listOpenClawModels(
  input: OpenClawListModelsInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().listModels(input, options);
}

export function scanOpenClawModels(options: OpenClawCommandOptions & {
  yes?: boolean;
  noInput?: boolean;
  noProbe?: boolean;
} = {}) {
  return getOpenClawAdapter().scanModels(options);
}

function normalizeCatalogText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
