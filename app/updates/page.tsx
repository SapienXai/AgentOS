import { OperationsPage } from "@/components/operations/operations-page";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <OperationsPage initialSnapshot={snapshot} page="updates" />;
}
