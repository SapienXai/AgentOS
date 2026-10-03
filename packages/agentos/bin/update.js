export const UPDATE_CHECK_TIMEOUT_MS = 5_000;
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_UPDATE_METADATA_BYTES = 256 * 1024;

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function normalizeStableVersion(value) {
  if (typeof value !== "string") return null;
  const version = value.trim();
  return SEMVER.test(version) ? version : null;
}

export function compareStableVersions(left, right) {
  const a = normalizeStableVersion(left);
  const b = normalizeStableVersion(right);
  if (!a || !b) return null;
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] - bv[index];
  }
  return 0;
}

export function updateCacheIdentity({ owner, currentVersion, sourceId }) {
  return [owner, normalizeStableVersion(currentVersion) ?? "invalid", sourceId ?? "unknown"].join(":");
}

export function requiredCliAssetName(platform, arch) {
  const supported = new Set(["darwin:arm64", "darwin:x64", "linux:x64", "win32:x64"]);
  if (!supported.has(`${platform}:${arch}`)) return null;
  return `agentos-${platform}-${arch}.tgz`;
}

export async function discoverLatestAgentOsVersion(options) {
  const {
    owner,
    currentVersion,
    packageName = "@sapienx/agentos",
    repo = "SapienXai/AgentOS",
    platform = process.platform,
    arch = process.arch,
    timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
    fetchImpl = fetch
  } = options;
  const current = normalizeStableVersion(currentVersion);
  if (!current) throw new Error("The running AgentOS build version is invalid.");

  if (owner === "package-manager") {
    const release = await fetchRegistryLatest({ packageName, timeoutMs, fetchImpl });
    return buildDiscovery(release, current, `npm:${packageName}`, null, null);
  }

  if (!["release-launcher", "deployment", "source", "unknown"].includes(owner)) {
    throw new Error("This installation owner does not use release metadata discovery.");
  }

  const release = await fetchGithubLatest({ repo, timeoutMs, fetchImpl });
  const expectedAssetName = owner === "release-launcher" ? requiredCliAssetName(platform, arch) : null;
  const expectedAsset = owner === "release-launcher"
    ? { name: expectedAssetName ?? "unsupported-platform", available: Boolean(expectedAssetName && release.assets.includes(expectedAssetName)) }
    : null;
  return buildDiscovery(
    release,
    current,
    `github:${repo}`,
    `https://github.com/${repo}/releases/tag/agentos-v${release.version}`,
    expectedAsset
  );
}

export async function fetchGithubLatest({ repo = "SapienXai/AgentOS", timeoutMs = UPDATE_CHECK_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("The AgentOS release source is invalid.");
  const payload = await fetchJsonBounded(
    `https://api.github.com/repos/${repo}/releases/latest`,
    timeoutMs,
    { Accept: "application/vnd.github+json", "User-Agent": "AgentOS" },
    fetchImpl
  );
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("GitHub release metadata is malformed.");
  const tag = typeof payload.tag_name === "string" ? payload.tag_name : "";
  const match = tag.match(/^agentos-v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/);
  if (!match || payload.draft === true || payload.prerelease === true) throw new Error("GitHub did not return a stable AgentOS release.");
  const version = normalizeStableVersion(match[1]);
  const assets = Array.isArray(payload.assets)
    ? payload.assets.map((asset) => asset && typeof asset === "object" && typeof asset.name === "string" ? asset.name : "")
    : [];
  return { version, assets };
}

export async function fetchRegistryLatest({ packageName = "@sapienx/agentos", timeoutMs = UPDATE_CHECK_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  if (!/^@[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(packageName)) throw new Error("The AgentOS package name is invalid.");
  const payload = await fetchJsonBounded(
    `https://registry.npmjs.org/${packageName.split("/").map(encodeURIComponent).join("/")}/latest`,
    timeoutMs,
    { Accept: "application/json", "User-Agent": "AgentOS" },
    fetchImpl
  );
  const version = payload && typeof payload === "object" && !Array.isArray(payload)
    ? normalizeStableVersion(payload.version)
    : null;
  if (!version) throw new Error("npm registry metadata did not contain a stable version.");
  return { version, assets: [] };
}

export async function fetchJsonBounded(url, timeoutMs, headers, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`Update metadata request failed with status ${response.status}.`);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_UPDATE_METADATA_BYTES) throw new Error("Update metadata exceeds the allowed size.");
    if (!response.body) throw new Error("Update metadata response was empty.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPDATE_METADATA_BYTES) {
        await reader.cancel();
        throw new Error("Update metadata exceeds the allowed size.");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(body)); }
    catch { throw new Error("Update metadata is not valid JSON."); }
  } finally {
    clearTimeout(timer);
  }
}

function buildDiscovery(release, current, sourceId, releaseUrl, expectedAsset) {
  return {
    currentVersion: current,
    latestVersion: release.version,
    newer: compareStableVersions(release.version, current) > 0,
    sourceId,
    releaseUrl,
    expectedAsset,
    checkedAt: new Date().toISOString()
  };
}
