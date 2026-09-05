import type { OpenClawUserProfile } from "@/lib/openclaw/client/types";
import type { AgentOsOpenClawLinkage } from "@/lib/security/agentos-user-store";

/** A human-readable projection of an OpenClaw-owned durable profile. */
export type NativeHumanProfileProjection = {
  profileId: string;
  displayName: string | null;
  emails: string[];
  avatarMime: "image/png" | "image/jpeg" | "image/webp" | null;
  hasAvatar: boolean;
  role: string | null;
};

export type AgentOsOpenClawIdentityState =
  | "SHARED_SERVICE"
  | "METADATA_ASSOCIATED"
  | "NATIVE_VERIFIED"
  | "UNLINKED"
  | "STALE"
  | "UNAVAILABLE"
  | "UNKNOWN";

/**
 * Describes the relationship between an AgentOS actor and an OpenClaw
 * identity. The relationship is deliberately not an authentication proof.
 */
export type AgentOsOpenClawIdentityProjection = {
  connectionAttribution: "shared-service";
  nativeHumanIdentityVerified: false;
  state: AgentOsOpenClawIdentityState;
  associatedProfileId: string | null;
  associatedProfile: NativeHumanProfileProjection | null;
  nativeRole: string | null;
};

export function projectNativeHumanProfile(
  profile: OpenClawUserProfile,
): NativeHumanProfileProjection {
  return {
    profileId: profile.profileId,
    displayName: profile.displayName,
    emails: [...profile.emails],
    avatarMime: profile.avatarMime,
    hasAvatar: profile.hasAvatar,
    role: profile.role,
  };
}

export function projectAgentOsOpenClawIdentity(input: {
  linkage: AgentOsOpenClawLinkage;
  profiles: OpenClawUserProfile[] | null;
}): AgentOsOpenClawIdentityProjection {
  const profileId = input.linkage.profileId;
  const profile = profileId && input.profiles
    ? input.profiles.find((candidate) => candidate.profileId === profileId) ?? null
    : null;

  let state: AgentOsOpenClawIdentityState;
  if (!profileId) {
    state = input.profiles ? "UNLINKED" : "UNAVAILABLE";
  } else if (!input.profiles) {
    state = "UNKNOWN";
  } else if (!profile) {
    state = "STALE";
  } else {
    // The current AgentOS deployment uses one shared native Gateway service
    // identity. An association is useful metadata, never native verification.
    state = "METADATA_ASSOCIATED";
  }

  return {
    connectionAttribution: "shared-service",
    nativeHumanIdentityVerified: false,
    state,
    associatedProfileId: profileId,
    associatedProfile: profile ? projectNativeHumanProfile(profile) : null,
    nativeRole: profile?.role ?? null,
  };
}
