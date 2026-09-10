import type { KnowledgeWebsiteFetcher } from "@/lib/agentos/domains/workspace-knowledge-ingestion";

export type ProjectDiscoveryFixture = {
  rootUrl: string;
  pages: Record<string, { status?: number; headers?: Record<string, string>; body: string }>;
};

export const coinCollectProjectDiscoveryFixture: ProjectDiscoveryFixture = {
  rootUrl: "https://coincollect.org/",
  pages: {
    "https://coincollect.org/robots.txt": {
      body: "User-agent: *\nAllow: /\nSitemap: https://coincollect.org/sitemap.xml\n"
    },
    "https://coincollect.org/sitemap.xml": {
      headers: { "content-type": "application/xml" },
      body: "<urlset><url><loc>https://coincollect.org/product?utm_source=homepage</loc></url><url><loc>https://coincollect.org/whitepaper.pdf</loc></url><url><loc>https://docs.coincollect.org/guide</loc></url><url><loc>https://coincollect.org/product</loc></url></urlset>"
    },
    "https://coincollect.org/": {
      body: `<!doctype html><html><head>
        <title>CoinCollect Pro</title>
        <meta name="description" content="Payments and treasury tools for digital-asset businesses.">
        <meta property="og:site_name" content="CoinCollect">
        <meta property="og:title" content="CoinCollect Pro">
        <meta property="og:description" content="Collect, reconcile, and operate digital-asset payments.">
        <meta name="twitter:title" content="CoinCollect Pro">
        <link rel="canonical" href="https://coincollect.org/?utm_source=canonical">
        <script type="application/ld+json">{"@type":"SoftwareApplication","name":"CoinCollect Pro"}</script>
      </head><body>
        <nav><a href="/product">Product</a><a href="/product?utm_source=nav">Product again</a><a href="https://docs.coincollect.org/guide">Documentation</a><a href="https://app.coincollect.org/dashboard">Launch app</a></nav>
        <main><h1>CoinCollect Pro</h1><p>A fictional platform for public blockchain payment operations.</p><p>Network: Ethereum. Contract: 0x1111111111111111111111111111111111111111</p>
          <a href="mailto:hello@coincollect.org">Contact the team</a>
          <a href="https://github.com/coincollect/pro">Source repository</a>
          <a href="https://x.com/coincollect">Follow CoinCollect</a>
          <a href="https://whitepaper.example/coincollect.pdf">Whitepaper</a>
          <a href="https://coincollect.org/unsafe?token=never-store">Public page</a>
        </main>
        <footer><a href="/contact">Support</a><a href="https://discord.gg/coincollect">Community</a><a href="https://coincollect.org/product">Product duplicate</a></footer>
      </body></html>`
    },
    "https://coincollect.org/product": {
      body: "<main><h1>Product</h1><p>Automated collection, reconciliation, and treasury workflows.</p><a href='/about'>About CoinCollect</a></main>"
    },
    "https://coincollect.org/about": {
      body: "<main><h1>About</h1><p>CoinCollect helps finance teams operate public network payments.</p></main>"
    },
    "https://coincollect.org/contact": {
      body: "<main><h1>Contact</h1><p>Our support team can help with public product questions.</p><a href='mailto:support@coincollect.org'>Email support</a></main>"
    },
    "https://coincollect.org/whitepaper.pdf": {
      headers: { "content-type": "application/pdf" },
      body: "%PDF-1.7 public whitepaper candidate"
    },
    "https://docs.coincollect.org/guide": {
      body: "<html><head><title>CoinCollect Documentation</title><meta name='description' content='Developer and operator documentation.'></head><body><nav><a href='/api'>API reference</a></nav><article><h1>Getting started</h1><p>Integrate collection and reconciliation workflows.</p></article></body></html>"
    },
    "https://docs.coincollect.org/api": {
      body: "<article><h1>API reference</h1><p>Public API endpoints and webhook guidance.</p></article>"
    },
    "https://app.coincollect.org/dashboard": {
      body: "<main><h1>CoinCollect App</h1><p>Application entry point.</p></main>"
    }
  }
};

export const genericSaasProjectDiscoveryFixture: ProjectDiscoveryFixture = {
  rootUrl: "https://acme-saas.com/",
  pages: {
    "https://acme-saas.com/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://acme-saas.com/sitemap.xml": { body: "<not-a-sitemap" },
    "https://acme-saas.com/": {
      body: "<html><head><title>Acme SaaS</title><meta name='description' content='Workflow software for operations teams.'></head><body><main><h1>Acme SaaS</h1><p>Plan work, approvals, and reporting.</p><a href='/features'>Features</a></main></body></html>"
    },
    "https://acme-saas.com/features": {
      body: "<main><h1>Features</h1><p>Approvals and reporting for operations teams.</p></main>"
    }
  }
};

export const documentationHeavyProjectDiscoveryFixture: ProjectDiscoveryFixture = {
  rootUrl: "https://library.dev/",
  pages: {
    "https://library.dev/robots.txt": { body: "User-agent: *\nAllow: /\n" },
    "https://library.dev/sitemap.xml": { body: "<urlset><url><loc>https://docs.library.dev/overview</loc></url><url><loc>https://docs.library.dev/reference</loc></url></urlset>" },
    "https://library.dev/": {
      body: "<html><head><title>Library</title></head><body><main><h1>Library</h1><p>A general software library.</p><a href='https://docs.library.dev/overview'>Docs</a><a href='https://docs.library.dev/reference'>Reference</a></main></body></html>"
    },
    "https://docs.library.dev/overview": {
      body: "<article><h1>Overview</h1><p>Install and configure the library.</p><a href='/reference'>Reference</a></article>"
    },
    "https://docs.library.dev/reference": {
      body: "<article><h1>Reference</h1><p>API and configuration reference.</p></article>"
    }
  }
};

export function createProjectDiscoveryFixtureFetcher(fixture: ProjectDiscoveryFixture, calls: string[] = []): KnowledgeWebsiteFetcher {
  return {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url) => {
      calls.push(url);
      const page = fixture.pages[url];
      return page
        ? { status: page.status ?? 200, headers: page.headers ?? { "content-type": "text/html" }, body: page.body }
        : { status: 404, headers: { "content-type": "text/html" }, body: "Not found" };
    }
  };
}
