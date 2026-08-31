import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const OPENCLAW_RUNTIME_FIXTURE_MODEL_ID = "agentos-runtime-fixture";

export type OpenClawRuntimeProviderFixture = {
  baseUrl: string;
  modelId: string;
  stats: {
    requestCount: number;
    completionCount: number;
    streamingCompletionCount: number;
  };
  close: () => Promise<void>;
};

export async function createOpenClawRuntimeProviderFixture(input: {
  modelId?: string;
} = {}): Promise<OpenClawRuntimeProviderFixture> {
  const modelId = input.modelId ?? OPENCLAW_RUNTIME_FIXTURE_MODEL_ID;
  const stats = {
    requestCount: 0,
    completionCount: 0,
    streamingCompletionCount: 0
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response, modelId, stats);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Loopback provider fixture did not expose a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelId,
    stats,
    close: () => closeServer(server)
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  modelId: string,
  stats: OpenClawRuntimeProviderFixture["stats"]
) {
  stats.requestCount += 1;

  if (request.method === "GET" && request.url === "/v1/models") {
    writeJson(response, 200, {
      object: "list",
      data: [{ id: modelId, object: "model", owned_by: "agentos-runtime-certification" }]
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    writeJson(response, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request)) as { stream?: boolean; messages?: unknown };
    const stream = payload.stream === true;
    const prompt = readLastUserMessage(payload.messages);
    const content = resolveFixtureResponse(prompt);
    stats.completionCount += 1;
    if (stream) stats.streamingCompletionCount += 1;

    if (stream) {
      writeStreamingResponse(response, modelId, content);
      return;
    }

    writeJson(response, 200, {
      id: `agentos-fixture-${stats.completionCount}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: content.length, total_tokens: content.length + 1 }
    });
  } catch {
    writeJson(response, 400, { error: { message: "Invalid JSON request", type: "invalid_request_error" } });
  }
}

function resolveFixtureResponse(prompt: string) {
  if (/CRON/i.test(prompt)) return "AGENTOS_FIXTURE_CRON_REPLY";
  if (/SECOND|CONTINUITY/i.test(prompt)) return "AGENTOS_FIXTURE_SECOND_REPLY";
  return "AGENTOS_FIXTURE_FIRST_REPLY";
}

function readLastUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const message = [...messages].reverse().find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return (entry as { role?: unknown }).role === "user";
  });
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : null;
  return typeof content === "string" ? content : "";
}

function writeStreamingResponse(response: ServerResponse, modelId: string, content: string) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  const id = `agentos-fixture-stream-${Date.now()}`;
  const splitAt = Math.max(1, Math.floor(content.length / 2));
  const chunks = [content.slice(0, splitAt), content.slice(splitAt)];
  response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { role: "assistant", content: chunks[0] }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { content: chunks[1] }, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.once("end", () => resolve(body));
    request.once("error", reject);
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
