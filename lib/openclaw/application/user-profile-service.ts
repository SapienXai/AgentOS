import "server-only";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  executeNativeMutation,
  type NativeMutationExecution
} from "@/lib/openclaw/application/native-mutation-service";
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
    throw new NativeGatewayError("OpenClaw role management is unavailable.", { kind: "unsupported" });
  }
  return client.setUserRole(profileId, role, options);
}

/**
 * Reconciles a possibly-delivered native role mutation from the live profile
 * directory. This performs no second mutation attempt.
 */
export async function reconcileOpenClawUserRoleMutation(input: {
  profileId: string;
  expectedRole: string | null;
  beforeRole?: string | null;
  options?: OpenClawCommandOptions;
}): Promise<{ verified: boolean; changedAndVerified: boolean; profile: OpenClawUserProfile | null }> {
  try {
    const profiles = await listOpenClawUserProfiles(input.options);
    const profile = profiles.profiles.find((candidate) => candidate.profileId === input.profileId) ?? null;
    const verified = profile?.role === input.expectedRole;
    return {
      verified,
      changedAndVerified: verified && input.beforeRole !== undefined && input.beforeRole !== input.expectedRole,
      profile
    };
  } catch {
    return { verified: false, changedAndVerified: false, profile: null };
  }
}

export async function executeOpenClawUserRoleMutation(input: {
  profileId: string;
  role: string | null;
  beforeRole: string | null | undefined;
  options?: OpenClawCommandOptions;
}): Promise<NativeMutationExecution<OpenClawUserProfile | null>> {
  const client = getOpenClawGatewayClient();
  if (!client.setUserRole) {
    return executeNativeMutation({
      operation: "users.setRole",
      mutate: async () => {
        throw new NativeGatewayError("OpenClaw role management is unavailable.", { kind: "unsupported" });
      }
    });
  }

  return executeNativeMutation({
    operation: "users.setRole",
    mutate: () => client.setUserRole!(input.profileId, input.role, input.options),
    reconcile: async () => {
      const reconciliation = await reconcileOpenClawUserRoleMutation({
        profileId: input.profileId,
        expectedRole: input.role,
        beforeRole: input.beforeRole,
        options: input.options
      });
      return {
        verified: reconciliation.changedAndVerified,
        result: reconciliation.profile
      };
    }
  });
}

export async function listOpenClawGatewayRoleNames(options: OpenClawCommandOptions = {}) {
  const client = getOpenClawGatewayClient();
  return client.listGatewayRoleNames ? client.listGatewayRoleNames(options) : null;
}
