export type OpenClawChatAdmissionState = "admitted" | "committed" | "unknown";

export type OpenClawChatAdmission = {
  state: OpenClawChatAdmissionState;
  runStarted: boolean;
  status: string | null;
  messageSeq: number | null;
  idempotencyKey: string;
  sessionKey: string;
  runId: string | null;
};

const admittedStatuses = new Set(["accepted", "queued", "running", "started"]);

export function normalizeOpenClawChatAdmission(
  payload: {
    runId?: unknown;
    status?: unknown;
    runStarted?: unknown;
    messageSeq?: unknown;
  },
  input: { sessionKey: string; idempotencyKey: string }
): OpenClawChatAdmission {
  const status = typeof payload.status === "string" && payload.status.trim()
    ? payload.status.trim().toLowerCase()
    : null;
  const messageSeq = typeof payload.messageSeq === "number" &&
    Number.isSafeInteger(payload.messageSeq) && payload.messageSeq >= 0
    ? payload.messageSeq
    : null;
  const runStarted = payload.runStarted === true || admittedStatuses.has(status ?? "");

  return {
    state: messageSeq !== null ? "committed" : runStarted ? "admitted" : "unknown",
    runStarted,
    status,
    messageSeq,
    idempotencyKey: input.idempotencyKey,
    sessionKey: input.sessionKey,
    runId: typeof payload.runId === "string" && payload.runId.trim() ? payload.runId.trim() : null
  };
}

export function isOpenClawTranscriptCommitProven(admission: OpenClawChatAdmission) {
  return admission.state === "committed" && admission.messageSeq !== null;
}
