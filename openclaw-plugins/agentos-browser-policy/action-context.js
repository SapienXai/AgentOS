const browserRefPattern = /^(?:f\d+)?e\d+$|^ax\d+$|^\d{1,9}$/i;

const adminPattern =
  /\b(?:password|passcode|mfa|2fa|two-factor|authenticator|security settings?|recovery|api (?:key|token)|access token|secret|permission|role|owner|delete account|close account|merge|(?:account|privacy|identity|profile) settings?)\b/i;
const transactionPattern =
  /\b(buy now|proceed to checkout|checkout|place (?:your )?order|purchase|pay(?:ment)?|subscribe|transfer(?: money)?|confirm (?:order|purchase|payment))\b/i;
const publishPattern =
  /\b(post|publish|tweet|reply|repost|quote|comment|send(?: message| email)?|direct message|dm|launch|create (?:an? )?(?:issue|pull request)|open (?:an? )?pull request|publish release|submit)\b/i;

const serviceRiskPatterns = {
  github: {
    admin: /\b(merge|approve|delete|close)\b/i,
    publish: /\b(create|open|comment|edit)\b.{0,32}\b(issue|pull request|release)\b|\b(publish|release)\b/i
  },
  x: {
    publish: /\b(tweet|post|reply|quote|repost|direct message|dm|send)\b/i
  },
  producthunt: {
    publish: /\b(launch|comment|upvote|submit)\b/i
  },
  amazon: {
    transact: /\b(buy now|proceed to checkout|checkout|place (?:your )?order|submit (?:your )?order|purchase|pay|payment|subscribe)\b/i
  }
};

const interactiveKinds = new Set([
  "click",
  "clickcoords",
  "click-coords",
  "drag",
  "fill",
  "hover",
  "press",
  "scrollintoview",
  "select",
  "type",
  "wait"
]);
const nonMutatingKinds = new Set(["hover", "scrollintoview", "wait"]);
const enterKeys = new Set(["enter", "return", "numpadenter"]);
const safePressKeys = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "escape",
  "esc",
  "tab",
  "pagedown",
  "pageup",
  "home",
  "end"
]);

/**
 * Read the exact nested request shape emitted by OpenClaw 2026.9.4.
 * The helper deliberately does not read model prose for authorization.
 */
export function readActRequest(params) {
  return params?.request && typeof params.request === "object" ? params.request : params;
}

export function readActKind(params) {
  const request = readActRequest(params);
  const kind = typeof request?.kind === "string" ? request.kind : "";
  return kind.trim().toLowerCase().slice(0, 32);
}

export function readActRefs(params) {
  const request = readActRequest(params);
  const values = [request?.ref, params?.ref, request?.startRef, request?.endRef, params?.startRef, params?.endRef];
  if (Array.isArray(request?.fields)) {
    for (const field of request.fields) values.push(field?.ref);
  }
  return [...new Set(values.map(normalizeRef).filter(Boolean))];
}

export function readTargetId(params) {
  const request = readActRequest(params);
  const value = typeof params?.targetId === "string" ? params.targetId : request?.targetId;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 256) : null;
}

export function readSubmit(params) {
  const request = readActRequest(params);
  return request?.submit === true || params?.submit === true;
}

export function readKey(params) {
  const request = readActRequest(params);
  const value = typeof request?.key === "string" ? request.key : params?.key;
  return typeof value === "string" ? value.trim().toLowerCase().replaceAll(" ", "") : "";
}

function readWaitPredicate(params) {
  const request = readActRequest(params);
  return typeof request?.fn === "string" && request.fn.trim() ? request.fn.trim().slice(0, 2_000) : null;
}

/**
 * Convert the raw OpenClaw browser.request /snapshot body into an in-memory,
 * secret-free action context. Backend DOM ids, CDP details, cookies, and raw
 * page text are intentionally discarded.
 */
export function buildTrustedBrowserActionContext(raw, options = {}) {
  if (!isRecord(raw) || raw.ok === false) return null;

  const targetId = normalizeString(raw.targetId, 256);
  const url = normalizeString(raw.url, 2_048);
  if (!targetId || !url || (options.expectedTargetId && targetId !== options.expectedTargetId)) return null;
  if (!isSafeContextUrl(url, options.allowedDomains)) return null;

  const refs = {};
  if (isRecord(raw.refs)) {
    for (const [ref, value] of Object.entries(raw.refs)) {
      const normalizedRef = normalizeRef(ref);
      const normalizedValue = normalizeRefMetadata(value);
      if (normalizedRef && normalizedValue) refs[normalizedRef] = normalizedValue;
    }
  }
  if (Array.isArray(raw.nodes)) {
    for (const node of raw.nodes) {
      const ref = normalizeRef(node?.ref);
      const value = normalizeRefMetadata(node);
      if (ref && value) refs[ref] = { ...refs[ref], ...value };
    }
  }

  const snapshotText = typeof raw.snapshot === "string" ? raw.snapshot.slice(0, 256_000) : "";
  for (const entry of parseSnapshotLines(snapshotText)) {
    refs[entry.ref] = { ...refs[entry.ref], ...entry.metadata };
  }

  const pendingDialogs = readPendingDialogs(raw.browserState);
  const dialogMessages = pendingDialogs
    .map((entry) => entry.message)
    .filter(Boolean)
    .slice(0, 8);
  const blockedByDialog = raw.blockedByDialog === true || dialogMessages.length > 0;
  const semanticSnapshotGeneration = hashSnapshot({ url, refs, dialogMessages });

  return {
    source: "openclaw.browser.request",
    targetId,
    url,
    refs,
    pageSignals: Object.values(refs)
      .map(refText)
      .filter(Boolean)
      .slice(0, 500),
    dialogMessages,
    blockedByDialog,
    truncated: raw.truncated === true,
    semanticSnapshotGeneration
  };
}

/** Parse the formatted after_tool_call snapshot without retaining its wrapper. */
export function parseBrowserToolSnapshotResult(result, options = {}) {
  if (!isRecord(result)) return null;
  const details = isRecord(result.details) ? result.details : {};
  const contentText = Array.isArray(result.content)
    ? result.content.find((entry) => entry?.type === "text" && typeof entry.text === "string")?.text
    : null;
  const structured = findStructuredSnapshot(contentText);
  const raw = structured
    ? {
        ...structured,
        targetId: structured.targetId ?? details.targetId,
        url: structured.url ?? details.url,
        blockedByDialog: structured.blockedByDialog ?? details.blockedByDialog,
        browserState: structured.browserState ?? details.browserState,
        truncated: structured.truncated ?? details.truncated
      }
    : {
        ok: details.ok !== false,
        format: details.format,
        targetId: details.targetId,
        url: details.url,
        snapshot: typeof contentText === "string" ? contentText : "",
        blockedByDialog: details.blockedByDialog,
        browserState: details.browserState,
        truncated: details.truncated
      };
  return buildTrustedBrowserActionContext(raw, options);
}

/**
 * Classify an OpenClaw action using only the current trusted runtime context
 * and the most recent model-observed snapshot. A ref that is absent, changed,
 * or not observed cannot silently become ordinary interaction.
 */
export function classifyBrowserAction({
  action,
  params,
  binding,
  trustedContext,
  observedContext
}) {
  const normalizedAction = typeof action === "string" ? action.trim().toLowerCase() : "";
  const kind = readActKind(params);

  if (normalizedAction === "wait" && readWaitPredicate(params)) {
    return result("account_admin", "JavaScript wait predicates are disabled for account-bound tasks.");
  }
  if (["tabs", "snapshot", "screenshot", "console", "text", "wait"].includes(normalizedAction)) {
    return result("read", "The browser action is read-only.");
  }
  if (["open", "navigate"].includes(normalizedAction)) {
    return result("read", "Navigation is governed by the bound account domain policy.");
  }
  if (normalizedAction === "act" && (kind === "evaluate" || kind === "close")) {
    return result("account_admin", "Arbitrary page evaluation is never available to account-bound tasks.");
  }
  if (!(["act", "dialog"].includes(normalizedAction) && (interactiveKinds.has(kind) || normalizedAction === "dialog"))) {
    return result("unknown", "The browser action is not a recognized safe account-bound operation.");
  }

  if (normalizedAction === "dialog" && params?.accept !== true) {
    return result("interact", "Dismissing a browser dialog is a non-destructive interaction.");
  }
  if (normalizedAction === "act" && nonMutatingKinds.has(kind)) {
    return result("interact", "The browser action does not mutate page state.");
  }
  if (normalizedAction === "act" && kind === "press" && safePressKeys.has(readKey(params))) {
    return result("interact", "The keyboard action is a non-submitting interaction.");
  }

  if (!trustedContext) {
    return result("unknown", "A trusted current browser snapshot is unavailable.", { staleReference: true });
  }
  const observation = compareObservation(trustedContext, observedContext);
  if (!observation.samePage) {
    return result("unknown", "The browser page changed after the agent's last trusted snapshot.", { staleReference: true });
  }

  const submitLike =
    readSubmit(params) ||
    (kind === "press" && enterKeys.has(readKey(params))) ||
    (normalizedAction === "dialog" && params?.accept === true);
  const refs = readActRefs(params);
  const targets = refs.map((ref) => ({ ref, target: trustedContext.refs[ref], observed: observedContext?.refs?.[ref] }));
  if (refs.length > 0) {
    if (targets.some((entry) => !entry.target || !entry.observed || !sameRefMetadata(entry.target, entry.observed))) {
      return result("unknown", "The requested browser ref is missing or changed since the trusted snapshot.", { staleReference: true });
    }
    const targetRisk = highestRisk(targets.map((entry) => classifyTargetRisk(refText(entry.target), binding?.serviceId)));
    if (targetRisk !== "interact" && observation.semanticChanged) {
      return result("unknown", "The sensitive browser ref is stale and must be re-snapshotted.", { staleReference: true });
    }
    if ((readSubmit(params) || targetRisk === "unknown") && observation.semanticChanged) {
      return result("unknown", "The browser action context is stale and cannot be authorized safely.", { staleReference: true });
    }
    if (submitLike) {
      const pageRisk = highestRisk([
        targetRisk,
        ...(trustedContext.pageSignals ?? []).map((value) => classifyTargetRisk(value, binding?.serviceId)),
        ...(trustedContext.dialogMessages ?? []).map((value) => classifyTargetRisk(value, binding?.serviceId))
      ]);
      if (observation.semanticChanged) {
        return result("unknown", "The submitting browser context is stale and must be re-snapshotted.", { staleReference: true });
      }
      if (normalizedAction === "dialog" && params?.accept === true && pageRisk === "interact") {
        return result("unknown", "An accepted browser dialog has no trusted high-risk classification.");
      }
      return pageRisk === "unknown"
        ? result("unknown", "The submitting browser action could not be classified from trusted page state.")
        : result(pageRisk, "The submitting browser action is classified from trusted page or target state.");
    }
    if (targetRisk !== "unknown") return result(targetRisk, "The current OpenClaw ref metadata identifies the action target.");
  }

  if (submitLike) {
    const pageRisk = highestRisk([
      ...(trustedContext.pageSignals ?? []).map((value) => classifyTargetRisk(value, binding?.serviceId)),
      ...(trustedContext.dialogMessages ?? []).map((value) => classifyTargetRisk(value, binding?.serviceId))
    ]);
    if (observation.semanticChanged) {
      return result("unknown", "The submitting browser context is stale and must be re-snapshotted.", { staleReference: true });
    }
    if (normalizedAction === "dialog" && params?.accept === true && pageRisk === "interact") {
      return result("unknown", "An accepted browser dialog has no trusted high-risk classification.");
    }
    return pageRisk === "unknown"
      ? result("unknown", "The submitting browser action could not be classified from trusted page state.")
      : result(pageRisk, "The submitting browser action is classified from trusted page or dialog state.");
  }

  if (refs.length === 0) {
    return result("unknown", "A potentially mutating browser action has no trusted target ref.");
  }
  return result("interact", "The trusted browser target is an ordinary interaction.");
}

function result(capability, reason, extra = {}) {
  return { capability, reason, ...extra };
}

function highestRisk(values) {
  if (values.includes("account_admin")) return "account_admin";
  if (values.includes("transact")) return "transact";
  if (values.includes("publish")) return "publish";
  if (values.includes("unknown")) return "unknown";
  return "interact";
}

function classifyTargetRisk(value, serviceId) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "unknown";
  if (adminPattern.test(text)) return "account_admin";
  const service = serviceRiskPatterns[serviceId];
  if (service?.admin?.test(text)) return "account_admin";
  if (transactionPattern.test(text) || service?.transact?.test(text)) return "transact";
  if (publishPattern.test(text) || service?.publish?.test(text)) return "publish";
  return "interact";
}

function compareObservation(current, observed) {
  if (!observed || current.targetId !== observed.targetId || current.url !== observed.url) {
    return { samePage: false, semanticChanged: true };
  }
  return {
    samePage: true,
    semanticChanged: current.semanticSnapshotGeneration !== observed.semanticSnapshotGeneration
  };
}

function sameRefMetadata(current, observed) {
  return refText(current) === refText(observed);
}

function refText(value) {
  if (!isRecord(value)) return "";
  return [value.role, value.name, value.value, value.description]
    .filter((entry) => typeof entry === "string" && entry.trim())
    .join(" ")
    .trim()
    .slice(0, 2_000);
}

function parseSnapshotLines(snapshot) {
  const entries = [];
  for (const line of snapshot.split("\n")) {
    const ref = normalizeRef(line.match(/\[ref=([^\]]+)\]/i)?.[1]);
    if (!ref) continue;
    const prefix = line.replace(/\s*\[ref=[^\]]+\]/i, "");
    const match = prefix.match(/^\s*-\s+([^\s]+)(?:\s+("(?:\\.|[^"\\])*")[^\n]*)?/);
    if (!match) continue;
    let name;
    if (match[2]) {
      try {
        name = JSON.parse(match[2]);
      } catch {
        name = match[2].slice(1, -1);
      }
    }
    const suffix = prefix.slice(match[0].length);
    const value = parseQuotedField(suffix, "value");
    const description = parseQuotedField(suffix, "description");
    entries.push({
      ref,
      metadata: normalizeRefMetadata({ role: match[1], name, value, description }) ?? {}
    });
  }
  return entries;
}

function parseQuotedField(value, field) {
  const token = value.match(new RegExp(`\\b${field}=((?:"(?:\\\\.|[^"\\\\])*")|(?:'[^']*'))`))?.[1];
  if (!token) return undefined;
  if (token.startsWith('"')) {
    try {
      return JSON.parse(token);
    } catch {
      return token.slice(1, -1);
    }
  }
  return token.slice(1, -1);
}

function normalizeRef(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@|^ref=/i, "");
  return normalized && normalized.length <= 128 && browserRefPattern.test(normalized) ? normalized : null;
}

function normalizeRefMetadata(value) {
  if (!isRecord(value)) return null;
  const metadata = {};
  for (const key of ["role", "name", "value", "description"]) {
    const normalized = normalizeString(value[key], 900);
    if (normalized) metadata[key] = normalized;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function readPendingDialogs(value) {
  const dialogs = isRecord(value) && isRecord(value.dialogs) ? value.dialogs : null;
  return Array.isArray(dialogs?.pending)
    ? dialogs.pending
        .map((entry) => ({
          message: normalizeString(entry?.message, 900),
          id: normalizeString(entry?.id, 128)
        }))
        .filter((entry) => entry.message)
    : [];
}

function findStructuredSnapshot(value) {
  if (isRecord(value) && (typeof value.snapshot === "string" || Array.isArray(value.nodes) || isRecord(value.refs))) {
    return value;
  }
  if (typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    return findStructuredSnapshot(parsed);
  } catch {
    return null;
  }
}

function hashSnapshot(value) {
  const canonical = JSON.stringify({
    url: value.url,
    refs: Object.entries(value.refs)
      .map(([ref, metadata]) => [ref, metadata])
      .sort(([left], [right]) => left.localeCompare(right)),
    dialogMessages: [...value.dialogMessages].sort()
  });
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isSafeContextUrl(value, allowedDomains) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localHttp) return false;
    if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return allowedDomains.some((entry) => {
      const domain = String(entry).trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

function normalizeString(value, maxLength) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
