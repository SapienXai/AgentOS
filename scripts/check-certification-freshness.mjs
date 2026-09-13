#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CERTIFICATION_EVIDENCE_PATH =
  "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json";

/**
 * Only documentation and evidence paths may follow a certified code commit.
 * Everything else is conservatively treated as behavior-affecting, including
 * workflows, lockfiles, configuration, tests, and desktop/runtime files.
 */
export const CERTIFICATION_DOCUMENTATION_PATH_RULES = [
  /^docs(?:\/|$)/i,
  /^README(?:\..+)?$/i,
  /^CHANGELOG(?:\..+)?$/i,
  /^SECURITY\.md$/i
];

export function isCertificationDocumentationPath(filePath) {
  return CERTIFICATION_DOCUMENTATION_PATH_RULES.some((rule) => rule.test(filePath));
}

export function classifyCertificationChangedPaths(changedPaths) {
  const uniquePaths = [...new Set(changedPaths.filter((filePath) => typeof filePath === "string" && filePath.length > 0))];
  const documentationOnlyPaths = uniquePaths.filter(isCertificationDocumentationPath);
  const meaningfulPaths = uniquePaths.filter((filePath) => !isCertificationDocumentationPath(filePath));

  return {
    changedPaths: uniquePaths,
    documentationOnlyPaths,
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
    return {
      ok: true,
      status: certifiedCodeHead === currentHead ? "fresh" : "fresh-documentation-only",
      reason: certifiedCodeHead === currentHead
        ? "Current HEAD is the certified code HEAD."
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
    if (argument === "--repo-root" || argument === "--evidence") {
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
  evidencePath = DEFAULT_CERTIFICATION_EVIDENCE_PATH,
  currentHead = runGit(repoRoot, ["rev-parse", "HEAD"])
}) {
  const artifact = JSON.parse(readFileSync(path.resolve(repoRoot, evidencePath), "utf8"));
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

  return result;
}

function formatResult(result, evidencePath) {
  const lines = [
    `Certification freshness: ${result.ok ? "PASS" : "FAIL"}`,
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
  const evidencePath = options.evidence || process.env.OPENCLAW_CERTIFICATION_FRESHNESS_EVIDENCE || DEFAULT_CERTIFICATION_EVIDENCE_PATH;

  try {
    const result = checkCertificationFreshness({ repoRoot, evidencePath });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatResult(result, evidencePath));
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
