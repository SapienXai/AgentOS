export type OpenClawBrowserStatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted"
  | "purple";

export type OpenClawBrowserDriver = "openclaw" | "existing-session" | "extension";
export type OpenClawBrowserTransport = "cdp" | "chrome-mcp" | "extension";

export type OpenClawBrowserProfileView = {
  name: string;
  driver: OpenClawBrowserDriver;
  driverLabel: string;
  transport: OpenClawBrowserTransport | null;
  transportLabel: string;
  cdpPort: number | null;
  cdpUrl: string | null;
  color: string;
  running: boolean;
  statusLabel: string;
  statusTone: OpenClawBrowserStatusTone;
  tabCount: number;
  isDefault: boolean;
  isRemote: boolean;
  missingFromConfig: boolean;
  reconcileReason: string | null;
};

export type OpenClawBrowserTabView = {
  tabId: string | null;
  targetId: string | null;
  suggestedTargetId: string | null;
  label: string | null;
  title: string | null;
  url: string | null;
};

export type OpenClawBrowserProfilesResponse = {
  ok: boolean;
  generatedAt: string;
  source: "openclaw.browser.request";
  profiles: OpenClawBrowserProfileView[];
  error?: string;
};

export type OpenClawBrowserProfileMutationResponse = {
  ok: boolean;
  generatedAt: string;
  source: "openclaw.browser.request";
  profile?: OpenClawBrowserProfileView;
  tab?: OpenClawBrowserTabView;
  error?: string;
};
