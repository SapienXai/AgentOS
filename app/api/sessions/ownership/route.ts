import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getMissionControlSnapshot, invalidateMissionControlSnapshotCache } from "@/lib/openclaw/application/mission-control-service";
import { loadNativeSessionOwnershipDetail } from "@/lib/openclaw/application/mission-control/native-work-detail";
import {
  readNativeSessionMemberPresence,
  readNativeSessionOwner,
  readNativeSessionVisibility,
  reconcileNativeSessionMemberMutation,
  reconcileNativeSessionOwnerMutation,
  reconcileNativeSessionVisibilityMutation
} from "@/lib/openclaw/application/session-collaboration-service";
import {
  buildNativeMutationFailureResponse,
  executeNativeMutation
} from "@/lib/openclaw/application/native-mutation-service";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { listOpenClawUserProfiles } from "@/lib/openclaw/application/user-profile-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assignSchema = z.union([
  z.object({
    action: z.literal("assignOwner"),
    sessionKey: z.string().min(1).max(512),
    agentId: z.string().min(1).max(128)
  }),
  z.object({
    action: z.literal("assignOwner"),
    sessionKey: z.string().min(1).max(512),
    ownerType: z.literal("human"),
    profileId: z.string().trim().min(1).max(128)
  })
]);

const collaborationSchema = z.union([
  assignSchema,
  z.object({
    action: z.literal("setVisibility"),
    sessionKey: z.string().min(1).max(512),
    visibility: z.enum(["shared", "read-only", "suggest", "draft"])
  }),
  z.object({
    action: z.literal("addMember"),
    sessionKey: z.string().min(1).max(512),
    profileId: z.string().trim().min(1).max(128)
  }),
  z.object({
    action: z.literal("removeMember"),
    sessionKey: z.string().min(1).max(512),
    profileId: z.string().trim().min(1).max(128)
  })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.use");
  if ("response" in permission) return permission.response;
  const sessionKey = new URL(request.url).searchParams.get("sessionKey");

  if (sessionKey === null) {
    const snapshot = await getMissionControlSnapshot();
    return NextResponse.json(redactSecrets({
      availability: snapshot.nativeWork?.availability ?? null,
      executions: snapshot.nativeWork?.executions ?? [],
      worktrees: snapshot.nativeWork?.worktrees ?? []
    }), { headers: { "Cache-Control": "no-store" } });
  }

  const sessionKeyResult = z.string().min(1).max(512).safeParse(sessionKey);
  if (!sessionKeyResult.success) {
    return NextResponse.json({ error: "A valid OpenClaw session key is required." }, { status: 400 });
  }

  const memberPreflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "session.members.list",
    method: "session.members.list",
    params: { sessionKey },
    targetKind: "openclaw-session",
    targetId: sessionKey,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "sessions.use"
  });
  if ("response" in memberPreflight) return memberPreflight.response;

  const evidencePreflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "session.members.listEvidence",
    method: "session.members.listEvidence",
    params: { sessionKey },
    targetKind: "openclaw-session",
    targetId: sessionKey,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "sessions.use"
  });
  if ("response" in evidencePreflight) return evidencePreflight.response;

  try {
    const snapshot = await getMissionControlSnapshot();
    const execution = snapshot.nativeWork?.executions.find((entry) => entry.sessionKey === sessionKey);
    if (!execution) {
      return NextResponse.json({ error: "The OpenClaw session is not visible in the current snapshot." }, { status: 404 });
    }
    const detail = await loadNativeSessionOwnershipDetail({
      execution,
      adapter: getOpenClawAdapter(),
      timeoutMs: 5_000,
      signal: request.signal
    });
    return NextResponse.json(redactSecrets({
      availability: snapshot.nativeWork?.availability ?? null,
      execution: { ...execution, ownership: detail.ownership },
      detailState: detail.state
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Session membership detail is unavailable.") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.collaborate");
  if ("response" in permission) return permission.response;
  let input: z.infer<typeof collaborationSchema>;
  try {
    input = collaborationSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to update native session collaboration.") }, { status: 400 });
  }
  const adapter = getOpenClawAdapter();

  if (input.action === "assignOwner") {
    const owner = "ownerType" in input
      ? { type: "human" as const, id: input.profileId }
      : { type: "agent" as const, id: input.agentId };

    if (owner.type === "human") {
      const profileRead = await requireAgentOsOpenClawPreflight(request, {
        operation: "session.assign-owner.profile-read",
        method: "users.list",
        params: {},
        targetKind: "openclaw-user-profile",
        targetId: owner.id,
        securityClass: "read",
        executionPath: "gateway-native",
        productPermission: "sessions.collaborate"
      });
      if ("response" in profileRead) return profileRead.response;
      const profiles = await listOpenClawUserProfiles(profileRead.commandOptions);
      if (!profiles.profiles.some((profile) => profile.profileId === owner.id)) {
        return NextResponse.json({ error: "The native OpenClaw human profile was not found.", code: "openclaw-profile-not-found" }, { status: 404 });
      }
    }

    const preflight = await requireAgentOsOpenClawPreflight(request, {
      operation: "session.assign-owner",
      method: "sessions.assignOwner",
      params: { key: input.sessionKey, owner },
      targetKind: "openclaw-session",
      targetId: input.sessionKey,
      securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "sessions.collaborate"
    });
    if ("response" in preflight) return preflight.response;
    const beforeOwner = await readNativeSessionOwner({
      adapter,
      sessionKey: input.sessionKey,
      timeoutMs: 5_000
    });
    const mutation = await executeNativeMutation({
      operation: "sessions.assignOwner",
      mutate: async () => {
        const result = await adapter.assignSessionOwner?.({ key: input.sessionKey, owner }, preflight.commandOptions);
        if (!result) throw new NativeGatewayError("sessions.assignOwner is not available in the current OpenClaw adapter.", { kind: "unsupported" });
        return result;
      },
      reconcile: async () => {
        const reconciliation = await reconcileNativeSessionOwnerMutation({
          adapter,
          sessionKey: input.sessionKey,
          target: owner,
          beforeOwner,
          timeoutMs: 5_000
        });
        return {
          verified: reconciliation.changedAndVerified,
          result: reconciliation.changedAndVerified
            ? { ok: true as const, key: input.sessionKey, owner: { actor: { type: owner.type, id: owner.id } } }
            : null
        };
      }
    });
    if (mutation.outcome === "succeeded") {
      invalidateMissionControlSnapshotCache();
      await recordAgentOsAuditEvent({ actor: preflight.actor, operation: "session.assign-owner", targetKind: "openclaw-session", targetId: input.sessionKey, result: "succeeded" }).catch(() => {});
      return NextResponse.json(redactSecrets({ ...mutation.result, outcome: "succeeded", reconciled: mutation.reconciled, retryable: mutation.retryable }), { headers: { "Cache-Control": "no-store" } });
    }
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: "session.assign-owner", targetKind: "openclaw-session", targetId: input.sessionKey, result: mutation.outcome }).catch(() => {});
    const failure = buildNativeMutationFailureResponse(mutation);
    return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }

  if (input.action === "addMember" || input.action === "removeMember") {
    const profileRead = await requireAgentOsOpenClawPreflight(request, {
      operation: `session.${input.action}.profile-read`,
      method: "users.list",
      params: {},
      targetKind: "openclaw-user-profile",
      targetId: input.profileId,
      securityClass: "read",
      executionPath: "gateway-native",
      productPermission: "sessions.collaborate"
    });
    if ("response" in profileRead) return profileRead.response;
    const profiles = await listOpenClawUserProfiles(profileRead.commandOptions);
    if (!profiles.profiles.some((profile) => profile.profileId === input.profileId)) {
      return NextResponse.json({ error: "The native OpenClaw human profile was not found.", code: "openclaw-profile-not-found" }, { status: 404 });
    }
  }

  const method = input.action === "setVisibility"
    ? "session.visibility.set"
    : input.action === "addMember"
      ? "session.members.add"
      : "session.members.remove";
  const params = input.action === "setVisibility"
    ? { sessionKey: input.sessionKey, visibility: input.visibility }
    : { sessionKey: input.sessionKey, identityId: input.profileId };
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: `session.collaboration.${input.action}`,
    method,
    params,
    targetKind: "openclaw-session",
    targetId: input.sessionKey,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "sessions.collaborate"
  });
  if ("response" in preflight) return preflight.response;

  const beforePresent = input.action === "setVisibility"
    ? undefined
    : await readNativeSessionMemberPresence({
      adapter,
      sessionKey: input.sessionKey,
      identityId: input.profileId,
      timeoutMs: 5_000
    });
  const beforeVisibility = input.action === "setVisibility"
    ? await readNativeSessionVisibility({ adapter, sessionKey: input.sessionKey, timeoutMs: 5_000 })
    : undefined;
  const mutation = await executeNativeMutation({
    operation: method,
    mutate: async () => {
      const result = input.action === "setVisibility"
        ? await adapter.setSessionVisibility?.({ sessionKey: input.sessionKey, visibility: input.visibility }, preflight.commandOptions)
        : input.action === "addMember"
          ? await adapter.addSessionMember?.({ sessionKey: input.sessionKey, identityId: input.profileId }, preflight.commandOptions)
          : await adapter.removeSessionMember?.({ sessionKey: input.sessionKey, identityId: input.profileId }, preflight.commandOptions);
      if (!result) throw new NativeGatewayError(`${method} is not available in the current OpenClaw adapter.`, { kind: "unsupported" });
      return result;
    },
    reconcile: async () => {
      if (input.action === "setVisibility") {
        const reconciliation = await reconcileNativeSessionVisibilityMutation({
          adapter,
          sessionKey: input.sessionKey,
          expectedVisibility: input.visibility,
          beforeVisibility,
          timeoutMs: 5_000
        });
        return {
          verified: reconciliation.changedAndVerified,
          result: reconciliation.changedAndVerified
            ? { ok: true as const, sessionKey: input.sessionKey, visibility: input.visibility }
            : null
        };
      }
      const reconciliation = await reconcileNativeSessionMemberMutation({
        adapter,
        sessionKey: input.sessionKey,
        identityId: input.profileId,
        expectedPresent: input.action === "addMember",
        beforePresent,
        timeoutMs: 5_000
      });
      return {
        verified: reconciliation.changedAndVerified,
        result: reconciliation.changedAndVerified
          ? { ok: true as const, sessionKey: input.sessionKey, identityId: input.profileId }
          : null
      };
    }
  });
  if (mutation.outcome === "succeeded") {
    invalidateMissionControlSnapshotCache();
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: `session.${input.action}`, targetKind: "openclaw-session", targetId: input.sessionKey, result: "succeeded" }).catch(() => {});
    return NextResponse.json(redactSecrets({ ...mutation.result, outcome: "succeeded", reconciled: mutation.reconciled, retryable: mutation.retryable }), { headers: { "Cache-Control": "no-store" } });
  }
  await recordAgentOsAuditEvent({ actor: preflight.actor, operation: `session.${input.action}`, targetKind: "openclaw-session", targetId: input.sessionKey, result: mutation.outcome }).catch(() => {});
  const failure = buildNativeMutationFailureResponse(mutation);
  return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
}
