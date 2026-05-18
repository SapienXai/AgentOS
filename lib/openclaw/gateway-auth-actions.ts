export type GatewayAuthRepairAction = {
  apiAction: "generateLocalToken" | "repairDeviceAccess";
  cta: string;
  label: string;
  detail: string;
};

export function resolveGatewayAuthRepairAction(message: string | null | undefined): GatewayAuthRepairAction | null {
  if (isGatewayTokenRepairIssue(message)) {
    return {
      apiAction: "generateLocalToken",
      cta: "Repair token",
      label: "Gateway token",
      detail: "Generate a fresh local Gateway token, restart the Gateway, then retry."
    };
  }

  if (isGatewayDeviceAccessRepairIssue(message)) {
    return {
      apiAction: "repairDeviceAccess",
      cta: "Repair access",
      label: "Gateway access",
      detail: "Approve the local AgentOS device scope request, then retry."
    };
  }

  return null;
}

export function isGatewayDeviceAccessRepairIssue(message: string | null | undefined) {
  const normalizedMessage = message?.trim() ?? "";

  if (!normalizedMessage) {
    return false;
  }

  return (
    /scope upgrade pending approval/i.test(normalizedMessage) ||
    /device token scope mismatch/i.test(normalizedMessage) ||
    /connected_no_operator_scope/i.test(normalizedMessage) ||
    /more scopes than currently approved/i.test(normalizedMessage) ||
    /\bmissing scope:\s*operator\.(?:read|write|admin)\b/i.test(normalizedMessage) ||
    /\bmissing operator\.(?:read|write|admin) scope\b/i.test(normalizedMessage)
  );
}

export function isGatewayTokenRepairIssue(message: string | null | undefined) {
  const normalizedMessage = message?.trim() ?? "";

  if (!normalizedMessage) {
    return false;
  }

  return (
    /\bgateway\b[\s\S]*\btoken mismatch\b/i.test(normalizedMessage) ||
    /\btoken mismatch\b[\s\S]*\bgateway\b/i.test(normalizedMessage) ||
    /\bprovide gateway auth token\b/i.test(normalizedMessage)
  );
}
