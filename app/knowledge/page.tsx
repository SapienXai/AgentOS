import { OperationsPage } from "@/components/operations/operations-page";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ workspaceId?: string | string[] }> }) {
  const [snapshot, { workspaceId }] = await Promise.all([getInitialControlPlaneSnapshot(), searchParams]);
  return <OperationsPage initialSnapshot={snapshot} page="knowledge" preferredWorkspaceId={typeof workspaceId === "string" ? workspaceId : null} />;
}
