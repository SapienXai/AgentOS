import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BrowserAccountError,
  acquireBrowserAccountLease,
  confirmBrowserAccountLogin,
  createBrowserAccount,
  getBrowserAccountCapabilities,
  listBrowserAccountAudit,
  listBrowserAccounts,
  releaseBrowserAccountLease,
  renewBrowserAccountLease,
  revokeBrowserAccount,
  startBrowserAccountLiveView,
  stopBrowserAccountLiveView,
  updateBrowserAccountAccess
} from "@/lib/agentos/application/browser-account-service";
import { recoverExpiredBrowserTaskBindings } from "@/lib/agentos/application/browser-task-binding-service";
import {
  browserAccountResponseHeaders,
  requireBrowserAccountActor
} from "@/lib/security/browser-account-route";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerSchema = z.enum([
  "self-hosted-openclaw",
  "local-chrome",
  "browserless",
  "browserbase"
]);

const createSchema = z.object({
  action: z.literal("create"),
  workspaceId: z.string().min(1),
  serviceName: z.string().min(1).max(120),
  primaryDomain: z.string().min(1).max(253),
  allowedAgentIds: z.array(z.string().min(1)).max(100).optional(),
  allowedDomains: z.array(z.string().min(1)).max(100).optional(),
  provider: providerSchema.optional()
});

const confirmSchema = z.object({
  action: z.literal("confirm-login"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerSessionId: z.string().uuid().optional()
});

const revokeSchema = z.object({
  action: z.literal("revoke"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1)
});

const startLiveViewSchema = z.object({
  action: z.literal("start-live-view"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1)
});

const stopLiveViewSchema = z.object({
  action: z.literal("stop-live-view"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerSessionId: z.string().uuid()
});

const acquireLeaseSchema = z.object({
  action: z.literal("acquire-lease"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  taskId: z.string().min(1),
  ttlMs: z.number().int().optional()
});

const renewLeaseSchema = z.object({
  action: z.literal("renew-lease"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  leaseId: z.string().uuid(),
  fencingToken: z.number().int().positive(),
  ttlMs: z.number().int().optional()
});

const releaseLeaseSchema = z.object({
  action: z.literal("release-lease"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  leaseId: z.string().uuid(),
  fencingToken: z.number().int().positive()
});

const updateAccessSchema = z.object({
  action: z.literal("update-access"),
  accountId: z.string().min(1),
  workspaceId: z.string().min(1),
  allowedAgentIds: z.array(z.string().min(1)).max(100),
  allowedDomains: z.array(z.string().min(1)).min(1).max(100)
});

const recoverSchema = z.object({
  action: z.literal("recover"),
  workspaceId: z.string().min(1)
});

const mutationSchema = z.discriminatedUnion("action", [
  createSchema,
  confirmSchema,
  revokeSchema,
  startLiveViewSchema,
  stopLiveViewSchema,
  acquireLeaseSchema,
  renewLeaseSchema,
  releaseLeaseSchema,
  updateAccessSchema,
  recoverSchema
]);

export async function GET(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const includeAudit = url.searchParams.get("audit") === "1";
    const provider = providerSchema.catch("self-hosted-openclaw").parse(
      url.searchParams.get("provider") ?? "self-hosted-openclaw"
    );
    const recovery = await recoverExpiredBrowserTaskBindings({
      ownerUserId: authorization.actor.userId,
      workspaceId
    });
    const [accounts, capabilities, audit] = await Promise.all([
      listBrowserAccounts({ actor: authorization.actor, workspaceId }),
      getBrowserAccountCapabilities(provider),
      includeAudit
        ? listBrowserAccountAudit({ actor: authorization.actor, workspaceId })
        : Promise.resolve(undefined)
    ]);

    return NextResponse.json(
      redactSecrets({
        ok: true,
        generatedAt: new Date().toISOString(),
        source: "agentos.browser-gateway",
        accounts,
        capabilities,
        recovery: {
          recoveredCount: recovery.recoveredCount,
          cleanupFailedCount: recovery.cleanupFailedCount
        },
        ...(audit ? { audit } : {})
      }),
      { headers: browserAccountResponseHeaders() }
    );
  } catch (error) {
    return errorResponse(error, "Unable to load secure browser accounts.");
  }
}

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = mutationSchema.parse(await request.json());
    const actor = authorization.actor;
    const result = input.action === "create"
      ? await createBrowserAccount({ actor, ...input })
      : input.action === "confirm-login"
        ? await confirmBrowserAccountLogin({ actor, ...input })
        : input.action === "revoke"
          ? await revokeBrowserAccount({ actor, ...input })
          : input.action === "start-live-view"
            ? await startBrowserAccountLiveView({ actor, ...input })
            : input.action === "stop-live-view"
              ? await stopBrowserAccountLiveView({ actor, ...input })
          : input.action === "acquire-lease"
            ? await acquireBrowserAccountLease({ actor, ...input })
            : input.action === "renew-lease"
              ? await renewBrowserAccountLease({ actor, ...input })
              : input.action === "release-lease"
                ? await releaseBrowserAccountLease({ actor, ...input })
                : input.action === "update-access"
                  ? await updateBrowserAccountAccess({ actor, ...input })
                  : await recoverExpiredBrowserTaskBindings({
                      ownerUserId: actor.userId,
                      workspaceId: input.workspaceId
                    }).then(({ recoveredCount, cleanupFailedCount }) => ({
                      recoveredCount,
                      cleanupFailedCount
                    }));

    return NextResponse.json(
      redactSecrets({ ok: true, result }),
      { headers: browserAccountResponseHeaders() }
    );
  } catch (error) {
    return errorResponse(error, "Secure browser account action failed.");
  }
}

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof BrowserAccountError ? error.status : 400;
  const code = error instanceof BrowserAccountError ? error.code : "browser-account-error";
  return NextResponse.json(
    {
      error: redactErrorMessage(error, fallback),
      code
    },
    {
      status,
      headers: browserAccountResponseHeaders()
    }
  );
}
