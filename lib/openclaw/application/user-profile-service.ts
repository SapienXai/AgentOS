import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  OpenClawCommandOptions,
  OpenClawUserListPayload,
  OpenClawUserProfile
} from "@/lib/openclaw/client/types";

export class OpenClawUserProfileCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawUserProfileCapabilityError";
  }
}

export async function listOpenClawUserProfiles(options: OpenClawCommandOptions = {}): Promise<OpenClawUserListPayload> {
  const client = getOpenClawGatewayClient();
  if (!client.listUsers) {
    throw new OpenClawUserProfileCapabilityError("OpenClaw user profiles are unavailable.");
  }
  return client.listUsers(options);
}

export async function setOpenClawUserRole(
  profileId: string,
  role: string | null,
  options: OpenClawCommandOptions = {}
): Promise<OpenClawUserProfile | null> {
  const client = getOpenClawGatewayClient();
  if (!client.setUserRole) {
    throw new OpenClawUserProfileCapabilityError("OpenClaw role management is unavailable.");
  }
  return client.setUserRole(profileId, role, options);
}

export async function listOpenClawGatewayRoleNames(options: OpenClawCommandOptions = {}) {
  const client = getOpenClawGatewayClient();
  return client.listGatewayRoleNames ? client.listGatewayRoleNames(options) : null;
}
