const SENSITIVE_KEY = /(token|secret|apikey|api_key|password|cookie|credential|privatekey|private_key|recovery)/i;
const LOCAL_PATH = /^(?:\/Users\/|\/private\/tmp\/|\/tmp\/|\/var\/folders\/)/;
const SAFE_CERTIFICATION_STATUS_KEYS = new Set([
  "defaultSharedStateMode",
  "deviceIdentitySource",
  "deviceTokenSource",
  "tokenPersistence",
  "tokenClearRecovery",
  "staleWriterProtection",
  "explicitToken",
  "password",
  "signedChallenge",
  "challengeTimestamp",
  "storedDeviceToken",
  "managedWritePersistence",
  "reconnectWithDeviceAuth",
  "serverSideTokenRotationObserved",
  "harnessRotationPath"
]);
const SAFE_CERTIFICATION_STATUS_VALUES = new Set([
  "PASS",
  "FAIL",
  "SKIPPED",
  "EXPECTED-DENIAL",
  "NOT-APPLICABLE",
  "NO",
  "YES",
  "managed-write",
  "canonical OpenClaw SQLite state"
]);

export function serializeOpenClawRuntimeCertificationArtifact(value: unknown): string {
  return `${JSON.stringify(sanitizeValue(value, null), null, 2)}\n`;
}

export function sanitizeOpenClawRuntimeCertificationArtifact(value: unknown): unknown {
  return sanitizeValue(value, null);
}

function sanitizeValue(value: unknown, key: string | null): unknown {
  if (
    key &&
    SENSITIVE_KEY.test(key) &&
    !/^externalCredential(?:Required|Used)$/i.test(key) &&
    !(SAFE_CERTIFICATION_STATUS_KEYS.has(key) && typeof value === "string" && SAFE_CERTIFICATION_STATUS_VALUES.has(value))
  ) return "[REDACTED]";

  if (typeof value === "string") {
    if (LOCAL_PATH.test(value)) return "[LOCAL_PATH]";
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:sk|rk|ghp|github_pat|xox[baprs])-[-_A-Za-z0-9]+/g, "[REDACTED]")
      .replace(/\b(?:token|secret|api[_-]?key|password)\s*[:=]\s*[^\s,;]+/gi, (match) => {
        const separatorIndex = match.search(/[:=]/);
        return `${match.slice(0, separatorIndex + 1)}[REDACTED]`;
      });
  }

  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, null));

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey)
      ])
    );
  }

  return value;
}
