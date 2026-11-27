import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TailscaleAccessView, TailscaleRoute } from "@/lib/security/remote-access-policy";
import {
  discoverTailscale, isTailscaleName, jsonMap, tailscaleInstallUrl, TailscaleConfigChanged,
  type JsonMap, type NativeTailscale
} from "@/lib/security/tailscale-native";

const httpsPorts = [443, 8443, 9443, 10443];
const routeMarker = "AgentOS Serve route";

type LocalNode = { id: string; name: string; setupRequired: boolean };
type AccessDependencies = {
  native: () => Promise<NativeTailscale | null>;
  verify: (origin: string) => Promise<boolean>;
};

const defaults: AccessDependencies = { native: discoverTailscale, verify: verifyHttps };

export function getTailscaleUpstream(env: Record<string, string | undefined> = process.env): string | null {
  // Desktop allocates its port per launch. A persistent route must never point
  // at that old port after the application quits.
  if (env.AGENTOS_DESKTOP === "1" || !/^\d+$/.test(env.PORT ?? "")) return null;
  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const origin = new URL(`http://127.0.0.1:${port}`).origin;
  if (env.__NEXT_PRIVATE_ORIGIN !== origin && env.__NEXT_PRIVATE_ORIGIN !== `http://127.0.0.1:${port}`) {
    return null;
  }
  return origin;
}

function readNode(info: unknown): LocalNode | null {
  const status = jsonMap(info);
  const self = jsonMap(status?.Self);
  const name = typeof self?.DNSName === "string" ? self.DNSName.toLowerCase().replace(/\.$/, "") : "";
  if (status?.BackendState !== "Running" || typeof self?.ID !== "string" || !self.ID || !isTailscaleName(name)) return null;
  const setupRequired = jsonMap(status.CurrentTailnet)?.MagicDNSEnabled !== true ||
    !Array.isArray(status.CertDomains) || !status.CertDomains.includes(name);
  return { id: self.ID, name, setupRequired };
}

async function matchesNode(native: NativeTailscale, node: LocalNode) {
  const current = await native.inspect().then(readNode, () => null);
  return current?.id === node.id && current.name === node.name;
}

function serveConfig(value: unknown): JsonMap {
  const config = value === null ? {} : jsonMap(value);
  if (!config || ["TCP", "Web", "AllowFunnel", "Foreground", "Services"].some((key) =>
    config[key] != null && !jsonMap(config[key]))) throw new Error("Unsupported Tailscale Serve status");
  return config;
}

function occupiedPorts(config: JsonMap) {
  const used = new Set<number>();
  for (const key of Object.keys(jsonMap(config.TCP) ?? {})) used.add(Number(key));
  for (const key of [...Object.keys(jsonMap(config.Web) ?? {}), ...Object.keys(jsonMap(config.AllowFunnel) ?? {})]) {
    used.add(Number(key.slice(key.lastIndexOf(":") + 1)));
  }
  for (const entry of Object.values(jsonMap(config.Foreground) ?? {})) {
    for (const port of occupiedPorts(serveConfig(entry))) used.add(port);
  }
  return used;
}

function addressFor(route: TailscaleRoute) {
  const url = new URL(route.origin);
  return { port: url.port || "443", key: `${url.hostname}:${url.port || "443"}` };
}

function handlers(route: TailscaleRoute) {
  return { "/": { Proxy: route.target }, [route.marker]: { Text: routeMarker } };
}

function ownsRoute(config: JsonMap, route: TailscaleRoute) {
  const { key, port } = addressFor(route);
  const web = jsonMap(config.Web) ?? {};
  const samePort = (other: string) => other.endsWith(`:${port}`);
  return !Object.keys(jsonMap(config.AllowFunnel) ?? {}).some(samePort) &&
    !Object.values(jsonMap(config.Foreground) ?? {}).some((entry) => occupiedPorts(serveConfig(entry)).has(Number(port))) &&
    Object.keys(web).filter(samePort).length === 1 &&
    isDeepStrictEqual(jsonMap(config.TCP)?.[port], { HTTPS: true }) &&
    isDeepStrictEqual(web[key], { Handlers: handlers(route) });
}

function view(
  status: TailscaleAccessView["status"], message: string, route?: TailscaleRoute,
  extra: Partial<TailscaleAccessView> = {}
): TailscaleAccessView {
  return { status, message, canEnable: false, canDisable: Boolean(route), installUrl: tailscaleInstallUrl(), ...extra };
}

async function readAccess(route: TailscaleRoute | undefined, dependencies: AccessDependencies) {
  const native = await dependencies.native();
  if (!native) return { issue: view("not-installed", "Install Tailscale on this computer and your other device.", route) };
  const info = await native.inspect().then((result) => ({ result }), () => null);
  if (!info) return { issue: view("unavailable", "Start Tailscale and check that AgentOS can read its status.", route) };
  const node = readNode(info.result);
  if (!node) return { issue: view("disconnected", "Open Tailscale on this computer and connect it to your private network.", route) };
  const config = await native.readServe().then(serveConfig).catch(() => null);
  if (!config) return { issue: view("unavailable", "This Tailscale client could not report its Serve routes. Update Tailscale and check its permissions.", route) };
  return { native, node, config };
}

export async function inspectTailscaleAccess(
  route: TailscaleRoute | undefined, upstream: string | null, dependencies = defaults
): Promise<TailscaleAccessView> {
  const access = await readAccess(route, dependencies);
  if (access.issue) return access.issue;
  const { config, node, native } = access;
  if (route && (route.nodeId !== node.id || !ownsRoute(config, route))) {
    return view("conflict", "The saved Serve route is missing or has changed. Review it in Tailscale before sharing this address.", route);
  }
  if (route && !route.enabled) {
    return view("cleanup-required", "AgentOS sign-in is disabled at this address. Try disabling again to remove the Serve route.", route);
  }
  if (node.setupRequired) return view("setup-required", "Enable MagicDNS and HTTPS Certificates in Tailscale DNS settings.", route);
  if (!upstream) {
    return view("manual", "Start AgentOS on a fixed IPv4 loopback port before enabling managed access.", route);
  }
  if (route) {
    if (upstream !== route.target) {
      return view("conflict", "AgentOS is running on a different port. Disable the old route, then enable access again.", route);
    }
    const verified = await dependencies.verify(route.origin);
    return verified
      ? view("active", "HTTPS responded from this computer. Open the link on another Tailscale device to check its connection.", route, { origin: route.origin })
      : view("configured", "The private Serve route exists. HTTPS has not responded from this computer yet.", route, { origin: route.origin });
  }
  const atomic = await native.readConfig().catch(() => null);
  if (!atomic) {
    return view("manual", "This Tailscale installation supports manual Serve setup. Managed changes require access to the daemon’s revision-protected socket.");
  }
  if (!httpsPorts.some((port) => !occupiedPorts(config).has(port))) {
    return view("conflict", "All supported HTTPS ports already have Serve configuration. Review them in Tailscale.");
  }
  return view("ready", "Share AgentOS privately with devices connected to your Tailscale network.", undefined, { canEnable: true });
}

export async function changeTailscaleAccess(input: {
  action: "enable" | "disable";
  route?: TailscaleRoute;
  upstream: string | null;
  persist: (route?: TailscaleRoute) => Promise<void>;
}, dependencies = defaults): Promise<TailscaleAccessView> {
  const { action, upstream, persist } = input;
  let { route } = input;
  if (action === "disable") {
    if (!route) return inspectTailscaleAccess(undefined, upstream, dependencies);
    // Revoke the app's origin before contacting the daemon, even offline.
    route = { ...route, enabled: false };
    await persist(route);
  }

  const access = await readAccess(route, dependencies);
  if (access.issue) return access.issue;
  const { native, node, config } = access;
  const snapshot = await native.readConfig().catch(() => null);
  if (!snapshot) return view("manual", "The Tailscale daemon did not permit a revision-protected change.", route);
  const checked = serveConfig(snapshot.config);
  if (!isDeepStrictEqual(config, checked) || !await matchesNode(native, node)) {
    return view("conflict", "Tailscale changed during the check. Refresh and try again.", route);
  }

  if (action === "enable") {
    if (!upstream || node.setupRequired) return inspectTailscaleAccess(route, upstream, dependencies);
    if (route) {
      if (!route.enabled && route.nodeId === node.id && route.target === upstream && ownsRoute(checked, route)) {
        route = { ...route, enabled: true };
        await persist(route);
      }
      return inspectTailscaleAccess(route, upstream, dependencies);
    }
    const used = occupiedPorts(checked);
    const port = httpsPorts.find((candidate) => !used.has(candidate));
    if (!port) return view("conflict", "All supported HTTPS ports already have Serve configuration.");
    route = {
      nodeId: node.id, origin: new URL(`https://${node.name}:${port}`).origin,
      target: upstream, marker: `/.well-known/agentos-serve-${randomUUID()}`, enabled: false
    };
    await persist(route);
    const { key } = addressFor(route);
    const next = {
      ...checked,
      TCP: { ...jsonMap(checked.TCP), [port]: { HTTPS: true } },
      Web: { ...jsonMap(checked.Web), [key]: { Handlers: handlers(route) } }
    };
    try {
      await native.writeConfig(next, snapshot.etag);
    } catch (error) {
      if (error instanceof TailscaleConfigChanged) await persist();
      return error instanceof TailscaleConfigChanged
        ? view("conflict", "Another Tailscale operation changed the configuration. Refresh and try again.")
        : view("cleanup-required", "Tailscale did not confirm the change. Refresh to check the route before retrying.", route);
    }
    const confirmed = await native.readServe().then(serveConfig).catch(() => null);
    if (!confirmed || !ownsRoute(confirmed, route) || !await matchesNode(native, node)) {
      return view("cleanup-required", "The route could not be verified. AgentOS sign-in remains disabled at this address.", route);
    }
    route = { ...route, enabled: true };
    await persist(route);
  } else if (route) {
    const { port, key } = addressFor(route);
    if (route.nodeId !== node.id) {
      return view("cleanup-required", "Reconnect to the original Tailscale device profile to remove its route. AgentOS sign-in is disabled at the saved address.", route);
    }
    const tcp = { ...jsonMap(checked.TCP) };
    const web = { ...jsonMap(checked.Web) };
    if (!ownsRoute(checked, route) && jsonMap(jsonMap(web[key])?.Handlers)?.[route.marker]) {
      return view("cleanup-required", "The Serve route has other changes. Review it in Tailscale. AgentOS sign-in is disabled at the saved address.", route);
    }
    if (ownsRoute(checked, route)) {
      delete tcp[port];
      delete web[key];
      try {
        await native.writeConfig({ ...checked, TCP: tcp, Web: web }, snapshot.etag);
      } catch {
        return view("cleanup-required", "AgentOS sign-in is disabled. Refresh and retry removing the Serve route.", route);
      }
    }
    await persist();
    route = undefined;
  }
  return inspectTailscaleAccess(route, upstream, dependencies);
}

async function verifyHttps(origin: string) {
  try {
    const response = await fetch(`${origin}/api/auth/status`, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(2_500)
    });
    const status = response.ok && jsonMap(await response.json());
    return Boolean(status && status.protectionEnabled === true && status.authenticated === false);
  } catch {
    return false;
  }
}
