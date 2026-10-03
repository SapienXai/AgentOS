import type { AgentOsApplicationUpdateOwner, AgentOsDesktopBundle } from "@/lib/agentos/deployment-capabilities";

export type AgentOsProductUpdateAvailability = "unknown" | "unavailable" | "up-to-date" | "available";
export type AgentOsProductUpdateEvidence = "unknown" | "fresh" | "stale" | "unavailable";
export type AgentOsProductUpdateOperationState =
  | "requested"
  | "running"
  | "restart-required"
  | "verifying"
  | "succeeded"
  | "failed"
  | "unknown";
export type AgentOsProductUpdatePhase = "checking" | "download" | "install" | "relaunch" | "verify";
export type AgentOsProductUpdateAction =
  | "native-install"
  | "release-guidance"
  | "package-manager-guidance"
  | "deployment-guidance"
  | "source-guidance"
  | "unsupported";

export type AgentOsNativeUpdateCheck = {
  schemaVersion: 1;
  checkId: string;
  launchId: string;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseIdentity: string | null;
  checkedAt: string;
  status: "available" | "up-to-date" | "unavailable";
  error: string | null;
};

export type AgentOsProductUpdateReceipt = {
  schemaVersion: 1;
  operationId: string;
  requestId: string;
  actorId: string;
  authenticationMethod: string;
  owner: "desktop";
  launchId: string;
  currentVersion: string;
  targetVersion: string;
  nativeCheckId: string;
  releaseIdentity: string;
  state: AgentOsProductUpdateOperationState;
  phase: AgentOsProductUpdatePhase | null;
  progress: number | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  failure: string | null;
  newLaunchId: string | null;
  nativeVersion: string | null;
  serverVersion: string | null;
  verification: "pending" | "verified" | "mismatch" | "unknown";
};

export type AgentOsProductUpdatePublicOperation = Omit<
  AgentOsProductUpdateReceipt,
  "actorId" | "authenticationMethod" | "requestId" | "releaseIdentity" | "nativeCheckId"
>;

export type AgentOsProductUpdateSnapshot = {
  currentVersion: string;
  buildIdentity: string | null;
  latestVersion: string | null;
  sourceId: string | null;
  checkedAt: string | null;
  evidence: AgentOsProductUpdateEvidence;
  availability: AgentOsProductUpdateAvailability;
  checkError: string | null;
  owner: AgentOsApplicationUpdateOwner;
  desktopBundle: AgentOsDesktopBundle;
  packageManager: "npm" | "pnpm" | null;
  ownerReason: string;
  action: AgentOsProductUpdateAction;
  canManageUpdates: boolean;
  canInstall: boolean;
  releaseUrl: string | null;
  cliAssetAvailable: boolean | null;
  operation: AgentOsProductUpdatePublicOperation | null;
  storageReady: boolean;
};
