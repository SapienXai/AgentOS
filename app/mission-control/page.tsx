import { MissionControlShell } from "@/components/mission-control/mission-control-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function MissionControlPage() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <MissionControlShell initialSnapshot={snapshot} />;
}
