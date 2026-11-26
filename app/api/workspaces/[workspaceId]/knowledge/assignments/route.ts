import { NextResponse } from "next/server";
import { z } from "zod";

import { assignEmployeeDocuments, readDocumentEmployeeAssignments, readEmployeeDocumentAssignments } from "@/lib/agentos/application/workspace-native-knowledge-service";
import { MAX_KNOWLEDGE_ASSIGNMENT_CHANGES } from "@/lib/agentos/domains/knowledge-import-formats";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage } from "@/lib/security/redaction";

const agentIdSchema = z.string().min(1).max(160);
const changeSchema = z.object({ path: z.string().min(1).max(350), selected: z.boolean() });
const assignmentSchema = z.union([
  changeSchema.extend({ agentId: agentIdSchema }).strict().transform(({ agentId, ...change }) => ({ agentId, changes: [change] })),
  z.object({ agentId: agentIdSchema, changes: z.array(changeSchema.strict()).min(1).max(MAX_KNOWLEDGE_ASSIGNMENT_CHANGES) }).strict()
]);

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const authorized = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in authorized) return authorized.response;
  try {
    const { workspaceId } = await params;
    const query = new URL(request.url).searchParams;
    const source = query.get("source");
    if (source !== null) {
      const employees = await readDocumentEmployeeAssignments(workspaceId, z.string().min(1).max(350).parse(source));
      return NextResponse.json({ employees }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const agentId = agentIdSchema.parse(query.get("employee"));
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
    const result = await assignEmployeeDocuments({ workspaceId, ...input, commandOptions: authorized.commandOptions });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Employee context could not be updated.") }, { status: 400 });
  }
}
