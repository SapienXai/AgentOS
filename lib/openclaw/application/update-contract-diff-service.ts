import "server-only";

import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import type {
  OpenClawServerMethodContractChange,
  OpenClawServerMethodContractDiffReport,
  OpenClawServerMethodContractDiffStatus
} from "@/lib/openclaw/types";

const OPENCLAW_REPOSITORY = "openclaw/openclaw";
const CORE_DESCRIPTOR_PATH = "src/gateway/methods/core-descriptors.ts";
const SERVER_METHODS_PREFIX = "src/gateway/server-methods/";
const PROTOCOL_PATH_PREFIXES = [
  "packages/gateway-protocol/",
  "src/gateway/protocol/"
] as const;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_SOURCE_BYTES = 2_000_000;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CoreMethodSpec = {
  name: string;
  scope: string;
  advertise: boolean;
  startup: boolean;
  controlPlaneWrite: boolean;
};

type GitHubCompareFile = {
  filename?: unknown;
};

type GitHubComparePayload = {
  files?: unknown;
};

type ContractDiffOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  bypassCache?: boolean;
};

const reportCache = new Map<string, {
  expiresAt: number;
  value: Promise<OpenClawServerMethodContractDiffReport>;
}>();

export async function getOpenClawServerMethodContractDiff(
  input: { currentVersion: string; targetVersion: string },
  options: ContractDiffOptions = {}
): Promise<OpenClawServerMethodContractDiffReport> {
  const currentVersion = normalizeVersion(input.currentVersion);
  const targetVersion = normalizeVersion(input.targetVersion);
  const now = options.now ?? (() => new Date());

  if (!currentVersion || !targetVersion) {
    return unavailableReport({
      currentVersion: currentVersion ?? input.currentVersion,
      targetVersion: targetVersion ?? input.targetVersion,
      generatedAt: now(),
      error: "Current and target OpenClaw versions must be valid release versions."
    });
  }

  if (currentVersion === targetVersion) {
    return {
      generatedAt: now().toISOString(),
      source: "github-static",
      currentVersion,
      targetVersion,
      status: "safe",
      currentMethodCount: null,
      targetMethodCount: null,
      changedServerMethodFiles: [],
      changedProtocolFiles: [],
      changes: [],
      blockerCount: 0,
      warningCount: 0,
      summary: "The target is already installed; no server-method contract change is expected.",
      error: null
    };
  }

  const cacheKey = `${currentVersion}->${targetVersion}`;
  const cached = reportCache.get(cacheKey);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = buildContractDiff({
    currentVersion,
    targetVersion,
    fetchImpl: options.fetchImpl ?? fetch,
    now
  });
  if (!options.bypassCache) {
    reportCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value
    });
  }

  return value;
}

export function parseOpenClawCoreMethodSpecs(source: string): CoreMethodSpec[] {
  const table = source.match(/CORE_GATEWAY_METHOD_SPECS[^=]*=\s*\[([\s\S]*?)\]\s*as const/)?.[1];
  if (!table) {
    throw new Error("OpenClaw core Gateway method descriptor table was not found.");
  }

  const specs: CoreMethodSpec[] = [];
  const seen = new Set<string>();
  const entryPattern = /\{\s*name:\s*["']([^"']+)["']\s*,\s*scope:\s*["']([^"']+)["']([^}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = entryPattern.exec(table)) !== null) {
    const name = match[1]?.trim();
    const scope = match[2]?.trim();
    const flags = match[3] ?? "";
    if (!name || !scope || seen.has(name)) {
      continue;
    }

    seen.add(name);
    specs.push({
      name,
      scope,
      advertise: !/\badvertise\s*:\s*false\b/.test(flags),
      startup: /\bstartup\s*:\s*true\b/.test(flags),
      controlPlaneWrite: /\bcontrolPlaneWrite\s*:\s*true\b/.test(flags)
    });
  }

  if (specs.length === 0) {
    throw new Error("OpenClaw core Gateway method descriptor table contained no readable methods.");
  }

  return specs;
}

export function resetOpenClawServerMethodContractDiffCache() {
  reportCache.clear();
}

async function buildContractDiff(input: {
  currentVersion: string;
  targetVersion: string;
  fetchImpl: FetchLike;
  now: () => Date;
}): Promise<OpenClawServerMethodContractDiffReport> {
  const [currentResult, targetResult, compareResult] = await Promise.allSettled([
    fetchText(rawSourceUrl(input.currentVersion, CORE_DESCRIPTOR_PATH), input.fetchImpl),
    fetchText(rawSourceUrl(input.targetVersion, CORE_DESCRIPTOR_PATH), input.fetchImpl),
    fetchCompareFiles(input.currentVersion, input.targetVersion, input.fetchImpl)
  ]);

  if (currentResult.status === "rejected" || targetResult.status === "rejected") {
    const reason = currentResult.status === "rejected"
      ? currentResult.reason
      : targetResult.status === "rejected"
        ? targetResult.reason
        : undefined;
    return unavailableReport({
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      generatedAt: input.now(),
      error: readErrorMessage(reason, "OpenClaw server-method contract source could not be loaded.")
    });
  }

  try {
    const currentSpecs = parseOpenClawCoreMethodSpecs(currentResult.value);
    const targetSpecs = parseOpenClawCoreMethodSpecs(targetResult.value);
    const changedFiles = compareResult.status === "fulfilled" ? compareResult.value : [];
    const changedServerMethodFiles = changedFiles.filter((file) => file.startsWith(SERVER_METHODS_PREFIX));
    const changedProtocolFiles = changedFiles.filter((file) =>
      PROTOCOL_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))
    );
    const changes = compareMethodSpecs(currentSpecs, targetSpecs);
    const evidenceWarnings: OpenClawServerMethodContractChange[] = [];

    if (compareResult.status === "rejected") {
      evidenceWarnings.push(createEvidenceWarning(
        "__implementation_evidence__",
        "Server-method implementation file evidence could not be loaded; method and scope comparison is still available."
      ));
    } else {
      if (changedServerMethodFiles.length > 0) {
        evidenceWarnings.push(createEvidenceWarning(
          "__server_method_implementations__",
          `${changedServerMethodFiles.length} server-method implementation file(s) changed; postflight runtime verification remains required.`
        ));
      }
      if (changedProtocolFiles.length > 0) {
        evidenceWarnings.push(createEvidenceWarning(
          "__protocol_schemas__",
          `${changedProtocolFiles.length} Gateway protocol/schema file(s) changed; payload compatibility requires runtime shape checks.`
        ));
      }
    }

    const allChanges = [...changes, ...evidenceWarnings];
    const blockerCount = allChanges.filter((change) => change.status === "blocker").length;
    const warningCount = allChanges.filter((change) => change.status === "warning").length;
    const status: OpenClawServerMethodContractDiffStatus = blockerCount > 0
      ? "blocker"
      : warningCount > 0
        ? "warning"
        : "safe";

    return {
      generatedAt: input.now().toISOString(),
      source: "github-static",
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      status,
      currentMethodCount: currentSpecs.filter((spec) => spec.advertise).length,
      targetMethodCount: targetSpecs.filter((spec) => spec.advertise).length,
      changedServerMethodFiles,
      changedProtocolFiles,
      changes: allChanges,
      blockerCount,
      warningCount,
      summary: summarizeDiff({ status, changes: allChanges, changedServerMethodFiles, changedProtocolFiles }),
      error: compareResult.status === "rejected"
        ? readErrorMessage(compareResult.reason, "GitHub implementation comparison was unavailable.")
        : null
    };
  } catch (error) {
    return unavailableReport({
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      generatedAt: input.now(),
      error: readErrorMessage(error, "OpenClaw server-method contract could not be parsed.")
    });
  }
}

function compareMethodSpecs(currentSpecs: CoreMethodSpec[], targetSpecs: CoreMethodSpec[]) {
  const currentByName = new Map(currentSpecs.map((spec) => [spec.name, spec]));
  const targetByName = new Map(targetSpecs.map((spec) => [spec.name, spec]));
  const methodNames = new Set([...currentByName.keys(), ...targetByName.keys()]);
  const changes: OpenClawServerMethodContractChange[] = [];

  for (const method of [...methodNames].sort()) {
    const current = currentByName.get(method) ?? null;
    const target = targetByName.get(method) ?? null;
    const affectedOperations = operationsForMethod(method);

    if (!current && target) {
      changes.push({
        method,
        kind: "added",
        status: "safe",
        currentScope: null,
        targetScope: target.scope,
        affectedOperations,
        message: `${method} is added with ${target.scope} scope.`
      });
      continue;
    }

    if (current && !target) {
      const status = lostOperationStatus(method, currentSpecs, targetSpecs);
      changes.push({
        method,
        kind: "removed",
        status,
        currentScope: current.scope,
        targetScope: null,
        affectedOperations,
        message: affectedOperations.length
          ? `${method} is removed and affects ${affectedOperations.join(", ")}.`
          : `${method} is removed from the core Gateway contract.`
      });
      continue;
    }

    if (!current || !target) {
      continue;
    }

    if (current.scope !== target.scope) {
      const status = scopeChangeStatus(method, current.scope, target.scope);
      changes.push({
        method,
        kind: "scope-changed",
        status,
        currentScope: current.scope,
        targetScope: target.scope,
        affectedOperations,
        message: `${method} scope changes from ${current.scope} to ${target.scope}.`
      });
    }

    if (
      current.advertise !== target.advertise ||
      current.startup !== target.startup ||
      current.controlPlaneWrite !== target.controlPlaneWrite
    ) {
      const hidden = current.advertise && !target.advertise;
      const status = hidden ? lostOperationStatus(method, currentSpecs, targetSpecs) : "warning";
      changes.push({
        method,
        kind: "policy-changed",
        status,
        currentScope: current.scope,
        targetScope: target.scope,
        affectedOperations,
        message: `${method} policy changes (${formatPolicy(current)} -> ${formatPolicy(target)}).`
      });
    }
  }

  return changes;
}

function lostOperationStatus(method: string, currentSpecs: CoreMethodSpec[], targetSpecs: CoreMethodSpec[]) {
  const currentMethods = new Set(currentSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  const targetMethods = new Set(targetSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  const impacted = OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.filter((operation) =>
    operation.methods.includes(method) &&
    operation.methods.some((candidate) => currentMethods.has(candidate)) &&
    !operation.methods.some((candidate) => targetMethods.has(candidate))
  );

  return impacted.some(blocksUpdate) ? "blocker" : "warning";
}

function scopeChangeStatus(method: string, currentScope: string, targetScope: string) {
  const impacted = OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.filter((operation) => operation.methods.includes(method));
  const privilegeIncreased = scopeRank(targetScope) > scopeRank(currentScope) || (
    currentScope !== targetScope && scopeRank(targetScope) === scopeRank(currentScope)
  );

  return privilegeIncreased && impacted.some(blocksUpdate) ? "blocker" : "warning";
}

function blocksUpdate(operation: OpenClawGatewayCompatibilityOperationDefinition) {
  return operation.baseline === "required" || operation.fallbackAllowed === false;
}

function operationsForMethod(method: string) {
  return OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS
    .filter((operation) => operation.methods.includes(method))
    .map((operation) => operation.label);
}

function scopeRank(scope: string) {
  switch (scope) {
    case "operator.read": return 1;
    case "operator.write": return 2;
    case "operator.approvals":
    case "operator.pairing": return 3;
    case "operator.admin": return 4;
    case "dynamic":
    case "node": return 5;
    default: return 6;
  }
}

function formatPolicy(spec: CoreMethodSpec) {
  return [
    spec.advertise ? "advertised" : "hidden",
    spec.startup ? "startup" : "normal-startup",
    spec.controlPlaneWrite ? "control-plane-write" : "standard-write"
  ].join(", ");
}

function createEvidenceWarning(method: string, message: string): OpenClawServerMethodContractChange {
  return {
    method,
    kind: "policy-changed",
    status: "warning",
    currentScope: null,
    targetScope: null,
    affectedOperations: [],
    message
  };
}

function summarizeDiff(input: {
  status: OpenClawServerMethodContractDiffStatus;
  changes: OpenClawServerMethodContractChange[];
  changedServerMethodFiles: string[];
  changedProtocolFiles: string[];
}) {
  const methodChanges = input.changes.filter((change) => !change.method.startsWith("__"));
  if (input.status === "safe" && methodChanges.length === 0) {
    return "No semantic core Gateway method contract changes were detected.";
  }

  const blockers = input.changes.filter((change) => change.status === "blocker").length;
  const warnings = input.changes.filter((change) => change.status === "warning").length;
  return `${methodChanges.length} method contract change(s), ${blockers} blocker(s), ${warnings} warning(s), ${input.changedServerMethodFiles.length} server-method file change(s), and ${input.changedProtocolFiles.length} protocol file change(s).`;
}

async function fetchCompareFiles(currentVersion: string, targetVersion: string, fetchImpl: FetchLike) {
  const url = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/compare/v${encodeURIComponent(currentVersion)}...v${encodeURIComponent(targetVersion)}`;
  const payload = JSON.parse(await fetchText(url, fetchImpl, "application/vnd.github+json")) as GitHubComparePayload;
  const files = Array.isArray(payload.files) ? payload.files as GitHubCompareFile[] : [];

  return files
    .map((file) => typeof file.filename === "string" ? file.filename : null)
    .filter((file): file is string => Boolean(file));
}

async function fetchText(url: string, fetchImpl: FetchLike, accept = "text/plain") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: accept,
        "User-Agent": "AgentOS-OpenClaw-Contract-Diff"
      }
    });
    if (!response.ok) {
      throw new Error(`OpenClaw contract source returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
      throw new Error("OpenClaw contract source exceeded the safe response size limit.");
    }

    const text = await response.text();
    if (text.length > MAX_SOURCE_BYTES) {
      throw new Error("OpenClaw contract source exceeded the safe response size limit.");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function rawSourceUrl(version: string, path: string) {
  return `https://raw.githubusercontent.com/${OPENCLAW_REPOSITORY}/v${encodeURIComponent(version)}/${path}`;
}

function normalizeVersion(value: string) {
  const normalized = value.trim().replace(/^v/i, "");
  return VERSION_PATTERN.test(normalized) ? normalized : null;
}

function unavailableReport(input: {
  currentVersion: string;
  targetVersion: string;
  generatedAt: Date;
  error: string;
}): OpenClawServerMethodContractDiffReport {
  return {
    generatedAt: input.generatedAt.toISOString(),
    source: "unavailable",
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    status: "unknown",
    currentMethodCount: null,
    targetMethodCount: null,
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes: [],
    blockerCount: 0,
    warningCount: 0,
    summary: "Static OpenClaw server-method contract evidence is unavailable.",
    error: input.error
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
