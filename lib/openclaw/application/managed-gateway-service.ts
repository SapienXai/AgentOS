import "server-only";

import { createConnection } from "node:net";

import { redactErrorMessage } from "@/lib/security/redaction";

const defaultSupervisorSocketPath = "/tmp/agentos-supervisor.sock";
const maxResponseBytes = 32_768;

type SupervisorResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export async function restartManagedRailwayGateway() {
  const socketPath = process.env.AGENTOS_SUPERVISOR_SOCKET_PATH?.trim() || defaultSupervisorSocketPath;
  const response = await requestSupervisor(socketPath, { action: "restart-gateway" });

  if (!response.ok) {
    throw new Error(response.error || "The Railway supervisor could not restart the OpenClaw Gateway.");
  }

  return {
    message: response.message || "Managed OpenClaw Gateway restarted and is ready."
  };
}

function requestSupervisor(socketPath: string, request: { action: "restart-gateway" }) {
  return new Promise<SupervisorResponse>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    let buffer = "";

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("The Railway supervisor did not complete the Gateway restart in time.")));
    }, 150_000);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > maxResponseBytes) {
        finish(() => reject(new Error("The Railway supervisor returned an oversized response.")));
        return;
      }

      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;

      try {
        const payload = JSON.parse(buffer.slice(0, lineEnd)) as SupervisorResponse;
        finish(() => resolve(payload));
      } catch (error) {
        finish(() => reject(new Error(redactErrorMessage(error, "The Railway supervisor returned an invalid response."))));
      }
    });
    socket.once("error", (error) => {
      finish(() => reject(new Error(redactErrorMessage(
        error,
        "The Railway Gateway supervisor is unavailable. Restart or redeploy the Railway service."
      ))));
    });
    socket.once("end", () => {
      if (!settled) {
        finish(() => reject(new Error("The Railway supervisor closed the control channel before responding.")));
      }
    });
  });
}
