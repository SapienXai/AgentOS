const WORKSPACE_NAME_SUFFIXES = [
  "Hub",
  "Studio",
  "Lab",
  "Workspace",
  "Forge",
  "Base",
  "Works",
  "Desk"
] as const;

const PRIMARY_AGENT_NAME_SUFFIXES = [
  "Builder",
  "Operator",
  "Pilot",
  "Maker",
  "Scout",
  "Planner",
  "Guide",
  "Lead"
] as const;

const WORKSPACE_SUFFIXES = new Set<string>(WORKSPACE_NAME_SUFFIXES.map((suffix) => suffix.toLowerCase()));
const GENERIC_WORKSPACE_WORDS = new Set(["new", "project", "product", "untitled", "workspace", "workspaces"]);
const MAX_BRAND_WORDS = 2;

function nameWords(value: string | undefined) {
  const firstSegment = (value ?? "").split(/[|\u2014\u2013:/\\\n\r\u00b7\u2022]/u)[0] ?? "";
  return firstSegment
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function stripWorkspaceSuffix(words: string[]) {
  if (words.length > 1 && WORKSPACE_SUFFIXES.has(words.at(-1)?.toLowerCase() ?? "")) {
    return words.slice(0, -1);
  }
  return words;
}

function normalizeNameCandidate(value: string | undefined) {
  const candidate = (value ?? "")
    .replace(/[.,!?;:]+$/u, "")
    .replace(/^["“'`]+|["”'`]+$/gu, "")
    .trim();
  if (!candidate || candidate.length > 80) return null;
  const words = nameWords(candidate);
  if (words.length !== 1) return null;
  return words[0] ?? null;
}

function stableIndex(seed: string, length: number) {
  let hash = 0;
  for (const character of seed.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  }
  return hash % length;
}

/**
 * Returns the short product/project part used by generated workspace names.
 * Runtime IDs remain separate and are still owned by OpenClaw.
 */
export function deriveWorkspaceBrandName(value: string | undefined) {
  const words = stripWorkspaceSuffix(nameWords(value));
  return words.slice(0, MAX_BRAND_WORDS).join(" ") || "Workspace";
}

/** Returns whether a generated identity is only a generic workspace label. */
export function isGenericWorkspaceName(value: string | undefined) {
  const words = stripWorkspaceSuffix(nameWords(value)).map((word) => word.toLowerCase());
  return words.length === 0 || words.every((word) => GENERIC_WORKSPACE_WORDS.has(word));
}

/**
 * Extracts a short project token from an operator brief when the brief names
 * the project directly. This intentionally returns only explicit identity
 * signals; the Architect may still choose a name when the brief is generic.
 */
export function deriveProjectNameFromText(value: string | undefined) {
  const text = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!text) return null;

  const patterns = [
    /\b(?:called|named)\s+["“']?([^\s,.;:!?()[\]{}]+)["”']?/iu,
    /\b(?:project|product|workspace)\s+(?:name|title)?\s*(?:is|:|-)\s*["“']?([^\s,.;:!?()[\]{}]+)["”']?/iu,
    /\b(?:project|workspace)\s+for\s+["“']?([A-Z][A-Za-z0-9_-]{1,54})["”']?/u,
    /\b([^\s,.;:!?()[\]{}]+)\s+proje\w*\b/iu
  ];

  for (const pattern of patterns) {
    const candidate = normalizeNameCandidate(text.match(pattern)?.[1]);
    if (candidate && !GENERIC_WORKSPACE_WORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return null;
}

/**
 * Gives new workspace drafts a compact, stable display name. The suffix is
 * deterministic so retries do not rename the same draft unexpectedly, while
 * different project brands do not all receive the same label.
 */
export function buildCompactWorkspaceName(value: string | undefined) {
  const words = nameWords(value);
  const brand = deriveWorkspaceBrandName(value);
  const existingSuffix = words.at(-1);

  if (words.length > 1 && existingSuffix && WORKSPACE_SUFFIXES.has(existingSuffix.toLowerCase())) {
    return [...brand.split(" "), existingSuffix].join(" ");
  }

  const suffix = WORKSPACE_NAME_SUFFIXES[stableIndex(`workspace-name-v1|${brand}`, WORKSPACE_NAME_SUFFIXES.length)];
  return `${brand} ${suffix}`;
}

/** Returns the generated name for the first workspace agent. */
export function buildCompactPrimaryAgentName(workspaceName: string | undefined) {
  const brand = deriveWorkspaceBrandName(workspaceName);
  const suffix = PRIMARY_AGENT_NAME_SUFFIXES[stableIndex(`primary-agent-name-v1|${brand}`, PRIMARY_AGENT_NAME_SUFFIXES.length)];
  return `${brand} ${suffix}`;
}
