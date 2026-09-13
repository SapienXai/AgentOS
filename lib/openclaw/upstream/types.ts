import type { OpenClawVersionRoles } from "@/lib/openclaw/versions";

export type OpenClawReleaseMode = "scheduled" | "manual";

export const OPENCLAW_RELEASE_LIFECYCLE_STAGE_IDS = [
  "discovered",
  "intake",
  "audit",
  "certification",
  "promotion",
  "intake-certified-closed",
  "version-policy-updated",
  "production-pin-consistency"
] as const;

export type OpenClawReleaseLifecycleStageId = typeof OPENCLAW_RELEASE_LIFECYCLE_STAGE_IDS[number];

export type OpenClawReleaseLifecycleStage = {
  id: OpenClawReleaseLifecycleStageId;
  label: string;
  status: "complete" | "pending" | "blocked";
  evidence: string[];
};

export type OpenClawReleaseLifecycle = {
  currentStage: OpenClawReleaseLifecycleStageId;
  nonMutating: true;
  stages: OpenClawReleaseLifecycleStage[];
};

export type OpenClawReleaseIdentityStatus = "verified" | "incomplete" | "identity-mismatch";

export type OpenClawReleaseManifestStatus = "certified" | "candidate" | "blocked" | "unknown";

export type OpenClawReleaseCandidate = {
  version: string;
  tag: string;
  prerelease: boolean;
  publishedAt: string | null;
  releaseUrl: string | null;
  source: "npm" | "github" | "both" | "manual";
};

export type OpenClawReleaseDiscovery = {
  status: "ok" | "discovery-failed";
  currentRecommendedVersion: string;
  latestStableVersion: string | null;
  releases: OpenClawReleaseCandidate[];
  truncated: boolean;
  remainingReleaseCount: number;
  ignoredPrereleaseVersions: string[];
  npmLatestVersion: string | null;
  githubLatestVersion: string | null;
  error: string | null;
};

export type OpenClawReleasePackageIdentity = {
  packageName: "openclaw" | "@openclaw/gateway-protocol" | "@openclaw/gateway-client";
  version: string | null;
  integrity: string | null;
};

export type OpenClawReleaseIdentity = {
  status: OpenClawReleaseIdentityStatus;
  version: string;
  tag: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageVersion: string | null;
  packageIntegrity: string | null;
  gatewayProtocolPackage: OpenClawReleasePackageIdentity;
  gatewayClientPackage: OpenClawReleasePackageIdentity;
  publishedAt: string | null;
  releaseUrl: string | null;
  tagUrl: string;
  identityHash: string;
  mismatches: string[];
  missingEvidence: string[];
};

export type OpenClawReleaseNotesEvidence = {
  sourceUrl: string | null;
  excerpt: string;
  signals: string[];
};

export type OpenClawReleaseContractDiff = {
  status: "safe" | "warning" | "blocker" | "unknown";
  source: "agentos-server-method-diff" | "fixture" | "unavailable";
  fromVersion: string;
  targetVersion: string;
  changedFiles: string[];
  methodsAdded: string[];
  methodsRemoved: string[];
  eventsAdded: string[];
  eventsRemoved: string[];
  scopesChanged: string[];
  requestSchemasChanged: string[];
  responseSchemasChanged: string[];
  requiredFieldsAdded: string[];
  requiredFieldsRemoved: string[];
  enumValuesAdded: string[];
  enumValuesRemoved: string[];
  configKeysAdded: string[];
  configKeysRemoved: string[];
  configDefaultsChanged: string[];
  protocolChanged: boolean;
  updateContractChanged: boolean;
  sessionContractChanged: boolean;
  securitySensitiveChanges: string[];
  domainsChanged: string[];
  evidenceGaps: string[];
  summary: string;
};

export type OpenClawReleaseImpactClassification =
  | "SECURITY_CRITICAL"
  | "BREAKING"
  | "BEHAVIOR_CHANGE"
  | "COMPATIBILITY_REVIEW"
  | "NEW_CAPABILITY"
  | "LOW_RISK_ADDITIVE"
  | "NO_KNOWN_AGENTOS_IMPACT"
  | "IDENTITY_MISMATCH"
  | "UPSTREAM_RELEASE_IDENTITY_DRIFT"
  | "DISCOVERY_INCOMPLETE";

export type OpenClawReleaseImpact = {
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  classifications: OpenClawReleaseImpactClassification[];
  affectedAgentOsModules: string[];
  changedDomains: string[];
  requiredChecks: OpenClawCertificationCheck[];
  rationale: string[];
};

export type OpenClawCertificationCheck = {
  id: string;
  label: string;
  reason: string;
  commands: string[];
};

export type OpenClawCompatibilityIntake = {
  schemaVersion: 1;
  generatedAt: string;
  intakeMode: OpenClawReleaseMode;
  agentos: {
    commit: string;
    version: string;
    recommendedOpenClaw: string;
    supportedBaselineOpenClaw: string;
    nativeContractOpenClaw: string;
  };
  versionRoles: OpenClawVersionRoles;
  compatibilityExpectation: {
    source: "version-default";
    epistemicStatus: "unverified";
    nativeCallObserved: false;
    capabilityMetadataObserved: false;
    reason: string;
  };
  upstream: {
    version: string;
    tag: string;
    sourceCommit: string | null;
    buildId: string | null;
    packageIntegrity: string | null;
    gatewayProtocolPackage: string | null;
    gatewayClientPackage: string | null;
    publishedAt: string | null;
    releaseUrl: string | null;
  };
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
  releaseNotes: OpenClawReleaseNotesEvidence;
  manifest: {
    status: OpenClawReleaseManifestStatus;
    exactEntry: boolean;
    reason: string | null;
  };
  lifecycle: OpenClawReleaseLifecycle;
  impact: OpenClawReleaseImpact;
  certification: {
    status: "not-certified";
    normalUpdateAllowed: false;
    requiredChecks: OpenClawCertificationCheck[];
    automaticActionsPerformed: string[];
  };
  intakeHash: string;
};

export type OpenClawIssueSyncResult = {
  action: "created" | "updated" | "unchanged" | "identity-drift" | "identity-mismatch" | "would-create" | "would-update";
  metadataStatus: "missing" | "current" | "stale" | "identity-mismatch";
  issueNumber: number | null;
  issueUrl: string | null;
  message: string;
};

export type OpenClawCertifiedEvidence = {
  artifactType: string | null;
  version: string | null;
  sourceCommit: string | null;
  buildId: string | null;
  packageHash: string | null;
  certifiedCodeHead: string | null;
  evidenceCommit: string | null;
  deploymentPin: {
    version: string | null;
    image: string | null;
    digest: string | null;
  } | null;
};

export type OpenClawCertifiedEvidenceLookup = {
  status: "found" | "missing" | "invalid";
  path: string | null;
  evidence: OpenClawCertifiedEvidence | null;
  reason: string;
};

export type OpenClawProductionConfigPin = {
  status: "found" | "missing" | "invalid";
  path: string | null;
  version: string | null;
  image: string | null;
  digest: string | null;
  reason: string;
};

export type OpenClawReleaseReconciliation = {
  status: "reviewable" | "blocked";
  identityStatus: "match" | "mismatch" | "unavailable";
  certifiedEvidenceStatus: OpenClawCertifiedEvidenceLookup["status"];
  productionConfigStatus: "match" | "mismatch" | "unknown";
  reasons: string[];
};
