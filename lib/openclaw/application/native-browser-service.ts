import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

export type NativeBrowserRequestMethod = "GET" | "POST" | "DELETE";

export type NativeBrowserRequest = {
  method: NativeBrowserRequestMethod;
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

export type NativeBrowserRequestPort = {
  request<TPayload>(input: NativeBrowserRequest): Promise<TPayload>;
};

export type NativeBrowserProfile = {
  name: string;
  driver: "openclaw" | "existing-session" | "extension";
  running: boolean;
  tabCount: number;
  isDefault: boolean;
};

export type NativeBrowserTab = {
  tabId: string | null;
  targetId: string | null;
  title: string | null;
  url: string | null;
};

const browserRequestTimeoutMs = 15_000;
const browserOpenTimeoutMs = 45_000;

/**
 * Narrow native OpenClaw browser port. The port deliberately has no CLI
 * fallback: browser profile mutations are an experimental Gateway surface in
 * OpenClaw 2026.9.4 and must fail closed when that surface is absent.
 */
export function createNativeBrowserRequestPort(): NativeBrowserRequestPort {
  const adapter = getOpenClawAdapter();
  if (!adapter.callNative) {
    throw new Error(
      "OpenClaw native browser.request is unavailable; CLI fallback is disabled for browser account profiles."
    );
  }
  const callNative = adapter.callNative.bind(adapter);

  return {
    request<TPayload>(input: NativeBrowserRequest) {
      return callNative<TPayload>(
        "browser.request",
        {
          target: "host",
          method: input.method,
          path: input.path,
          ...(input.query ? { query: input.query } : {}),
          ...(input.body ? { body: input.body } : {}),
          ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {})
        },
        { timeoutMs: input.timeoutMs ?? browserRequestTimeoutMs },
        {
          safety: input.method === "GET" ? "read" : "mutation",
          timeoutMs: input.timeoutMs ?? browserRequestTimeoutMs
        }
      );
    }
  };
}

export class NativeOpenClawBrowserService {
  constructor(
    private readonly port?: NativeBrowserRequestPort
  ) {}

  async listProfiles() {
    const payload = await this.request<{ profiles?: unknown[] }>({
      method: "GET",
      path: "/profiles"
    });
    if (!Array.isArray(payload.profiles)) {
      throw new Error("OpenClaw native browser profile response is invalid.");
    }
    return payload.profiles.map(normalizeProfile).filter(isProfile);
  }

  async createProfile(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    await this.request({
      method: "POST",
      path: "/profiles/create",
      body: { name },
      timeoutMs: browserRequestTimeoutMs
    });
    return name;
  }

  async profileExists(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    return (await this.listProfiles()).some((profile) => profile.name === name);
  }

  async startProfile(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    await this.request({
      method: "POST",
      path: "/start",
      query: { profile: name }
    });
  }

  async stopProfile(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    await this.request({
      method: "POST",
      path: "/stop",
      query: { profile: name }
    });
  }

  async deleteProfile(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    await this.request({
      method: "DELETE",
      path: `/profiles/${encodeURIComponent(name)}`
    });
  }

  async openTab(profileName: string, url: string) {
    const name = normalizeManagedProfileName(profileName);
    const safeUrl = normalizeBrowserUrl(url);
    const payload = await this.request<unknown>({
      method: "POST",
      path: "/tabs/open",
      query: { profile: name },
      body: { url: safeUrl },
      timeoutMs: browserOpenTimeoutMs
    });
    return normalizeTab(payload);
  }

  async listTabs(profileName: string) {
    const name = normalizeManagedProfileName(profileName);
    const payload = await this.request<{ tabs?: unknown[] }>({
      method: "GET",
      path: "/tabs",
      query: { profile: name }
    });
    return Array.isArray(payload.tabs)
      ? payload.tabs.map(normalizeTab).filter(isTab)
      : [];
  }

  async snapshot(profileName: string, targetId: string) {
    const name = normalizeManagedProfileName(profileName);
    const target = normalizeTargetId(targetId);
    return this.request<unknown>({
      method: "GET",
      path: "/snapshot",
      query: {
        profile: name,
        targetId: target,
        format: "ai"
      },
      timeoutMs: browserRequestTimeoutMs
    });
  }

  async request<TPayload>(input: NativeBrowserRequest) {
    try {
      return await (this.port ?? createNativeBrowserRequestPort()).request<TPayload>(input);
    } catch (error) {
      throw new Error(
        redactNativeBrowserError(
          error,
          "OpenClaw native browser.request is unavailable or rejected the browser profile operation."
        )
      );
    }
  }
}

export function normalizeManagedProfileName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^acct-[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(normalized)) {
    throw new Error("Native OpenClaw account profiles must use an opaque acct- identifier.");
  }
  return normalized;
}

export function normalizeBrowserUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Browser URLs must use http or https.");
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    throw new Error("The browser URL is invalid.");
  }
}

function normalizeProfile(value: unknown): NativeBrowserProfile | null {
  if (!isRecord(value)) return null;
  const name = readString(value.name);
  const driver = value.driver === "openclaw" || value.driver === "existing-session" || value.driver === "extension"
    ? value.driver
    : null;
  if (!name || !driver) return null;
  return {
    name: redactSecretText(name),
    driver,
    running: value.running === true,
    tabCount: readNumber(value.tabCount) ?? 0,
    isDefault: value.isDefault === true
  };
}

function normalizeTab(value: unknown): NativeBrowserTab | null {
  if (!isRecord(value)) return null;
  return {
    tabId: readString(value.tabId),
    targetId: readString(value.targetId),
    title: readString(value.title),
    url: readSafeUrl(value.url)
  };
}

function normalizeTargetId(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(normalized)) {
    throw new Error("The native browser target id is invalid.");
  }
  return normalized;
}

function readSafeUrl(value: unknown) {
  const stringValue = readString(value);
  if (!stringValue) return null;
  try {
    const url = new URL(stringValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return redactSecretText(url.toString());
  } catch {
    return null;
  }
}

function redactNativeBrowserError(error: unknown, fallback: string) {
  return redactErrorMessage(error, fallback)
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[private-browser-endpoint]");
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isProfile(value: NativeBrowserProfile | null): value is NativeBrowserProfile {
  return value !== null;
}

function isTab(value: NativeBrowserTab | null): value is NativeBrowserTab {
  return value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
