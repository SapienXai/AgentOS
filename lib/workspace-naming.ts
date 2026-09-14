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

