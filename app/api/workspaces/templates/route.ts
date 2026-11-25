import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const packageName = z.string().max(180).regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
const catalogEntry = z.object({
  packageName,
  displayName: z.string(),
  summary: z.string().optional(),
  latestVersion: z.string().optional(),
  official: z.boolean()
});
const nativeDetail = catalogEntry.extend({
  version: z.string(),
  workspaceFiles: z.number(),
  skills: z.number(),
  plugins: z.number(),
  mcpServers: z.number(),
  scheduledJobs: z.number(),
  contents: z.object({ instructions: z.array(z.object({ name: z.string(), source: z.string() })) }).optional(),
  security: z.object({ verdict: z.string().optional() }).optional()
});
const input = z.object({
  q: z.string().trim().max(200).optional(),
  packageName: packageName.optional(),
  version: z.string().trim().min(1).max(160).optional()
});

export async function GET(request: Request) {
  const query = input.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return NextResponse.json({ error: "Invalid ClawHub catalog query." }, { status: 400, headers });
  const { q, packageName: id, version } = query.data;
  const method = id ? "templates.catalog.detail" : "templates.catalog.search";
  const params = id ? { packageName: id, version } : { query: q || undefined, limit: 20 };
  const access = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.templates.read",
    method,
    params,
    targetKind: "clawhub-template",
    targetId: id,
    securityClass: "read",
    requireNativeIdentity: true,
    productPermission: "workspace.manage"
  });
  if ("response" in access) return access.response;
  try {
    const result = await getOpenClawAdapter().call(method, params, {
      allowCliFallback: false, signal: request.signal, timeoutMs: 12_000
    });
    const projected = id
      ? z.object({ detail: nativeDetail }).parse(result)
      : z.object({ entries: z.array(catalogEntry) }).parse(result);
    return NextResponse.json(projected, { headers });
  } catch {
    return NextResponse.json({
      error: "OpenClaw could not read the ClawHub template catalog. Check template availability in OpenClaw."
    }, { status: 503, headers });
  }
}
