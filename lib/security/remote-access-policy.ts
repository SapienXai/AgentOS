import { networkInterfaces } from "node:os";

export type TailscaleRoute = {
  origin: string;
  nodeId: string;
  target: string;
  marker: string;
  enabled: boolean;
};

export type TailscaleAccessView = {
  status: "not-installed" | "unavailable" | "disconnected" | "setup-required" | "manual" |
    "ready" | "active" | "configured" | "conflict" | "cleanup-required";
  message: string;
  canEnable: boolean;
  canDisable: boolean;
  origin?: string;
  installUrl: string;
};

export type RemoteAccessSettings = { origins: string[]; lanEnabled: boolean; tailscale?: TailscaleRoute };
export type RemoteAccessChange = { action: "add" | "remove"; origin: string } | { action: "lan"; enabled: boolean };

export const EMPTY_REMOTE_ACCESS: RemoteAccessSettings = { origins: [], lanEnabled: false };
export const MAX_REMOTE_ORIGINS = 25;

export function getLanHttpsOrigins(
  env: Record<string, string | undefined> = process.env,
  interfaces = networkInterfaces()
) {
  const rawPort = env.AGENTOS_LAN_HTTPS_PORT ?? "443";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) return [];

  const origins = Object.values(interfaces).flatMap((entries) => (entries ?? []).flatMap((entry) => {
    if (entry.internal || entry.family !== "IPv4") return [];
    const [first, second] = entry.address.split(".").map(Number);
    const privateAddress = first === 10 || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
    if (!privateAddress) return [];
    return [`https://${entry.address}${port === 443 ? "" : `:${port}`}`];
  }));
  return [...new Set(origins)].sort();
}
