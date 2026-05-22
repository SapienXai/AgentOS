export const emptyAgentChatResponseMessage =
  "OpenClaw completed the turn, but AgentOS could not find assistant response text in the Gateway stream, session history, or transcript. Retry the message; if it repeats, inspect Gateway diagnostics.";

export function sanitizeAgentChatReplyText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const withoutThinking = stripLeadingThinkingBlock(trimmed);

  return stripInternalAgentChatPromptLeak(withoutThinking);
}

export function extractAssistantTextFromAgentChatStreamLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = parseRecord(trimmed);

  if (!parsed || parsed.type !== "assistant") {
    return null;
  }

  return readMessageText(parsed.text) ??
    readMessageText(parsed.message) ??
    readMessageText(parsed.content);
}

export function extractLatestAssistantTextFromSessionHistory(payload: unknown) {
  const records = collectHistoryRecords(payload);

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (!recordLooksAssistant(record)) {
      continue;
    }

    const text = readMessageText(record);

    if (text) {
      return text;
    }
  }

  return null;
}

function stripInternalAgentChatPromptLeak(value: string) {
  if (!isInternalAgentChatPromptLeak(value)) {
    return value;
  }

  const lastOperatorIndex = Math.max(
    value.lastIndexOf("\nOperator:"),
    value.startsWith("Operator:") ? 0 : -1
  );
  const afterLatestOperator = lastOperatorIndex >= 0 ? value.slice(lastOperatorIndex) : value;
  const assistantMatch = afterLatestOperator.match(/\n(?:Agent|Assistant):\s*([\s\S]+)$/i);
  const candidate = assistantMatch?.[1]?.trim() ?? "";

  return candidate && !isInternalAgentChatPromptLeak(candidate) ? candidate : "";
}

function isInternalAgentChatPromptLeak(value: string) {
  return (
    /^You are chatting directly with the operator inside AgentOS\./i.test(value) ||
    (
      /You are chatting directly with the operator inside AgentOS\./i.test(value) &&
      /Do not create tasks or mention task cards\./i.test(value)
    ) ||
    (
      /Use the workspace root `AGENTS\.md` file as the source of truth/i.test(value) &&
      /Direct chat mode takes priority over workspace operating docs/i.test(value)
    )
  );
}

function stripLeadingThinkingBlock(value: string) {
  if (!value || !/^\[thinking\]\b/i.test(value)) {
    return value;
  }

  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length <= 2) {
    return "";
  }

  return paragraphs.slice(2).join("\n\n").trim();
}

function collectHistoryRecords(payload: unknown) {
  if (!isRecord(payload)) {
    return [];
  }

  return [
    ...readRecordArray(payload.messages),
    ...readRecordArray(payload.turns),
    ...readRecordArray(payload.items),
    ...readRecordArray(isRecord(payload.session) ? payload.session.messages : null)
  ];
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : [];
}

function recordLooksAssistant(record: Record<string, unknown>) {
  return [
    record.role,
    record.type,
    record.kind,
    record.source,
    record.speaker,
    isRecord(record.author) ? record.author.role ?? record.author.type ?? record.author.name : null
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => /assistant|agent/i.test(value));
}

function readMessageText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    const text = value
      .map(readMessageText)
      .filter((entry): entry is string => Boolean(entry))
      .join("\n\n")
      .trim();

    return text || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.type === "text" || value.type === "output_text") &&
    typeof value.text === "string" &&
    value.text.trim()
  ) {
    return value.text.trim();
  }

  return readMessageText(value.text) ??
    readMessageText(value.content) ??
    readMessageText(value.message) ??
    readMessageText(value.summary) ??
    readMessageText(value.finalText) ??
    readMessageText(value.output) ??
    readMessageText(value.response);
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
