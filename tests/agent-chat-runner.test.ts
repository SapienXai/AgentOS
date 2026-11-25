import assert from "node:assert/strict";
import { test } from "node:test";

import { getAgentChatRunSnapshot, sendAgentChatMessage } from "@/components/mission-control/agent-chat-runner";
import { readAgentChatMessages } from "@/components/mission-control/agent-chat-storage";

test("overlapping sends keep distinct submission IDs and retire only their own run", async (context) => {
  const agentId = "queue-fixture";
  const encoder = new TextEncoder();
  const requests: Array<{
    payload: { idempotencyKey: string; message: string };
    controller: ReadableStreamDefaultController<Uint8Array>;
  }> = [];

  context.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body)) as (typeof requests)[number]["payload"];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        requests.push({ payload, controller });
        controller.enqueue(encoder.encode(JSON.stringify({ type: "admitted", runId: payload.idempotencyKey }) + "\n"));
      }
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
  });

  const errors: string[] = [];
  const onError = (error: string) => errors.push(error);
  const first = sendAgentChatMessage({ agentId, text: "First", onError });
  const second = sendAgentChatMessage({ agentId, text: "Second", onError });

  assert.deepEqual(requests.map(({ payload }) => payload.message), ["First", "Second"]);
  assert.notEqual(requests[0].payload.idempotencyKey, requests[1].payload.idempotencyKey);
  assert.equal(getAgentChatRunSnapshot(agentId).runs.length, 2);

  requests[0].controller.enqueue(encoder.encode('{"type":"settled"}\n'));
  requests[0].controller.close();
  await first;
  assert.deepEqual(getAgentChatRunSnapshot(agentId).runs.map((run) => run.userMessageId), [
    requests[1].payload.idempotencyKey
  ]);

  requests[1].controller.enqueue(encoder.encode('{"type":"settled"}\n'));
  requests[1].controller.close();
  await second;
  assert.equal(getAgentChatRunSnapshot(agentId).isRunning, false);
  assert.deepEqual(readAgentChatMessages(agentId).map(({ text, status }) => ({ text, status })), [
    { text: "First", status: "sent" },
    { text: "Second", status: "sent" }
  ]);
  assert.deepEqual(errors, []);
});

test("a disconnected observer preserves the admitted message and does not replay it", async (context) => {
  const agentId = "disconnect-fixture";
  const fetchMock = context.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    assert.equal(JSON.parse(String(options.body)).queueMode, "steer");
    return new Response('{"type":"admitted","runId":"native-run"}\n', {
      headers: { "Content-Type": "application/x-ndjson" }
    });
  });
  const errors: string[] = [];
  await sendAgentChatMessage({ agentId, text: "Keep this input", queueMode: "steer", onError: (error) => errors.push(error) });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(getAgentChatRunSnapshot(agentId).isRunning, false);
  assert.deepEqual(readAgentChatMessages(agentId).map(({ text, status, runId }) => ({ text, status, runId })), [
    { text: "Keep this input", status: "sent", runId: "native-run" }
  ]);
  assert.match(errors[0], /accepted this message/);
});
