import "server-only";

import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  resolveBrowserAuthenticationRule,
  type BrowserAuthenticationRule
} from "@/lib/agentos/browser-accounts/authentication-rules";
import type {
  BrowserAccountRuntimeLocation,
  BrowserProviderCapabilities,
  BrowserServiceId
} from "@/lib/agentos/browser-accounts/types";
import type { BrowserProvider } from "@/lib/agentos/browser-accounts/provider";
import {
  NativeOpenClawBrowserService,
  normalizeBrowserUrl,
  normalizeManagedProfileName
} from "@/lib/openclaw/application/native-browser-service";

const defaultPolicyReadyPath = "/tmp/agentos-browser-policy.ready";
const nativeProfileRuntimeLocation: BrowserAccountRuntimeLocation = "local";

/**
 * AgentOS' native provider is intentionally a thin control-plane adapter.
 * OpenClaw owns Chromium, the user-data directory, tabs, cookies, storage,
 * and graceful profile lifecycle. AgentOS receives only normalized profile and
 * authentication markers and never receives a CDP endpoint or raw cookie.
 */
export class NativeOpenClawBrowserProvider implements BrowserProvider {
  constructor(
    private readonly browser = new NativeOpenClawBrowserService()
  ) {}

  async getCapabilities(): Promise<BrowserProviderCapabilities> {
    try {
      await this.browser.listProfiles();
      const policyReady = await isPolicyPluginReady();
      return {
        provider: "native-openclaw",
        source: "native-openclaw",
        profileCreation: "supported",
        persistentProfiles: "supported",
        liveView: "unsupported",
        humanTakeover: "unsupported",
        typedTaskDispatch: policyReady ? "supported" : "unsupported",
        cdpExposure: "private",
        runtimeLocation: nativeProfileRuntimeLocation,
        reason: policyReady
          ? "OpenClaw native persistent profiles and task-bound browser policy are available. Interactive takeover is not advertised because OpenClaw's native screencast is view-only."
          : "OpenClaw native persistent profiles are available, but the AgentOS browser policy plugin is not active. Task dispatch remains blocked; interactive takeover is not advertised because OpenClaw's native screencast is view-only."
      };
    } catch {
      return unavailableCapabilities(
        "OpenClaw native browser.request is unavailable. Native account profiles remain unavailable until the Gateway exposes the 2026.9.4 browser profile surface. CLI fallback is disabled."
      );
    }
  }

  async createProfile(input: { browserProfileId: string }) {
    const browserProfileId = normalizeManagedProfileName(input.browserProfileId);
    await this.browser.createProfile(browserProfileId);
    return {
      provider: "native-openclaw" as const,
      runtimeProvider: "openclaw-managed" as const,
      externalProfileId: null,
      browserProfileId,
      persistent: true,
      source: "native-openclaw" as const,
      runtimeLocation: nativeProfileRuntimeLocation
    };
  }

  async startSession(input: { browserProfileId: string; initialUrl?: string }) {
    const browserProfileId = normalizeManagedProfileName(input.browserProfileId);
    await this.browser.startProfile(browserProfileId);
    try {
      if (input.initialUrl) {
        await this.browser.openTab(browserProfileId, normalizeBrowserUrl(input.initialUrl));
      }
    } catch (error) {
      await this.browser.stopProfile(browserProfileId).catch(() => null);
      throw error;
    }

    return {
      // OpenClaw's browser.request profile lifecycle has no AgentOS session id;
      // this opaque id is used only to fence the surrounding task binding.
      sessionId: randomUUID(),
      browserProfileId,
      state: "active" as const
    };
  }

  async getLiveView(): Promise<never> {
    throw new Error(
      "Interactive Live View is unavailable for native OpenClaw profiles. OpenClaw 2026.9.4 exposes a view-only screencast; no raw CDP transport is exposed by AgentOS."
    );
  }

  async getCdpEndpoint(): Promise<never> {
    throw new Error(
      "Raw CDP endpoints are intentionally not returned by AgentOS. Native OpenClaw browser control remains private behind the Gateway."
    );
  }

  async verifyAuthentication(input: {
    sessionId: string;
    browserProfileId?: string;
    allowedDomains: string[];
    serviceId?: BrowserServiceId;
  }) {
    // sessionId is an opaque AgentOS binding identity. The profile name is
    // required separately so a provider instance cannot infer or reuse a
    // different account after a process restart.
    void input.sessionId;
    if (!input.browserProfileId) {
      return { status: "unknown" as const, verifiedAt: null };
    }
    const profileName = normalizeManagedProfileName(input.browserProfileId);
    const rule = resolveBrowserAuthenticationRule(input.allowedDomains, input.serviceId);
    if (!rule) {
      return { status: "unknown" as const, verifiedAt: null };
    }

    const tabs = (await this.browser.listTabs(profileName)).filter((candidate) =>
      candidate.targetId && isAllowedUrl(candidate.url, input.allowedDomains)
    );
    if (tabs.length === 0) {
      return { status: "unknown" as const, verifiedAt: null };
    }

    const observations = [];
    for (const tab of tabs) {
      try {
        const snapshot = await this.browser.snapshot(profileName, tab.targetId!);
        observations.push({
          tab,
          snapshotText: safeSnapshotText(snapshot)
        });
      } catch {
        // A failed snapshot is not authentication evidence. Continue so a
        // second allowed tab can still provide a bounded provider signal.
      }
    }
    if (observations.length === 0) {
      return { status: "unknown" as const, verifiedAt: null };
    }

    // Login evidence wins across the whole profile. This avoids selecting an
    // arbitrary first tab and accidentally reporting an authenticated marker
    // from one tab while another tab is visibly on a login flow.
    if (observations.some(({ tab, snapshotText }) =>
      hasLoginMarker(rule, `${tab.url ?? ""} ${tab.title ?? ""}\n${snapshotText}`)
    )) {
      return { status: "needs_user_action" as const, verifiedAt: null };
    }
    if (observations.some(({ snapshotText }) => hasAuthenticatedMarker(rule, snapshotText))) {
      return {
        status: "verified" as const,
        verifiedAt: new Date().toISOString()
      };
    }
    return { status: "unknown" as const, verifiedAt: null };
  }

  async persistProfile(input: { sessionId: string; browserProfileId: string }) {
    void input.sessionId;
    const browserProfileId = normalizeManagedProfileName(input.browserProfileId);
    const profile = (await this.browser.listProfiles()).find((entry) => entry.name === browserProfileId);
    if (!profile) {
      throw new Error("The native OpenClaw browser profile no longer exists.");
    }
    return {
      provider: "native-openclaw" as const,
      runtimeProvider: "openclaw-managed" as const,
      externalProfileId: null,
      browserProfileId,
      persistent: true,
      source: "native-openclaw" as const,
      runtimeLocation: nativeProfileRuntimeLocation
    };
  }

  async stopSession(input: { sessionId: string; browserProfileId?: string }) {
    void input.sessionId;
    if (!input.browserProfileId) {
      throw new Error("The native OpenClaw profile is required to stop the browser session.");
    }
    await this.browser.stopProfile(normalizeManagedProfileName(input.browserProfileId));
  }

  async revokeProfile(input: { browserProfileId: string }) {
    const browserProfileId = normalizeManagedProfileName(input.browserProfileId);
    // OpenClaw owns the Chromium process. Ask it to stop gracefully before
    // deleting the durable profile; deletion remains the source of truth for
    // revoke and will report a cleanup failure if the Gateway cannot confirm it.
    await this.browser.stopProfile(browserProfileId).catch(() => null);
    await this.browser.deleteProfile(browserProfileId);
  }
}

function unavailableCapabilities(reason: string): BrowserProviderCapabilities {
  return {
    provider: "native-openclaw",
    source: "unsupported",
    profileCreation: "unsupported",
    persistentProfiles: "unsupported",
    liveView: "unsupported",
    humanTakeover: "unsupported",
    typedTaskDispatch: "unsupported",
    cdpExposure: "private",
    runtimeLocation: nativeProfileRuntimeLocation,
    reason
  };
}

async function isPolicyPluginReady() {
  const readyPath = process.env.AGENTOS_BROWSER_POLICY_READY_PATH?.trim() || defaultPolicyReadyPath;
  try {
    await access(readyPath);
    return /^[A-Za-z0-9_-]{43,128}$/.test(process.env.AGENTOS_BROWSER_POLICY_TOKEN?.trim() ?? "") &&
      /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/internal\/browser-policy\/heartbeat$/.test(
        process.env.AGENTOS_BROWSER_POLICY_HEARTBEAT_URL?.trim() ?? ""
      );
  } catch {
    return false;
  }
}

function hasAuthenticatedMarker(rule: BrowserAuthenticationRule, value: string) {
  const lower = value.toLowerCase();
  return rule.authenticatedMarkers.some((marker) => lower.includes(marker.toLowerCase()));
}

function hasLoginMarker(rule: BrowserAuthenticationRule, value: string) {
  const lower = value.toLowerCase();
  return rule.loginPathPatterns.some((pattern) => pattern.test(value)) ||
    rule.loginMarkers.some((marker) => lower.includes(marker.toLowerCase()));
}

function safeSnapshotText(value: unknown) {
  const parts: string[] = [];
  if (isRecord(value) && typeof value.snapshot === "string") {
    parts.push(value.snapshot);
  }
  if (isRecord(value) && isRecord(value.refs)) {
    for (const [ref, metadata] of Object.entries(value.refs)) {
      if (!isRecord(metadata)) continue;
      parts.push(ref, ...readEvidenceFields(metadata));
    }
  }
  if (isRecord(value) && Array.isArray(value.nodes)) {
    for (const node of value.nodes) {
      if (!isRecord(node)) continue;
      parts.push(...readEvidenceFields(node));
    }
  }
  return parts.filter(Boolean).join("\n").slice(0, 256_000);
}

function readEvidenceFields(value: Record<string, unknown>) {
  return ["role", "name", "value", "description", "text"]
    .map((key) => value[key])
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.slice(0, 2_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAllowedUrl(value: string | null, allowedDomains: string[]) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return allowedDomains.some((entry) => {
      const domain = entry.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}
