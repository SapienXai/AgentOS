import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resetOpenClawBinCache, resolveOpenClawBin } from "@/lib/openclaw/cli";
import {
  clearMissionControlCaches,
  ensureOpenClawRuntimeSmokeTest,
  getMissionControlSnapshot
} from "@/lib/agentos/control-plane";
import { resolveAgentOsVersion } from "@/lib/agentos/version";
import type { OpenClawUpdateStreamEvent } from "@/lib/agentos/contracts";
import type {
  MissionControlSnapshot,
  OpenClawShadowProbeReport,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";
import { recordOpenClawUpdateRuntimeIssue } from "@/lib/openclaw/application/runtime-issue-service";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildOpenClawUpdateRecoveryManualCommand,
  isOpenClawGatewayReadyOutput,
  shouldAttemptOpenClawUpdateRecovery
} from "@/lib/openclaw/update-recovery";
import {
  buildOpenClawRuntimeSmokeTestRecoveryCommand,
  classifyOpenClawRuntimeSmokeTestFailure
} from "@/lib/openclaw/runtime-compatibility";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import { resolveOpenClawUpdateDecision } from "@/lib/openclaw/update-compatibility";
import {
  createOpenClawRollbackSnapshot,
  readOpenClawRollbackSnapshot,
  restoreOpenClawRollbackConfigSnapshot,
  type OpenClawRollbackSnapshot
} from "@/lib/openclaw/update-rollback";
import { buildOpenClawUpdatePreflightReport } from "@/lib/openclaw/update-safety";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  action: z.enum(["preflight", "probe", "update", "rollback"]).default("update"),
  confirmed: z.boolean().optional(),
  targetVersion: z.string().trim().optional(),
  mode: z.enum(["recommended", "candidate", "advanced"]).default("recommended")
});

const updateTimeoutMs = 10 * 60 * 1000;
const gatewayReadyTimeoutMs = 3 * 60 * 1000;
const gatewayReadyProbeTimeoutMs = 20 * 1000;
const gatewayReadyInitialDelayMs = 5 * 1000;
const gatewayReadyProbeIntervalMs = 3 * 1000;
const runtimeSmokeTestSkippedMessage =
  "OpenClaw updated, but no agent was available for a live turn smoke test. Skipping compatibility gate.";
type UpdateVerification = {
  ok: boolean;
  message: string;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

type UpdatePreflightResult = {
  ok: boolean;
  message: string;
  report: OpenClawUpdateSafetyReport;
};

export async function POST(request: Request) {
  let updateRequest: z.infer<typeof updateSchema>;

  try {
    updateRequest = updateSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Update confirmation is required.")
      },
      { status: 400 }
    );
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const agentOsVersion = await resolveAgentOsVersion();
  const targetVersion = normalizeVersion(updateRequest.targetVersion) || OPENCLAW_RECOMMENDED_VERSION;
  const updateDecision = resolveOpenClawUpdateDecision({
    agentOsVersion,
    targetVersion,
    mode: updateRequest.mode
  });

  if (updateRequest.action === "update" && !updateDecision.allowed) {
    return NextResponse.json(
      {
        error: updateDecision.reason,
        decision: updateDecision
      },
      { status: 400 }
    );
  }

  if ((updateRequest.action === "update" || updateRequest.action === "rollback") && updateRequest.confirmed !== true) {
    return NextResponse.json(
      {
        error: "Update confirmation is required."
      },
      { status: 400 }
    );
  }

  if (updateRequest.action === "update" && !snapshot.diagnostics.installed) {
    return NextResponse.json(
      {
        error: snapshot.diagnostics.issues[0] || "OpenClaw is unavailable."
      },
      { status: 400 }
    );
  }

  if (updateRequest.action === "preflight") {
    const rollbackSnapshot = await readOpenClawRollbackSnapshot();
    const report = buildOpenClawUpdatePreflightReport({
      snapshot,
      targetVersion,
      decision: updateDecision,
      rollbackSnapshotAvailable: Boolean(rollbackSnapshot)
    });

    return NextResponse.json(redactSecrets({ report }));
  }

  if (updateRequest.action === "probe") {
    const report = await runOpenClawShadowProbe({
      targetVersion,
      decision: updateDecision
    });

    return NextResponse.json(redactSecrets({ report }));
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: OpenClawUpdateStreamEvent) => {
    const safeEvent = redactSecrets(event);
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  void (async () => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;

    const closeWriter = async () => {
      if (finished) {
        return;
      }

      finished = true;
      await writeChain;
      await writer.close();
    };

    let openClawBin: string;

    try {
      openClawBin = await resolveOpenClawBin();
    } catch (error) {
      await send({
        type: "done",
        ok: false,
        message: redactErrorMessage(error, "OpenClaw CLI could not be resolved."),
        exitCode: null,
        stdout,
        stderr
      });
      await closeWriter();
      return;
    }

    if (updateRequest.action === "rollback") {
      const rollbackSnapshot = await readOpenClawRollbackSnapshot();

      if (!rollbackSnapshot) {
        await recordUpdateRuntimeIssue({
          type: "openclaw_rollback_needed",
          title: "OpenClaw rollback unavailable",
          message: "Rollback was requested, but AgentOS has no previous working OpenClaw snapshot.",
          targetVersion,
          severity: "action_required"
        });
        await send({
          type: "done",
          ok: false,
          message: "No previous working OpenClaw rollback snapshot is available.",
          exitCode: null,
          stdout,
          stderr
        });
        await closeWriter();
        return;
      }

      await send({
        type: "status",
        phase: "rollback",
        message: `Rolling back OpenClaw to v${rollbackSnapshot.version}...`
      });

      const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
      stdout += rollback.stdout;
      stderr += rollback.stderr;
      if (!rollback.ok) {
        await recordUpdateRuntimeIssue({
          type: "openclaw_rollback_needed",
          title: "OpenClaw rollback failed",
          message: rollback.message,
          targetVersion: rollbackSnapshot.version,
          rawOutput: [rollback.stdout, rollback.stderr].filter(Boolean).join("\n"),
          recoveryCommand: formatOpenClawCommand(openClawBin, buildOpenClawUpdateArgs(rollbackSnapshot.version)),
          severity: "blocked"
        });
      }
      resetOpenClawBinCache();
      clearMissionControlCaches();

      const nextSnapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
      await send({
        type: "done",
        ok: rollback.ok,
        message: rollback.ok
          ? `OpenClaw rollback completed. Restored v${rollbackSnapshot.version}.`
          : rollback.message,
        exitCode: rollback.exitCode,
        stdout,
        stderr,
        snapshot: nextSnapshot
      });
      await closeWriter();
      return;
    }

    if (isTargetOpenClawInstalled(snapshot, targetVersion)) {
      await send({
        type: "done",
        ok: true,
        message: `OpenClaw is already at the selected compatible version: v${targetVersion}.`,
        exitCode: 0,
        stdout,
        stderr,
        snapshot
      });
      await closeWriter();
      return;
    }

    const preflight = await runOpenClawUpdatePreflight({
      snapshot,
      targetVersion,
      decision: updateDecision,
      rollbackSnapshotAvailable: Boolean(await readOpenClawRollbackSnapshot())
    });

    await send({
      type: "status",
      phase: "preflight",
      message: preflight.message
    });

    if (!preflight.ok) {
      await recordUpdateRuntimeIssue({
        type: "openclaw_update_failed",
        title: "OpenClaw update preflight blocked",
        message: preflight.message,
        targetVersion,
        rawOutput: JSON.stringify(preflight.report),
        severity: "action_required"
      });
      await send({
        type: "done",
        ok: false,
        message: preflight.message,
        exitCode: null,
        stdout,
        stderr,
        snapshot
      });
      await closeWriter();
      return;
    }

    const rollbackSnapshot = await createOpenClawRollbackSnapshot({
      version: normalizeVersion(snapshot.diagnostics.version) || targetVersion,
      binaryPath: openClawBin,
      decision: updateDecision,
      compatibilityReport: preflight.report
    });
    await send({
      type: "status",
      phase: "preflight",
      message: `Saved OpenClaw rollback snapshot for v${rollbackSnapshot.version}.`
    });

    const updateArgs = buildOpenClawUpdateArgs(targetVersion);
    const child = spawn(openClawBin, updateArgs, {
      cwd: process.cwd(),
      env: process.env
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, updateTimeoutMs);

    await send({
      type: "status",
      phase: "starting",
      message: `Running openclaw update --tag ${targetVersion}...`
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      void send({
        type: "log",
        stream: "stdout",
        text
      });
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      void send({
        type: "log",
        stream: "stderr",
        text
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      void (async () => {
        await send({
          type: "done",
          ok: false,
          message: `OpenClaw update failed to start: ${error.message}`,
          exitCode: null,
          stdout,
          stderr: stderr ? `${stderr}\n${error.message}` : error.message
        });
        await closeWriter();
      })();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      void (async () => {
        if (finished) {
          return;
        }

        if (timedOut) {
          await recordUpdateRuntimeIssue({
            type: "openclaw_update_failed",
            title: "OpenClaw update timed out",
            message: "OpenClaw update timed out.",
            targetVersion,
            rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
            severity: "blocked"
          });
          await send({
            type: "done",
            ok: false,
            message: "OpenClaw update timed out.",
            exitCode: code,
            stdout,
            stderr: stderr || `Update exceeded ${Math.round(updateTimeoutMs / 1000)} seconds.`
          });
          await closeWriter();
          return;
        }

        if (code !== 0) {
          const failureCommand = formatOpenClawCommand(openClawBin, updateArgs);
          const failureOutput = [stdout, stderr].filter(Boolean).join("\n");
          const needsInteractiveTty =
            /downgrade confirmation required/i.test(failureOutput) ||
            /interactive tty/i.test(failureOutput) ||
            /re-?run in a tty/i.test(failureOutput) ||
            /confirm the downgrade/i.test(failureOutput);

          if (needsInteractiveTty) {
            await recordUpdateRuntimeIssue({
              type: "openclaw_update_failed",
              title: "OpenClaw update needs terminal confirmation",
              message: "OpenClaw update needs to be confirmed in a terminal.",
              targetVersion,
              rawOutput: failureOutput,
              recoveryCommand: failureCommand
            });
            await send({
              type: "done",
              ok: false,
              message: "OpenClaw update needs to be confirmed in a terminal.",
              exitCode: code,
              stdout,
              stderr: stderr || "Downgrade confirmation required.",
              manualCommand: failureCommand
            });
            await closeWriter();
            return;
          }

          if (!shouldAttemptOpenClawUpdateRecovery(failureOutput)) {
            await recordUpdateRuntimeIssue({
              type: "openclaw_update_failed",
              title: "OpenClaw update command failed",
              message: "OpenClaw update failed.",
              targetVersion,
              rawOutput: failureOutput,
              severity: "blocked"
            });
            await send({
              type: "done",
              ok: false,
              message: "OpenClaw update failed.",
              exitCode: code,
              stdout,
              stderr
            });
            await closeWriter();
            return;
          }

          await send({
            type: "status",
            phase: "refreshing",
            message: "OpenClaw updated, but post-update setup needs repair. Running setup checks..."
          });

          const recovery = await recoverOpenClawPostUpdate(openClawBin, send);
          stdout += recovery.stdout;
          stderr += recovery.stderr;

          if (!recovery.ok) {
            await recordUpdateRuntimeIssue({
              type: "openclaw_postflight_failed",
              title: "OpenClaw post-update recovery failed",
              message: recovery.message,
              targetVersion,
              rawOutput: [recovery.stdout, recovery.stderr].filter(Boolean).join("\n"),
              recoveryCommand: buildOpenClawUpdateRecoveryManualCommand(formatOpenClawCommand(openClawBin, [])),
              severity: "blocked"
            });
            await send({
              type: "done",
              ok: false,
              message: recovery.message,
              exitCode: recovery.exitCode ?? code,
              stdout,
              stderr,
              manualCommand: buildOpenClawUpdateRecoveryManualCommand(formatOpenClawCommand(openClawBin, []))
            });
            await closeWriter();
            return;
          }
        }

        await send({
          type: "status",
          phase: "refreshing",
          message: "Verifying installed OpenClaw version..."
        });

        try {
          resetOpenClawBinCache();
          clearMissionControlCaches();
          const nextSnapshot = await getMissionControlSnapshot({ force: true });
          const verifiedSnapshot = preserveKnownUpdateTarget(snapshot, nextSnapshot);
          const verification = verifyOpenClawUpdate(snapshot, verifiedSnapshot, targetVersion);

          if (!verification.ok) {
            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw postflight failed" : "OpenClaw rollback needed",
              message: `${verification.message} ${rollback.ok ? "Rollback completed." : rollback.message}`,
              targetVersion,
              rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
              recoveryCommand: rollback.ok ? undefined : formatOpenClawCommand(openClawBin, updateArgs),
              severity: rollback.ok ? "action_required" : "blocked"
            });

            await send({
              type: "done",
              ok: false,
              message: `${verification.message} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`,
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr,
              snapshot: verifiedSnapshot,
              manualCommand: rollback.ok ? undefined : formatOpenClawCommand(openClawBin, updateArgs)
            });
            await closeWriter();
            return;
          }

          const compatibilityVerification = verifyOpenClawPostUpdateCompatibility(verifiedSnapshot);

          if (!compatibilityVerification.ok) {
            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw compatibility postflight failed" : "OpenClaw rollback needed",
              message: `${compatibilityVerification.message} ${rollback.ok ? "Rollback completed." : rollback.message}`,
              targetVersion,
              rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
              recoveryCommand: rollback.ok ? undefined : formatOpenClawCommand(openClawBin, updateArgs),
              severity: rollback.ok ? "action_required" : "blocked"
            });

            await send({
              type: "done",
              ok: false,
              message: `${compatibilityVerification.message} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`,
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr,
              snapshot: verifiedSnapshot,
              manualCommand: rollback.ok ? undefined : formatOpenClawCommand(openClawBin, updateArgs)
            });
            await closeWriter();
            return;
          }

          await send({
            type: "status",
            phase: "refreshing",
            message: "Running a live runtime smoke test..."
          });

          const smokeTest = await ensureOpenClawRuntimeSmokeTest({ force: true });
          const finalSnapshot = await getMissionControlSnapshot({ force: true });
          const smokeTestOutput = smokeTest.error || smokeTest.summary || "";

          if (smokeTest.status === "failed") {
            const classification = classifyOpenClawRuntimeSmokeTestFailure(smokeTestOutput);
            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw runtime smoke postflight failed" : "OpenClaw rollback needed",
              message: classification
                ? `OpenClaw updated, but ${classification.detail}`
                : "OpenClaw updated, but the live runtime smoke test failed.",
              targetVersion,
              rawOutput: [stdout, stderr, smokeTestOutput].filter(Boolean).join("\n"),
              recoveryCommand: rollback.ok
                ? undefined
                : buildOpenClawRuntimeSmokeTestRecoveryCommand(formatOpenClawCommand(openClawBin, []), smokeTestOutput),
              severity: rollback.ok ? "action_required" : "blocked"
            });

            await send({
              type: "done",
              ok: false,
              message: classification
                ? `OpenClaw updated, but ${classification.detail} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`
                : `OpenClaw updated, but the live runtime smoke test failed. ${smokeTestOutput} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`.trim(),
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr: stderr
                ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                : smokeTestOutput || "Runtime smoke test failed.",
              snapshot: finalSnapshot,
              manualCommand: rollback.ok
                ? undefined
                : buildOpenClawRuntimeSmokeTestRecoveryCommand(formatOpenClawCommand(openClawBin, []), smokeTestOutput)
            });
            await closeWriter();
            return;
          }

          stdout = stdout
            ? `${stdout}\n${smokeTest.status === "not-run" ? runtimeSmokeTestSkippedMessage : smokeTest.summary || "Runtime smoke test passed."}`
            : smokeTest.status === "not-run"
              ? runtimeSmokeTestSkippedMessage
              : smokeTest.summary || "Runtime smoke test passed.";

          await send({
            type: "done",
            ok: true,
            message: verification.message,
            exitCode: code,
            stdout,
            stderr,
            snapshot: finalSnapshot
          });
        } catch (error) {
          await recordUpdateRuntimeIssue({
            type: "openclaw_postflight_failed",
            title: "OpenClaw update verification failed",
            message: "OpenClaw update command finished, but AgentOS could not verify the installed version.",
            targetVersion,
            rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
            errorMessage: redactErrorMessage(error, "Status refresh failed."),
            severity: "blocked"
          });
          await send({
            type: "done",
            ok: false,
            message: "OpenClaw update command finished, but AgentOS could not verify the installed version.",
            exitCode: code,
            stdout,
            stderr: stderr
              ? `${stderr}\n${redactErrorMessage(error, "Status refresh failed.")}`
              : redactErrorMessage(error, "Status refresh failed.")
          });
        }

        await closeWriter();
      })();
    });
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function recoverOpenClawPostUpdate(
  openClawBin: string,
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>
) {
  let stdout = "";
  let stderr = "";
  const appendOutput = (result: CommandResult) => {
    stdout += result.stdout;
    stderr += result.stderr;

    if (result.errorMessage) {
      stderr = stderr ? `${stderr}\n${result.errorMessage}` : result.errorMessage;
    }
  };

  const doctorResult = await runRecoveryCommand(openClawBin, ["doctor", "--fix"], send, {
    timeoutMs: 4 * 60 * 1000
  });
  appendOutput(doctorResult);

  if (doctorResult.errorMessage || doctorResult.timedOut || doctorResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but AgentOS could not repair post-update setup.",
      exitCode: doctorResult.code,
      stdout,
      stderr
    };
  }

  const restartResult = await runRecoveryCommand(openClawBin, ["gateway", "restart"], send, {
    timeoutMs: 90_000
  });
  appendOutput(restartResult);

  if (restartResult.errorMessage || restartResult.timedOut || restartResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but the gateway restart failed after setup repair.",
      exitCode: restartResult.code,
      stdout,
      stderr
    };
  }

  await send({
    type: "status",
    phase: "refreshing",
    message: "Waiting for the OpenClaw gateway to become ready..."
  });

  const healthResult = await waitForGatewayReady(openClawBin);
  appendOutput(healthResult);

  if (healthResult.errorMessage || healthResult.timedOut || healthResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but the gateway did not become healthy after setup repair.",
      exitCode: healthResult.code,
      stdout,
      stderr
    };
  }

  return {
    ok: true,
    message: "OpenClaw post-update setup repaired.",
    exitCode: 0,
    stdout,
    stderr
  };
}

async function runOpenClawShadowProbe(input: {
  targetVersion: string;
  decision: ReturnType<typeof resolveOpenClawUpdateDecision>;
}): Promise<OpenClawShadowProbeReport> {
  const checks: OpenClawShadowProbeReport["checks"] = [{
    id: "staged-install",
    label: "Staged target install",
    status: "unknown",
    message:
      "The current OpenClaw updater does not expose a verified target-version staging install path to AgentOS, so AgentOS did not download or replace any binary."
  }];
  let command: string | null = null;
  let currentBinaryVersion: string | null = null;
  let stdout = "";
  let stderr = "";

  try {
    const openClawBin = await resolveOpenClawBin();
    const args = ["--version"];
    command = formatOpenClawCommand(openClawBin, args);
    const result = await runRecoveryCommand(openClawBin, args, async () => {}, {
      timeoutMs: 15_000,
      streamOutput: false
    });
    stdout = result.stdout;
    stderr = result.stderr || result.errorMessage || "";
    currentBinaryVersion = normalizeVersion([result.stdout, result.stderr].filter(Boolean).join("\n"));
    checks.push({
      id: "current-binary-version",
      label: "Current binary probe",
      status: result.code === 0 && !result.timedOut && !result.errorMessage ? "safe" : "warning",
      message:
        result.code === 0 && !result.timedOut && !result.errorMessage
          ? `The active OpenClaw binary responded to ${command}.`
          : "The active OpenClaw binary did not complete the version probe cleanly."
    });
  } catch (error) {
    stderr = redactErrorMessage(error, "OpenClaw binary probe failed.");
    checks.push({
      id: "current-binary-version",
      label: "Current binary probe",
      status: "warning",
      message: stderr
    });
  }

  checks.push({
    id: "target-decision",
    label: "Target compatibility decision",
    status: input.decision.allowed ? (input.decision.requiresExplicitOptIn ? "warning" : "safe") : "blocker",
    message: input.decision.reason
  });

  const blockers = checks.filter((check) => check.status === "blocker");

  return {
    generatedAt: new Date().toISOString(),
    targetVersion: input.targetVersion,
    supported: false,
    mutationSafe: true,
    ok: blockers.length === 0,
    limitation:
      "Shadow probe is limited to active-binary and manifest checks until OpenClaw exposes a non-mutating staged target installer/probe command.",
    command,
    currentBinaryVersion,
    stdout,
    stderr,
    checks,
    recommendedNextAction:
      blockers.length > 0
        ? "Do not update. Resolve the target compatibility blocker first."
        : "Run preflight before applying the update. Treat this probe as limited evidence, not certification."
  };
}

async function waitForGatewayReady(openClawBin: string) {
  const startedAt = Date.now();
  let latestResult: CommandResult = {
    code: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    errorMessage: "Gateway health check did not run."
  };

  await delay(gatewayReadyInitialDelayMs);

  while (Date.now() - startedAt < gatewayReadyTimeoutMs) {
    latestResult = await runRecoveryCommand(openClawBin, ["gateway", "status", "--deep"], async () => {}, {
      timeoutMs: gatewayReadyProbeTimeoutMs,
      streamOutput: false
    });

    if (
      !latestResult.errorMessage &&
      !latestResult.timedOut &&
      latestResult.code === 0 &&
      isOpenClawGatewayReadyOutput([latestResult.stdout, latestResult.stderr].filter(Boolean).join("\n"))
    ) {
      return latestResult;
    }

    await delay(gatewayReadyProbeIntervalMs);
  }

  return {
    ...latestResult,
    timedOut: latestResult.timedOut || latestResult.code !== 0,
    errorMessage: latestResult.errorMessage || "Gateway readiness check exceeded 180 seconds."
  };
}

async function runRecoveryCommand(
  command: string,
  args: string[],
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>,
  options: {
    timeoutMs: number;
    streamOutput?: boolean;
  }
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env
  });
  const streamOutput = options.streamOutput ?? true;
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let resolved = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const finish = (result: CommandResult) => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;

      if (streamOutput) {
        void send({
          type: "log",
          stream: "stdout",
          text
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;

      if (streamOutput) {
        void send({
          type: "log",
          stream: "stderr",
          text
        });
      }
    });

    child.on("error", (error) => {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        errorMessage: error.message
      });
    });

    child.on("close", (code) => {
      finish({
        code,
        stdout,
        stderr,
        timedOut,
        errorMessage: timedOut ? `Command exceeded ${Math.round(options.timeoutMs / 1000)} seconds.` : undefined
      });
    });
  });
}

function verifyOpenClawUpdate(
  beforeSnapshot: MissionControlSnapshot,
  afterSnapshot: MissionControlSnapshot,
  targetVersion: string
): UpdateVerification {
  const beforeVersion = normalizeVersion(beforeSnapshot.diagnostics.version);
  const afterVersion = normalizeVersion(afterSnapshot.diagnostics.version);
  const expectedVersion = normalizeVersion(targetVersion);

  if (!afterVersion || !expectedVersion || compareVersionStrings(afterVersion, expectedVersion) !== 0) {
    return {
      ok: false,
      message: `OpenClaw update command finished, but the installed version is ${formatVersion(afterVersion)}. Expected ${formatVersion(expectedVersion)}.`
    };
  }

  return {
    ok: true,
    message: afterVersion
      ? beforeVersion && compareVersionStrings(beforeVersion, afterVersion) === 0
        ? `OpenClaw is already at the recommended version: ${formatVersion(afterVersion)}.`
        : `OpenClaw update completed. Installed version: ${formatVersion(afterVersion)}.`
      : "OpenClaw update completed."
  };
}

function verifyOpenClawPostUpdateCompatibility(snapshot: MissionControlSnapshot): UpdateVerification {
  const issues: string[] = [];
  const contract = snapshot.diagnostics.capabilityMatrix?.compatibility?.methodContract;
  const configPatch = snapshot.diagnostics.capabilityMatrix?.configPatch;

  if (!snapshot.diagnostics.loaded || !snapshot.diagnostics.rpcOk) {
    issues.push("Gateway did not report loaded RPC readiness.");
  }

  if (contract?.status === "drift" && (contract.missingRequiredMethods?.length ?? contract.missingMethodCount ?? 0) > 0) {
    issues.push("Required native Gateway methods are missing.");
  }

  if (configPatch !== "supported") {
    issues.push("Gateway config schema/patch support is not available.");
  }

  if (snapshot.diagnostics.modelReadiness.ready === false && snapshot.diagnostics.modelReadiness.issues.length > 0) {
    issues.push(`Model readiness could not be confirmed: ${snapshot.diagnostics.modelReadiness.issues[0]}`);
  }

  if (snapshot.diagnostics.compatibilityReport?.status === "incompatible") {
    issues.push("OpenClaw compatibility report is incompatible.");
  }

  if (issues.length > 0) {
    const fallbackCount = snapshot.diagnostics.transport?.fallbackTotal ?? 0;
    const lastNativeFailure =
      snapshot.diagnostics.transport?.lastNativeError ||
      snapshot.diagnostics.gatewayFallbackDiagnostics?.[0]?.issue ||
      "No native failure detail was reported.";

    return {
      ok: false,
      message: `${issues.join(" ")} Fallback count: ${fallbackCount}. Last native failure: ${lastNativeFailure}`
    };
  }

  return {
    ok: true,
    message: "Post-update OpenClaw compatibility checks passed."
  };
}

function isTargetOpenClawInstalled(snapshot: MissionControlSnapshot, targetVersion: string) {
  const version = normalizeVersion(snapshot.diagnostics.version);
  const normalizedTargetVersion = normalizeVersion(targetVersion);

  return Boolean(version && normalizedTargetVersion && compareVersionStrings(version, normalizedTargetVersion) === 0);
}

function buildOpenClawUpdateArgs(targetVersion: string) {
  return ["update", "--tag", targetVersion, "--yes"];
}

async function runOpenClawUpdatePreflight(input: {
  snapshot: MissionControlSnapshot;
  targetVersion: string;
  decision: ReturnType<typeof resolveOpenClawUpdateDecision>;
  rollbackSnapshotAvailable: boolean;
}): Promise<UpdatePreflightResult> {
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: input.snapshot,
    targetVersion: input.targetVersion,
    decision: input.decision,
    rollbackSnapshotAvailable: input.rollbackSnapshotAvailable
  });

  if (!report.canAttemptUpdate) {
    return {
      ok: false,
      message: report.recommendedNextAction,
      report
    };
  }

  return {
    ok: true,
    message: `Preflight passed for OpenClaw v${input.targetVersion}. ${report.recommendedNextAction}`,
    report
  };
}

async function recordUpdateRuntimeIssue(
  input: Parameters<typeof recordOpenClawUpdateRuntimeIssue>[0]
) {
  await recordOpenClawUpdateRuntimeIssue(input).catch(() => {});
}

async function runRollbackOpenClaw(
  openClawBin: string,
  rollbackSnapshot: OpenClawRollbackSnapshot,
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>
) {
  await send({
    type: "status",
    phase: "rollback",
    message: `Restoring previous OpenClaw version v${rollbackSnapshot.version}...`
  });

  const rollbackResult = await runRecoveryCommand(openClawBin, buildOpenClawUpdateArgs(rollbackSnapshot.version), send, {
    timeoutMs: updateTimeoutMs
  });

  if (rollbackResult.errorMessage || rollbackResult.timedOut || rollbackResult.code !== 0) {
    return {
      ok: false,
      message: "Automatic OpenClaw rollback failed. Use the manual update command from the details panel.",
      exitCode: rollbackResult.code,
      stdout: rollbackResult.stdout,
      stderr: rollbackResult.stderr || rollbackResult.errorMessage || "Rollback command failed."
    };
  }

  const configRestore = await restoreOpenClawRollbackConfigSnapshot(rollbackSnapshot);

  return {
    ok: true,
    message: `Rolled back OpenClaw to v${rollbackSnapshot.version}.`,
    exitCode: 0,
    stdout: rollbackResult.stdout
      ? `${rollbackResult.stdout}\n${configRestore.message}\n`
      : `${configRestore.message}\n`,
    stderr: rollbackResult.stderr
  };
}

function preserveKnownUpdateTarget(
  beforeSnapshot: MissionControlSnapshot,
  afterSnapshot: MissionControlSnapshot
): MissionControlSnapshot {
  const beforeLatestVersion = normalizeVersion(beforeSnapshot.diagnostics.latestVersion);
  const afterLatestVersion = normalizeVersion(afterSnapshot.diagnostics.latestVersion);
  const afterVersion = normalizeVersion(afterSnapshot.diagnostics.version);

  if (!beforeLatestVersion || !afterVersion) {
    return afterSnapshot;
  }

  const latestStillNewerThanInstalled = compareVersionStrings(beforeLatestVersion, afterVersion) > 0;
  const afterLostKnownLatest =
    !afterLatestVersion || compareVersionStrings(beforeLatestVersion, afterLatestVersion) > 0;

  if (!latestStillNewerThanInstalled || !afterLostKnownLatest) {
    return afterSnapshot;
  }

  return {
    ...afterSnapshot,
    diagnostics: {
      ...afterSnapshot.diagnostics,
      latestVersion: beforeLatestVersion,
      updateAvailable: true,
      updateInfo: `Update available: v${beforeLatestVersion} is ready. Current version: v${afterVersion}.`
    }
  };
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function formatVersion(value: string | null | undefined) {
  const normalized = normalizeVersion(value);
  return normalized ? `v${normalized}` : "unknown";
}
