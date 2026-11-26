import { WorkforceChatRoute } from "@/components/workforce/chat-page";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const snapshot = await getInitialControlPlaneSnapshot();
  return <WorkforceChatRoute initialSnapshot={snapshot} />;
}
