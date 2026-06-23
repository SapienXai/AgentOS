import type { OpenClawGatewayCompatibilityOperationId } from "@/lib/openclaw/client/gateway-compatibility";
import type { OpenClawCompatibilityReport } from "@/lib/openclaw/compat/types";

export type OpenClawGatewayProductSurfaceStatus =
  | "native"
  | "scope-required"
  | "degraded"
  | "unsupported"
  | "upstream-needed"
  | "recovery-cli"
  | "unknown";

export type OpenClawGatewayProductSurfaceProbeStatus = "passed" | "failed" | "skipped";

export type OpenClawGatewayProductSurfaceProbe = {
  method: string;
  status: OpenClawGatewayProductSurfaceProbeStatus;
  summary: string;
  keys: string[];
  itemCount: number | null;
  error: string | null;
};

export type OpenClawGatewayProductSurfaceActionKind =
  | "open-product-page"
  | "run-native-probe"
  | "retry-native-probe"
  | "view-runtime-inbox"
  | "show-scope"
  | "show-degraded"
  | "show-upstream"
  | "open-recovery"
  | "native-read"
  | "native-mutation";

export type OpenClawGatewayProductSurfaceAction = {
  id: string;
  label: string;
  kind: OpenClawGatewayProductSurfaceActionKind;
  enabled: boolean;
  href: string | null;
  method: string | null;
  reason: string;
  recovery: string;
  dangerous?: boolean;
};

export type OpenClawGatewayProductSurfaceInboxSeverity =
  | "info"
  | "warning"
  | "action_required"
  | "blocked";

export type OpenClawGatewayProductSurfaceInboxItem = {
  id: string;
  surfaceId: string;
  title: string;
  message: string;
  severity: OpenClawGatewayProductSurfaceInboxSeverity;
  status: OpenClawGatewayProductSurfaceStatus;
  method: string | null;
  actionLabel: string;
  actionHref: string;
  recovery: string;
  recoveryHref: string;
  createdAt: string;
  source: "gateway-surface";
};

export type OpenClawGatewayProductSurface = {
  id: string;
  label: string;
  category: string;
  operations: OpenClawGatewayCompatibilityOperationId[];
  methods: string[];
  events: string[];
  scopes: string[];
  currentAgentOsPath: string;
  uiDestination: string;
  testTarget: string;
  productHref: string | null;
  primaryActionLabel: string;
  primaryActionHref: string;
  recoveryHref: string;
  runtimeInboxHref: string;
  agentOsRoutes: string[];
  agentOsServices: string[];
  agentOsComponents: string[];
  lastCheckedAt: string;
  status: OpenClawGatewayProductSurfaceStatus;
  statusLabel: string;
  reason: string;
  recovery: string;
  nativeMethodCount: number;
  degradedOperationCount: number;
  unsupportedOperationCount: number;
  cliFallbackOperationCount: number;
  probes: OpenClawGatewayProductSurfaceProbe[];
  actions: OpenClawGatewayProductSurfaceAction[];
};

export type OpenClawGatewayGoldenPathStepStatus = "ready" | "degraded" | "blocked" | "unknown";

export type OpenClawGatewayGoldenPathStep = {
  id: string;
  label: string;
  surfaceIds: string[];
  status: OpenClawGatewayGoldenPathStepStatus;
  statusLabel: string;
  reason: string;
  actionLabel: string;
  actionHref: string;
  recoveryHref: string;
};

export type OpenClawGatewayProductSurfaceSnapshot = {
  generatedAt: string;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
  capabilitySource: OpenClawCompatibilityReport["gateway"]["capabilitySource"];
  nativeCoverageLabel: string;
  nativeCoveragePercent: number;
  cliForced: boolean;
  fallbackActiveCount: number;
  degradedSurfaceCount: number;
  unsupportedSurfaceCount: number;
  scopeRequiredSurfaceCount: number;
  actionableItemCount: number;
  inboxItems: OpenClawGatewayProductSurfaceInboxItem[];
  goldenPathSteps: OpenClawGatewayGoldenPathStep[];
  surfaces: OpenClawGatewayProductSurface[];
};
