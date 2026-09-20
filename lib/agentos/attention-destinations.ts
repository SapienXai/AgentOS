import type { AttentionAction, AttentionItem } from "@/lib/agentos/contracts";

export type AttentionDestination = {
  href: string;
  label: string;
  reason: string;
};

export function resolveAttentionDestination(item: AttentionItem, action?: AttentionAction["id"]): AttentionDestination {
  const workerId = item.worker.id ? encodeURIComponent(item.worker.id) : null;
  const capabilityId = item.evidence?.capabilityId?.trim() || null;
  const sessionKey = item.source.sessionKey?.trim() || null;
  const missionId = item.mission?.id?.trim() || null;

  if ((item.type === "needs-setup" || item.type === "blocked") && workerId && capabilityId) {
    return {
      href: `/agents/${workerId}?tab=capabilities&capability=${encodeURIComponent(capabilityId)}`,
      label: item.type === "blocked" ? "Review worker capabilities" : "Open worker capabilities",
      reason: "This worker and capability are present in the attention evidence."
    };
  }

  if (item.type === "runtime-issue") {
    if (missionId) {
      return {
        href: `/missions/${encodeURIComponent(missionId)}`,
        label: "Open mission",
        reason: "The runtime issue is linked to a specific mission."
      };
    }
    if (workerId) {
      const sessionQuery = sessionKey ? `&session=${encodeURIComponent(sessionKey)}` : "";
      return {
        href: `/agents/${workerId}?tab=sessions${sessionQuery}`,
        label: "Open worker session",
        reason: sessionKey ? "The worker and session are present in the runtime evidence." : "The worker is present in the runtime evidence."
      };
    }
    return {
      href: "/settings#diagnostics",
      label: "Review runtime diagnostics",
      reason: "No worker-specific recovery target is available in the evidence."
    };
  }

  if (action === "open-setup") {
    return {
      href: "/accounts",
      label: "Open account setup",
      reason: "The capability evidence does not identify a more precise worker repair surface."
    };
  }

  if (action === "review-policy") {
    return {
      href: "/settings#gateway",
      label: "Review policy settings",
      reason: "The policy blocker is global or lacks worker-specific evidence."
    };
  }

  if (action === "review" && missionId) {
    return {
      href: `/missions/${encodeURIComponent(missionId)}`,
      label: "Review mission",
      reason: "The item includes a stable mission destination."
    };
  }

  if (workerId && sessionKey) {
    return {
      href: `/agents/${workerId}?tab=sessions&session=${encodeURIComponent(sessionKey)}`,
      label: "Open worker session",
      reason: "The worker and session are present in the attention evidence."
    };
  }

  return {
    href: "/operations",
    label: "Open operations",
    reason: "The evidence does not identify a safer exact destination."
  };
}
