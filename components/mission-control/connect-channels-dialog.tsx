"use client";

import { ExternalLink, Link2 } from "lucide-react";

import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

/**
 * Compatibility entry point for the former connect dialog.
 * Channel discovery, lifecycle, provisioning, and routing now live in Channel Center.
 */
export function ConnectChannelsDialog({
  open,
  onOpenChange,
  activeWorkspaceId
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  onRefresh?: () => Promise<void>;
}) {
  const openChannelCenter = () => {
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
    window.location.assign(`/channels${params.toString() ? `?${params.toString()}` : ""}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[520px] rounded-[22px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Manage OpenClaw channels</DialogTitle>
              <DialogDescription className="mt-1">
                Channel Center is the single place for provider status, account setup, route policy, and agent bindings.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
          Workspace ownership remains available from this entry point. Runtime channel state and executable routing are read from OpenClaw.
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={openChannelCenter}>
            Open Channel Center
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
