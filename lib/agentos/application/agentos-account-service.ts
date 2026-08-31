import "server-only";

import { readOperatorProfileRecord } from "@/lib/agentos/application/operator-profile-service";
import { readInstanceProtectionState } from "@/lib/security/instance-protection";
import {
  createAgentOsUser,
  createOwnerUserFromInstanceState,
  getAgentOsUserByActorId,
  readAgentOsUserStore,
  setAgentOsUserPassword,
  setAgentOsUserStatus,
  summarizeAgentOsUser,
  updateAgentOsUserOpenClawLinkage,
  updateAgentOsUserProfile,
  updateAgentOsUserRole,
  type AgentOsUser,
  type AgentOsUserProfile,
  type AgentOsUserRole,
  type AgentOsUserStatus
} from "@/lib/security/agentos-user-store";

export async function ensureAgentOsUserStore(env: NodeJS.ProcessEnv = process.env) {
  const existing = await readAgentOsUserStore(env);
  if (existing) return existing;
  const state = await readInstanceProtectionState(env);
  if (!state) return null;
  const profileRecord = await readOperatorProfileRecord(env);
  return createOwnerUserFromInstanceState({
    actorId: state.actorId,
    username: state.username,
    passwordSalt: state.passwordSalt,
    passwordHash: state.passwordHash,
    sessionVersion: state.sessionVersion,
    profile: {
      displayName: profileRecord.profile.fullName,
      email: profileRecord.profile.email,
      avatarDataUrl: profileRecord.profile.avatarDataUrl
    }
  }, env);
}

export async function listAgentOsUsers(env: NodeJS.ProcessEnv = process.env) {
  const store = await ensureAgentOsUserStore(env);
  return store?.users.map(summarizeAgentOsUser) ?? [];
}

export async function getCurrentAgentOsUser(actorId: string, env: NodeJS.ProcessEnv = process.env) {
  await ensureAgentOsUserStore(env);
  return getAgentOsUserByActorId(actorId, env);
}

export async function createManagedAgentOsUser(input: {
  username: string;
  password: string;
  role?: AgentOsUserRole;
  profile?: Partial<AgentOsUserProfile>;
}, env: NodeJS.ProcessEnv = process.env) {
  await ensureAgentOsUserStore(env);
  return createAgentOsUser(input, env);
}

export async function updateManagedAgentOsUserRole(actorId: string, role: AgentOsUserRole, env: NodeJS.ProcessEnv = process.env) {
  return updateAgentOsUserRole(actorId, role, env);
}

export async function updateManagedAgentOsUserStatus(actorId: string, status: AgentOsUserStatus, env: NodeJS.ProcessEnv = process.env) {
  return setAgentOsUserStatus(actorId, status, env);
}

export async function resetManagedAgentOsUserPassword(actorId: string, password: string, env: NodeJS.ProcessEnv = process.env) {
  return setAgentOsUserPassword(actorId, password, env);
}

export async function updateManagedAgentOsUserProfile(actorId: string, profile: AgentOsUserProfile, env: NodeJS.ProcessEnv = process.env) {
  return updateAgentOsUserProfile(actorId, profile, env);
}

export async function updateManagedAgentOsUserOpenClawLinkage(input: {
  actorId: string;
  profileId: string | null;
  role: string | null;
  linkageState: "unlinked" | "pending" | "linked" | "error";
  lastVerifiedAt?: string | null;
}, env: NodeJS.ProcessEnv = process.env) {
  return updateAgentOsUserOpenClawLinkage(input, env);
}

export function toAgentOsUserSummary(user: AgentOsUser) {
  return summarizeAgentOsUser(user);
}
