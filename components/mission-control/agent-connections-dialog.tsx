"use client";

import { ExternalLink, MessageCircle } from "lucide-react";
import Link from "next/link";

import { AgentChannelsSection } from "@/components/operations/agents/agent-channels-section";
import { MissionControlDialogShell, missionControlDialogButtonClassName } from "@/components/mission-control/mission-control-dialog-shell";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

type AgentConnectionsDialogProps = {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  initialProviderId?: string | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  surfaceTheme?: "dark" | "light";
};

export function AgentConnectionsDialog({
  open,
  agentId,
  snapshot,
  initialProviderId,
  onOpenChange,
  onRefresh,
  surfaceTheme = "dark"
}: AgentConnectionsDialogProps) {
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const workspace = agent ? snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null : null;

  if (!agent || !workspace) return null;

  return <AgentConnectionsDialogContent
    open={open}
    agent={agent}
    workspaceId={workspace.id}
    workspacePath={workspace.path}
    initialProviderId={initialProviderId}
    onOpenChange={onOpenChange}
    onRefresh={onRefresh}
    surfaceTheme={surfaceTheme}
  />;
}

function AgentConnectionsDialogContent({
  open,
  agent,
  workspaceId,
  workspacePath,
  initialProviderId,
  onOpenChange,
  onRefresh,
  surfaceTheme
}: {
  open: boolean;
  agent: MissionControlSnapshot["agents"][number];
  workspaceId: string;
  workspacePath: string;
  initialProviderId?: string | null;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  surfaceTheme: "dark" | "light";
}) {
  return (
    <MissionControlDialogShell
        open={open}
        onOpenChange={onOpenChange}
        surfaceTheme={surfaceTheme}
        variant="worker-profile"
        icon={MessageCircle}
        title={`${formatAgentDisplayName(agent)} connections`}
        description="Connect an account, choose a real group or channel, and send it to this agent."
        chips={<span className="text-[10px] text-muted-foreground">Channel connection</span>}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <p className="min-w-0 text-[10px] text-muted-foreground">Channel Center remains available for advanced global inspection.</p>
            <Link
              href="/channels"
              className={missionControlDialogButtonClassName("secondary", surfaceTheme)}
              onClick={() => onOpenChange(false)}
            >
              <ExternalLink className="mr-1.5 inline h-3 w-3" />
              Open Channel Center
            </Link>
          </div>
        }
        bodyClassName="space-y-3"
      >
        <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">Current agent:</span> {formatAgentDisplayName(agent)}. Choose a real channel below; the connection is verified before it appears on the Agent card.
        </div>
        <AgentChannelsSection
          agentId={agent.id}
          agentLabel={formatAgentDisplayName(agent)}
          workspaceId={workspaceId}
          workspacePath={workspacePath}
          initialProviderId={initialProviderId}
          surfaceTheme={surfaceTheme}
          onRouteChanged={onRefresh}
        />
      </MissionControlDialogShell>
  );
}
