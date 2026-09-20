import { notFound } from "next/navigation";

import { AgentDetailPageContent } from "@/components/operations/agents/agent-detail-page-content";
import { OperationsShell } from "@/components/operations/operations-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function AgentDetailRoute({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId);
  const snapshot = await getInitialControlPlaneSnapshot();
  const agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    notFound();
  }

  return (
    <OperationsShell initialSnapshot={snapshot} preferredWorkspaceId={agent.workspaceId}>
      {(context) => (
        <AgentDetailPageContent
          agentId={agent.id}
          snapshot={context.snapshot}
          rootSnapshot={context.rootSnapshot}
          surfaceTheme={context.surfaceTheme}
          refresh={context.refresh}
          setSnapshot={context.setSnapshot}
        />
      )}
    </OperationsShell>
  );
}
