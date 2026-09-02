import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  activateModelProviderApiKey,
  logoutModelProvider,
  readModelManagementState,
  setModelManagementDefault,
  setModelManagementFallbacks,
  setModelManagementPolicy
} from "@/lib/openclaw/application/model-management-service";
import { persistOpenClawExplicitProviderConfig } from "@/lib/openclaw/application/model-provider-state-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const viewSchema = z.enum(["default", "configured", "provider-config", "all"]);
const providerIdSchema = z.string().trim().min(2).max(63).regex(/^[a-z0-9][a-z0-9_-]{1,62}$/);
const modelRefSchema = z.string().trim().min(1).max(512);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set-default"), modelId: modelRefSchema }),
  z.object({ action: z.literal("set-fallbacks"), modelIds: z.array(modelRefSchema).max(32) }),
  z.object({ action: z.literal("set-policy"), allow: z.array(modelRefSchema).max(128).nullable() }),
  z.object({
    action: z.literal("logout"),
    provider: providerIdSchema,
    profileIds: z.array(z.string().trim().min(1).max(256)).max(32).optional()
  }),
  z.object({
    action: z.literal("activate-api-key"),
    authChoice: z.string().trim().min(1).max(256),
    apiKey: z.string().min(1).max(4096),
    modelRef: modelRefSchema.optional(),
    agentId: z.string().trim().min(1).max(128).optional()
  }),
  z.object({
    action: z.literal("start-auth"),
    authChoice: z.string().trim().min(1).max(256),
    agentId: z.string().trim().min(1).max(128).optional(),
    workspace: z.string().trim().min(1).max(2048).optional()
  }),
  z.object({
    action: z.literal("wizard-next"),
    sessionId: z.string().trim().min(1).max(256),
    answer: z.object({ stepId: z.string().trim().min(1).max(256), value: z.unknown().optional() }).optional()
  }),
  z.object({ action: z.literal("wizard-cancel"), sessionId: z.string().trim().min(1).max(256) }),
  z.object({
    action: z.literal("create-custom-provider"),
    providerId: providerIdSchema,
    baseUrl: z.string().url().max(2048),
    apiKey: z.string().min(1).max(4096),
    api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]).optional(),
    models: z.array(z.object({
      id: modelRefSchema,
      name: z.string().trim().min(1).max(256).optional(),
      contextWindow: z.number().int().positive().nullable().optional(),
      maxTokens: z.number().int().positive().nullable().optional()
    })).max(128).optional()
  })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  const url = new URL(request.url);
  const view = viewSchema.catch("default").parse(url.searchParams.get("view") ?? "default");
  const includeSetup = url.searchParams.get("setup") === "1";
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    return NextResponse.json(
      redactSecrets(await readModelManagementState({ view, includeSetup, refresh })),
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "OpenClaw model management is temporarily unavailable.") },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "secrets.manage");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "A valid model management action is required.") },
      { status: 400 }
    );
  }

  try {
    let message = "OpenClaw model settings updated.";
    switch (input.action) {
      case "set-default":
        await setModelManagementDefault(input.modelId);
        message = "Default model updated.";
        break;
      case "set-fallbacks":
        await setModelManagementFallbacks(input.modelIds);
        message = input.modelIds.length ? "Fallback order updated." : "Fallbacks cleared.";
        break;
      case "set-policy":
        await setModelManagementPolicy(input.allow);
        message = input.allow?.length ? "Model access policy updated." : "All models are allowed.";
        break;
      case "logout":
        await logoutModelProvider(input.provider, input.profileIds);
        message = "Provider connection removed.";
        break;
      case "activate-api-key":
        await activateModelProviderApiKey(input);
        message = "Provider connected through OpenClaw.";
        break;
      case "start-auth": {
        const sessionId = randomUUID();
        const start = await adapterCall("openclaw.setup.auth.start", {
          sessionId,
          authChoice: input.authChoice,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(input.workspace ? { workspace: input.workspace } : {})
        });
        const next = await adapterCall("wizard.next", { sessionId });
        return NextResponse.json(redactSecrets({ ok: true, message: "OpenClaw sign-in started.", sessionId, start, wizard: next }), { status: 200 });
      }
      case "wizard-next": {
        const wizard = await adapterCall("wizard.next", {
          sessionId: input.sessionId,
          ...(input.answer ? { answer: input.answer } : {})
        });
        return NextResponse.json(redactSecrets({ ok: true, message: "OpenClaw sign-in advanced.", sessionId: input.sessionId, wizard }), { status: 200 });
      }
      case "wizard-cancel":
        await adapterCall("wizard.cancel", { sessionId: input.sessionId });
        message = "OpenClaw sign-in cancelled.";
        break;
      case "create-custom-provider":
        await persistOpenClawExplicitProviderConfig(input.providerId, {
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          api: input.api,
          models: input.models
        });
        message = "Custom provider saved in OpenClaw.";
        break;
    }

    return NextResponse.json(
      redactSecrets({ ok: true, message, state: await readModelManagementState({ includeSetup: true, refresh: true }) }),
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "OpenClaw could not complete this model management action.") },
      { status: 500 }
    );
  }
}

async function adapterCall(method: string, params: Record<string, unknown>) {
  const { getOpenClawAdapter } = await import("@/lib/openclaw/adapter/openclaw-adapter");
  return getOpenClawAdapter().call<Record<string, unknown>>(method, params, { timeoutMs: 45_000 });
}
