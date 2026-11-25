import { NextResponse } from "next/server";
import { z } from "zod";

import { assignEmployeeDocument, readEmployeeDocumentAssignments } from "@/lib/agentos/application/workspace-native-knowledge-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage } from "@/lib/security/redaction";

const agentIdSchema = z.string().min(1).max(160);
const assignmentSchema = z.object({ agentId: agentIdSchema, path: z.string().min(1).max(350), selected: z.boolean() }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const authorized = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in authorized) return authorized.response;
  try {
    const { workspaceId } = await params;
    const agentId = agentIdSchema.parse(new URL(request.url).searchParams.get("employee"));
    const paths = await readEmployeeDocumentAssignments({ workspaceId, agentId });
    return NextResponse.json({ paths }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Employee context could not be read.") }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const authorized = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.knowledge.assign",
    method: "config.patch",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "workspace.manage"
  });
  if ("response" in authorized) return authorized.response;
  try {
    const { workspaceId } = await params;
    const input = assignmentSchema.parse(await request.json());
    const result = await assignEmployeeDocument({ workspaceId, ...input, commandOptions: authorized.commandOptions });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Employee context could not be updated.") }, { status: 400 });
  }
}
