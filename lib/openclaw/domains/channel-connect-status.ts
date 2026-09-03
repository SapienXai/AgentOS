import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import type { ChannelAccountRecord } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export function normalizeChannelConnectAccounts(
  status: OpenClawChannelStatusPayload | null,
  provider: string,
  configAccounts: ChannelAccountRecord[]
) {
  const liveAccounts = status?.channelAccounts?.[provider] ?? [];
  const byId = new Map<string, { live: (typeof liveAccounts)[number] | null; config: ChannelAccountRecord | null }>();
  for (const account of configAccounts.filter((candidate) => candidate.type === provider)) {
    byId.set(account.accountId?.trim() || account.id, { live: null, config: account });
  }
  for (const account of liveAccounts) {
    const current = byId.get(account.accountId) ?? { live: null, config: null };
    current.live = account;
    byId.set(account.accountId, current);
  }

  const defaultAccountId = status?.channelDefaultAccountId?.[provider] ??
    configAccounts.find((account) => account.type === provider && account.isDefault)?.accountId ?? null;

  return Array.from(byId.entries()).map(([accountId, entry]) => {
    const live = entry.live;
    const config = entry.config;
    const liveStatusAvailable = live !== null;
    const authenticationRequired = provider === "whatsapp" && liveStatusAvailable &&
      live?.configured === true &&
      live.linked === false &&
      live.connected === false &&
      live.running === false;

    return {
      accountId,
      name: live?.name?.trim() || config?.name?.trim() || accountId,
      configured: live?.configured === true || config?.configured === true,
      enabled: live?.enabled ?? config?.enabled !== false,
      isDefault: defaultAccountId ? defaultAccountId === accountId : config?.isDefault ?? null,
      linked: live?.linked === true,
      running: live?.running === true,
      connected: live?.connected === true,
      liveStatusAvailable,
      authenticationRequired,
      lastError: typeof live?.lastError === "string" && live.lastError.trim()
        ? redactErrorMessage(live.lastError, "OpenClaw reported a channel error.")
        : null
    };
  }).sort((left, right) => left.accountId.localeCompare(right.accountId));
}
