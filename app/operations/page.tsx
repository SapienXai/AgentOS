import { OperationsPage } from "@/components/operations/operations-page";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";
export default async function OperationsRoute() { return <OperationsPage initialSnapshot={await getInitialControlPlaneSnapshot()} page="operations" />; }
