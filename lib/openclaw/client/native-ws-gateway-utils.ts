import "server-only";

import type { CommandResult } from "@/lib/openclaw/cli";
import { REDACTED_OPENCLAW_SECRET } from "@/lib/openclaw/client/native-ws-gateway-types";
import { OpenClawGatewayClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";

export function createRequestId() {
  return `agentos:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function readConfigString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readConfigPath(source: unknown, path: string) {
  if (!path.trim()) {
    return source;
  }

  let current = source;
  for (const segment of parseConfigPath(path)) {
    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }

    if (!isObjectRecord(current) || typeof segment !== "string") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function parseConfigPath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]|\["((?:\\.|[^"\\])*)"\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(path))) {
    if (match[1]) {
      segments.push(match[1]);
    } else if (match[2]) {
      segments.push(Number(match[2]));
    } else if (match[3] !== undefined) {
      segments.push(JSON.parse(`"${match[3]}"`) as string);
    }
  }

  return segments;
}

export function cloneJsonObject(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function setConfigPathValue(config: Record<string, unknown>, path: string, value: unknown) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: Record<string, unknown> = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (typeof segment !== "string") {
      throw new OpenClawGatewayClientError("Array root config paths are not supported.", "unknown");
    }

    const next = current[segment];
    if (isObjectRecord(next) || Array.isArray(next)) {
      current = next as Record<string, unknown>;
      continue;
    }

    const created = typeof nextSegment === "number" ? [] : {};
    current[segment] = created;
    current = created as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current)) {
      throw new OpenClawGatewayClientError("Config path points to an array index on a non-array parent.", "unknown");
    }
    current[last] = value;
    return;
  }

  current[last] = value;
}

export function unsetConfigPathValue(config: Record<string, unknown>, path: string) {
  const segments = parseConfigPath(path);
  if (segments.length === 0) {
    throw new OpenClawGatewayClientError("Config path is required.", "unknown");
  }

  let current: unknown = config;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current = Array.isArray(current) && typeof segment === "number"
      ? current[segment]
      : isObjectRecord(current) && typeof segment === "string"
        ? current[segment]
        : undefined;

    if (current === undefined) {
      return;
    }
  }

  const last = segments[segments.length - 1];
  if (Array.isArray(current) && typeof last === "number") {
    current.splice(last, 1);
    return;
  }

  if (isObjectRecord(current) && typeof last === "string") {
    delete current[last];
  }
}

export function containsRedactedOpenClawSecret(value: unknown): boolean {
  if (typeof value === "string") {
    return isRedactedOpenClawSecret(value);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsRedactedOpenClawSecret(entry));
  }

  if (isObjectRecord(value)) {
    return Object.values(value).some((entry) => containsRedactedOpenClawSecret(entry));
  }

  return false;
}

export function commandResultFromGatewayPayload(payload: unknown, metadata?: Record<string, unknown>): CommandResult {
  return {
    stdout: JSON.stringify(payload ?? {}),
    stderr: "",
    ...(metadata ? { metadata } : {})
  };
}

export function isRedactedOpenClawSecret(value: string) {
  return value === REDACTED_OPENCLAW_SECRET;
}

export function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
