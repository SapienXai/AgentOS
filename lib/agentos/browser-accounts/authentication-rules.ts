export type BrowserAuthenticationRule = {
  id: string;
  domains: string[];
  authenticatedSelector: string;
  loginSelector: string;
};

const rules: BrowserAuthenticationRule[] = [
  {
    id: "github-session",
    domains: ["github.com"],
    authenticatedSelector: 'meta[name="user-login"][content]:not([content=""])',
    loginSelector: 'form[action*="/session"] input[name="password"]'
  }
];

export function resolveBrowserAuthenticationRule(allowedDomains: string[]) {
  const normalizedDomains = allowedDomains.map((domain) =>
    domain.trim().toLowerCase().replace(/^\*\./, "")
  );
  return rules.find((rule) =>
    rule.domains.some((domain) =>
      normalizedDomains.some((allowed) =>
        allowed === domain ||
        allowed.endsWith(`.${domain}`) ||
        domain.endsWith(`.${allowed}`)
      )
    )
  ) ?? null;
}
