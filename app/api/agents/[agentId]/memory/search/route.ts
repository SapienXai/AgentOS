import { NextResponse } from "next/server";
import { z } from "zod";

import { searchWorkerMemory } from "@/lib/openclaw/application/native-memory-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  query: z.string().trim().min(1).max(4096),
  maxResults: z.number().finite().optional(),
  minScore: z.number().finite().optional()
}).strict();

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  let input: z.infer<typeof searchSchema>;
  try {
    input = searchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid memory search request.") }, { status: 400 });
  }

  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "memory.search",
    method: "memory.search",
    params: { agentId, query: input.query, maxResults: input.maxResults, minScore: input.minScore },
    targetKind: "agent-memory-search",
    targetId: agentId,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "runtime.use"
  });
  if ("response" in preflight) return preflight.response;

  try {
    const result = await searchWorkerMemory({ agentId, ...input }, {
      commandOptions: preflight.commandOptions
    });
    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to search native memory.") },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
}
