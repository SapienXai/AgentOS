import { createHash } from "node:crypto";

import { redactSecretText } from "@/lib/security/redaction";
import type {
  KnowledgeHostResolver,
  KnowledgeIngestionLimits,
  KnowledgeWebsiteFetcher
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  classifyDiscoveryRelation,
  classifyProjectDiscoveryCrawlPolicy,
  isLikelyDocumentUrl,
  isLikelySocialUrl,
  isSameProjectSiteFamily,
  normalizeDiscoveryHttpUrl,
  PROJECT_DISCOVERY_SCHEMA_VERSION,
  registrableDomainForHostname,
  safeDisplayDiscoveryLocator,
  safeDurableDiscoveryLocator,
  safeDiscoveryLocator,
  type ProjectDiscoveryCandidate,
  type ProjectDiscoveryContactCandidate,
  type ProjectDiscoveryManifest,
  type ProjectDiscoveryPage,
  type ProjectDiscoveryCrawlDisposition,
  type ProjectDiscoveryRelation,
  type ProjectDiscoveryQualityReason,
  type ProjectDiscoveryRenderedFallbackStatus
} from "@/lib/agentos/domains/project-discovery";
import type { WorkspaceKnowledgeSourceKind } from "@/lib/agentos/domains/workspace-knowledge";

type Progress = {
  runId: string;
  sourceId: string;
  sourceKind: WorkspaceKnowledgeSourceKind;
  phase: "validate" | "discover" | "fetch" | "normalize" | "stage" | "commit" | "finalize";
  status: "discovering" | "fetching" | "normalizing" | "partial" | "ready" | "error";
  message: string;
  completed: number;
  total: number;
  warningCount: number;
  activityCode?: string;
  discoveredItems?: number;
  fetchedItems?: number;
  storedDocuments?: number;
  currentLocator?: string | null;
};

export type ProjectDiscoveryRenderedBrowser = {
  inspect(input: { url: string; timeoutMs: number; maxChars: number; signal?: AbortSignal }): Promise<{ url: string; title?: string | null; text: string; links: Array<{ url: string; label?: string | null }> }>;
};

export type ProjectDiscoveryEngineInput = {
  runId: string;
  sourceId: string;
  sourceKind: WorkspaceKnowledgeSourceKind;
  rootUrl: string;
  limits: KnowledgeIngestionLimits;
  signal?: AbortSignal;
  websiteFetcher: KnowledgeWebsiteFetcher;
  resolveHost: KnowledgeHostResolver;
  assertPublicAddresses: (addresses: string[]) => void;
  onProgress?: (progress: Progress) => void | Promise<void>;
  renderedBrowser?: ProjectDiscoveryRenderedBrowser;
};

export type ProjectDiscoveryFetchedPage = {
  page: ProjectDiscoveryPage;
  title: string;
  origin: string;
  canonicalUrl: string;
  content: string;
  links: string[];
};

export type ProjectDiscoveryEngineResult = {
  documents: ProjectDiscoveryFetchedPage[];
  discoveredItems: number;
  fetchedItems: number;
  skippedItems: number;
  warnings: string[];
  manifest: ProjectDiscoveryManifest;
};

type QueueEntry = {
  url: string;
  discoveredFrom: string | null;
  relation: ProjectDiscoveryRelation;
  label: string | null;
  depth: number;
  firstParty: "root" | "subdomain";
  priority: number;
  crawlDisposition: ProjectDiscoveryCrawlDisposition;
};

type Anchor = { href: string; label: string | null; area: "navigation" | "footer" | null };

type ParsedHtml = {
  title: string | null;
  canonicalUrl: string | null;
  metadata: ProjectDiscoveryPage["metadata"];
  anchors: Anchor[];
  contacts: ProjectDiscoveryContactCandidate[];
  markdown: string;
  jsonLdTypes: string[];
  jsonLdLinks: Array<{ url: string; relation: ProjectDiscoveryRelation; label: string | null }>;
};

type RobotsPolicy = { disallow: string[]; sitemaps: string[] };

const MAX_METADATA_TEXT = 500;
const MAX_JSON_LD_BYTES = 64_000;
const MAX_JSON_LD_BLOCKS = 8;
const MAX_JSON_LD_OBJECTS = 64;
const MAX_JSON_LD_DEPTH = 4;
const MAX_JSON_LD_ARRAY_ITEMS = 32;
const MAX_JSON_LD_STRING = 500;

export class ProjectDiscoverySourceByteBudget {
  readonly capacity: number;
  committed = 0;
  reserved = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Website source byte limit is invalid.");
    this.capacity = capacity;
  }

  get remaining() { return this.capacity - this.committed - this.reserved; }

  reserve(requested: number) {
    const amount = Math.min(Math.max(0, requested), this.remaining);
    if (amount <= 0) return null;
    this.reserved += amount;
    this.assertInvariant();
    return { amount, settled: false };
  }

  settle(reservation: { amount: number; settled: boolean }, actualBytes: number) {
    if (reservation.settled) return;
    const actual = Math.min(Math.max(0, actualBytes), reservation.amount);
    reservation.settled = true;
    this.reserved -= reservation.amount;
    this.committed += actual;
    this.assertInvariant();
  }

  settleConservatively(reservation: { amount: number; settled: boolean }) {
    this.settle(reservation, reservation.amount);
  }

  private assertInvariant() {
    if (this.committed < 0 || this.reserved < 0 || this.committed + this.reserved > this.capacity) {
      throw new Error("Website source byte budget invariant failed.");
    }
  }
}
const MAX_DISCOVERY_CANDIDATES = 256;
const MAX_DISCOVERY_CONTACTS = 64;
const MAX_SITEMAP_LOCATIONS = 256;

export async function discoverProjectWebsite(input: ProjectDiscoveryEngineInput): Promise<ProjectDiscoveryEngineResult> {
  const root = normalizeDiscoveryHttpUrl(input.rootUrl);
  const rootHost = root.hostname.toLowerCase();
  const registrableDomain = registrableDomainForHostname(rootHost);
  const queue: QueueEntry[] = [{ url: root.toString(), discoveredFrom: null, relation: "reference", label: null, depth: 0, firstParty: "root", priority: 10_000, crawlDisposition: "crawl" }];
  const queued = new Set<string>([canonicalQueueUrl(root.toString())]);
  const fetched = new Set<string>();
  const contentHashes = new Set<string>();
  const pages: ProjectDiscoveryPage[] = [];
  const candidates: ProjectDiscoveryCandidate[] = [];
  const contacts: ProjectDiscoveryContactCandidate[] = [];
  const documents: ProjectDiscoveryFetchedPage[] = [];
  const warnings: string[] = [];
  const robotsByHost = new Map<string, RobotsPolicy>();
  const sourceByteBudget = new ProjectDiscoverySourceByteBudget(input.limits.maxTotalBytesPerSource);
  let discoveredItems = 1;
  let fetchedItems = 0;
  let skippedItems = 0;
  let renderedFallback: ProjectDiscoveryRenderedFallbackStatus = "not-needed";
  const qualityReasons: ProjectDiscoveryQualityReason[] = [];

  await emit(input, {
    phase: "discover",
    status: "discovering",
    activityCode: "source-started",
    completed: 0,
    total: input.limits.maxPagesPerSource,
    warningCount: 0,
    discoveredItems,
    fetchedItems,
    storedDocuments: 0,
    currentLocator: safeDiscoveryLocator(root.toString())
  });

  const rootRobots = await readRobots(input, root, rootHost, sourceByteBudget);
  robotsByHost.set(rootHost, rootRobots.policy);
  for (const sitemapUrl of rootRobots.policy.sitemaps) {
    enqueueSitemapCandidate(sitemapUrl, root.toString());
  }
  enqueueSitemapCandidate(new URL("/sitemap.xml", root).toString(), root.toString());

  const sitemapResult = await discoverSitemapCandidates({ input, root, rootHost, queue, queued, robotsByHost, declaredSitemaps: rootRobots.policy.sitemaps, budget: sourceByteBudget, warnings, candidates });
  discoveredItems += sitemapResult.discoveredItems;

  while (queue.length > 0 && fetched.size < input.limits.maxPagesPerSource) {
    throwIfAborted(input.signal);
    queue.sort((left, right) => right.priority - left.priority || left.depth - right.depth || left.url.localeCompare(right.url));
    const batch = queue.splice(0, Math.min(input.limits.maxConcurrentRequests, input.limits.maxPagesPerSource - fetched.size));
    await Promise.all(batch.map((entry) => emit(input, {
      phase: "fetch",
      status: "fetching",
      activityCode: "page-fetch-started",
      completed: fetched.size,
      total: Math.min(input.limits.maxPagesPerSource, Math.max(discoveredItems, 1)),
      discoveredItems,
      fetchedItems,
      storedDocuments: documents.length,
      warningCount: warnings.length,
      currentLocator: safeDiscoveryLocator(entry.url)
    })));
    const results = await Promise.all(batch.map((entry) => fetchDiscoveryPage(input, entry, root, rootHost, registrableDomain, robotsByHost, sourceByteBudget)));
    for (const result of results) {
      const page = result.page;
      fetched.add(canonicalQueueUrl(page.requestedUrl));
      pages.push(page);
      if (page.fetchStatus === "fetched") fetchedItems += 1;
      else skippedItems += 1;
      warnings.push(...page.warnings);

      for (const candidate of result.candidates) addBoundedCandidate(candidates, candidate);
      for (const contact of result.contacts) addBoundedContact(contacts, contact);
      if (result.document) {
        const hash = result.document.page.contentHash;
        if (hash && contentHashes.has(hash)) {
          result.document.page.warnings = [...result.document.page.warnings, "duplicate-content"];
        } else {
          if (hash) contentHashes.add(hash);
          documents.push(result.document);
          await emit(input, {
            phase: "normalize",
            status: "normalizing",
            activityCode: "document-stored",
            completed: fetched.size,
            total: Math.min(input.limits.maxPagesPerSource, Math.max(discoveredItems, 1)),
            discoveredItems,
            fetchedItems,
            storedDocuments: documents.length,
            warningCount: warnings.length,
            currentLocator: result.document.page.locator
          });
        }
      }

      for (const discovered of result.discovered) {
        if (discovered.depth > input.limits.maxDepth || discovered.crawlDisposition === "record-only" || discovered.crawlDisposition === "blocked") continue;
        if (result.crawlDisposition === "shallow") continue;
        const normalized = canonicalQueueUrl(discovered.url);
        if (queued.has(normalized) || fetched.has(normalized) || fetched.size + queue.length >= input.limits.maxPagesPerSource * 2) continue;
        queued.add(normalized);
        queue.push(discovered);
        discoveredItems += 1;
        await emit(input, {
          phase: "discover",
          status: "discovering",
          activityCode: "page-discovered",
          completed: fetched.size,
          total: Math.min(input.limits.maxPagesPerSource, Math.max(discoveredItems, 1)),
          discoveredItems,
          fetchedItems,
          storedDocuments: documents.length,
          warningCount: warnings.length,
          currentLocator: safeDiscoveryLocator(discovered.url)
        });
      }
      await emit(input, {
        phase: "fetch",
        status: page.fetchStatus === "fetched" ? "fetching" : "partial",
        activityCode: page.fetchStatus === "fetched" ? "page-fetched" : "source-partial",
        completed: fetched.size,
        total: Math.min(input.limits.maxPagesPerSource, Math.max(discoveredItems, 1)),
        discoveredItems,
        fetchedItems,
        storedDocuments: documents.length,
        warningCount: warnings.length,
        currentLocator: page.locator
      });
    }
  }

  if (queue.length > 0 || fetched.size >= input.limits.maxPagesPerSource) warnings.push("Website crawl limits stopped further discovery.");
  const rootPage = pages.find((page) => page.firstParty === "root" && page.depth === 0);
  const shellDetected = Boolean(rootPage?.warnings.some((warning) => /JavaScript shell|no readable text/i.test(warning)));
  if (shellDetected) {
    qualityReasons.push("content-shell");
    if (input.renderedBrowser) {
      try {
        await emit(input, {
          phase: "fetch",
          status: "fetching",
          activityCode: "rendered-fallback-started",
          completed: fetched.size,
          total: input.limits.maxPagesPerSource,
          discoveredItems,
          fetchedItems,
          storedDocuments: documents.length,
          warningCount: warnings.length,
          currentLocator: safeDiscoveryLocator(root.toString())
        });
        const rendered = await input.renderedBrowser.inspect({ url: root.toString(), timeoutMs: Math.min(input.limits.requestTimeoutMs, 20_000), maxChars: Math.min(input.limits.maxBytesPerDocument, 32_000), signal: input.signal });
        const renderedText = normalizeDiscoveryBody(rendered.text).slice(0, 32_000);
        if (!renderedText) throw new Error("Rendered project page contained no readable text.");
        renderedFallback = "used";
        qualityReasons.push("rendered-fallback-used");
        await emit(input, {
          phase: "normalize",
          status: "normalizing",
          activityCode: "rendered-fallback-used",
          completed: fetched.size,
          total: input.limits.maxPagesPerSource,
          discoveredItems,
          fetchedItems,
          storedDocuments: documents.length,
          warningCount: warnings.length,
          currentLocator: safeDiscoveryLocator(root.toString())
        });
        if (rootPage) {
          rootPage.title = rendered.title?.trim().slice(0, MAX_METADATA_TEXT) || rootPage.title;
          rootPage.warnings = [...rootPage.warnings.filter((warning) => !/no safe server-side rendering fallback/i.test(warning)), "Rendered browser fallback supplied project text."];
          rootPage.discoveredLinkCount = Math.max(rootPage.discoveredLinkCount, rendered.links.length);
          rootPage.contentLength = Buffer.byteLength(renderedText, "utf8");
          rootPage.contentHash = sha256(renderedText);
          rootPage.fetchStatus = "fetched";
        }
        const renderedDocument: ProjectDiscoveryFetchedPage = {
          page: rootPage ?? {
            requestedUrl: root.toString(), finalUrl: root.toString(), canonicalUrl: root.toString(), locator: root.toString(), discoveredFrom: null, depth: 0, firstParty: "root", fetchStatus: "fetched", statusCode: 200, contentType: "text/html", title: rendered.title ?? null,
            metadata: { description: null, siteName: null, openGraphTitle: null, openGraphDescription: null, twitterTitle: null, jsonLdTypes: [] }, discoveredLinkCount: rendered.links.length, contentHash: sha256(renderedText), contentLength: Buffer.byteLength(renderedText, "utf8"), warnings: ["Rendered browser fallback supplied project text."]
          },
          title: rendered.title?.trim().slice(0, MAX_METADATA_TEXT) || root.toString(),
          origin: rendered.url,
          canonicalUrl: root.toString(),
          content: renderedText,
          links: rendered.links.slice(0, 128).map((link) => link.url)
        };
        const existingRootDocumentIndex = documents.findIndex((document) => document.page === rootPage);
        if (existingRootDocumentIndex >= 0) documents[existingRootDocumentIndex] = renderedDocument;
        else documents.push(renderedDocument);
        for (const link of rendered.links.slice(0, 128)) {
          const normalized = safeDiscoveryUrlInFamily(link.url, root.toString());
          if (!normalized) continue;
          const relation = classifyDiscoveryRelation(link.label ?? null, normalized);
          addBoundedCandidate(candidates, candidate("page", normalized, root.toString(), relation, link.label ?? null, true, 1, "queued", null));
        }
        discoveredItems += rendered.links.length;
      } catch (error) {
        renderedFallback = "failed";
        qualityReasons.push("rendered-fallback-failed");
        warnings.push(safeError(error, "Rendered browser fallback was unavailable."));
      }
    } else {
      renderedFallback = "unavailable";
      qualityReasons.push("rendered-fallback-unavailable");
      warnings.push("Static discovery found a JavaScript shell; rendered browser fallback is unavailable.");
    }
  }
  if (pages.length <= 1) qualityReasons.push("root-only");
  if (sitemapResult.discoveredItems === 0) qualityReasons.push("sitemap-empty");
  if (pages.some((page) => page.fetchStatus === "failed")) qualityReasons.push("fetch-failures");
  if (queue.length > 0 || fetched.size >= input.limits.maxPagesPerSource) qualityReasons.push("crawl-limit-reached");
  if (documents.length === 0) qualityReasons.push("insufficient-content");
  const uniqueQualityReasons = [...new Set(qualityReasons)];
  const quality = documents.length >= 2 || (documents.length >= 1 && renderedFallback === "used")
    ? "good" as const
    : documents.length === 1
      ? "limited" as const
      : "insufficient" as const;
  const manifest: ProjectDiscoveryManifest = {
    schemaVersion: PROJECT_DISCOVERY_SCHEMA_VERSION,
    sourceId: input.sourceId,
    rootUrl: safeDurableDiscoveryLocator(root.toString()),
    registrableDomain,
    pages: pages.slice(0, input.limits.maxPagesPerSource),
    candidates: candidates.map((entry) => {
      const page = pages.find((value) => value.locator === entry.locator);
      return page ? { ...entry, fetchStatus: page.fetchStatus } : entry;
    }).slice(0, MAX_DISCOVERY_CANDIDATES),
    contacts: contacts.slice(0, MAX_DISCOVERY_CONTACTS),
    warnings: unique(warnings).slice(0, 32),
    quality,
    qualityReasons: uniqueQualityReasons.slice(0, 12),
    renderedFallback,
    limits: {
      maxPages: input.limits.maxPagesPerSource,
      maxDepth: input.limits.maxDepth,
      maxSitemaps: input.limits.maxSitemaps,
      maxConcurrentRequests: input.limits.maxConcurrentRequests
    }
  };
  await emit(input, {
    phase: "normalize",
    status: warnings.length > 0 ? "partial" : "ready",
    activityCode: warnings.length > 0 ? "source-partial" : "source-completed",
    completed: fetched.size,
    total: Math.max(discoveredItems, 1),
    discoveredItems,
    fetchedItems,
    storedDocuments: documents.length,
    warningCount: warnings.length,
    currentLocator: null
  });
  return { documents, discoveredItems, fetchedItems, skippedItems, warnings: unique(warnings), manifest };

  function enqueueSitemapCandidate(value: string, discoveredFrom: string) {
    try {
      const url = normalizeDiscoveryHttpUrl(value);
      const policy = classifyProjectDiscoveryCrawlPolicy(url.toString(), root.toString(), "Sitemap");
      if (policy.disposition === "blocked") return;
      addBoundedCandidate(candidates, candidate("sitemap", url.toString(), discoveredFrom, "sitemap", "Sitemap", true, 0, policy.disposition === "record-only" ? "skipped" : "queued", "application/xml"));
    } catch {
      // Malformed sitemap locations are bounded discovery misses.
    }
  }
}

async function discoverSitemapCandidates(input: {
  input: ProjectDiscoveryEngineInput;
  root: URL;
  rootHost: string;
  queue: QueueEntry[];
  queued: Set<string>;
  robotsByHost: Map<string, RobotsPolicy>;
  declaredSitemaps: string[];
  budget: ProjectDiscoverySourceByteBudget;
  warnings: string[];
  candidates: ProjectDiscoveryCandidate[];
}) {
  let discoveredItems = 0;
  const sitemapQueue = [...input.declaredSitemaps];
  const visited = new Set<string>();
  const initial = new URL("/sitemap.xml", input.root).toString();
  sitemapQueue.push(initial);
  while (sitemapQueue.length > 0 && visited.size < input.input.limits.maxSitemaps) {
    throwIfAborted(input.input.signal);
    const raw = sitemapQueue.shift();
    if (!raw) continue;
    let url: URL;
    try { url = normalizeDiscoveryHttpUrl(raw); } catch { continue; }
    const normalized = canonicalQueueUrl(url.toString());
    if (visited.has(normalized) || !isSameProjectSiteFamily(url.toString(), input.root.toString())) continue;
    visited.add(normalized);
    let response;
    try {
      response = await fetchDiscoveryResource(input.input, url.toString(), input.rootHost, input.root, input.budget);
    } catch (error) {
      input.warnings.push(safeError(error, "Website sitemap could not be fetched."));
      continue;
    }
    if (response.response.status < 200 || response.response.status >= 300) continue;
    const locations = parseSitemapLocations(response.response.body).slice(0, MAX_SITEMAP_LOCATIONS);
    const isIndex = /<sitemapindex\b/i.test(response.response.body);
    for (const location of locations) {
      try {
        const candidateUrl = normalizeDiscoveryHttpUrl(location);
        if (!isSameProjectSiteFamily(candidateUrl.toString(), input.root.toString())) continue;
        const policy = classifyProjectDiscoveryCrawlPolicy(candidateUrl.toString(), input.root.toString(), "Sitemap");
        if (isIndex && visited.size < input.input.limits.maxSitemaps) {
          if (policy.disposition === "crawl" || policy.disposition === "shallow") sitemapQueue.push(candidateUrl.toString());
          continue;
        }
        const candidateKey = canonicalQueueUrl(candidateUrl.toString());
        if (input.queued.has(candidateKey)) continue;
        if (policy.disposition !== "blocked") input.queued.add(candidateKey);
        const firstParty = candidateUrl.hostname.toLowerCase() === input.rootHost ? "root" : "subdomain";
        addBoundedCandidate(input.candidates, candidate("page", candidateUrl.toString(), safeDurableDiscoveryLocator(url.toString()), "sitemap", "Sitemap", true, 0, policy.disposition === "crawl" || policy.disposition === "shallow" ? "queued" : "skipped", null));
        if (policy.disposition === "crawl" || policy.disposition === "shallow") input.queue.push({ url: candidateUrl.toString(), discoveredFrom: safeDurableDiscoveryLocator(url.toString()), relation: "sitemap", label: "Sitemap", depth: 0, firstParty, priority: 7_500 + pagePriority(candidateUrl.toString(), "Sitemap"), crawlDisposition: policy.disposition });
        discoveredItems += 1;
      } catch {
        // Ignore malformed sitemap locations.
      }
    }
  }
  return { discoveredItems };
}

async function fetchDiscoveryPage(
  input: ProjectDiscoveryEngineInput,
  entry: QueueEntry,
  root: URL,
  rootHost: string,
  registrableDomain: string | null,
  robotsByHost: Map<string, RobotsPolicy>,
  budget: ProjectDiscoverySourceByteBudget
) {
  const requestedUrl = normalizeDiscoveryHttpUrl(entry.url);
  const locator = safeDurableDiscoveryLocator(requestedUrl.toString());
  const firstParty = requestedUrl.hostname.toLowerCase() === rootHost ? "root" : "subdomain";
  const basePage = (overrides: Partial<ProjectDiscoveryPage> = {}): ProjectDiscoveryPage => ({
    requestedUrl: locator,
    finalUrl: null,
    canonicalUrl: null,
    locator,
    discoveredFrom: entry.discoveredFrom ? safeDurableDiscoveryLocator(entry.discoveredFrom) : null,
    depth: entry.depth,
    firstParty,
    fetchStatus: "queued",
    statusCode: null,
    contentType: null,
    title: null,
    metadata: { description: null, siteName: null, openGraphTitle: null, openGraphDescription: null, twitterTitle: null, jsonLdTypes: [], jsonLdNames: [], jsonLdLegalNames: [], jsonLdUrls: [], jsonLdApplicationCategories: [], jsonLdOperatingSystems: [] },
    discoveredLinkCount: 0,
    contentHash: null,
    contentLength: 0,
    warnings: [],
    ...overrides
  });

  if (!registrableDomain || registrableDomainForHostname(requestedUrl.hostname) !== registrableDomain || !isSameProjectSiteFamily(requestedUrl.toString(), root.toString())) {
    return { page: basePage({ fetchStatus: "blocked", warnings: ["Website page was outside the first-party site family."] }), candidates: [], contacts: [], discovered: [], document: null, crawlDisposition: entry.crawlDisposition };
  }
  const robots = await getRobots(input, requestedUrl, robotsByHost, budget);
  if (robots.policy.disallow.some((prefix) => requestedUrl.pathname.startsWith(prefix))) {
    return { page: basePage({ fetchStatus: "blocked", warnings: ["Website page was disallowed by robots.txt."] }), candidates: [], contacts: [], discovered: [], document: null, crawlDisposition: entry.crawlDisposition };
  }
  try {
    const response = await fetchDiscoveryResource(input, requestedUrl.toString(), rootHost, root, budget);
    const responseUrl = normalizeDiscoveryHttpUrl(response.response.finalUrl ?? requestedUrl.toString());
    const contentType = response.response.headers["content-type"] ?? null;
    const base = basePage({
      finalUrl: safeDurableDiscoveryLocator(responseUrl.toString()),
      locator: safeDurableDiscoveryLocator(responseUrl.toString()),
      statusCode: response.response.status,
      contentType
    });
    if (response.response.status < 200 || response.response.status >= 300) {
      return { page: { ...base, fetchStatus: "failed" as const, warnings: [`Website page returned HTTP ${response.response.status}.`] }, candidates: [], contacts: [], discovered: [], document: null, crawlDisposition: entry.crawlDisposition };
    }
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const documentCandidate = isLikelyDocumentUrl(responseUrl.toString())
        ? [candidate("document", responseUrl.toString(), entry.discoveredFrom ?? root.toString(), classifyDiscoveryRelation(entry.label, responseUrl.toString()), entry.label, true, entry.depth, "skipped", contentType)]
        : [];
      return { page: { ...base, fetchStatus: "skipped" as const, warnings: ["Non-HTML resource recorded as a discovery candidate."] }, candidates: documentCandidate, contacts: [], discovered: [], document: null, crawlDisposition: entry.crawlDisposition };
    }
    const parsed = parseDiscoveryHtml(response.response.body, responseUrl.toString());
    const canonicalUrl = parsed.canonicalUrl && safeDiscoveryUrlInFamily(parsed.canonicalUrl, root.toString()) ? parsed.canonicalUrl : responseUrl.toString();
    const content = normalizeDiscoveryBody(parsed.markdown);
    const contentHash = content ? sha256(content) : null;
    const shellWarning = isLikelyJavaScriptShell(response.response.body, parsed.markdown)
      ? "Static fetch returned a low-information JavaScript shell; no safe server-side rendering fallback is configured."
      : null;
    const page: ProjectDiscoveryPage = {
      ...base,
      canonicalUrl: canonicalUrl ? safeDurableDiscoveryLocator(canonicalUrl) : null,
      locator: safeDurableDiscoveryLocator(canonicalUrl),
      fetchStatus: content ? "fetched" : "skipped",
      title: parsed.title,
      metadata: parsed.metadata,
      discoveredLinkCount: parsed.anchors.length,
      contentHash,
      contentLength: Buffer.byteLength(response.response.body, "utf8"),
      warnings: content
        ? shellWarning ? [shellWarning] : []
        : ["Website page contained no readable text.", ...(shellWarning ? [shellWarning] : [])]
    };
    const sourceLocator = safeDurableDiscoveryLocator(canonicalUrl);
    const candidates: ProjectDiscoveryCandidate[] = [];
    const contacts: ProjectDiscoveryContactCandidate[] = [];
    const discovered: QueueEntry[] = [];
    for (const anchor of parsed.anchors) {
      const discoveredUrl = normalizeAnchorUrl(anchor.href, responseUrl.toString());
      if (!discoveredUrl) continue;
      const classifiedRelation = classifyDiscoveryRelation(anchor.label, discoveredUrl);
      const relation = anchor.area && classifiedRelation === "reference" ? anchor.area : classifiedRelation;
      const sameFamily = isSameProjectSiteFamily(discoveredUrl, root.toString());
      const sameHost = new URL(discoveredUrl).hostname.toLowerCase() === rootHost;
      const documentUrl = isLikelyDocumentUrl(discoveredUrl);
      const candidateKind: ProjectDiscoveryCandidate["kind"] = !sameFamily
        ? documentUrl ? "document" : "external-resource"
        : documentUrl ? "document" : sameHost ? "page" : "subdomain";
      const policy = classifyProjectDiscoveryCrawlPolicy(discoveredUrl, root.toString(), anchor.label);
      const linkCandidate = candidate(
        candidateKind,
        discoveredUrl,
        sourceLocator,
        relation,
        anchor.label,
        sameFamily,
        entry.depth + 1,
        policy.disposition === "crawl" || policy.disposition === "shallow" ? "queued" : policy.disposition === "blocked" ? "blocked" : "skipped",
        null
      );
      addBoundedCandidate(candidates, linkCandidate);
      if (sameFamily && (relation === "contact" || relation === "support")) {
        contacts.push({ kind: "support-url", value: discoveredUrl, discoveredFrom: sourceLocator, label: anchor.label });
      }
      if (/^mailto:/i.test(anchor.href)) continue;
      if (/^tel:/i.test(anchor.href)) continue;
      if (!sameFamily || policy.disposition === "record-only" || policy.disposition === "blocked" || entry.crawlDisposition === "shallow") continue;
      const target = new URL(discoveredUrl);
      const targetFirstParty = sameHost ? "root" : "subdomain";
      if (entry.depth + 1 > input.limits.maxDepth) continue;
      discovered.push({
        url: target.toString(),
        discoveredFrom: sourceLocator,
        relation,
        label: anchor.label,
        depth: entry.depth + 1,
        firstParty: targetFirstParty,
        priority: pagePriority(target.toString(), anchor.label),
        crawlDisposition: policy.disposition
      });
    }
    const canonicalPolicy = classifyProjectDiscoveryCrawlPolicy(canonicalUrl, root.toString(), "Canonical");
    if (canonicalUrl !== responseUrl.toString() && canonicalPolicy.disposition !== "blocked") {
      addBoundedCandidate(candidates, candidate("page", canonicalUrl, sourceLocator, "canonical", "Canonical", true, entry.depth, canonicalPolicy.disposition === "crawl" || canonicalPolicy.disposition === "shallow" ? "queued" : "skipped", null));
      if ((canonicalPolicy.disposition === "crawl" || canonicalPolicy.disposition === "shallow") && entry.crawlDisposition !== "shallow") {
        discovered.push({ url: canonicalUrl, discoveredFrom: sourceLocator, relation: "canonical", label: "Canonical", depth: entry.depth, firstParty: new URL(canonicalUrl).hostname.toLowerCase() === rootHost ? "root" : "subdomain", priority: pagePriority(canonicalUrl, "Canonical"), crawlDisposition: canonicalPolicy.disposition });
      }
    }
    for (const jsonLdLink of parsed.jsonLdLinks) {
      const policy = classifyProjectDiscoveryCrawlPolicy(jsonLdLink.url, root.toString(), jsonLdLink.label);
      const sameFamily = isSameProjectSiteFamily(jsonLdLink.url, root.toString());
      const kind: ProjectDiscoveryCandidate["kind"] = sameFamily ? isLikelyDocumentUrl(jsonLdLink.url) ? "document" : "page" : "external-resource";
      addBoundedCandidate(candidates, candidate(kind, jsonLdLink.url, sourceLocator, jsonLdLink.relation, jsonLdLink.label, sameFamily, entry.depth + 1, policy.disposition === "crawl" || policy.disposition === "shallow" ? "queued" : policy.disposition === "blocked" ? "blocked" : "skipped", null));
      if (sameFamily && (policy.disposition === "crawl" || policy.disposition === "shallow") && entry.crawlDisposition !== "shallow" && entry.depth + 1 <= input.limits.maxDepth) {
        const target = new URL(jsonLdLink.url);
        discovered.push({ url: jsonLdLink.url, discoveredFrom: sourceLocator, relation: jsonLdLink.relation, label: jsonLdLink.label, depth: entry.depth + 1, firstParty: target.hostname.toLowerCase() === rootHost ? "root" : "subdomain", priority: pagePriority(jsonLdLink.url, jsonLdLink.label), crawlDisposition: policy.disposition });
      }
    }
    const allContacts = [...parsed.contacts, ...contacts.filter((contact) => !parsed.contacts.some((existing) => existing.kind === contact.kind && existing.value === contact.value))];
    for (const contact of allContacts) contactsPush(candidates, contact, sourceLocator);
    const document = content ? {
      page,
      title: parsed.title ?? canonicalUrl,
      origin: responseUrl.toString(),
      canonicalUrl,
      content,
      links: parsed.anchors.map((anchor) => anchor.href)
    } : null;
    return { page, candidates, contacts: allContacts, discovered, document, crawlDisposition: entry.crawlDisposition };
  } catch (error) {
    return { page: basePage({ fetchStatus: "failed", warnings: [safeError(error, "Website page could not be fetched.")] }), candidates: [], contacts: [], discovered: [], document: null, crawlDisposition: entry.crawlDisposition };
  }
}

async function fetchDiscoveryResource(input: ProjectDiscoveryEngineInput, requestedUrl: string, _rootHost: string, root: URL, budget: ProjectDiscoverySourceByteBudget) {
  let current = normalizeDiscoveryHttpUrl(requestedUrl);
  for (let redirect = 0; redirect <= input.limits.maxRedirects; redirect += 1) {
    throwIfAborted(input.signal);
    if (!isSameProjectSiteFamily(current.toString(), root.toString())) throw new Error("Website page request left the first-party host scope.");
    const addresses = await input.resolveHost(current.hostname);
    input.assertPublicAddresses(addresses);
    const reservation = budget.reserve(input.limits.maxBytesPerDocument);
    if (!reservation) throw new Error("Website source byte limit reached.");
    try {
      const response = await input.websiteFetcher.fetch(current.toString(), {
        maxBytes: reservation.amount,
        timeoutMs: input.limits.requestTimeoutMs,
        signal: input.signal,
        resolvedAddresses: addresses
      });
      const responseBytes = Buffer.byteLength(response.body, "utf8");
      if (responseBytes > reservation.amount) {
        budget.settleConservatively(reservation);
        throw new Error("Website document byte limit reached.");
      }
      budget.settle(reservation, responseBytes);
    const reportedFinalUrl = response.finalUrl
      ? normalizeDiscoveryHttpUrl(response.finalUrl)
      : current;
    if (!isSameProjectSiteFamily(reportedFinalUrl.toString(), root.toString())) {
      throw new Error("Website page response left the first-party host scope.");
    }
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirect >= input.limits.maxRedirects) throw new Error("Website redirect limit reached.");
      const next = normalizeDiscoveryHttpUrl(new URL(location, current).toString());
      if (!isSameProjectSiteFamily(next.toString(), root.toString())) throw new Error("Website page redirect left the first-party host scope.");
      current = next;
      continue;
    }
      return { response: { ...response, finalUrl: reportedFinalUrl.toString() } };
    } catch (error) {
      budget.settleConservatively(reservation);
      throw error;
    }
  }
  throw new Error("Website redirect limit reached.");
}

async function readRobots(input: ProjectDiscoveryEngineInput, root: URL, host: string, budget: ProjectDiscoverySourceByteBudget) {
  try {
    const response = await fetchDiscoveryResource(input, new URL("/robots.txt", root).toString(), host, root, budget);
    if (response.response.status < 200 || response.response.status >= 300) return { policy: { disallow: [], sitemaps: [] } as RobotsPolicy };
    const disallow: string[] = [];
    const sitemaps: string[] = [];
    let active = false;
    for (const line of response.response.body.split(/\r?\n/).slice(0, 400)) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") active = value === "*";
      else if (active && key === "disallow" && value) disallow.push(value.slice(0, 200));
      else if (key === "sitemap" && value) {
        try {
          const sitemapUrl = normalizeDiscoveryHttpUrl(value).toString();
          if (classifyProjectDiscoveryCrawlPolicy(sitemapUrl, root.toString(), "Sitemap").disposition !== "blocked") sitemaps.push(sitemapUrl);
        } catch { /* Ignore malformed sitemap locations. */ }
      }
    }
    return { policy: { disallow: unique(disallow), sitemaps: unique(sitemaps) } };
  } catch {
    return { policy: { disallow: [], sitemaps: [] } as RobotsPolicy };
  }
}

async function getRobots(input: ProjectDiscoveryEngineInput, url: URL, cache: Map<string, RobotsPolicy>, budget: ProjectDiscoverySourceByteBudget) {
  const host = url.hostname.toLowerCase();
  const cached = cache.get(host);
  if (cached) return { policy: cached };
  const result = await readRobots(input, url, host, budget);
  cache.set(host, result.policy);
  return result;
}

function parseDiscoveryHtml(html: string, baseUrl: string): ParsedHtml {
  const title = matchHtmlText(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const metadata = {
    description: metaContent(html, "name", "description"),
    siteName: metaContent(html, "property", "og:site_name"),
    openGraphTitle: metaContent(html, "property", "og:title"),
    openGraphDescription: metaContent(html, "property", "og:description"),
    twitterTitle: metaContent(html, "name", "twitter:title"),
    jsonLdTypes: []
  };
  const canonicalRaw = html.match(/<link\b[^>]*\brel=["']?canonical["']?[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']?canonical["']?[^>]*>/i)?.[1];
  const canonicalUrl = canonicalRaw ? normalizeAnchorUrl(canonicalRaw, baseUrl) : null;
  const anchors: Anchor[] = [];
  const contacts: ProjectDiscoveryContactCandidate[] = [];
  const navigationRanges = tagRanges(html, "nav");
  const footerRanges = tagRanges(html, "footer");
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const hrefRaw = attribute(match[1], "href");
    if (!hrefRaw) continue;
    const label = cleanText(stripInlineHtml(match[2])).slice(0, 200) || null;
    const href = decodeHtmlEntities(hrefRaw).trim();
    if (/^mailto:/i.test(href)) {
      const value = href.replace(/^mailto:/i, "").split(/[?#]/, 1)[0].trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) contacts.push({ kind: "email", value, discoveredFrom: safeDiscoveryLocator(baseUrl), label });
      continue;
    }
    if (/^tel:/i.test(href)) {
      const value = href.replace(/^tel:/i, "").split(/[?#]/, 1)[0].trim().slice(0, 80);
      if (/^[+\d][\d ()-]{3,}$/.test(value)) contacts.push({ kind: "phone", value, discoveredFrom: safeDiscoveryLocator(baseUrl), label });
      continue;
    }
    anchors.push({ href, label, area: anchorArea(match.index ?? 0, navigationRanges, footerRanges) });
  }
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const markdown = cleaned
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner: string) => `\n\n\`\`\`\n${decodeHtmlEntities(stripInlineHtml(inner))}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${stripInlineHtml(inner)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => `\n- ${stripInlineHtml(inner)}\n`)
    .replace(/<br\s*\/?>(?=.)/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|header|tr|table|ul|ol|blockquote)\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner: string) => `\`${stripInlineHtml(inner)}\``)
    .replace(/<[^>]+>/g, " ");
  const jsonLd = parseJsonLdSignals(html, baseUrl);
  return {
    title: title ? cleanText(title).slice(0, MAX_METADATA_TEXT) : null,
    canonicalUrl,
    metadata: {
      ...metadata,
      jsonLdTypes: jsonLd.types,
      jsonLdNames: jsonLd.names,
      jsonLdLegalNames: jsonLd.legalNames,
      jsonLdUrls: jsonLd.urls,
      jsonLdApplicationCategories: jsonLd.applicationCategories,
      jsonLdOperatingSystems: jsonLd.operatingSystems
    },
    anchors,
    contacts: [...contacts, ...jsonLd.contacts].slice(0, MAX_DISCOVERY_CONTACTS),
    markdown: decodeHtmlEntities(markdown),
    jsonLdTypes: jsonLd.types,
    jsonLdLinks: jsonLd.links
  };
}

function tagRanges(html: string, tag: "nav" | "footer") {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  for (const match of html.matchAll(pattern)) {
    if (match.index !== undefined) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function anchorArea(index: number, navigationRanges: Array<{ start: number; end: number }>, footerRanges: Array<{ start: number; end: number }>) {
  if (navigationRanges.some((range) => index >= range.start && index < range.end)) return "navigation" as const;
  if (footerRanges.some((range) => index >= range.start && index < range.end)) return "footer" as const;
  return null;
}

function normalizeDiscoveryBody(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeAnchorUrl(value: string, baseUrl: string) {
  try {
    if (/^(?:mailto|tel):/i.test(value)) return value;
    return normalizeDiscoveryHttpUrl(new URL(value, baseUrl).toString()).toString();
  } catch {
    return null;
  }
}

function safeDiscoveryUrlInFamily(value: string, root: string) {
  try {
    return isSameProjectSiteFamily(value, root) ? normalizeDiscoveryHttpUrl(value).toString() : null;
  } catch {
    return null;
  }
}

function pagePriority(url: string, label: string | null) {
  const value = `${url} ${label ?? ""}`.toLowerCase();
  let score = 100;
  if (/\/(?:docs?|documentation|about|product|features|developers?|api|integrations?|security|faq|changelog|roadmap|terms)(?:\/|$)|docs?|documentation|developer|api|product|features|about|company|contact|support|whitepaper|security|architecture|integration|faq|changelog|roadmap/.test(value)) score += 500;
  if (/\/(?:token|tokenomics|contract|contracts|governance|snapshot|audit|network|chain|dao|github)(?:\/|$)|tokenomics|governance|snapshot|whitepaper|contract|network|chain|audit|dao/.test(value)) score += 460;
  if (/\/(?:sdk|github|repository|releases|architecture)(?:\/|$)|sdk|repository|releases|architecture/.test(value)) score += 420;
  if (/app\.|dashboard|launch/.test(value)) score += 220;
  if (/blog/.test(value)) score += 40;
  if (/legal|cookie|privacy|terms|tag|archive|calendar|page=/.test(value)) score -= 300;
  if (isLikelySocialUrlSafe(value)) score -= 500;
  return score;
}

function isLikelySocialUrlSafe(value: string) {
  try { return isLikelySocialUrl(value); } catch { return false; }
}

function candidate(kind: ProjectDiscoveryCandidate["kind"], locator: string, discoveredFrom: string, relation: ProjectDiscoveryRelation, label: string | null, firstParty: boolean, depth: number, fetchStatus: ProjectDiscoveryCandidate["fetchStatus"], contentType: string | null): ProjectDiscoveryCandidate {
  return { kind, locator: kind === "contact" ? safeContactLocator(locator) : safeDurableDiscoveryLocator(locator), discoveredFrom: safeDurableDiscoveryLocator(discoveredFrom), relation, label: label ? cleanText(label).slice(0, 200) : null, firstParty, depth, fetchStatus, contentType };
}

function safeContactLocator(value: string) {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, "").slice(0, 200);
}

function contactsPush(candidates: ProjectDiscoveryCandidate[], contact: ProjectDiscoveryContactCandidate, sourceLocator: string) {
  if (contact.kind === "support-url") return;
  candidates.push(candidate("contact", contact.value, sourceLocator, "contact", contact.label, true, 0, "skipped", null));
}

function addBoundedCandidate(target: ProjectDiscoveryCandidate[], value: ProjectDiscoveryCandidate) {
  if (target.some((entry) => entry.kind === value.kind && entry.locator === value.locator && entry.discoveredFrom === value.discoveredFrom)) return;
  if (target.length < MAX_DISCOVERY_CANDIDATES) target.push(value);
}

function addBoundedContact(target: ProjectDiscoveryContactCandidate[], value: ProjectDiscoveryContactCandidate) {
  if (target.some((entry) => entry.kind === value.kind && entry.value === value.value && entry.discoveredFrom === value.discoveredFrom)) return;
  if (target.length < MAX_DISCOVERY_CONTACTS) target.push({ ...value, value: value.value.slice(0, 200), label: value.label?.slice(0, 200) ?? null });
}

function parseSitemapLocations(xml: string) {
  return Array.from(xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)).map((match) => decodeHtmlEntities(match[1].trim())).filter(Boolean);
}

function parseJsonLdSignals(html: string, baseUrl: string) {
  const types: string[] = [];
  const names: string[] = [];
  const legalNames: string[] = [];
  const urls: string[] = [];
  const applicationCategories: string[] = [];
  const operatingSystems: string[] = [];
  const links: Array<{ url: string; relation: ProjectDiscoveryRelation; label: string | null }> = [];
  const contacts: ProjectDiscoveryContactCandidate[] = [];
  let objectCount = 0;
  let blocks = 0;

  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (blocks >= MAX_JSON_LD_BLOCKS) break;
    blocks += 1;
    const raw = match[1].slice(0, MAX_JSON_LD_BYTES);
    try {
      const parsed: unknown = JSON.parse(raw);
      walkJsonLd(parsed, 0);
    } catch {
      // Malformed JSON-LD remains an ignored discovery signal.
    }
  }

  return {
    types: unique(types).slice(0, 32),
    names: unique(names).slice(0, 32),
    legalNames: unique(legalNames).slice(0, 32),
    urls: unique(urls).slice(0, 32),
    applicationCategories: unique(applicationCategories).slice(0, 32),
    operatingSystems: unique(operatingSystems).slice(0, 32),
    links: links.slice(0, MAX_DISCOVERY_CANDIDATES),
    contacts: contacts.slice(0, MAX_DISCOVERY_CONTACTS)
  };

  function walkJsonLd(value: unknown, depth: number) {
    if (depth > MAX_JSON_LD_DEPTH || objectCount >= MAX_JSON_LD_OBJECTS) return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, MAX_JSON_LD_ARRAY_ITEMS)) walkJsonLd(entry, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    objectCount += 1;
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).slice(0, MAX_JSON_LD_OBJECTS)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      const child = record[key];
      const keyLower = key.toLowerCase();
      const strings = jsonLdStrings(child);
      if (key === "@type") types.push(...strings.map((entry) => entry.slice(0, 80)));
      if (keyLower === "name") names.push(...strings);
      if (keyLower === "legalname") legalNames.push(...strings);
      if (keyLower === "applicationcategory") applicationCategories.push(...strings);
      if (keyLower === "operatingsystem") operatingSystems.push(...strings);
      if (keyLower === "email") for (const email of strings) if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contacts.push({ kind: "email", value: email.toLowerCase(), discoveredFrom: safeDisplayDiscoveryLocator(baseUrl), label: "JSON-LD email" });
      if (keyLower === "telephone") for (const telephone of strings) if (/^[+\d][\d ()-]{3,}$/.test(telephone)) contacts.push({ kind: "phone", value: telephone, discoveredFrom: safeDisplayDiscoveryLocator(baseUrl), label: "JSON-LD telephone" });
      if (["url", "mainentityofpage", "sameas", "downloadurl", "coderepository", "softwarehelp", "documentation"].includes(keyLower) || /docs?|documentation|developer|reference|api/i.test(keyLower)) {
        for (const rawUrl of strings) {
          const normalized = normalizeAnchorUrl(rawUrl, baseUrl);
          if (!normalized || /^(?:mailto|tel):/i.test(normalized)) continue;
          urls.push(normalized);
          const relation = keyLower === "coderepository" ? "repository" : keyLower === "sameas" ? classifyDiscoveryRelation(key, normalized) : keyLower === "downloadurl" ? "document" : /docs?|documentation|softwarehelp/i.test(keyLower) ? "documentation" : "metadata";
          links.push({ url: normalized, relation, label: key.slice(0, 120) });
        }
      }
      walkJsonLd(child, depth + 1);
    }
  }

  function jsonLdStrings(value: unknown): string[] {
    if (typeof value === "string") return [cleanText(value).slice(0, MAX_JSON_LD_STRING)].filter(Boolean);
    if (Array.isArray(value)) return value.slice(0, MAX_JSON_LD_ARRAY_ITEMS).flatMap(jsonLdStrings).slice(0, MAX_JSON_LD_ARRAY_ITEMS);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const nested = record.url ?? record.email ?? record.telephone ?? record.name;
      return typeof nested === "string" ? [cleanText(nested).slice(0, MAX_JSON_LD_STRING)] : [];
    }
    return [];
  }
}

function isLikelyJavaScriptShell(html: string, markdown: string) {
  const meaningfulText = cleanText(markdown).length;
  const appRoot = /<(?:div|main|section)\b[^>]*(?:id|class)=["'][^"']*(?:app|root|__next|__nuxt)[^"']*["'][^>]*>\s*<\/?(?:div|main|section)[^>]*>\s*<\/?(?:div|main|section)[^>]*>/i.test(html);
  const scriptCount = Array.from(html.matchAll(/<script\b/gi)).length;
  const bodyBytes = Buffer.byteLength(html, "utf8");
  return meaningfulText < 160 && (appRoot || scriptCount >= 4 || bodyBytes > Math.max(2_000, meaningfulText * 30));
}

function metaContent(html: string, key: string, expected: string) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${key}=["']${escapeRegExp(expected)}["'][^>]*\\bcontent=["']([^"']*)["'][^>]*>`, "i");
  const reverse = new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b${key}=["']${escapeRegExp(expected)}["'][^>]*>`, "i");
  return (html.match(pattern)?.[1] ?? html.match(reverse)?.[1] ?? null)?.slice(0, MAX_METADATA_TEXT) ?? null;
}

function matchHtmlText(html: string, pattern: RegExp) {
  return html.match(pattern)?.[1] ?? null;
}

function attribute(value: string, name: string) {
  return value.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function stripInlineHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanText(value: string) {
  return redactSecretText(decodeHtmlEntities(value)).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(\d+)|#x([\da-f]+));/gi, (match, decimal: string, hexadecimal: string) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'", "&nbsp;": " " } as Record<string, string>)[match.toLowerCase()] ?? match;
  });
}

function canonicalQueueUrl(value: string) {
  return safeDurableDiscoveryLocator(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return redactSecretText(error.message.replace(/https?:\/\/\S+/gi, "[url]")).slice(0, 240) || fallback;
}

function unique(values: string[]) { return [...new Set(values)]; }

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Discovery was cancelled.");
}

async function emit(input: ProjectDiscoveryEngineInput, values: Omit<Progress, "runId" | "sourceId" | "sourceKind" | "message"> & { message?: string }) {
  await input.onProgress?.({
    runId: input.runId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    message: values.message ?? "Website discovery progress.",
    ...values
  });
}
