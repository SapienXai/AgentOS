import type {
  BrowserAuthenticationVerificationStrategy,
  BrowserServiceId
} from "@/lib/agentos/browser-accounts/types";
import {
  getBrowserServiceDefinition,
  listBrowserServiceDefinitions,
  resolveBrowserServiceForDomain,
  type BrowserServiceDefinition
} from "@/lib/agentos/browser-accounts/service-registry";

export type BrowserAuthenticationRule = {
  id: string;
  serviceId: Exclude<BrowserServiceId, "custom">;
  domains: string[];
  strategies: BrowserAuthenticationVerificationStrategy[];
  authenticatedSelector: string;
  loginSelector: string;
  authenticatedMarkers: string[];
  loginMarkers: string[];
  loginPathPatterns: RegExp[];
};

export function resolveBrowserAuthenticationRule(
  allowedDomains: string[],
  serviceId?: BrowserServiceId | null
) {
  const explicit = serviceId && serviceId !== "custom"
    ? getBrowserServiceDefinition(serviceId)
    : null;
  if (explicit) return toAuthenticationRule(explicit);

  const normalizedDomains = allowedDomains.map((domain) =>
    domain.trim().toLowerCase().replace(/^\*\./, "")
  );
  const definition = listBrowserServiceDefinitions().find((service) =>
    service.domains.some((domain) =>
      normalizedDomains.some((allowed) =>
        allowed === domain ||
        allowed.endsWith(`.${domain}`) ||
        domain.endsWith(`.${allowed}`)
      )
    )
  );
  return definition ? toAuthenticationRule(definition) : null;
}

export function resolveBrowserAuthenticationRuleForService(
  serviceId: BrowserServiceId,
  primaryDomain?: string
) {
  if (serviceId !== "custom") {
    return resolveBrowserAuthenticationRule([], serviceId);
  }
  return primaryDomain
    ? resolveBrowserAuthenticationRule([primaryDomain])
    : null;
}

export function isKnownBrowserService(serviceId: string | null | undefined): serviceId is Exclude<BrowserServiceId, "custom"> {
  return Boolean(serviceId && getBrowserServiceDefinition(serviceId));
}

export function inferAuthenticationServiceForDomain(domain: string) {
  return resolveBrowserServiceForDomain(domain)?.id ?? "custom";
}

function toAuthenticationRule(definition: BrowserServiceDefinition): BrowserAuthenticationRule {
  return {
    id: definition.authentication.ruleId,
    serviceId: definition.id,
    domains: [...definition.domains],
    strategies: [...definition.authentication.strategies],
    authenticatedSelector: definition.authentication.authenticatedSelector,
    loginSelector: definition.authentication.loginSelector,
    authenticatedMarkers: [...definition.authentication.authenticatedMarkers],
    loginMarkers: [...definition.authentication.loginMarkers],
    loginPathPatterns: [...definition.authentication.loginPathPatterns]
  };
}
