import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawConfigSnapshotPayload } from "@/lib/openclaw/client/types";
import { isGatewayConfigConflictError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { isLoopbackHost } from "@/lib/security/local-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permission = "secrets.manage";
const headers = { "Cache-Control": "private, no-store" };
const name = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
  .refine((value) => !Object.hasOwn(Object.prototype, value));
const endpoint = z.string().trim().max(2048).url().refine((value) => {
  const url = URL.parse(value);
  return url && !url.username && !url.password && !url.search && !url.hash &&
    (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.host)));
});
const serverFields = {
  transport: z.enum(["streamable-http", "sse"]),
  enabled: z.boolean()
};
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, endpoint, ...serverFields, oauth: z.boolean() }).strict(),
  z.object({ action: z.literal("edit"), name, endpoint: endpoint.optional(), ...serverFields }).strict(),
  z.object({ action: z.literal("remove"), name }).strict(),
  z.object({ action: z.literal("logout"), name }).strict()
]);

type NativeMcpServer = {
  url?: unknown;
  transport?: unknown;
  command?: unknown;
  enabled?: unknown;
  auth?: unknown;
  oauth?: { identity?: unknown };
};

function readServers(snapshot: OpenClawConfigSnapshotPayload): Record<string, NativeMcpServer> {
  const config = snapshot.config as { mcp?: { servers?: Record<string, NativeMcpServer> } } | undefined;
  if (!snapshot.valid || !snapshot.hash || !config) throw new Error("OpenClaw configuration is unavailable.");
  return config.mcp?.servers ?? {};
}

function localControlUiUrl(request: Request, snapshot: OpenClawConfigSnapshotPayload) {
  const config = snapshot.config as { gateway?: { controlUi?: { enabled?: boolean; basePath?: string } } } | undefined;
  const controlUi = config?.gateway?.controlUi;
  const gateway = URL.parse(resolveGatewayUrl());
  if (controlUi?.enabled === false || !gateway || gateway.protocol !== "ws:" ||
    !isLoopbackHost(gateway.host) || !isLoopbackHost(new URL(request.url).host) ||
    gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash) return null;
  const basePath = (controlUi?.basePath ?? "").replace(/\/+$/, "");
  if (!/^(?:\/[A-Za-z0-9_.~-]+)*$/.test(basePath) || basePath.split("/").some((part) => part === "." || part === "..")) return null;
  return new URL(`${basePath}/settings/mcp`, `http://${gateway.host}`).href;
}

function projectServers(servers: Record<string, NativeMcpServer>) {
  return Object.entries(servers).map(([id, server]) => {
    let host: string | null = null;
    try {
      if (typeof server.url === "string") host = new URL(server.url).host || null;
    } catch {
      // Gateway may redact endpoint values, including secret references.
    }
    const http = !server.command && typeof server.url === "string" && (
      server.transport === undefined || server.transport === "streamable-http" || server.transport === "sse"
    );
    return {
      name: id,
      host,
      transport: server.command ? "stdio" : server.transport === "sse" ? "sse" : http ? "streamable-http" : "unknown",
      enabled: server.enabled !== false,
      auth: server.auth === "oauth" ? (server.oauth?.identity === "per-requester" ? "per-requester" : "shared") : "none",
      editable: http && name.safeParse(id).success
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function GET(request: Request) {
  const access = await requireAgentOsOpenClawPreflight(request, {
    operation: "mcp.inventory.read",
    method: "config.get",
    targetKind: "mcp-server",
    securityClass: "read",
    requireNativeIdentity: true,
    productPermission: permission
  });
  if ("response" in access) return access.response;
  try {
    const snapshot = await getOpenClawAdapter().call<OpenClawConfigSnapshotPayload>("config.get", {}, {
      signal: request.signal, allowCliFallback: false
    });
    return NextResponse.json({
      servers: projectServers(readServers(snapshot)),
      controlUiUrl: localControlUiUrl(request, snapshot)
    }, { headers });
  } catch {
    return NextResponse.json({ error: "OpenClaw could not read the MCP configuration." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const actor = await requireAgentOsProductPermission(request, permission);
  if ("response" in actor) return actor.response;
  const origin = await requireSameOriginMutation(request);
  if (origin) return origin;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: "Enter a valid server name and an HTTPS or local HTTP endpoint without credentials, query parameters, or a fragment."
    }, { status: 400, headers });
  }
  const change = parsed.data;
  const method = change.action === "logout" ? "mcp.authLogout" : "config.patch";
  const operation = `mcp.server.${change.action}`;
  const access = await requireAgentOsOpenClawPreflight(request, {
    operation,
    method,
    params: change.action === "logout" ? { serverName: change.name } : undefined,
    targetKind: "mcp-server",
    targetId: change.name,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: permission
  });
  if ("response" in access) return access.response;
  if (access.actor.actorId !== actor.actor.actorId) {
    return NextResponse.json({ error: "The active operator changed. Refresh and try again." }, { status: 403, headers });
  }
  const adapter = getOpenClawAdapter();
  const options = { signal: request.signal, allowCliFallback: false };
  try {
    const snapshot = await adapter.call<OpenClawConfigSnapshotPayload>("config.get", {}, options);
    const servers = readServers(snapshot);
    const existing = Object.hasOwn(servers, change.name) ? servers[change.name] : undefined;
    if (change.action === "create" ? existing : !existing) {
      return NextResponse.json({ error: "The MCP inventory changed. Refresh and try again." }, { status: 409, headers });
    }
    if (change.action === "logout") {
      if (existing?.auth !== "oauth" || existing.oauth?.identity === "per-requester") {
        return NextResponse.json({ error: "This server has no operator-managed OAuth connection." }, { status: 409, headers });
      }
      await adapter.call(method, { serverName: change.name }, { ...options, ...access.commandOptions });
    } else {
      if (existing && !projectServers({ [change.name]: existing })[0].editable) {
        return NextResponse.json({ error: "Manage this server in OpenClaw." }, { status: 409, headers });
      }
      const definition = change.action === "remove" ? null : {
        ...(change.endpoint ? { url: change.endpoint } : {}),
        enabled: change.enabled,
        transport: change.transport,
        ...(change.action === "create" && change.oauth ? { auth: "oauth" } : {})
      };
      await adapter.call(method, {
        raw: JSON.stringify({ mcp: { servers: { [change.name]: definition } } }),
        baseHash: snapshot.hash
      }, { ...options, ...access.commandOptions });
    }
    await recordAgentOsAuditEvent({
      actor: access.actor, operation, targetKind: "mcp-server", targetId: change.name, result: "succeeded"
    }).catch(() => {});
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    if (isGatewayConfigConflictError(error)) {
      return NextResponse.json({ error: "OpenClaw configuration changed. Refresh and try again." }, { status: 409, headers });
    }
    return NextResponse.json({
      error: "OpenClaw could not confirm the MCP change. Refresh the inventory before retrying."
    }, { status: 503, headers });
  }
}
