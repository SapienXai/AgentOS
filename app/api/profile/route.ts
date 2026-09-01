import { NextResponse } from "next/server";
import { z } from "zod";

import {
  OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS,
  isSupportedAvatarDataUrl,
  readOperatorProfile,
  saveOperatorProfile,
  type OperatorProfile
} from "@/lib/agentos/application/operator-profile-service";
import {
  getCurrentAgentOsUser,
  updateManagedAgentOsUserProfile
} from "@/lib/agentos/application/agentos-account-service";
import { redactErrorMessage } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/),
  email: z.string().trim().toLowerCase().email().max(160),
  avatarDataUrl: z
    .string()
    .max(OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS)
    .refine(isSupportedAvatarDataUrl, "Avatar must be a PNG, JPEG, or WebP image.")
    .nullable()
});

export async function GET(request: Request) {
  try {
    const authorization = await requireAgentOsProductPermission(request, "profile.manage");
    if ("response" in authorization) return authorization.response;
    if (authorization.actor.authenticationMethod === "instance-session") {
      const user = await getCurrentAgentOsUser(authorization.actor.actorId);
      if (!user) return NextResponse.json({ error: "AgentOS account is unavailable." }, { status: 503 });
      return NextResponse.json({
        fullName: user.profile.displayName,
        username: user.username,
        email: user.profile.email,
        avatarDataUrl: user.profile.avatarDataUrl,
        updatedAt: user.updatedAt,
        actorId: user.actorId,
        role: user.role,
        status: user.status,
        openClaw: user.openClaw
      });
    }
    return NextResponse.json(await readOperatorProfile());
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to load the operator profile.") },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const authorization = await requireAgentOsProductPermission(request, "profile.manage");
    if ("response" in authorization) return authorization.response;
    const actor = authorization.actor;

    const profile = profileSchema.parse(await request.json());
    let saved: OperatorProfile = { ...profile, updatedAt: null };
    if (actor.authenticationMethod === "instance-session") {
      if (profile.username !== actor.username) {
        return NextResponse.json(
          { error: "Login username changes must be performed through Instance Protection settings.", code: "username-change-requires-security-settings" },
          { status: 400 }
        );
      }
      const user = await updateManagedAgentOsUserProfile(actor.actorId, {
        displayName: profile.fullName,
        email: profile.email,
        avatarDataUrl: profile.avatarDataUrl
      });
      saved = {
        fullName: user.profile.displayName,
        username: user.username,
        email: user.profile.email,
        avatarDataUrl: user.profile.avatarDataUrl,
        updatedAt: user.updatedAt
      };
      if (user.role === "owner") {
        await saveOperatorProfile(saved, process.env, user.actorId);
      }
    } else {
      saved = await saveOperatorProfile(profile);
    }
    await recordAgentOsAuditEvent({
      actor,
      operation: "profile.update",
      targetKind: "operator-profile",
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(saved);
  } catch (error) {
    const invalidInput = error instanceof z.ZodError;
    return NextResponse.json(
      {
        error: invalidInput
          ? error.issues[0]?.message || "Profile details are invalid."
          : redactErrorMessage(error, "Unable to save the operator profile.")
      },
      { status: invalidInput ? 400 : 500 }
    );
  }
}
