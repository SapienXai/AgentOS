#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AgentOS runtime changes require fresh certification. Documentation and the
 * independently validated OpenClaw CLI package have separate validation
 * boundaries; all other paths remain conservatively behavior-affecting.
 */
export const CERTIFICATION_DOCUMENTATION_PATH_RULES = [
  /^docs(?:\/|$)/i,
  /^README(?:\..+)?$/i,
  /^CHANGELOG(?:\..+)?$/i,
  /^SECURITY\.md$/i
];

export const CERTIFICATION_INDEPENDENT_PACKAGE_PATH_RULES = [
  /^packages\/openclaw-agentos(?:\/|$)/i,
  /^\.github\/workflows\/openclaw-agentos-(?:package|skill)-publish\.yml$/i
];

export const CERTIFICATION_POLICY_TOOLING_PATH_RULES = [
  /^scripts\/check-certification-freshness\.mjs$/i,
  /^tests\/certification-freshness\.test\.ts$/i
];

export function isCertificationDocumentationPath(filePath) {
  return CERTIFICATION_DOCUMENTATION_PATH_RULES.some((rule) => rule.test(filePath));
}

function matchesAnyRule(filePath, rules) {
  return rules.some((rule) => rule.test(filePath));
}

export function classifyCertificationChangedPaths(changedPaths) {
  const uniquePaths = [...new Set(changedPaths.filter((filePath) => typeof filePath === "string" && filePath.length > 0))];
  const documentationOnlyPaths = uniquePaths.filter(isCertificationDocumentationPath);
  const independentPackagePaths = uniquePaths.filter((filePath) => matchesAnyRule(filePath, CERTIFICATION_INDEPENDENT_PACKAGE_PATH_RULES));
  const certificationPolicyPaths = uniquePaths.filter((filePath) => matchesAnyRule(filePath, CERTIFICATION_POLICY_TOOLING_PATH_RULES));
  const hasIndependentPackageSource = uniquePaths.some((filePath) => /^packages\/openclaw-agentos(?:\/|$)/i.test(filePath));
  const hasOnlyIndependentPackageChanges = uniquePaths.every((filePath) =>
    isCertificationDocumentationPath(filePath) ||
    matchesAnyRule(filePath, CERTIFICATION_INDEPENDENT_PACKAGE_PATH_RULES) ||
    matchesAnyRule(filePath, CERTIFICATION_POLICY_TOOLING_PATH_RULES) ||
    (filePath === "pnpm-lock.yaml" && hasIndependentPackageSource)
  );
  const runtimeNeutralCertificationPolicyPaths = hasIndependentPackageSource && hasOnlyIndependentPackageChanges
    ? certificationPolicyPaths
    : [];
  const packageLockPaths = hasIndependentPackageSource && hasOnlyIndependentPackageChanges
    ? uniquePaths.filter((filePath) => filePath === "pnpm-lock.yaml")
    : [];
  const runtimeNeutralPackagePaths = [...independentPackagePaths, ...packageLockPaths];
  const meaningfulPaths = uniquePaths.filter((filePath) =>
    !isCertificationDocumentationPath(filePath) &&
    !matchesAnyRule(filePath, CERTIFICATION_INDEPENDENT_PACKAGE_PATH_RULES) &&
    !runtimeNeutralCertificationPolicyPaths.includes(filePath) &&
    !packageLockPaths.includes(filePath)
  );

  return {
    changedPaths: uniquePaths,
    documentationOnlyPaths,
    independentPackagePaths: runtimeNeutralPackagePaths,
    certificationPolicyPaths,
    meaningfulPaths
  };
}

export function evaluateCertificationFreshness({
  certifiedCodeHead,
  currentHead,
  changedPaths,
  certifiedCodeIsAncestor = true,
  certificationSuccess = true
}) {
  const classification = classifyCertificationChangedPaths(changedPaths);

  if (!certificationSuccess) {
    return {
      ok: false,
      status: "certification-failed",
      reason: "The final certification artifact does not report success.",
      certifiedCodeHead,
      currentHead,
      ...classification
    };
  }

  if (!certifiedCodeHead) {
    return {
      ok: false,
      status: "missing-certified-head",
      reason: "The final certification artifact has no provenance.certifiedCodeHead.",
      certifiedCodeHead: null,
      currentHead,
      ...classification
    };
  }

  if (!certifiedCodeIsAncestor) {
    return {
      ok: false,
      status: "certified-head-not-ancestor",
      reason: "The certified code HEAD is not an ancestor of the current HEAD; certification provenance cannot be trusted for this checkout.",
      certifiedCodeHead,
      currentHead,
      ...classification
    };
  }

  if (certifiedCodeHead === currentHead || classification.meaningfulPaths.length === 0) {
    const independentPackageChanged = classification.independentPackagePaths.length > 0;
    const certificationPolicyChanged = classification.certificationPolicyPaths.length > 0;
    const documentationOnly = !independentPackageChanged && !certificationPolicyChanged;

    return {
      ok: true,
      status: certifiedCodeHead === currentHead
        ? "fresh"
        : documentationOnly
          ? "fresh-documentation-only"
          : independentPackageChanged
            ? "fresh-independent-package-only"
            : "fresh-certification-policy-only",
      reason: certifiedCodeHead === currentHead
        ? "Current HEAD is the certified code HEAD."
        : independentPackageChanged
          ? "Only documentation, certification tooling, and the independently validated OpenClaw CLI package changed after AgentOS runtime certification."
          : certificationPolicyChanged
            ? "Only documentation/evidence and certification policy tooling paths changed after the certified code HEAD."
            : "Only documentation/evidence paths changed after the certified code HEAD.",
      certifiedCodeHead,
      currentHead,
      ...classification
    };
  }

  return {
    ok: false,
    status: "recertification-required",
    reason: "Meaningful repository paths changed after certification.",
    certifiedCodeHead,
    currentHead,
    ...classification
  };
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repo-root" || argument === "--evidence" || argument === "--version") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function readPolicyConstant(source, name) {
  const match = source.match(new RegExp(`export\\s+const\\s+${name}\\s*(?::\\s*[^=]+)?=\\s*["']([^"']+)["']`));
  return match?.[1] ?? null;
}

function isOpenClawReleaseVersion(value) {
  return typeof value === "string" && /^\d{4}\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(value);
}

export function getCertificationEvidencePathForVersion(version, phase = "pre-merge-final-certification") {
  if (!isOpenClawReleaseVersion(version)) {
    throw new Error(`Invalid OpenClaw certification version: ${String(version)}`);
  }
  if (!/^[a-z0-9-]+$/.test(phase)) {
    throw new Error("OpenClaw certification phase is invalid.");
  }
  return `docs/evidence/openclaw-${version}-${phase}.json`;
}

export function getCurrentCertificationTarget(repoRoot) {
  const policyPath = path.join(repoRoot, "lib/openclaw/versions.ts");
  const source = readFileSync(policyPath, "utf8");
  const recommendedVersion = readPolicyConstant(source, "OPENCLAW_RECOMMENDED_VERSION");
  const nativeContractVersion = readPolicyConstant(source, "OPENCLAW_NATIVE_CONTRACT_VERSION");
  const phase = readPolicyConstant(source, "OPENCLAW_FINAL_CERTIFICATION_PHASE");

  if (!isOpenClawReleaseVersion(recommendedVersion) || !isOpenClawReleaseVersion(nativeContractVersion)) {
    throw new Error("Could not read valid recommended and native-contract OpenClaw versions from lib/openclaw/versions.ts.");
  }
  if (recommendedVersion !== nativeContractVersion) {
    throw new Error("Recommended and native-contract OpenClaw versions differ; the current certification target is ambiguous.");
  }
  if (!phase || !/^[a-z0-9-]+$/.test(phase)) {
    throw new Error("Could not read a valid OpenClaw final certification phase from lib/openclaw/versions.ts.");
  }

  return {
    version: nativeContractVersion,
    phase,
    evidencePath: getCertificationEvidencePathForVersion(nativeContractVersion, phase)
  };
}

function versionFromEvidencePath(evidencePath) {
  const match = String(evidencePath).match(/(?:^|\/)openclaw-(\d{4}\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)-[a-z0-9-]+\.json$/);
  return match?.[1] ?? null;
}

export function resolveCertificationEvidenceSelection({ repoRoot, evidencePath, version } = {}) {
  if (version && !isOpenClawReleaseVersion(version)) {
    throw new Error(`Invalid OpenClaw certification version: ${String(version)}`);
  }

  if (evidencePath) {
    const inferredVersion = version || versionFromEvidencePath(evidencePath);
    return { evidencePath, version: inferredVersion };
  }

  if (version) {
    const current = getCurrentCertificationTarget(repoRoot);
    return { evidencePath: getCertificationEvidencePathForVersion(version, current.phase), version };
  }

  return getCurrentCertificationTarget(repoRoot);
}

function runGit(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function resolveCommit(repoRoot, value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/i.test(value.trim())) {
    return null;
  }

  try {
    const resolved = runGit(repoRoot, ["rev-parse", "--verify", `${value.trim()}^{commit}`]).toLowerCase();
    return /^[0-9a-f]{40}$/.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function isAncestor(repoRoot, ancestor, descendant) {
  try {
    execFileSync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

function readChangedPaths(repoRoot, certifiedCodeHead, currentHead) {
  if (certifiedCodeHead === currentHead) {
    return [];
  }

  const output = execFileSync(
    "git",
    ["-C", repoRoot, "diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", `${certifiedCodeHead}..${currentHead}`],
    { encoding: "utf8" }
  );
  const tokens = output.split("\0");
  const paths = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }

    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      const filePath = tokens[index++];
      if (filePath) {
        paths.push(filePath);
      }
    }
  }

  return paths;
}

export function checkCertificationFreshness({
  repoRoot,
  evidencePath,
  expectedVersion,
  currentHead = runGit(repoRoot, ["rev-parse", "HEAD"])
}) {
  const selection = resolveCertificationEvidenceSelection({ repoRoot, evidencePath, version: expectedVersion });
  evidencePath = selection.evidencePath;
  const artifact = JSON.parse(readFileSync(path.resolve(repoRoot, evidencePath), "utf8"));
  const actualVersion = artifact?.openclawVersion;
  const certificationVersion = selection.version || actualVersion;
  const policySource = readFileSync(path.join(repoRoot, "lib/openclaw/versions.ts"), "utf8");
  const phase = readPolicyConstant(policySource, "OPENCLAW_FINAL_CERTIFICATION_PHASE");
  const expectedArtifactType = isOpenClawReleaseVersion(certificationVersion) && phase
    ? `openclaw-${certificationVersion}-${phase}`
    : null;
  const targetMatches = Boolean(
    isOpenClawReleaseVersion(certificationVersion) &&
    actualVersion === certificationVersion &&
    artifact?.artifactType === expectedArtifactType
  );
  if (!targetMatches) {
    return {
      ok: false,
      status: "certification-target-mismatch",
      reason: `The evidence identity does not match the requested certification target ${certificationVersion || "unknown"}.`,
      certifiedCodeHead: null,
      currentHead,
      changedPaths: [],
      documentationOnlyPaths: [],
      independentPackagePaths: [],
      certificationPolicyPaths: [],
      meaningfulPaths: [],
      expectedVersion: certificationVersion || null,
      actualVersion: typeof actualVersion === "string" ? actualVersion : null,
      expectedArtifactType
    };
  }
  const certifiedCodeHead = artifact?.provenance?.certifiedCodeHead?.trim?.().toLowerCase?.() || null;
  const resolvedCertifiedCodeHead = resolveCommit(repoRoot, certifiedCodeHead);
  const resolvedCurrentHead = resolveCommit(repoRoot, currentHead);
  const currentHeadIsValid = Boolean(resolvedCurrentHead);
  const certifiedCodeIsAncestor = Boolean(
    resolvedCertifiedCodeHead &&
    resolvedCurrentHead &&
    isAncestor(repoRoot, resolvedCertifiedCodeHead, resolvedCurrentHead)
  );
  const changedPaths = resolvedCertifiedCodeHead && resolvedCurrentHead && certifiedCodeIsAncestor
    ? readChangedPaths(repoRoot, resolvedCertifiedCodeHead, resolvedCurrentHead)
    : [];
  const result = evaluateCertificationFreshness({
    certifiedCodeHead: resolvedCertifiedCodeHead,
    currentHead: resolvedCurrentHead || currentHead,
    changedPaths,
    certifiedCodeIsAncestor: currentHeadIsValid && certifiedCodeIsAncestor,
    certificationSuccess: artifact?.success === true
  });

  if (!currentHeadIsValid && result.status !== "certification-failed") {
    return {
      ...result,
      ok: false,
      status: "current-head-invalid",
      reason: "The current HEAD does not resolve to a Git commit in the repository."
    };
  }

  return { ...result, expectedVersion: certificationVersion, evidencePath };
}

function formatResult(result, evidencePath) {
  const lines = [
    `Certification freshness: ${result.ok ? "PASS" : "FAIL"}`,
    `OpenClaw target: ${result.expectedVersion || "unknown"}`,
    `Evidence: ${evidencePath}`,
    `Certified code HEAD: ${result.certifiedCodeHead || "missing"}`,
    `Current HEAD: ${result.currentHead || "missing"}`,
    `Status: ${result.status}`,
    `Reason: ${result.reason}`
  ];

  if (result.meaningfulPaths.length > 0) {
    lines.push("Meaningful paths changed after certification:", ...result.meaningfulPaths.map((filePath) => `- ${filePath}`));
  }

  if (result.documentationOnlyPaths.length > 0) {
    lines.push("Documentation/evidence-only paths allowed after certification:", ...result.documentationOnlyPaths.map((filePath) => `- ${filePath}`));
  }

  if (result.independentPackagePaths.length > 0) {
    lines.push("Independently validated OpenClaw plugin package paths:", ...result.independentPackagePaths.map((filePath) => `- ${filePath}`));
  }

  if (result.certificationPolicyPaths.length > 0) {
    lines.push("Certification policy tooling paths:", ...result.certificationPolicyPaths.map((filePath) => `- ${filePath}`));
  }

  if (!result.ok && result.status === "recertification-required") {
    lines.push("Recertification is required before this HEAD can be represented as certified.");
  }

  return lines.join("\n");
}

export function main(argv = process.argv.slice(2)) {
  let options;

  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return null;
  }

  const repoRoot = path.resolve(options["repo-root"] || process.cwd());
  try {
    const evidencePath = options.evidence || process.env.OPENCLAW_CERTIFICATION_FRESHNESS_EVIDENCE || undefined;
    const selection = resolveCertificationEvidenceSelection({ repoRoot, evidencePath, version: options.version });
    const result = checkCertificationFreshness({ repoRoot, evidencePath: selection.evidencePath, expectedVersion: selection.version });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result, selection.evidencePath));
    }
    if (!result.ok) {
      process.exitCode = 1;
    }
    return result;
  } catch (error) {
    console.error(`Certification freshness: FAIL\nReason: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
