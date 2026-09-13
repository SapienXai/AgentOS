import { createHash } from "node:crypto";

import {
  classifyOpenClawReleaseImpact,
  getOpenClawManifestStatus
} from "@/lib/openclaw/upstream/impact-classifier";
import {
  buildOpenClawVersionRoles,
  OPENCLAW_VERSION_DEFAULT_EXPECTATION
} from "@/lib/openclaw/versions";
import { sanitizeIssueText } from "@/lib/openclaw/upstream/release-notes";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type {
  OpenClawCompatibilityIntake,
  OpenClawReleaseContractDiff,
  OpenClawReleaseIdentity,
  OpenClawReleaseLifecycle,
  OpenClawReleaseMode,
  OpenClawReleaseNotesEvidence
} from "@/lib/openclaw/upstream/types";

export function buildOpenClawCompatibilityIntake(input: {
  generatedAt?: string;
  intakeMode: OpenClawReleaseMode;
  agentosCommit: string;
  agentosVersion: string;
  recommendedOpenClaw: string;
  supportedBaselineOpenClaw: string;
  nativeContractOpenClaw: string;
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
  releaseNotes: OpenClawReleaseNotesEvidence;
  manifest: OpenClawCompatibilityManifest;
}): OpenClawCompatibilityIntake {
  const manifestStatus = getOpenClawManifestStatus({
    manifest: input.manifest,
    version: input.identity.version
  });
  const impact = classifyOpenClawReleaseImpact({
    identity: input.identity,
    contractDiff: input.contractDiff,
    releaseNotes: input.releaseNotes,
    manifestStatus: manifestStatus.status
  });
  const base = {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    intakeMode: input.intakeMode,
    agentos: {
      commit: input.agentosCommit,
      version: input.agentosVersion,
      recommendedOpenClaw: input.recommendedOpenClaw,
      supportedBaselineOpenClaw: input.supportedBaselineOpenClaw,
      nativeContractOpenClaw: input.nativeContractOpenClaw
    },
    versionRoles: buildOpenClawVersionRoles({
      supportedMinimumVersion: input.supportedBaselineOpenClaw,
      recommendedVersion: input.recommendedOpenClaw,
      nativeContractVersion: input.nativeContractOpenClaw,
      packageVersions: {
        openClaw: input.identity.packageVersion,
        gatewayClient: input.identity.gatewayClientPackage.version,
        gatewayProtocol: input.identity.gatewayProtocolPackage.version
      },
      migration: {
        sourceVersion: input.contractDiff.fromVersion,
        targetVersion: input.contractDiff.targetVersion,
        status: "not-tested",
        evidence: "Release intake records the contract comparison only; migration requires a separate disposable runtime certification."
      },
      certifiedIdentity: {
        version: input.identity.version,
        tag: input.identity.tag,
        sourceCommit: input.identity.sourceCommit,
        buildId: input.identity.buildId,
        packageHash: null,
        status: identityRoleStatus(input.identity.status),
        evidence: "Official release identity evidence; this is not a live Gateway runtime observation."
      }
    }),
    compatibilityExpectation: OPENCLAW_VERSION_DEFAULT_EXPECTATION,
    upstream: {
      version: input.identity.version,
      tag: input.identity.tag,
      sourceCommit: input.identity.sourceCommit,
      buildId: input.identity.buildId,
      packageIntegrity: input.identity.packageIntegrity,
      gatewayProtocolPackage: formatPackageIdentity(input.identity.gatewayProtocolPackage),
      gatewayClientPackage: formatPackageIdentity(input.identity.gatewayClientPackage),
      publishedAt: input.identity.publishedAt,
      releaseUrl: input.identity.releaseUrl
    },
    identity: input.identity,
    contractDiff: input.contractDiff,
    releaseNotes: input.releaseNotes,
    manifest: manifestStatus,
    lifecycle: buildReleaseLifecycle({
      identity: input.identity,
      contractDiff: input.contractDiff
    }),
    impact,
    certification: {
      status: "not-certified" as const,
      normalUpdateAllowed: false as const,
      requiredChecks: impact.requiredChecks,
      automaticActionsPerformed: [
        "No AgentOS version policy was changed.",
        "No compatibility manifest entry was written.",
        "No Gateway or runtime mutation was performed.",
        "No Docker or Railway pin was changed.",
        "No deployment, publish, or merge was performed."
      ]
    }
  };
  const { generatedAt, ...fingerprintBase } = base;
  void generatedAt;
  const intakeHash = createHash("sha256")
    .update(stableStringify(fingerprintBase))
    .digest("hex");
  return { ...base, intakeHash };
}

function buildReleaseLifecycle(input: {
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
}): OpenClawReleaseLifecycle {
  const certificationBlocked = input.identity.status !== "verified" ||
    input.contractDiff.status === "unknown" ||
    input.contractDiff.evidenceGaps.length > 0;

  return {
    currentStage: "certification",
    nonMutating: true,
    stages: [
      { id: "discovered", label: "Discovered", status: "complete", evidence: ["Selected from official upstream release discovery."] },
      { id: "intake", label: "Intake", status: "complete", evidence: ["Structured compatibility intake generated."] },
      { id: "audit", label: "Audit", status: "complete", evidence: ["Release identity and contract diff evidence captured."] },
      {
        id: "certification",
        label: "Certification",
        status: certificationBlocked ? "blocked" : "pending",
        evidence: certificationBlocked
          ? ["Certification is blocked until identity and contract evidence is complete."]
          : ["Certification remains an explicit human-reviewed Compatibility Lab decision."]
      },
      { id: "promotion", label: "Promotion", status: "pending", evidence: ["No manifest promotion was performed by intake."] },
      { id: "intake-certified-closed", label: "Intake certified/closed", status: "pending", evidence: ["The intake remains open until certification and promotion are complete."] },
      { id: "version-policy-updated", label: "Version policy updated", status: "pending", evidence: ["No AgentOS version policy was changed."] },
      { id: "production-pin-consistency", label: "Production pin consistency", status: "pending", evidence: ["No production or deployment pin was changed or verified by intake."] }
    ]
  };
}

export function renderOpenClawCompatibilityIssue(
  intake: OpenClawCompatibilityIntake,
  options: { identityDrift?: boolean; previousIdentityHash?: string | null } = {}
) {
  const marker = `<!-- agentos-openclaw-intake:${intake.upstream.version} -->`;
  const autoSection = renderOpenClawCompatibilityIssueAutoSection(intake, options);
  return [marker, autoSection].join("\n\n");
}

export function renderOpenClawCompatibilityIssueAutoSection(
  intake: OpenClawCompatibilityIntake,
  options: { identityDrift?: boolean; previousIdentityHash?: string | null } = {}
) {
  const classifications = options.identityDrift
    ? [...new Set(["UPSTREAM_RELEASE_IDENTITY_DRIFT", ...intake.impact.classifications])]
    : intake.impact.classifications;
  const title = `# OpenClaw ${intake.upstream.version} Compatibility Review`;
  const checks = intake.certification.requiredChecks.length > 0
    ? intake.certification.requiredChecks.map((check) => [
        `- [ ] ${sanitizeIssueText(check.label)}`,
        `  - Reason: ${sanitizeIssueText(check.reason)}`,
        ...check.commands.map((command) => `  - Command/reference: \`${sanitizeIssueText(command).replace(/`/g, "'")}\``)
      ].join("\n")).join("\n")
    : "- [ ] Decide the reduced certification scope from the static evidence.";
  const notes = intake.releaseNotes.excerpt
    ? `<details>\n<summary>Bounded upstream release-note excerpt</summary>\n\n${formatReleaseNoteExcerpt(intake.releaseNotes.excerpt)}\n\n</details>`
    : "No release-note body was available from the official GitHub release.";
  const drift = options.identityDrift
    ? [
        "## Integrity warning",
        "",
        "`UPSTREAM_RELEASE_IDENTITY_DRIFT`: this release version was previously ingested with different identity evidence.",
        `Previous identity hash: \`${sanitizeIssueText(options.previousIdentityHash ?? "unknown")}\``,
        "Do not certify or promote this release until the upstream discrepancy is resolved."
      ].join("\n")
    : "";
  const evidenceWarning = intake.impact.classifications.includes("DISCOVERY_INCOMPLETE")
    ? [
        "## Evidence status",
        "",
        "**Static evidence incomplete — certification blocked.**",
        "A verified release identity does not prove that compatibility contract evidence is complete. Resolve the outstanding identity or contract evidence before certification."
      ].join("\n")
    : "";

  return [
    "<!-- agentos-intake:auto:start -->",
    title,
    "",
    `<!-- agentos-openclaw-intake-hash:${intake.intakeHash} -->`,
    `<!-- agentos-openclaw-identity-hash:${intake.identity.identityHash} -->`,
    `**Status:** NOT CERTIFIED  \n**Risk:** ${classifications.join(" + ")}  \n**Static severity:** ${intake.impact.severity.toUpperCase()}`,
    "",
    "## Current AgentOS policy",
    `- Recommended OpenClaw: \`${sanitizeIssueText(intake.agentos.recommendedOpenClaw)}\``,
    `- Supported minimum: \`${sanitizeIssueText(intake.agentos.supportedBaselineOpenClaw)}\``,
    `- Native contract target: \`${sanitizeIssueText(intake.agentos.nativeContractOpenClaw)}\``,
    `- Exact manifest status for this release: **${intake.manifest.status}**${intake.manifest.reason ? ` — ${sanitizeIssueText(intake.manifest.reason)}` : ""}`,
    "",
    "## Version and provenance roles",
    `- Supported minimum: **${intake.versionRoles.supportedMinimum.status}** — \`${sanitizeIssueText(intake.versionRoles.supportedMinimum.version ?? "unavailable")}\``,
    `- Recommended version: **${intake.versionRoles.recommended.status}** — \`${sanitizeIssueText(intake.versionRoles.recommended.version ?? "unavailable")}\``,
    `- Native contract: **${intake.versionRoles.nativeContract.status}** — \`${sanitizeIssueText(intake.versionRoles.nativeContract.version ?? "unavailable")}\``,
    `- Package versions: OpenClaw \`${sanitizeIssueText(intake.versionRoles.packageVersions.openClaw.version ?? "unavailable")}\`, Gateway client \`${sanitizeIssueText(intake.versionRoles.packageVersions.gatewayClient.version ?? "unavailable")}\`, Gateway protocol \`${sanitizeIssueText(intake.versionRoles.packageVersions.gatewayProtocol.version ?? "unavailable")}\``,
    `- Deployment pin: **${intake.versionRoles.deploymentPin.status}** — ${sanitizeIssueText(intake.versionRoles.deploymentPin.evidence)}`,
    `- Migration source/target: \`${sanitizeIssueText(intake.versionRoles.migration.sourceVersion ?? "unavailable")}\` → \`${sanitizeIssueText(intake.versionRoles.migration.targetVersion ?? "unavailable")}\`; **${intake.versionRoles.migration.status}**`,
    `- Certified identity: **${intake.versionRoles.certifiedIdentity.status}** — \`${sanitizeIssueText(intake.versionRoles.certifiedIdentity.version ?? "unavailable")}\` / \`${sanitizeIssueText(intake.versionRoles.certifiedIdentity.sourceCommit ?? "unavailable")}\``,
    `- Live runtime: **${intake.versionRoles.liveRuntime.status}** — ${sanitizeIssueText(intake.versionRoles.liveRuntime.evidence)}`,
    `- Version-default expectation: **${intake.compatibilityExpectation.epistemicStatus}**; native call observed: **${intake.compatibilityExpectation.nativeCallObserved ? "yes" : "no"}**; capability metadata observed: **${intake.compatibilityExpectation.capabilityMetadataObserved ? "yes" : "no"}**.`,
    "",
    "## Upstream identity",
    `- Version: \`${sanitizeIssueText(intake.upstream.version)}\``,
    `- Tag: \`${sanitizeIssueText(intake.upstream.tag)}\``,
    `- Source commit: \`${sanitizeIssueText(intake.upstream.sourceCommit ?? "unavailable")}\``,
    `- Build ID: \`${sanitizeIssueText(intake.upstream.buildId ?? "unavailable")}\``,
    `- Package integrity: \`${sanitizeIssueText(intake.upstream.packageIntegrity ?? "unavailable")}\``,
    `- Gateway protocol package: \`${sanitizeIssueText(intake.upstream.gatewayProtocolPackage ?? "unavailable")}\``,
    `- Gateway client package: \`${sanitizeIssueText(intake.upstream.gatewayClientPackage ?? "unavailable")}\``,
    `- Published: \`${sanitizeIssueText(intake.upstream.publishedAt ?? "unavailable")}\``,
    `- Release: ${sanitizeIssueText(intake.upstream.releaseUrl ?? "unavailable")}`,
    `- Identity verification: **${intake.identity.status}**`,
    ...(intake.identity.mismatches.length > 0 ? ["- Identity mismatches:", ...intake.identity.mismatches.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    ...(intake.identity.missingEvidence.length > 0 ? ["- Missing evidence:", ...intake.identity.missingEvidence.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    "",
    "## Contract evidence",
    `- Methods added: ${formatValues(intake.contractDiff.methodsAdded)}`,
    `- Methods removed: ${formatValues(intake.contractDiff.methodsRemoved)}`,
    `- Scope changes: ${formatValues(intake.contractDiff.scopesChanged)}`,
    `- Request/response schema changes: ${formatValues([...intake.contractDiff.requestSchemasChanged, ...intake.contractDiff.responseSchemasChanged])}`,
    `- Config/default changes: ${formatValues([...intake.contractDiff.configKeysAdded, ...intake.contractDiff.configKeysRemoved, ...intake.contractDiff.configDefaultsChanged])}`,
    `- Protocol changed: **${intake.contractDiff.protocolChanged ? "yes" : "no"}**`,
    `- Durable/update contract changed: **${intake.contractDiff.updateContractChanged ? "yes" : "no"}**`,
    `- Session contract changed: **${intake.contractDiff.sessionContractChanged ? "yes" : "no"}**`,
    `- Changed files observed: ${intake.contractDiff.changedFiles.length}`,
    ...(intake.contractDiff.evidenceGaps.length > 0 ? ["- Evidence gaps:", ...intake.contractDiff.evidenceGaps.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    evidenceWarning,
    "",
    "## AgentOS impact",
    `- Affected modules: ${formatValues(intake.impact.affectedAgentOsModules)}`,
    `- Changed domains: ${formatValues(intake.impact.changedDomains)}`,
    ...intake.impact.rationale.map((value) => `- ${sanitizeIssueText(value)}`),
    "",
    "## Release-watch lifecycle",
    `- Current stage: **${intake.lifecycle.currentStage}**`,
    `- Non-mutating intake: **${intake.lifecycle.nonMutating ? "yes" : "no"}**`,
    ...intake.lifecycle.stages.map((stage) => `- ${stage.label}: **${stage.status}** — ${stage.evidence.map((value) => sanitizeIssueText(value)).join(" ")}`),
    "",
    "## Release-note signals",
    `- Signals: ${formatValues(intake.releaseNotes.signals)}`,
    notes,
    "",
    "## Required certification",
    checks,
    "",
    "## Automatic actions not performed",
    ...intake.certification.automaticActionsPerformed.map((value) => `- ${sanitizeIssueText(value)}`),
    "",
    "Certification remains an explicit human-reviewed Compatibility Lab decision. Closing this issue does not change the AgentOS compatibility manifest.",
    drift,
    "<!-- agentos-intake:auto:end -->"
  ].join("\n");
}

function identityRoleStatus(status: OpenClawReleaseIdentity["status"]): "verified" | "unverified" | "mismatch" {
  if (status === "verified") return "verified";
  if (status === "identity-mismatch") return "mismatch";
  return "unverified";
}

function formatPackageIdentity(identity: OpenClawReleaseIdentity["gatewayProtocolPackage"]) {
  return identity.version ? `${identity.packageName}@${identity.version}` : null;
}

function formatValues(values: string[]) {
  return values.length > 0 ? values.map((value) => `\`${sanitizeIssueText(value).replace(/`/g, "'")}\``).join(", ") : "none observed";
}

function formatReleaseNoteExcerpt(value: string) {
  return value
    .split("\n")
    .map((line) => `> ${sanitizeIssueText(line)}`)
    .join("\n");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
