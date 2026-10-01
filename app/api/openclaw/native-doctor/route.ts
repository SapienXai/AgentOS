import { NextResponse } from "next/server";
import { z } from "zod";

import {
  auditResultForNativeDoctorMutation,
  buildNativeDoctorConfirmation,
  claimNativeUpdateRunAdmission,
  confirmationMatches,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot,
  reconcileNativeDoctorMutation
} from "@/lib/openclaw/application/native-doctor-service";
import { getNormalOpenClawUpdatePolicy } from "@/lib/openclaw/application/normal-update-policy-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  canAgentOsActorUseProductPermission,
  requireAgentOsProductPermission
} from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { guardNormalOpenClawUpdate } from "@/lib/openclaw/domains/normal-update-policy";
import { reconcileAgentOsSessionSecurityDefaults } from "@/lib/openclaw/domains/session-security-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  connectionId: z.string().nullable(),
  deviceId: z.string().nullable(),
  connectionGeneration: z.number().int().nonnegative().nullable(),
  currentVersion: z.string().nullable(),
  effectiveChannel: z.string().nullable(),
  availableVersion: z.string().nullable(),
  updateReadStatus: z.enum(["available", "unavailable", "forbidden", "unknown"]),
  updateStatus: z.enum(["available", "current", "unavailable", "unknown"]),
  updateAvailable: z.boolean().nullable(),
  availabilitySource: z.enum(["native-gateway", "openclaw-cli-fallback"]).nullable(),
  authenticated: z.boolean().nullable(),
  grantedScopesKnown: z.boolean().nullable(),
  updateAuthorized: z.boolean(),
  runtimeStatus: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
  statusReadStatus: z.enum(["available", "unavailable", "forbidden", "unknown"]),
  configReadStatus: z.enum(["available", "unavailable", "forbidden", "unknown"]),
  configValid: z.boolean().nullable(),
  configApplication: z.enum(["applied", "restart-required", "unknown"]),
  configuredRevisionHash: z.string().nullable(),
  appliedRevisionHash: z.string().nullable(),
  recoveryStatus: z.enum(["healthy", "needs-attention", "restart-required", "unavailable", "unknown"]),
  agentOsVersion: z.string().nullable(),
  compatibilityStatus: z.enum(["certified", "candidate", "blocked", "unknown"]).nullable(),
  compatibilityAllowed: z.boolean().nullable(),
  requiresAgentOsUpdate: z.boolean().nullable(),
  minRequiredAgentOsVersion: z.string().nullable()
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update.run"),
    confirmation: confirmationSchema,
    unverifiedAcknowledged: z.boolean().optional(),
    note: z.string().trim().max(200).optional()
  }).strict(),
  z.object({
    action: z.literal("update.hold"),
    confirmation: confirmationSchema
  }).strict(),
  z.object({
    action: z.literal("gateway.restart.request"),
    confirmation: confirmationSchema,
    reason: z.string().trim().max(200).optional()
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.prepare"),
    confirmation: confirmationSchema,
    requestId: z.string().trim().min(1).max(128),
    terminalPolicy: z.enum(["preserve", "terminate"]).optional(),
    drain: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.status"),
    suspensionId: z.string().trim().min(1).max(128)
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.resume"),
    confirmation: confirmationSchema,
    suspensionId: z.string().trim().min(1).max(128)
  }).strict()
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  const probe = new URL(request.url).searchParams.get("probe") === "1";
  const snapshot = await getNativeDoctorSnapshot(probe ? { probe: true, refreshCheckout: true } : {});
  const policy = await getNormalOpenClawUpdatePolicy(snapshot);
  return NextResponse.json(redactSecrets({
    snapshot,
    confirmation: buildNativeDoctorConfirmation(snapshot, {
      agentOsVersion: policy.agentOsVersion,
      decision: policy.agentOsDecision
    }),
    policy,
    permissions: {
      canManageUpdates: canAgentOsActorUseProductPermission(permission.actor, "updates.manage")
    }
  }), {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid native Doctor operation." }, { status: 400 });
  }

  const permissionName = input.action.startsWith("update.") ? "updates.manage" : "lifecycle.manage";
  const permission = await requireAgentOsProductPermission(request, permissionName);
  if ("response" in permission) return permission.response;

  let releaseUpdateAdmission: (() => void) | null = null;
  try {
    const adapter = getOpenClawAdapter();
    let current = await getNativeDoctorSnapshot({
      adapter,
      ...(input.action.startsWith("update.") ? { refreshCheckout: true } : {})
    });
    let policy = input.action !== "gateway.suspend.status"
      ? await getNormalOpenClawUpdatePolicy(current)
      : null;
    let confirmationMatchesCurrent = input.action === "gateway.suspend.status"
      ? true
      : confirmationMatches(input.confirmation, buildNativeDoctorConfirmation(current, policy ? {
          agentOsVersion: policy.agentOsVersion,
          decision: policy.agentOsDecision
        } : undefined));
    const recordRejectedMutation = () => recordAgentOsAuditEvent({
      actor: permission.actor,
      operation: `openclaw.${input.action}`,
      targetKind: "gateway",
      targetId: current.identity.connectionId ?? "current-gateway",
      result: "failed"
    }).catch(() => {});

    if (input.action === "update.run" && policy) {
      const gate = guardNormalOpenClawUpdate({
        policy,
        confirmationMatches: confirmationMatchesCurrent,
        unverifiedAcknowledged: input.unverifiedAcknowledged === true
      });
      if (!gate.allowed) {
        await recordRejectedMutation();
        return NextResponse.json(redactSecrets({
          error: gate.error,
          code: gate.code,
          policy
        }), {
          status: gate.status,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    if (input.action === "update.run") {
      const securityMigration = await reconcileAgentOsSessionSecurityDefaults({ adapter });
      if (securityMigration.status === "blocked-external-runtime" || securityMigration.status === "blocked-unsafe-policy") {
        return NextResponse.json(redactSecrets({
          error: securityMigration.status === "blocked-unsafe-policy"
            ? "OpenClaw explicitly enables cross-agent access but omits its allowlist. Configure an explicit allowlist before using the normal update path."
            : "OpenClaw session-security settings are omitted, and AgentOS cannot safely change configuration on this externally managed Gateway.",
          code: "UPDATE_SECURITY_POLICY_REQUIRED",
          migration: securityMigration
        }), { status: 409, headers: { "Cache-Control": "no-store" } });
      }
      if (securityMigration.status === "failed") {
        return NextResponse.json(redactSecrets({
          error: "AgentOS could not make the OpenClaw session-security defaults explicit. Refresh and retry after reviewing Gateway configuration.",
          code: "UPDATE_SECURITY_POLICY_REQUIRED",
          migration: securityMigration
        }), { status: 503, headers: { "Cache-Control": "no-store" } });
      }

      // Session-security preflight may update config. Read fresh runtime facts
      // and bind the final update call to the exact confirmation again.
      current = await getNativeDoctorSnapshot({ adapter, refreshCheckout: true });
      policy = await getNormalOpenClawUpdatePolicy(current);
      confirmationMatchesCurrent = confirmationMatches(
        input.confirmation,
        buildNativeDoctorConfirmation(current, {
          agentOsVersion: policy.agentOsVersion,
          decision: policy.agentOsDecision
        })
      );
      const freshGate = guardNormalOpenClawUpdate({
        policy,
        confirmationMatches: confirmationMatchesCurrent,
        unverifiedAcknowledged: input.unverifiedAcknowledged === true
      });
      if (!freshGate.allowed) {
        await recordRejectedMutation();
        return NextResponse.json(redactSecrets({ error: freshGate.error, code: freshGate.code, policy }), {
          status: freshGate.status,
          headers: { "Cache-Control": "no-store" }
        });
      }
    }

    if (input.action === "update.hold" && policy && !confirmationMatchesCurrent) {
      await recordRejectedMutation();
      return NextResponse.json(
        redactSecrets({
          error: "The OpenClaw Gateway identity, update channel, or available target changed. Refresh before retrying.",
          code: "UPDATE_CONFIRMATION_STALE",
          policy
        }),
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (input.action === "update.hold" && policy && !policy.canHoldUpdate) {
      await recordRejectedMutation();
      return NextResponse.json(
        redactSecrets({
          error: "OpenClaw does not report an active automatic update campaign that can be held.",
          code: "UPDATE_HOLD_NOT_AVAILABLE",
          policy
        }),
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (input.action !== "gateway.suspend.status") {
      if (!confirmationMatchesCurrent) {
        await recordRejectedMutation();
        return NextResponse.json(
          { error: "The OpenClaw Gateway identity, update channel, or available target changed. Refresh before retrying.", code: "UPDATE_CONFIRMATION_STALE" },
          { status: 409 }
        );
      }
    }

    if (
      input.action === "update.run" &&
      adapter.getNativeConnectionGeneration?.() !== current.identity.connectionGeneration
    ) {
      await recordRejectedMutation();
      return NextResponse.json(
        { error: "The Gateway reconnected after confirmation. Refresh update status and confirm the current target again.", code: "UPDATE_CONFIRMATION_STALE" },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (input.action === "update.run") {
      releaseUpdateAdmission = claimNativeUpdateRunAdmission();
      if (!releaseUpdateAdmission) {
        await recordRejectedMutation();
        return NextResponse.json(
          { error: "An OpenClaw native update request is already being reconciled. Refresh native status before trying again.", code: "UPDATE_ALREADY_RUNNING" },
          { status: 409, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    const mutation = await executeNativeDoctorMutation(
      input.action === "update.run"
        ? { action: input.action, input: input.note === undefined ? undefined : { note: input.note } }
        : input.action === "update.hold"
          ? { action: input.action }
          : input.action === "gateway.restart.request"
            ? { action: input.action, input: { reason: input.reason, skipDeferral: false } }
            : input.action === "gateway.suspend.prepare"
              ? {
                  action: input.action,
                  input: {
                    requestId: input.requestId,
                    ...(input.terminalPolicy ? { terminalPolicy: input.terminalPolicy } : {}),
                    ...(input.drain === undefined ? {} : { drain: input.drain })
                  }
                }
              : input.action === "gateway.suspend.status"
                ? { action: input.action, input: { suspensionId: input.suspensionId } }
                : { action: input.action, input: { suspensionId: input.suspensionId } }
    );
    const result = input.action === "gateway.restart.request" || input.action === "update.run"
      ? await reconcileNativeDoctorMutation(mutation, { before: current, adapter })
      : mutation;

    await recordAgentOsAuditEvent({
      actor: permission.actor,
      operation: `openclaw.${input.action}`,
      targetKind: "gateway",
      targetId: current.identity.connectionId ?? "current-gateway",
      result: auditResultForNativeDoctorMutation(
        result.outcome,
        input.action === "update.run" ? result.verification.status : undefined
      )
    }).catch(() => {});

    return NextResponse.json(redactSecrets({ result }), {
      status: result.outcome === "failed" ? 400 : result.outcome === "unknown" || result.verification.status === "unknown" ? 409 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: permission.actor,
      operation: `openclaw.${input.action}`,
      targetKind: "gateway",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to complete the native OpenClaw operation.") },
      { status: 400 }
    );
  } finally {
    releaseUpdateAdmission?.();
  }
}
