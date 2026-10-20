import "server-only";

import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import type {
  OpenClawGatewayReadSharingContract,
  OpenClawGatewaySessionAccessContract,
  OpenClawServerMethodContractChange,
  OpenClawServerMethodContractDiffReport,
  OpenClawServerMethodContractDiffStatus
} from "@/lib/openclaw/types";

const OPENCLAW_REPOSITORY = "openclaw/openclaw";
const CORE_DESCRIPTOR_PATH = "src/gateway/methods/core-descriptors.ts";
const SERVER_METHODS_PREFIX = "src/gateway/server-methods/";
const GATEWAY_CONTRACT_TREE_PATHS = [
  "src/gateway/server-methods",
  "packages/gateway-protocol"
] as const;
const PROTOCOL_PATH_PREFIXES = [
  "packages/gateway-protocol/",
  "src/gateway/protocol/"
] as const;
const REQUEST_TIMEOUT_MS = 4_000;
const GITHUB_TREE_REQUEST_TIMEOUT_MS = 20_000;
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_GITHUB_TREE_BYTES = 24_000_000;
const MAX_SCOPED_TREE_ENTRIES = 20_000;
const MAX_DESCRIPTOR_ROWS = 2_000;
const MAX_POLICY_CONSTANTS = 64;
const MAX_POLICY_CONSTANT_BYTES = 8_192;
const MAX_READ_SHARING_EVENTS = 64;
const MAX_COMPARE_PAGES = 10;
const COMPARE_PAGE_SIZE = 100;
const MAX_COMPARE_FILES = 300;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/;
const OPENCLAW_SCOPE_PATTERN = /^(?:dynamic|node|operator\.[a-z][a-z0-9._-]*)$/;
const OPENCLAW_SINCE_PATTERN = /^(?:<=)?\d{4}\.\d{1,2}(?:\.\d{1,2})?$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenClawCoreMethodSpec = {
  name: string;
  family: string | null;
  scope: string;
  since: string | null;
  advertise: boolean;
  startup: boolean;
  controlPlaneWrite: boolean;
  compatibilityRestored: boolean;
  description: string | null;
  /** Unknown lifetime literals are retained as evidence and never treated as supported. */
  lifetime?: string | null;
  sessionAccess?: OpenClawGatewaySessionAccessContract | null;
  readSharing?: OpenClawGatewayReadSharingContract | null;
};

type GitHubCompareFile = {
  filename?: unknown;
  previous_filename?: unknown;
};

type GitHubComparePayload = {
  files?: unknown;
  status?: unknown;
  total_commits?: unknown;
};

type GitHubCommitPayload = {
  commit?: { tree?: { sha?: unknown } };
};

type GitHubTreePayload = {
  tree?: unknown;
  truncated?: unknown;
};

type GitHubTreeSnapshot = {
  entries: Map<string, string>;
  truncated: boolean;
};

type ChangedFilesEvidence = {
  files: string[];
  truncated: boolean;
  scope: "complete-repository" | "gateway-contract-paths" | "incomplete";
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
let releaseTreeCache = new WeakMap<FetchLike, Map<string, Promise<GitHubTreeSnapshot>>>();
let scopedReleaseTreeCache = new WeakMap<FetchLike, Map<string, Promise<GitHubTreeSnapshot>>>();

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
      currentRegisteredMethodCount: null,
      targetRegisteredMethodCount: null,
      changedFiles: [],
      changedServerMethodFiles: [],
      changedProtocolFiles: [],
      changes: [],
      blockerCount: 0,
      warningCount: 0,
      unknownCount: 0,
      renamedCount: 0,
      replacedCount: 0,
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

export function parseOpenClawCoreMethodSpecs(source: string): OpenClawCoreMethodSpec[] {
  if (source.length > MAX_SOURCE_BYTES) {
    throw new Error("OpenClaw contract source exceeded the safe response size limit.");
  }

  const declaration = /\b(?:export\s+)?const\s+CORE_GATEWAY_METHOD_SPECS\b/.exec(source);
  if (!declaration) {
    throw new Error("OpenClaw core Gateway method descriptor table was not found.");
  }

  const equalsIndex = source.indexOf("=", declaration.index);
  if (equalsIndex < 0) {
    throw new Error("OpenClaw core Gateway method descriptor table has no readable array.");
  }
  const openIndex = findNextNonCommentCharacter(source, equalsIndex + 1, "[");
  if (openIndex < 0) {
    throw new Error("OpenClaw core Gateway method descriptor table has no readable array.");
  }

  const closeIndex = findMatchingDelimiter(source, openIndex, "[", "]");
  const table = source.slice(openIndex + 1, closeIndex);
  const rows = splitTopLevel(stripJavaScriptComments(table));
  if (rows.length === 0) {
    throw new Error("OpenClaw core Gateway method descriptor table contained no rows.");
  }
  if (rows.length > MAX_DESCRIPTOR_ROWS) {
    throw new Error("OpenClaw core Gateway method descriptor table exceeded the safe row limit.");
  }

  const constants = extractSharedPolicyConstants(source, declaration.index);
  const specs = rows.map((row, index) => parseCoreMethodRow(row, index + 1, constants));
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.name)) {
      throw new Error(`OpenClaw core Gateway method descriptor table contains duplicate method ${spec.name}.`);
    }
    seen.add(spec.name);
  }

  return specs;
}

function parseCoreMethodRow(
  row: string,
  rowNumber: number,
  constants: Map<string, string>
): OpenClawCoreMethodSpec {
  const trimmed = row.trim();
  if (trimmed.startsWith("{")) {
    return parseLegacyCoreMethodRow(trimmed, rowNumber, constants);
  }
  if (trimmed.startsWith("[")) {
    return parseTupleCoreMethodRow(trimmed, rowNumber, constants);
  }

  throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an unsupported shape.`);
}

function parseLegacyCoreMethodRow(
  row: string,
  rowNumber: number,
  constants: Map<string, string>
): OpenClawCoreMethodSpec {
  const fields = parseObjectFields(row, rowNumber);
  assertAllowedFields(fields, [
    "name", "scope", "advertise", "startup", "controlPlaneWrite", "lifetime", "sessionAccess",
    "shareKey", "shareMaxAgeMs", "shareInvalidationEvents"
  ], rowNumber);

  const name = parseMethodName(fields.get("name"), rowNumber);
  const scope = parseScope(fields.get("scope"), rowNumber);
  return {
    name,
    family: null,
    scope,
    since: null,
    advertise: parseBooleanField(fields, "advertise", true, rowNumber),
    startup: parseBooleanField(fields, "startup", false, rowNumber),
    controlPlaneWrite: parseBooleanField(fields, "controlPlaneWrite", false, rowNumber),
    compatibilityRestored: false,
    description: null,
    lifetime: parseLifetimeField(fields, rowNumber),
    sessionAccess: parseSessionAccessField(fields, rowNumber, constants),
    readSharing: parseReadSharingPolicy(fields, rowNumber)
  };
}

function parseTupleCoreMethodRow(
  row: string,
  rowNumber: number,
  constants: Map<string, string>
): OpenClawCoreMethodSpec {
  if (!row.endsWith("]")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid tuple.`);
  }

  const values = splitTopLevel(row.slice(1, -1));
  if (values.length !== 4 && values.length !== 5) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid tuple length.`);
  }

  const name = parseMethodName(values[0], rowNumber);
  const familyValue = values[1]?.trim();
  const family = familyValue === "null" ? null : parseStringLiteral(familyValue, "family", rowNumber);
  const scope = parseScope(values[2], rowNumber);
  const since = parseSince(values[3], rowNumber);
  const policy = values[4] ? parsePolicyObject(values[4], rowNumber, constants) : new Map<string, string>();

  assertAllowedFields(policy, [
    "advertise", "startup", "controlPlaneWrite", "compatibilityRestored", "description", "lifetime", "sessionAccess",
    "shareKey", "shareMaxAgeMs", "shareInvalidationEvents"
  ], rowNumber);
  return {
    name,
    family,
    scope,
    since,
    advertise: parseBooleanField(policy, "advertise", true, rowNumber),
    startup: parseBooleanField(policy, "startup", false, rowNumber),
    controlPlaneWrite: parseBooleanField(policy, "controlPlaneWrite", false, rowNumber),
    compatibilityRestored: parseBooleanField(policy, "compatibilityRestored", false, rowNumber),
    description: policy.has("description")
      ? parseStringLiteral(policy.get("description"), "description", rowNumber)
      : null,
    lifetime: parseLifetimeField(policy, rowNumber),
    sessionAccess: parseSessionAccessField(policy, rowNumber, constants),
    readSharing: parseReadSharingPolicy(policy, rowNumber)
  };
}

function parseLifetimeField(fields: Map<string, string>, rowNumber: number): string | null {
  if (!fields.has("lifetime")) return null;
  return parseStringLiteral(fields.get("lifetime"), "lifetime", rowNumber);
}

function parseSessionAccessField(
  fields: Map<string, string>,
  rowNumber: number,
  constants: Map<string, string>
): OpenClawGatewaySessionAccessContract | null {
  if (!fields.has("sessionAccess")) return null;
  let value = fields.get("sessionAccess")?.trim() ?? "";
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    const sessionPolicy = parsePolicyObject(value, rowNumber, constants);
    value = sessionPolicy.get("sessionAccess")?.trim() ?? "";
  }
  if (!value.startsWith("{") || !value.endsWith("}")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid sessionAccess object.`);
  }
  const policy = parseObjectFields(value, rowNumber);
  assertAllowedFields(policy, ["mode", "allowOwnSessionScope", "requiredTool"], rowNumber);
  const mode = parseStringLiteral(policy.get("mode"), "sessionAccess.mode", rowNumber);
  if (mode !== "write") {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an unsupported sessionAccess mode.`);
  }
  const allowOwnSessionScope = policy.has("allowOwnSessionScope")
    ? parseBooleanField(policy, "allowOwnSessionScope", false, rowNumber)
    : undefined;
  const requiredTool = policy.has("requiredTool")
    ? parseStringLiteral(policy.get("requiredTool"), "sessionAccess.requiredTool", rowNumber)
    : undefined;
  if (requiredTool !== undefined && requiredTool.trim().length === 0) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an empty sessionAccess.requiredTool.`);
  }
  return {
    mode,
    ...(allowOwnSessionScope !== undefined ? { allowOwnSessionScope } : {}),
    ...(requiredTool !== undefined ? { requiredTool } : {})
  };
}

function parseReadSharingPolicy(
  fields: Map<string, string>,
  rowNumber: number
): OpenClawGatewayReadSharingContract | null {
  const hasReadSharing = ["shareKey", "shareMaxAgeMs", "shareInvalidationEvents"].some((field) => fields.has(field));
  if (!hasReadSharing) return null;

  const rawShareKey = fields.get("shareKey")?.trim();
  let shareKey: string | null = null;
  if (rawShareKey !== undefined && rawShareKey !== "null") {
    if (rawShareKey.startsWith('"') || rawShareKey.startsWith("'")) {
      shareKey = parseStringLiteral(rawShareKey, "shareKey", rowNumber);
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawShareKey)) {
      shareKey = rawShareKey;
    } else {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid shareKey reference.`);
    }
  }

  const rawMaxAge = fields.get("shareMaxAgeMs");
  let shareMaxAgeMs: number | null = null;
  if (rawMaxAge !== undefined && rawMaxAge !== "null") {
    if (!/^\d(?:_?\d)*$/.test(rawMaxAge)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid shareMaxAgeMs value.`);
    }
    shareMaxAgeMs = Number(rawMaxAge.replaceAll("_", ""));
    if (!Number.isSafeInteger(shareMaxAgeMs) || shareMaxAgeMs < 1 || shareMaxAgeMs > 60_000) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an out-of-range shareMaxAgeMs value.`);
    }
  }

  const rawEvents = fields.get("shareInvalidationEvents");
  const shareInvalidationEvents = rawEvents === undefined
    ? []
    : parseStringArrayLiteral(rawEvents, "shareInvalidationEvents", rowNumber);
  if (shareInvalidationEvents.length > MAX_READ_SHARING_EVENTS || shareInvalidationEvents.some((event) =>
    event.length === 0 || event.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(event)
  )) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has invalid share invalidation metadata.`);
  }

  return { shareKey, shareMaxAgeMs, shareInvalidationEvents };
}

function parseStringArrayLiteral(value: string, field: string, rowNumber: number) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid ${field} array.`);
  }
  const entries = splitTopLevel(trimmed.slice(1, -1));
  if (entries.length > MAX_READ_SHARING_EVENTS) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} exceeded the ${field} item limit.`);
  }
  return entries.map((entry) => parseStringLiteral(entry, field, rowNumber));
}

function parsePolicyObject(
  value: string,
  rowNumber: number,
  constants: Map<string, string>,
  resolving = new Set<string>()
): Map<string, string> {
  const trimmed = value.trim();
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    if (resolving.has(trimmed)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains a cyclic shared policy constant.`);
    }
    const expression = constants.get(trimmed);
    if (expression === undefined) {
      if (trimmed === "CONTROL_PLANE_WRITE") return new Map([["controlPlaneWrite", "true"]]);
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} references an unsupported shared policy constant.`);
    }
    resolving.add(trimmed);
    const resolved: Map<string, string> = parsePolicyObject(expression, rowNumber, constants, resolving);
    resolving.delete(trimmed);
    return resolved;
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid policy object.`);
  }

  const fields = new Map<string, string>();
  for (const field of splitTopLevel(trimmed.slice(1, -1))) {
    const spread = /^\.\.\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(field.trim());
    if (spread) {
      const expanded = parsePolicyObject(spread[1] ?? "", rowNumber, constants, resolving);
      for (const [key, fieldValue] of expanded) {
        if (fields.has(key)) {
          throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains duplicate shared policy metadata.`);
        }
        fields.set(key, fieldValue);
      }
      continue;
    }

    const separator = field.indexOf(":");
    if (separator <= 0) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid policy field.`);
    }
    const key = field.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || fields.has(key)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid or duplicate policy field.`);
    }
    fields.set(key, field.slice(separator + 1).trim());
  }
  return fields;
}

function extractSharedPolicyConstants(source: string, descriptorIndex: number) {
  const prefix = source.slice(0, descriptorIndex);
  const masked = maskJavaScriptCommentsAndStrings(prefix);
  const constants = new Map<string, string>();
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < masked.length; index += 1) {
    if (braces === 0 && brackets === 0 && parentheses === 0 && isIdentifierAt(masked, index, "const")) {
      const declaration = /^const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/.exec(masked.slice(index));
      if (declaration) {
        const name = declaration[1] ?? "";
        const equalsIndex = index + declaration[0].lastIndexOf("=");
        const objectIndex = findNextNonCommentCharacter(source, equalsIndex + 1, "{");
        if (objectIndex >= 0 && objectIndex < descriptorIndex) {
          const closeIndex = findMatchingDelimiter(source, objectIndex, "{", "}");
          const statementEnd = /^\s*(?:as\s+const\s*)?;/.exec(masked.slice(closeIndex + 1));
          if (statementEnd) {
            if (constants.size >= MAX_POLICY_CONSTANTS) {
              throw new Error("OpenClaw shared Gateway policy constants exceeded the safe count limit.");
            }
            const expression = source.slice(objectIndex, closeIndex + 1);
            if (expression.length > MAX_POLICY_CONSTANT_BYTES || constants.has(name)) {
              throw new Error("OpenClaw shared Gateway policy constant exceeded a safe size or uniqueness limit.");
            }
            constants.set(name, expression);
            index = closeIndex + statementEnd[0].length;
            continue;
          }
        }
      }
    }

    const character = masked[index];
    if (character === "{") braces += 1;
    else if (character === "}") braces = Math.max(0, braces - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
  }

  return constants;
}

function isIdentifierAt(source: string, index: number, identifier: string) {
  return source.slice(index, index + identifier.length) === identifier &&
    !/[A-Za-z0-9_$]/.test(source[index - 1] ?? "") &&
    !/[A-Za-z0-9_$]/.test(source[index + identifier.length] ?? "");
}

function maskJavaScriptCommentsAndStrings(source: string) {
  const commentsMasked = stripJavaScriptComments(source);
  let result = "";
  let quote: string | null = null;
  let escaped = false;
  for (const character of commentsMasked) {
    if (quote) {
      result += character === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += " ";
    } else {
      result += character;
    }
  }
  return result;
}

function parseObjectFields(value: string, rowNumber: number) {
  if (!value.endsWith("}")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid object.`);
  }

  const fields = new Map<string, string>();
  for (const field of splitTopLevel(value.slice(1, -1))) {
    const separator = field.indexOf(":");
    if (separator <= 0) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid field.`);
    }
    const key = field.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || fields.has(key)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid or duplicate field.`);
    }
    fields.set(key, field.slice(separator + 1).trim());
  }
  return fields;
}

function assertAllowedFields(fields: Map<string, string>, allowed: string[], rowNumber: number) {
  const allowedSet = new Set(allowed);
  for (const key of fields.keys()) {
    if (!allowedSet.has(key)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains unsupported field ${key}.`);
    }
  }
}

function parseMethodName(value: string | undefined, rowNumber: number) {
  const name = parseStringLiteral(value, "name", rowNumber).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid method name.`);
  }
  return name;
}

function parseScope(value: string | undefined, rowNumber: number) {
  const scope = parseStringLiteral(value, "scope", rowNumber).trim();
  if (!OPENCLAW_SCOPE_PATTERN.test(scope)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid scope.`);
  }
  return scope;
}

function parseSince(value: string | undefined, rowNumber: number) {
  const since = parseStringLiteral(value, "since", rowNumber).trim();
  if (!OPENCLAW_SINCE_PATTERN.test(since)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid since tag.`);
  }
  return since;
}

function parseStringLiteral(value: string | undefined, field: string, rowNumber: number) {
  const literal = value?.trim() ?? "";
  const quote = literal[0];
  if ((quote !== '"' && quote !== "'") || literal.at(-1) !== quote) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid ${field} string.`);
  }
  return literal.slice(1, -1);
}

function parseBooleanField(fields: Map<string, string>, field: string, defaultValue: boolean, rowNumber: number) {
  const value = fields.get(field);
  if (value === undefined) {
    return defaultValue;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid ${field} flag.`);
}

function findNextNonCommentCharacter(source: string, start: number, expected: string) {
  const clean = stripJavaScriptComments(source);
  for (let index = Math.max(0, start); index < clean.length; index += 1) {
    if (/\s/.test(clean[index] ?? "")) {
      continue;
    }
    return clean[index] === expected ? index : -1;
  }
  return -1;
}

function findMatchingDelimiter(source: string, openIndex: number, open: string, close: string) {
  const clean = stripJavaScriptComments(source);
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < clean.length; index += 1) {
    const character = clean[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("OpenClaw core Gateway method descriptor table has an unclosed array.");
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let escaped = false;
  const depth = { "[": 0, "{": 0, "(": 0 };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[" || character === "{" || character === "(") {
      depth[character] += 1;
    } else if (character === "]") {
      depth["["] -= 1;
    } else if (character === "}") {
      depth["{"] -= 1;
    } else if (character === ")") {
      depth["("] -= 1;
    } else if (character === "," && Object.values(depth).every((entry) => entry === 0)) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || Object.values(depth).some((entry) => entry !== 0)) {
    throw new Error("OpenClaw core Gateway method descriptor contains an unbalanced row.");
  }
  const finalPart = value.slice(start).trim();
  if (finalPart) {
    parts.push(finalPart);
  }
  return parts;
}

function stripJavaScriptComments(source: string) {
  let result = "";
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    }
    result += character;
  }

  return result;
}

export function resetOpenClawServerMethodContractDiffCache() {
  reportCache.clear();
  releaseTreeCache = new WeakMap();
  scopedReleaseTreeCache = new WeakMap();
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
    let compareFiles: ChangedFilesEvidence = compareResult.status === "fulfilled"
      ? compareResult.value
      : { files: [], truncated: false, scope: "complete-repository" };
    let completeFileEvidence = compareResult.status === "fulfilled" && !compareFiles.truncated;
    let fileEvidenceScope: ChangedFilesEvidence["scope"] = completeFileEvidence ? compareFiles.scope : "incomplete";
    let fileEvidenceError: string | null = compareResult.status === "rejected"
      ? readErrorMessage(compareResult.reason, "GitHub changed-file evidence could not be loaded.")
      : null;
    if (!completeFileEvidence) {
      try {
        const treeFiles = await fetchChangedFilesFromReleaseTrees(
          input.currentVersion,
          input.targetVersion,
          input.fetchImpl
        );
        if (!treeFiles.truncated) {
          compareFiles = treeFiles;
          completeFileEvidence = true;
          fileEvidenceScope = treeFiles.scope;
          fileEvidenceError = null;
        } else {
          fileEvidenceError = "GitHub reported a truncated recursive tag tree.";
        }
      } catch (error) {
        fileEvidenceError = readErrorMessage(error, "Complete GitHub tag-tree evidence could not be loaded.");
      }
    }
    if (!completeFileEvidence) {
      compareFiles = { ...compareFiles, truncated: true };
    }
    const changedFiles = compareFiles.files;
    const changedServerMethodFiles = changedFiles.filter((file) => file.startsWith(SERVER_METHODS_PREFIX));
    const changedProtocolFiles = changedFiles.filter((file) =>
      PROTOCOL_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))
    );
    const changes = compareOpenClawCoreMethodSpecs(currentSpecs, targetSpecs);
    const evidenceWarnings: OpenClawServerMethodContractChange[] = [];

    if (!completeFileEvidence) {
      evidenceWarnings.push(createEvidenceWarning(
        "__implementation_evidence__",
        "Server-method implementation file evidence could not be loaded completely; method and scope comparison is still available."
      ));
      evidenceWarnings.push(createEvidenceUnknown(
        "__comparison_truncated__",
        `The GitHub changed-file listing and complete tag-tree fallback were incomplete; implementation and protocol path counts are unknown${fileEvidenceError ? ` (${fileEvidenceError})` : ""}.`
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
    const unknownCount = allChanges.filter((change) => change.status === "unknown").length;
    const status: OpenClawServerMethodContractDiffStatus = blockerCount > 0
      ? "blocker"
      : unknownCount > 0
        ? "unknown"
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
      currentRegisteredMethodCount: currentSpecs.length,
      targetRegisteredMethodCount: targetSpecs.length,
      fileEvidenceScope: completeFileEvidence ? fileEvidenceScope : "incomplete",
      changedFiles,
      changedServerMethodFiles,
      changedProtocolFiles,
      changes: allChanges,
      blockerCount,
      warningCount,
      unknownCount,
      renamedCount: allChanges.filter((change) => change.kind === "renamed").length,
      replacedCount: allChanges.filter((change) => change.kind === "replaced").length,
      summary: summarizeDiff({ status, changes: allChanges, changedServerMethodFiles, changedProtocolFiles }),
      error: compareResult.status === "rejected" && !completeFileEvidence
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

export function compareOpenClawCoreMethodSpecs(
  currentSpecs: OpenClawCoreMethodSpec[],
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[] = OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS
) {
  const currentByName = new Map(currentSpecs.map((spec) => [spec.name, spec]));
  const targetByName = new Map(targetSpecs.map((spec) => [spec.name, spec]));
  const methodNames = new Set([...currentByName.keys(), ...targetByName.keys()]);
  const changes: OpenClawServerMethodContractChange[] = [];

  for (const method of [...methodNames].sort()) {
    const current = currentByName.get(method) ?? null;
    const target = targetByName.get(method) ?? null;
    const affectedOperations = operationsForMethod(method, operations);

    if (!current && target) {
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      changes.push({
        method,
        kind: "added",
        status: dynamicAuthorization ? "unknown" : "safe",
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: null,
        targetScope: target.scope,
        currentLifetime: null,
        targetLifetime: target.lifetime ?? null,
        currentSessionAccess: null,
        targetSessionAccess: target.sessionAccess ?? null,
        currentReadSharing: null,
        targetReadSharing: target.readSharing ?? null,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} is added with ${target.scope} scope; descriptor advertisement does not prove parameter-dependent authorization, so live runtime verification is required.`
          : `${method} is added with ${target.scope} scope.`
      });
      continue;
    }

    if (current && !target) {
      const replacement = findExplicitReplacement(method, targetSpecs, operations);
      const status = lostOperationStatus(method, currentSpecs, targetSpecs, operations);
      changes.push({
        method,
        kind: replacement ? "replaced" : "removed",
        status,
        authorizationEvidence: "static",
        currentScope: current.scope,
        targetScope: null,
        currentLifetime: current.lifetime ?? null,
        targetLifetime: null,
        currentSessionAccess: current.sessionAccess ?? null,
        targetSessionAccess: null,
        currentReadSharing: current.readSharing ?? null,
        targetReadSharing: null,
        affectedOperations,
        message: affectedOperations.length
          ? `${method} is removed${replacement ? ` with explicit replacement evidence for ${replacement.replacementMethod}` : ""} and affects ${affectedOperations.join(", ")}.`
          : `${method} is removed from the core Gateway contract.`
      });
      continue;
    }

    if (!current || !target) {
      continue;
    }

    const currentLifetime = current.lifetime ?? null;
    const targetLifetime = target.lifetime ?? null;
    const currentSessionAccess = current.sessionAccess ?? null;
    const targetSessionAccess = target.sessionAccess ?? null;
    const currentReadSharing = current.readSharing ?? null;
    const targetReadSharing = target.readSharing ?? null;
    const targetLifetimeUnknown = targetLifetime !== null && targetLifetime !== "observation";
    if (currentLifetime !== targetLifetime || targetLifetimeUnknown) {
      changes.push({
        method,
        kind: "policy-changed",
        status: targetLifetimeUnknown ? "unknown" : "warning",
        authorizationEvidence: "static",
        currentScope: current.scope,
        targetScope: target.scope,
        currentLifetime,
        targetLifetime,
        currentSessionAccess,
        targetSessionAccess,
        currentReadSharing,
        targetReadSharing,
        affectedOperations,
        message: targetLifetimeUnknown
          ? `${method} declares unrecognized lifetime ${JSON.stringify(targetLifetime)}; AgentOS retained the value, but its disconnect and restart semantics require review.`
          : `${method} lifetime changes from ${currentLifetime ?? "unspecified"} to ${targetLifetime ?? "unspecified"}${targetLifetime === "observation" ? "; OpenClaw cancels this observation when the requester disconnects or restart drain begins" : ""}.`
      });
    }

    if (JSON.stringify(currentSessionAccess) !== JSON.stringify(targetSessionAccess)) {
      const widened = hasBroaderSessionAccess(currentSessionAccess, targetSessionAccess);
      changes.push({
        method,
        kind: "policy-changed",
        status: widened ? "unknown" : "warning",
        authorizationEvidence: "runtime-required",
        currentScope: current.scope,
        targetScope: target.scope,
        currentSessionAccess,
        targetSessionAccess,
        currentReadSharing,
        targetReadSharing,
        affectedOperations,
        message: widened
          ? `${method} changes session-scoped write authority in a way that may broaden access; AgentOS retained the descriptor policy and requires runtime authorization review.`
          : `${method} session-scoped access policy changes from ${formatSessionAccess(currentSessionAccess)} to ${formatSessionAccess(targetSessionAccess)}.`
      });
    }

    if (JSON.stringify(currentReadSharing) !== JSON.stringify(targetReadSharing)) {
      const shareKeyChanged = currentReadSharing?.shareKey !== targetReadSharing?.shareKey;
      changes.push({
        method,
        kind: "policy-changed",
        status: shareKeyChanged ? "unknown" : "warning",
        authorizationEvidence: "runtime-required",
        currentScope: current.scope,
        targetScope: target.scope,
        currentReadSharing,
        targetReadSharing,
        affectedOperations,
        message: shareKeyChanged
          ? `${method} changes its read-sharing key policy; caller isolation and cache invalidation require live runtime verification.`
          : `${method} changes read-sharing cache metadata; verify freshness and invalidation behavior against the live Gateway.`
      });
    }

    if (current.scope !== target.scope) {
      const status = scopeChangeStatus(method, current.scope, target.scope);
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      changes.push({
        method,
        kind: "scope-changed",
        status,
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: current.scope,
        targetScope: target.scope,
        currentLifetime: current.lifetime ?? null,
        targetLifetime: target.lifetime ?? null,
        currentSessionAccess: current.sessionAccess ?? null,
        targetSessionAccess: target.sessionAccess ?? null,
        currentReadSharing,
        targetReadSharing,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} scope changes from ${current.scope} to ${target.scope}; authorization depends on request parameters or runtime state and requires live runtime verification.`
          : `${method} scope changes from ${current.scope} to ${target.scope}.`
      });
    }

    if (
      current.advertise !== target.advertise ||
      current.startup !== target.startup ||
      current.controlPlaneWrite !== target.controlPlaneWrite ||
      current.compatibilityRestored !== target.compatibilityRestored
    ) {
      const hidden = current.advertise && !target.advertise;
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      const status = hidden
        ? lostOperationStatus(method, currentSpecs, targetSpecs, operations)
        : dynamicAuthorization
          ? "unknown"
          : "warning";
      changes.push({
        method,
        kind: "policy-changed",
        status,
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: current.scope,
        targetScope: target.scope,
        currentLifetime: current.lifetime ?? null,
        targetLifetime: target.lifetime ?? null,
        currentSessionAccess: currentSessionAccess,
        targetSessionAccess: targetSessionAccess,
        currentReadSharing,
        targetReadSharing,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} policy changes (${formatPolicy(current)} -> ${formatPolicy(target)}); descriptor advertisement does not prove parameter-dependent authorization, so live runtime verification is required.`
          : `${method} policy changes (${formatPolicy(current)} -> ${formatPolicy(target)}).`
      });
    }
  }

  return changes;
}

function lostOperationStatus(
  method: string,
  currentSpecs: OpenClawCoreMethodSpec[],
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[]
) {
  const currentMethods = new Set(currentSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  const targetMethods = new Set(targetSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  if (!currentMethods.has(method) || targetMethods.has(method)) {
    return "warning";
  }

  const impacted = operations.filter((operation) =>
    operation.methods.includes(method) &&
    !findExplicitReplacementForOperation(method, targetMethods, operation)
  );

  return impacted.some(blocksUpdate) ? "blocker" : "warning";
}

function scopeChangeStatus(method: string, currentScope: string, targetScope: string) {
  void method;
  if (currentScope === "dynamic" || currentScope === "node" || targetScope === "dynamic" || targetScope === "node") {
    return "unknown";
  }
  return "warning";
}

function blocksUpdate(operation: OpenClawGatewayCompatibilityOperationDefinition) {
  return operation.baseline === "required";
}

function findExplicitReplacement(
  method: string,
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[]
) {
  const targetMethods = new Set(targetSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  for (const operation of operations) {
    const replacement = findExplicitReplacementForOperation(method, targetMethods, operation);
    if (replacement) {
      return replacement;
    }
  }
  return null;
}

function findExplicitReplacementForOperation(
  method: string,
  targetMethods: Set<string>,
  operation: OpenClawGatewayCompatibilityOperationDefinition
) {
  const evidence = operation.replacementEvidence?.find((entry) =>
    entry.removedMethod === method &&
    entry.replacementMethods.some((replacementMethod) =>
      operation.methods.includes(replacementMethod) && targetMethods.has(replacementMethod)
    )
  );
  if (!evidence) {
    return null;
  }
  return {
    replacementMethod: evidence.replacementMethods.find((replacementMethod) =>
      operation.methods.includes(replacementMethod) && targetMethods.has(replacementMethod)
    ) ?? null,
    rationale: evidence.rationale
  };
}

function operationsForMethod(method: string, operations: OpenClawGatewayCompatibilityOperationDefinition[]) {
  return operations
    .filter((operation) => operation.methods.includes(method))
    .map((operation) => operation.label);
}

function requiresRuntimeAuthorization(scope: string) {
  return scope === "dynamic" || scope === "node";
}

function formatPolicy(spec: OpenClawCoreMethodSpec) {
  return [
    spec.advertise ? "advertised" : "hidden",
    spec.startup ? "startup" : "normal-startup",
    spec.controlPlaneWrite ? "control-plane-write" : "standard-write",
    spec.compatibilityRestored ? "compatibility-restored" : "standard-compatibility",
    `lifetime=${spec.lifetime ?? "unspecified"}`,
    `session-access=${formatSessionAccess(spec.sessionAccess ?? null)}`,
    `read-sharing=${JSON.stringify(spec.readSharing ?? null)}`
  ].join(", ");
}

function formatSessionAccess(value: OpenClawGatewaySessionAccessContract | null) {
  return value ? JSON.stringify(value) : "unspecified";
}

function hasBroaderSessionAccess(
  current: OpenClawGatewaySessionAccessContract | null,
  target: OpenClawGatewaySessionAccessContract | null
) {
  if (!target) return false;
  if (!current) return true;
  if (!current.allowOwnSessionScope && target.allowOwnSessionScope) return true;
  if (current.requiredTool && !target.requiredTool) return true;
  if (current.requiredTool && target.requiredTool !== current.requiredTool) return true;
  return false;
}

function createEvidenceWarning(method: string, message: string): OpenClawServerMethodContractChange {
  return {
    method,
    kind: "policy-changed",
    status: "warning",
    authorizationEvidence: "static",
    currentScope: null,
    targetScope: null,
    affectedOperations: [],
    message
  };
}

function createEvidenceUnknown(method: string, message: string): OpenClawServerMethodContractChange {
  return {
    method,
    kind: "policy-changed",
    status: "unknown",
    authorizationEvidence: "static",
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
  const unknowns = input.changes.filter((change) => change.status === "unknown").length;
  return `${methodChanges.length} method contract change(s), ${blockers} blocker(s), ${warnings} warning(s), ${unknowns} unknown(s), ${input.changedServerMethodFiles.length} server-method file change(s), and ${input.changedProtocolFiles.length} protocol file change(s).`;
}

async function fetchCompareFiles(currentVersion: string, targetVersion: string, fetchImpl: FetchLike): Promise<ChangedFilesEvidence> {
  const baseUrl = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/compare/v${encodeURIComponent(currentVersion)}...v${encodeURIComponent(targetVersion)}`;
  const files: GitHubCompareFile[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_COMPARE_PAGES; page += 1) {
    const url = `${baseUrl}?per_page=${COMPARE_PAGE_SIZE}&page=${page}`;
    const payload = JSON.parse(await fetchText(url, fetchImpl, "application/vnd.github+json")) as GitHubComparePayload;
    const requiresTreeFallback = payload.status === "diverged" ||
      (typeof payload.total_commits === "number" && payload.total_commits >= 10_000);
    if (requiresTreeFallback) {
      truncated = true;
    }
    const pageFiles = Array.isArray(payload.files) ? payload.files as GitHubCompareFile[] : [];
    files.push(...pageFiles);
    if (requiresTreeFallback) break;
    if (new Set(files.flatMap((file) => [file.filename, file.previous_filename]).filter(Boolean)).size >= MAX_COMPARE_FILES) {
      truncated = true;
      break;
    }
    if (pageFiles.length < COMPARE_PAGE_SIZE) {
      break;
    }
    if (page === MAX_COMPARE_PAGES) {
      truncated = true;
    }
  }

  return {
    files: [...new Set(files
      .flatMap((file) => [file.filename, file.previous_filename])
      .filter((file): file is string => typeof file === "string" && file.length > 0))].sort(),
    truncated,
    scope: truncated ? "incomplete" : "complete-repository"
  };
}

async function fetchChangedFilesFromReleaseTrees(
  currentVersion: string,
  targetVersion: string,
  fetchImpl: FetchLike
): Promise<ChangedFilesEvidence> {
  const [currentTree, targetTree] = await Promise.all([
    getReleaseTree(currentVersion, fetchImpl),
    getReleaseTree(targetVersion, fetchImpl)
  ]);
  if (currentTree.truncated || targetTree.truncated) {
    const [currentScopedTrees, targetScopedTrees] = await Promise.all([
      Promise.all(GATEWAY_CONTRACT_TREE_PATHS.map((path) => getScopedReleaseTree(currentVersion, path, fetchImpl))),
      Promise.all(GATEWAY_CONTRACT_TREE_PATHS.map((path) => getScopedReleaseTree(targetVersion, path, fetchImpl)))
    ]);
    if (currentScopedTrees.some((tree) => tree.truncated) || targetScopedTrees.some((tree) => tree.truncated)) {
      return { files: [], truncated: true, scope: "incomplete" };
    }
    const currentEntries = mergeTreeSnapshots(currentScopedTrees);
    const targetEntries = mergeTreeSnapshots(targetScopedTrees);
    const scopedPaths = new Set([...currentEntries.keys(), ...targetEntries.keys()]);
    return {
      files: [...scopedPaths]
        .filter((path) => currentEntries.get(path) !== targetEntries.get(path))
        .sort(),
      truncated: false,
      scope: "gateway-contract-paths"
    };
  }
  const paths = new Set([...currentTree.entries.keys(), ...targetTree.entries.keys()]);
  const files = [...paths]
    .filter((path) => currentTree.entries.get(path) !== targetTree.entries.get(path))
    .sort();
  return {
    files,
    truncated: false,
    scope: "complete-repository"
  };
}

function getReleaseTree(version: string, fetchImpl: FetchLike): Promise<GitHubTreeSnapshot> {
  let cache = releaseTreeCache.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    releaseTreeCache.set(fetchImpl, cache);
  }
  const cached = cache.get(version);
  if (cached) return cached;

  const snapshot = fetchReleaseTree(version, fetchImpl);
  cache.set(version, snapshot);
  return snapshot;
}

function getScopedReleaseTree(version: string, repoPath: string, fetchImpl: FetchLike): Promise<GitHubTreeSnapshot> {
  let cache = scopedReleaseTreeCache.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    scopedReleaseTreeCache.set(fetchImpl, cache);
  }
  const key = `${version}:${repoPath}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const snapshot = fetchScopedReleaseTree(version, repoPath, fetchImpl);
  cache.set(key, snapshot);
  return snapshot;
}

async function fetchScopedReleaseTree(version: string, repoPath: string, fetchImpl: FetchLike): Promise<GitHubTreeSnapshot> {
  const commitUrl = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/commits/v${encodeURIComponent(version)}`;
  const commit = await fetchJson<GitHubCommitPayload>(commitUrl, fetchImpl, MAX_SOURCE_BYTES);
  let treeSha = commit.commit?.tree?.sha;
  if (typeof treeSha !== "string" || !/^[a-f0-9]{40}$/i.test(treeSha)) {
    throw new Error(`GitHub did not return a valid tree identity for OpenClaw ${version}.`);
  }

  const segments = repoPath.split("/");
  for (const segment of segments) {
    const payload = await fetchJson<GitHubTreePayload>(
      `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/git/trees/${treeSha}`,
      fetchImpl,
      MAX_GITHUB_TREE_BYTES,
      GITHUB_TREE_REQUEST_TIMEOUT_MS
    );
    const entries = parseGitHubTreeEntries(payload, version);
    if (payload.truncated !== false) {
      throw new Error(`GitHub returned a truncated non-recursive tree while resolving ${repoPath} for OpenClaw ${version}.`);
    }
    const directory = entries.find((entry) => entry.path === segment && entry.type === "tree");
    if (!directory) {
      return { entries: new Map(), truncated: false };
    }
    treeSha = directory.sha;
  }

  const payload = await fetchJson<GitHubTreePayload>(
    `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/git/trees/${treeSha}?recursive=1`,
    fetchImpl,
    MAX_GITHUB_TREE_BYTES,
    GITHUB_TREE_REQUEST_TIMEOUT_MS
  );
  const entries = parseGitHubTreeEntries(payload, version);
  if (payload.truncated !== false || entries.length > MAX_SCOPED_TREE_ENTRIES) {
    return { entries: new Map(), truncated: true };
  }
  const prefix = `${repoPath}/`;
  return {
    entries: new Map(entries
      .filter((entry) => entry.type !== "tree")
      .map((entry) => [`${prefix}${entry.path}`, `${entry.type}:${entry.sha}:${entry.mode}`])),
    truncated: false
  };
}

function parseGitHubTreeEntries(payload: GitHubTreePayload, version: string) {
  if (!Array.isArray(payload.tree)) {
    throw new Error(`GitHub returned an unsupported tree shape for OpenClaw ${version}.`);
  }
  return payload.tree.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`GitHub returned an invalid tree entry for OpenClaw ${version}.`);
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.path !== "string" ||
      !entry.path ||
      typeof entry.type !== "string" ||
      typeof entry.sha !== "string" ||
      typeof entry.mode !== "string"
    ) {
      throw new Error(`GitHub returned an unsupported tree entry for OpenClaw ${version}.`);
    }
    return {
      path: entry.path,
      type: entry.type,
      sha: entry.sha,
      mode: entry.mode
    };
  });
}

function mergeTreeSnapshots(snapshots: GitHubTreeSnapshot[]) {
  const entries = new Map<string, string>();
  for (const snapshot of snapshots) {
    for (const [path, value] of snapshot.entries) {
      if (entries.has(path)) {
        throw new Error(`Gateway contract tree snapshots overlapped at ${path}.`);
      }
      entries.set(path, value);
    }
  }
  return entries;
}

async function fetchReleaseTree(version: string, fetchImpl: FetchLike): Promise<GitHubTreeSnapshot> {
  const commitUrl = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/commits/v${encodeURIComponent(version)}`;
  const commit = await fetchJson<GitHubCommitPayload>(commitUrl, fetchImpl, MAX_SOURCE_BYTES);
  const treeSha = commit.commit?.tree?.sha;
  if (typeof treeSha !== "string" || !/^[a-f0-9]{40}$/i.test(treeSha)) {
    throw new Error(`GitHub did not return a valid tree identity for OpenClaw ${version}.`);
  }

  const treeUrl = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/git/trees/${treeSha}?recursive=1`;
  const payload = await fetchJson<GitHubTreePayload>(treeUrl, fetchImpl, MAX_GITHUB_TREE_BYTES, GITHUB_TREE_REQUEST_TIMEOUT_MS);
  if (typeof payload.truncated !== "boolean") {
    throw new Error(`GitHub returned an unsupported recursive tree shape for OpenClaw ${version}.`);
  }

  const entries = parseGitHubTreeEntries(payload, version)
    .filter((entry) => entry.type !== "tree")
    .map((entry) => [entry.path, `${entry.type}:${entry.sha}:${entry.mode}`] as const);
  return { entries: new Map(entries), truncated: payload.truncated };
}

async function fetchJson<T>(url: string, fetchImpl: FetchLike, maxBytes: number, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const text = await fetchTextWithLimit(url, fetchImpl, "application/vnd.github+json", maxBytes, timeoutMs);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("GitHub returned invalid JSON for OpenClaw tag-tree evidence.");
  }
}

async function fetchText(url: string, fetchImpl: FetchLike, accept = "text/plain") {
  return fetchTextWithLimit(url, fetchImpl, accept, MAX_SOURCE_BYTES);
}

async function fetchTextWithLimit(
  url: string,
  fetchImpl: FetchLike,
  accept: string,
  maxBytes: number,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "AgentOS-OpenClaw-Contract-Diff"
    };
    if (url.startsWith("https://api.github.com/") && githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      throw new Error(`OpenClaw contract source returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error("OpenClaw compatibility evidence exceeded the safe response size limit.");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("OpenClaw compatibility evidence exceeded the safe response size limit.");
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
    currentRegisteredMethodCount: null,
    targetRegisteredMethodCount: null,
    changedFiles: [],
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes: [],
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    renamedCount: 0,
    replacedCount: 0,
    summary: "Static OpenClaw server-method contract evidence is unavailable.",
    error: input.error
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
