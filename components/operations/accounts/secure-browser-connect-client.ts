"use client";

export type SecureBrowserAccountView = {
  id: string;
  provider: string;
  serviceName: string;
  primaryDomain: string;
  ownerUserId: string;
  workspaceId: string;
  browserProfileId: string;
  allowedAgentIds: string[];
  allowedDomains: string[];
  connectionStatus: string;
  verificationSource: string;
  sessionState: string;
  concurrencyLease: {
    holderTaskId: string;
    holderAgentId: string;
    heartbeatAt: string;
    expiresAt: string;
    fencingToken: number;
  } | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  source: string;
};

export type SecureBrowserCapabilityView = {
  provider: string;
  persistentProfiles: "supported" | "unsupported" | "unknown";
  liveView: "supported" | "unsupported" | "unknown";
  humanTakeover: "supported" | "unsupported" | "unknown";
  typedTaskDispatch: "supported" | "unsupported" | "unknown";
  reason: string | null;
};

export type SecureBrowserConnectInput = {
  serviceName: string;
  primaryDomain: string;
  allowedAgentIds: string[];
};

export async function startSecureLiveView(
  accountId: string,
  workspaceId: string
) {
  const response = await fetch("/api/accounts/browser-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "start-live-view",
      accountId,
      workspaceId
    })
  });
  const payload = await response.json().catch(() => null) as {
    result?: { launchUrl?: string };
    error?: string;
  } | null;
  const launchUrl = payload?.result?.launchUrl;
  if (!response.ok || !launchUrl) {
    throw new Error(
      payload?.error ?? "Unable to start Secure Browser Live View."
    );
  }
  return launchUrl;
}

export function prepareSecureBrowserPopup(popup: Window) {
  const document = popup.document;
  document.title = "Starting Secure Browser";
  document.documentElement.style.colorScheme = "dark";
  document.body.replaceChildren();
  Object.assign(document.body.style, {
    alignItems: "center",
    background: "#070b13",
    color: "#dbe4f0",
    display: "flex",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    justifyContent: "center",
    margin: "0",
    minHeight: "100vh"
  });

  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.style.maxWidth = "28rem";
  status.style.padding = "2rem";
  status.style.textAlign = "center";
  const title = document.createElement("h1");
  title.textContent = "Starting secure browser…";
  title.style.fontSize = "1rem";
  title.style.margin = "0";

  const detail = document.createElement("p");
  detail.textContent =
    "Preparing the isolated Chromium profile and private Live View. This can take up to 90 seconds on Railway.";
  detail.style.color = "#94a3b8";
  detail.style.fontSize = "0.8rem";
  detail.style.lineHeight = "1.5";
  detail.style.margin = "0.75rem 0 0";

  status.append(title, detail);
  document.body.append(status);
}
