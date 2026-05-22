export const REDACTED_SECRET_VALUE = "[redacted]";

const sensitiveKeyNames = new Set([
  "apikey",
  "apitoken",
  "authorization",
  "authtoken",
  "authpassword",
  "clientsecret",
  "credential",
  "credentials",
  "openclawgatewaytoken",
  "openclawgatewaypassword",
  "password",
  "passwd",
  "privatekey",
  "pushtoken",
  "refreshtoken",
  "secret",
  "token",
  "tokens",
  "webhooktoken"
]);

const sensitiveKeySuffixes = [
  "apikey",
  "apitoken",
  "authtoken",
  "authpassword",
  "clientsecret",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "pushtoken",
  "refreshtoken",
  "secret",
  "token",
  "webhooktoken"
];

const secretAssignmentPattern =
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|password|private[-_ ]?key|secret|credential)s?\s*([:=])\s*("([^"]*)"|'([^']*)'|[^\s,;&]+)/gi;
const authorizationBearerPattern = /\b(authorization\s*:\s*bearer\s+)([^\s"',;]+)/gi;
const quotedSecretAssignmentPattern =
  /(["'])(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|auth[-_ ]?token|token|password|private[-_ ]?key|secret|credential|client[-_ ]?secret|webhook[-_ ]?token)\1\s*:\s*(["'])(?:(?!\3).)*\3/gi;
const secretQueryParamPattern =
  /([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|password|private[-_]?key|secret|credential|client[-_]?secret|webhook[-_]?token)=)([^&#\s]+)/gi;

export function redactSecrets<T>(value: T): T {
  return redactValue(value, false, new WeakSet<object>()) as T;
}

export function redactSecretText(value: string) {
  return value
    .replace(authorizationBearerPattern, (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`)
    .replace(secretQueryParamPattern, (_match, prefix: string) => `${prefix}${REDACTED_SECRET_VALUE}`)
    .replace(quotedSecretAssignmentPattern, (_match, quote: string, key: string, valueQuote: string) => {
      return `${quote}${key}${quote}:${valueQuote}${REDACTED_SECRET_VALUE}${valueQuote}`;
    })
    .replace(secretAssignmentPattern, (_match, key: string, separator: string) => {
      return `${key}${separator}${REDACTED_SECRET_VALUE}`;
    });
}

export function redactErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return redactSecretText(message || fallback);
}

function redactValue(value: unknown, forceScalarRedaction: boolean, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return forceScalarRedaction ? REDACTED_SECRET_VALUE : redactSecretText(value);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return forceScalarRedaction ? REDACTED_SECRET_VALUE : value;
  }

  if (value === null || value === undefined || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return [];
    }

    seen.add(value);
    return value.map((entry) => redactValue(entry, forceScalarRedaction, seen));
  }

  if (typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return {};
  }

  seen.add(value);
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    const sensitive = isSensitiveKey(key);
    output[key] = redactValue(entry, forceScalarRedaction || sensitive, seen);
  }

  return output;
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

  if (!normalized || normalized === "tokenusage") {
    return false;
  }

  if (sensitiveKeyNames.has(normalized)) {
    return true;
  }

  return sensitiveKeySuffixes.some((suffix) => normalized.endsWith(suffix));
}
