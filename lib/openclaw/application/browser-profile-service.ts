import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawBrowserDriver,
  OpenClawBrowserProfileMutationResponse,
  OpenClawBrowserProfilesResponse,
  OpenClawBrowserProfileView,
  OpenClawBrowserTabView,
  OpenClawBrowserTransport
} from "@/lib/openclaw/browser-profile-types";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

type BrowserRequestParams = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

type RawBrowserProfile = {
  name?: unknown;
  driver?: unknown;
  transport?: unknown;
  cdpPort?: unknown;
  cdpUrl?: unknown;
  color?: unknown;
  running?: unknown;
  tabCount?: unknown;
  isDefault?: unknown;
  isRemote?: unknown;
  missingFromConfig?: unknown;
  reconcileReason?: unknown;
};

type RawBrowserTab = {
  tabId?: unknown;
  targetId?: unknown;
  suggestedTargetId?: unknown;
  label?: unknown;
  title?: unknown;
  url?: unknown;
};

const browserRequestTimeoutMs = 15_000;
const managedProfileColor = "#2563eb";

export async function listOpenClawBrowserProfiles(): Promise<OpenClawBrowserProfilesResponse> {
  const payload = await callBrowserRequest<{ profiles?: unknown[] }>({
    method: "GET",
    path: "/profiles",
    timeoutMs: browserRequestTimeoutMs
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "openclaw.browser.request",
    profiles: Array.isArray(payload.profiles)
      ? payload.profiles.map((profile) => normalizeBrowserProfile(profile)).filter(isBrowserProfileView)
      : []
  };
}

export async function startOpenClawBrowserProfile(input: {
  profileName: string;
}): Promise<OpenClawBrowserProfileMutationResponse> {
  const profileName = normalizeExistingProfileName(input.profileName);

  await callBrowserRequest({
    method: "POST",
    path: "/start",
    query: { profile: profileName },
    timeoutMs: browserRequestTimeoutMs
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "openclaw.browser.request"
  };
}

export async function openLoginUrlInOpenClawBrowserProfile(input: {
  profileName: string;
  loginUrl: string;
  label?: string;
}): Promise<OpenClawBrowserProfileMutationResponse> {
  const profileName = normalizeExistingProfileName(input.profileName);
  const loginUrl = normalizeLoginUrl(input.loginUrl);
  const label = normalizeOptionalLabel(input.label);
  const tab = await callBrowserRequest<unknown>({
    method: "POST",
    path: "/tabs/open",
    query: { profile: profileName },
    body: {
      url: loginUrl,
      ...(label ? { label } : {})
    },
    timeoutMs: browserRequestTimeoutMs
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "openclaw.browser.request",
    tab: normalizeBrowserTab(tab)
  };
}

async function callBrowserRequest<TPayload>(params: BrowserRequestParams): Promise<TPayload> {
  try {
    return await getOpenClawAdapter().call<TPayload>(
      "browser.request",
      {
        method: params.method,
        path: params.path,
        ...(params.query ? { query: params.query } : {}),
        ...(params.body ? { body: params.body } : {}),
        ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {})
      },
      { timeoutMs: params.timeoutMs ?? browserRequestTimeoutMs }
    );
  } catch (error) {
    throw new Error(normalizeBrowserRequestErrorMessage(error, params));
  }
}

function normalizeBrowserRequestErrorMessage(error: unknown, params: BrowserRequestParams) {
  const message = redactErrorMessage(
    error,
    "OpenClaw browser profile capability is unavailable. Ensure OpenClaw exposes browser.request."
  );

  if (isExistingChromeAttachError(message, params)) {
    const profileName = params.query?.profile?.trim().toLowerCase();
    const profileLabel = profileName === "user"
      ? "Signed-in Chrome"
      : profileName
        ? `Existing Chrome profile "${profileName}"`
        : "Existing Chrome profile";

    return `${profileLabel} could not be attached through OpenClaw. Keep Chrome open, approve the attach prompt, and retry. If OpenClaw asks for remote debugging, open chrome://inspect and enable it before retrying. If you do not need your signed-in browser session, use the managed "openclaw" profile instead.`;
  }

  return message;
}

function isExistingChromeAttachError(message: string, params: BrowserRequestParams) {
  if (params.query?.profile?.trim().toLowerCase() === "user") {
    return /Chrome MCP|existing-session|DevToolsActivePort|Could not connect to Chrome/i.test(message);
  }

  return /Chrome MCP existing-session attach|DevToolsActivePort/i.test(message);
}

function normalizeBrowserProfile(value: unknown): OpenClawBrowserProfileView | null {
  if (!isRecord(value)) {
    return null;
  }

  const profile = value as RawBrowserProfile;
  const name = readString(profile.name);
  if (!name) {
    return null;
  }

  const driver = readDriver(profile.driver);
  const transport = readTransport(profile.transport);
  const running = profile.running === true;

  return {
    name,
    driver,
    driverLabel: driver === "existing-session" ? "Existing Chrome session" : "Managed OpenClaw profile",
    transport,
    transportLabel: transport === "chrome-mcp" ? "Chrome MCP" : transport === "cdp" ? "CDP" : "Not reported",
    cdpPort: readNumber(profile.cdpPort),
    cdpUrl: readRedactedString(profile.cdpUrl),
    color: readString(profile.color) || managedProfileColor,
    running,
    statusLabel: running ? "Running" : "Stopped",
    statusTone: running ? "success" : "muted",
    tabCount: readNumber(profile.tabCount) ?? 0,
    isDefault: profile.isDefault === true,
    isRemote: profile.isRemote === true,
    missingFromConfig: profile.missingFromConfig === true,
    reconcileReason: readString(profile.reconcileReason)
  };
}

function isBrowserProfileView(value: OpenClawBrowserProfileView | null): value is OpenClawBrowserProfileView {
  return value !== null;
}

function normalizeBrowserTab(value: unknown): OpenClawBrowserTabView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tab = value as RawBrowserTab;
  return {
    tabId: readString(tab.tabId),
    targetId: readString(tab.targetId),
    suggestedTargetId: readString(tab.suggestedTargetId),
    label: readString(tab.label),
    title: readString(tab.title),
    url: readSafeUrl(tab.url)
  };
}

function normalizeExistingProfileName(value: string) {
  const profileName = value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(profileName)) {
    throw new Error("Browser profile names must use lowercase letters, numbers, and hyphens.");
  }

  return profileName;
}

function normalizeLoginUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Login URL must use http or https.");
    }

    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error("A valid Login URL is required.");
  }
}

function normalizeOptionalLabel(value: string | undefined) {
  const label = value?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return label ? label.slice(0, 48) : undefined;
}

function readDriver(value: unknown): OpenClawBrowserDriver {
  return value === "existing-session" ? "existing-session" : "openclaw";
}

function readTransport(value: unknown): OpenClawBrowserTransport | null {
  return value === "cdp" || value === "chrome-mcp" ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readRedactedString(value: unknown) {
  const stringValue = readString(value);
  return stringValue ? redactSecretText(stringValue) : null;
}

function readSafeUrl(value: unknown) {
  const stringValue = readString(value);
  if (!stringValue) {
    return null;
  }

  try {
    const url = new URL(stringValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return redactSecretText(stringValue);
    }

    url.search = "";
    url.hash = "";
    return redactSecretText(url.toString());
  } catch {
    return redactSecretText(stringValue);
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
