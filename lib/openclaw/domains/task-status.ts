import type { RuntimeRecord } from "@/lib/openclaw/types";

export type OpenClawTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export function mapOpenClawTaskStatus(value: string | null | undefined): {
  status: RuntimeRecord["status"];
  known: boolean;
} {
  switch (value?.trim().toLowerCase()) {
    case "queued":
      return { status: "queued", known: true };
    case "running":
      return { status: "running", known: true };
    case "completed":
      return { status: "completed", known: true };
    case "cancelled":
      return { status: "cancelled", known: true };
    case "failed":
    case "timed_out":
      return { status: "stalled", known: true };
    default:
      return { status: "stalled", known: false };
  }
}

export function isTerminalOpenClawTaskStatus(value: string | null | undefined) {
  return ["completed", "failed", "cancelled", "timed_out"].includes(value?.trim().toLowerCase() ?? "");
}

export function resolveCanonicalTaskStatus(input: {
  nativeTaskStatus?: string | null;
  runtimeStatuses: RuntimeRecord["status"][];
  dispatchStatus?: RuntimeRecord["status"] | null;
}) {
  if (input.nativeTaskStatus) {
    return mapOpenClawTaskStatus(input.nativeTaskStatus).status;
  }

  // The sidecar is useful until a native ledger row is visible, but it must
  // not override a live runtime observation when no native task status exists.
  if (input.dispatchStatus && ["completed", "stalled", "cancelled"].includes(input.dispatchStatus)) {
    return input.dispatchStatus;
  }

  if (input.runtimeStatuses.includes("running")) return "running";
  if (input.runtimeStatuses.includes("cancelled")) return "cancelled";
  if (input.runtimeStatuses.includes("queued")) return "queued";
  if (input.runtimeStatuses.includes("stalled")) return "stalled";
  if (input.runtimeStatuses.includes("idle")) return "idle";
  return input.runtimeStatuses[0] ?? "completed";
}
