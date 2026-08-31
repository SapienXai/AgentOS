import { readFile, stat } from "node:fs/promises";
import net from "node:net";

import type { OpenClawMigrationOwnershipEvidence } from "@/lib/openclaw/migration-engine/types";

export async function detectOpenClawMigrationOwnership(input: {
  stateDir: string;
  gatewayPort?: number;
  supervisorMode: "agentos-managed" | "external" | "unknown";
}): Promise<OpenClawMigrationOwnershipEvidence> {
  const checkedAt = new Date().toISOString();
  if (input.supervisorMode === "external") {
    return { status: "active", source: "external-supervisor", pid: null, reason: "An external supervisor is configured to own the Gateway lifecycle.", checkedAt };
  }

  for (const fileName of ["gateway.pid", "gateway.pid.lock", "gateway.lock"]) {
    const filePath = `${input.stateDir}/${fileName}`;
    if (!(await stat(filePath).then((value) => value.isFile()).catch(() => false))) continue;
    const raw = await readFile(filePath, "utf8").catch(() => "");
    const pid = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
      return { status: "active", source: fileName === "gateway.lock" ? "pid-lock" : "pid-file", pid, reason: `Gateway ownership marker ${fileName} points to a live process.`, checkedAt };
    }
    if (fileName === "gateway.lock" || !raw.trim()) {
      return { status: "unknown", source: "probe-error", pid: Number.isInteger(pid) ? pid : null, reason: `Gateway ownership marker ${fileName} exists but could not be verified safely.`, checkedAt };
    }
  }

  if (input.gatewayPort) {
    const occupied = await isLoopbackPortOccupied(input.gatewayPort);
    if (occupied === true) return { status: "active", source: "configured-port-listener", pid: null, reason: `Configured Gateway loopback port ${input.gatewayPort} is already occupied.`, checkedAt };
    if (occupied === null) return { status: "unknown", source: "probe-error", pid: null, reason: `Configured Gateway loopback port ${input.gatewayPort} could not be checked.`, checkedAt };
  }

  return { status: "inactive", source: "none", pid: null, reason: "No live Gateway owner was detected from state markers or the configured loopback port.", checkedAt };
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EPERM");
  }
}

function isLoopbackPortOccupied(port: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? false : null));
    socket.setTimeout(750, () => finish(null));
  });
}
