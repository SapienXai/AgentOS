import { DEFAULT_GATEWAY_URL } from "@/lib/openclaw/client/native-ws-gateway-types";
import { resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import { OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { REDACTED_SECRET_VALUE, redactSecretText } from "@/lib/security/redaction";
import type {
  OpenClawCompatibilityReport,
  OpenClawCompatibilityRuntimeStartedBy,
  OpenClawCompatibilityTarget,
  OpenClawCompatibilityTargetKind,
  OpenClawCompatibilityTargetName
} from "@/lib/openclaw/compat/types";

const targetAliases = {
  local: "real-local",
  "test-gateway-stable": "simulated-stable",
  "test-gateway-beta": "simulated-beta-shape"
} as const satisfies Record<string, OpenClawCompatibilityTargetName>;

export type OpenClawCompatibilityTargetAlias = keyof typeof targetAliases;

export function resolveOpenClawCompatibilityTarget(input: {
  target?: string | null;
  gatewayUrl?: string | null;
  runtimeStartedBy?: OpenClawCompatibilityRuntimeStartedBy | null;
} = {}): OpenClawCompatibilityTarget {
  const requestedTarget = input.target?.trim() || "real-local";
  const aliasTarget = targetAliases[requestedTarget as OpenClawCompatibilityTargetAlias];
  const name = aliasTarget ?? requestedTarget;

  if (!isCompatibilityTargetName(name)) {
    throw new Error(
      `Unknown OpenClaw compatibility target: ${requestedTarget}. Expected simulated-stable, simulated-beta-shape, real-local, or real-stable.`
    );
  }

  const kind = resolveTargetKind(name);
  const runtimeStartedBy = input.runtimeStartedBy ?? defaultRuntimeStartedBy(name);
  const gatewayUrl = kind === "real"
    ? resolveRedactedGatewayUrl(input.gatewayUrl)
    : null;
  const version = name === "simulated-beta-shape"
    ? `${OPENCLAW_RECOMMENDED_VERSION}-beta`
    : name === "simulated-stable" || name === "real-stable"
      ? OPENCLAW_SUPPORTED_BASELINE_VERSION
      : null;

  return {
    name,
    kind,
    label: resolveTargetLabel(name),
    aliasUsed: aliasTarget ? requestedTarget : null,
    version,
    gatewayUrl,
    runtimeStartedBy,
    isRealRuntime: kind === "real",
    isSimulatedRuntime: kind === "simulated"
  };
}

export function isSimulatedCompatibilityTarget(target: OpenClawCompatibilityTarget) {
  return target.kind === "simulated" || target.isSimulatedRuntime;
}

export function isRealCompatibilityTarget(target: OpenClawCompatibilityTarget) {
  return target.kind === "real" || target.isRealRuntime;
}

export function normalizeRuntimeStartedBy(
  value: string | null | undefined,
  fallback: OpenClawCompatibilityRuntimeStartedBy
): OpenClawCompatibilityRuntimeStartedBy {
  switch (value?.trim()) {
    case "ci":
    case "script":
    case "external":
    case "unknown":
      return value.trim() as OpenClawCompatibilityRuntimeStartedBy;
    default:
      return fallback;
  }
}

export function resolveOpenClawCompatibilityExit(input: {
  report: Pick<OpenClawCompatibilityReport, "status" | "target">;
  failOnIncompatible: boolean;
  failOnDegraded: boolean;
  allowDegraded: boolean;
}) {
  if (input.report.status === "incompatible" && input.failOnIncompatible) {
    return {
      exitCode: 1,
      reason: "Compatibility status is incompatible."
    };
  }

  if (input.report.status === "degraded" && input.failOnDegraded && !input.allowDegraded) {
    return {
      exitCode: 1,
      reason: "Compatibility status is degraded and --fail-on-degraded is enabled."
    };
  }

  return {
    exitCode: 0,
    reason: input.report.status === "degraded" && input.allowDegraded
      ? "Compatibility status is degraded, but --allow-degraded is enabled."
      : "Compatibility status is allowed."
  };
}

export function resolveDefaultFailOnDegraded(target: OpenClawCompatibilityTarget) {
  return target.name === "real-stable";
}

export function redactGatewayUrl(value: string | null | undefined) {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.username) {
      parsed.username = REDACTED_SECRET_VALUE;
    }

    if (parsed.password) {
      parsed.password = REDACTED_SECRET_VALUE;
    }

    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveGatewayUrlParam(key)) {
        parsed.searchParams.set(key, REDACTED_SECRET_VALUE);
      }
    }

    return redactSecretText(parsed.toString());
  } catch {
    return redactSecretText(raw);
  }
}

function resolveRedactedGatewayUrl(value: string | null | undefined) {
  return redactGatewayUrl(value) ?? redactGatewayUrl(resolveGatewayUrl(value) || DEFAULT_GATEWAY_URL);
}

function isCompatibilityTargetName(value: string): value is OpenClawCompatibilityTargetName {
  return value === "simulated-stable" ||
    value === "simulated-beta-shape" ||
    value === "real-local" ||
    value === "real-stable";
}

function resolveTargetKind(name: OpenClawCompatibilityTargetName): OpenClawCompatibilityTargetKind {
  return name.startsWith("simulated-") ? "simulated" : "real";
}

function resolveTargetLabel(name: OpenClawCompatibilityTargetName) {
  switch (name) {
    case "simulated-stable":
      return `Simulated OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION} stable Gateway`;
    case "simulated-beta-shape":
      return "Simulated OpenClaw beta Gateway shape";
    case "real-stable":
      return `Real OpenClaw ${OPENCLAW_RECOMMENDED_VERSION} stable runtime`;
    case "real-local":
      return "Real local OpenClaw runtime";
  }
}

function defaultRuntimeStartedBy(name: OpenClawCompatibilityTargetName): OpenClawCompatibilityRuntimeStartedBy {
  return name.startsWith("simulated-") ? "script" : "external";
}

function isSensitiveGatewayUrlParam(key: string) {
  return /(?:token|password|secret|credential|api[-_]?key|auth)/i.test(key);
}
