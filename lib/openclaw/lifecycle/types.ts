import type { ChildProcess } from "node:child_process";

export type GatewayLifecycleOwnership =
  | "agentos-managed"
  | "external-supervisor"
  | "unavailable"
  | "unknown";

export type GatewayLifecycleState =
  | "unknown"
  | "stopped"
  | "starting"
  | "running"
  | "ready"
  | "degraded"
  | "restarting"
  | "stopping"
  | "crashed"
  | "recovering"
  | "blocked";

export type GatewayLifecycleOperation =
  | "inspect"
  | "start"
  | "stop"
  | "restart"
  | "waitForReady"
  | "recover"
  | "getStatus"
  | "prepareForMaintenance"
  | "resumeAfterMaintenance";

export type GatewayDeploymentMode = "local" | "railway" | "unknown";

export type GatewayManagementStrategy =
  | "child"
  | "openclaw-service"
  | "external-supervisor"
  | "unavailable";

export type GatewayLifecycleErrorCode =
  | "ownership-unknown"
  | "ownership-unavailable"
  | "external-supervisor-unavailable"
  | "external-supervisor-rejected"
  | "external-supervisor-protocol"
  | "operation-in-progress"
  | "gateway-already-running"
  | "gateway-not-running"
  | "gateway-not-ready"
  | "gateway-crashed"
  | "gateway-crash-loop"
  | "gateway-binary-unavailable"
  | "unsafe-runtime-path"
  | "unsupported-operation"
  | "timeout"
  | "invalid-response";

export type GatewayLifecycleFailure = {
  code: GatewayLifecycleErrorCode;
  message: string;
  retryable: boolean;
  operation: GatewayLifecycleOperation;
  details?: Record<string, unknown>;
};

export class GatewayLifecycleError extends Error {
  readonly code: GatewayLifecycleErrorCode;
  readonly retryable: boolean;
  readonly operation: GatewayLifecycleOperation;
  readonly details: Record<string, unknown>;

  constructor(
    failure: Omit<GatewayLifecycleFailure, "message"> & { message: string }
  ) {
    super(failure.message);
    this.name = "GatewayLifecycleError";
    this.code = failure.code;
    this.retryable = failure.retryable;
    this.operation = failure.operation;
    this.details = failure.details ?? {};
  }

  toFailure(): GatewayLifecycleFailure {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      operation: this.operation,
      details: this.details
    };
  }
}

export type GatewayRuntimeDescriptor = {
  ownership: GatewayLifecycleOwnership;
  state: GatewayLifecycleState;
  deploymentMode: GatewayDeploymentMode;
  managementStrategy: GatewayManagementStrategy;
  gatewayUrl: string;
  gatewayPort: number;
  binaryPath: string | null;
  installLocation: string | null;
  stateDir: string;
  configPath: string;
  pid: number | null;
  generation: number | null;
  supervisorEndpoint: string | null;
  supervisorProtocolVersion: number | null;
  version: string | null;
  sourceCommit: string | null;
  health: "unknown" | "live" | "not-live";
  ready: boolean;
  authenticated: boolean;
  protocolVersion: number | null;
  checkedAt: string;
  reason: string | null;
};

export type GatewayLifecycleResult = {
  operation: GatewayLifecycleOperation;
  descriptor: GatewayRuntimeDescriptor;
  changed: boolean;
  message: string;
};

export type GatewayReadinessResult = {
  ready: boolean;
  authenticated: boolean;
  health: "unknown" | "live" | "not-live";
  protocolVersion: number | null;
  version: string | null;
  sourceCommit: string | null;
  checkedAt: string;
  reason: string | null;
};

export type GatewayLifecycleChild = {
  process: ChildProcess;
  pid: number;
  generation: number;
};

export type SupervisorCommand = "status" | "start" | "stop" | "restart";

export type SupervisorErrorPayload = {
  code: GatewayLifecycleErrorCode | "invalid-request" | "internal-error";
  message: string;
  retryable: boolean;
};

export type SupervisorResponse = {
  protocolVersion: number;
  requestId: string;
  ok: boolean;
  command: SupervisorCommand;
  owner: "external-supervisor";
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
};

export type GatewayLifecycleEnvironment = Readonly<Record<string, string | undefined>>;

export type GatewayLifecycleServiceOptions = {
  env?: GatewayLifecycleEnvironment;
  platform?: NodeJS.Platform;
  now?: () => Date;
  resolveBinary?: () => Promise<string>;
  readinessProbe?: (descriptor: GatewayRuntimeDescriptor) => Promise<GatewayReadinessResult>;
  spawnGateway?: (descriptor: GatewayRuntimeDescriptor) => Promise<GatewayLifecycleChild>;
  stopGateway?: (child: GatewayLifecycleChild) => Promise<void>;
  externalSupervisor?: {
    request: (command: "status" | "start" | "stop" | "restart") => Promise<SupervisorResponse>;
  };
  crashRecoveryLimit?: number;
};

export interface GatewayLifecycleService {
  inspect(): Promise<GatewayRuntimeDescriptor>;
  getStatus(): Promise<GatewayRuntimeDescriptor>;
  start(): Promise<GatewayLifecycleResult>;
  stop(): Promise<GatewayLifecycleResult>;
  restart(): Promise<GatewayLifecycleResult>;
  waitForReady(timeoutMs?: number): Promise<GatewayLifecycleResult>;
  recover(): Promise<GatewayLifecycleResult>;
  prepareForMaintenance(): Promise<GatewayLifecycleResult>;
  resumeAfterMaintenance(): Promise<GatewayLifecycleResult>;
}
