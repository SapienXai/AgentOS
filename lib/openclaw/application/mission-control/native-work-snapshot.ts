import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawCapabilityMatrix } from "@/lib/openclaw/types";
import type {
  OpenClawTaskListPayload,
  OpenClawTaskSuggestionsListPayload,
  OpenClawWorktreesListPayload
} from "@/lib/openclaw/client/types";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { MissionControlSnapshot, NativeWorkSnapshot } from "@/lib/openclaw/types";
import {
  capabilityState,
  createEmptyNativeWorkSnapshot,
  getSuggestedWorkAcceptModes,
  normalizeManagedWorktree,
  normalizeNativeWorkExecution,
  normalizeSuggestedWork
} from "@/lib/openclaw/domains/native-work-model";

export async function loadNativeWorkSnapshot(input: {
  sessions: SessionsPayload["sessions"];
  agents: MissionControlSnapshot["agents"];
  taskList?: OpenClawTaskListPayload;
  matrix: OpenClawCapabilityMatrix | null | undefined;
  adapter: OpenClawAdapter;
  timeoutMs: number;
}): Promise<NativeWorkSnapshot> {
  const snapshot = createEmptyNativeWorkSnapshot();
  const worktreeState = capabilityState(input.matrix, "worktrees");
  const suggestionState = capabilityState(input.matrix, "taskSuggestions");
  const ownershipState = capabilityState(input.matrix, "sessionCollaboration");
  const assignmentState = input.matrix?.operations?.sessionCollaboration?.mode === "gateway-native" &&
    input.matrix.supportedMethods.includes("sessions.assignOwner") ? "supported" : ownershipState;
  snapshot.availability = {
    worktrees: worktreeState,
    suggestions: suggestionState,
    ownership: ownershipState,
    assignment: assignmentState
  };
  const issues: string[] = [];

  const worktreeResult = await settle<OpenClawWorktreesListPayload>(
    worktreeState === "supported" && input.adapter.listWorktrees
      ? input.adapter.listWorktrees({ timeoutMs: input.timeoutMs })
      : undefined
  );
  const suggestionResult = await settle<OpenClawTaskSuggestionsListPayload>(
    suggestionState === "supported" && input.adapter.listTaskSuggestions
      ? input.adapter.listTaskSuggestions({}, { timeoutMs: input.timeoutMs })
      : undefined
  );

  if (worktreeResult.status === "fulfilled" && worktreeResult.value) {
    snapshot.worktrees = (Array.isArray(worktreeResult.value.worktrees) ? worktreeResult.value.worktrees : [])
      .map(normalizeManagedWorktree)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  } else if (worktreeResult.status === "rejected") {
    issues.push(`Managed worktrees could not be refreshed: ${safeError(worktreeResult.reason)}`);
  }

  if (suggestionResult.status === "fulfilled" && suggestionResult.value) {
    const modes = getSuggestedWorkAcceptModes(input.matrix);
    snapshot.suggestions = (Array.isArray(suggestionResult.value.suggestions) ? suggestionResult.value.suggestions : [])
      .map((entry) => normalizeSuggestedWork(entry, modes))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  } else if (suggestionResult.status === "rejected") {
    issues.push(`Suggested work could not be refreshed: ${safeError(suggestionResult.reason)}`);
  }

  const taskIdsBySession = collectTaskIdsBySession(input.taskList);
  const sessions = input.sessions.filter((session) => typeof session.key === "string").slice(0, 32);
  const memberCalls = ownershipState === "supported" && input.adapter.listSessionMembers
    ? sessions.map((session) => input.adapter.listSessionMembers!({ sessionKey: session.key! }, { timeoutMs: input.timeoutMs }))
    : [];
  const evidenceCalls = ownershipState === "supported" && input.adapter.listSessionMembersEvidence
    ? sessions.map((session) => input.adapter.listSessionMembersEvidence!({ sessionKey: session.key! }, { timeoutMs: input.timeoutMs }))
    : [];
  const [memberResults, evidenceResults] = await Promise.all([
    Promise.allSettled(memberCalls),
    Promise.allSettled(evidenceCalls)
  ]);

  snapshot.executions = sessions
    .map((session, index) => {
      const memberResult = memberResults[index];
      const evidenceResult = evidenceResults[index];
      const worktree = snapshot.worktrees.find((entry) =>
        (typeof session.worktree === "object" && session.worktree && "id" in session.worktree && entry.id === session.worktree.id) ||
        entry.path === session.spawnedWorkspaceDir || entry.path === session.spawnedCwd
      ) ?? null;
      const execution = normalizeNativeWorkExecution(
        session,
        input.agents.find((agent) => agent.id === session.agentId) ?? null,
        worktree,
        memberResult?.status === "fulfilled" ? memberResult.value : undefined,
        evidenceResult?.status === "fulfilled" ? evidenceResult.value : undefined,
        taskIdsBySession.get(session.key!) ?? []
      );
      return execution;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (ownershipState === "supported" && memberResults.some((result) => result.status === "rejected")) {
    issues.push("Some session membership projections are unavailable; principal-less evidence remains explicit.");
  }
  snapshot.issues = issues;
  return snapshot;
}

function collectTaskIdsBySession(taskList: OpenClawTaskListPayload | undefined) {
  const result = new Map<string, string[]>();
  for (const candidate of taskList?.tasks ?? []) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const task = candidate as Record<string, unknown>;
    const id = typeof task.id === "string" ? task.id : typeof task.taskId === "string" ? task.taskId : null;
    const sessionKey = typeof task.sessionKey === "string" ? task.sessionKey : typeof task.key === "string" ? task.key : null;
    if (!id || !sessionKey) continue;
    const ids = result.get(sessionKey) ?? [];
    ids.push(id);
    result.set(sessionKey, ids);
  }
  return result;
}

function safeError(value: unknown) {
  return value instanceof Error ? value.message : "OpenClaw returned an unknown native-work error.";
}

async function settle<T>(promise: Promise<T> | undefined): Promise<PromiseSettledResult<T>> {
  if (!promise) return { status: "fulfilled", value: undefined as T };
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}
