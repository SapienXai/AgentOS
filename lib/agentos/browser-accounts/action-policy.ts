export type BrowserActionDecision = {
  risk: "standard" | "high";
  decision: "allow" | "require_approval" | "block";
  reason: string;
};

const sensitiveActionPatterns = [
  /\b(change|reset|update)\b.{0,32}\b(password|passcode)\b/i,
  /\b(disable|remove|change|reset)\b.{0,32}\b(mfa|2fa|two-factor|authenticator)\b/i,
  /\b(change|update)\b.{0,32}\b(recovery email|recovery phone)\b/i,
  /\b(create|generate|rotate)\b.{0,32}\b(api key|access token)\b/i,
  /\b(purchase|buy|checkout|pay|payment|transfer money|wire transfer)\b/i,
  /\b(delete|close)\b.{0,24}\b(account|workspace|organization)\b/i,
  /\b(bulk delete|delete all|mass delete)\b/i,
  /\b(change|grant|revoke|remove)\b.{0,32}\b(permission|role|admin)\b/i,
  /\b(export|download)\b.{0,32}\b(customer|personal|private|sensitive|account)\b/i,
  /\b(send|publish|post|message|email)\b.{0,32}\b(to|public|everyone|customer|user)\b/i
];

export function evaluateBrowserActionPolicy(input: {
  actionDescription: string;
  approvalInfrastructureAvailable: boolean;
}): BrowserActionDecision {
  const description = input.actionDescription.trim();
  const sensitive = sensitiveActionPatterns.some((pattern) => pattern.test(description));

  if (!sensitive) {
    return {
      risk: "standard",
      decision: "allow",
      reason: "The requested browser action does not match a protected sensitive-action category."
    };
  }

  if (input.approvalInfrastructureAvailable) {
    return {
      risk: "high",
      decision: "require_approval",
      reason: "Sensitive authenticated-browser actions require explicit human approval."
    };
  }

  return {
    risk: "high",
    decision: "block",
    reason: "Sensitive authenticated-browser actions are blocked because no task-bound approval contract is available."
  };
}
