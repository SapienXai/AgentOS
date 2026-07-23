import type {
  BrowserAccountProviderId,
  BrowserAuthenticationStatus,
  BrowserProviderCapabilities
} from "@/lib/agentos/browser-accounts/types";

export type BrowserProviderProfile = {
  provider: BrowserAccountProviderId;
  externalProfileId: string | null;
  browserProfileId: string;
  persistent: boolean;
  source: "native-openclaw" | "self-hosted-worker" | "optional-adapter";
};

export type BrowserProviderSession = {
  sessionId: string;
  browserProfileId: string;
  state: "active" | "stopped";
  /**
   * Private runtime-only transport. Callers must never serialize or persist it.
   * The self-hosted adapter only returns a loopback endpoint.
   */
  runtimeConnection?: {
    kind: "loopback-cdp";
    cdpUrl: string;
  };
};

export type LiveViewCapability = {
  capabilityId: string;
  expiresAt: string;
  oneTime: true;
};

export type ScopedCdpCapability = {
  capabilityId: string;
  expiresAt: string;
};

export interface BrowserProvider {
  getCapabilities(): Promise<BrowserProviderCapabilities>;
  createProfile(input: {
    browserProfileId: string;
  }): Promise<BrowserProviderProfile>;
  startSession(input: {
    browserProfileId: string;
    initialUrl?: string;
  }): Promise<BrowserProviderSession>;
  getLiveView(input: {
    sessionId: string;
  }): Promise<LiveViewCapability>;
  getCdpEndpoint(input: {
    sessionId: string;
  }): Promise<ScopedCdpCapability>;
  verifyAuthentication(input: {
    sessionId: string;
    allowedDomains: string[];
  }): Promise<{ status: BrowserAuthenticationStatus; verifiedAt: string | null }>;
  persistProfile(input: {
    sessionId: string;
    browserProfileId: string;
  }): Promise<BrowserProviderProfile>;
  stopSession(input: {
    sessionId: string;
  }): Promise<void>;
  revokeProfile(input: {
    browserProfileId: string;
  }): Promise<void>;
}
