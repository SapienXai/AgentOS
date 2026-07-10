export const AGENTOS_WORKER_PROFILE_SCHEMA_VERSION = 1 as const;

export type AgentOSWorkerProfile = {
  schemaVersion: typeof AGENTOS_WORKER_PROFILE_SCHEMA_VERSION;
  identity: {
    displayName: string | null;
    emoji: string | null;
    theme: string | null;
    avatar: string | null;
  };
  employment: {
    role: string | null;
    mission: string | null;
    behaviorInstructions: string | null;
  };
  operator: {
    labels: string[];
  };
};

export type AgentOSWorkerProfileInput = {
  schemaVersion: typeof AGENTOS_WORKER_PROFILE_SCHEMA_VERSION;
  identity?: {
    displayName?: string | null;
    emoji?: string | null;
    theme?: string | null;
    avatar?: string | null;
  };
  employment?: {
    role?: string | null;
    mission?: string | null;
    behaviorInstructions?: string | null;
  };
  operator?: {
    labels?: string[];
  };
};

export type LegacyWorkerProfileSeed = {
  name?: string | null;
  role?: string | null;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOptionalValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Parses the AgentOS-owned worker profile sidecar.
 *
 * Legacy manifest identity/role fields are accepted as fallbacks so existing
 * workspaces gain a normalized v1 profile without changing OpenClaw runtime
 * configuration or requiring an eager manifest rewrite.
 */
export function parseAgentOSWorkerProfile(
  value: unknown,
  legacy: LegacyWorkerProfileSeed = {}
): AgentOSWorkerProfile | null {
  const candidate = isObjectRecord(value) && value.schemaVersion === AGENTOS_WORKER_PROFILE_SCHEMA_VERSION
    ? value
    : null;
  const identity = candidate && isObjectRecord(candidate.identity) ? candidate.identity : {};
  const employment = candidate && isObjectRecord(candidate.employment) ? candidate.employment : {};
  const operator = candidate && isObjectRecord(candidate.operator) ? candidate.operator : {};

  const displayName = normalizeOptionalValue(identity.displayName) ?? normalizeOptionalValue(legacy.name);
  const emoji = normalizeOptionalValue(identity.emoji) ?? normalizeOptionalValue(legacy.emoji);
  const theme = normalizeOptionalValue(identity.theme) ?? normalizeOptionalValue(legacy.theme);
  const avatar = normalizeOptionalValue(identity.avatar) ?? normalizeOptionalValue(legacy.avatar);
  const role = normalizeOptionalValue(employment.role) ?? normalizeOptionalValue(legacy.role);
  const mission = normalizeOptionalValue(employment.mission);
  const behaviorInstructions = normalizeOptionalValue(employment.behaviorInstructions);
  const labels = Array.isArray(operator.labels)
    ? uniqueStrings(
        operator.labels
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    : [];

  if (
    !candidate &&
    !displayName &&
    !emoji &&
    !theme &&
    !avatar &&
    !role
  ) {
    return null;
  }

  return {
    schemaVersion: AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
    identity: {
      displayName,
      emoji,
      theme,
      avatar
    },
    employment: {
      role,
      mission,
      behaviorInstructions
    },
    operator: {
      labels
    }
  };
}

/**
 * Applies a partial UI mutation without turning AgentOS profile metadata into
 * a second source of truth for OpenClaw execution settings.
 */
export function mergeAgentOSWorkerProfile(
  current: AgentOSWorkerProfile | null | undefined,
  patch: AgentOSWorkerProfileInput | null | undefined,
  legacy: LegacyWorkerProfileSeed = {}
): AgentOSWorkerProfile {
  const baseline = current ?? parseAgentOSWorkerProfile(null, legacy) ?? {
    schemaVersion: AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
    identity: {
      displayName: null,
      emoji: null,
      theme: null,
      avatar: null
    },
    employment: {
      role: null,
      mission: null,
      behaviorInstructions: null
    },
    operator: {
      labels: []
    }
  };

  const identityPatch = patch?.identity;
  const employmentPatch = patch?.employment;
  const operatorPatch = patch?.operator;

  return {
    schemaVersion: AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
    identity: {
      displayName: mergeOptionalValue(baseline.identity.displayName, identityPatch?.displayName),
      emoji: mergeOptionalValue(baseline.identity.emoji, identityPatch?.emoji),
      theme: mergeOptionalValue(baseline.identity.theme, identityPatch?.theme),
      avatar: mergeOptionalValue(baseline.identity.avatar, identityPatch?.avatar)
    },
    employment: {
      role: mergeOptionalValue(baseline.employment.role, employmentPatch?.role),
      mission: mergeOptionalValue(baseline.employment.mission, employmentPatch?.mission),
      behaviorInstructions: mergeOptionalValue(
        baseline.employment.behaviorInstructions,
        employmentPatch?.behaviorInstructions
      )
    },
    operator: {
      labels:
        operatorPatch?.labels === undefined
          ? baseline.operator.labels
          : uniqueStrings(operatorPatch.labels.map((entry) => entry.trim()).filter(Boolean))
    }
  };
}

function mergeOptionalValue(current: string | null, value: string | null | undefined) {
  if (value === undefined) {
    return current;
  }

  return normalizeOptionalValue(value);
}
