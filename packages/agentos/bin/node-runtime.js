const MIN_NODE_24 = Object.freeze({ major: 24, minor: 22, patch: 1 });
const MIN_NODE_26 = Object.freeze({ major: 26, minor: 12, patch: 1 });

export const MINIMUM_AGENTOS_NODE_VERSION = "24.22.1";
export const RECOMMENDED_AGENTOS_NODE_VERSION = "26.12.1";

export function isSupportedAgentOsNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) {
    return false;
  }

  if (parsed.major === 24) {
    return compareNodeVersions(parsed, MIN_NODE_24) >= 0;
  }

  return parsed.major >= 26 && compareNodeVersions(parsed, MIN_NODE_26) >= 0;
}

export function parseNodeVersion(version) {
  if (typeof version !== "string") {
    return null;
  }

  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareNodeVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}
