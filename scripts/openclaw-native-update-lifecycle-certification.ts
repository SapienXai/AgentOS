import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createDisposableOpenClawEnvironment } from "@/scripts/lib/disposable-openclaw-env";
import {
  OPENCLAW_CERTIFICATION_TARGET_BUILD,
  OPENCLAW_CERTIFICATION_TARGET_COMMIT,
  OPENCLAW_CERTIFICATION_TARGET_VERSION,
  OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA,
  OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA
} from "@/lib/openclaw/certification-target";
import { OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL } from "@/lib/openclaw/identity/contract";

const execFileAsync = promisify(execFile);
const TARGET_VERSION = OPENCLAW_CERTIFICATION_TARGET_VERSION;
const TARGET_COMMIT = OPENCLAW_CERTIFICATION_TARGET_COMMIT;
const TARGET_BUILD = OPENCLAW_CERTIFICATION_TARGET_BUILD;
const SOURCE_VERSION = process.env.OPENCLAW_NATIVE_UPDATE_SOURCE_VERSION?.trim() || "2026.9.7";
const UPDATE_RUN_ID = process.env.OPENCLAW_NATIVE_UPDATE_RUN_ID?.trim() || null;
const PACKAGE_ROOT = process.env.OPENCLAW_NATIVE_UPDATE_PACKAGE?.trim();
const GATEWAY_URL = process.env.OPENCLAW_NATIVE_UPDATE_GATEWAY_URL?.trim();
const GATEWAY_TOKEN = process.env.OPENCLAW_NATIVE_UPDATE_GATEWAY_TOKEN?.trim();
const STATE_DIR = process.env.OPENCLAW_NATIVE_UPDATE_STATE_DIR?.trim();
const CONFIG_PATH = process.env.OPENCLAW_NATIVE_UPDATE_CONFIG_PATH?.trim();
const HOME_DIR = process.env.OPENCLAW_NATIVE_UPDATE_HOME?.trim();
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_NATIVE_UPDATE_OUTPUT?.trim() ||
  `docs/evidence/openclaw-${TARGET_VERSION}-native-update-lifecycle.json`);

type JsonRecord = Record<string, unknown>;

async function main() {
  const failures: string[] = [];
  const packageIdentity = PACKAGE_ROOT ? await readExactPackageIdentity(path.resolve(PACKAGE_ROOT)) : null;
  const parsedUrl = GATEWAY_URL ? new URL(GATEWAY_URL) : null;
  if (!PACKAGE_ROOT || !GATEWAY_URL || !GATEWAY_TOKEN || !STATE_DIR || !CONFIG_PATH || !HOME_DIR) {
    failures.push("The exact package and isolated local Gateway connection, state, config, and HOME paths are required.");
  }
  if (parsedUrl && !["127.0.0.1", "::1", "localhost"].includes(parsedUrl.hostname)) {
    failures.push("The native update lifecycle evidence collector only accepts a loopback Gateway URL.");
  }
  if (!packageIdentity || packageIdentity.version !== TARGET_VERSION || packageIdentity.sourceCommit !== TARGET_COMMIT || packageIdentity.buildId !== TARGET_BUILD || packageIdentity.stateSchema !== OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA || packageIdentity.agentSchema !== OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA) {
    failures.push(`The supplied package does not match exact OpenClaw ${TARGET_VERSION} identity and schema evidence.`);
  }

  let health: JsonRecord = {};
  let status: JsonRecord = {};
  let updateStatus: JsonRecord = {};
  let updateRuns: JsonRecord = {};
  let configValidation: JsonRecord = {};
  if (PACKAGE_ROOT && GATEWAY_URL && GATEWAY_TOKEN && STATE_DIR && CONFIG_PATH && HOME_DIR && parsedUrl && !failures.some((failure) => failure.includes("loopback"))) {
    const packageRoot = path.resolve(PACKAGE_ROOT);
    const runtimeEnv = createDisposableOpenClawEnvironment({
      homeDir: path.resolve(HOME_DIR),
      overrides: {
        OPENCLAW_STATE_DIR: path.resolve(STATE_DIR),
        OPENCLAW_CONFIG_PATH: path.resolve(CONFIG_PATH),
        npm_config_prefix: process.env.OPENCLAW_NATIVE_UPDATE_NPM_PREFIX,
        NPM_CONFIG_PREFIX: process.env.OPENCLAW_NATIVE_UPDATE_NPM_PREFIX,
        npm_config_cache: process.env.OPENCLAW_NATIVE_UPDATE_NPM_CACHE,
        NPM_CONFIG_CACHE: process.env.OPENCLAW_NATIVE_UPDATE_NPM_CACHE
      }
    });
    const cli = path.join(packageRoot, "openclaw.mjs");
    const call = async (method: string, params?: JsonRecord) => await runJsonCommand(
      process.execPath,
      [cli, "gateway", "call", method, "--url", GATEWAY_URL, "--token", GATEWAY_TOKEN, ...(params ? ["--params", JSON.stringify(params)] : []), "--json"],
      runtimeEnv
    );
    try {
      [health, status, updateStatus, updateRuns] = await Promise.all([
        call("health"),
        call("status"),
        call("update.status"),
        call("update.runs.list", { limit: 20 })
      ]);
      configValidation = await runJsonCommand(process.execPath, [cli, "config", "validate", "--json"], runtimeEnv);
    } catch {
      failures.push("Could not establish fresh Gateway, update, run-history, and configuration truth after the native update.");
    }
  }

  const runs = Array.isArray(updateRuns.runs) ? updateRuns.runs.map(asRecord) : [];
  const nativeRun = UPDATE_RUN_ID
    ? runs.find((run) => run.runId === UPDATE_RUN_ID)
    : runs.find((run) => run.trigger === "api" && asRecord(run.target).version === TARGET_VERSION && asRecord(run.before).version === SOURCE_VERSION && asRecord(run.after).version === TARGET_VERSION);
  const repairRun = runs.find((run) => run.trigger === "cli" && run.status === "succeeded" && asRecord(run.target).version === TARGET_VERSION && completedRunStep(run, "finalize:repair-continuation"));
  const nativeRunSteps = new Set(Array.isArray(nativeRun?.steps) ? nativeRun.steps.map((step) => String(asRecord(step).step)) : []);
  const completedNativeSteps = new Set(Array.isArray(nativeRun?.steps) ? nativeRun.steps.filter((step) => asRecord(step).status === "completed").map((step) => String(asRecord(step).step)) : []);
  const completedRepairSteps = new Set(Array.isArray(repairRun?.steps) ? repairRun.steps.filter((step) => asRecord(step).status === "completed").map((step) => String(asRecord(step).step)) : []);
  const nativeVerification = asRecord(nativeRun?.verification);
  const failedNativeSteps = Array.isArray(nativeRun?.steps)
    ? nativeRun.steps.map(asRecord).filter((step) => step.status === "failed")
    : [];
  const recovery = asRecord(nativeVerification.recovery);
  const activeRun = asRecord(updateStatus.activeRun);
  const runtimeVersion = typeof status.runtimeVersion === "string" ? status.runtimeVersion : null;
  const healthOkay = health.ok === true && asRecord(health.eventLoop).degraded !== true && asRecord(health.plugins).errors instanceof Array && (asRecord(health.plugins).errors as unknown[]).length === 0;
  const targetGatewayReady = runtimeVersion === TARGET_VERSION && healthOkay;
  const candidateAdmissionStep = Array.isArray(nativeRun?.steps)
    ? nativeRun.steps.map(asRecord).find((step) => step.step === "candidate-admission")
    : undefined;
  const admissionChecks = parseJsonArray(candidateAdmissionStep?.detail);
  const databaseAdmissionPassed = admissionChecks.some((check) => check.name === "database-schema" && check.status === "ok");
  const candidateValidationGroups = [
    ["candidate-admission", "candidate migration rehearsal"],
    ["candidate-doctor-lint", "candidate doctor lint"],
    ["candidate-config", "candidate config validation"],
    ["candidate-plugins", "candidate plugin resolution"],
    ["candidate-recovery", "candidate migration continuation"],
    ["candidate-gateway-startup", "candidate gateway canary"]
  ];
  const candidateValidationPassed = databaseAdmissionPassed && candidateValidationGroups.every((group) => group.some((step) => completedNativeSteps.has(step)));
  const packageSwapCompleted = ["package-swap", "global install swap"].some((step) => completedNativeSteps.has(step));
  const directRecoveryVerified = recovery.version === TARGET_VERSION && recovery.serviceRestartSafe === true;
  const repairRecoveryVerified = repairRun?.status === "succeeded" &&
    ["finalize:doctor", "finalize:plugins", "finalize:targetConfigConvergence"].every((step) => completedRepairSteps.has(step)) &&
    targetGatewayReady;
  const postUpdateRecoveryVerified = directRecoveryVerified || repairRecoveryVerified;
  const nativeApiHandoffRecorded = nativeRun?.trigger === "api" && completedNativeSteps.has("managed-service update handoff");
  const checks = {
    exactTargetPackage: Boolean(packageIdentity && packageIdentity.version === TARGET_VERSION && packageIdentity.sourceCommit === TARGET_COMMIT && packageIdentity.buildId === TARGET_BUILD),
    gatewayApiHandoffRecorded: nativeApiHandoffRecorded,
    nativePackageUpdateCompleted: nativeRun?.status === "succeeded" && asRecord(nativeRun.target).kind === "package" && asRecord(nativeRun.target).version === TARGET_VERSION,
    sourceToTargetRecorded: asRecord(nativeRun?.before).version === SOURCE_VERSION && asRecord(nativeRun?.after).version === TARGET_VERSION && asRecord(nativeRun?.after).buildId === TARGET_BUILD,
    migrationAndValidationRehearsed: candidateValidationPassed,
    installationSwapCompleted: packageSwapCompleted,
    nativePostUpdateRecoveryVerified: postUpdateRecoveryVerified,
    gatewayReconnectedAtTarget: targetGatewayReady,
    nativeUpdateStatusIsCurrent: updateStatus.effectiveChannel === "stable" && updateStatus.updateAvailable === null && activeRun.status !== "running",
    nativeRunHistoryIsTerminal: nativeRun?.phase === "finished" && ["succeeded", "failed", "skipped"].includes(String(nativeRun.status)),
    configurationRemainsInterpretable: configValidation.valid === true,
    nativeUpdateRunSucceeded: nativeRun?.status === "succeeded"
  };
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) failures.push(`${name} did not pass against fresh native Gateway evidence.`);
  }

  const artifact = {
    schemaVersion: 1,
    artifactType: `openclaw-${TARGET_VERSION}-native-update-lifecycle-certification`,
    generatedAt: new Date().toISOString(),
    agentosHead: await gitHead(),
    target: {
      version: TARGET_VERSION,
      tag: `v${TARGET_VERSION}`,
      sourceCommit: TARGET_COMMIT,
      buildId: TARGET_BUILD,
      packageHash: packageIdentity?.packageHash ?? null,
      gatewayProtocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
      stateSchema: OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA,
      agentSchema: OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA
    },
    migration: {
      sourceVersion: SOURCE_VERSION,
      targetVersion: TARGET_VERSION,
      runId: typeof nativeRun?.runId === "string" ? nativeRun.runId : null,
      steps: Array.from(nativeRunSteps).filter((step) => step.includes("migration") || step.includes("doctor") || step.includes("gateway") || step.includes("package-swap") || step.includes("install swap")),
      successful: checks.migrationAndValidationRehearsed && checks.installationSwapCompleted && checks.nativePostUpdateRecoveryVerified
    },
    update: {
      mutationOwner: "OpenClaw native updater",
      agentOsInvokedUpdateMutation: false,
      nativeApiRunStatus: nativeRun?.trigger === "api" ? nativeRun.status : "not-observed",
      nativeApiRunReason: nativeRun?.trigger === "api" ? nativeRun.reason ?? null : null,
      nativeGatewayRun: nativeRun ? {
        runId: nativeRun.runId,
        trigger: nativeRun.trigger,
        status: nativeRun.status,
        phase: nativeRun.phase,
        reason: nativeRun.reason ?? null,
        channel: asRecord(nativeRun.target).channel,
        target: asRecord(nativeRun.target).version,
        before: asRecord(nativeRun.before).version,
        after: asRecord(nativeRun.after).version,
        finished: typeof nativeRun.finishedAtMs === "number",
        recoveryVersion: runtimeVersion,
        serviceRestartSafe: recovery.serviceRestartSafe === true,
        failedStep: failedNativeSteps.at(-1)?.step ?? null,
        failureDetail: typeof failedNativeSteps.at(-1)?.detail === "string" ? String(failedNativeSteps.at(-1)?.detail).slice(0, 500) : null
      } : null,
      repairRun: repairRun ? {
        runId: repairRun.runId,
        status: repairRun.status,
        phase: repairRun.phase,
        repairOnly: true,
        doctorCompleted: completedRepairSteps.has("finalize:doctor"),
        pluginConvergenceCompleted: completedRepairSteps.has("finalize:plugins")
      } : null,
      restart: {
        gatewayFreshlyReconnected: checks.gatewayReconnectedAtTarget,
        runtimeVersion,
        nativeGatewayHandoffRecorded: checks.gatewayApiHandoffRecorded,
        postUpdateRecoveryVerified: checks.nativePostUpdateRecoveryVerified
      }
    },
    runtime: {
      health: healthOkay ? "PASS" : "FAIL",
      installedVersion: runtimeVersion,
      updateStatus: checks.nativeUpdateStatusIsCurrent ? "current" : "unknown",
      activeUpdateRun: activeRun.status === "running",
      configuration: configValidation.valid === true ? "valid" : "invalid"
    },
    checks,
    failures,
    success: failures.length === 0
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${TARGET_VERSION} NATIVE UPDATE LIFECYCLE: ${artifact.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!artifact.success) process.exitCode = 1;
}

async function runJsonCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<JsonRecord> {
  const { stdout } = await execFileAsync(command, args, { env, maxBuffer: 32 * 1024 * 1024, timeout: 45_000 });
  try {
    return asRecord(JSON.parse(stdout));
  } catch {
    throw new Error("Native OpenClaw evidence command did not return a JSON object.");
  }
}

async function readExactPackageIdentity(packageRoot: string) {
  const packageJson = asRecord(JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")));
  const buildInfo = asRecord(JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")));
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: String(packageJson.version ?? ""),
    sourceCommit: String(buildInfo.commit ?? ""),
    buildId: String(buildInfo.buildId ?? ""),
    packageHash: hash.digest("hex"),
    stateSchema: Number(asRecord(asRecord(packageJson.openclaw).schemaVersions).state ?? 0),
    agentSchema: Number(asRecord(asRecord(packageJson.openclaw).schemaVersions).agent ?? 0)
  };
}

async function gitHead() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    return stdout.trim();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function completedRunStep(run: JsonRecord, stepName: string) {
  return Array.isArray(run.steps) && run.steps.some((step) => asRecord(step).step === stepName && asRecord(step).status === "completed");
}

function parseJsonArray(value: unknown): JsonRecord[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(asRecord) : [];
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Native OpenClaw update lifecycle certification failed.");
  process.exitCode = 1;
});
