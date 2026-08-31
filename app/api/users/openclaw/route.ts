import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCurrentAgentOsUser,
  updateManagedAgentOsUserOpenClawLinkage
} from "@/lib/agentos/application/agentos-account-service";
import {
  OpenClawUserProfileCapabilityError,
  listOpenClawGatewayRoleNames,
  listOpenClawUserProfiles,
  setOpenClawUserRole
} from "@/lib/openclaw/application/user-profile-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const linkageSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("link"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("unlink"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("role"), actorId: z.string().uuid(), profileId: z.string().trim().min(1).max(200), role: z.string().trim().min(1).max(80).nullable() })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "users.manage");
  if ("response" in permission) return permission.response;
  try {
    return NextResponse.json({ profiles: await listOpenClawUserProfiles() }, { headers: { "Cache-Control": "no-store" } });
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
    if (!profile) return NextResponse.json({ error: "The OpenClaw profile was not found.", code: "openclaw-profile-not-found" }, { status: 404 });

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
      const updated = await setOpenClawUserRole(input.profileId, input.role, authorization.commandOptions);
      await updateManagedAgentOsUserOpenClawLinkage({
        actorId: input.actorId,
        profileId: input.profileId,
        role: input.role,
        linkageState: "linked"
      });
      await recordAgentOsAuditEvent({ actor: permission.actor, operation: "users.openclaw.set-role", targetKind: "openclaw-user-profile", targetId: input.profileId, result: "succeeded" }).catch(() => {});
      return NextResponse.json({ profile: updated, roleNames });
    }

    if (input.action === "unlink") {
      if (user.openClaw.profileId !== input.profileId) return NextResponse.json({ error: "The OpenClaw profile is not linked to this AgentOS user.", code: "openclaw-linkage-mismatch" }, { status: 409 });
      await updateManagedAgentOsUserOpenClawLinkage({ actorId: input.actorId, profileId: null, role: null, linkageState: "unlinked", lastVerifiedAt: null });
    } else {
      await updateManagedAgentOsUserOpenClawLinkage({ actorId: input.actorId, profileId: profile.profileId, role: profile.role, linkageState: "linked" });
    }
    await recordAgentOsAuditEvent({ actor: permission.actor, operation: `users.openclaw.${input.action}`, targetKind: "openclaw-user-profile", targetId: input.profileId, result: "succeeded" }).catch(() => {});
    return NextResponse.json({ linkage: input.action === "link" ? profile.profileId : null, state: input.action === "link" ? "linked" : "unlinked" });
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "Unable to update OpenClaw user linkage."),
      ...(error instanceof OpenClawUserProfileCapabilityError ? { code: "openclaw-users-unsupported" } : {})
    }, { status: error instanceof OpenClawUserProfileCapabilityError ? 503 : 400 });
  }
}
