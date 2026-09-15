import { OperationsPage } from "@/components/operations/operations-page";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <OperationsPage initialSnapshot={snapshot} page="channels" />;
}
