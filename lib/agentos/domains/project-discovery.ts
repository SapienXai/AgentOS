import { getDomain } from "tldts";

export const PROJECT_DISCOVERY_SCHEMA_VERSION = 2 as const;
export type ProjectDiscoverySchemaVersion = 1 | typeof PROJECT_DISCOVERY_SCHEMA_VERSION;

export type ProjectDiscoveryFirstPartyClass = "root" | "subdomain" | "external";

export type ProjectDiscoveryFetchStatus = "queued" | "fetched" | "skipped" | "failed" | "blocked";

export type ProjectDiscoveryCrawlDisposition = "crawl" | "shallow" | "record-only" | "blocked";

export type ProjectDiscoveryCrawlPolicy = {
  disposition: ProjectDiscoveryCrawlDisposition;
  reason: "root-host" | "www-host" | "high-value-subdomain" | "shallow-subdomain" | "infrastructure-subdomain" | "unknown-subdomain" | "outside-site-family" | "unsafe-url";
};

export type ProjectDiscoveryCandidateKind =
  | "page"
  | "subdomain"
  | "external-resource"
  | "contact"
  | "document"
  | "sitemap";

export type ProjectDiscoveryRelation =
  | "navigation"
  | "footer"
  | "metadata"
  | "canonical"
  | "sitemap"
  | "contact"
  | "document"
  | "repository"
  | "social"
  | "application"
  | "documentation"
  | "developer"
  | "support"
  | "reference";

export type ProjectDiscoveryCandidate = {
  kind: ProjectDiscoveryCandidateKind;
  locator: string;
  discoveredFrom: string;
  relation: ProjectDiscoveryRelation;
  label: string | null;
  firstParty: boolean;
  depth: number;
  fetchStatus: ProjectDiscoveryFetchStatus;
  contentType: string | null;
};

export type ProjectDiscoveryContactCandidate = {
  kind: "email" | "phone" | "support-url";
  value: string;
  discoveredFrom: string;
  label: string | null;
};

export type ProjectDiscoveryPage = {
  requestedUrl: string;
  finalUrl: string | null;
  canonicalUrl: string | null;
  locator: string;
  discoveredFrom: string | null;
  depth: number;
  firstParty: ProjectDiscoveryFirstPartyClass;
  fetchStatus: ProjectDiscoveryFetchStatus;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  metadata: {
    description: string | null;
    siteName: string | null;
    openGraphTitle: string | null;
    openGraphDescription: string | null;
    twitterTitle: string | null;
    jsonLdTypes: string[];
    jsonLdNames?: string[];
    jsonLdLegalNames?: string[];
    jsonLdUrls?: string[];
    jsonLdApplicationCategories?: string[];
    jsonLdOperatingSystems?: string[];
  };
  discoveredLinkCount: number;
  contentHash: string | null;
  contentLength: number;
  warnings: string[];
};

export type ProjectDiscoveryManifest = {
  schemaVersion: ProjectDiscoverySchemaVersion;
  sourceId: string;
  rootUrl: string;
  registrableDomain: string | null;
  pages: ProjectDiscoveryPage[];
  candidates: ProjectDiscoveryCandidate[];
  contacts: ProjectDiscoveryContactCandidate[];
  warnings: string[];
  limits: {
    maxPages: number;
    maxDepth: number;
    maxSitemaps: number;
    maxConcurrentRequests: number;
  };
};

export function normalizeDiscoveryHttpUrl(value: string, options: { stripQuery?: boolean } = {}) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Discovery URLs must use HTTP or HTTPS.");
  if (url.username || url.password) throw new Error("Discovery URLs cannot contain credentials.");
  url.hash = "";
  if (url.port === "80" && url.protocol === "http:") url.port = "";
  if (url.port === "443" && url.protocol === "https:") url.port = "";
  if (!url.pathname) url.pathname = "/";
  url.pathname = url.pathname.replace(/\/+/g, "/");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
  for (const key of [...url.searchParams.keys()]) if (isUnsafeDiscoveryQueryParameter(key)) url.searchParams.delete(key);
  if (options.stripQuery) url.search = "";
  return url;
}

/** Query-free locator for progress, diagnostics, and operator-visible activity. */
export function safeDisplayDiscoveryLocator(value: string) {
  try {
    const url = normalizeDiscoveryHttpUrl(value, { stripQuery: true });
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

/** Stable locator for manifests, evidence identity, and candidate deduplication. */
export function safeDurableDiscoveryLocator(value: string) {
  try { return normalizeDiscoveryHttpUrl(value).toString(); } catch { return "[invalid-url]"; }
}

/** Backward-compatible alias for the display/progress form. */
export const safeDiscoveryLocator = safeDisplayDiscoveryLocator;

export function classifyProjectDiscoveryCrawlPolicy(value: string, root: string, label: string | null = null): ProjectDiscoveryCrawlPolicy {
  try {
    const candidate = normalizeDiscoveryHttpUrl(value);
    const rootUrl = normalizeDiscoveryHttpUrl(root);
    if (!isSameProjectSiteFamily(candidate.toString(), rootUrl.toString())) return { disposition: "blocked", reason: "outside-site-family" };
    const host = candidate.hostname.toLowerCase();
    const rootHost = rootUrl.hostname.toLowerCase();
    if (host === rootHost) return { disposition: "crawl", reason: "root-host" };
    if (host === "www." + rootHost || (rootHost === "www." + host)) return { disposition: "crawl", reason: "www-host" };
    const firstLabel = host.split(".")[0] ?? "";
    if (["cdn", "assets", "static", "images", "status", "mail", "tracking"].includes(firstLabel)) {
      return { disposition: "record-only", reason: "infrastructure-subdomain" };
    }
    if (["app", "blog"].includes(firstLabel)) return { disposition: "shallow", reason: "shallow-subdomain" };
    if (["docs", "doc", "documentation", "developer", "developers", "api", "help", "support"].includes(firstLabel)
      || /docs?|documentation|developer|api|help|support/i.test(label ?? "")) {
      return { disposition: "crawl", reason: "high-value-subdomain" };
    }
    return { disposition: "record-only", reason: "unknown-subdomain" };
  } catch {
    return { disposition: "blocked", reason: "unsafe-url" };
  }
}

function isUnsafeDiscoveryQueryParameter(key: string) {
  return /^(?:utm_[^=]+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref|referrer|token|access_token|refresh_token|id_token|api_key|apikey|secret|password|passwd|auth|authorization|signature|sig|session|sessionid|sid|jwt|code|state|key)$/i.test(key);
}

export function registrableDomainForHostname(hostname: string) {
  return getDomain(hostname.toLowerCase()) ?? null;
}

export function isSameProjectSiteFamily(candidate: string, root: string) {
  try {
    const candidateUrl = normalizeDiscoveryHttpUrl(candidate);
    const rootUrl = normalizeDiscoveryHttpUrl(root);
    const candidateDomain = registrableDomainForHostname(candidateUrl.hostname);
    const rootDomain = registrableDomainForHostname(rootUrl.hostname);
    return Boolean(candidateDomain && rootDomain && candidateDomain === rootDomain);
  } catch {
    return false;
  }
}

export function classifyDiscoveryRelation(label: string | null, locator: string): ProjectDiscoveryRelation {
  const value = `${label ?? ""} ${locator}`.toLowerCase();
  if (/mailto:|contact|support|helpdesk/.test(value)) return "contact";
  if (/github|gitlab|bitbucket|repository|repo/.test(value)) return "repository";
  if (/discord|telegram|twitter|x\.com|linkedin|youtube|instagram|tiktok/.test(value)) return "social";
  if (/whitepaper|technical-paper|\.pdf(?:$|[?#])|paper|report/.test(value)) return "document";
  if (/^https?:\/\/[^/]*(?:docs?|documentation)\./.test(value) || /documentation|developer|api reference|api docs/.test(value)) return "documentation";
  if (/^https?:\/\/[^/]*\bapp\./.test(value) || /application|launch app|dashboard/.test(value)) return "application";
  if (/developer|api/.test(value)) return "developer";
  if (/support|help/.test(value)) return "support";
  if (/canonical/.test(value)) return "canonical";
  return "reference";
}

export function isLikelyDocumentUrl(value: string) {
  return /\.(?:pdf|md|markdown|txt|xml|csv|json)(?:$|[?#])/i.test(value)
    || /whitepaper|technical-paper|download|report/i.test(value);
}

export function isLikelySocialUrl(value: string) {
  try {
    return /(?:^|\.)github\.com$|(?:^|\.)gitlab\.com$|(?:^|\.)bitbucket\.org$|(?:^|\.)x\.com$|(?:^|\.)twitter\.com$|(?:^|\.)linkedin\.com$|(?:^|\.)discord\.gg$|(?:^|\.)t\.me$|(?:^|\.)youtube\.com$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isDiscoveryManifest(value: unknown): value is ProjectDiscoveryManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return hasOnlyKeys(candidate, ["schemaVersion", "sourceId", "rootUrl", "registrableDomain", "pages", "candidates", "contacts", "warnings", "limits"])
    && (candidate.schemaVersion === 1 || candidate.schemaVersion === PROJECT_DISCOVERY_SCHEMA_VERSION)
    && typeof candidate.sourceId === "string" && candidate.sourceId.length > 0 && candidate.sourceId.length <= 120
    && typeof candidate.rootUrl === "string" && candidate.rootUrl.length > 0 && candidate.rootUrl.length <= 500
    && (candidate.registrableDomain === null || typeof candidate.registrableDomain === "string")
    && Array.isArray(candidate.pages)
    && candidate.pages.length <= 256
    && Array.isArray(candidate.candidates)
    && candidate.candidates.length <= 256
    && Array.isArray(candidate.contacts)
    && candidate.contacts.length <= 64
    && Array.isArray(candidate.warnings)
    && candidate.warnings.length <= 32
    && candidate.warnings.every((entry) => typeof entry === "string")
    && candidate.pages.every(isDiscoveryPage)
    && candidate.candidates.every(isDiscoveryCandidate)
    && candidate.contacts.every(isDiscoveryContact)
    && isDiscoveryLimits(candidate.limits);
}

function isDiscoveryPage(value: unknown): value is ProjectDiscoveryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  return hasOnlyKeys(page, ["requestedUrl", "finalUrl", "canonicalUrl", "locator", "discoveredFrom", "depth", "firstParty", "fetchStatus", "statusCode", "contentType", "title", "metadata", "discoveredLinkCount", "contentHash", "contentLength", "warnings"])
    && typeof page.requestedUrl === "string"
    && (page.finalUrl === null || typeof page.finalUrl === "string")
    && (page.canonicalUrl === null || typeof page.canonicalUrl === "string")
    && typeof page.locator === "string"
    && (page.discoveredFrom === null || typeof page.discoveredFrom === "string")
    && Number.isSafeInteger(page.depth) && (page.depth as number) >= 0
    && ["root", "subdomain", "external"].includes(page.firstParty as string)
    && ["queued", "fetched", "skipped", "failed", "blocked"].includes(page.fetchStatus as string)
    && (page.statusCode === null || Number.isSafeInteger(page.statusCode))
    && (page.contentType === null || typeof page.contentType === "string")
    && (page.title === null || typeof page.title === "string")
    && isDiscoveryMetadata(page.metadata)
    && Number.isSafeInteger(page.discoveredLinkCount) && (page.discoveredLinkCount as number) >= 0
    && (page.contentHash === null || typeof page.contentHash === "string")
    && Number.isSafeInteger(page.contentLength) && (page.contentLength as number) >= 0
    && Array.isArray(page.warnings)
    && page.warnings.length <= 16
    && page.warnings.every((entry) => typeof entry === "string");
}

function isDiscoveryMetadata(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return hasOnlyKeys(metadata, ["description", "siteName", "openGraphTitle", "openGraphDescription", "twitterTitle", "jsonLdTypes", "jsonLdNames", "jsonLdLegalNames", "jsonLdUrls", "jsonLdApplicationCategories", "jsonLdOperatingSystems"])
    && ["description", "siteName", "openGraphTitle", "openGraphDescription", "twitterTitle"].every((key) => metadata[key] === null || typeof metadata[key] === "string")
    && Array.isArray(metadata.jsonLdTypes)
    && metadata.jsonLdTypes.length <= 32
    && metadata.jsonLdTypes.every((entry) => typeof entry === "string")
    && ["jsonLdNames", "jsonLdLegalNames", "jsonLdUrls", "jsonLdApplicationCategories", "jsonLdOperatingSystems"].every((key) => metadata[key] === undefined || (Array.isArray(metadata[key]) && metadata[key].length <= 32 && metadata[key].every((entry) => typeof entry === "string")));
}

function isDiscoveryCandidate(value: unknown): value is ProjectDiscoveryCandidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return hasOnlyKeys(candidate, ["kind", "locator", "discoveredFrom", "relation", "label", "firstParty", "depth", "fetchStatus", "contentType"])
    && ["page", "subdomain", "external-resource", "contact", "document", "sitemap"].includes(candidate.kind as string)
    && typeof candidate.locator === "string"
    && typeof candidate.discoveredFrom === "string"
    && ["navigation", "footer", "metadata", "canonical", "sitemap", "contact", "document", "repository", "social", "application", "documentation", "developer", "support", "reference"].includes(candidate.relation as string)
    && (candidate.label === null || typeof candidate.label === "string")
    && typeof candidate.firstParty === "boolean"
    && Number.isSafeInteger(candidate.depth) && (candidate.depth as number) >= 0
    && ["queued", "fetched", "skipped", "failed", "blocked"].includes(candidate.fetchStatus as string)
    && (candidate.contentType === null || typeof candidate.contentType === "string");
}

function isDiscoveryContact(value: unknown): value is ProjectDiscoveryContactCandidate {
  if (!value || typeof value !== "object") return false;
  const contact = value as Record<string, unknown>;
  return hasOnlyKeys(contact, ["kind", "value", "discoveredFrom", "label"])
    && ["email", "phone", "support-url"].includes(contact.kind as string)
    && typeof contact.value === "string" && contact.value.length > 0 && contact.value.length <= 200
    && typeof contact.discoveredFrom === "string"
    && (contact.label === null || typeof contact.label === "string");
}

function isDiscoveryLimits(value: unknown): value is ProjectDiscoveryManifest["limits"] {
  if (!value || typeof value !== "object") return false;
  const limits = value as Record<string, unknown>;
  return hasOnlyKeys(limits, ["maxPages", "maxDepth", "maxSitemaps", "maxConcurrentRequests"])
    && Number.isSafeInteger(limits.maxPages) && (limits.maxPages as number) > 0
    && Number.isSafeInteger(limits.maxDepth) && (limits.maxDepth as number) >= 0
    && Number.isSafeInteger(limits.maxSitemaps) && (limits.maxSitemaps as number) > 0
    && Number.isSafeInteger(limits.maxConcurrentRequests) && (limits.maxConcurrentRequests as number) > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}
