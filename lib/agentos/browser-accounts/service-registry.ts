import type {
  BrowserAccountRiskLevel,
  BrowserAuthenticationVerificationStrategy,
  BrowserAccountRuntimeLocation,
  BrowserServiceId
} from "@/lib/agentos/browser-accounts/types";

export type BrowserServiceAuthenticationDefinition = {
  ruleId: string;
  strategies: BrowserAuthenticationVerificationStrategy[];
  authenticatedSelector: string;
  loginSelector: string;
  authenticatedMarkers: string[];
  loginMarkers: string[];
  loginPathPatterns: RegExp[];
};

export type BrowserServiceDefinition = {
  id: Exclude<BrowserServiceId, "custom">;
  name: string;
  domains: string[];
  loginUrl: string;
  riskLevel: BrowserAccountRiskLevel;
  recommendedRuntime: BrowserAccountRuntimeLocation;
  recommendedProvider: "native-openclaw";
  authentication: BrowserServiceAuthenticationDefinition;
};

const definitions: readonly BrowserServiceDefinition[] = [
  {
    id: "github",
    name: "GitHub",
    domains: ["github.com"],
    loginUrl: "https://github.com/login",
    riskLevel: "standard",
    recommendedRuntime: "local",
    recommendedProvider: "native-openclaw",
    authentication: {
      ruleId: "github-session",
      strategies: ["dom_marker", "url_state"],
      authenticatedSelector: 'meta[name="user-login"][content]:not([content=""])',
      loginSelector: 'form[action*="/session"] input[name="password"]',
      authenticatedMarkers: ["user-login"],
      loginMarkers: ["/session", "password"],
      loginPathPatterns: [/\/login(?:\/|$)/i, /\/session(?:\/|$)/i]
    }
  },
  {
    id: "x",
    name: "X / Twitter",
    domains: ["x.com", "twitter.com"],
    loginUrl: "https://x.com/i/flow/login",
    riskLevel: "high",
    recommendedRuntime: "local",
    recommendedProvider: "native-openclaw",
    authentication: {
      ruleId: "x-session",
      strategies: ["dom_marker", "url_state"],
      authenticatedSelector: '[data-testid="AppTabBar_Profile_Link"], [data-testid="SideNav_AccountSwitcher_Button"]',
      loginSelector: '[data-testid="LoginForm_Login_Button"]',
      authenticatedMarkers: ["AppTabBar_Profile_Link", "SideNav_AccountSwitcher_Button"],
      loginMarkers: ["flow/login", "Log in"],
      loginPathPatterns: [/\/i\/flow\/login/i, /\/login(?:\/|$)/i]
    }
  },
  {
    id: "producthunt",
    name: "Product Hunt",
    domains: ["producthunt.com"],
    loginUrl: "https://www.producthunt.com/login",
    riskLevel: "high",
    recommendedRuntime: "local",
    recommendedProvider: "native-openclaw",
    authentication: {
      ruleId: "producthunt-session",
      strategies: ["dom_marker", "url_state"],
      authenticatedSelector: '[data-test="user-menu"], [aria-label*="User menu" i], a[href*="/logout"]',
      loginSelector: 'form[action*="login"], form[action*="sign-in"]',
      authenticatedMarkers: ["user-menu", "User menu", "logout"],
      loginMarkers: ["/login", "Sign in"],
      loginPathPatterns: [/\/login(?:\/|$)/i, /\/sign-in(?:\/|$)/i]
    }
  },
  {
    id: "amazon",
    name: "Amazon",
    domains: [
      "amazon.com",
      "amazon.ca",
      "amazon.com.au",
      "amazon.co.uk",
      "amazon.de",
      "amazon.fr",
      "amazon.it",
      "amazon.es",
      "amazon.co.jp",
      "amazon.in",
      "amazon.com.mx",
      "amazon.nl",
      "amazon.sg",
      "amazon.sa",
      "amazon.ae",
      "amazon.com.tr",
      "amazon.se",
      "amazon.pl",
      "amazon.com.be",
      "amazon.eg"
    ],
    loginUrl: "https://www.amazon.com/ap/signin",
    riskLevel: "high",
    recommendedRuntime: "local",
    recommendedProvider: "native-openclaw",
    authentication: {
      ruleId: "amazon-session",
      strategies: ["dom_marker", "url_state"],
      authenticatedSelector: '#nav-link-accountList:not([href*="/ap/signin"]), #nav-ya-signin',
      loginSelector: 'form[name="signIn"], form[action*="/ap/signin"]',
      authenticatedMarkers: ["nav-link-accountList"],
      loginMarkers: ["ap/signin", "nav-ya-signin", "Sign in"],
      loginPathPatterns: [/\/ap\/signin/i, /\/ap\/register/i]
    }
  }
] as const;

export function listBrowserServiceDefinitions() {
  return definitions;
}

export function getBrowserServiceDefinition(serviceId: string | null | undefined) {
  const normalized = serviceId?.trim().toLowerCase();
  return definitions.find((definition) => definition.id === normalized) ?? null;
}

export function resolveBrowserServiceForDomain(domain: string) {
  const normalized = normalizeDomainForLookup(domain);
  if (!normalized) return null;

  return definitions.find((definition) =>
    definition.domains.some((candidate) =>
      normalized === candidate || normalized.endsWith(`.${candidate}`)
    )
  ) ?? null;
}

export function inferBrowserServiceId(input: {
  serviceId?: string | null;
  serviceName?: string | null;
  primaryDomain?: string | null;
}): BrowserServiceId {
  const explicit = input.serviceId?.trim().toLowerCase();
  if (explicit === "github" || explicit === "x" || explicit === "producthunt" || explicit === "amazon") {
    return explicit;
  }

  const byDomain = input.primaryDomain ? resolveBrowserServiceForDomain(input.primaryDomain) : null;
  if (byDomain) return byDomain.id;

  const byName = input.serviceName?.trim().toLowerCase() ?? "";
  if (byName.includes("github")) return "github";
  if (byName === "x" || byName.includes("twitter")) return "x";
  if (byName.includes("product hunt")) return "producthunt";
  if (byName.includes("amazon")) return "amazon";
  return "custom";
}

export function isBrowserServiceDomain(serviceId: BrowserServiceId, domain: string) {
  if (serviceId === "custom") return true;
  const definition = getBrowserServiceDefinition(serviceId);
  const normalized = normalizeDomainForLookup(domain);
  return Boolean(
    definition &&
      normalized &&
      definition.domains.some((candidate) =>
        normalized === candidate || normalized.endsWith(`.${candidate}`)
      )
  );
}

function normalizeDomainForLookup(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/, 1)[0];
  return normalized.replace(/^\*\./, "").replace(/\.$/, "") || null;
}
