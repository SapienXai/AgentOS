import "server-only";

import { z } from "zod";

import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isObjectRecord,
  readNonEmptyString
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type {
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawPluginListPayload,
  OpenClawSessionExportInput,
  OpenClawSessionExportPayload,
  StatusPayload
} from "@/lib/openclaw/client/types";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";

export type StatusUpdateRegistry = NonNullable<NonNullable<StatusPayload["update"]>["registry"]>;

export const statusPayloadSchema = z
  .object({
    runtimeVersion: z.string().optional(),
    version: z.string().optional(),
    updateChannel: z.string().optional()
  })
  .passthrough();

export const agentListPayloadSchema = z
  .object({
    defaultId: z.string().optional(),
    mainKey: z.string().optional(),
    scope: z.string().optional(),
    agents: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          identity: z
            .object({
              name: z.string().optional(),
              theme: z.string().optional(),
              emoji: z.string().optional(),
              avatar: z.string().optional(),
              avatarUrl: z.string().optional()
            })
            .passthrough()
            .optional(),
          workspace: z.string().optional(),
          model: z
            .object({
              primary: z.string().optional(),
              fallbacks: z.array(z.string()).optional()
            })
            .passthrough()
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

export const sessionsPayloadSchema = z
  .object({
    sessions: z.array(z.object({}).passthrough())
  })
  .passthrough();

export const channelStatusPayloadSchema = z
  .object({
    ts: z.number().optional(),
    channelOrder: z.array(z.string()).optional().default([]),
    channelLabels: z.record(z.string(), z.string()).optional().default({}),
    channelDetailLabels: z.record(z.string(), z.string()).optional(),
    channelSystemImages: z.record(z.string(), z.string()).optional(),
    channelMeta: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          detailLabel: z.string(),
          systemImage: z.string().optional()
        })
        .passthrough()
    ).optional(),
    channels: z.record(z.string(), z.unknown()),
    channelAccounts: z.record(
      z.string(),
      z.array(
        z
          .object({
            accountId: z.string()
          })
          .passthrough()
      )
    ),
    channelDefaultAccountId: z.record(z.string(), z.union([z.string(), z.null()])).optional().default({})
  })
  .passthrough();

export const modelsPayloadSchema = z
  .object({
    models: z.array(
      z
        .object({
          key: z.string().optional(),
          id: z.string().optional(),
          provider: z.string().optional(),
          name: z.string(),
          input: z.union([z.string(), z.array(z.string())]).optional().default("text"),
          contextWindow: z.number().nullable().optional().default(null),
          local: z.boolean().nullable().optional().default(null),
          available: z.boolean().nullable().optional().default(null),
          tags: z.array(z.string()).optional().default([]),
          missing: z.boolean().optional().default(false)
        })
        .passthrough()
    )
  })
  .passthrough();

export const skillsPayloadSchema = z
  .object({
    skills: z.array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          emoji: z.string().optional(),
          eligible: z.boolean().optional(),
          disabled: z.boolean().optional(),
          blockedByAllowlist: z.boolean().optional(),
          source: z.string().optional(),
          bundled: z.boolean().optional()
        })
        .passthrough()
    )
  })
  .passthrough();

export const pluginsPayloadSchema = z
  .object({
    plugins: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            status: z.string().optional(),
            toolNames: z.array(z.string()).optional()
          })
          .passthrough()
      )
      .optional(),
    descriptors: z.array(z.object({}).passthrough()).optional()
  })
  .passthrough();

export const configSnapshotPayloadSchema = z
  .object({
    exists: z.boolean().optional(),
    valid: z.boolean().optional(),
    hash: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    resolved: z.unknown().optional()
  })
  .passthrough();

export const genericObjectPayloadSchema = z.object({}).passthrough();

export function parseGatewayPayload<TPayload>(operation: string, schema: z.ZodTypeAny, payload: unknown) {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new OpenClawGatewayClientError(
      `${operation}: OpenClaw Gateway returned a malformed response.`,
      "malformed-response",
      { cause: parsed.error }
    );
  }

  return parsed.data as TPayload;
}

export function parseObjectGatewayPayload<TPayload>(operation: string, payload: unknown) {
  return parseGatewayPayload<TPayload>(operation, genericObjectPayloadSchema, payload);
}

export function hasNativeStatusUpdateRegistry(status: StatusPayload) {
  return Boolean(status.update?.registry?.latestVersion || status.update?.registry?.error);
}

export function rememberStatusUpdateRegistry(registry: StatusUpdateRegistry | undefined) {
  if (!registry?.latestVersion && !registry?.error) {
    return;
  }

  cachedStatusUpdateRegistry = { ...registry };
}

export function getCachedStatusUpdateRegistry(status: StatusPayload): StatusUpdateRegistry | undefined {
  const currentVersion = normalizeStatusVersion(status);
  const cachedLatestVersion = cachedStatusUpdateRegistry?.latestVersion?.trim();

  if (!cachedStatusUpdateRegistry) {
    return undefined;
  }

  if (currentVersion && cachedLatestVersion && compareVersionStrings(currentVersion, cachedLatestVersion) > 0) {
    cachedStatusUpdateRegistry = null;
    return undefined;
  }

  return cachedStatusUpdateRegistry ?? undefined;
}

export function normalizeStatusVersion(status: StatusPayload) {
  return (status.runtimeVersion || status.overview?.version || status.version || "").trim().replace(/^v/i, "") || null;
}

export function mergeStatusPayload(status: StatusPayload, fallbackStatus: StatusPayload | null): StatusPayload {
  const nativeUpdate = status.update ?? {};
  const fallbackUpdate = fallbackStatus?.update ?? {};
  const cachedRegistry = getCachedStatusUpdateRegistry(status);
  const registry = nativeUpdate.registry ?? fallbackUpdate.registry;
  const resolvedRegistry = registry ?? cachedRegistry ?? undefined;

  if (resolvedRegistry) {
    rememberStatusUpdateRegistry(resolvedRegistry);
  }

  if (!fallbackStatus && !resolvedRegistry) {
    return status;
  }

  const update: NonNullable<StatusPayload["update"]> = {
    ...fallbackUpdate,
    ...nativeUpdate
  };

  if (resolvedRegistry) {
    update.registry = resolvedRegistry;
  }

  return {
    ...fallbackStatus,
    ...status,
    update
  };
}

export let cachedStatusUpdateRegistry: StatusUpdateRegistry | null = null;

export function normalizeModelsPayload(payload: unknown): ModelsPayload {
  const parsed = parseGatewayPayload<{ models: Array<Record<string, unknown>> }>(
    "models.list",
    modelsPayloadSchema,
    payload
  );

  return {
    ...parsed,
    models: parsed.models.map((entry) => {
      const id = readNonEmptyString(entry.id);
      const provider = readNonEmptyString(entry.provider);
      const key = readNonEmptyString(entry.key) ?? (provider && id ? `${provider}/${id}` : id);
      const input = Array.isArray(entry.input)
        ? entry.input.filter((value): value is string => typeof value === "string").join(",") || "text"
        : readNonEmptyString(entry.input) ?? "text";
      const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [];

      if ((entry.default === true || entry.isDefault === true) && !tags.includes("default")) {
        tags.push("default");
      }

      return {
        key: key ?? readNonEmptyString(entry.name) ?? "unknown",
        name: readNonEmptyString(entry.name) ?? key ?? id ?? "Unknown model",
        input,
        contextWindow: typeof entry.contextWindow === "number" ? entry.contextWindow : null,
        local: typeof entry.local === "boolean" ? entry.local : null,
        available: typeof entry.available === "boolean" ? entry.available : null,
        tags,
        missing: entry.missing === true
      };
    })
  };
}

export function normalizeModelStatusPayload(authPayload: unknown, modelsPayload: unknown): ModelsStatusPayload {
  const auth = isObjectRecord(authPayload) ? authPayload : {};
  const models = modelsPayload ? normalizeModelsPayload(modelsPayload).models : [];
  const allowed = models.map((model) => model.key).filter(Boolean);
  const defaultModel = resolveDefaultModelFromStatus(auth, models);
  const resolvedDefault = readNonEmptyString(auth.resolvedDefault) ??
    readNonEmptyString(auth.resolvedDefaultModel) ??
    defaultModel;
  const authProviders = Array.isArray(auth.providers)
    ? auth.providers.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    : [];

  return {
    defaultModel,
    resolvedDefault,
    allowed,
    auth: {
      providers: authProviders.map((entry) => {
        const usableProfileCount = countUsableAuthProfiles(entry.profiles);

        return {
          provider: readNonEmptyString(entry.provider) ?? undefined,
          effective: {
            kind: usableProfileCount > 0
              ? "ok"
              : readNonEmptyString(entry.status) ?? readNonEmptyString(entry.kind) ?? undefined,
            detail: readNonEmptyString(entry.detail) ?? undefined
          },
          profiles: {
            count: Array.isArray(entry.profiles) ? usableProfileCount : undefined
          }
        };
      }),
      runtimeAuthRoutes: normalizeRuntimeAuthRoutes(auth.runtimeAuthRoutes),
      missingProvidersInUse: Array.isArray(auth.missingProvidersInUse)
        ? auth.missingProvidersInUse.filter((entry): entry is string => typeof entry === "string")
        : [],
      unusableProfiles: Array.isArray(auth.unusableProfiles) ? auth.unusableProfiles : [],
      oauth: {
        providers: authProviders.map((entry) => ({
          provider: readNonEmptyString(entry.provider) ?? undefined,
          status: countUsableAuthProfiles(entry.profiles) > 0
            ? "ok"
            : readNonEmptyString(entry.status) ?? undefined,
          profiles: Array.isArray(entry.profiles) ? entry.profiles : undefined,
          effectiveProfiles: Array.isArray(entry.effectiveProfiles) ? entry.effectiveProfiles : undefined
        }))
      }
    }
  };
}

function normalizeRuntimeAuthRoutes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
    .map((entry) => ({
      provider: readNonEmptyString(entry.provider) ?? undefined,
      runtime: readNonEmptyString(entry.runtime) ?? undefined,
      authProvider: readNonEmptyString(entry.authProvider) ?? undefined,
      status: readNonEmptyString(entry.status) ?? undefined
    }));
}

export function resolveDefaultModelFromStatus(auth: Record<string, unknown>, models: ModelsPayload["models"]) {
  return readNonEmptyString(auth.defaultModel) ??
    readNonEmptyString(auth.default) ??
    models.find((model) => model.tags.some((tag) => tag.toLowerCase() === "default"))?.key ??
    null;
}

export function countUsableAuthProfiles(value: unknown) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.filter((entry) => isUsableAuthProfile(entry)).length;
}

export function isUsableAuthProfile(value: unknown) {
  if (!isObjectRecord(value)) {
    return false;
  }

  const status = readNonEmptyString(value.status)?.toLowerCase();
  if (!status) {
    return true;
  }

  return !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
}

export function normalizePluginsPayload(payload: unknown): OpenClawPluginListPayload {
  const parsed = parseGatewayPayload<{ plugins?: Array<Record<string, unknown>>; descriptors?: Array<Record<string, unknown>> }>(
    "plugins.uiDescriptors",
    pluginsPayloadSchema,
    payload
  );
  const source = parsed.plugins ?? parsed.descriptors ?? [];

  return {
    plugins: source.map((entry) => ({
      ...entry,
      id: readNonEmptyString(entry.id) ?? readNonEmptyString(entry.pluginId) ?? readNonEmptyString(entry.name) ?? "unknown",
      name: readNonEmptyString(entry.name) ?? readNonEmptyString(entry.label) ?? readNonEmptyString(entry.id) ?? "Unknown plugin",
      status: readNonEmptyString(entry.status) ?? undefined,
      toolNames: Array.isArray(entry.toolNames)
        ? entry.toolNames.filter((toolName): toolName is string => typeof toolName === "string")
        : undefined
    }))
  };
}

export function buildSessionExportPayload(
  input: OpenClawSessionExportInput,
  payload: Record<string, unknown>
): OpenClawSessionExportPayload {
  if (typeof payload.content === "string") {
    return {
      ...payload,
      format: input.format ?? (typeof payload.format === "string" ? payload.format : "json")
    };
  }

  const format = input.format ?? "json";
  return {
    ...payload,
    format,
    session: payload.session ?? payload,
    content: format === "json" ? JSON.stringify(payload) : undefined
  };
}

export function summarizeSnapshotError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason || "Unknown OpenClaw Gateway snapshot error.");
}

export function clearCachedStatusUpdateRegistry() {
  cachedStatusUpdateRegistry = null;
}
