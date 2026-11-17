export type GatewayBindRepairPlan = {
  previousAddress: string;
  nextAddress: string;
  port: number;
};

export type GatewayBindRecoveryStatus =
  | { state: "none" }
  | { state: "owner-required" }
  | { state: "manual"; previousAddress: string; reason: "ambiguous-network" | "unsupported-auth" }
  | { state: "repairable"; plan: GatewayBindRepairPlan };

export type GatewayBindRepairResult =
  | { outcome: "stale" | "busy" | "write-unverified" }
  | { outcome: "saved" | "listening" | "recovered"; plan: GatewayBindRepairPlan };
