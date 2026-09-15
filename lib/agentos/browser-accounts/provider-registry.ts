import "server-only";

import type { BrowserProvider } from "@/lib/agentos/browser-accounts/provider";
import type { BrowserAccountProviderId } from "@/lib/agentos/browser-accounts/types";
import { NativeOpenClawBrowserProvider } from "@/lib/agentos/browser-accounts/native-openclaw-provider";
import { SelfHostedOpenClawBrowserProvider } from "@/lib/agentos/browser-accounts/self-hosted-openclaw-provider";

let providerOverride: BrowserProvider | null = null;

export function getBrowserProvider(provider: BrowserAccountProviderId): BrowserProvider {
  if (providerOverride) {
    return providerOverride;
  }

  if (provider === "native-openclaw") {
    return new NativeOpenClawBrowserProvider();
  }

  if (provider === "self-hosted-openclaw") {
    return new SelfHostedOpenClawBrowserProvider();
  }

  throw new Error(
    `${provider} is an optional browser provider and is not configured in this AgentOS installation.`
  );
}

export function setBrowserProviderForTesting(provider: BrowserProvider | null) {
  providerOverride = provider;
}
