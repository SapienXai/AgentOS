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

export type BrowserActionTargetMetadata = {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
};

export type TrustedBrowserActionContext = {
  targetId: string;
  url: string;
  refs: Record<string, BrowserActionTargetMetadata>;
  pageSignals?: string[];
  dialogMessages?: string[];
  semanticSnapshotGeneration?: string;
};

const accountAdminPatterns = [
  /\b(change|reset|update|remove|disable|enable)\b.{0,40}\b(password|passcode|mfa|2fa|two-factor|authenticator|security|recovery email|recovery phone)\b/i,
  /\b(create|generate|rotate|revoke)\b.{0,40}\b(api key|access token|secret)\b/i,
  /\b(change|grant|revoke|remove)\b.{0,40}\b(permission|role|admin|owner)\b/i,
  /\b(delete|close)\b.{0,32}\b(account|workspace|organization)\b/i,
  /\b(account|security|privacy|recovery)\s+settings?\b/i
];

const transactionPatterns = [
  /\b(purchase|buy|checkout|pay|payment|transfer money|wire transfer|place an order|subscribe|upgrade plan)\b/i,
  /\b(confirm|submit)\b.{0,32}\b(order|payment|purchase|checkout)\b/i
];

const publishPatterns = [
  /\b(publish|post|tweet|reply|comment|send|email|message|submit)\b.{0,40}\b(public|publicly|everyone|customer|user|content|post|comment|reply|message|email|tweet)?\b/i,
  /\b(create|edit)\b.{0,32}\b(listing|release|announcement|article|issue|pull request)\b/i
];

/**
 * Classify only the coarse action category that the policy can defend.
 *
 * A ref-based mutation is unknown unless a trusted OpenClaw snapshot for the
 * same tab and page is supplied. `actionDescription` is intentionally not
 * used for authorization: it is model-controlled and is only retained in the
 * public input for compatibility with older callers.
 */
export function classifyBrowserAction(input: {
  action?: string | null;
  actionDescription?: string;
  actionKind?: string | null;
  serviceId?: BrowserServiceId | null;
  actionRef?: string | null;
  actionRefs?: string[];
  submit?: boolean;
  key?: string | null;
  dialogAccepted?: boolean;
  waitPredicate?: string | null;
  trustedContext?: TrustedBrowserActionContext;
  observedContext?: TrustedBrowserActionContext;
}): BrowserActionCapability {
  const action = input.action?.trim().toLowerCase() ?? "";
  const kind = input.actionKind?.trim().toLowerCase() ?? "";
  if (action === "wait" && input.waitPredicate?.trim()) return "account_admin";
  if (["tabs", "snapshot", "screenshot", "console", "wait"].includes(action || kind)) return "read";
  if (["open", "navigate"].includes(action || kind)) return "read";
  if (kind === "evaluate" || (action === "act" && kind === "close")) return "account_admin";
  if (action === "dialog" && input.dialogAccepted === false) return "interact";
  if (["hover", "scrollintoview", "wait"].includes(kind)) return "interact";
  if (kind === "press" && isSafePressKey(input.key)) return "interact";

  const trusted = input.trustedContext;
  const observed = input.observedContext;
  if (!trusted || !observed || !samePage(trusted, observed)) return "unknown";

  const submitLike =
    input.submit === true ||
    (kind === "press" && isEnterKey(input.key)) ||
    (action === "dialog" && input.dialogAccepted === true);
  const refs = [...(input.actionRefs ?? []), input.actionRef]
    .filter((ref): ref is string => Boolean(ref?.trim()))
    .map((ref) => ref.trim())
    .filter((ref, index, values) => values.indexOf(ref) === index);
  if (refs.length > 0) {
    if (refs.some((ref) => !trusted.refs[ref] || !observed.refs[ref] || !sameTarget(trusted.refs[ref], observed.refs[ref]))) {
      return "unknown";
    }
    const targetRisk = highestRisk(refs.map((ref) => classifyTargetRisk(targetText(trusted.refs[ref]), input.serviceId)));
    if (targetRisk !== "interact" && trusted.semanticSnapshotGeneration !== observed.semanticSnapshotGeneration) {
      return "unknown";
    }
    if (submitLike) {
      if (trusted.semanticSnapshotGeneration !== observed.semanticSnapshotGeneration) return "unknown";
      return highestRisk([
        targetRisk,
        ...(trusted.pageSignals ?? []).map((value) => classifyTargetRisk(value, input.serviceId)),
        ...(trusted.dialogMessages ?? []).map((value) => classifyTargetRisk(value, input.serviceId))
      ]);
    }
    return targetRisk;
  }

  if (submitLike) {
    if (trusted.semanticSnapshotGeneration !== observed.semanticSnapshotGeneration) return "unknown";
    return highestRisk([
      ...(trusted.pageSignals ?? []).map((value) => classifyTargetRisk(value, input.serviceId)),
      ...(trusted.dialogMessages ?? []).map((value) => classifyTargetRisk(value, input.serviceId))
    ]);
  }

  if (["click", "clickcoords", "click-coords", "drag", "fill", "press", "select", "type"].includes(kind)) {
    return "interact";
  }
  return "unknown";
}

/**
 * Evaluate an account-bound browser action. When no capability grant is
 * provided, the old description-only contract remains available for legacy
 * callers, but it never grants an authenticated sensitive action implicitly.
 */
export function evaluateBrowserActionPolicy(input: {
  actionDescription?: string;
  action?: string | null;
  actionKind?: string | null;
  serviceId?: BrowserServiceId | null;
  actionRef?: string | null;
  actionRefs?: string[];
  submit?: boolean;
  key?: string | null;
  dialogAccepted?: boolean;
  waitPredicate?: string | null;
  trustedContext?: TrustedBrowserActionContext;
  observedContext?: TrustedBrowserActionContext;
  grantedCapabilities?: BrowserAccountCapability[];
  approvalPolicy?: BrowserAccountApprovalPolicy;
  approvalInfrastructureAvailable: boolean;
}): BrowserActionDecision {
  const capability = classifyBrowserAction(input);
  const hasCapabilityGrant = input.grantedCapabilities !== undefined;
  const granted = new Set(input.grantedCapabilities ?? []);

  if (!hasCapabilityGrant) {
    if (capability === "read") {
      return {
        capability,
        risk: "standard",
        decision: "allow",
        reason: "The requested browser action is read-only."
      };
    }
    return input.approvalInfrastructureAvailable
      ? {
          capability,
          risk: "high",
          decision: "require_approval",
          reason: "A mutating authenticated-browser action has no explicit account grant and requires human approval."
        }
      : {
          capability,
          risk: "high",
          decision: "block",
          reason: "A mutating authenticated-browser action is blocked because no task-bound approval contract is available."
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

function samePage(current: TrustedBrowserActionContext, observed: TrustedBrowserActionContext) {
  return current.targetId === observed.targetId && current.url === observed.url;
}

function sameTarget(current: BrowserActionTargetMetadata, observed: BrowserActionTargetMetadata) {
  return targetText(current) === targetText(observed);
}

function targetText(target: BrowserActionTargetMetadata) {
  return [target.role, target.name, target.value, target.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
}

function classifyTargetRisk(value: string, serviceId?: BrowserServiceId | null): BrowserActionCapability {
  if (!value) return "unknown";
  if (accountAdminPatterns.some((pattern) => pattern.test(value))) return "account_admin";
  if (serviceId === "github" && /\b(merge|approve|delete|close)\b/i.test(value)) return "account_admin";
  if (transactionPatterns.some((pattern) => pattern.test(value))) return "transact";
  if (serviceId === "amazon" && /\b(buy now|proceed to checkout|checkout|place (?:your )?order|purchase|pay|payment|subscribe)\b/i.test(value)) {
    return "transact";
  }
  if (publishPatterns.some((pattern) => pattern.test(value))) return "publish";
  if (serviceId === "x" && /\b(tweet|post|reply|quote|repost|direct message|dm|send)\b/i.test(value)) return "publish";
  if (serviceId === "producthunt" && /\b(launch|comment|upvote|submit)\b/i.test(value)) return "publish";
  if (serviceId === "github" && /\b(create|open|comment|edit)\b.{0,32}\b(issue|pull request|release)\b|\b(publish|release)\b/i.test(value)) {
    return "publish";
  }
  return "interact";
}

function highestRisk(values: BrowserActionCapability[]) {
  if (values.includes("account_admin")) return "account_admin" as const;
  if (values.includes("transact")) return "transact" as const;
  if (values.includes("publish")) return "publish" as const;
  if (values.includes("unknown")) return "unknown" as const;
  return "interact" as const;
}

function isEnterKey(value?: string | null) {
  return ["enter", "return", "numpadenter"].includes(value?.trim().toLowerCase().replaceAll(" ", "") ?? "");
}

function isSafePressKey(value?: string | null) {
  return ["arrowdown", "arrowleft", "arrowright", "arrowup", "escape", "esc", "tab", "pagedown", "pageup", "home", "end"]
    .includes(value?.trim().toLowerCase().replaceAll(" ", "") ?? "");
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
