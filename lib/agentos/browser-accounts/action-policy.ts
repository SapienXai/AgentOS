import type {
  BrowserAccountApprovalPolicy,
  BrowserAccountCapability,
  BrowserServiceId
} from "@/lib/agentos/browser-accounts/types";

export type BrowserActionCapability =
  | "read"
  | "interact"
  | "publish"
  | "transact"
  | "account_admin"
  | "unknown";

export type BrowserActionDecision = {
  capability: BrowserActionCapability;
  risk: "standard" | "high";
  decision: "allow" | "require_approval" | "block";
  reason: string;
};

const accountAdminPatterns = [
  /\b(change|reset|update|remove|disable|enable)\b.{0,40}\b(password|passcode|mfa|2fa|two-factor|authenticator|security|recovery email|recovery phone)\b/i,
  /\b(create|generate|rotate|revoke)\b.{0,40}\b(api key|access token|secret)\b/i,
  /\b(change|grant|revoke|remove)\b.{0,40}\b(permission|role|admin|owner)\b/i,
  /\b(delete|close)\b.{0,32}\b(account|workspace|organization)\b/i
];

const transactionPatterns = [
  /\b(purchase|buy|checkout|pay|payment|transfer money|wire transfer|place an order|subscribe|upgrade plan)\b/i,
  /\b(confirm|submit)\b.{0,32}\b(order|payment|purchase|checkout)\b/i
];

const publishPatterns = [
  /\b(publish|post|tweet|reply|comment|send|email|message|submit)\b.{0,40}\b(public|publicly|everyone|customer|user|content|post|comment|reply|message|email|tweet)?\b/i,
  /\b(create|edit)\b.{0,32}\b(listing|release|announcement|article|issue|pull request)\b/i
];

const legacySensitivePatterns = [
  ...accountAdminPatterns,
  ...transactionPatterns,
  ...publishPatterns,
  /\b(bulk delete|delete all|mass delete)\b/i,
  /\b(export|download)\b.{0,32}\b(customer|personal|private|sensitive|account)\b/i
];

/**
 * Classify only the coarse action category that the policy can defend. This
 * intentionally does not inspect arbitrary page DOM or guess from CSS refs.
 */
export function classifyBrowserAction(input: {
  actionDescription: string;
  actionKind?: string | null;
  serviceId?: BrowserServiceId | null;
}): BrowserActionCapability {
  const description = input.actionDescription.trim();
  if (accountAdminPatterns.some((pattern) => pattern.test(description))) return "account_admin";
  if (transactionPatterns.some((pattern) => pattern.test(description))) return "transact";
  if (publishPatterns.some((pattern) => pattern.test(description))) return "publish";

  const kind = input.actionKind?.trim().toLowerCase() ?? "";
  if (["tabs", "snapshot", "screenshot", "console", "wait"].includes(kind)) return "read";
  if (["click", "type", "press", "hover", "select", "fill", "scrollintoview", "drag", "dialog", "open", "navigate"].includes(kind)) {
    return "interact";
  }

  // Service-specific rules have a deliberate extension point without making
  // the first version depend on brittle per-site DOM heuristics.
  void input.serviceId;
  return "unknown";
}

/**
 * Evaluate an account-bound browser action. When no capability grant is
 * provided, the old description-only contract remains available for legacy
 * callers, but it never grants an authenticated sensitive action implicitly.
 */
export function evaluateBrowserActionPolicy(input: {
  actionDescription: string;
  actionKind?: string | null;
  serviceId?: BrowserServiceId | null;
  grantedCapabilities?: BrowserAccountCapability[];
  approvalPolicy?: BrowserAccountApprovalPolicy;
  approvalInfrastructureAvailable: boolean;
}): BrowserActionDecision {
  const capability = classifyBrowserAction(input);
  const hasCapabilityGrant = input.grantedCapabilities !== undefined;
  const granted = new Set(input.grantedCapabilities ?? []);

  if (!hasCapabilityGrant) {
    const sensitive = legacySensitivePatterns.some((pattern) => pattern.test(input.actionDescription.trim()));
    if (!sensitive) {
      return {
        capability: capability === "unknown" ? "interact" : capability,
        risk: "standard",
        decision: "allow",
        reason: "The requested browser action does not match a protected sensitive-action category."
      };
    }
    return input.approvalInfrastructureAvailable
      ? {
          capability: capability === "unknown" ? "account_admin" : capability,
          risk: "high",
          decision: "require_approval",
          reason: "Sensitive authenticated-browser actions require explicit human approval."
        }
      : {
          capability: capability === "unknown" ? "account_admin" : capability,
          risk: "high",
          decision: "block",
          reason: "Sensitive authenticated-browser actions are blocked because no task-bound approval contract is available."
        };
  }

  if (capability === "read") {
    return granted.has("read")
      ? allow("read", "Read-only browser access is granted.")
      : block("read", "This agent does not have read access to the browser account.");
  }

  if (capability === "account_admin") {
    return block("account_admin", "Account administration is blocked by the Secure Browser Account policy.");
  }

  if (capability === "transact") {
    if (!granted.has("transact")) {
      return block("transact", "Transaction capability is not granted for this browser account identity.");
    }
    return input.approvalInfrastructureAvailable
      ? requireApproval("transact", "Commercial or money-moving browser actions require explicit human approval.")
      : block("transact", "Transaction approval is unavailable, so the action is blocked.");
  }

  if (capability === "publish") {
    if (!granted.has("publish")) {
      return block("publish", "Publish capability is not granted for this browser account identity.");
    }
    if (input.approvalPolicy === "require_approval") {
      return input.approvalInfrastructureAvailable
        ? requireApproval("publish", "This account requires approval before externally visible content is published.")
        : block("publish", "Publish approval is unavailable, so the action is blocked.");
    }
    return allow("publish", "Publish capability is explicitly granted for this browser account identity.");
  }

  if (capability === "interact") {
    return granted.has("interact")
      ? allow("interact", "Ordinary browser interaction capability is granted.")
      : block("interact", "Interaction capability is not granted for this browser account identity.");
  }

  return input.approvalInfrastructureAvailable
    ? requireApproval("unknown", "The browser action could not be classified safely; explicit approval is required.")
    : block("unknown", "The browser action could not be classified safely and approval is unavailable.");
}

function allow(capability: BrowserActionCapability, reason: string): BrowserActionDecision {
  return { capability, risk: "standard", decision: "allow", reason };
}

function requireApproval(capability: BrowserActionCapability, reason: string): BrowserActionDecision {
  return { capability, risk: "high", decision: "require_approval", reason };
}

function block(capability: BrowserActionCapability, reason: string): BrowserActionDecision {
  return { capability, risk: "high", decision: "block", reason };
}
