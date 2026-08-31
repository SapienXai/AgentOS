import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createManagedAgentOsUser,
  listAgentOsUsers,
  resetManagedAgentOsUserPassword,
  updateManagedAgentOsUserRole,
  updateManagedAgentOsUserStatus
} from "@/lib/agentos/application/agentos-account-service";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { AgentOsUserStoreError, summarizeAgentOsUser } from "@/lib/security/agentos-user-store";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().max(1024),
  role: z.enum(["owner", "member"]).default("member"),
  displayName: z.string().trim().max(80).default(""),
  email: z.string().trim().email().max(160).or(z.literal("")).default("")
});

const updateUserSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("role"), actorId: z.string().uuid(), role: z.enum(["owner", "member"]) }),
  z.object({ operation: z.literal("status"), actorId: z.string().uuid(), status: z.enum(["active", "disabled"]) }),
  z.object({ operation: z.literal("password"), actorId: z.string().uuid(), password: z.string().max(1024) })
]);

export async function GET(request: Request) {
  const authorization = await requireAgentOsProductPermission(request, "users.manage");
  if ("response" in authorization) return authorization.response;
  try {
    return NextResponse.json({ users: await listAgentOsUsers() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return userErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const authorization = await requireAgentOsProductPermission(request, "users.manage");
  if ("response" in authorization) return authorization.response;
  try {
    const input = createUserSchema.parse(await request.json());
    const user = await createManagedAgentOsUser({
      username: input.username,
      password: input.password,
      role: input.role,
      profile: { displayName: input.displayName, email: input.email, avatarDataUrl: null }
    });
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "users.create",
      targetKind: "agentos-user",
      targetId: user.actorId,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json({ user: sanitizeUser(user) }, { status: 201 });
  } catch (error) {
    return userErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const authorization = await requireAgentOsProductPermission(request, "users.manage");
  if ("response" in authorization) return authorization.response;
  try {
    const input = updateUserSchema.parse(await request.json());
    const user = input.operation === "role"
      ? await updateManagedAgentOsUserRole(input.actorId, input.role)
      : input.operation === "status"
        ? await updateManagedAgentOsUserStatus(input.actorId, input.status)
        : await resetManagedAgentOsUserPassword(input.actorId, input.password);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: `users.${input.operation}`,
      targetKind: "agentos-user",
      targetId: user.actorId,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json({ user: sanitizeUser(user) });
  } catch (error) {
    return userErrorResponse(error);
  }
}

function sanitizeUser(user: Awaited<ReturnType<typeof createManagedAgentOsUser>>) {
  return summarizeAgentOsUser(user);
}

function userErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "User details are invalid.", code: "invalid-input" }, { status: 400 });
  }
  if (error instanceof AgentOsUserStoreError) {
    return NextResponse.json({ error: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds }, {
      status: error.status,
      headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
    });
  }
  return NextResponse.json({ error: "Unable to update AgentOS users.", code: "user-management-failed" }, { status: 500 });
}
