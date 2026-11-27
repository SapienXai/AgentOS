import { isIP } from "node:net";
import { isLocalOperatorHostRequest, parseHttpsOrigin } from "@/lib/security/local-operator";
import { isTailscaleName } from "@/lib/security/tailscale-native";

type Incoming = { url: string; headers: Headers };

function isTailnetPeer(value: string) {
  if (isIP(value) === 6) return value.toLowerCase().startsWith("fd7a:115c:a1e0:");
  if (isIP(value) !== 4) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

export function classifyTailscaleRequest(request: Incoming): "deny" | URL | null {
  const { headers } = request;
  if (headers.has("tailscale-funnel-request")) return "deny";
  const peer = isTailnetPeer(headers.get("x-forwarded-for")?.trim() ?? "");
  if (isLocalOperatorHostRequest(request) && (
    peer || headers.has("tailscale-user-login") || headers.has("tailscale-headers-info")
  )) return "deny";

  const origins = [headers.get("host"), headers.get("x-forwarded-host"), new URL(request.url).host]
    .map((host) => host ? parseHttpsOrigin(`https://${host}`) : null);
  const tailnet = origins.find((origin) => origin && isTailscaleName(origin.hostname));
  if (!tailnet) return null;
  return peer && headers.get("x-forwarded-proto") === "https" && origins[0]?.origin === tailnet.origin &&
    origins[1]?.origin === tailnet.origin ? tailnet : "deny";
}
