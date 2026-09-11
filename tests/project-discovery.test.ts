import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPublicAddresses,
  DEFAULT_KNOWLEDGE_INGESTION_LIMITS,
  ingestKnowledgeSources,
  type KnowledgeIngestionLimits
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { discoverProjectWebsite, ProjectDiscoverySourceByteBudget } from "@/lib/agentos/application/project-discovery-engine";
import {
  coinCollectProjectDiscoveryFixture,
  createProjectDiscoveryFixtureFetcher,
  documentationHeavyProjectDiscoveryFixture,
  genericSaasProjectDiscoveryFixture,
  sparseSpaProjectDiscoveryFixture
} from "@/tests/fixtures/project-discovery";
import {
  isSameProjectSiteFamily,
  classifyProjectDiscoveryCrawlPolicy,
  normalizeDiscoveryHttpUrl,
  registrableDomainForHostname,
  safeDisplayDiscoveryLocator,
  safeDurableDiscoveryLocator
} from "@/lib/agentos/domains/project-discovery";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { createOpenClawRenderedDiscoveryBrowser } from "@/lib/openclaw/application/browser-discovery-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

function limits(overrides: Partial<KnowledgeIngestionLimits> = {}): KnowledgeIngestionLimits {
  return { ...DEFAULT_KNOWLEDGE_INGESTION_LIMITS, ...overrides };
}

async function discover(fixture: typeof coinCollectProjectDiscoveryFixture, overrides: Partial<KnowledgeIngestionLimits> = {}, progress?: string[]) {
  return discoverProjectWebsite({
    runId: "discovery-test-run",
    sourceId: "website",
    sourceKind: "website",
    rootUrl: fixture.rootUrl,
    limits: limits(overrides),
    resolveHost: async () => ["93.184.216.34"],
    assertPublicAddresses,
    websiteFetcher: createProjectDiscoveryFixtureFetcher(fixture),
    onProgress: (event) => {
      if (event.currentLocator) progress?.push(event.currentLocator);
    }
  });
}

test("CoinCollect discovery finds useful first-party surfaces and preserves external candidates", async () => {
  const calls: string[] = [];
  const progress: string[] = [];
  const result = await discoverProjectWebsite({
    runId: "coincollect-run",
    sourceId: "coincollect",
    sourceKind: "website",
    rootUrl: coinCollectProjectDiscoveryFixture.rootUrl,
    limits: limits({ maxPagesPerSource: 12, maxDepth: 2, maxSitemaps: 4 }),
    resolveHost: async () => ["93.184.216.34"],
    assertPublicAddresses,
    websiteFetcher: createProjectDiscoveryFixtureFetcher(coinCollectProjectDiscoveryFixture, calls),
    onProgress: (event) => { if (event.currentLocator) progress.push(event.currentLocator); }
  });

  assert.equal(result.manifest.rootUrl, "https://coincollect.org/");
  assert.equal(result.manifest.registrableDomain, "coincollect.org");
  assert.ok(calls.includes("https://docs.coincollect.org/guide"));
  assert.ok(calls.includes("https://app.coincollect.org/dashboard"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.kind === "subdomain" && candidate.locator === "https://docs.coincollect.org/guide"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.kind === "subdomain" && candidate.locator === "https://app.coincollect.org/dashboard"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.locator === "https://coincollect.org/product" && candidate.relation === "navigation"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.relation === "repository" && candidate.locator === "https://github.com/coincollect/pro" && candidate.firstParty === false));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.relation === "social" && candidate.locator === "https://x.com/coincollect"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.kind === "document" && candidate.locator === "https://whitepaper.example/coincollect.pdf"));
  assert.ok(result.manifest.contacts.some((contact) => contact.kind === "email" && contact.value === "hello@coincollect.org"));
  assert.ok(result.manifest.contacts.some((contact) => contact.kind === "support-url" && contact.value === "https://coincollect.org/contact"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.locator === "https://coincollect.org/product" && candidate.fetchStatus === "fetched"));
  assert.ok(result.manifest.candidates.some((candidate) => candidate.locator === "https://docs.coincollect.org/guide" && candidate.discoveredFrom === "https://coincollect.org/"));
  assert.ok(calls.every((url) => !/github\.com|x\.com|whitepaper\.example/i.test(url)));
  assert.ok(progress.every((locator) => !/token=|utm_/i.test(locator)));
  assert.ok(result.manifest.candidates.every((candidate) => !/token=|utm_/i.test(candidate.locator)));
});

test("discovery is deterministic, general-purpose, and handles documentation-heavy subdomains", async () => {
  const first = await discover(coinCollectProjectDiscoveryFixture, { maxPagesPerSource: 12, maxDepth: 2, maxSitemaps: 4 });
  const second = await discover(coinCollectProjectDiscoveryFixture, { maxPagesPerSource: 12, maxDepth: 2, maxSitemaps: 4 });
  assert.deepEqual(first.manifest, second.manifest);

  const saas = await discover(genericSaasProjectDiscoveryFixture, { maxPagesPerSource: 4, maxDepth: 1 });
  assert.ok(saas.documents.some((page) => page.title === "Acme SaaS"));
  assert.ok(saas.documents.some((page) => page.content.includes("Approvals and reporting")));
  assert.equal(saas.warnings.length, 0);

  const docs = await discover(documentationHeavyProjectDiscoveryFixture, { maxPagesPerSource: 6, maxDepth: 1, maxSitemaps: 3 });
  assert.ok(docs.manifest.pages.some((page) => page.locator === "https://docs.library.dev/overview"));
  assert.ok(docs.manifest.pages.some((page) => page.locator === "https://docs.library.dev/reference"));
});

test("URL and site-family policy is public-suffix aware and rejects unsafe lookalikes", () => {
  assert.equal(registrableDomainForHostname("docs.example.co.uk"), "example.co.uk");
  assert.equal(isSameProjectSiteFamily("https://docs.example.co.uk/guide", "https://example.co.uk/"), true);
  assert.equal(isSameProjectSiteFamily("https://example.co.uk.evil.test/", "https://example.co.uk/"), false);
  assert.equal(isSameProjectSiteFamily("https://coincollect.org.evil.test/", "https://coincollect.org/"), false);
  assert.equal(normalizeDiscoveryHttpUrl("https://coincollect.org:443/product/?utm_source=nav#details").toString(), "https://coincollect.org/product");
  assert.equal(safeDurableDiscoveryLocator("https://coincollect.org/docs?version=v2&lang=en&utm_source=nav#guide"), "https://coincollect.org/docs?version=v2&lang=en");
  assert.equal(safeDisplayDiscoveryLocator("https://coincollect.org/docs?version=v2&lang=en#guide"), "https://coincollect.org/docs");
  assert.equal(safeDurableDiscoveryLocator("https://coincollect.org/docs?token=secret&api_key=secret"), "https://coincollect.org/docs");
  assert.equal(classifyProjectDiscoveryCrawlPolicy("https://docs.coincollect.org/guide", "https://coincollect.org/", "Documentation").disposition, "crawl");
  assert.equal(classifyProjectDiscoveryCrawlPolicy("https://app.coincollect.org/dashboard", "https://coincollect.org/").disposition, "shallow");
  assert.equal(classifyProjectDiscoveryCrawlPolicy("https://cdn.coincollect.org/assets/app.js", "https://coincollect.org/").disposition, "record-only");
  assert.equal(classifyProjectDiscoveryCrawlPolicy("https://evil.example/", "https://coincollect.org/").disposition, "blocked");
  assert.throws(() => normalizeDiscoveryHttpUrl("https://user:password@example.com/"), /credentials/i);
  assert.throws(() => assertPublicAddresses(["127.0.0.1"]), /blocked|non-public/i);
  assert.throws(() => assertPublicAddresses(["::1"]), /blocked|non-public/i);
});

test("shared source byte reservations bound concurrent website responses and release unused capacity", async () => {
  const budget = new ProjectDiscoverySourceByteBudget(1_500);
  const first = budget.reserve(1_000);
  const second = budget.reserve(1_000);
  assert.equal(first?.amount, 1_000);
  assert.equal(second?.amount, 500);
  assert.equal(budget.committed + budget.reserved <= budget.capacity, true);
  budget.settle(first!, 100);
  const third = budget.reserve(1_000);
  assert.equal(third?.amount, 900);
  budget.settleConservatively(second!);
  budget.settle(third!, 50);
  assert.equal(budget.committed, 650);
  assert.equal(budget.reserved, 0);

  const accepted: number[] = [];
  const fixture = {
    rootUrl: "https://bounded.example/",
    pages: {
      "https://bounded.example/robots.txt": { body: "User-agent: *\nAllow: /\n" },
      "https://bounded.example/sitemap.xml": { body: "<urlset></urlset>" },
      "https://bounded.example/": { body: "<main><a href='/one'>One</a><a href='/two'>Two</a></main>" },
      "https://bounded.example/one": { body: "x".repeat(600) },
      "https://bounded.example/two": { body: "y".repeat(600) }
    }
  } as const;
  const result = await discoverProjectWebsite({
    runId: "byte-budget-test",
    sourceId: "bounded",
    sourceKind: "website",
    rootUrl: fixture.rootUrl,
    limits: limits({ maxPagesPerSource: 3, maxDepth: 1, maxSitemaps: 1, maxConcurrentRequests: 2, maxBytesPerDocument: 1_000, maxTotalBytesPerSource: 1_500 }),
    resolveHost: async () => ["93.184.216.34"],
    assertPublicAddresses,
    websiteFetcher: {
      resolve: async () => ["93.184.216.34"],
      fetch: async (url, options) => {
        const page = fixture.pages[url as keyof typeof fixture.pages];
        const body = page?.body ?? "Not found";
        accepted.push(Math.min(Buffer.byteLength(body), options.maxBytes));
        return { status: page ? 200 : 404, headers: { "content-type": "text/html" }, body };
      }
    }
  });
  assert.ok(accepted.reduce((sum, value) => sum + value, 0) <= 1_500);
  assert.ok(result.warnings.length > 0 || result.documents.length < 3);
  assert.ok(result.manifest.pages.length <= 3);
});

test("bounded JSON-LD yields ordinary observations and first-party policy controls links", async () => {
  const fixture = {
    rootUrl: "https://jsonld.example/",
    pages: {
      "https://jsonld.example/robots.txt": { body: "User-agent: *\nAllow: /\n" },
      "https://jsonld.example/sitemap.xml": { body: "<urlset></urlset>" },
      "https://jsonld.example/": { body: `<html><head><title>JSONLD Product</title><script type="application/ld+json">${JSON.stringify({ "@type": ["SoftwareApplication"], name: "JSONLD Product", legalName: "JSONLD Holdings", url: "https://jsonld.example/", sameAs: ["https://github.com/example/project"], softwareHelp: { url: "https://docs.jsonld.example/guide" }, applicationCategory: "Operations", operatingSystem: "Web", email: "hello@jsonld.example" })}</script></head><body><main>Product</main></body></html>` },
      "https://docs.jsonld.example/guide": { body: "<article><h1>Guide</h1><p>Install the product.</p></article>" }
    }
  } as const;
  const result = await discoverProjectWebsite({
    runId: "jsonld-test",
    sourceId: "jsonld",
    sourceKind: "website",
    rootUrl: fixture.rootUrl,
    limits: limits({ maxPagesPerSource: 4, maxDepth: 1, maxSitemaps: 1 }),
    resolveHost: async () => ["93.184.216.34"],
    assertPublicAddresses,
    websiteFetcher: {
      resolve: async () => ["93.184.216.34"],
      fetch: async (url) => {
        const page = fixture.pages[url as keyof typeof fixture.pages];
        return { status: page ? 200 : 404, headers: { "content-type": "text/html" }, body: page?.body ?? "Not found" };
      }
    }
  });
  const root = result.manifest.pages.find((page) => page.locator === "https://jsonld.example/");
  assert.ok(root);
  assert.deepEqual(root.metadata.jsonLdNames, ["JSONLD Product"]);
  assert.deepEqual(root.metadata.jsonLdLegalNames, ["JSONLD Holdings"]);
  assert.deepEqual(root.metadata.jsonLdApplicationCategories, ["Operations"]);
  assert.deepEqual(root.metadata.jsonLdOperatingSystems, ["Web"]);
  assert.ok(result.manifest.candidates.some((entry) => entry.relation === "documentation" && entry.locator === "https://docs.jsonld.example/guide"));
  assert.ok(result.manifest.candidates.some((entry) => entry.relation === "repository" && entry.locator === "https://github.com/example/project" && entry.firstParty === false));
  assert.ok(result.manifest.contacts.some((entry) => entry.kind === "email" && entry.value === "hello@jsonld.example"));
});

test("malformed and low-information source material stays bounded and explicit", async () => {
  const shell = {
    rootUrl: "https://shell.example/",
    pages: {
      "https://shell.example/robots.txt": { body: "not: valid robots\nSitemap: https://shell.example/sitemap.xml" },
      "https://shell.example/sitemap.xml": { body: "<sitemapindex><sitemap><loc>not a url</loc></sitemap>" },
      "https://shell.example/": { body: `<html><head><script type="application/ld+json">${"{".padEnd(70_000, "x")}</script></head><body><div id="root"></div><script src="/app.js"></script><script src="/vendor.js"></script><script src="/runtime.js"></script><script src="/chunk.js"></script></body></html>` }
    }
  } as const;
  const result = await discover(shell, { maxPagesPerSource: 2, maxBytesPerDocument: 80_000, maxSitemaps: 1 });
  assert.ok(result.manifest.warnings.some((warning) => /JavaScript shell|rendering fallback/i.test(warning)));
  assert.ok(result.manifest.pages.length <= 2);
});

test("sparse SPA discovery uses a bounded rendered fallback capability and records quality reasons", async () => {
  const result = await discoverProjectWebsite({
    runId: "rendered-fallback-test",
    sourceId: "rendered-spa",
    sourceKind: "website",
    rootUrl: sparseSpaProjectDiscoveryFixture.rootUrl,
    limits: limits({ maxPagesPerSource: 2, maxDepth: 1, maxSitemaps: 1 }),
    resolveHost: async () => ["93.184.216.34"],
    assertPublicAddresses,
    websiteFetcher: createProjectDiscoveryFixtureFetcher(sparseSpaProjectDiscoveryFixture),
    renderedBrowser: {
      inspect: async () => ({
        url: sparseSpaProjectDiscoveryFixture.rootUrl,
        title: "Rendered App",
        text: "Rendered App documentation and product overview.",
        links: [{ url: "https://rendered-app.example/docs", label: "Documentation" }]
      })
    }
  });
  assert.equal(result.manifest.renderedFallback, "used");
  assert.equal(result.manifest.quality, "good");
  assert.ok(result.manifest.qualityReasons.includes("content-shell"));
  assert.ok(result.manifest.qualityReasons.includes("rendered-fallback-used"));
  assert.ok(result.documents.some((document) => document.content.includes("Rendered App documentation")));
});

test("rendered discovery uses the existing OpenClaw browser.request boundary and closes its tab", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const adapter = {
    call: async (_method: string, params: { method: string; path: string }) => {
      calls.push({ method: params.method, path: params.path });
      if (params.path === "/tabs/open") return { tabId: "discovery-tab" };
      if (params.path === "/snapshot") return { snapshot: "CoinCollect dashboard https://coincollect.example/docs" };
      return {};
    }
  } as unknown as OpenClawAdapter;
  const browser = createOpenClawRenderedDiscoveryBrowser({ adapter });
  const rendered = await browser.inspect({ url: "https://coincollect.example/", timeoutMs: 20_000, maxChars: 2_000 });

  assert.equal(rendered.text, "CoinCollect dashboard https://coincollect.example/docs");
  assert.deepEqual(rendered.links, [{ url: "https://coincollect.example/docs", label: null }]);
  assert.deepEqual(calls, [
    { method: "POST", path: "/tabs/open" },
    { method: "GET", path: "/snapshot" },
    { method: "DELETE", path: "/tabs/discovery-tab" }
  ]);
});

test("website discovery keeps the existing ingestion corpus and persists a bounded manifest", async () => {
  const root = "/tmp/agentos-project-discovery-test-do-not-use-in-production";
  const source = createWorkspaceKnowledgeSource({
    id: "coincollect",
    kind: "website",
    label: "CoinCollect",
    summary: "Project website",
    locator: { kind: "website", url: coinCollectProjectDiscoveryFixture.rootUrl },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
  const corpusRoot = `${root}/knowledge`;
  const stateRoot = `${root}/state`;
  try {
    const result = await ingestKnowledgeSources({
      sources: [source],
      corpusRoot,
      stateRoot,
      limits: { maxPagesPerSource: 6, maxDepth: 1 },
      websiteFetcher: createProjectDiscoveryFixtureFetcher(coinCollectProjectDiscoveryFixture)
    });
    assert.ok(result.state.discoveryManifests?.some((manifest) => manifest.sourceId === "coincollect"));
    assert.ok(result.documents.length > 0);
  } finally {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  }
});
