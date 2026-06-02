export type AccountLoginTargetStatus = "saved_in_browser_profile";

export type AccountLoginTargetView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string | null;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
  loginUrl: string;
  browserProfileName: string;
  status: AccountLoginTargetStatus;
  statusLabel: string;
  statusTone: "success";
  source: "agentos.connect-account";
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  openCount: number;
};

export type AccountLoginTargetsResponse = {
  ok: boolean;
  generatedAt: string;
  source: "agentos.account-login-targets";
  targets: AccountLoginTargetView[];
  error?: string;
};
