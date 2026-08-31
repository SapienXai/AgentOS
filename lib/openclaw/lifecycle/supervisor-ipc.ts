import "server-only";

import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { stat } from "node:fs/promises";

import { redactErrorMessage } from "@/lib/security/redaction";
import type {
  GatewayLifecycleErrorCode,
  GatewayLifecycleState,
  GatewayRuntimeDescriptor,
  SupervisorCommand,
  SupervisorErrorPayload,
  SupervisorResponse
} from "./types";
import { resolveSafeRuntimePath } from "./runtime-discovery";

export const SUPERVISOR_PROTOCOL_VERSION = 1;
export const SUPERVISOR_MAX_REQUEST_BYTES = 4_096;
export const SUPERVISOR_MAX_RESPONSE_BYTES = 32_768;

export type { SupervisorCommand, SupervisorErrorPayload, SupervisorResponse } from "./types";

export type SupervisorRequestOptions = {
  timeoutMs?: number;
  requestId?: string;
};

export async function requestSupervisorCommand(
  socketPath: string,
  command: SupervisorCommand,
  options: SupervisorRequestOptions = {}
): Promise<SupervisorResponse> {
  const safeSocketPath = resolveSafeRuntimePath(socketPath, "Gateway supervisor socket");
  await assertPrivateSocket(safeSocketPath);
  const requestId = options.requestId ?? randomUUID();
  const timeoutMs = options.timeoutMs ?? (command === "status" ? 5_000 : 150_000);
  const response = await requestSupervisorSocket(
    safeSocketPath,
    { protocolVersion: SUPERVISOR_PROTOCOL_VERSION, requestId, command },
    timeoutMs
  );

  if (!isSupervisorResponse(response) || response.requestId !== requestId) {
    throw new Error("The Gateway supervisor returned an invalid response.");
  }
  if (response.protocolVersion !== SUPERVISOR_PROTOCOL_VERSION) {
    throw new Error(`The Gateway supervisor protocol ${response.protocolVersion} is not supported.`);
  }
  if (!response.ok) {
    const error = response.error;
    const code = error?.code ?? "external-supervisor-rejected";
    throw new SupervisorIpcError(
      error?.message ?? "The Gateway supervisor rejected the request.",
      code,
      Boolean(error?.retryable),
      command
    );
  }

  return response;
}

export class SupervisorIpcError extends Error {
  readonly code: GatewayLifecycleErrorCode | "invalid-request" | "internal-error";
  readonly retryable: boolean;
  readonly command: SupervisorCommand;

  constructor(
    message: string,
    code: GatewayLifecycleErrorCode | "invalid-request" | "internal-error",
    retryable: boolean,
    command: SupervisorCommand
  ) {
    super(message);
    this.name = "SupervisorIpcError";
    this.code = code;
    this.retryable = retryable;
    this.command = command;
  }
}

export function mergeSupervisorResponse(
  descriptor: GatewayRuntimeDescriptor,
  response: SupervisorResponse
): GatewayRuntimeDescriptor {
  return {
    ...descriptor,
    ownership: "external-supervisor",
    managementStrategy: "external-supervisor",
    state: response.state,
    gatewayUrl: response.gatewayUrl ?? descriptor.gatewayUrl,
    gatewayPort: response.gatewayPort ?? descriptor.gatewayPort,
    pid: response.pid,
    generation: response.generation,
    supervisorProtocolVersion: response.protocolVersion,
    version: response.version ?? descriptor.version,
    sourceCommit: response.sourceCommit ?? descriptor.sourceCommit,
    health: response.health ?? descriptor.health,
    ready: response.ready ?? descriptor.ready,
    authenticated: response.authenticated ?? descriptor.authenticated,
    protocolVersion: response.protocolVersionGateway ?? descriptor.protocolVersion,
    checkedAt: new Date().toISOString(),
    reason: response.message ?? response.error?.message ?? descriptor.reason
  };
}

export function buildSupervisorResponse(input: {
  requestId: string;
  command: SupervisorCommand;
  state: GatewayLifecycleState;
  pid: number | null;
  generation: number | null;
  gatewayUrl?: string;
  gatewayPort?: number;
  ready?: boolean;
  authenticated?: boolean;
  health?: "unknown" | "live" | "not-live";
  protocolVersionGateway?: number | null;
  version?: string | null;
  sourceCommit?: string | null;
  message?: string;
  error?: SupervisorErrorPayload;
}): SupervisorResponse {
  return {
    protocolVersion: SUPERVISOR_PROTOCOL_VERSION,
    requestId: input.requestId,
    ok: !input.error,
    command: input.command,
    owner: "external-supervisor",
    state: input.state,
    pid: input.pid,
    generation: input.generation,
    gatewayUrl: input.gatewayUrl,
    gatewayPort: input.gatewayPort,
    ready: input.ready,
    authenticated: input.authenticated,
    health: input.health,
    protocolVersionGateway: input.protocolVersionGateway,
    version: input.version,
    sourceCommit: input.sourceCommit,
    message: input.message,
    error: input.error
  };
}

export function readSupervisorCommand(value: unknown): SupervisorCommand | null {
  if (value === "status" || value === "start" || value === "stop" || value === "restart") {
    return value;
  }
  if (value === "restart-gateway") return "restart";
  return null;
}

async function assertPrivateSocket(socketPath: string) {
  const metadata = await stat(socketPath).catch(() => null);
  if (!metadata) {
    throw new SupervisorIpcError(
      "The Gateway supervisor is unavailable.",
      "external-supervisor-unavailable",
      true,
      "status"
    );
  }
  if (!metadata.isSocket() || metadata.mode & 0o077) {
    throw new SupervisorIpcError(
      "The Gateway supervisor control channel is not a private Unix socket.",
      "external-supervisor-protocol",
      false,
      "status"
    );
  }
}

function requestSupervisorSocket(
  socketPath: string,
  request: Record<string, unknown>,
  timeoutMs: number
) {
  return new Promise<unknown>((resolve, reject) => {
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
      finish(() => reject(new SupervisorIpcError(
        "The Gateway supervisor did not respond in time.",
        "timeout",
        true,
        readSupervisorCommand(request.command) ?? "status"
      )));
    }, timeoutMs);

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > SUPERVISOR_MAX_RESPONSE_BYTES) {
        finish(() => reject(new SupervisorIpcError(
          "The Gateway supervisor returned an oversized response.",
          "invalid-response",
          false,
          readSupervisorCommand(request.command) ?? "status"
        )));
        return;
      }
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = buffer.slice(0, lineEnd);
      finish(() => {
        try {
          resolve(JSON.parse(line));
        } catch (error) {
          reject(new SupervisorIpcError(
            redactErrorMessage(error, "The Gateway supervisor returned invalid JSON."),
            "invalid-response",
            false,
            readSupervisorCommand(request.command) ?? "status"
          ));
        }
      });
    });
    socket.once("error", (error) => {
      finish(() => reject(new SupervisorIpcError(
        redactErrorMessage(error, "The Gateway supervisor is unavailable."),
        "external-supervisor-unavailable",
        true,
        readSupervisorCommand(request.command) ?? "status"
      )));
    });
    socket.once("end", () => {
      if (!settled) {
        finish(() => reject(new SupervisorIpcError(
          "The Gateway supervisor closed the control channel before responding.",
          "external-supervisor-unavailable",
          true,
          readSupervisorCommand(request.command) ?? "status"
        )));
      }
    });
  });
}

function isSupervisorResponse(value: unknown): value is SupervisorResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Partial<SupervisorResponse>;
  return response.protocolVersion === SUPERVISOR_PROTOCOL_VERSION &&
    typeof response.requestId === "string" &&
    typeof response.ok === "boolean" &&
    typeof response.command === "string" &&
    typeof response.state === "string" &&
    response.owner === "external-supervisor" &&
    (response.pid === null || typeof response.pid === "number") &&
    (response.generation === null || typeof response.generation === "number");
}
