import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { ProjectDiscoveryRenderedBrowser } from "@/lib/agentos/application/project-discovery-engine";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

const DEFAULT_PROFILE = "openclaw";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SNAPSHOT_CHARS = 32_000;

/**
 * The discovery fallback is an adapter over OpenClaw's existing browser
 * request surface. It opens one bounded page, reads a bounded snapshot, and
 * closes that tab; AgentOS does not own browser profiles, sessions, or tabs.
 */
export function createOpenClawRenderedDiscoveryBrowser(options: { adapter?: OpenClawAdapter; profileName?: string } = {}): ProjectDiscoveryRenderedBrowser {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const profile = options.profileName?.trim() || DEFAULT_PROFILE;
  return {
    inspect: async ({ url, timeoutMs, maxChars, signal }) => {
      if (signal?.aborted) throw new DOMException("Rendered discovery was cancelled.", "AbortError");
      const opened = await requestBrowser(adapter, {
        method: "POST",
        path: "/tabs/open",
        query: { profile },
        body: { url },
        timeoutMs: Math.min(REQUEST_TIMEOUT_MS, Math.max(5_000, timeoutMs))
      });
      const targetId = readTargetId(opened);
      if (!targetId) throw new Error("OpenClaw did not return a discovery tab identifier.");
      try {
        if (signal?.aborted) throw new DOMException("Rendered discovery was cancelled.", "AbortError");
        const snapshot = await requestBrowser(adapter, {
          method: "GET",
          path: "/snapshot",
          query: { profile, targetId, format: "ai", urls: "true", limit: String(Math.min(400, Math.max(40, Math.floor(maxChars / 80)))) },
          timeoutMs: Math.min(REQUEST_TIMEOUT_MS, Math.max(5_000, timeoutMs))
        });
        return parseRenderedSnapshot(snapshot, url, Math.min(MAX_SNAPSHOT_CHARS, Math.max(1_000, maxChars)));
      } finally {
        await requestBrowser(adapter, { method: "DELETE", path: `/tabs/${encodeURIComponent(targetId)}`, query: { profile }, timeoutMs: 5_000 }).catch(() => undefined);
      }
    }
  };
}

async function requestBrowser(adapter: OpenClawAdapter, input: { method: "GET" | "POST" | "DELETE"; path: string; query?: Record<string, string>; body?: Record<string, unknown>; timeoutMs: number }) {
  try {
    return await adapter.call<unknown>("browser.request", {
      method: input.method,
      path: input.path,
      ...(input.query ? { query: input.query } : {}),
      ...(input.body ? { body: input.body } : {}),
      timeoutMs: input.timeoutMs
    }, { timeoutMs: input.timeoutMs });
  } catch (error) {
    throw new Error(redactErrorMessage(error, "OpenClaw rendered discovery is unavailable."));
  }
}

function parseRenderedSnapshot(value: unknown, requestedUrl: string, maxChars: number) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = typeof record.snapshot === "string" ? record.snapshot : typeof record.text === "string" ? record.text : typeof value === "string" ? value : "";
  const text = redactSecretText(raw).replace(/\s+/g, " ").trim().slice(0, maxChars);
  if (!text) throw new Error("OpenClaw rendered discovery returned no readable page text.");
  const links: Array<{ url: string; label: string | null }> = [];
  for (const match of text.matchAll(/(?:^|\s)(https?:\/\/[^\s)\]>"']+)/gi)) {
    const link = match[1]?.replace(/[.,;:]+$/, "");
    if (!link || links.some((entry) => entry.url === link)) continue;
    links.push({ url: link, label: null });
    if (links.length >= 128) break;
  }
  return { url: requestedUrl, title: typeof record.title === "string" ? redactSecretText(record.title).slice(0, 500) : null, text, links };
}

function readTargetId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["targetId", "tabId", "id"]) if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  return null;
}
