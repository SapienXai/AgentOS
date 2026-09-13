// 2026.9.4 passed the AgentOS runtime, security, migration, and native contract
// gates. OpenClaw still owns update/recovery mutations; certification keeps
// those operations explicitly skipped. Keep 9.1 as the supported minimum for
// existing installations whose security-sensitive configuration is explicit.
export const OPENCLAW_RECOMMENDED_VERSION: string = "2026.9.4";
export const OPENCLAW_SUPPORTED_BASELINE_VERSION: string = "2026.9.1";
export const OPENCLAW_NATIVE_CONTRACT_VERSION: string = "2026.9.4";
export const OPENCLAW_FINAL_CERTIFICATION_PHASE = "pre-merge-final-certification" as const;

export function getOpenClawFinalCertificationArtifactType(version: string) {
  return `openclaw-${version}-${OPENCLAW_FINAL_CERTIFICATION_PHASE}`;
}

export function getOpenClawFinalCertificationFilename(version: string) {
  return `${getOpenClawFinalCertificationArtifactType(version)}.json`;
}

export type OpenClawVersionRoleEpistemicStatus =
  | "policy"
  | "verified"
  | "unverified"
  | "not-tested"
  | "mismatch";

export type OpenClawVersionRoleClaim = {
  version: string | null;
  status: OpenClawVersionRoleEpistemicStatus;
  evidence: string;
};

export type OpenClawVersionRoles = {
  supportedMinimum: OpenClawVersionRoleClaim;
  recommended: OpenClawVersionRoleClaim;
  nativeContract: OpenClawVersionRoleClaim;
  packageVersions: {
    openClaw: OpenClawVersionRoleClaim;
    gatewayClient: OpenClawVersionRoleClaim;
    gatewayProtocol: OpenClawVersionRoleClaim;
  };
  deploymentPin: {
    version: string | null;
    image: string | null;
    digest: string | null;
    status: OpenClawVersionRoleEpistemicStatus;
    evidence: string;
  };
  migration: {
    sourceVersion: string | null;
    targetVersion: string | null;
    status: OpenClawVersionRoleEpistemicStatus;
    evidence: string;
  };
  certifiedIdentity: {
    version: string | null;
    tag: string | null;
    sourceCommit: string | null;
    buildId: string | null;
    packageHash: string | null;
    status: OpenClawVersionRoleEpistemicStatus;
    evidence: string;
  };
  liveRuntime: {
    installedVersion: string | null;
    protocolVersion: number | null;
    status: OpenClawVersionRoleEpistemicStatus;
    evidence: string;
  };
};

export const OPENCLAW_VERSION_DEFAULT_EXPECTATION = {
  source: "version-default",
  epistemicStatus: "unverified",
  nativeCallObserved: false,
  capabilityMetadataObserved: false,
  reason: "The version contract supplies an expectation only; no live Gateway capability metadata or native call was observed."
} as const;

export function buildOpenClawVersionRoles(input: {
  supportedMinimumVersion: string;
  recommendedVersion: string;
  nativeContractVersion: string;
  packageVersions?: {
    openClaw?: string | null;
    gatewayClient?: string | null;
    gatewayProtocol?: string | null;
  };
  deploymentPin?: {
    version?: string | null;
    image?: string | null;
    digest?: string | null;
    status?: OpenClawVersionRoleEpistemicStatus;
    evidence?: string;
  };
  migration?: {
    sourceVersion?: string | null;
    targetVersion?: string | null;
    status?: OpenClawVersionRoleEpistemicStatus;
    evidence?: string;
  };
  certifiedIdentity?: {
    version?: string | null;
    tag?: string | null;
    sourceCommit?: string | null;
    buildId?: string | null;
    packageHash?: string | null;
    status?: OpenClawVersionRoleEpistemicStatus;
    evidence?: string;
  };
  liveRuntime?: {
    installedVersion?: string | null;
    protocolVersion?: number | null;
    status?: OpenClawVersionRoleEpistemicStatus;
    evidence?: string;
  };
}): OpenClawVersionRoles {
  const packageVersions = input.packageVersions ?? {};
  return {
    supportedMinimum: policyClaim(input.supportedMinimumVersion, "AgentOS supported-minimum policy."),
    recommended: policyClaim(input.recommendedVersion, "AgentOS recommended-version policy."),
    nativeContract: policyClaim(input.nativeContractVersion, "AgentOS native-contract policy."),
    packageVersions: {
      openClaw: observedPackageClaim(packageVersions.openClaw, "Exact upstream OpenClaw package identity."),
      gatewayClient: observedPackageClaim(packageVersions.gatewayClient, "Gateway client package identity."),
      gatewayProtocol: observedPackageClaim(packageVersions.gatewayProtocol, "Gateway protocol package identity.")
    },
    deploymentPin: {
      version: input.deploymentPin?.version ?? null,
      image: input.deploymentPin?.image ?? null,
      digest: input.deploymentPin?.digest ?? null,
      status: input.deploymentPin?.status ?? "not-tested",
      evidence: input.deploymentPin?.evidence ?? "No deployment configuration was inspected by this report."
    },
    migration: {
      sourceVersion: input.migration?.sourceVersion ?? null,
      targetVersion: input.migration?.targetVersion ?? null,
      status: input.migration?.status ?? "not-tested",
      evidence: input.migration?.evidence ?? "No migration runtime evidence was supplied to this report."
    },
    certifiedIdentity: {
      version: input.certifiedIdentity?.version ?? null,
      tag: input.certifiedIdentity?.tag ?? null,
      sourceCommit: input.certifiedIdentity?.sourceCommit ?? null,
      buildId: input.certifiedIdentity?.buildId ?? null,
      packageHash: input.certifiedIdentity?.packageHash ?? null,
      status: input.certifiedIdentity?.status ?? "not-tested",
      evidence: input.certifiedIdentity?.evidence ?? "No certified identity evidence was supplied to this report."
    },
    liveRuntime: {
      installedVersion: input.liveRuntime?.installedVersion ?? null,
      protocolVersion: input.liveRuntime?.protocolVersion ?? null,
      status: input.liveRuntime?.status ?? "not-tested",
      evidence: input.liveRuntime?.evidence ?? "No live Gateway or production runtime was tested by this report."
    }
  };
}

function policyClaim(version: string, evidence: string): OpenClawVersionRoleClaim {
  return { version, status: "policy", evidence };
}

function observedPackageClaim(version: string | null | undefined, evidence: string): OpenClawVersionRoleClaim {
  return {
    version: version ?? null,
    status: version ? "verified" : "not-tested",
    evidence: version ? evidence : "The package version was not observed by this report."
  };
}
