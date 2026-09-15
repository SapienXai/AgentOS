"use client";

import { useState } from "react";
import { ExternalLink, MessageCircle } from "lucide-react";
import Link from "next/link";

import { AgentChannelsSection } from "@/components/operations/agents/agent-channels-section";
import { ChannelCenterAddAccountDialog } from "@/components/operations/channels/channel-center-add-account-dialog";
import { MissionControlDialogShell, missionControlDialogButtonClassName } from "@/components/mission-control/mission-control-dialog-shell";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

type AgentConnectionsDialogProps = {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  surfaceTheme?: "dark" | "light";
};

export function AgentConnectionsDialog({
  open,
  agentId,
  snapshot,
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
    snapshot={snapshot}
    onOpenChange={onOpenChange}
    onRefresh={onRefresh}
    surfaceTheme={surfaceTheme}
  />;
}

function AgentConnectionsDialogContent({
  open,
  agent,
  workspaceId,
  snapshot,
  onOpenChange,
  onRefresh,
  surfaceTheme
}: {
  open: boolean;
  agent: MissionControlSnapshot["agents"][number];
  workspaceId: string;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  surfaceTheme: "dark" | "light";
}) {
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const refreshAfterAccountChange = async () => {
    await onRefresh();
    setAccountRefreshKey((current) => current + 1);
  };

  return (
    <>
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
          key={`${agent.id}:${accountRefreshKey}`}
          agentId={agent.id}
          surfaceTheme={surfaceTheme}
          onConnectAccount={() => setAccountDialogOpen(true)}
          onRouteChanged={onRefresh}
        />
      </MissionControlDialogShell>

      <ChannelCenterAddAccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        snapshot={snapshot}
        activeWorkspaceId={workspaceId}
        onRefresh={refreshAfterAccountChange}
      />
    </>
  );
}
