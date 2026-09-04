import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawChannelStatusPayload,
  OpenClawSkillLibraryEntry,
  OpenClawSkillLibraryListPayload,
  OpenClawSkillLibraryReadPayload,
  OpenClawToolsCatalogPayload,
  OpenClawToolsEffectivePayload
} from "@/lib/openclaw/client/types";
import type {
  EffectiveCapability,
  EffectiveCapabilityEvidence,
  EffectiveCapabilityReason,
  EffectiveCapabilityReasonCode,
  EffectiveCapabilityStatus,
  OpenClawAgent,
  SkillLibraryDetail,
  SkillLibraryItem,
  SkillLibraryRevision,
  WorkerEffectiveCapabilitiesPayload
} from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

type CapabilityToolFact = {
  id: string;
  toolIds?: string[];
  label: string;
  description: string;
  source: string | null;
  catalogPresent: boolean;
  effectivePresent: boolean | null;
  deniedBySession: boolean;
  channelId: string | null;
};

type CapabilityAccountFact = {
  provider: string;
  connected: boolean | null;
  accountId: string | null;
};

export type EffectiveToolsReadStatus = "available" | "failed" | "not-requested";
export type EffectiveToolsReadFailure =
  | "timeout"
  | "insufficient-scope"
  | "unsupported"
  | "interrupted"
  | "malformed"
  | "unknown";

export type CapabilityResolutionInput = {
  id: string;
  label: string;
  category: string;
  description: string;
  configured: boolean | null;
  tool: CapabilityToolFact | null;
  account?: CapabilityAccountFact | null;
  skill?: {
    skillId: string;
    revision: string;
    active: boolean;
  } | null;
  policy?: {
    denied: boolean | null;
    layer?: string | null;
  } | null;
  approval?: {
    required: boolean | null;
    canRequest: boolean | null;
  } | null;
  runtime?: {
    available: boolean | null;
    sessionKey?: string | null;
    profile?: string | null;
  } | null;
  effectiveToolsRead?: {
    status: EffectiveToolsReadStatus;
    failure?: EffectiveToolsReadFailure;
  };
};

const TOOL_CAPABILITY_GROUPS = [
  {
    key: "shell",
    label: "Shell",
    category: "Development",
    description: "Run shell commands and manage workspace processes.",
    matches: (id: string) => ["exec", "process", "bash", "shell"].includes(id)
  },
  {
    key: "workspace-files",
    label: "Workspace files",
    category: "Files & Data",
    description: "Read, create, and update files in the worker workspace.",
    matches: (id: string) => ["read", "write", "edit", "apply_patch"].includes(id)
  },
  {
    key: "web-browsing",
    label: "Web browsing",
    category: "Research",
    description: "Browse web pages and interact with browser content.",
    matches: (id: string) => id === "browser"
  },
  {
    key: "web-research",
    label: "Web research",
    category: "Research",
    description: "Search the web and retrieve external page content.",
    matches: (id: string) => ["web_search", "x_search", "web_fetch"].includes(id)
  },
  {
    key: "messaging",
    label: "Messaging",
    category: "Communication",
    description: "Send messages through connected communication channels.",
    matches: (id: string) => id === "message" || id.startsWith("message.")
  },
  {
    key: "automation",
    label: "Automation",
    category: "Automation",
    description: "Create or manage scheduled automation in OpenClaw.",
    matches: (id: string) => id === "cron" || id.startsWith("cron.")
  },
  {
    key: "github",
    label: "GitHub",
    category: "Development",
    description: "Read and update GitHub repositories through OpenClaw.",
    matches: (id: string) => id === "github" || id.startsWith("github.")
  },
  {
    key: "email",
    label: "Email",
    category: "Communication",
    description: "Work with email through a connected provider account.",
    matches: (id: string) => id === "gmail" || id.startsWith("gmail.") || id === "email" || id.startsWith("email.")
  }
] as const;

/**
 * Resolve one capability deterministically from native facts. This pure
 * function is intentionally exported so the precedence matrix can be tested
 * without a Gateway or a worker profile.
 */
export function resolveEffectiveCapability(input: CapabilityResolutionInput): EffectiveCapability {
  const evidence: EffectiveCapabilityEvidence = {
    ...(input.tool
      ? {
          tool: {
            id: input.tool.id,
            ...(input.tool.toolIds ? { toolIds: input.tool.toolIds } : {}),
            catalogPresent: input.tool.catalogPresent,
            effectivePresent: input.tool.effectivePresent,
            deniedBySession: input.tool.deniedBySession,
            source: input.tool.source,
            sessionKey: input.runtime?.sessionKey ?? null
          }
        }
      : {}),
    ...(input.account
      ? {
          account: {
            provider: input.account.provider,
            connected: input.account.connected,
            accountId: input.account.accountId
          }
        }
      : {}),
    ...(input.skill ? { skill: input.skill } : {}),
    ...(input.policy
      ? {
          policy: {
            denied: input.policy.denied,
            layer: input.policy.layer ?? null
          }
        }
      : {}),
    ...(input.approval ? { approval: input.approval } : {}),
    ...(input.runtime
      ? {
          runtime: {
            available: input.runtime.available,
            sessionKey: input.runtime.sessionKey ?? null,
            profile: input.runtime.profile ?? null
          }
      }
      : {}),
    ...(input.effectiveToolsRead
      ? { effectiveTools: input.effectiveToolsRead }
      : {})
  };

  const reasons: EffectiveCapabilityReason[] = [];
  const addReason = (code: EffectiveCapabilityReasonCode, message: string) => {
    reasons.push({ code, message });
  };

  const explicitBlock = input.policy?.denied === true || input.tool?.deniedBySession === true;
  if (explicitBlock) {
    addReason("policy_denied", input.policy?.layer
      ? `${input.policy.layer} policy blocks this capability.`
      : "OpenClaw effective policy blocks this capability.");
    if (input.tool?.deniedBySession) {
      addReason("tool_blocked", "OpenClaw marked this tool as denied for the current session.");
    }
    return buildCapability(input, "blocked", "This capability is blocked by the current policy.", evidence, reasons);
  }

  if (input.runtime?.available === false) {
    addReason("runtime_unavailable", "The required OpenClaw runtime is unavailable.");
    return buildCapability(input, "unavailable", "The required runtime is unavailable right now.", evidence, reasons);
  }

  // A failed native observation is not proof that the runtime or tool is
  // unavailable. Preserve the distinction so temporary Gateway failures,
  // scope denials, and malformed responses remain honest UNKNOWN states.
  if (input.effectiveToolsRead?.status === "failed") {
    addReason("effective_state_unavailable", "AgentOS could not verify the effective tool state from OpenClaw.");
    return buildCapability(
      input,
      "unknown",
      "AgentOS could not verify this capability from the current OpenClaw runtime.",
      evidence,
      reasons
    );
  }

  // A native effective denial is stronger than a downstream setup or
  // approval explanation: the current session cannot use this tool at all.
  if (input.tool?.effectivePresent === false) {
    addReason("tool_not_effective", "OpenClaw did not include this tool in the current session-effective tool set.");
    return buildCapability(input, "unavailable", "This tool exists, but it is not effective for the current session.", evidence, reasons, "review-policy");
  }

  // The catalog is an existence inventory, not the availability authority.
  // A native effective tool remains usable even if a separately queried
  // catalog is incomplete or omits that tool.
  if (input.tool && input.tool.catalogPresent === false && input.tool.effectivePresent !== true) {
    addReason("tool_not_available", "The required tool is not present in the OpenClaw catalog.");
    return buildCapability(input, "unavailable", "The required runtime tool is not available.", evidence, reasons);
  }

  if (input.account?.connected === false) {
    addReason("account_not_connected", `${input.account.provider} does not have a usable connected account.`);
    return buildCapability(input, "needs-setup", `Connect a usable ${input.account.provider} account to use this capability.`, evidence, reasons, "connect-account");
  }

  if (input.skill && !input.skill.active) {
    addReason("skill_not_active", "The required skill revision is not active for this session.");
    return buildCapability(input, "needs-setup", "Activate the required skill for the next turn.", evidence, reasons, "activate-skill");
  }

  if (input.approval?.required === true) {
    addReason("approval_required", "OpenClaw requires operator approval before execution.");
    return buildCapability(input, "requires-approval", "This worker can request the action, but execution requires operator approval.", evidence, reasons);
  }

  if (input.tool?.effectivePresent === true) {
    addReason("tool_effective", "OpenClaw includes the tool in the current session-effective tool set.");
    return buildCapability(input, "available", input.description, evidence, reasons);
  }

  if (input.runtime?.available === null || input.runtime?.available === undefined) {
    addReason("session_context_missing", "AgentOS does not have a reliable native session context for effective tools.");
  } else {
    addReason("unknown", "The current native facts are insufficient to determine effective use.");
  }
  return buildCapability(input, "unknown", "AgentOS cannot determine this capability reliably from the current native facts.", evidence, reasons);
}

export async function getWorkerEffectiveCapabilities(workerId: string, options: { sessionKey?: string | null } = {}) {
  const adapter = getOpenClawAdapter();
  const [agentsResult, sessionsResult] = await Promise.allSettled([
    adapter.listAgents({ timeoutMs: 8_000 }),
    options.sessionKey
      ? Promise.resolve({ sessions: [] })
      : adapter.listSessions({ agentId: workerId, limit: 16, includeGlobal: false }, { timeoutMs: 8_000 })
  ]);

  if (agentsResult.status === "rejected") {
    throw agentsResult.reason;
  }

  const agent = agentsResult.value.agents.find((entry) => entry.id === workerId) as OpenClawAgent | undefined;
  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const session = options.sessionKey
    ? { key: options.sessionKey, updatedAt: null }
    : selectLatestSession(sessionsResult.status === "fulfilled" ? sessionsResult.value.sessions : [], workerId);
  const sessionKey = session?.key ?? null;

  const reads = await Promise.allSettled([
    adapter.getToolsCatalog({ agentId: workerId, includePlugins: true }, { timeoutMs: 8_000 }),
    sessionKey
      ? adapter.getEffectiveTools({ agentId: workerId, sessionKey }, { timeoutMs: 8_000 })
      : Promise.resolve(null),
    adapter.listSkillLibrary?.({ scope: "all", ...(sessionKey ? { sessionKey } : {}) }, { timeoutMs: 8_000 }) ?? Promise.reject(new Error("OpenClaw does not expose skills.library.list.")),
    adapter.getChannelStatus({ probe: false }, { timeoutMs: 8_000 })
  ]);

  const catalogResult = reads[0];
  const effectiveResult = reads[1];
  const libraryResult = reads[2];
  const accountResult = reads[3];
  const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : null;
  const effective = effectiveResult.status === "fulfilled" ? effectiveResult.value : null;
  const library = libraryResult.status === "fulfilled" ? libraryResult.value : null;
  const accounts = accountResult.status === "fulfilled" ? accountResult.value : null;
  const catalogAvailable = catalogResult.status === "fulfilled";
  const effectiveAvailable = effectiveResult.status === "fulfilled" && Boolean(effective);
  const libraryAvailable = libraryResult.status === "fulfilled";

  const capabilities = buildCapabilities({
    agent,
    catalog,
    effective,
    accounts,
    sessionKey,
    sessionProfile: effective?.profile ?? null,
    runtimeAvailable: sessionKey ? true : null,
    effectiveToolsRead: sessionKey
      ? effectiveResult.status === "fulfilled"
        ? { status: "available" }
        : { status: "failed", failure: classifyEffectiveToolsReadFailure(effectiveResult.reason) }
      : { status: "not-requested" }
  });

  const skills = library ? normalizeSkillLibraryItems(library, sessionKey) : [];
  const summary = emptyCapabilitySummary();
  for (const capability of capabilities) {
    summary[capability.status] += 1;
  }

  return {
    workerId,
    capturedAt: new Date().toISOString(),
    session: {
      key: sessionKey,
      updatedAt: session?.updatedAt ?? null,
      profile: effective?.profile ?? null
    },
    capabilities,
    skills,
    skillLibrary: {
      supported: libraryAvailable,
      error: libraryAvailable ? null : readSafeError(libraryResult)
    },
    sources: {
      toolsCatalog: catalogAvailable ? "native" : "unavailable",
      toolsEffective: sessionKey ? (effectiveAvailable ? "native" : "failed") : "not-requested",
      skillsLibrary: libraryAvailable ? "native" : "unavailable",
      accounts: accountResult.status === "fulfilled" ? "native" : "unavailable"
    },
    summary
  } satisfies WorkerEffectiveCapabilitiesPayload;
}

export async function readSkillLibraryDetail(
  skillId: string,
  options: { revision?: string; sessionKey?: string | null } = {}
): Promise<SkillLibraryDetail> {
  const adapter = getOpenClawAdapter();
  if (!adapter.readSkillLibrary) {
    throw new Error("OpenClaw Skills Library read is unavailable.");
  }

  const detailPromise = adapter.readSkillLibrary({
    skillId,
    ...(options.revision ? { revision: options.revision } : {})
  }, { timeoutMs: 8_000 });
  const selectionPromise = options.sessionKey
    ? adapter.listSkillLibrary
      ? adapter.listSkillLibrary({ scope: "all", sessionKey: options.sessionKey }, { timeoutMs: 8_000 })
      : Promise.reject(new Error("OpenClaw Skills Library session selection is unavailable."))
    : Promise.resolve(null);

  const [detailResult, selectionResult] = await Promise.allSettled([detailPromise, selectionPromise]);
  if (detailResult.status === "rejected") {
    throw detailResult.reason;
  }

  let activeRevisionId: string | null = null;
  let activeInSession: boolean | null | undefined;
  if (options.sessionKey) {
    if (selectionResult.status === "fulfilled" && selectionResult.value) {
      const selection = selectionResult.value.session?.selections.find((entry) => entry.skillId === skillId);
      activeRevisionId = selection?.revision ?? null;
      activeInSession = Boolean(selection);
    } else {
      // A failed selection observation is not evidence of known inactivity.
      activeInSession = null;
    }
  }

  return normalizeSkillLibraryDetail(
    detailResult.value,
    options.sessionKey ?? null,
    activeRevisionId,
    activeInSession
  );
}

export function normalizeSkillLibraryItem(
  entry: OpenClawSkillLibraryEntry,
  sessionKey: string | null,
  activeRevisionId: string | null = null,
  activeInSessionOverride: boolean | null | undefined = undefined
): SkillLibraryItem {
  return {
    id: entry.skillId,
    slug: entry.slug,
    name: entry.name,
    description: entry.description || null,
    ownership: {
      scope: entry.shared ? "shared" : entry.ownerProfileId ? "personal" : "unknown",
      ownerId: entry.ownerProfileId,
      ownerLabel: entry.ownerLabel || null,
      authorId: entry.authorProfileId || null
    },
    revision: {
      id: entry.revision,
      version: null,
      createdAt: formatSkillTimestamp(entry.createdAt),
      updatedAt: formatSkillTimestamp(entry.updatedAt)
    },
    activation: {
      enabled: entry.enabled,
      activeInSession: sessionKey
        ? (activeInSessionOverride === undefined ? activeRevisionId !== null : activeInSessionOverride)
        : null,
      activeRevisionId,
      sessionKey
    },
    source: "openclaw-library",
    canEdit: entry.canEdit,
    removed: entry.removed
  };
}

export function normalizeSkillLibraryDetail(
  payload: OpenClawSkillLibraryReadPayload,
  sessionKey: string | null = null,
  activeRevisionId: string | null = null,
  activeInSessionOverride: boolean | null | undefined = undefined
): SkillLibraryDetail {
  return {
    item: normalizeSkillLibraryItem(payload.entry, sessionKey, activeRevisionId, activeInSessionOverride),
    content: payload.content,
    files: payload.files.map((file) => ({
      path: file.path,
      content: file.content,
      encoding: file.encoding ?? "utf8",
      executable: file.executable ?? false
    })),
    revisions: payload.revisions.map((revision): SkillLibraryRevision => ({
      id: revision.revision,
      createdAt: formatSkillTimestamp(revision.createdAt)
    }))
  };
}

function formatSkillTimestamp(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function buildCapabilities(input: {
  agent: OpenClawAgent;
  catalog: OpenClawToolsCatalogPayload | null;
  effective: OpenClawToolsEffectivePayload | null;
  accounts: OpenClawChannelStatusPayload | null;
  sessionKey: string | null;
  sessionProfile: string | null;
  runtimeAvailable: boolean | null;
  effectiveToolsRead: {
    status: EffectiveToolsReadStatus;
    failure?: EffectiveToolsReadFailure;
  };
}) {
  const catalogTools = flattenCatalogTools(input.catalog);
  const effectiveTools = flattenEffectiveTools(input.effective);
  const facts = new Map<string, CapabilityToolFact>();
  const declaredTools = Array.isArray(input.agent.tools) ? input.agent.tools : [];
  const allIds = new Set([...catalogTools.keys(), ...effectiveTools.keys(), ...declaredTools]);

  for (const id of allIds) {
    const catalogTool = catalogTools.get(id);
    const effectiveTool = effectiveTools.get(id);
    facts.set(id, {
      id,
      label: effectiveTool?.label ?? catalogTool?.label ?? id,
      description: effectiveTool?.description ?? catalogTool?.description ?? `Use the ${id} OpenClaw tool.`,
      source: effectiveTool?.source ?? catalogTool?.source ?? null,
      catalogPresent: Boolean(catalogTool),
      effectivePresent: input.effective ? Boolean(effectiveTool) : null,
      deniedBySession: effectiveTool?.deniedBySession === true,
      channelId: effectiveTool?.channelId ?? null
    });
  }

  const groups = new Map<string, {
    definition: (typeof TOOL_CAPABILITY_GROUPS)[number] | null;
    tools: CapabilityToolFact[];
  }>();
  for (const fact of facts.values()) {
    const definition = TOOL_CAPABILITY_GROUPS.find((candidate) => candidate.matches(fact.id)) ?? null;
    // Keep unknown native tools visible without turning the primary Worker
    // Profile into a raw tool catalog.
    const key = definition?.key ?? "other";
    const current = groups.get(key) ?? { definition, tools: [] };
    current.tools.push(fact);
    groups.set(key, current);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group.tools[0];
    const definition = group.definition;
    const effectivePresent = group.tools.some((tool) => tool.effectivePresent === true)
      ? true
      : group.tools.every((tool) => tool.effectivePresent === false)
        ? false
        : null;
    const catalogPresent = group.tools.some((tool) => tool.catalogPresent);
    const configured = group.tools.some((tool) => declaredTools.includes(tool.id)) ||
      group.tools.some((tool) => input.agent.toolPolicy?.allow?.includes(tool.id) === true)
      ? true
      : group.tools.some((tool) => input.agent.toolPolicy?.deny?.includes(tool.id) === true)
        ? false
        : null;
    const deniedBySession = effectivePresent !== true && group.tools.some((tool) => tool.deniedBySession);
    const account = resolveAccountFact(group.tools, input.accounts);
    return resolveEffectiveCapability({
      id: `openclaw:${definition?.key ?? "other"}`,
      label: definition?.label ?? "Other",
      category: definition?.category ?? "Other",
      description: definition?.description ?? `Additional OpenClaw tools available for this session (${group.tools.length}).`,
      configured,
      tool: {
        ...first,
        toolIds: group.tools.map((tool) => tool.id),
        catalogPresent,
        effectivePresent,
        deniedBySession
      },
      account,
      policy: deniedBySession ? { denied: true, layer: "OpenClaw session policy" } : { denied: false },
      runtime: {
        available: input.runtimeAvailable,
        sessionKey: input.sessionKey,
        profile: input.sessionProfile
      },
      effectiveToolsRead: input.effectiveToolsRead
    });
  });
}

function flattenCatalogTools(payload: OpenClawToolsCatalogPayload | null) {
  const result = new Map<string, { id: string; label: string; description: string; source: string }>();
  for (const group of payload?.groups ?? []) {
    for (const tool of group.tools ?? []) {
      if (!result.has(tool.id)) {
        result.set(tool.id, {
          id: tool.id,
          label: tool.label,
          description: tool.description,
          source: tool.source === "plugin" ? group.label : "OpenClaw Gateway"
        });
      }
    }
  }
  return result;
}

function flattenEffectiveTools(payload: OpenClawToolsEffectivePayload | null) {
  const result = new Map<string, {
    id: string;
    label: string;
    description: string;
    source: string;
    deniedBySession?: boolean;
    channelId?: string;
  }>();
  for (const group of payload?.groups ?? []) {
    for (const tool of group.tools ?? []) {
      if (!result.has(tool.id)) {
        result.set(tool.id, {
          id: tool.id,
          label: tool.label,
          description: tool.description,
          source: tool.source,
          deniedBySession: tool.deniedBySession,
          channelId: tool.channelId
        });
      }
    }
  }
  return result;
}

function resolveAccountFact(tools: CapabilityToolFact[], payload: OpenClawChannelStatusPayload | null): CapabilityAccountFact | null {
  const channelId = tools.find((tool) => tool.channelId)?.channelId;
  if (!channelId || !payload) {
    return null;
  }
  const accounts = payload.channelAccounts[channelId] ?? [];
  const connected = accounts.some((account) => account.connected === true)
    ? true
    : accounts.length > 0 && accounts.every((account) => account.connected === false)
      ? false
      : null;
  return {
    provider: payload.channelLabels[channelId] ?? channelId,
    connected,
    accountId: connected === true ? accounts.find((account) => account.connected === true)?.accountId ?? null : null
  };
}

function normalizeSkillLibraryItems(payload: OpenClawSkillLibraryListPayload, sessionKey: string | null) {
  const selections = new Map((payload.session?.selections ?? []).map((selection) => [selection.skillId, selection]));
  return payload.entries.map((entry) => normalizeSkillLibraryItem(
    entry,
    sessionKey,
    selections.get(entry.skillId)?.revision ?? null
  ));
}

function selectLatestSession(sessions: Array<Record<string, unknown> & { agentId?: string; key?: string; updatedAt?: number }>, agentId: string) {
  return sessions
    .filter((session) => session.agentId === undefined || session.agentId === agentId)
    .map((session) => ({
      key: readString(session.key) ?? readString(session.sessionKey),
      updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : null
    }))
    .filter((session): session is { key: string; updatedAt: number | null } => Boolean(session.key))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0] ?? null;
}

function buildCapability(
  input: CapabilityResolutionInput,
  status: EffectiveCapabilityStatus,
  explanation: string,
  evidence: EffectiveCapabilityEvidence,
  reasons: EffectiveCapabilityReason[],
  remediationId?: "connect-account" | "review-policy" | "activate-skill" | "open-settings"
): EffectiveCapability {
  return {
    id: input.id,
    label: input.label,
    category: input.category,
    description: input.description,
    status,
    explanation,
    configured: input.configured,
    effective: input.tool?.effectivePresent ?? null,
    evidence,
    reasons,
    ...(remediationId ? { remediation: { id: remediationId, label: remediationLabel(remediationId) } } : {})
  };
}

function remediationLabel(id: "connect-account" | "review-policy" | "activate-skill" | "open-settings") {
  switch (id) {
    case "connect-account": return "Connect account";
    case "review-policy": return "Review policy";
    case "activate-skill": return "Activate skill";
    case "open-settings": return "Open settings";
  }
}

function emptyCapabilitySummary(): Record<EffectiveCapabilityStatus, number> {
  return {
    available: 0,
    "requires-approval": 0,
    "needs-setup": 0,
    blocked: 0,
    unavailable: 0,
    unknown: 0
  };
}

function readSafeError(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  return redactErrorMessage(result.reason, "OpenClaw Skills Library is unavailable.");
}

function classifyEffectiveToolsReadFailure(error: unknown): EffectiveToolsReadFailure {
  const kind = error && typeof error === "object" && "kind" in error
    ? (error as { kind?: unknown }).kind
    : null;
  if (kind === "timeout") return "timeout";
  if (kind === "unsupported") return "unsupported";
  if (kind === "interrupted") return "interrupted";
  if (kind === "malformed-response") return "malformed";

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("scope") || message.includes("forbidden") || message.includes("permission") || message.includes("unauthoriz")) {
    return "insufficient-scope";
  }
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  return "unknown";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
