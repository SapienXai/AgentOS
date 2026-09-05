import "server-only";

import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawSessionVisibility
} from "@/lib/openclaw/client/types";

export type NativeSessionOwnerTarget = {
  type: "agent" | "human";
  id: string;
};

export type SessionOwnerReconciliation = {
  verified: boolean;
  owner: { type: "agent" | "human" | "system"; id?: string; label?: string } | null;
};

export type SessionMemberReconciliation = {
  verified: boolean;
  present: boolean | null;
};

export type SessionVisibilityReconciliation = {
  verified: boolean;
  visibility: OpenClawSessionVisibility | null;
};

/**
 * Reconciles a possibly-delivered sessions.assignOwner mutation from the
 * native collaboration read. This intentionally never retries the mutation.
 */
export async function reconcileNativeSessionOwnerMutation(input: {
  adapter: OpenClawAdapter;
  sessionKey: string;
  target: NativeSessionOwnerTarget;
  timeoutMs: number;
}): Promise<SessionOwnerReconciliation> {
  if (!input.adapter.listSessionMembers) {
    return { verified: false, owner: null };
  }
  try {
    const detail = await input.adapter.listSessionMembers(
      { sessionKey: input.sessionKey },
      { timeoutMs: input.timeoutMs },
    );
    const ownerCandidate = detail.owner
      ? "actor" in detail.owner && isRecord(detail.owner.actor)
        ? detail.owner.actor
        : detail.owner
      : null;
    const owner = isRecord(ownerCandidate) && isSessionActorType(ownerCandidate.type)
      ? {
          type: ownerCandidate.type,
          ...(typeof ownerCandidate.id === "string" ? { id: ownerCandidate.id } : {}),
          ...(typeof ownerCandidate.label === "string" ? { label: ownerCandidate.label } : {})
        }
      : null;
    return {
      verified: owner?.type === input.target.type && owner.id === input.target.id,
      owner,
    };
  } catch {
    return { verified: false, owner: null };
  }
}

/**
 * Reconciles a possibly-delivered participant mutation from native membership
 * state. This intentionally performs one read and never retries the write.
 */
export async function reconcileNativeSessionMemberMutation(input: {
  adapter: OpenClawAdapter;
  sessionKey: string;
  identityId: string;
  expectedPresent: boolean;
  timeoutMs: number;
}): Promise<SessionMemberReconciliation> {
  if (!input.adapter.listSessionMembers) {
    return { verified: false, present: null };
  }
  try {
    const detail = await input.adapter.listSessionMembers(
      { sessionKey: input.sessionKey },
      { timeoutMs: input.timeoutMs },
    );
    const present = detail.members.some((member) => member.identityId === input.identityId);
    return { verified: present === input.expectedPresent, present };
  } catch {
    return { verified: false, present: null };
  }
}

/**
 * Reconciles a possibly-delivered visibility mutation from the native session
 * record. Visibility is not duplicated in AgentOS state.
 */
export async function reconcileNativeSessionVisibilityMutation(input: {
  adapter: OpenClawAdapter;
  sessionKey: string;
  expectedVisibility: OpenClawSessionVisibility;
  timeoutMs: number;
}): Promise<SessionVisibilityReconciliation> {
  try {
    const payload = await input.adapter.describeSession(
      { key: input.sessionKey },
      { timeoutMs: input.timeoutMs },
    );
    const row = isRecord(payload.session) ? payload.session : payload;
    const visibility = isSessionVisibility(row.visibility) ? row.visibility : null;
    return {
      verified: visibility === input.expectedVisibility,
      visibility,
    };
  } catch {
    return { verified: false, visibility: null };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionVisibility(value: unknown): value is OpenClawSessionVisibility {
  return value === "shared" || value === "read-only" || value === "suggest" || value === "draft";
}

function isSessionActorType(value: unknown): value is "agent" | "human" | "system" {
  return value === "agent" || value === "human" || value === "system";
}
