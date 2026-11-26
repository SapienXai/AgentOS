import "server-only";

import { DRAFT_TOOL_LABELS } from "@/lib/agentos/domains/draft-abilities";
import { listOpenClawTools, normalizeOpenClawToolsCatalog } from "@/lib/openclaw/application/catalog-service";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";

const guidedMemory = new Set(["memory_search", "memory_get"]);

export async function listGuidedAbilities(options: OpenClawCommandOptions = {}) {
  const catalog = await listOpenClawTools({ includePlugins: true }, { timeoutMs: 5000, ...options, allowCliFallback: false });
  return normalizeOpenClawToolsCatalog(catalog)
    .filter(tool => Object.hasOwn(DRAFT_TOOL_LABELS, tool.name) &&
      (tool.category === "builtin" || (guidedMemory.has(tool.name) && tool.pluginId === "memory-core")))
    .map(({ name, description }) => ({ name, description }));
}

export async function validateGuidedToolIds(ids: readonly string[], options?: OpenClawCommandOptions) {
  if (!ids.length) return [];
  const supported = new Set((await listGuidedAbilities(options)).map(tool => tool.name));
  if (ids.some(id => !supported.has(id))) throw new Error("A selected ability is unavailable. Refresh the live abilities and try again.");
  return [...new Set(ids)];
}
