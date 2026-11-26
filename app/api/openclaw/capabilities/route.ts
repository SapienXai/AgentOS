import { NextResponse } from "next/server";
import { z } from "zod";

import { listGuidedAbilities } from "@/lib/agentos/application/guided-abilities";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  getOpenClawPluginCatalog,
  listOpenClawPlugins,
  listOpenClawSkills,
  listOpenClawTools,
  normalizeOpenClawToolsCatalog,
  type OpenClawCapabilityToolEntry
} from "@/lib/openclaw/application/catalog-service";
import { resolvePluginCatalogContext } from "@/lib/openclaw/application/plugin-catalog-context";
import type { PluginCatalogProjection } from "@/lib/openclaw/domains/plugin-catalog";
import {
  OPENCLAW_BUILTIN_TOOL_CATALOG,
  OPENCLAW_TOOL_GROUP_CATALOG
} from "@/lib/openclaw/tool-catalog";
import { redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

const pluginCatalogQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  category: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/).optional(),
  intent: z.enum(["all", "bundled", "trending", "official", "featured"]).optional(),
  cursor: z.string().trim().max(4096).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  pluginId: z.string().trim().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
  workspaceId: z.string().trim().min(1).max(512).optional(),
  agentId: z.string().trim().min(1).max(512).optional(),
  version: z.string().trim().min(1).max(128).optional()
});

type CapabilitySkillEntry = {
  name: string;
  description: string;
  emoji: string | null;
  source: string;
  eligible: boolean;
};

type CapabilityCatalogResponse = {
  generatedAt: string;
  skills: CapabilitySkillEntry[];
  tools: OpenClawCapabilityToolEntry[];
  toolSource: "openclaw-gateway" | "static-fallback";
  pluginCatalog: PluginCatalogProjection;
};

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "agents.read");
  if ("response" in permission) return permission.response;

  const searchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  if (searchParams.view === "guided-abilities") {
    const manage = await requireAgentOsProductPermission(request, "agents.manage");
    if ("response" in manage) return manage.response;
    const tools = await listGuidedAbilities().catch(() => null);
    if (!tools) return NextResponse.json({ error: "Current ability inventory unavailable." }, { status: 503 });
    return NextResponse.json(redactSecrets({ tools }), { headers: { "Cache-Control": "private, no-store" } });
  }
  if (searchParams.view === "ability-library") {
    const manage = await requireAgentOsProductPermission(request, "agents.manage");
    if ("response" in manage) return manage.response;
    const [tools, skills] = await Promise.allSettled([
      listOpenClawTools({ includePlugins: true }, { timeoutMs: 8_000 }),
      listOpenClawSkills({ timeoutMs: 8_000 })
    ]);
    if (tools.status === "rejected" && skills.status === "rejected") {
      return NextResponse.json({ error: "OpenClaw could not verify the capability library." }, { status: 503 });
    }
    return NextResponse.json(redactSecrets({
      groups: tools.status === "fulfilled" ? tools.value.groups.map(group => ({
        id: group.id,
        label: group.label,
        items: group.tools.map(tool => ({
          id: tool.id,
          label: tool.label ?? tool.id,
          description: tool.description,
          setup: "Review employee permissions"
        }))
      })) : [],
      skills: skills.status === "fulfilled" ? skills.value.skills.map(skill => ({
        id: skill.name,
        label: skill.name,
        description: skill.description,
        setup: skill.disabled || skill.blockedByAllowlist ? "Disabled by configuration"
          : skill.eligible === false ? "Prerequisites needed" : "Review employee access"
      })) : [],
      partial: tools.status === "rejected" || skills.status === "rejected"
    }), { headers: { "Cache-Control": "private, no-store" } });
  }
  const parsedQuery = pluginCatalogQuerySchema.safeParse(searchParams);
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid native plugin catalog query." }, { status: 400 });
  }

  const { workspaceId, agentId, ...catalogQuery } = parsedQuery.data;
  const context = await resolveServerPluginCatalogContext(workspaceId, agentId);
  const [skillResult, pluginResult, toolCatalogResult, pluginCatalogResult] = await Promise.allSettled([
    listOpenClawSkills({ eligible: true, timeoutMs: 15_000 }),
    listOpenClawPlugins({ timeoutMs: 15_000 }),
    listOpenClawTools({ includePlugins: true }, { timeoutMs: 15_000 }),
    getOpenClawPluginCatalog({ ...catalogQuery, context }, { timeoutMs: 15_000 })
  ]);

  const skills =
    skillResult.status === "fulfilled" && Array.isArray(skillResult.value.skills)
      ? skillResult.value.skills
          .map((skill) => ({
            name: skill.name.trim(),
            description: normalizeDescription(skill.description) ?? "No description available.",
            emoji: normalizeDescription(skill.emoji),
            source: normalizeDescription(skill.source) ?? (skill.bundled ? "openclaw-bundled" : "openclaw"),
            eligible: skill.eligible !== false && skill.disabled !== true && skill.blockedByAllowlist !== true
          }))
          .filter((skill) => Boolean(skill.name))
      : [];

  const liveTools =
    toolCatalogResult.status === "fulfilled"
      ? normalizeOpenClawToolsCatalog(toolCatalogResult.value)
      : null;
  const toolSource = liveTools === null ? "static-fallback" : "openclaw-gateway";
  const fallbackTools = [...OPENCLAW_BUILTIN_TOOL_CATALOG, ...OPENCLAW_TOOL_GROUP_CATALOG];
  const toolMap = new Map<string, OpenClawCapabilityToolEntry>();

  for (const entry of liveTools ?? fallbackTools) {
    toolMap.set(entry.name, entry);
  }

  if (liveTools === null && pluginResult.status === "fulfilled" && Array.isArray(pluginResult.value.plugins)) {
    for (const plugin of pluginResult.value.plugins) {
      if (plugin.status !== "loaded" || !Array.isArray(plugin.toolNames)) {
        continue;
      }

      for (const toolName of plugin.toolNames) {
        const trimmedToolName = toolName.trim();
        if (!trimmedToolName || toolMap.has(trimmedToolName)) {
          continue;
        }

        toolMap.set(trimmedToolName, {
          name: trimmedToolName,
          description: `Provided by ${plugin.name}.`,
          source: plugin.name,
          category: "plugin",
          pluginId: plugin.id,
          pluginName: plugin.name
        });
      }
    }
  }

  const response: CapabilityCatalogResponse = {
    generatedAt: new Date().toISOString(),
    skills,
    toolSource,
    tools: Array.from(toolMap.values()).sort(sortCatalogEntries),
    pluginCatalog: pluginCatalogResult.status === "fulfilled"
      ? pluginCatalogResult.value
      : {
          source: "openclaw-gateway",
          generatedAt: new Date().toISOString(),
          state: "unknown",
          liveProof: false,
          items: [],
          categories: [],
          nextCursor: null,
          remoteError: null,
          detail: null,
          detailError: null,
          failures: [],
          context: null,
          recovery: "Retry the native OpenClaw catalog request and inspect Gateway diagnostics if it continues."
        }
  };

  return NextResponse.json(redactSecrets(response), {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function resolveServerPluginCatalogContext(workspaceId?: string, agentId?: string) {
  if (!workspaceId || !agentId) {
    return null;
  }

  try {
    const snapshot = await getMissionControlSnapshot();
    return resolvePluginCatalogContext(snapshot, workspaceId, agentId);
  } catch {
    return null;
  }
}

function normalizeDescription(value: string | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sortCatalogEntries(left: OpenClawCapabilityToolEntry, right: OpenClawCapabilityToolEntry) {
  const categoryRank = getCategoryRank(left.category) - getCategoryRank(right.category);
  if (categoryRank !== 0) {
    return categoryRank;
  }

  const sourceRank = left.source.localeCompare(right.source);
  if (sourceRank !== 0) {
    return sourceRank;
  }

  return left.name.localeCompare(right.name);
}

function getCategoryRank(category: OpenClawCapabilityToolEntry["category"]) {
  if (category === "builtin") {
    return 0;
  }

  if (category === "plugin") {
    return 1;
  }

  return 2;
}
