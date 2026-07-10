import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  parseAgentIdentityMarkdown,
  renderAgentIdentityMarkdown as renderAgentIdentityMarkdownTemplate
} from "@/lib/openclaw/agent-bootstrap-files";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import type {
  AgentBootstrapFileInput,
  AgentHeartbeatInput,
  AgentMemorySearchConfig,
  AgentMemorySearchInput,
  AgentSandboxConfig,
  AgentSandboxInput,
  AgentToolPolicyConfig,
  AgentToolPolicyInput,
  MissionControlSnapshot,
  OpenClawAgent
} from "@/lib/openclaw/types";

export type MutableAgentToolsConfig = Omit<AgentToolPolicyConfig, "fs"> & {
  fs?: ({
    workspaceOnly?: boolean;
  } & Record<string, unknown>);
} & Record<string, unknown>;

export type MutableAgentSandboxConfig = AgentSandboxConfig & Record<string, unknown>;

export type MutableAgentConfigEntry = {
  id: string;
  workspace: string;
  agentDir?: string;
  name?: string;
  description?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: MutableAgentToolsConfig;
  sandbox?: MutableAgentSandboxConfig;
  memorySearch?: AgentMemorySearchConfig;
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
} & Record<string, unknown>;

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function extractErrorMessage(error: unknown) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    const parts = [error.message];
    if ("stderr" in error && typeof error.stderr === "string") {
      parts.push(error.stderr);
    }
    if ("stdout" in error && typeof error.stdout === "string") {
      parts.push(error.stdout);
    }
    return parts.filter(Boolean).join("\n");
  }

  if (typeof error === "string") {
    return error;
  }

  return "";
}

export function buildWorkspaceAgentStatePath(workspacePath: string, agentId: string) {
  return path.join(workspacePath, ".openclaw", "agents", agentId, "agent");
}

export function mapAgentHeartbeatToInput(heartbeat: OpenClawAgent["heartbeat"]): AgentHeartbeatInput {
  return {
    enabled: heartbeat.enabled,
    every: heartbeat.every ?? undefined
  };
}

export function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

export function isAgentPolicySkillId(skillId: string | undefined) {
  return Boolean(skillId && /^agent-policy-/.test(skillId));
}

export function filterAgentPolicySkills(skills: string[]) {
  return skills.filter((skillId) => !isAgentPolicySkillId(skillId));
}

export function normalizeDeclaredAgentSkills(skillIds: string[]) {
  return uniqueStrings(
    filterAgentPolicySkills(skillIds)
      .filter((skillId) => typeof skillId === "string")
      .map((skillId) => skillId.trim())
      .filter(Boolean)
  );
}

export function normalizeDeclaredAgentTools(toolIds: string[]) {
  return uniqueStrings(
    toolIds
      .filter((toolId) => typeof toolId === "string")
      .map((toolId) => toolId.trim())
      .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
  );
}

export async function readAgentConfigList(snapshot?: MissionControlSnapshot) {
  try {
    const config = await getOpenClawAdapter().getConfig<MutableAgentConfigEntry[]>("agents.list");

    if (Array.isArray(config)) {
      return config;
    }

    return config == null && snapshot ? buildAgentConfigListFromSnapshot(snapshot) : [];
  } catch (error) {
    if (isMissingAgentConfigListError(error)) {
      return snapshot ? buildAgentConfigListFromSnapshot(snapshot) : [];
    }

    throw error;
  }
}

export async function writeAgentConfigList(configList: MutableAgentConfigEntry[]) {
  await getOpenClawAdapter().setConfig("agents.list", configList, { strictJson: true });
}

export async function upsertAgentConfigEntry(
  agentId: string,
  workspacePath: string,
  updates: {
    agentDir?: string | null;
    name?: string | null;
    description?: string | null;
    model?: string | null;
    heartbeat?: { every?: string } | null;
    skills?: string[];
    tools?: AgentToolPolicyInput | null;
    sandbox?: AgentSandboxInput | null;
    memorySearch?: AgentMemorySearchInput | null;
    identity?: {
      name?: string | null;
      emoji?: string | null;
      theme?: string | null;
      avatar?: string | null;
    } | null;
  },
  snapshot?: MissionControlSnapshot,
  timings?: TimingCollector
) {
  const configList = await measureTiming(timings, "agent-config.read", () => readAgentConfigList(snapshot));
  const existingIndex = configList.findIndex((entry) => entry.id === agentId);
  const existingEntry = existingIndex >= 0 ? configList[existingIndex] : null;
  const nextEntry: MutableAgentConfigEntry =
    existingEntry
      ? { ...existingEntry }
      : {
          id: agentId,
          workspace: workspacePath
        };

  nextEntry.workspace = workspacePath;

  if (updates.agentDir !== undefined) {
    const nextAgentDir = normalizeOptionalValue(updates.agentDir);
    if (nextAgentDir) {
      nextEntry.agentDir = nextAgentDir;
    } else {
      delete nextEntry.agentDir;
    }
  }

  if (updates.name !== undefined) {
    const nextName = normalizeOptionalValue(updates.name);
    if (nextName) {
      nextEntry.name = nextName;
    } else {
      delete nextEntry.name;
    }
  }

  if (updates.description !== undefined) {
    const nextDescription = normalizeOptionalValue(updates.description);
    if (nextDescription) {
      nextEntry.description = nextDescription;
    } else {
      delete nextEntry.description;
    }
  }

  if (updates.model !== undefined) {
    const nextModel = normalizeOptionalValue(updates.model);
    if (nextModel) {
      nextEntry.model = nextModel;
    } else {
      delete nextEntry.model;
    }
  }

  if (updates.heartbeat?.every) {
    nextEntry.heartbeat = {
      every: updates.heartbeat.every
    };
  } else if (updates.heartbeat === null) {
    delete nextEntry.heartbeat;
  }

  if (Array.isArray(updates.skills) && updates.skills.length > 0) {
    nextEntry.skills = uniqueStrings(updates.skills);
  } else if (Array.isArray(updates.skills)) {
    delete nextEntry.skills;
  }

  if (updates.tools === null) {
    delete nextEntry.tools;
  } else if (updates.tools !== undefined) {
    const nextTools = mergeAgentToolsConfig(nextEntry.tools, updates.tools);

    if (nextTools) {
      nextEntry.tools = nextTools;
    } else {
      delete nextEntry.tools;
    }
  }

  if (updates.sandbox === null) {
    delete nextEntry.sandbox;
  } else if (updates.sandbox !== undefined) {
    const nextSandbox = mergeAgentSandboxConfig(nextEntry.sandbox, updates.sandbox);

    if (nextSandbox) {
      nextEntry.sandbox = nextSandbox;
    } else {
      delete nextEntry.sandbox;
    }
  }

  if (updates.memorySearch === null) {
    delete nextEntry.memorySearch;
  } else if (updates.memorySearch !== undefined) {
    const nextMemorySearch = mergeAgentMemorySearchConfig(nextEntry.memorySearch, updates.memorySearch);

    if (nextMemorySearch) {
      nextEntry.memorySearch = nextMemorySearch;
    } else {
      delete nextEntry.memorySearch;
    }
  }

  if (updates.identity !== undefined) {
    if (updates.identity === null) {
      delete nextEntry.identity;
    } else {
      const identity = normalizeAgentIdentity(updates.identity);

      if (Object.keys(identity).length > 0) {
        nextEntry.identity = identity;
      } else {
        delete nextEntry.identity;
      }
    }
  }

  if (existingIndex >= 0) {
    configList[existingIndex] = nextEntry;
  } else {
    configList.push(nextEntry);
  }

  if (existingEntry && jsonValuesEqual(existingEntry, nextEntry)) {
    return nextEntry;
  }

  await measureTiming(timings, "agent-config.write", () => writeAgentConfigList(configList));
  return nextEntry;
}

function normalizeAgentIdentity(identity: {
  name?: string | null;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
}) {
  const name = normalizeOptionalValue(identity.name);
  const emoji = normalizeOptionalValue(identity.emoji);
  const theme = normalizeOptionalValue(identity.theme);
  const avatar = normalizeOptionalValue(identity.avatar);

  return {
    ...(name ? { name } : {}),
    ...(emoji ? { emoji } : {}),
    ...(theme ? { theme } : {}),
    ...(avatar ? { avatar } : {})
  };
}

function mergeAgentToolsConfig(
  existing: MutableAgentToolsConfig | undefined,
  patch: AgentToolPolicyInput
): MutableAgentToolsConfig | null {
  const next: MutableAgentToolsConfig = existing ? { ...existing } : {};

  if (patch.profile !== undefined) {
    if (patch.profile === null) {
      delete next.profile;
    } else {
      next.profile = patch.profile;
    }
  }

  if (patch.allow !== undefined) {
    if (patch.allow === null) {
      delete next.allow;
    } else {
      next.allow = uniqueStrings(patch.allow.map((entry) => entry.trim()).filter(Boolean));
    }
  }

  if (patch.deny !== undefined) {
    if (patch.deny === null) {
      delete next.deny;
    } else {
      next.deny = uniqueStrings(patch.deny.map((entry) => entry.trim()).filter(Boolean));
    }
  }

  if (patch.fs !== undefined) {
    if (patch.fs === null) {
      delete next.fs;
    } else {
      const nextFs = next.fs ? { ...next.fs } : {};

      if (patch.fs.workspaceOnly !== undefined) {
        nextFs.workspaceOnly = patch.fs.workspaceOnly;
      }

      if (Object.keys(nextFs).length > 0) {
        next.fs = nextFs;
      } else {
        delete next.fs;
      }
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

function mergeAgentSandboxConfig(
  existing: MutableAgentSandboxConfig | undefined,
  patch: AgentSandboxInput
): MutableAgentSandboxConfig | null {
  const next: MutableAgentSandboxConfig = existing ? { ...existing } : {};

  if (patch.mode === null) delete next.mode;
  else if (patch.mode !== undefined) next.mode = patch.mode;

  if (patch.scope === null) delete next.scope;
  else if (patch.scope !== undefined) next.scope = patch.scope;

  if (patch.workspaceAccess === null) delete next.workspaceAccess;
  else if (patch.workspaceAccess !== undefined) next.workspaceAccess = patch.workspaceAccess;

  return Object.keys(next).length > 0 ? next : null;
}

function mergeAgentMemorySearchConfig(
  existing: AgentMemorySearchConfig | undefined,
  patch: AgentMemorySearchInput
): AgentMemorySearchConfig | null {
  const next: AgentMemorySearchConfig = existing ? { ...existing } : {};

  if (patch.enabled !== undefined) {
    if (patch.enabled === null) {
      delete next.enabled;
    } else {
      next.enabled = patch.enabled;
    }
  }

  if (patch.sources !== undefined) {
    if (patch.sources === null) {
      delete next.sources;
    } else {
      next.sources = uniqueStrings(
        patch.sources.filter((source): source is "memory" | "sessions" => source === "memory" || source === "sessions")
      ) as Array<"memory" | "sessions">;
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

export async function applyAgentIdentity(
  agentId: string,
  workspacePath: string,
  identity: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
    content?: string;
  },
  agentDir?: string,
  timings?: TimingCollector
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);
  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");
  const identityMarkdown =
    normalizeOptionalValue(identity.content) ??
    renderAgentIdentityMarkdownTemplate({
      name: normalizeOptionalValue(identity.name) ?? agentId,
      emoji: normalizeOptionalValue(identity.emoji),
      theme: normalizeOptionalValue(identity.theme),
      avatar: normalizeOptionalValue(identity.avatar)
    });

  await measureTiming(timings, "agent-identity.write-file", async () => {
    await mkdir(path.dirname(identityFilePath), { recursive: true });
    await writeFile(identityFilePath, identityMarkdown, "utf8");
  });
}

export async function writeAgentBootstrapFiles(
  agentId: string,
  workspacePath: string,
  files: AgentBootstrapFileInput[],
  agentDir?: string
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);

  await mkdir(resolvedAgentDir, { recursive: true });

  for (const file of files) {
    const filePath = path.join(resolvedAgentDir, file.path);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
}

export async function removeLegacyAgentContextFiles(
  agentId: string,
  workspacePath: string,
  agentDir?: string
) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir) ?? buildWorkspaceAgentStatePath(workspacePath, agentId);
  const legacyFileNames = ["IDENTITY.md", "SOUL.md", "TOOLS.md", "HEARTBEAT.md"];

  await Promise.all(
    legacyFileNames.map((fileName) =>
      rm(path.join(resolvedAgentDir, fileName), { force: true }).catch(() => undefined)
    )
  );
}

export async function readAgentIdentityOverrides(agentDir?: string) {
  const resolvedAgentDir = normalizeOptionalValue(agentDir);

  if (!resolvedAgentDir) {
    return { name: null, emoji: null, theme: null, avatar: null };
  }

  const identityFilePath = path.join(resolvedAgentDir, "IDENTITY.md");

  try {
    const raw = await readFile(identityFilePath, "utf8");
    const parsed = parseAgentIdentityMarkdown(raw);

    return {
      name: parsed.name,
      emoji: parsed.emoji,
      theme: parsed.theme,
      avatar: parsed.avatar
    };
  } catch {
    return { name: null, emoji: null, theme: null, avatar: null };
  }
}

function buildAgentConfigListFromSnapshot(snapshot: MissionControlSnapshot) {
  return snapshot.agents.map((agent) => {
    const displayName = formatAgentDisplayName(agent);
    const identity = {
      name: displayName,
      ...(agent.identity.emoji ? { emoji: agent.identity.emoji } : {}),
      ...(agent.identity.theme ? { theme: agent.identity.theme } : {}),
      ...(agent.identity.avatar ? { avatar: agent.identity.avatar } : {})
    };

    const configEntry: MutableAgentConfigEntry = {
      id: agent.id,
      workspace: agent.workspacePath,
      agentDir: agent.agentDir,
      name: displayName
    };

    if (agent.modelId && agent.modelId !== "unassigned") {
      configEntry.model = agent.modelId;
    }

    if (agent.heartbeat.enabled && agent.heartbeat.every) {
      configEntry.heartbeat = {
        every: agent.heartbeat.every
      };
    }

    if (agent.skills.length > 0) {
      configEntry.skills = uniqueStrings(agent.skills);
    }

    if (agent.tools.includes("fs.workspaceOnly")) {
      configEntry.tools = {
        ...(agent.toolPolicy ?? {}),
        fs: {
          ...(agent.toolPolicy?.fs ?? {}),
          workspaceOnly: true
        }
      };
    } else if (agent.toolPolicy) {
      configEntry.tools = agent.toolPolicy;
    }

    if (agent.sandbox) {
      configEntry.sandbox = agent.sandbox;
    }

    if (agent.memorySearch) {
      configEntry.memorySearch = agent.memorySearch;
    }

    if (agent.workerProfile?.employment.mission) {
      configEntry.description = agent.workerProfile.employment.mission;
    }

    if (Object.keys(identity).length > 0) {
      configEntry.identity = identity;
    }

    if (agent.isDefault) {
      configEntry.default = true;
    }

    return configEntry;
  });
}

function isMissingAgentConfigListError(error: unknown) {
  const message = extractErrorMessage(error);
  return /Config path not found:\s*agents\.list|Config path not found:\s*agents\.list/i.test(message);
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
