import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  createExecutionEnvironment,
  destroyExecutionEnvironment,
  readNativeNodeDetail,
  readNativeNodeInventory,
  readExecutionEnvironment,
  readExecutionTopology,
  ExecutionTopologyUnavailableError
} from "@/lib/openclaw/application/execution-topology-service";
import {
  buildNativeMutationFailureResponse
} from "@/lib/openclaw/application/native-mutation-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), profileId: z.string().trim().min(1).max(128) }),
  z.object({
    action: z.literal("destroy"),
    environmentId: z.string().trim().min(1).max(256),
    force: z.boolean().optional(),
    confirm: z.literal(true)
  })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const params = new URL(request.url).searchParams;
  const environmentId = params.get("environmentId");
  const nodeId = params.get("nodeId");
  const readNodes = params.get("nodes") === "true";

  try {
    if (environmentId) {
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "environments.status",
        method: "environments.status",
        params: { environmentId },
        targetKind: "openclaw-environment",
        targetId: environmentId,
        securityClass: "read",
        executionPath: "gateway-native",
        productPermission: "runtime.use"
      });
      if ("response" in preflight) return preflight.response;
      return NextResponse.json(redactSecrets({ environment: await readExecutionEnvironment(environmentId, { commandOptions: preflight.commandOptions }) }), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (nodeId) {
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "node.describe",
        method: "node.describe",
        params: { nodeId },
        targetKind: "openclaw-node",
        targetId: nodeId,
        securityClass: "read",
        executionPath: "gateway-native",
        productPermission: "runtime.use"
      });
      if ("response" in preflight) return preflight.response;
      const node = await readNativeNodeDetail(nodeId, { commandOptions: preflight.commandOptions });
      return NextResponse.json(redactSecrets({ node }), { headers: { "Cache-Control": "no-store" } });
    }

    if (readNodes) {
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "node.list",
        method: "node.list",
        params: {},
        targetKind: "openclaw-node-inventory",
        targetId: "execution-topology",
        securityClass: "read",
        executionPath: "gateway-native",
        productPermission: "runtime.use"
      });
      if ("response" in preflight) return preflight.response;
      return NextResponse.json(redactSecrets({ nodes: await readNativeNodeInventory({ commandOptions: preflight.commandOptions }) }), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    const preflight = await requireAgentOsOpenClawPreflight(request, {
      operation: "environments.list",
      method: "environments.list",
      params: {},
      targetKind: "openclaw-environment-inventory",
      targetId: "execution-topology",
      securityClass: "read",
      executionPath: "gateway-native",
      productPermission: "runtime.use"
    });
    if ("response" in preflight) return preflight.response;
    return NextResponse.json(redactSecrets({ topology: await readExecutionTopology({ commandOptions: preflight.commandOptions }) }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw execution topology is unavailable."), code: error instanceof ExecutionTopologyUnavailableError ? "openclaw-topology-unavailable" : "openclaw-topology-read-failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const permission = await requireAgentOsProductPermission(request, "lifecycle.manage");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof mutationSchema>;
  try {
    input = mutationSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid execution environment operation.") }, { status: 400 });
  }

  try {
    if (input.action === "create") {
      const idempotencyKey = crypto.randomUUID();
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "environments.create",
        method: "environments.create",
        params: { profileId: input.profileId, idempotencyKey },
        targetKind: "openclaw-environment-profile",
        targetId: input.profileId,
        securityClass: "privileged-mutation",
        executionPath: "gateway-native",
        productPermission: "lifecycle.manage"
      });
      if ("response" in preflight) return preflight.response;
      const mutation = await createExecutionEnvironment({ profileId: input.profileId, idempotencyKey }, {
        adapter: getOpenClawAdapter(),
        commandOptions: preflight.commandOptions
      });
      return respondToEnvironmentMutation(mutation, permission.actor, "environment.create", input.profileId);
    }

    const preflight = await requireAgentOsOpenClawPreflight(request, {
      operation: "environments.destroy",
      method: "environments.destroy",
      params: { environmentId: input.environmentId, ...(input.force === undefined ? {} : { force: input.force }) },
      targetKind: "openclaw-environment",
      targetId: input.environmentId,
      securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "lifecycle.manage"
    });
    if ("response" in preflight) return preflight.response;
    const mutation = await destroyExecutionEnvironment({ environmentId: input.environmentId, force: input.force }, {
      adapter: getOpenClawAdapter(),
      commandOptions: preflight.commandOptions
    });
    return respondToEnvironmentMutation(mutation, permission.actor, "environment.destroy", input.environmentId);
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw execution environment operation failed.") }, { status: 503 });
  }
}

async function respondToEnvironmentMutation(
  mutation: Parameters<typeof buildNativeMutationFailureResponse>[0] | { outcome: "succeeded"; reconciled: boolean; retryable: false; result: unknown },
  actor: Parameters<typeof recordAgentOsAuditEvent>[0]["actor"],
  operation: string,
  targetId: string
) {
  if (mutation.outcome === "succeeded") {
    await recordAgentOsAuditEvent({ actor, operation, targetKind: "openclaw-environment", targetId, result: "succeeded" }).catch(() => {});
    return NextResponse.json(redactSecrets({ ...mutation.result as Record<string, unknown>, outcome: "succeeded", reconciled: mutation.reconciled, retryable: mutation.retryable }), { headers: { "Cache-Control": "no-store" } });
  }
  await recordAgentOsAuditEvent({ actor, operation, targetKind: "openclaw-environment", targetId, result: mutation.outcome }).catch(() => {});
  const failure = buildNativeMutationFailureResponse(mutation as Parameters<typeof buildNativeMutationFailureResponse>[0]);
  return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
}
