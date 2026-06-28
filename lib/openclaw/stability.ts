import "server-only";

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import { redactErrorMessage } from "@/lib/security/redaction";
import type {
  OpenClawStabilityRelease,
  OpenClawStabilitySnapshot,
  OpenClawStabilityUiStatus
} from "@/lib/openclaw/stability-types";

export const OPENCLAW_STABILITY_RELEASES_API_URL = "https://isitstable.iclaw.digital/api/releases";
export const OPENCLAW_STABILITY_PUBLIC_API_URL = "https://isitstable.iclaw.digital/api/public";

const stabilityCachePath = path.join(missionControlRootPath, "openclaw-stability-cache.json");
const stabilityRequestTimeoutMs = 10_000;

type CacheEnvelope = {
  fetchedAt: string;
  snapshot: Omit<OpenClawStabilitySnapshot, "source" | "cacheAgeMs" | "error">;
};

export async function getOpenClawStabilitySnapshot(): Promise<OpenClawStabilitySnapshot> {
  try {
    const snapshot = await fetchOpenClawStabilitySnapshot();
    await writeStabilityCache(snapshot);

    return {
      ...snapshot,
      source: "network",
      cacheAgeMs: 0,
      error: null
    };
  } catch (error) {
    const cached = await readStabilityCache();

    if (cached) {
      return {
        ...cached.snapshot,
        source: "cache",
        cacheAgeMs: Math.max(0, Date.now() - Date.parse(cached.fetchedAt)),
        error: redactErrorMessage(error, "OpenClaw stability data is unavailable.")
      };
    }

    return {
      source: "unavailable",
      fetchedAt: null,
      cacheAgeMs: null,
      repo: null,
      latestVersion: null,
      recommendedVersion: null,
      releases: [],
      error: redactErrorMessage(error, "OpenClaw stability data is unavailable.")
    };
  }
}

export async function fetchOpenClawStabilitySnapshot(): Promise<Omit<OpenClawStabilitySnapshot, "source" | "cacheAgeMs" | "error">> {
  const payload = await fetchStabilityJson();
  const repo = readString(readObject(payload)?.repo);
  const releases = parseOpenClawStabilityReleases(payload);
  const sortedReleases = releases.toSorted((left, right) => compareVersionStrings(right.version, left.version));
  const latestVersion = sortedReleases[0]?.version ?? null;
  const recommendedVersion = sortedReleases.find((release) => release.recommended)?.version ?? null;

  return {
    fetchedAt: new Date().toISOString(),
    repo,
    latestVersion,
    recommendedVersion,
    releases: sortedReleases
  };
}

export function parseOpenClawStabilityReleases(payload: unknown, nowMs = Date.now()): OpenClawStabilityRelease[] {
  const container = readObject(payload);
  const rawReleases = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.releases)
      ? container.releases
      : [];
  const seen = new Set<string>();
  const releases: OpenClawStabilityRelease[] = [];

  for (const rawRelease of rawReleases) {
    const release = parseOpenClawStabilityRelease(rawRelease, nowMs);

    if (!release || seen.has(release.version)) {
      continue;
    }

    seen.add(release.version);
    releases.push(release);
  }

  return releases;
}

export function normalizeOpenClawReleaseVersion(value: unknown) {
  const raw = readString(value);

  if (!raw) {
    return null;
  }

  const normalized = raw
    .trim()
    .replace(/^openclaw\s+/i, "")
    .replace(/^v/i, "");

  return normalized || null;
}

export function mapOpenClawStabilityStatus(input: {
  score: number | null;
  band: string | null;
  status: string | null;
  recommended: boolean;
}): OpenClawStabilityUiStatus {
  const band = input.band?.trim().toLowerCase() ?? "";
  const status = input.status?.trim().toLowerCase() ?? "";

  if (input.recommended) {
    return "recommended";
  }

  if (band.includes("skip") || status.includes("skip")) {
    return "skip";
  }

  if (band.includes("risky") || status.includes("risky")) {
    return "risky";
  }

  if (band.includes("wait") || status.includes("wait")) {
    return "wait";
  }

  if (band.includes("caution") || status.includes("caution")) {
    return "caution";
  }

  if (band.includes("solid") || band.includes("stable") || (typeof input.score === "number" && input.score >= 7.5)) {
    return "stable";
  }

  if (typeof input.score === "number") {
    if (input.score < 5) {
      return "risky";
    }

    if (input.score < 7) {
      return "caution";
    }

    return "stable";
  }

  return "unknown";
}

function parseOpenClawStabilityRelease(rawRelease: unknown, nowMs: number): OpenClawStabilityRelease | null {
  const release = readObject(rawRelease);

  if (!release) {
    return null;
  }

  const tag = readString(release.tag) ?? readString(release.version) ?? "";
  const version = normalizeOpenClawReleaseVersion(tag) ?? normalizeOpenClawReleaseVersion(release.name);

  if (!version) {
    return null;
  }

  const publishedAt = readString(release.publishedAt) ?? readString(release.published_at);
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  const score = readNumber(release.finalScore) ?? readNumber(release.score);
  const band = readString(release.band);
  const status = readString(release.status);
  const recommended = release.recommended === true;

  return {
    version,
    tag: tag || `v${version}`,
    name: readString(release.name),
    publishedAt: publishedAt && !Number.isNaN(publishedMs) ? publishedAt : null,
    releaseAgeMs: Number.isNaN(publishedMs) ? null : Math.max(0, nowMs - publishedMs),
    url: readString(release.htmlUrl) ?? readString(release.url),
    score,
    band,
    status,
    uiStatus: mapOpenClawStabilityStatus({ score, band, status, recommended }),
    recommended,
    reason: readString(release.reason),
    negativeIssues: readNumber(release.negativeIssues),
    positiveIssues: readNumber(release.positiveIssues),
    watchIssueCount: Array.isArray(release.watchIssues) ? release.watchIssues.length : readNumber(release.watchIssueCount),
    brokenSurfaceCount: Array.isArray(release.brokenSurfaces) ? release.brokenSurfaces.length : readNumber(release.brokenSurfaceCount),
    affectedAdvisoryCount: readNumber(readObject(readObject(release.advisories)?.affected)?.total),
    scoredAt: readString(release.scoredAt)
  };
}

async function fetchStabilityJson() {
  try {
    return await fetchJsonWithTimeout(OPENCLAW_STABILITY_RELEASES_API_URL);
  } catch {
    const payload = await fetchJsonWithTimeout(OPENCLAW_STABILITY_PUBLIC_API_URL);

    return payload;
  }
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), stabilityRequestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`OpenClaw stability API returned HTTP ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function readStabilityCache(): Promise<CacheEnvelope | null> {
  try {
    const parsed = JSON.parse(await readFile(stabilityCachePath, "utf8")) as CacheEnvelope;

    if (!parsed?.fetchedAt || !parsed.snapshot || !Array.isArray(parsed.snapshot.releases)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

async function writeStabilityCache(snapshot: Omit<OpenClawStabilitySnapshot, "source" | "cacheAgeMs" | "error">) {
  await mkdir(path.dirname(stabilityCachePath), { recursive: true });
  await writeFile(
    stabilityCachePath,
    `${JSON.stringify({ fetchedAt: snapshot.fetchedAt ?? new Date().toISOString(), snapshot }, null, 2)}\n`,
    "utf8"
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
