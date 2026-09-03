import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isOpenClawTranscriptCommitProven,
  normalizeOpenClawChatAdmission
} from "@/lib/openclaw/domains/chat-admission";
import { mergeAgentChatMessagesForRehydration } from "@/components/mission-control/agent-chat-storage";

const input = { sessionKey: "agent:main:main", idempotencyKey: "submission-1" };

test("chat admission distinguishes started work from transcript commit", () => {
  const admission = normalizeOpenClawChatAdmission({ runId: "run-1", status: "started" }, input);

  assert.equal(admission.state, "admitted");
  assert.equal(admission.runStarted, true);
  assert.equal(isOpenClawTranscriptCommitProven(admission), false);
});

test("chat admission marks a message sequence as committed", () => {
  const admission = normalizeOpenClawChatAdmission(
    { runId: "run-1", status: "started", runStarted: true, messageSeq: 12 },
    input
  );

  assert.equal(admission.state, "committed");
  assert.equal(admission.messageSeq, 12);
  assert.equal(isOpenClawTranscriptCommitProven(admission), true);
});

test("a retry retains the same submission identity", () => {
  const first = normalizeOpenClawChatAdmission({ status: "queued" }, input);
  const retry = normalizeOpenClawChatAdmission({ status: "queued" }, input);

  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(first.sessionKey, retry.sessionKey);
});

test("reconnect during pending custody remains admitted but uncommitted", () => {
  const beforeReconnect = normalizeOpenClawChatAdmission({ runId: "run-1", runStarted: true }, input);
  const afterReconnect = normalizeOpenClawChatAdmission({ runId: "run-1", status: "running" }, input);

  assert.equal(beforeReconnect.state, "admitted");
  assert.equal(afterReconnect.state, "admitted");
  assert.equal(afterReconnect.idempotencyKey, input.idempotencyKey);
});

test("run start without a sequence does not imply persistence", () => {
  const admission = normalizeOpenClawChatAdmission({ status: "running", runStarted: true }, input);

  assert.equal(admission.messageSeq, null);
  assert.equal(isOpenClawTranscriptCommitProven(admission), false);
});

test("final transcript reconciliation upgrades the provisional record once", () => {
  const merged = mergeAgentChatMessagesForRehydration(
    [{
      id: "local-user",
      role: "user",
      text: "Hello",
      createdAt: 1,
      status: "sending",
      submissionId: input.idempotencyKey
    }],
    [{
      id: "native-message-12",
      role: "user",
      text: "Hello",
      createdAt: 2,
      status: "sent",
      submissionId: input.idempotencyKey,
      messageSeq: 12
    }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "native-message-12");
  assert.equal(merged[0]?.messageSeq, 12);
});
