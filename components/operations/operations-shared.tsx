"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type { AgentRecord } from "@/lib/agentos/contracts";
import type { AgentFilter, AgentView, FileView, IntegrationStatus, IntegrationView, ModelView, TaskView } from "@/components/operations/operations-data";
import { EntityIcon } from "@/components/operations/operations-ui";
import { cn } from "@/lib/utils";

export type IntegrationSortMode = "last-active" | "name" | "status" | "category";
export type IntegrationRuntimeOverride = Partial<Pick<
  IntegrationView,
  "status" | "statusLabel" | "statusTone" | "connectionHealth" | "lastSyncLabel" | "uptimeLabel" | "rateLimitLabel" | "errorMessage"
>> & {
  sourceMethods?: string[];
};

export const integrationStatusToneMap: Record<IntegrationStatus, IntegrationView["statusTone"]> = {
  connected: "success",
  disabled: "muted",
  "pending-setup": "warning",
  failed: "danger",
  "needs-authentication": "warning",
  "missing-credentials": "warning",
  unsupported: "muted",
  unknown: "muted"
};

export function sortIntegrations(left: IntegrationView, right: IntegrationView, sort: IntegrationSortMode) {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "category") {
    return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
  }

  const leftTime = left.lastActiveMs ?? 0;
  const rightTime = right.lastActiveMs ?? 0;
  return rightTime - leftTime || left.name.localeCompare(right.name);
}

export function formatIntegrationStatusLabel(status: IntegrationStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "pending-setup":
      return "Pending Setup";
    case "failed":
      return "Failed";
    case "needs-authentication":
      return "Needs Authentication";
    case "missing-credentials":
      return "Missing Credentials";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

export function formatIntegrationStatusFilterLabel(status: "All Statuses" | IntegrationStatus) {
  return status === "All Statuses" ? status : formatIntegrationStatusLabel(status);
}

export function formatIntegrationSortLabel(sort: IntegrationSortMode) {
  switch (sort) {
    case "last-active":
      return "Last active";
    case "name":
      return "Name";
    case "status":
      return "Status";
    case "category":
      return "Category";
  }
}

export function statusIconClassName(status: IntegrationStatus) {
  if (status === "connected") {
    return "text-[hsl(var(--status-success-foreground))]";
  }

  if (status === "failed") {
    return "text-[hsl(var(--status-danger-foreground))]";
  }

  if (status === "pending-setup" || status === "missing-credentials" || status === "needs-authentication") {
    return "text-[hsl(var(--status-warning-foreground))]";
  }

  return "text-muted-foreground";
}

export function formatManagedBy(value: IntegrationView["managedBy"]) {
  switch (value) {
    case "openclaw":
      return "OpenClaw";
    case "agentos":
      return "AgentOS";
    case "external-config":
      return "External config";
    case "unsupported":
      return "Unsupported";
  }
}

export function readClientError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown integration error.";
}

export function MetricMini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "info" | "success" | "purple";
}) {
  return (
    <div className="rounded-[10px] border border-border bg-muted/35 p-2.5">
      <div className="flex items-center gap-2.5">
        <EntityIcon icon={Icon} label={label} tone={tone} />
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">{value}</span>
          <span className="block truncate text-[0.68rem] text-muted-foreground">{label}</span>
        </span>
      </div>
      <p className="mt-1.5 text-[0.68rem] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function UnsupportedPanel({
  title,
  description,
  className
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[12px] border border-border bg-muted/35 p-3", className)}>
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export function MissionDispatchDialog({
  open,
  agent,
  defaultWorkspaceId = null,
  onOpenChange,
  onSubmitted
}: {
  open: boolean;
  agent: AgentView | null;
  defaultWorkspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
}) {
  const [mission, setMission] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceId = agent?.source?.workspaceId ?? defaultWorkspaceId ?? undefined;

  useEffect(() => {
    if (open) {
      setMission("");
      setError(null);
    }
  }, [open]);

  const submitMission = async () => {
    const trimmedMission = mission.trim();
    if (!trimmedMission) {
      setError("Enter a task brief before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: trimmedMission,
          agentId: agent?.source?.id,
          workspaceId
        })
      });
      const result = await response.json().catch(() => null) as { error?: string; summary?: string } | null;
      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Mission dispatch failed.");
      }
      toast.success("Task submitted.", {
        description: result?.summary
      });
      onOpenChange(false);
      await onSubmitted();
    } catch (error) {
      setError(readClientError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[18px] p-4">
        <DialogHeader>
          <DialogTitle>{agent ? `Run task with ${agent.name}` : "Create Task"}</DialogTitle>
          <DialogDescription>
            Submits through the existing AgentOS mission dispatch flow.
          </DialogDescription>
        </DialogHeader>
        {error ? <div className="rounded-[10px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <Textarea
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          placeholder="Describe the task to run..."
          className="min-h-36 rounded-[12px] text-sm"
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90"
            disabled={submitting || !mission.trim()}
            onClick={() => void submitMission()}
          >
            {submitting ? "Submitting..." : "Submit Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function sortAgentViews(left: AgentView, right: AgentView, sort: "last-active" | "name" | "status" | "workspace") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "workspace") {
    return left.workspaceName.localeCompare(right.workspaceName) || left.name.localeCompare(right.name);
  }

  return (right.source?.lastActiveAt ?? 0) - (left.source?.lastActiveAt ?? 0) || left.name.localeCompare(right.name);
}

export function formatAgentSortLabel(sort: "last-active" | "name" | "status" | "workspace") {
  if (sort === "last-active") {
    return "Last active";
  }

  return toTitleCase(sort);
}

export function sortTaskViews(left: TaskView, right: TaskView, sort: "updated" | "title" | "status" | "agent") {
  if (sort === "title") {
    return left.title.localeCompare(right.title);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.title.localeCompare(right.title);
  }

  if (sort === "agent") {
    return left.agentName.localeCompare(right.agentName) || left.title.localeCompare(right.title);
  }

  return (right.source?.updatedAt ?? 0) - (left.source?.updatedAt ?? 0) || left.title.localeCompare(right.title);
}

export function formatTaskSortLabel(sort: "updated" | "title" | "status" | "agent") {
  if (sort === "updated") {
    return "Last updated";
  }

  return toTitleCase(sort);
}

export function formatTaskFilterLabel(filter: "all" | TaskView["status"]) {
  if (filter === "all") {
    return "All";
  }

  if (filter === "approval") {
    return "Awaiting Approval";
  }

  return toTitleCase(filter);
}

export function resolveTaskTone(filter: "all" | TaskView["status"]) {
  if (filter === "running") {
    return "info";
  }

  if (filter === "completed") {
    return "success";
  }

  if (filter === "approval" || filter === "stalled") {
    return "warning";
  }

  if (filter === "cancelled") {
    return "danger";
  }

  return "muted";
}

export function canCancelTask(task: TaskView) {
  return Boolean(task.source && ["queued", "running", "approval", "stalled"].includes(task.status));
}

export function sortFileViews(left: FileView, right: FileView, sort: "name" | "path" | "size" | "collection") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "collection") {
    return left.collection.localeCompare(right.collection) || left.name.localeCompare(right.name);
  }

  if (sort === "size") {
    return (right.sizeBytes ?? -1) - (left.sizeBytes ?? -1) || left.name.localeCompare(right.name);
  }

  return left.relativePath.localeCompare(right.relativePath);
}

export function formatFileSortLabel(sort: "name" | "path" | "size" | "collection") {
  if (sort === "path") {
    return "Path";
  }

  return toTitleCase(sort);
}

export function sortModelViews(left: ModelView, right: ModelView, sort: "name" | "provider" | "status" | "role") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "role") {
    return left.role.localeCompare(right.role) || left.name.localeCompare(right.name);
  }

  return left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name);
}

export function formatModelSortLabel(sort: "name" | "provider" | "status" | "role") {
  return toTitleCase(sort);
}

export function formatAgentDisplayNameFromRecord(agent: AgentRecord) {
  return agent.identityName?.trim() || agent.name || agent.id;
}

export function agentFilterLabel(filter: AgentFilter) {
  if (filter === "all") {
    return "All";
  }

  if (filter === "needs-approval") {
    return "Needs Approval";
  }

  return toTitleCase(filter);
}

export function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
