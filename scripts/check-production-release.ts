import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { OPENCLAW_IDENTITY_CONTRACT_BUILD, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT } from "@/lib/openclaw/identity/contract";
import { checkCertificationFreshness } from "@/scripts/check-certification-freshness.mjs";
import { loadOpenClawCertifiedEvidence } from "@/scripts/openclaw-release-watch";

const requiredChecks = {
  "macos-arm64": ["cleanInstall", "distributionSigning", "notarization", "autoUpdate"],
  "windows-x64": ["cleanInstall", "distributionSigning", "autoUpdate"],
  "linux-x64": ["cleanInstall", "updaterSignature", "autoUpdate"],
  "cli-macos-arm64": ["cleanInstall", "updateCheck"],
  "cli-macos-x64": ["cleanInstall", "updateCheck"],
  "cli-windows-x64": ["cleanInstall", "updateCheck"],
  "cli-linux-x64": ["cleanInstall", "updateCheck"],
  "ios-pwa": ["install", "authenticatedLaunch", "firstAgentReply"],
  "android-pwa": ["install", "authenticatedLaunch", "firstAgentReply"],
  onboarding: ["chatGptOAuth", "firstWorkspace", "firstAgentReply", "sessionContinuity"]
} as const;

const acceptanceSchema = z.object({
  version: z.string(),
  candidateCommit: z.string().regex(/^[0-9a-f]{40}$/),
  checks: z.record(z.record(z.object({
    status: z.enum(["PASS", "FAIL", "BLOCKED"]),
    evidence: z.string().url().refine((value) => new URL(value).protocol === "https:")
  })))
});

async function main() {
  const repoRoot = process.cwd();
  const freshness = checkCertificationFreshness({ repoRoot });
  if (!freshness.ok || !freshness.expectedVersion || !freshness.certifiedCodeHead) {
    throw new Error(freshness.reason);
  }
  const certification = await loadOpenClawCertifiedEvidence({ version: freshness.expectedVersion, repositoryPath: repoRoot });
  if (certification.status !== "found") {
    throw new Error(certification.reason);
  }
  if (certification.evidence?.sourceCommit !== OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT ||
      certification.evidence.buildId !== OPENCLAW_IDENTITY_CONTRACT_BUILD) {
    throw new Error("OpenClaw final certification must identify the exact pinned release build.");
  }

  const { version } = JSON.parse(await readFile(join(repoRoot, "packages/agentos/package.json"), "utf8"));
  const evidencePath = join(repoRoot, "docs/evidence", `agentos-${version}-production-acceptance.json`);
  const acceptance = acceptanceSchema.parse(JSON.parse(await readFile(evidencePath, "utf8")));
  if (acceptance.version !== version || acceptance.candidateCommit !== freshness.certifiedCodeHead) {
    throw new Error("Production acceptance must cover the same candidate commit as OpenClaw certification.");
  }

  const failedChecks = Object.entries(requiredChecks).flatMap(([platform, checks]) => checks
    .filter((check) => acceptance.checks[platform]?.[check]?.status !== "PASS")
    .map((check) => `${platform}.${check}`));
  if (failedChecks.length > 0) {
    throw new Error(`Missing or unsuccessful production acceptance: ${failedChecks.join(", ")}`);
  }
  console.log(`Production release gate: PASS for AgentOS ${version} with OpenClaw ${freshness.expectedVersion}.`);
}

main().catch((error) => {
  console.error(`Production release gate: FAIL. ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
