import { notFound } from "next/navigation";

import { parseAgentDetailQueryState } from "@/components/operations/agents/agent-detail-tabs";
import { AgentDetailPageContent } from "@/components/operations/agents/agent-detail-page-content";
import { OperationsShell } from "@/components/operations/operations-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function AgentDetailRoute({
  params,
  searchParams
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { agentId: rawAgentId } = await params;
  const query = await searchParams;
  const agentId = decodeURIComponent(rawAgentId);
  const snapshot = await getInitialControlPlaneSnapshot();
  const agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    notFound();
  }

  const read = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const initialQuery = parseAgentDetailQueryState({
    tab: read("tab"),
    capability: read("capability"),
    session: read("session")
  });

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
          initialTab={initialQuery.tab}
          initialCapabilityFocus={initialQuery.capabilityFocus}
          initialSessionFocus={initialQuery.sessionFocus}
        />
      )}
    </OperationsShell>
  );
}
