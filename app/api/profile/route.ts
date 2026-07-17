import { NextResponse } from "next/server";
import { z } from "zod";

import {
  OPERATOR_PROFILE_AVATAR_MAX_CHARACTERS,
  isSupportedAvatarDataUrl,
  readOperatorProfile,
  saveOperatorProfile
} from "@/lib/agentos/application/operator-profile-service";
import { redactErrorMessage } from "@/lib/security/redaction";

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

export async function GET() {
  try {
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
    const profile = profileSchema.parse(await request.json());
    return NextResponse.json(await saveOperatorProfile(profile));
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
