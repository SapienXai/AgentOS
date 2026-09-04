import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getWorkerEffectiveCapabilities,
  normalizeSkillLibraryDetail
} from "@/lib/openclaw/application/worker-capability-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activateSchema = z.object({
  sessionKey: z.string().min(1).max(512),
  action: z.enum(["attach", "detach", "refresh"]),
  skillId: z.string().uuid().optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).superRefine((value, context) => {
  if (value.action !== "refresh" && !value.skillId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["skillId"],
      message: "attach and detach require a skillId."
    });
  }
});

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "agents.read");
  if ("response" in permission) return permission.response;

  try {
    const { agentId } = await context.params;
    const query = new URL(request.url).searchParams;
    const skillId = query.get("skillId");
    const sessionKey = query.get("sessionKey");

    if (skillId) {
      const adapter = getOpenClawAdapter();
      if (!adapter.readSkillLibrary) {
        return NextResponse.json({
          supported: false,
          error: "OpenClaw Skills Library read is unavailable."
        });
      }
      const detail = await adapter.readSkillLibrary({
        skillId,
        ...(query.get("revision") ? { revision: query.get("revision")! } : {}),
        ...(sessionKey ? { sessionKey } : {})
      }, { timeoutMs: 8_000 });
      return NextResponse.json(redactSecrets({
        supported: true,
        skill: normalizeSkillLibraryDetail(detail, sessionKey)
      }));
    }

    const capabilities = await getWorkerEffectiveCapabilities(agentId, { sessionKey });
    return NextResponse.json(redactSecrets(capabilities), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "Unable to resolve worker capabilities.")
    }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  let input: z.infer<typeof activateSchema>;
  let activationMayHaveBeenSent = false;
  try {
    input = activateSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({
      error: redactErrorMessage(error, "Invalid Skills Library activation request.")
    }, { status: 400 });
  }

  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: `skills.library.${input.action}`,
    method: "skills.library.activate",
    params: input,
    targetKind: "agent-skill-session",
    targetId: `${agentId}:${input.skillId ?? input.sessionKey}`,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "agents.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const adapter = getOpenClawAdapter();
    if (!adapter.activateSkillLibrary) {
      throw new Error("OpenClaw does not expose skills.library.activate.");
    }

    activationMayHaveBeenSent = true;
    const activation = await adapter.activateSkillLibrary(input, authorization.commandOptions);
    // OpenClaw applies the selection on the next turn. Re-read the native
    // projection so the response contains the committed selection identity.
    const capabilities = await getWorkerEffectiveCapabilities(agentId, {
      sessionKey: input.sessionKey
    });
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: `skills.library.${input.action}`,
      targetKind: "agent-skill-session",
      targetId: `${agentId}:${input.skillId ?? input.sessionKey}`,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets({ activation, capabilities }));
  } catch (error) {
    if (activationMayHaveBeenSent && isAmbiguousMutationError(error)) {
      const reconciled = await getWorkerEffectiveCapabilities(agentId, {
        sessionKey: input.sessionKey
      }).catch(() => null);
      const matchesRequestedState = reconciled
        ? input.action === "attach"
          ? reconciled.skills.some((skill) => skill.id === input.skillId && skill.activation.activeRevisionId === (input.revision ?? skill.revision.id))
          : input.action === "detach"
            ? !reconciled.skills.some((skill) => skill.id === input.skillId && skill.activation.activeInSession)
            : true
        : false;

      if (matchesRequestedState && reconciled) {
        await recordAgentOsAuditEvent({
          actor: authorization.actor,
          operation: `skills.library.${input.action}`,
          targetKind: "agent-skill-session",
          targetId: `${agentId}:${input.skillId ?? input.sessionKey}`,
          result: "succeeded"
        }).catch(() => {});
        return NextResponse.json(redactSecrets({
          activation: null,
          capabilities: reconciled,
          reconciled: true
        }));
      }

      return NextResponse.json(redactSecrets({
        error: "Skills Library activation outcome is uncertain. Native state was reconciled without retrying.",
        reconciled: Boolean(reconciled),
        capabilities: reconciled
      }), { status: 409 });
    }

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: `skills.library.${input.action}`,
      targetKind: "agent-skill-session",
      targetId: `${agentId}:${input.skillId ?? input.sessionKey}`,
      result: "failed"
    }).catch(() => {});
    return NextResponse.json({
      error: redactErrorMessage(error, "Skills Library activation failed.")
    }, { status: 400 });
  }
}

function isAmbiguousMutationError(error: unknown) {
  if (Boolean(error && typeof error === "object" && "sent" in error && (error as { sent?: unknown }).sent === true)) {
    return true;
  }
  const kind = error && typeof error === "object" && "kind" in error
    ? (error as { kind?: unknown }).kind
    : null;
  return kind === "timeout" || kind === "unreachable" || kind === "malformed-response";
}
