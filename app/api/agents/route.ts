import { NextResponse } from "next/server";
import { z } from "zod";

import { createAgent, deleteAgent, getMissionControlSnapshot, updateAgent } from "@/lib/agentos/control-plane";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactSecretText, redactSecrets } from "@/lib/security/redaction";

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

const workerProfileSchema = z.object({
  schemaVersion: z.literal(1),
  identity: z.object({
    displayName: z.string().nullable().optional(),
    emoji: z.string().nullable().optional(),
    theme: z.string().nullable().optional(),
    avatar: z.string().nullable().optional()
  }).optional(),
  employment: z.object({
    role: z.string().nullable().optional(),
    mission: z.string().nullable().optional(),
    behaviorInstructions: z.string().nullable().optional()
  }).optional(),
  operator: z.object({
    labels: z.array(z.string()).optional()
  }).optional()
});

const toolPolicySchema = z.object({
  profile: z.enum(["minimal", "coding", "messaging", "full"]).nullable().optional(),
  allow: z.array(z.string()).nullable().optional(),
  deny: z.array(z.string()).nullable().optional(),
  fs: z.object({
    workspaceOnly: z.boolean().optional()
  }).nullable().optional()
});

const sandboxSchema = z.object({
  mode: z.enum(["off", "non-main", "all"]).nullable().optional(),
  scope: z.enum(["session", "agent", "shared"]).nullable().optional(),
  workspaceAccess: z.enum(["none", "ro", "rw"]).nullable().optional()
});

const memorySearchSchema = z.object({
  enabled: z.boolean().nullable().optional(),
  sources: z.array(z.enum(["memory", "sessions"])).nullable().optional()
});

const createAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  modelId: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional(),
  policy: agentPolicySchema.optional(),
  heartbeat: heartbeatSchema.optional(),
  channelIds: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  workerProfile: workerProfileSchema.optional(),
  toolPolicy: toolPolicySchema.nullable().optional(),
  sandbox: sandboxSchema.nullable().optional(),
  memorySearch: memorySearchSchema.nullable().optional()
});

const updateAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
  modelId: z.string().nullable().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional(),
  policy: agentPolicySchema.optional(),
  heartbeat: heartbeatSchema.optional(),
  channelIds: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  workerProfile: workerProfileSchema.optional(),
  toolPolicy: toolPolicySchema.nullable().optional(),
  sandbox: sandboxSchema.nullable().optional(),
  memorySearch: memorySearchSchema.nullable().optional()
});

const deleteAgentSchema = z.object({
  agentId: z.string().min(1)
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "agents.read");
  if ("response" in permission) return permission.response;
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(redactSecrets({
    agents: snapshot.agents
  }));
}

export async function POST(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "agent.create",
    method: "agents.create",
    targetKind: "agent",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "agents.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const input = createAgentSchema.parse(await request.json());
    const created = await createAgent(input, authorization.commandOptions);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.create",
      targetKind: "agent",
      targetId: input.id,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets(created));
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.create",
      targetKind: "agent",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: formatAgentApiError("create", error)
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "agent.update",
    method: "agents.update",
    targetKind: "agent",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "agents.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const input = updateAgentSchema.parse(await request.json());
    const updated = await updateAgent(input, authorization.commandOptions);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.update",
      targetKind: "agent",
      targetId: input.id,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets(updated));
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.update",
      targetKind: "agent",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: formatAgentApiError("update", error)
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "agent.delete",
    method: "agents.delete",
    targetKind: "agent",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "agents.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const input = deleteAgentSchema.parse(await request.json());
    const deleted = await deleteAgent(input, authorization.commandOptions);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.delete",
      targetKind: "agent",
      targetId: input.agentId,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets(deleted));
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "agent.delete",
      targetKind: "agent",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: formatAgentApiError("delete", error)
      },
      { status: 400 }
    );
  }
}

function formatAgentApiError(
  action: "create" | "update" | "delete",
  error: unknown
) {
  const message = error instanceof Error ? redactSecretText(error.message) : "";

  if (/Config path not found:\s*agents\.list/i.test(message)) {
    return "OpenClaw is still initializing the agent registry for this workspace. Please try again in a moment.";
  }

  if (/Agent was not found\./i.test(message)) {
    return "That agent no longer exists in the current workspace.";
  }

  if (
    /OpenClaw (?:CLI|Gateway|runtime|model setup|system setup)|Agent creation is blocked|Choose a ready model|Workspace was not found|already exists|No API key found|Auth store|Configure auth|Unknown model|provider auth|OAuth token refresh failed/i.test(message)
  ) {
    return message;
  }

  if (/OpenClaw command failed with exit code \d+:/i.test(message)) {
    const detail = message.replace(/^OpenClaw command failed with exit code \d+:\s*/i, "").trim();

    return action === "delete"
      ? detail
        ? `OpenClaw could not delete the agent right now. ${detail}`
        : "OpenClaw could not delete the agent right now. Please try again."
      : action === "create"
        ? detail
          ? `OpenClaw could not create the agent right now. ${detail}`
          : "OpenClaw could not create the agent right now. Please try again."
        : detail
          ? `OpenClaw could not update the agent right now. ${detail}`
          : "OpenClaw could not update the agent right now. Please try again.";
  }

  if (message) {
    return action === "delete"
      ? `OpenClaw could not delete the agent right now. ${message}`
      : action === "create"
        ? `OpenClaw could not create the agent right now. ${message}`
        : `OpenClaw could not update the agent right now. ${message}`;
  }

  return action === "delete"
    ? "OpenClaw could not delete the agent right now. Please try again."
    : action === "create"
      ? "OpenClaw could not create the agent right now. Please try again."
      : "OpenClaw could not update the agent right now. Please try again.";
}
