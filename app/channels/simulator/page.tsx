import { RouteSimulatorPageContent } from "@/components/operations/channels/route-simulator-page-content";
import { OperationsShell } from "@/components/operations/operations-shell";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function ChannelSimulatorPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [snapshot, query] = await Promise.all([getInitialControlPlaneSnapshot(), searchParams]);
  const read = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return (
    <OperationsShell initialSnapshot={snapshot}>
      {(context) => (
        <RouteSimulatorPageContent
          rootSnapshot={context.rootSnapshot}
          initialQuery={{
            provider: read("provider"),
            account: read("account"),
            group: read("group"),
            topic: read("topic"),
            expectedAgentId: read("expectedAgentId")
          }}
        />
      )}
    </OperationsShell>
  );
}
