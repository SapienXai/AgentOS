import "server-only";

import { createConnection } from "node:net";

import { redactErrorMessage } from "@/lib/security/redaction";

const maximumResponseBytes = 32_768;
const workerActionTimeoutMs: Record<BrowserWorkerRequest["action"], number> = {
  health: 5_000,
  "create-profile": 15_000,
  "start-session": 90_000,
  "inspect-authentication": 10_000,
  "stop-session": 45_000,
  "revoke-profile": 45_000
};
let transportOverride: BrowserWorkerTransport | null = null;

type BrowserWorkerTransport = (request: BrowserWorkerRequest) => Promise<unknown>;

type BrowserWorkerRequest =
  | { action: "health" }
  | { action: "create-profile"; profileId: string }
  | { action: "start-session"; profileId: string; initialUrl: string }
  | {
      action: "inspect-authentication";
      sessionId: string;
      allowedDomains: string[];
      authenticatedSelector: string;
      loginSelector: string;
    }
  | { action: "stop-session"; sessionId: string }
  | { action: "revoke-profile"; profileId: string };

export type BrowserWorkerSession = {
  sessionId: string;
  profileId: string;
  state: "active";
  expiresAt: string;
  cdpUrl: string;
};

export async function getBrowserWorkerHealth() {
  return await requestBrowserWorker<{ ready: boolean; activeSessions: number }>({
    action: "health"
  });
}

export async function createBrowserWorkerProfile(profileId: string) {
  return await requestBrowserWorker<{ profileId: string; persistent: true }>({
    action: "create-profile",
    profileId
  });
}

export async function startBrowserWorkerSession(input: {
  profileId: string;
  initialUrl: string;
}) {
  return await requestBrowserWorker<BrowserWorkerSession>({
    action: "start-session",
    profileId: input.profileId,
    initialUrl: input.initialUrl
  });
}

export async function stopBrowserWorkerSession(sessionId: string) {
  return await requestBrowserWorker<{ sessionId: string; stopped: true }>({
    action: "stop-session",
    sessionId
  });
}

export async function inspectBrowserWorkerAuthentication(input: {
  sessionId: string;
  allowedDomains: string[];
  authenticatedSelector: string;
  loginSelector: string;
}) {
  return await requestBrowserWorker<{
    state: "matched" | "login-visible" | "domain-mismatch" | "unknown";
    hostname: string | null;
  }>({
    action: "inspect-authentication",
    sessionId: input.sessionId,
    allowedDomains: input.allowedDomains,
    authenticatedSelector: input.authenticatedSelector,
    loginSelector: input.loginSelector
  });
}

export async function revokeBrowserWorkerProfile(profileId: string) {
  return await requestBrowserWorker<{ profileId: string; revoked: true }>({
    action: "revoke-profile",
    profileId
  });
}

export function setBrowserWorkerTransportForTesting(transport: BrowserWorkerTransport | null) {
  transportOverride = transport;
}

async function requestBrowserWorker<T>(request: BrowserWorkerRequest): Promise<T> {
  if (transportOverride) {
    return await transportOverride(request) as T;
  }

  const socketPath =
    process.env.AGENTOS_BROWSER_WORKER_SOCKET_PATH?.trim() ||
    "/tmp/agentos-browser-worker.sock";

  return await new Promise<T>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let settled = false;
    let buffer = "";
    const timeoutMs = workerActionTimeoutMs[request.action];
    const timeout = setTimeout(() => {
      finish(new Error(
        request.action === "start-session"
          ? "Secure browser startup did not finish within 90 seconds. Check Railway browser worker health and available memory."
          : "Secure browser worker did not respond in time."
      ));
    }, timeoutMs);

    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else resolve(value as T);
    };

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > maximumResponseBytes) {
        finish(new Error("Secure browser worker returned an invalid response."));
        return;
      }
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;

      try {
        const response = JSON.parse(buffer.slice(0, lineEnd)) as {
          ok?: unknown;
          result?: T;
          error?: unknown;
        };
        if (response.ok !== true) {
          finish(new Error(
            typeof response.error === "string"
              ? redactErrorMessage(response.error, "Secure browser worker action failed.")
              : "Secure browser worker action failed."
          ));
          return;
        }
        finish(undefined, response.result);
      } catch {
        finish(new Error("Secure browser worker returned an invalid response."));
      }
    });
    socket.once("error", () => {
      finish(new Error("Secure browser worker is unavailable."));
    });
    socket.once("close", () => {
      if (!settled) finish(new Error("Secure browser worker closed the request unexpectedly."));
    });
  });
}
