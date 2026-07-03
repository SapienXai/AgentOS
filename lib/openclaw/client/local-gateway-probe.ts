import "server-only";

import net from "node:net";

import type { GatewayStatusPayload } from "@/lib/openclaw/client/gateway-client";

export async function probeLocalGatewayStatus(port = 18789): Promise<GatewayStatusPayload | null> {
  const ready = await probeGatewayReadyEndpoint(port, 750);

  if (ready !== null) {
    return {
      service: {
        label: "Local readiness probe",
        loaded: true
      },
      gateway: {
        bindMode: "loopback",
        port,
        probeUrl: `ws://127.0.0.1:${port}`
      },
      rpc: {
        ok: ready,
        capability: ready ? "readyz" : "starting"
      }
    };
  }

  const reachable = await probeTcpPort("127.0.0.1", port, 400);

  if (!reachable) {
    return null;
  }

  return {
    service: {
      label: "Local port probe",
      loaded: true
    },
    gateway: {
      bindMode: "loopback",
      port,
      probeUrl: `ws://127.0.0.1:${port}`
    }
  };
}

async function probeGatewayReadyEndpoint(port: number, timeoutMs: number): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (response.ok) {
      const payload = await response.json().catch(() => null) as { ready?: boolean } | null;
      return payload?.ready !== false;
    }

    return response.status === 503 ? false : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTcpPort(host: string, port: number, timeoutMs: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
