import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertPublicAddresses,
  DEFAULT_KNOWLEDGE_INGESTION_LIMITS,
  ingestKnowledgeSources,
  type KnowledgeIngestionLimits
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { discoverProjectWebsite } from "@/lib/agentos/application/project-discovery-engine";
import {
  coinCollectProjectDiscoveryFixture,
  createProjectDiscoveryFixtureFetcher,
  documentationHeavyProjectDiscoveryFixture,
  genericSaasProjectDiscoveryFixture
} from "@/tests/fixtures/project-discovery";
import {
  isSameProjectSiteFamily,
  normalizeDiscoveryHttpUrl,
  registrableDomainForHostname
} from "@/lib/agentos/domains/project-discovery";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";

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
  assert.throws(() => normalizeDiscoveryHttpUrl("https://user:password@example.com/"), /credentials/i);
  assert.throws(() => assertPublicAddresses(["127.0.0.1"]), /blocked|non-public/i);
  assert.throws(() => assertPublicAddresses(["::1"]), /blocked|non-public/i);
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
