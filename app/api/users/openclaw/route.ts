import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listAgentOsUsers,
  getCurrentAgentOsUser,
  updateManagedAgentOsUserOpenClawLinkage
} from "@/lib/agentos/application/agentos-account-service";
import { projectAgentOsOpenClawIdentity } from "@/lib/openclaw/domains/native-human-identity";
import {
  OpenClawUserProfileCapabilityError,
  listOpenClawGatewayRoleNames,
  listOpenClawUserProfiles,
  executeOpenClawUserRoleMutation
} from "@/lib/openclaw/application/user-profile-service";
import { buildNativeMutationFailureResponse } from "@/lib/openclaw/application/native-mutation-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const linkageSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(128) }),
  z.object({ action: z.literal("unlink"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(128) }),
  z.object({ action: z.literal("role"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(128), role: z.string().trim().min(1).max(80).nullable() })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "users.manage");
  if ("response" in permission) return permission.response;
  try {
    const [native, agentOsUsers] = await Promise.all([listOpenClawUserProfiles(), listAgentOsUsers()]);
    const profiles = native.profiles;
    const associations = agentOsUsers.map((user) => ({
      actorId: user.actorId,
      username: user.username,
      agentOsRole: user.role,
      status: user.status,
      identity: projectAgentOsOpenClawIdentity({ linkage: user.openClaw, profiles })
    }));
    return NextResponse.json({
      profiles,
      connection: { attribution: "shared-service", nativeHumanIdentityVerified: false },
      associations
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "Unable to inspect OpenClaw user profiles."),
      ...(error instanceof OpenClawUserProfileCapabilityError ? { code: "openclaw-users-unsupported" } : {})
    }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const permission = await requireAgentOsProductPermission(request, "openclaw.roles.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = linkageSchema.parse(await request.json());
    const user = await getCurrentAgentOsUser(input.actorId);
    if (!user) return NextResponse.json({ error: "AgentOS user was not found.", code: "user-not-found" }, { status: 404 });
    const profiles = await listOpenClawUserProfiles();
    const profile = profiles.profiles.find((entry) => entry.profileId === input.profileId);
    // Unlinking is allowed to reconcile a stale metadata association. Link and
    // native role operations must still target a currently listed profile.
    if (input.action !== "unlink" && !profile) return NextResponse.json({ error: "The OpenClaw profile was not found.", code: "openclaw-profile-not-found" }, { status: 404 });

    if (input.action === "role") {
      const authorization = await requireAgentOsOpenClawPreflight(request, {
        operation: "users.setRole",
        method: "users.setRole",
        params: { profileId: input.profileId, role: input.role },
        targetKind: "openclaw-user-profile",
        targetId: input.profileId,
        securityClass: "privileged-mutation",
        executionPath: "gateway-native",
        productPermission: "openclaw.roles.manage"
      });
      if ("response" in authorization) return authorization.response;
      const roleNames = await listOpenClawGatewayRoleNames(authorization.commandOptions);
      if (input.role !== null && roleNames && !roleNames.includes(input.role)) {
        return NextResponse.json({ error: "The OpenClaw role is not defined by the active Gateway policy.", code: "openclaw-role-not-configured" }, { status: 400 });
      }
      const mutation = await executeOpenClawUserRoleMutation({
        profileId: input.profileId,
        role: input.role,
        beforeRole: profile?.role,
        options: authorization.commandOptions
      });
      if (mutation.outcome === "succeeded") {
        const updated = mutation.result;
        await recordAgentOsAuditEvent({ actor: permission.actor, operation: "users.openclaw.set-role", targetKind: "openclaw-user-profile", targetId: input.profileId, result: "succeeded" }).catch(() => {});
        return NextResponse.json({ profile: updated, roleNames, outcome: "succeeded", reconciled: mutation.reconciled, retryable: mutation.retryable });
      }
      await recordAgentOsAuditEvent({ actor: permission.actor, operation: "users.openclaw.set-role", targetKind: "openclaw-user-profile", targetId: input.profileId, result: mutation.outcome }).catch(() => {});
      const failure = buildNativeMutationFailureResponse(mutation);
      return NextResponse.json(failure.body, { status: failure.status });
    }

    if (input.action === "unlink") {
      if (user.openClaw.profileId !== input.profileId) return NextResponse.json({ error: "The OpenClaw profile is not linked to this AgentOS user.", code: "openclaw-linkage-mismatch" }, { status: 409 });
      await updateManagedAgentOsUserOpenClawLinkage({ actorId: input.actorId, profileId: null, role: null, linkageState: "unlinked", lastVerifiedAt: null });
    } else {
      if (!profile) return NextResponse.json({ error: "The OpenClaw profile was not found.", code: "openclaw-profile-not-found" }, { status: 404 });
      // The stored linkage is compatibility metadata. It is intentionally not
      // marked as verified because this request still uses the shared Gateway
      // service identity rather than the AgentOS actor's native credentials.
      await updateManagedAgentOsUserOpenClawLinkage({ actorId: input.actorId, profileId: profile.profileId, role: profile.role, linkageState: "linked", lastVerifiedAt: null });
    }
    await recordAgentOsAuditEvent({ actor: permission.actor, operation: `users.openclaw.${input.action}`, targetKind: "openclaw-user-profile", targetId: input.profileId, result: "succeeded" }).catch(() => {});
    return NextResponse.json({
      linkage: input.action === "link" ? input.profileId : null,
      state: input.action === "link" ? "metadata-associated" : "unlinked",
      nativeHumanIdentityVerified: false
    });
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "Unable to update OpenClaw user linkage."),
      ...(error instanceof OpenClawUserProfileCapabilityError ? { code: "openclaw-users-unsupported" } : {})
    }, { status: error instanceof OpenClawUserProfileCapabilityError ? 503 : 400 });
  }
}
