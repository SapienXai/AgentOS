import { NextResponse } from "next/server";

import { downloadWorkforceMissionArtifact, getWorkforceMissionDetail } from "@/lib/agentos/application/workforce-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ missionId: string }> }
) {
  const artifactId = new URL(request.url).searchParams.get("artifact");
  const permission = await requireAgentOsProductPermission(request, artifactId === null ? "missions.use" : "workspace.manage");
  if ("response" in permission) return permission.response;

  const { missionId } = await context.params;
  if (!missionId || missionId.length > 256 || (artifactId !== null && !/^[0-9a-f]{24}$/.test(artifactId))) {
    return NextResponse.json({ error: "Invalid mission or artifact id." }, { status: 400 });
  }

  try {
    if (artifactId) {
      const artifact = await downloadWorkforceMissionArtifact(missionId, artifactId);
      if (!artifact) return NextResponse.json({ error: "This file is no longer available." }, { status: 404 });
      const filename = encodeURIComponent(artifact.filename).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      );
      return new Response(artifact.bytes, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
          "Content-Security-Policy": "sandbox",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    const mission = await getWorkforceMissionDetail(missionId, { actorId: permission.actor.actorId });
    if (!mission) return NextResponse.json({ error: "Mission was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(mission), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Mission details are temporarily unavailable.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
