import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { WorkforceMissionDetailRoute } from "@/components/workforce/workforce-pages";
import { getWorkforceMissionDetail } from "@/lib/agentos/application/workforce-service";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";

export const dynamic = "force-dynamic";

export default async function MissionDetailRoute({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId } = await params;
  const [snapshot, actor] = await Promise.all([
    getInitialControlPlaneSnapshot(),
    headers().then((requestHeaders) => resolveAgentOsActorContext(new Request("http://localhost/", { headers: requestHeaders })))
  ]);
  const mission = await getWorkforceMissionDetail(missionId, { snapshot, actorId: actor?.actorId });
  if (!mission) notFound();

  return <WorkforceMissionDetailRoute initialSnapshot={snapshot} initial={mission} />;
}
