import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { OPENCLAW_IDENTITY_CONTRACT_BUILD, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT } from "@/lib/openclaw/identity/contract";
import { checkCertificationFreshness } from "@/scripts/check-certification-freshness.mjs";
import { loadOpenClawCertifiedEvidence } from "@/scripts/openclaw-release-watch";

const cliPlatforms = {
  "darwin-arm64": { platform: "cli-macos-arm64", runner: "macos-15" },
  "darwin-x64": { platform: "cli-macos-x64", runner: "macos-15-intel" },
  "win32-x64": { platform: "cli-windows-x64", runner: "windows-latest" },
  "linux-x64": { platform: "cli-linux-x64", runner: "ubuntu-latest" }
} as const;

const desktopPackages = [
  { name: "macos-arm64.dmg", platform: "macos-arm64", launch: "macos-arm64", target: "darwin-aarch64-app", update: "macos-arm64.app.tar.gz", checks: ["cleanInstall", "distributionSigning", "notarization", "autoUpdate"] },
  { name: "windows-x64-setup.exe", platform: "windows-x64", launch: "windows-x64", target: "windows-x86_64-nsis", update: "windows-x64-setup.exe", checks: ["cleanInstall", "distributionSigning", "autoUpdate"] },
  { name: "linux-x64.AppImage", platform: "linux-x64", launch: "linux-x64-appimage", target: "linux-x86_64-appimage", update: "linux-x64.AppImage", checks: ["cleanInstall", "updaterSignature", "autoUpdate"] },
  { name: "linux-x64.deb", platform: "linux-x64", launch: "linux-x64-deb", target: "linux-x86_64-deb", update: "linux-x64.deb", checks: ["cleanInstall", "updaterSignature", "autoUpdate"] },
  { name: "linux-x64.rpm", platform: "linux-x64", launch: "linux-x64-rpm", target: "linux-x86_64-rpm", update: "linux-x64.rpm", checks: ["cleanInstall", "updaterSignature", "autoUpdate"] }
] as const;

const acceptanceSchema = z.object({
  version: z.string(),
  candidateCommit: z.string().regex(/^[0-9a-f]{40}$/),
  releaseArtifact: z.object({
    runId: z.number().int().positive(),
    id: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    cliArchiveProofs: z.record(z.string().regex(/^[0-9a-f]{64}$/)).default({})
  }).optional(),
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

  const pass = (platform: string, check: string) => acceptance.checks[platform]?.[check]?.status === "PASS";
  if (process.argv.includes("--plan")) {
    const { releaseArtifact } = acceptance;
    if (!releaseArtifact) throw new Error("The certified release artifact must be identified.");
    const targets = Object.keys(cliPlatforms) as (keyof typeof cliPlatforms)[];
    const cli = targets.filter((target) => pass(cliPlatforms[target].platform, "cleanInstall"));
    const cliProofs = Object.fromEntries(cli.flatMap((target) => {
      const digest = releaseArtifact.cliArchiveProofs[target];
      return digest && pass(cliPlatforms[target].platform, "updateCheck") ? [[target, digest] as const] : [];
    }));
    const cliSmokes = cli.flatMap((target) => cliProofs[target] ? [] : [{ target, runner: cliPlatforms[target].runner }]);
    const desktop = desktopPackages.map(({ name, update, launch, platform, target, checks }) => {
      const provenLaunch = pass(launch, "packagedLaunch");
      const stable = provenLaunch && checks.every((check) => pass(platform, check));
      return {
        name: `AgentOS-${version}-${name}`,
        update: `AgentOS-${version}-${update}`,
        target,
        channel: stable ? "stable" : provenLaunch ? "preview" : "withheld",
        verifyInstaller: launch === "windows-x64"
      };
    });
    console.log(JSON.stringify({ version, commit: freshness.certifiedCodeHead, source: releaseArtifact, cli, cliProofs, cliSmokes, desktop }));
    return;
  }

  const missing = Object.values(cliPlatforms).map(({ platform }) => platform)
    .filter((platform) => !pass(platform, "cleanInstall") || !pass(platform, "updateCheck"));
  if (missing.length) throw new Error(`Missing CLI package acceptance for ${missing.join(", ")}.`);
  console.log(`CLI package acceptance: PASS for AgentOS ${version} with OpenClaw ${freshness.expectedVersion}.`);
}

main().catch((error) => {
  console.error(`Production release gate: FAIL. ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
