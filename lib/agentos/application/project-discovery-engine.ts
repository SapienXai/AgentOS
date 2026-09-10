import { createHash } from "node:crypto";

import { redactSecretText } from "@/lib/security/redaction";
import type {
  KnowledgeHostResolver,
  KnowledgeIngestionLimits,
  KnowledgeWebsiteFetcher
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  classifyDiscoveryRelation,
  isLikelyDocumentUrl,
  isLikelySocialUrl,
  isSameProjectSiteFamily,
  normalizeDiscoveryHttpUrl,
  PROJECT_DISCOVERY_SCHEMA_VERSION,
  registrableDomainForHostname,
  safeDiscoveryLocator,
  type ProjectDiscoveryCandidate,
  type ProjectDiscoveryContactCandidate,
  type ProjectDiscoveryManifest,
  type ProjectDiscoveryPage,
  type ProjectDiscoveryRelation
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
};

type RobotsPolicy = { disallow: string[]; sitemaps: string[] };

const MAX_METADATA_TEXT = 500;
const MAX_JSON_LD_BYTES = 64_000;
const MAX_DISCOVERY_CANDIDATES = 256;
const MAX_DISCOVERY_CONTACTS = 64;
const MAX_SITEMAP_LOCATIONS = 256;

export async function discoverProjectWebsite(input: ProjectDiscoveryEngineInput): Promise<ProjectDiscoveryEngineResult> {
  const root = normalizeDiscoveryHttpUrl(input.rootUrl);
  const rootHost = root.hostname.toLowerCase();
  const registrableDomain = registrableDomainForHostname(rootHost);
  const queue: QueueEntry[] = [{ url: root.toString(), discoveredFrom: null, relation: "reference", label: null, depth: 0, firstParty: "root", priority: 10_000 }];
  const queued = new Set<string>([canonicalQueueUrl(root.toString())]);
  const fetched = new Set<string>();
  const contentHashes = new Set<string>();
  const pages: ProjectDiscoveryPage[] = [];
  const candidates: ProjectDiscoveryCandidate[] = [];
  const contacts: ProjectDiscoveryContactCandidate[] = [];
  const documents: ProjectDiscoveryFetchedPage[] = [];
  const warnings: string[] = [];
  const robotsByHost = new Map<string, RobotsPolicy>();
  let bytesFetched = 0;
  let discoveredItems = 1;
  let fetchedItems = 0;
  let skippedItems = 0;

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

  const rootRobots = await readRobots(input, root, rootHost, bytesFetched);
  bytesFetched = rootRobots.bytesFetched;
  robotsByHost.set(rootHost, rootRobots.policy);
  for (const sitemapUrl of rootRobots.policy.sitemaps) {
    enqueueSitemapCandidate(sitemapUrl, root.toString());
  }
  enqueueSitemapCandidate(new URL("/sitemap.xml", root).toString(), root.toString());

  const sitemapResult = await discoverSitemapCandidates({ input, root, rootHost, queue, queued, robotsByHost, declaredSitemaps: rootRobots.policy.sitemaps, bytesFetched, warnings, candidates });
  bytesFetched = sitemapResult.bytesFetched;
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
    const results = await Promise.all(batch.map((entry) => fetchDiscoveryPage(input, entry, root, rootHost, registrableDomain, robotsByHost, bytesFetched)));
    for (const result of results) {
      bytesFetched = result.bytesFetched;
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
        if (discovered.depth > input.limits.maxDepth) continue;
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
  const manifest: ProjectDiscoveryManifest = {
    schemaVersion: PROJECT_DISCOVERY_SCHEMA_VERSION,
    sourceId: input.sourceId,
    rootUrl: safeDiscoveryLocator(root.toString()),
    registrableDomain,
    pages: pages.slice(0, input.limits.maxPagesPerSource),
    candidates: candidates.map((entry) => {
      const page = pages.find((value) => value.locator === entry.locator);
      return page ? { ...entry, fetchStatus: page.fetchStatus } : entry;
    }).slice(0, MAX_DISCOVERY_CANDIDATES),
    contacts: contacts.slice(0, MAX_DISCOVERY_CONTACTS),
    warnings: unique(warnings).slice(0, 32),
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
      if (!isSameProjectSiteFamily(url.toString(), root.toString())) return;
      addBoundedCandidate(candidates, candidate("sitemap", url.toString(), discoveredFrom, "sitemap", "Sitemap", true, 0, "queued", "application/xml"));
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
  bytesFetched: number;
  warnings: string[];
  candidates: ProjectDiscoveryCandidate[];
}) {
  let bytesFetched = input.bytesFetched;
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
    const response = await fetchDiscoveryResource(input.input, url.toString(), input.rootHost, input.root, bytesFetched);
    bytesFetched = response.bytesFetched;
    if (response.response.status < 200 || response.response.status >= 300) continue;
    const locations = parseSitemapLocations(response.response.body).slice(0, MAX_SITEMAP_LOCATIONS);
    const isIndex = /<sitemapindex\b/i.test(response.response.body);
    for (const location of locations) {
      try {
        const candidateUrl = normalizeDiscoveryHttpUrl(location);
        if (!isSameProjectSiteFamily(candidateUrl.toString(), input.root.toString())) continue;
        if (isIndex && visited.size < input.input.limits.maxSitemaps) {
          sitemapQueue.push(candidateUrl.toString());
          continue;
        }
        const candidateKey = canonicalQueueUrl(candidateUrl.toString());
        if (input.queued.has(candidateKey)) continue;
        input.queued.add(candidateKey);
        const firstParty = candidateUrl.hostname.toLowerCase() === input.rootHost ? "root" : "subdomain";
        addBoundedCandidate(input.candidates, candidate("page", candidateUrl.toString(), safeDiscoveryLocator(url.toString()), "sitemap", "Sitemap", true, 0, "queued", null));
        input.queue.push({ url: candidateUrl.toString(), discoveredFrom: safeDiscoveryLocator(url.toString()), relation: "sitemap", label: "Sitemap", depth: 0, firstParty, priority: 7_500 + pagePriority(candidateUrl.toString(), "Sitemap") });
        discoveredItems += 1;
      } catch {
        // Ignore malformed sitemap locations.
      }
    }
  }
  return { bytesFetched, discoveredItems };
}

async function fetchDiscoveryPage(
  input: ProjectDiscoveryEngineInput,
  entry: QueueEntry,
  root: URL,
  rootHost: string,
  registrableDomain: string | null,
  robotsByHost: Map<string, RobotsPolicy>,
  bytesFetched: number
) {
  const requestedUrl = normalizeDiscoveryHttpUrl(entry.url);
  const locator = safeDiscoveryLocator(requestedUrl.toString());
  const firstParty = requestedUrl.hostname.toLowerCase() === rootHost ? "root" : "subdomain";
  const basePage = (overrides: Partial<ProjectDiscoveryPage> = {}): ProjectDiscoveryPage => ({
    requestedUrl: locator,
    finalUrl: null,
    canonicalUrl: null,
    locator,
    discoveredFrom: entry.discoveredFrom ? safeDiscoveryLocator(entry.discoveredFrom) : null,
    depth: entry.depth,
    firstParty,
    fetchStatus: "queued",
    statusCode: null,
    contentType: null,
    title: null,
    metadata: { description: null, siteName: null, openGraphTitle: null, openGraphDescription: null, twitterTitle: null, jsonLdTypes: [] },
    discoveredLinkCount: 0,
    contentHash: null,
    contentLength: 0,
    warnings: [],
    ...overrides
  });

  if (!registrableDomain || registrableDomainForHostname(requestedUrl.hostname) !== registrableDomain || !isSameProjectSiteFamily(requestedUrl.toString(), root.toString())) {
    return { page: basePage({ fetchStatus: "blocked", warnings: ["Website page was outside the first-party site family."] }), candidates: [], contacts: [], discovered: [], document: null, bytesFetched };
  }
  const robots = await getRobots(input, requestedUrl, robotsByHost, bytesFetched);
  bytesFetched = robots.bytesFetched;
  if (robots.policy.disallow.some((prefix) => requestedUrl.pathname.startsWith(prefix))) {
    return { page: basePage({ fetchStatus: "blocked", warnings: ["Website page was disallowed by robots.txt."] }), candidates: [], contacts: [], discovered: [], document: null, bytesFetched };
  }
  try {
    const response = await fetchDiscoveryResource(input, requestedUrl.toString(), rootHost, root, bytesFetched);
    bytesFetched = response.bytesFetched;
    const responseUrl = normalizeDiscoveryHttpUrl(response.response.finalUrl ?? requestedUrl.toString());
    const contentType = response.response.headers["content-type"] ?? null;
    const base = basePage({
      finalUrl: safeDiscoveryLocator(responseUrl.toString()),
      locator: safeDiscoveryLocator(responseUrl.toString()),
      statusCode: response.response.status,
      contentType
    });
    if (response.response.status < 200 || response.response.status >= 300) {
      return { page: { ...base, fetchStatus: "failed" as const, warnings: [`Website page returned HTTP ${response.response.status}.`] }, candidates: [], contacts: [], discovered: [], document: null, bytesFetched };
    }
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const documentCandidate = isLikelyDocumentUrl(responseUrl.toString())
        ? [candidate("document", responseUrl.toString(), entry.discoveredFrom ?? root.toString(), classifyDiscoveryRelation(entry.label, responseUrl.toString()), entry.label, true, entry.depth, "skipped", contentType)]
        : [];
      return { page: { ...base, fetchStatus: "skipped" as const, warnings: ["Non-HTML resource recorded as a discovery candidate."] }, candidates: documentCandidate, contacts: [], discovered: [], document: null, bytesFetched };
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
      canonicalUrl: canonicalUrl ? safeDiscoveryLocator(canonicalUrl) : null,
      locator: safeDiscoveryLocator(canonicalUrl),
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
    const sourceLocator = safeDiscoveryLocator(canonicalUrl);
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
      const linkCandidate = candidate(
        candidateKind,
        discoveredUrl,
        sourceLocator,
        relation,
        anchor.label,
        sameFamily,
        entry.depth + 1,
        sameFamily && shouldQueueSubdomain(discoveredUrl, anchor.label) ? "queued" : "skipped",
        null
      );
      addBoundedCandidate(candidates, linkCandidate);
      if (sameFamily && (relation === "contact" || relation === "support")) {
        contacts.push({ kind: "support-url", value: discoveredUrl, discoveredFrom: sourceLocator, label: anchor.label });
      }
      if (/^mailto:/i.test(anchor.href)) continue;
      if (/^tel:/i.test(anchor.href)) continue;
      if (!sameFamily) continue;
      const target = new URL(discoveredUrl);
      const targetFirstParty = sameHost ? "root" : "subdomain";
      if (entry.depth + 1 > input.limits.maxDepth) continue;
      if (!sameHost && !shouldQueueSubdomain(discoveredUrl, anchor.label)) continue;
      discovered.push({
        url: target.toString(),
        discoveredFrom: sourceLocator,
        relation,
        label: anchor.label,
        depth: entry.depth + 1,
        firstParty: targetFirstParty,
        priority: pagePriority(target.toString(), anchor.label)
      });
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
    return { page, candidates, contacts: allContacts, discovered, document, bytesFetched };
  } catch (error) {
    return { page: basePage({ fetchStatus: "failed", warnings: [safeError(error, "Website page could not be fetched.")] }), candidates: [], contacts: [], discovered: [], document: null, bytesFetched };
  }
}

async function fetchDiscoveryResource(input: ProjectDiscoveryEngineInput, requestedUrl: string, rootHost: string, root: URL, bytesFetched: number) {
  let current = normalizeDiscoveryHttpUrl(requestedUrl);
  for (let redirect = 0; redirect <= input.limits.maxRedirects; redirect += 1) {
    throwIfAborted(input.signal);
    if (!isSameProjectSiteFamily(current.toString(), root.toString())) throw new Error("Website page request left the first-party host scope.");
    const addresses = await input.resolveHost(current.hostname);
    input.assertPublicAddresses(addresses);
    const remaining = input.limits.maxTotalBytesPerSource - bytesFetched;
    if (remaining <= 0) throw new Error("Website source byte limit reached.");
    const maxBytes = Math.min(input.limits.maxBytesPerDocument, remaining);
    const response = await input.websiteFetcher.fetch(current.toString(), {
      maxBytes,
      timeoutMs: input.limits.requestTimeoutMs,
      signal: input.signal,
      resolvedAddresses: addresses
    });
    const responseBytes = Buffer.byteLength(response.body, "utf8");
    if (responseBytes > maxBytes) throw new Error("Website document byte limit reached.");
    bytesFetched += responseBytes;
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
    return { response: { ...response, finalUrl: reportedFinalUrl.toString() }, bytesFetched };
  }
  throw new Error("Website redirect limit reached.");
}

async function readRobots(input: ProjectDiscoveryEngineInput, root: URL, host: string, bytesFetched: number) {
  try {
    const response = await fetchDiscoveryResource(input, new URL("/robots.txt", root).toString(), host, root, bytesFetched);
    bytesFetched = response.bytesFetched;
    if (response.response.status < 200 || response.response.status >= 300) return { policy: { disallow: [], sitemaps: [] } as RobotsPolicy, bytesFetched };
    const disallow: string[] = [];
    const sitemaps: string[] = [];
    let active = false;
    for (const line of response.response.body.split(/\r?\n/).slice(0, 400)) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") active = value === "*";
      else if (active && key === "disallow" && value) disallow.push(value.slice(0, 200));
      else if (key === "sitemap" && value && isSameProjectSiteFamily(value, root.toString())) sitemaps.push(normalizeDiscoveryHttpUrl(value).toString());
    }
    return { policy: { disallow: unique(disallow), sitemaps: unique(sitemaps) }, bytesFetched };
  } catch {
    return { policy: { disallow: [], sitemaps: [] } as RobotsPolicy, bytesFetched };
  }
}

async function getRobots(input: ProjectDiscoveryEngineInput, url: URL, cache: Map<string, RobotsPolicy>, bytesFetched: number) {
  const host = url.hostname.toLowerCase();
  const cached = cache.get(host);
  if (cached) return { policy: cached, bytesFetched };
  const result = await readRobots(input, url, host, bytesFetched);
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
    jsonLdTypes: parseJsonLdTypes(html)
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
  return { title: title ? cleanText(title).slice(0, MAX_METADATA_TEXT) : null, canonicalUrl, metadata, anchors, contacts, markdown: decodeHtmlEntities(markdown), jsonLdTypes: metadata.jsonLdTypes };
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

function shouldQueueSubdomain(url: string, label: string | null) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const first = host.split(".")[0] ?? "";
    if (["status", "cdn", "assets", "static", "images", "mail", "tracking"].includes(first)) return false;
    if (["app", "www", "blog"].includes(first)) return true;
    return ["docs", "doc", "documentation", "developer", "developers", "api", "help", "support"].includes(first)
      || /docs?|documentation|developer|api|help|support/i.test(label ?? "");
  } catch {
    return false;
  }
}

function pagePriority(url: string, label: string | null) {
  const value = `${url} ${label ?? ""}`.toLowerCase();
  let score = 100;
  if (/docs?|documentation|developer|api|product|features|about|company|contact|support|whitepaper|security|architecture|integration|faq/.test(value)) score += 500;
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
  return { kind, locator: kind === "contact" ? safeContactLocator(locator) : safeDiscoveryLocator(locator), discoveredFrom: safeDiscoveryLocator(discoveredFrom), relation, label: label ? cleanText(label).slice(0, 200) : null, firstParty, depth, fetchStatus, contentType };
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

function parseJsonLdTypes(html: string) {
  const result: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1].slice(0, MAX_JSON_LD_BYTES);
    try {
      const parsed: unknown = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed.slice(0, 16) : [parsed];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const type = (entry as Record<string, unknown>)["@type"];
        if (typeof type === "string") result.push(type.slice(0, 80));
        if (Array.isArray(type)) result.push(...type.filter((value): value is string => typeof value === "string").slice(0, 16).map((value) => value.slice(0, 80)));
      }
    } catch {
      // Malformed JSON-LD remains an ignored discovery signal.
    }
  }
  return unique(result).slice(0, 16);
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
  try { return normalizeDiscoveryHttpUrl(value).toString(); } catch { return value; }
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
