import type { ConfigUpdatePacingSettings } from "@/lib/openclaw/domains/control-plane-settings";

export type ConfigUpdatePacingSnapshot = {
  settings: ConfigUpdatePacingSettings;
  queueDurability: "persistent";
  pending: boolean;
  pendingCount: number;
  pendingPaths: string[];
  pendingSince: string | null;
  cooldownUntil: string | null;
  retryAfterMs: number | null;
  lastIssue: string | null;
  lastUpdatedAt: string | null;
};
