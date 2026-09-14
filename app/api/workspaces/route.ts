import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";

import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  getMissionControlSnapshot,
  updateWorkspaceProject
} from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type { OperationProgressSnapshot, WorkspaceCreateStreamEvent } from "@/lib/agentos/contracts";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentPolicySchema = z.object({
  preset: z.enum(["worker", "setup", "browser", "monitoring", "custom"]),
  missingToolBehavior: z.enum(["fallback", "ask-setup", "route-setup", "allow-install"]),
  installScope: z.enum(["none", "workspace", "system"]),
  fileAccess: z.enum(["workspace-only", "extended"]),
  networkAccess: z.enum(["restricted", "enabled"])
});

const heartbeatSchema = z.object({
  enabled: z.boolean(),
  every: z.string().optional()
});

const docOverrideSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const workspaceCreationSchema = z.object({
  source: z.enum(["api", "quick-create", "launchpad", "planner-deploy", "planner-runtime"]),
  planId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(200).optional()
});

const workspaceMaterializationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("empty") }).strict(),
  z.object({ mode: z.literal("clone"), repoUrl: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("existing"), existingPath: z.string().min(1) }).strict()
]);

const workspaceKnowledgeSourceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["prompt", "website", "repository", "file", "folder", "connector"]),
    label: z.string().min(1),
    summary: z.string().min(1),
    details: z.array(z.string()).default([]),
    status: z.enum(["ready", "error"]),
    createdAt: z.string().min(1),
    provenance: z.enum(["operator", "wizard", "planner", "migration", "derived"]),
    confidence: z.number().optional(),
    error: z.string().optional(),
    locator: z.union([
      z.object({ kind: z.literal("prompt"), text: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("website"), url: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("repository"), remoteUrl: z.string().min(1).optional(), localPath: z.string().min(1).optional() }).strict().refine((value) => Boolean(value.remoteUrl || value.localPath), "Repository locator requires remoteUrl or localPath."),
      z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("folder"), path: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("connector"), provider: z.string().min(1), accountId: z.string().min(1).optional(), resourceId: z.string().min(1).optional(), resourceType: z.string().min(1).optional() }).strict()
    ])
  })
  .strict();

const workspaceSchema = z.object({
  name: z.string().min(1),
  brief: z.string().optional(),
  directory: z.string().optional(),
  modelId: z.string().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  materialization: workspaceMaterializationSchema.optional(),
  sourceMode: z.enum(["empty", "clone", "existing"]).optional(),
  repoUrl: z.string().optional(),
  existingPath: z.string().optional(),
  knowledgeSources: z.array(workspaceKnowledgeSourceSchema).optional(),
  template: z.enum(["software", "frontend", "backend", "research", "content"]).optional(),
  teamPreset: z.enum(["solo", "core", "custom"]).optional(),
  modelProfile: z.enum(["balanced", "fast", "quality"]).optional(),
  rules: z
    .object({
      workspaceOnly: z.boolean().optional(),
      generateStarterDocs: z.boolean().optional(),
      generateMemory: z.boolean().optional(),
      kickoffMission: z.boolean().optional()
    })
    .optional(),
  docOverrides: z.array(docOverrideSchema).optional(),
  creation: workspaceCreationSchema.optional(),
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        name: z.string().min(1),
        enabled: z.boolean(),
        emoji: z.string().optional(),
        theme: z.string().optional(),
        skillId: z.string().optional(),
        skillIds: z.array(z.string()).optional(),
        modelId: z.string().optional(),
        isPrimary: z.boolean().optional(),
        policy: agentPolicySchema.optional(),
        heartbeat: heartbeatSchema.optional()
      })
    )
    .optional()
});

const workspaceCreateRequestSchema = workspaceSchema.extend({
  stream: z.boolean().optional()
});

const workspaceUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  recoveryGeneration: z.number().int().min(1).optional(),
  name: z.string().optional(),
  directory: z.string().optional(),
  plan: z.any().optional(),
  baseline: z.any().optional()
});

const workspaceDeleteSchema = z.object({
  workspaceId: z.string().min(1),
  recoveryGeneration: z.number().int().min(1).optional()
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(redactSecrets({
    workspaces: snapshot.workspaces
  }));
}

export async function POST(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.create",
    method: "agents.create",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "workspace.manage"
  });
  if ("response" in authorization) return authorization.response;
  let targetId: string | undefined;
  try {
    const parsed = workspaceCreateRequestSchema.parse(await request.json());
    const { stream, ...input } = parsed;
    targetId = input.creation?.idempotencyKey ?? input.name;
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.create",
      targetKind: "workspace",
      targetId,
      result: "started"
    }).catch(() => {});

    if (!stream) {
      const created = await createWorkspaceProject(input, {
        gatewayOptions: authorization.commandOptions
      });

      await recordAgentOsAuditEvent({
        actor: authorization.actor,
        operation: "workspace.create",
        targetKind: "workspace",
        targetId: created.workspaceId,
        correlationId: created.operationId,
        result: auditResultForLifecycleOutcome(created.outcome)
      }).catch(() => {});

      return NextResponse.json(redactSecrets(created), { status: lifecycleHttpStatus(created.outcome) });
    }

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let latestProgress: OperationProgressSnapshot | undefined;

    const send = (event: WorkspaceCreateStreamEvent) => {
      const safeEvent = redactSecrets(event);
      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
        .catch(() => {});

      return writeChain;
    };

    void (async () => {
      try {
        const created = await createWorkspaceProject(input, {
          gatewayOptions: authorization.commandOptions,
          onProgress: async (progress) => {
            latestProgress = progress;
            await send({
              type: "progress",
              progress
            });
          }
        });

        await recordAgentOsAuditEvent({
          actor: authorization.actor,
          operation: "workspace.create",
          targetKind: "workspace",
          targetId: created.workspaceId,
          correlationId: created.operationId,
          result: auditResultForLifecycleOutcome(created.outcome)
        }).catch(() => {});

        const progress = latestProgress ?? ({
          title: "Provisioning workspace",
          description: "Workspace bootstrap finished.",
          percent: 100,
          steps: []
        } satisfies OperationProgressSnapshot);
        if (created.outcome === "unknown" || created.outcome === "failed") {
          await send({
            type: "done",
            ok: false,
            progress,
            result: created,
            error: created.error?.message ?? created.warnings?.[0] ?? "Workspace creation could not be confirmed."
          });
        } else {
          await send({
            type: "done",
            ok: true,
            progress,
            result: created
          });
        }
      } catch (error) {
        await recordAgentOsAuditEvent({
          actor: authorization.actor,
          operation: "workspace.create",
          targetKind: "workspace",
          targetId,
          result: "failed"
        }).catch(() => {});
        await send({
          type: "done",
          ok: false,
          error: redactErrorMessage(error, "Unable to create workspace."),
          progress: latestProgress
        });
      } finally {
        await writeChain;
        await writer.close();
      }
    })();

    return new Response(responseStream.readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.create",
      targetKind: "workspace",
      targetId,
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to create workspace.")
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.update",
    method: "config.patch",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "workspace.manage"
  });
  if ("response" in authorization) return authorization.response;
  let targetId: string | undefined;
  let correlationId: string | undefined;
  try {
    const input = workspaceUpdateSchema.parse(await request.json());
    targetId = input.workspaceId;
    correlationId = randomUUID();
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.update",
      targetKind: "workspace",
      targetId,
      correlationId,
      result: "started"
    }).catch(() => {});
    const updated = await updateWorkspaceProject(input, authorization.commandOptions);
    correlationId = updated.operationId ?? correlationId;
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.update",
      targetKind: "workspace",
      targetId,
      correlationId,
      result: auditResultForLifecycleOutcome(updated.outcome)
    }).catch(() => {});

    return NextResponse.json(redactSecrets(updated), { status: lifecycleHttpStatus(updated.outcome) });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.update",
      targetKind: "workspace",
      targetId,
      correlationId,
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update workspace.")
      },
      { status: lifecycleErrorHttpStatus(error) }
    );
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.delete",
    method: "agents.delete",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "workspace.manage"
  });
  if ("response" in authorization) return authorization.response;
  let targetId: string | undefined;
  try {
    const input = workspaceDeleteSchema.parse(await request.json());
    targetId = input.workspaceId;
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.delete",
      targetKind: "workspace",
      targetId,
      result: "started"
    }).catch(() => {});
    const deleted = await deleteWorkspaceProject(input, authorization.commandOptions);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.delete",
      targetKind: "workspace",
      targetId,
      correlationId: deleted.operationId,
      result: auditResultForLifecycleOutcome(deleted.outcome)
    }).catch(() => {});

    return NextResponse.json(redactSecrets(deleted), { status: lifecycleHttpStatus(deleted.outcome) });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "workspace.delete",
      targetKind: "workspace",
      targetId,
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to delete workspace.")
      },
      { status: lifecycleErrorHttpStatus(error) }
    );
  }
}

function auditResultForLifecycleOutcome(outcome: "ready" | "partial" | "failed" | "unknown" | undefined) {
  return outcome === "partial" ? "partial" : outcome === "unknown" ? "unknown" : outcome === "failed" ? "failed" : "succeeded";
}

function lifecycleHttpStatus(outcome: "ready" | "partial" | "failed" | "unknown" | undefined) {
  return outcome === "unknown" ? 409 : outcome === "failed" ? 400 : 200;
}

function lifecycleErrorHttpStatus(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code === "lifecycle-operation-busy" || code === "lifecycle-operation-revision-conflict" ? 409 : 400;
}
