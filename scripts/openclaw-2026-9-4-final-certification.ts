import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import {
  OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";

const TARGET_VERSION = "2026.9.4";
const TARGET_COMMIT = "3a9d69db306cd7f081e06254cb89c4bcc14a7107";
const TARGET_BUILD = "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z";
const PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_9_4_PACKAGE?.trim();
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_FINAL_CERTIFICATION_9_4_OUTPUT?.trim() || `docs/evidence/openclaw-${TARGET_VERSION}-final-certification.json`);

const REQUIRED_ARTIFACTS = [
  ["contract-diff", `docs/evidence/openclaw-2026.9.3-to-${TARGET_VERSION}-contract-diff.json`],
  ["fresh-baseline", `docs/evidence/openclaw-${TARGET_VERSION}-fresh-baseline.json`],
  ["runtime", `docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`],
  ["migration", `docs/evidence/openclaw-2026.9.3-to-${TARGET_VERSION}-migration.json`],
  ["lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-lifecycle-certification.json`],
  ["identity", `docs/evidence/openclaw-${TARGET_VERSION}-identity-authorization.json`],
  ["multi-user", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user.json`],
  ["multi-user-collaboration", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user-identity-collaboration.json`],
  ["automation", `docs/evidence/openclaw-${TARGET_VERSION}-automation-cron-alignment.json`],
  ["session-task", `docs/evidence/openclaw-${TARGET_VERSION}-session-task-alignment.json`],
  ["workforce", `docs/evidence/openclaw-${TARGET_VERSION}-workforce-acceptance.json`],
  ["official-transport", `docs/evidence/openclaw-${TARGET_VERSION}-official-transport-certification.json`],
  ["official-lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-official-gateway-lifecycle-certification.json`],
  ["official-production", `docs/evidence/openclaw-${TARGET_VERSION}-final-official-runtime-certification.json`],
  ["native-work", `docs/evidence/openclaw-${TARGET_VERSION}-native-work-hardening.json`],
  ["skills", `docs/evidence/openclaw-${TARGET_VERSION}-skills-effective-capabilities.json`],
  ["memory", `docs/evidence/openclaw-${TARGET_VERSION}-native-memory.json`],
  ["doctor", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery.json`],
  ["doctor-hardening", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery-hardening.json`],
  ["human-control", `docs/evidence/openclaw-${TARGET_VERSION}-human-control-inbox.json`]
] as const;

type JsonRecord = Record<string, unknown>;

async function main() {
  const failures: string[] = [];
  const artifacts: Record<string, JsonRecord> = {};
  const matrix: Record<string, Record<string, unknown>> = {};
  const packageIdentity = PACKAGE_INPUT ? await readPackageIdentity(path.resolve(PACKAGE_INPUT)).catch((error) => {
    failures.push(`cannot inspect exact OpenClaw package: ${safeError(error)}`);
    return null;
  }) : null;
  if (!PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_9_4_PACKAGE is not set");
  if (OPENCLAW_RECOMMENDED_VERSION !== TARGET_VERSION || OPENCLAW_NATIVE_CONTRACT_VERSION !== TARGET_VERSION || OPENCLAW_IDENTITY_CONTRACT_VERSION !== TARGET_VERSION) {
    failures.push("AgentOS recommended, native, and identity contracts are not promoted to 2026.9.4");
  }
  if (OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT !== TARGET_COMMIT || OPENCLAW_IDENTITY_CONTRACT_BUILD !== TARGET_BUILD || OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL !== 4 || OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA !== 17 || OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA !== 19) {
    failures.push("AgentOS identity contract does not match the verified 2026.9.4 identity");
  }
  if (!packageIdentity) {
    // Keep the report deterministic; the failure has already been recorded.
  } else if (packageIdentity.version !== TARGET_VERSION || packageIdentity.sourceCommit !== TARGET_COMMIT || packageIdentity.buildId !== TARGET_BUILD || packageIdentity.stateSchema !== 17 || packageIdentity.agentSchema !== 19) {
    failures.push("exact 2026.9.4 package identity, build, or schema does not match the verified target");
  }

  for (const [name, relativePath] of REQUIRED_ARTIFACTS) {
    try {
      const artifact = JSON.parse(await readFile(path.resolve(relativePath), "utf8")) as JsonRecord;
      artifacts[name] = artifact;
      const result = assessArtifact(name, artifact);
      matrix[name] = { path: relativePath, ...result };
      if (result.status !== "PASS") failures.push(`${name}: ${String(result.reason ?? "artifact did not pass")}`);
    } catch (error) {
      matrix[name] = { path: relativePath, status: "FAIL", skips: 0, environmentLimited: 0, expectedDenials: 0, reason: safeError(error) };
      failures.push(`${name}: ${safeError(error)}`);
    }
  }

  const contract = artifacts["contract-diff"];
  const migration = artifacts.migration;
  if (contract?.success !== true || !Object.values(asRecord(contract?.checks)).every(Boolean)) failures.push("contract audit checks are incomplete");
  if (migration?.success !== true || !Object.values(asRecord(migration?.checks)).every(Boolean)) failures.push("9.3 to 9.4 migration checks are incomplete");

  const report = {
    schemaVersion: 1,
    artifactType: "openclaw-2026.9.4-final-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosCodeHead: await gitOutput(["rev-parse", "HEAD"]),
      branch: await gitOutput(["branch", "--show-current"]),
      node: process.version,
      openClaw: packageIdentity,
      expectedOpenClaw: { version: TARGET_VERSION, tag: "v2026.9.4", signedTagObject: "8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e", sourceCommit: TARGET_COMMIT, buildId: TARGET_BUILD, gatewayProtocol: 4, stateSchema: 17, agentSchema: 19, gatewayClient: TARGET_VERSION, gatewayProtocolPackage: TARGET_VERSION },
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      agentosContract: {
        recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
        nativeContractVersion: OPENCLAW_NATIVE_CONTRACT_VERSION,
        identityContractVersion: OPENCLAW_IDENTITY_CONTRACT_VERSION,
        sourceCommit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
        buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD,
        gatewayProtocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
        stateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
        agentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA
      }
    },
    matrix,
    classification: {
      pass: Object.values(matrix).filter((entry) => entry.status === "PASS").length,
      fail: Object.values(matrix).filter((entry) => entry.status === "FAIL").length,
      skipped: Object.values(matrix).reduce((sum, entry) => sum + Number(entry.skips ?? 0), 0),
      environmentLimited: Object.values(matrix).reduce((sum, entry) => sum + Number(entry.environmentLimited ?? 0), 0),
      expectedAuthorizationDenials: Object.values(matrix).reduce((sum, entry) => sum + Number(entry.expectedDenials ?? 0), 0),
      productionGatewayTouched: false,
      realCredentialsAccessed: false
    },
    promotion: { recommendedVersion: TARGET_VERSION, nativeContractVersion: TARGET_VERSION, supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION, decision: failures.length === 0 ? "PROMOTE" : "BLOCK" },
    failures,
    success: failures.length === 0
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${TARGET_VERSION} FINAL CERTIFICATION: ${report.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!report.success) process.exitCode = 1;
}

function assessArtifact(name: string, artifact: JsonRecord) {
  const statuses = collectStatusValues(artifact);
  const failures: string[] = [];
  if (name === "contract-diff") {
    const target = asRecord(asRecord(artifact.provenance)?.target);
    const checks = asRecord(artifact.checks);
    if (target?.version !== TARGET_VERSION || target?.sourceCommit !== TARGET_COMMIT || target?.stateSchema !== 17 || target?.agentSchema !== 19 || target?.protocol !== 4) failures.push("contract target identity/schema/protocol mismatch");
    if (!Object.values(checks).every(Boolean)) failures.push("contract audit contains a failed check");
  } else if (name === "migration") {
    if (artifact.success !== true) failures.push("migration success is not true");
    if (!Object.values(asRecord(artifact.checks)).every(Boolean)) failures.push("migration contains a failed check");
  } else if (name === "runtime") {
    const runtime = asRecord(artifact.runtime);
    const summary = asRecord(runtime?.summary);
    if (runtime?.targetVersion !== TARGET_VERSION || runtime?.installedVersion !== TARGET_VERSION || runtime?.protocolVersion !== 4) failures.push("runtime target identity or protocol mismatch");
    if (summary?.failed !== 0 || summary?.requiredFailures !== 0 || summary?.unknown !== 0) failures.push("runtime contains failures, required failures, or unknown outcomes");
  } else if (name === "workforce") {
    if (asRecord(artifact.summary).failed !== 0) failures.push("workforce summary contains failures");
  } else if (name === "official-transport") {
    const requests = asRecord(artifact.requests);
    const denial = asRecord(artifact.authorizationDenial);
    if (Object.values(requests).some((entry) => asRecord(entry).status !== "passed") || denial.status !== "denied" || asRecord(artifact.target).protocol !== 4) {
      failures.push("official transport probes or expected authorization denial failed");
    }
  } else if (artifact.success !== true && !(typeof artifact.gate === "string" && artifact.gate.endsWith("PASS")) && artifact.result !== "PASS") {
    failures.push("artifact success/gate/result is not PASS");
  }
  if (statuses.includes("FAIL") || statuses.includes("UNKNOWN")) failures.push("artifact contains FAIL or UNKNOWN status");
  if (!collectStrings(artifact).includes(TARGET_VERSION)) failures.push(`artifact does not identify OpenClaw ${TARGET_VERSION}`);
  return { status: failures.length === 0 ? "PASS" : "FAIL", skips: statuses.filter((value) => value === "SKIPPED").length, environmentLimited: statuses.filter((value) => value === "ENVIRONMENT-LIMITED").length, expectedDenials: statuses.filter((value) => value === "EXPECTED-DENIAL" || value === "EXPECTED_DENIAL").length, ...(failures.length ? { reason: failures.join("; ") } : {}) };
}

function collectStatusValues(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStatusValues); if (!value || typeof value !== "object") return []; const record = value as JsonRecord; const current = Object.entries(record).filter(([key, entry]) => ["status", "result", "outcome"].includes(key) && typeof entry === "string").map(([, entry]) => entry as string); return [...current, ...Object.values(record).flatMap(collectStatusValues)]; }
function collectStrings(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStrings); if (typeof value === "string") return [value]; if (!value || typeof value !== "object") return []; return Object.values(value as JsonRecord).flatMap(collectStrings); }
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
async function readPackageIdentity(packageRoot: string) { const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as JsonRecord; const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as JsonRecord; const hash = createHash("sha256"); for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(relativePath); hash.update(await readFile(path.join(packageRoot, relativePath))); } return { version: String(packageJson.version ?? ""), sourceCommit: String(buildInfo.commit ?? ""), buildId: String(buildInfo.buildId ?? ""), packageHash: hash.digest("hex"), stateSchema: Number(asRecord(packageJson.openclaw).schemaVersions ? asRecord(asRecord(packageJson.openclaw).schemaVersions).state : 0), agentSchema: Number(asRecord(asRecord(packageJson.openclaw).schemaVersions).agent ?? 0) }; }
async function gitOutput(args: string[]) { const { execFile } = await import("node:child_process"); return await new Promise<string>((resolve) => execFile("git", args, { cwd: process.cwd(), encoding: "utf8" }, (_error, stdout) => resolve(stdout.trim()))); }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error); }

void main();
