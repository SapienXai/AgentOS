import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeSessionOwnership } from "@/lib/openclaw/domains/native-work-model";
import type {
  NativeWorkExecutionProjection,
  SessionOwnershipProjection
} from "@/lib/openclaw/types";

export type NativeSessionOwnershipDetail = {
  ownership: SessionOwnershipProjection;
  state: "available" | "unavailable";
};

/**
 * Hydrates collaboration detail for one selected session only. The session
 * row remains the summary source for the root snapshot; membership and
 * evidence are never fanned out across the session list.
 */
export async function loadNativeSessionOwnershipDetail(input: {
  execution: NativeWorkExecutionProjection;
  adapter: OpenClawAdapter;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<NativeSessionOwnershipDetail> {
  const summary = input.execution.ownership;
  const baseRow = {
    createdActor: summary.createdActor,
    owner: summary.owner
      ? { actor: summary.owner, assignedAt: summary.owner.assignedAt }
      : null,
    participants: summary.participants.map((participant) => ({ identity: participant })),
    participantCount: summary.participantCount,
    visibility: summary.visibility,
    sharingRole: summary.sharingRole
  };
  const unavailable = () => ({
    ownership: normalizeSessionOwnership(baseRow, undefined, { members: [] }, "unavailable"),
    state: "unavailable" as const
  });

  if (!input.adapter.listSessionMembers || !input.adapter.listSessionMembersEvidence) {
    return unavailable();
  }

  const options = {
    timeoutMs: input.timeoutMs,
    ...(input.signal ? { signal: input.signal } : {})
  };
  const [members, evidence] = await Promise.allSettled([
    Promise.resolve().then(() => input.adapter.listSessionMembers!({ sessionKey: input.execution.sessionKey }, options)),
    Promise.resolve().then(() => input.adapter.listSessionMembersEvidence!({ sessionKey: input.execution.sessionKey }, options))
  ]);
  const complete = members.status === "fulfilled" && evidence.status === "fulfilled";

  return {
    ownership: normalizeSessionOwnership(
      baseRow,
      members.status === "fulfilled" ? members.value : undefined,
      evidence.status === "fulfilled" ? evidence.value : { members: [] },
      complete ? "available" : "unavailable"
    ),
    state: complete ? "available" : "unavailable"
  };
}
