import "server-only";

import {
  NativeGatewayRequestError,
  OpenClawGatewayClientError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isObjectRecord,
  parseConfigPath
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import type { OpenClawConfigReloadKind } from "@/lib/openclaw/client/types";

export function buildMergePatchForConfigPath(path: string, value: unknown) {
  const segments = parseConfigPath(path);

  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  if (segments.some((segment) => typeof segment === "number")) {
    throw new OpenClawGatewayClientError(
      "Gateway config.patch merge updates do not support array-index paths; using CLI config fallback.",
      "unsupported"
    );
  }

  const root: Record<string, unknown> = {};
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] as string;
    if (index === segments.length - 1) {
      current[segment] = value;
      break;
    }

    const next: Record<string, unknown> = {};
    current[segment] = next;
    current = next;
  }

  return root;
}

export function normalizeConfigReloadKind(value: unknown): OpenClawConfigReloadKind {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "restart" || normalized === "hot" || normalized === "none") {
    return normalized;
  }

  return "unknown";
}

export function readConfigReloadKindFromSchemaLookup(payload: unknown): OpenClawConfigReloadKind {
  const visited = new Set<unknown>();
  const queue = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);

    if (isObjectRecord(current)) {
      const reloadKind = normalizeConfigReloadKind(
        current.reloadKind ??
        current.reload ??
        current.reload_kind ??
        current.reloadPolicy ??
        current.reloadRequirement
      );

      if (reloadKind !== "unknown") {
        return reloadKind;
      }

      queue.push(current.schema, current.hint, current.node, current.config);
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
    }
  }

  return "unknown";
}

export function isGatewayTransportConfigPath(path: string) {
  return /^(gateway\.(remote\.(url|token|password)|auth\.(mode|token|password))|gateway\.mode)$/.test(path);
}

export function canFallbackGatewayAuthConfigRepair(error: unknown, path: string) {
  const kind = normalizeClientError(error).kind;

  if (
    !isGatewayTransportConfigPath(path) ||
    (kind !== "auth" && kind !== "timeout" && kind !== "unreachable")
  ) {
    return false;
  }

  if (error instanceof NativeGatewayRequestError) {
    return !/^config\.(patch|apply|set|unset)$/i.test(error.method);
  }

  return true;
}

export function isGatewayConfigRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return /(^|[^a-z])rate limit(?:ed)?\b|retry after|too many requests|HTTP\s*429/i.test(message) &&
    (
      !(error instanceof NativeGatewayRequestError) ||
      /^config\.(get|schema|patch|apply|set|unset)$/i.test(error.method)
    );
}

export function readGatewayConfigRateLimitRetryAfterMs(error: unknown) {
  if (!isGatewayConfigRateLimitError(error)) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = message.match(/retry after\s+(\d+(?:\.\d+)?)\s*(ms|msec|millisecond(?:s)?|s|sec|second(?:s)?|m|min|minute(?:s)?)?/i);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  const unit = match[2]?.toLowerCase() ?? "s";

  if (unit === "ms" || unit === "msec" || unit.startsWith("millisecond")) {
    return Math.round(amount);
  }

  if (unit === "m" || unit === "min" || unit.startsWith("minute")) {
    return Math.round(amount * 60_000);
  }

  return Math.round(amount * 1_000);
}
