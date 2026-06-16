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
  OpenClawCapabilityDiffReport,
  OpenClawRuntimeSmokeTest,
  OpenClawShadowProbeReport,
  OpenClawUpdateSafetyReport
} from "@/lib/openclaw/types";
import { recordOpenClawUpdateRuntimeIssue } from "@/lib/openclaw/application/runtime-issue-service";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildOpenClawDowngradeConfigBlockerManualCommand,
  buildOpenClawUpdateRecoveryManualCommand,
  isOpenClawDowngradeConfigBlocker,
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
import { buildOpenClawCapabilityDiffReport } from "@/lib/openclaw/capability-diff";
import {
  buildOpenClawCertificationScorecardReport,
  type OpenClawCertificationRollbackEvidence
} from "@/lib/openclaw/certification-scorecard";
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
  warnings?: string[];
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
        stderr,
        certificationScorecard: buildOpenClawUpdateCertificationScorecard({
          baselineSnapshot: snapshot,
          targetVersion,
          decision: updateDecision,
          updateAttempted: false,
          updateCompleted: false,
          rollbackSnapshotCreated: false,
          failureMessage: redactErrorMessage(error, "OpenClaw CLI could not be resolved.")
        })
      });
      await closeWriter();
      return;
    }

    const existingRollbackSnapshot = await readOpenClawRollbackSnapshot();

    if (updateRequest.action === "rollback") {
      if (!existingRollbackSnapshot) {
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
        message: `Rolling back OpenClaw to v${existingRollbackSnapshot.version}...`
      });

      const rollback = await runRollbackOpenClaw(openClawBin, existingRollbackSnapshot, send);
      stdout += rollback.stdout;
      stderr += rollback.stderr;
      if (!rollback.ok) {
        await recordUpdateRuntimeIssue({
          type: "openclaw_rollback_needed",
          title: "OpenClaw rollback failed",
          message: rollback.message,
          targetVersion: existingRollbackSnapshot.version,
          rawOutput: [rollback.stdout, rollback.stderr].filter(Boolean).join("\n"),
          recoveryCommand: formatOpenClawCommand(openClawBin, buildOpenClawUpdateArgs(existingRollbackSnapshot.version)),
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
          ? `OpenClaw rollback completed. Restored v${existingRollbackSnapshot.version}.`
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
      const alreadyInstalledPreflightReport = buildOpenClawUpdatePreflightReport({
        snapshot,
        targetVersion,
        decision: updateDecision,
        rollbackSnapshotAvailable: Boolean(existingRollbackSnapshot)
      });

      if (!isOpenClawSnapshotGatewayReady(snapshot)) {
        const certifiedSnapshot = shouldUseCertifiedRollbackSnapshotRecovery(
          snapshot,
          targetVersion,
          updateDecision,
          existingRollbackSnapshot
        )
          ? existingRollbackSnapshot
          : null;

        if (certifiedSnapshot) {
          await send({
            type: "status",
            phase: "rollback",
            message:
              `OpenClaw v${targetVersion} is already installed, but Gateway is not ready. Restoring the certified rollback snapshot before restarting Gateway...`
          });

          const recovery = await runCertifiedRollbackSnapshotRecovery({
            openClawBin,
            rollbackSnapshot: certifiedSnapshot,
            send,
            targetVersion
          });
          stdout += recovery.stdout;
          stderr += recovery.stderr;

          await send({
            type: "done",
            ok: recovery.ok,
            message: recovery.ok
              ? `OpenClaw certified recovery completed. Restored v${certifiedSnapshot.version}.`
              : recovery.message,
            exitCode: recovery.exitCode,
            stdout,
            stderr,
            snapshot: recovery.snapshot,
            certificationScorecard: buildOpenClawUpdateCertificationScorecard({
              baselineSnapshot: snapshot,
              targetSnapshot: recovery.snapshot ?? null,
              targetVersion,
              decision: updateDecision,
              preflightReport: alreadyInstalledPreflightReport,
              updateAttempted: true,
              updateCompleted: recovery.ok,
              exitCode: recovery.exitCode,
              rollbackSnapshotCreated: Boolean(existingRollbackSnapshot),
              rollbackToCertifiedBaseline: recovery.ok ? "passed" : "failed",
              stdout,
              stderr,
              failureMessage: recovery.ok ? null : recovery.message
            }),
            manualCommand: recovery.ok
              ? undefined
              : formatOpenClawCommand(openClawBin, buildOpenClawUpdateArgs(certifiedSnapshot.version))
          });
          await closeWriter();
          return;
        }

        const newerRollbackSnapshotVersion = resolveNewerRollbackSnapshotVersion(targetVersion, existingRollbackSnapshot);
        if (updateDecision.status === "certified" && newerRollbackSnapshotVersion) {
          const recoveryCommand = buildOpenClawDowngradeConfigBlockerManualCommand(
            formatOpenClawCommand(openClawBin, []),
            newerRollbackSnapshotVersion
          );
          const message =
            `OpenClaw v${targetVersion} is installed, but Gateway cannot be treated as healthy because the available rollback snapshot is v${newerRollbackSnapshotVersion}. Restore v${newerRollbackSnapshotVersion} or reset/migrate the OpenClaw config before retrying the certified baseline.`;
          await recordUpdateRuntimeIssue({
            type: "openclaw_rollback_needed",
            title: "OpenClaw certified baseline blocked by newer config",
            message,
            targetVersion,
            recoveryCommand,
            severity: "blocked"
          });
          await send({
            type: "done",
            ok: false,
            message,
            exitCode: null,
            stdout,
            stderr,
            snapshot,
            certificationScorecard: buildOpenClawUpdateCertificationScorecard({
              baselineSnapshot: snapshot,
              targetSnapshot: snapshot,
              targetVersion,
              decision: updateDecision,
              preflightReport: alreadyInstalledPreflightReport,
              updateAttempted: false,
              updateCompleted: false,
              rollbackSnapshotCreated: Boolean(existingRollbackSnapshot),
              rollbackToCertifiedBaseline: "not-run",
              stdout,
              stderr,
              failureMessage: message
            }),
            manualCommand: recoveryCommand
          });
          await closeWriter();
          return;
        }

        const recoveryCommand = buildOpenClawUpdateRecoveryManualCommand(formatOpenClawCommand(openClawBin, []));
        await recordUpdateRuntimeIssue({
          type: "openclaw_postflight_failed",
          title: "OpenClaw target installed but Gateway is not ready",
          message:
            `OpenClaw v${targetVersion} is installed, but the Gateway is not reachable. Repair Gateway access before treating this version as healthy.`,
          targetVersion,
          recoveryCommand,
          severity: "action_required"
        });
        await send({
          type: "done",
          ok: false,
          message:
            `OpenClaw v${targetVersion} is installed, but the Gateway is not reachable. Repair Gateway access before treating this version as healthy.`,
          exitCode: null,
          stdout,
          stderr,
          snapshot,
          certificationScorecard: buildOpenClawUpdateCertificationScorecard({
            baselineSnapshot: snapshot,
            targetSnapshot: snapshot,
            targetVersion,
            decision: updateDecision,
            preflightReport: alreadyInstalledPreflightReport,
            updateAttempted: false,
            updateCompleted: false,
            rollbackSnapshotCreated: Boolean(existingRollbackSnapshot),
            rollbackToCertifiedBaseline: "not-run",
            stdout,
            stderr,
            failureMessage: `OpenClaw v${targetVersion} is installed, but the Gateway is not reachable.`
          }),
          manualCommand: recoveryCommand
        });
        await closeWriter();
        return;
      }

      await send({
        type: "done",
        ok: true,
        message: `OpenClaw is already at the selected compatible version: v${targetVersion}.`,
        exitCode: 0,
        stdout,
        stderr,
        snapshot,
        certificationScorecard: buildOpenClawUpdateCertificationScorecard({
          baselineSnapshot: snapshot,
          targetSnapshot: snapshot,
          targetVersion,
          decision: updateDecision,
          preflightReport: alreadyInstalledPreflightReport,
          updateAttempted: false,
          updateCompleted: true,
          exitCode: 0,
          rollbackSnapshotCreated: Boolean(existingRollbackSnapshot),
          stdout,
          stderr
        })
      });
      await closeWriter();
      return;
    }

    const preflight = await runOpenClawUpdatePreflight({
      snapshot,
      targetVersion,
      decision: updateDecision,
      rollbackSnapshotAvailable: Boolean(existingRollbackSnapshot)
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
        snapshot,
        certificationScorecard: buildOpenClawUpdateCertificationScorecard({
          baselineSnapshot: snapshot,
          targetVersion,
          decision: updateDecision,
          preflightReport: preflight.report,
          updateAttempted: false,
          updateCompleted: false,
          rollbackSnapshotCreated: false,
          failureMessage: preflight.message
        })
      });
      await closeWriter();
      return;
    }

    const certifiedSnapshot = shouldUseCertifiedRollbackSnapshotRecovery(
      snapshot,
      targetVersion,
      updateDecision,
      existingRollbackSnapshot
    )
      ? existingRollbackSnapshot
      : null;

    if (certifiedSnapshot) {
      await send({
        type: "status",
        phase: "rollback",
        message:
          `Using the saved OpenClaw rollback snapshot for certified recovery to v${certifiedSnapshot.version}...`
      });

      const recovery = await runCertifiedRollbackSnapshotRecovery({
        openClawBin,
        rollbackSnapshot: certifiedSnapshot,
        send,
        targetVersion
      });
      stdout += recovery.stdout;
      stderr += recovery.stderr;

      await send({
        type: "done",
        ok: recovery.ok,
        message: recovery.ok
          ? `OpenClaw certified recovery completed. Restored v${certifiedSnapshot.version}.`
          : recovery.message,
        exitCode: recovery.exitCode,
        stdout,
        stderr,
        snapshot: recovery.snapshot,
        manualCommand: recovery.ok
          ? undefined
          : formatOpenClawCommand(openClawBin, buildOpenClawUpdateArgs(certifiedSnapshot.version))
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
          stderr: stderr ? `${stderr}\n${error.message}` : error.message,
          certificationScorecard: buildOpenClawUpdateCertificationScorecard({
            baselineSnapshot: snapshot,
            targetVersion,
            decision: updateDecision,
            preflightReport: preflight.report,
            updateAttempted: true,
            updateCompleted: false,
            rollbackSnapshotCreated: true,
            stdout,
            stderr,
            failureMessage: error.message
          })
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
            stderr: stderr || `Update exceeded ${Math.round(updateTimeoutMs / 1000)} seconds.`,
            certificationScorecard: buildOpenClawUpdateCertificationScorecard({
              baselineSnapshot: snapshot,
              targetVersion,
              decision: updateDecision,
              preflightReport: preflight.report,
              updateAttempted: true,
              updateCompleted: false,
              exitCode: code,
              rollbackSnapshotCreated: true,
              stdout,
              stderr,
              failureMessage: "OpenClaw update timed out."
            })
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
          const downgradeConfigBlocked = isOpenClawDowngradeConfigBlocker(failureOutput);

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
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                updateAttempted: true,
                updateCompleted: false,
                exitCode: code,
                rollbackSnapshotCreated: true,
                stdout,
                stderr,
                failureMessage: "OpenClaw update needs to be confirmed in a terminal."
              }),
              manualCommand: failureCommand
            });
            await closeWriter();
            return;
          }

          if (downgradeConfigBlocked) {
            const recoveryCommand = buildOpenClawDowngradeConfigBlockerManualCommand(
              formatOpenClawCommand(openClawBin, []),
              rollbackSnapshot.version
            );
            const message =
              `OpenClaw changed to v${targetVersion}, but the Gateway restart was blocked because local config/service metadata was last written by a newer OpenClaw version. Restore the last working OpenClaw version or reset/migrate the OpenClaw config before retrying the certified baseline.`;
            await recordUpdateRuntimeIssue({
              type: "openclaw_rollback_needed",
              title: "OpenClaw certified downgrade blocked by newer config",
              message,
              targetVersion,
              rawOutput: failureOutput,
              recoveryCommand,
              severity: "blocked"
            });
            await send({
              type: "done",
              ok: false,
              message,
              exitCode: code,
              stdout,
              stderr,
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                updateAttempted: true,
                updateCompleted: false,
                exitCode: code,
                rollbackSnapshotCreated: true,
                stdout,
                stderr,
                failureMessage: message
              }),
              manualCommand: recoveryCommand
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
              stderr,
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                updateAttempted: true,
                updateCompleted: false,
                exitCode: code,
                rollbackSnapshotCreated: true,
                stdout,
                stderr,
                failureMessage: "OpenClaw update failed."
              })
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
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                updateAttempted: true,
                updateCompleted: false,
                exitCode: recovery.exitCode ?? code,
                rollbackSnapshotCreated: true,
                stdout,
                stderr,
                failureMessage: recovery.message
              }),
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
          const verifiedCapabilityDiff = buildOpenClawCapabilityDiffReport({
            certified: snapshot.diagnostics,
            target: verifiedSnapshot.diagnostics
          });
          const verification = verifyOpenClawUpdate(snapshot, verifiedSnapshot, targetVersion);
          const certifiedTarget = updateDecision.status === "certified";
          const postflightWarnings: string[] = [];

          if (!verification.ok) {
            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            const resultSnapshot = rollback.ok
              ? await refreshSnapshotAfterRollback(verifiedSnapshot)
              : verifiedSnapshot;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw postflight failed" : "OpenClaw rollback needed",
              message: `${verification.message} ${rollback.ok ? "Rollback completed." : rollback.message}`,
              targetVersion,
              rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
              recoveryCommand: rollback.ok ? undefined : buildOpenClawRollbackManualCommand(openClawBin, rollbackSnapshot),
              severity: rollback.ok ? "action_required" : "blocked"
            });

            await send({
              type: "done",
              ok: false,
              message: `${verification.message} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`,
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr,
              snapshot: resultSnapshot,
              capabilityDiff: verifiedCapabilityDiff,
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetSnapshot: verifiedSnapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                capabilityDiff: verifiedCapabilityDiff,
                updateAttempted: true,
                updateCompleted: false,
                exitCode: code,
                rollbackSnapshotCreated: true,
                rollbackToCertifiedBaseline: rollback.ok ? "passed" : "failed",
                stdout,
                stderr,
                failureMessage: verification.message
              }),
              manualCommand: rollback.ok ? undefined : buildOpenClawRollbackManualCommand(openClawBin, rollbackSnapshot)
            });
            await closeWriter();
            return;
          }

          const compatibilityVerification = verifyOpenClawPostUpdateCompatibility(verifiedSnapshot, {
            certifiedTarget
          });

          if (!compatibilityVerification.ok) {
            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            const resultSnapshot = rollback.ok
              ? await refreshSnapshotAfterRollback(verifiedSnapshot)
              : verifiedSnapshot;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw compatibility postflight failed" : "OpenClaw rollback needed",
              message: `${compatibilityVerification.message} ${rollback.ok ? "Rollback completed." : rollback.message}`,
              targetVersion,
              rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
              recoveryCommand: rollback.ok ? undefined : buildOpenClawRollbackManualCommand(openClawBin, rollbackSnapshot),
              severity: rollback.ok ? "action_required" : "blocked"
            });

            await send({
              type: "done",
              ok: false,
              message: `${compatibilityVerification.message} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`,
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr,
              snapshot: resultSnapshot,
              capabilityDiff: verifiedCapabilityDiff,
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetSnapshot: verifiedSnapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                capabilityDiff: verifiedCapabilityDiff,
                updateAttempted: true,
                updateCompleted: true,
                exitCode: code,
                rollbackSnapshotCreated: true,
                rollbackToCertifiedBaseline: rollback.ok ? "passed" : "failed",
                stdout,
                stderr,
                failureMessage: compatibilityVerification.message
              }),
              manualCommand: rollback.ok ? undefined : buildOpenClawRollbackManualCommand(openClawBin, rollbackSnapshot)
            });
            await closeWriter();
            return;
          }

          if (compatibilityVerification.warnings?.length) {
            postflightWarnings.push(compatibilityVerification.message);
            stdout = stdout
              ? `${stdout}\n${compatibilityVerification.message}`
              : compatibilityVerification.message;
            await recordUpdateRuntimeIssue({
              type: "openclaw_postflight_failed",
              title: certifiedTarget
                ? "OpenClaw certified postflight completed with warnings"
                : "OpenClaw postflight completed with warnings",
              message: compatibilityVerification.message,
              targetVersion,
              rawOutput: [stdout, stderr].filter(Boolean).join("\n"),
              severity: "warning"
            });
          }

          await send({
            type: "status",
            phase: "refreshing",
            message: "Running a live runtime smoke test..."
          });

          const smokeTest = await ensureOpenClawRuntimeSmokeTest({ force: true });
          const finalSnapshot = await getMissionControlSnapshot({ force: true });
          const finalCapabilityDiff = buildOpenClawCapabilityDiffReport({
            certified: snapshot.diagnostics,
            target: finalSnapshot.diagnostics
          });
          const smokeTestOutput = smokeTest.error || smokeTest.summary || "";

          if (smokeTest.status === "failed") {
            const classification = classifyOpenClawRuntimeSmokeTestFailure(smokeTestOutput);
            const smokeFailureMessage = classification
              ? `OpenClaw updated, but ${classification.detail}`
              : `OpenClaw updated, but the live runtime smoke test failed.${smokeTestOutput ? ` ${smokeTestOutput}` : ""}`;

            if (certifiedTarget) {
              const recoveryCommand = buildOpenClawRuntimeSmokeTestRecoveryCommand(
                formatOpenClawCommand(openClawBin, []),
                smokeTestOutput
              );
              stdout = stdout
                ? `${stdout}\n${smokeFailureMessage}`
                : smokeFailureMessage;
              await recordUpdateRuntimeIssue({
                type: "openclaw_postflight_failed",
                title: "OpenClaw certified runtime smoke needs review",
                message: smokeFailureMessage,
                targetVersion,
                rawOutput: [stdout, stderr, smokeTestOutput].filter(Boolean).join("\n"),
                recoveryCommand,
                severity: "action_required"
              });
              await send({
                type: "done",
                ok: true,
                message: `${verification.message} ${smokeFailureMessage}`.trim(),
                exitCode: code,
                stdout,
                stderr: stderr
                  ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                  : smokeTestOutput || "Runtime smoke test failed.",
                snapshot: finalSnapshot,
                capabilityDiff: finalCapabilityDiff,
                certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                  baselineSnapshot: snapshot,
                  targetSnapshot: finalSnapshot,
                  targetVersion,
                  decision: updateDecision,
                  preflightReport: preflight.report,
                  capabilityDiff: finalCapabilityDiff,
                  smokeTest,
                  updateAttempted: true,
                  updateCompleted: true,
                  exitCode: code,
                  rollbackSnapshotCreated: true,
                  rollbackToCertifiedBaseline: "not-required",
                  stdout,
                  stderr: stderr
                    ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                    : smokeTestOutput || "Runtime smoke test failed.",
                  failureMessage: smokeFailureMessage
                }),
                manualCommand: recoveryCommand
              });
              await closeWriter();
              return;
            }

            const rollback = await runRollbackOpenClaw(openClawBin, rollbackSnapshot, send);
            stdout += rollback.stdout;
            stderr += rollback.stderr;
            const resultSnapshot = rollback.ok
              ? await refreshSnapshotAfterRollback(finalSnapshot)
              : finalSnapshot;
            await recordUpdateRuntimeIssue({
              type: rollback.ok ? "openclaw_postflight_failed" : "openclaw_rollback_needed",
              title: rollback.ok ? "OpenClaw runtime smoke postflight failed" : "OpenClaw rollback needed",
              message: smokeFailureMessage,
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
              message: `${smokeFailureMessage} ${rollback.ok ? "Rolled back to the previous working OpenClaw version." : rollback.message}`.trim(),
              exitCode: rollback.exitCode ?? code,
              stdout,
              stderr: stderr
                ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                : smokeTestOutput || "Runtime smoke test failed.",
              snapshot: resultSnapshot,
              capabilityDiff: finalCapabilityDiff,
              certificationScorecard: buildOpenClawUpdateCertificationScorecard({
                baselineSnapshot: snapshot,
                targetSnapshot: finalSnapshot,
                targetVersion,
                decision: updateDecision,
                preflightReport: preflight.report,
                capabilityDiff: finalCapabilityDiff,
                smokeTest,
                updateAttempted: true,
                updateCompleted: true,
                exitCode: code,
                rollbackSnapshotCreated: true,
                rollbackToCertifiedBaseline: rollback.ok ? "passed" : "failed",
                stdout,
                stderr: stderr
                  ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                  : smokeTestOutput || "Runtime smoke test failed.",
                failureMessage: smokeFailureMessage
              }),
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
            message: postflightWarnings.length
              ? `${verification.message} ${postflightWarnings.join(" ")}`
              : verification.message,
            exitCode: code,
            stdout,
            stderr,
            snapshot: finalSnapshot,
            capabilityDiff: finalCapabilityDiff,
            certificationScorecard: buildOpenClawUpdateCertificationScorecard({
              baselineSnapshot: snapshot,
              targetSnapshot: finalSnapshot,
              targetVersion,
              decision: updateDecision,
              preflightReport: preflight.report,
              capabilityDiff: finalCapabilityDiff,
              smokeTest,
              updateAttempted: true,
              updateCompleted: true,
              exitCode: code,
              rollbackSnapshotCreated: true,
              stdout,
              stderr
            })
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
              : redactErrorMessage(error, "Status refresh failed."),
            certificationScorecard: buildOpenClawUpdateCertificationScorecard({
              baselineSnapshot: snapshot,
              targetVersion,
              decision: updateDecision,
              preflightReport: preflight.report,
              updateAttempted: true,
              updateCompleted: false,
              exitCode: code,
              rollbackSnapshotCreated: true,
              stdout,
              stderr,
              failureMessage: redactErrorMessage(error, "Status refresh failed.")
            })
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
        : "Use install-and-verify to test the target version. Treat this probe as limited evidence, not certification."
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

function verifyOpenClawPostUpdateCompatibility(
  snapshot: MissionControlSnapshot,
  input: { certifiedTarget?: boolean } = {}
): UpdateVerification {
  const issues: string[] = [];
  const warnings: string[] = [];
  const contract = snapshot.diagnostics.capabilityMatrix?.compatibility?.methodContract;
  const configPatch = snapshot.diagnostics.capabilityMatrix?.configPatch;

  if (!snapshot.diagnostics.loaded || !snapshot.diagnostics.rpcOk) {
    issues.push("Gateway did not report loaded RPC readiness.");
  }

  if (contract?.status === "drift" && (contract.missingRequiredMethods?.length ?? contract.missingMethodCount ?? 0) > 0) {
    issues.push("Required native Gateway methods are missing.");
  }

  if (configPatch !== "supported") {
    if (input.certifiedTarget) {
      warnings.push("Gateway config schema/patch support is not available.");
    } else {
      issues.push("Gateway config schema/patch support is not available.");
    }
  }

  if (snapshot.diagnostics.modelReadiness.ready === false && snapshot.diagnostics.modelReadiness.issues.length > 0) {
    const message = `Model readiness could not be confirmed: ${snapshot.diagnostics.modelReadiness.issues[0]}`;
    if (input.certifiedTarget) {
      warnings.push(message);
    } else {
      issues.push(message);
    }
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

  if (warnings.length > 0) {
    const fallbackCount = snapshot.diagnostics.transport?.fallbackTotal ?? 0;
    const lastNativeFailure =
      snapshot.diagnostics.transport?.lastNativeError ||
      snapshot.diagnostics.gatewayFallbackDiagnostics?.[0]?.issue ||
      "No native failure detail was reported.";

    return {
      ok: true,
      message: `${warnings.join(" ")} Fallback count: ${fallbackCount}. Last native failure: ${lastNativeFailure}`,
      warnings
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

function isOpenClawSnapshotGatewayReady(snapshot: MissionControlSnapshot) {
  return Boolean(snapshot.diagnostics.installed && snapshot.diagnostics.loaded && snapshot.diagnostics.rpcOk);
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

function buildOpenClawUpdateCertificationScorecard(input: {
  baselineSnapshot: MissionControlSnapshot;
  targetSnapshot?: MissionControlSnapshot | null;
  targetVersion: string;
  decision: ReturnType<typeof resolveOpenClawUpdateDecision>;
  preflightReport?: OpenClawUpdateSafetyReport | null;
  capabilityDiff?: OpenClawCapabilityDiffReport | null;
  smokeTest?: OpenClawRuntimeSmokeTest | null;
  updateAttempted: boolean;
  updateCompleted: boolean;
  exitCode?: number | null;
  rollbackSnapshotCreated: boolean;
  rollbackToCertifiedBaseline?: OpenClawCertificationRollbackEvidence;
  restoreLastWorking?: OpenClawCertificationRollbackEvidence;
  stdout?: string;
  stderr?: string;
  failureMessage?: string | null;
}) {
  const targetSnapshot = input.targetSnapshot ?? null;
  const targetDiagnostics = targetSnapshot?.diagnostics ?? null;
  const targetVersion = normalizeVersion(input.targetVersion) || input.targetVersion;
  const installedVersion = normalizeVersion(targetDiagnostics?.version);
  const baselineVersion = normalizeVersion(input.baselineSnapshot.diagnostics.version);
  const rollbackToCertifiedBaseline =
    input.rollbackToCertifiedBaseline ??
    (baselineVersion && targetVersion && compareVersionStrings(baselineVersion, targetVersion) === 0
      ? "not-required"
      : "not-run");

  return buildOpenClawCertificationScorecardReport({
    baselineDiagnostics: input.baselineSnapshot.diagnostics,
    targetDiagnostics,
    capabilityDiff: input.capabilityDiff ?? null,
    preflightReport: input.preflightReport ?? null,
    manifestDecision: input.decision,
    smokeTest: input.smokeTest ?? targetDiagnostics?.runtime.smokeTest ?? null,
    update: {
      attempted: input.updateAttempted,
      completed: input.updateCompleted,
      exitCode: input.exitCode ?? null,
      targetVersion,
      installedVersion,
      rollbackSnapshotCreated: input.rollbackSnapshotCreated,
      rollbackToCertifiedBaseline,
      restoreLastWorking: input.restoreLastWorking ?? "not-run",
      output: [input.stdout, input.stderr].filter(Boolean).join("\n"),
      failureMessage: input.failureMessage ?? null
    }
  });
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

  const currentVersionResult = await runRecoveryCommand(openClawBin, ["--version"], async () => {}, {
    timeoutMs: 15_000,
    streamOutput: false
  });
  const currentVersion = normalizeVersion(
    [currentVersionResult.stdout, currentVersionResult.stderr].filter(Boolean).join("\n")
  );
  const rollbackVersion = normalizeVersion(rollbackSnapshot.version);

  if (
    currentVersion &&
    rollbackVersion &&
    compareVersionStrings(currentVersion, rollbackVersion) === 0
  ) {
    const recovery = await restoreConfigAndRestartOpenClaw(openClawBin, rollbackSnapshot, send);

    return {
      ok: recovery.ok,
      message: recovery.ok
        ? `Rolled back OpenClaw to v${rollbackSnapshot.version}.`
        : recovery.message,
      exitCode: recovery.exitCode,
      stdout: [
        currentVersionResult.stdout,
        recovery.stdout
      ].filter(Boolean).join("\n"),
      stderr: [
        currentVersionResult.stderr,
        recovery.stderr
      ].filter(Boolean).join("\n")
    };
  }

  const rollbackResult = await runRecoveryCommand(openClawBin, buildOpenClawUpdateArgs(rollbackSnapshot.version), send, {
    timeoutMs: updateTimeoutMs
  });

  if (rollbackResult.errorMessage || rollbackResult.timedOut || rollbackResult.code !== 0) {
    const rollbackOutput = [rollbackResult.stdout, rollbackResult.stderr, rollbackResult.errorMessage]
      .filter(Boolean)
      .join("\n");

    if (isOpenClawDowngradeConfigBlocker(rollbackOutput)) {
      const postFailureVersionResult = await runRecoveryCommand(openClawBin, ["--version"], async () => {}, {
        timeoutMs: 15_000,
        streamOutput: false
      });
      const postFailureVersion = normalizeVersion(
        [postFailureVersionResult.stdout, postFailureVersionResult.stderr].filter(Boolean).join("\n")
      );

      if (
        postFailureVersion &&
        rollbackVersion &&
        compareVersionStrings(postFailureVersion, rollbackVersion) === 0
      ) {
        const recovery = await restoreConfigAndRestartOpenClaw(openClawBin, rollbackSnapshot, send);

        return {
          ok: recovery.ok,
          message: recovery.ok
            ? `Rolled back OpenClaw to v${rollbackSnapshot.version}.`
            : recovery.message,
          exitCode: recovery.exitCode,
          stdout: [
            rollbackResult.stdout,
            postFailureVersionResult.stdout,
            recovery.stdout
          ].filter(Boolean).join("\n"),
          stderr: [
            rollbackResult.stderr || rollbackResult.errorMessage,
            postFailureVersionResult.stderr,
            recovery.stderr
          ].filter(Boolean).join("\n")
        };
      }
    }

    return {
      ok: false,
      message: "Automatic OpenClaw rollback failed. Use the manual update command from the details panel.",
      exitCode: rollbackResult.code,
      stdout: rollbackResult.stdout,
      stderr: rollbackResult.stderr || rollbackResult.errorMessage || "Rollback command failed."
    };
  }

  const recovery = await restoreConfigAndRestartOpenClaw(openClawBin, rollbackSnapshot, send);

  return {
    ok: recovery.ok,
    message: recovery.ok
      ? `Rolled back OpenClaw to v${rollbackSnapshot.version}.`
      : recovery.message,
    exitCode: recovery.exitCode,
    stdout: [
      rollbackResult.stdout,
      recovery.stdout
    ].filter(Boolean).join("\n"),
    stderr: [
      rollbackResult.stderr,
      recovery.stderr
    ].filter(Boolean).join("\n")
  };
}

function buildOpenClawRollbackManualCommand(
  openClawBin: string,
  rollbackSnapshot: OpenClawRollbackSnapshot
) {
  return buildOpenClawDowngradeConfigBlockerManualCommand(
    formatOpenClawCommand(openClawBin, []),
    rollbackSnapshot.version
  );
}

async function restoreConfigAndRestartOpenClaw(
  openClawBin: string,
  rollbackSnapshot: OpenClawRollbackSnapshot,
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>
) {
  const configRestore = await restoreOpenClawRollbackConfigSnapshot(rollbackSnapshot);
  let stdout = `${configRestore.message}\n`;
  let stderr = "";

  if (!configRestore.restored) {
    return {
      ok: false,
      message: configRestore.message,
      exitCode: null,
      stdout,
      stderr
    };
  }

  await send({
    type: "status",
    phase: "refreshing",
    message: "Restarting OpenClaw Gateway with the restored config snapshot..."
  });

  const restartResult = await runRecoveryCommand(openClawBin, ["gateway", "restart"], send, {
    timeoutMs: 90_000
  });
  stdout += restartResult.stdout;
  stderr += restartResult.stderr;

  if (restartResult.errorMessage || restartResult.timedOut || restartResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw config snapshot was restored, but Gateway restart failed.",
      exitCode: restartResult.code,
      stdout,
      stderr: stderr || restartResult.errorMessage || "Gateway restart failed."
    };
  }

  await send({
    type: "status",
    phase: "refreshing",
    message: "Waiting for the OpenClaw gateway to become ready..."
  });

  const healthResult = await waitForGatewayReady(openClawBin);
  stdout += healthResult.stdout;
  stderr += healthResult.stderr;

  if (healthResult.errorMessage || healthResult.timedOut || healthResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw config snapshot was restored, but Gateway did not become healthy.",
      exitCode: healthResult.code,
      stdout,
      stderr: stderr || healthResult.errorMessage || "Gateway readiness check failed."
    };
  }

  return {
    ok: true,
    message: "Restored OpenClaw config and restarted Gateway.",
    exitCode: 0,
    stdout,
    stderr
  };
}

async function refreshSnapshotAfterRollback(fallbackSnapshot: MissionControlSnapshot) {
  resetOpenClawBinCache();
  clearMissionControlCaches();

  return getMissionControlSnapshot({ force: true }).catch(() => fallbackSnapshot);
}

async function runCertifiedRollbackSnapshotRecovery(input: {
  openClawBin: string;
  rollbackSnapshot: OpenClawRollbackSnapshot;
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>;
  targetVersion: string;
}) {
  const rollback = await runRollbackOpenClaw(input.openClawBin, input.rollbackSnapshot, input.send);
  resetOpenClawBinCache();
  clearMissionControlCaches();
  const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);

  if (!rollback.ok) {
    await recordUpdateRuntimeIssue({
      type: "openclaw_rollback_needed",
      title: "OpenClaw certified recovery failed",
      message: rollback.message,
      targetVersion: input.targetVersion,
      rawOutput: [rollback.stdout, rollback.stderr].filter(Boolean).join("\n"),
      recoveryCommand: formatOpenClawCommand(input.openClawBin, buildOpenClawUpdateArgs(input.rollbackSnapshot.version)),
      severity: "blocked"
    });
  }

  return {
    ...rollback,
    snapshot
  };
}

function shouldUseCertifiedRollbackSnapshotRecovery(
  snapshot: MissionControlSnapshot,
  targetVersion: string,
  decision: ReturnType<typeof resolveOpenClawUpdateDecision>,
  rollbackSnapshot: OpenClawRollbackSnapshot | null
) {
  const currentVersion = normalizeVersion(snapshot.diagnostics.version);
  const normalizedTarget = normalizeVersion(targetVersion);
  const rollbackVersion = normalizeVersion(rollbackSnapshot?.version);

  return Boolean(
    currentVersion &&
      normalizedTarget &&
      rollbackVersion &&
      decision.status === "certified" &&
      compareVersionStrings(rollbackVersion, normalizedTarget) === 0 &&
      compareVersionStrings(currentVersion, normalizedTarget) >= 0
  );
}

function resolveNewerRollbackSnapshotVersion(
  targetVersion: string,
  rollbackSnapshot: OpenClawRollbackSnapshot | null
) {
  const normalizedTarget = normalizeVersion(targetVersion);
  const rollbackVersion = normalizeVersion(rollbackSnapshot?.version);

  if (!normalizedTarget || !rollbackVersion || compareVersionStrings(rollbackVersion, normalizedTarget) <= 0) {
    return null;
  }

  return rollbackVersion;
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
