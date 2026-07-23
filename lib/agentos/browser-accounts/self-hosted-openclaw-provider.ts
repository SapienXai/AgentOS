import "server-only";

import { access } from "node:fs/promises";

import {
  createBrowserWorkerProfile,
  getBrowserWorkerHealth,
  inspectBrowserWorkerAuthentication,
  revokeBrowserWorkerProfile,
  startBrowserWorkerSession,
  stopBrowserWorkerSession
} from "@/lib/agentos/browser-accounts/browser-worker-client";
import { resolveBrowserAuthenticationRule } from "@/lib/agentos/browser-accounts/authentication-rules";
import type { BrowserProvider } from "@/lib/agentos/browser-accounts/provider";
import type { BrowserProviderCapabilities } from "@/lib/agentos/browser-accounts/types";

const defaultPolicyReadyPath = "/tmp/agentos-browser-policy.ready";

export class SelfHostedOpenClawBrowserProvider implements BrowserProvider {
  async getCapabilities(): Promise<BrowserProviderCapabilities> {
    try {
      await getBrowserWorkerHealth();
      const policyReady = await isPolicyPluginReady();
      return {
        provider: "self-hosted-openclaw",
        source: "self-hosted-worker",
        profileCreation: "supported",
        persistentProfiles: "supported",
        liveView: "supported",
        humanTakeover: "supported",
        typedTaskDispatch: policyReady ? "supported" : "unsupported",
        cdpExposure: "private",
        reason: policyReady
          ? "Secure manual login and task-bound OpenClaw browser policy are available through the self-hosted worker."
          : "Secure manual login is available, but the AgentOS OpenClaw browser policy plugin is not active. Agent task dispatch remains blocked."
      };
    } catch {
      return {
        provider: "self-hosted-openclaw",
        source: "unsupported",
        profileCreation: "unsupported",
        persistentProfiles: "unsupported",
        liveView: "unsupported",
        humanTakeover: "unsupported",
        typedTaskDispatch: "unsupported",
        cdpExposure: "private",
        reason: "The private self-hosted browser worker is unavailable."
      };
    }
  }

  async createProfile(input: { browserProfileId: string }) {
    const browserProfileId = normalizeProfileId(input.browserProfileId);
    await createBrowserWorkerProfile(browserProfileId);

    return {
      provider: "self-hosted-openclaw" as const,
      externalProfileId: null,
      browserProfileId,
      persistent: true,
      source: "self-hosted-worker" as const
    };
  }

  async startSession(input: { browserProfileId: string; initialUrl?: string }) {
    const browserProfileId = normalizeProfileId(input.browserProfileId);
    const session = await startBrowserWorkerSession({
      profileId: browserProfileId,
      initialUrl: input.initialUrl ?? "about:blank"
    });
    return {
      sessionId: session.sessionId,
      browserProfileId,
      state: "active" as const,
      runtimeConnection: {
        kind: "loopback-cdp" as const,
        cdpUrl: session.cdpUrl
      }
    };
  }

  async getLiveView(input: { sessionId: string }) {
    return {
      capabilityId: input.sessionId,
      expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      oneTime: true as const
    };
  }

  async getCdpEndpoint(): Promise<never> {
    throw new Error(
      "Raw CDP endpoints are intentionally not returned by AgentOS. OpenClaw browser control remains private behind the Gateway."
    );
  }

  async verifyAuthentication(input: { sessionId: string; allowedDomains: string[] }) {
    const rule = resolveBrowserAuthenticationRule(input.allowedDomains);
    if (!rule) {
      return { status: "unknown" as const, verifiedAt: null };
    }
    const inspection = await inspectBrowserWorkerAuthentication({
      sessionId: input.sessionId,
      allowedDomains: input.allowedDomains,
      authenticatedSelector: rule.authenticatedSelector,
      loginSelector: rule.loginSelector
    });
    if (inspection.state === "matched") {
      return {
        status: "verified" as const,
        verifiedAt: new Date().toISOString()
      };
    }
    if (inspection.state === "login-visible") {
      return { status: "needs_user_action" as const, verifiedAt: null };
    }
    if (inspection.state === "domain-mismatch") {
      return { status: "unverified" as const, verifiedAt: null };
    }
    return { status: "unknown" as const, verifiedAt: null };
  }

  async persistProfile(input: { browserProfileId: string }) {
    const browserProfileId = normalizeProfileId(input.browserProfileId);
    return {
      provider: "self-hosted-openclaw" as const,
      externalProfileId: null,
      browserProfileId,
      persistent: true,
      source: "self-hosted-worker" as const
    };
  }

  async stopSession(input: { sessionId: string }): Promise<void> {
    await stopBrowserWorkerSession(input.sessionId);
  }

  async revokeProfile(input: { browserProfileId: string }) {
    const browserProfileId = normalizeProfileId(input.browserProfileId);
    await revokeBrowserWorkerProfile(browserProfileId);
  }
}

async function isPolicyPluginReady() {
  const readyPath =
    process.env.AGENTOS_BROWSER_POLICY_READY_PATH?.trim() ||
    defaultPolicyReadyPath;
  try {
    await access(readyPath);
    return /^[A-Za-z0-9_-]{43,128}$/.test(
      process.env.AGENTOS_BROWSER_POLICY_TOKEN?.trim() ?? ""
    );
  } catch {
    return false;
  }
}

export function normalizeProfileId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^acct-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(normalized)) {
    throw new Error("Browser profile id is invalid.");
  }
  return normalized;
}
