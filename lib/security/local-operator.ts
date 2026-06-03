export type LocalOperatorGuardDecision =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: 403;
      code: "unsafe-host" | "unsafe-forwarded-client" | "unsafe-origin" | "unsafe-referer";
      message: string;
    };

export const SAFE_API_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
type LocalOperatorBlockCode = Extract<LocalOperatorGuardDecision, { ok: false }>["code"];

export function evaluateLocalOperatorRequest(input: {
  method: string;
  url: string;
  headers: Headers;
  allowSafeMethods?: boolean;
}): LocalOperatorGuardDecision {
  const method = input.method.toUpperCase();
  if (input.allowSafeMethods !== false && SAFE_API_METHODS.has(method)) {
    return { ok: true };
  }

  const requestUrl = new URL(input.url);
  const observedHosts = readObservedHosts(input.headers, requestUrl.host);
  const unsafeHost = observedHosts.find((host) => !isLoopbackHost(host));

  if (unsafeHost) {
    return blocked(
      "unsafe-host",
      "Unsafe remote mutation blocked. AgentOS write APIs are limited to same-origin localhost access."
    );
  }

  const forwardedFor = splitHeaderValues(input.headers.get("x-forwarded-for"));
  const unsafeForwardedClient = forwardedFor.find((address) => !isLoopbackAddress(address));

  if (unsafeForwardedClient) {
    return blocked(
      "unsafe-forwarded-client",
      "Unsafe remote mutation blocked. Forwarded non-local clients cannot use AgentOS write APIs."
    );
  }

  const origin = input.headers.get("origin")?.trim();
  if (origin && !isSameOriginHeaderValue(origin, input.headers, requestUrl)) {
    return blocked(
      "unsafe-origin",
      "Unsafe cross-origin mutation blocked. Use AgentOS from its local same-origin URL."
    );
  }

  const referer = input.headers.get("referer")?.trim();
  if (!origin && referer && !isSameOriginHeaderValue(referer, input.headers, requestUrl)) {
    return blocked(
      "unsafe-referer",
      "Unsafe cross-origin mutation blocked. Use AgentOS from its local same-origin URL."
    );
  }

  return { ok: true };
}

export function isLoopbackHost(host: string) {
  const hostname = parseHostName(host);

  return Boolean(hostname && isLoopbackAddress(hostname));
}

function blocked(code: LocalOperatorBlockCode, message: string): LocalOperatorGuardDecision {
  return {
    ok: false,
    status: 403,
    code,
    message
  };
}

function readObservedHosts(headers: Headers, fallbackHost: string) {
  const hosts = [
    ...splitHeaderValues(headers.get("host")),
    ...splitHeaderValues(headers.get("x-forwarded-host")),
    ...splitHeaderValues(headers.get("x-original-host"))
  ];

  if (hosts.length === 0 && fallbackHost) {
    hosts.push(fallbackHost);
  }

  return hosts;
}

function isSameOriginHeaderValue(value: string, headers: Headers, requestUrl: URL) {
  if (value === "null") {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return buildTargetOrigins(headers, requestUrl).has(parsed.origin);
}

function buildTargetOrigins(headers: Headers, requestUrl: URL) {
  const protocols = splitHeaderValues(headers.get("x-forwarded-proto"))
    .map((value) => value.replace(/:$/, "").toLowerCase())
    .filter((value) => value === "http" || value === "https");
  const protocol = protocols[0] || requestUrl.protocol.replace(/:$/, "");
  const hosts = readObservedHosts(headers, requestUrl.host);
  const origins = new Set<string>();

  for (const host of hosts) {
    origins.add(`${protocol}://${host}`);
  }

  origins.add(requestUrl.origin);
  return origins;
}

function splitHeaderValues(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseHostName(host: string) {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 0 ? trimmed.slice(1, end) : null;
  }

  if (trimmed.includes(":")) {
    const colonCount = (trimmed.match(/:/g) ?? []).length;
    if (colonCount === 1) {
      return trimmed.split(":")[0] || null;
    }

    return trimmed;
  }

  return trimmed;
}

function isLoopbackAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4MappedLoopback = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4MappedLoopback) {
    return isLoopbackAddress(ipv4MappedLoopback[1]);
  }

  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1).map(Number);
  return parts.every((part) => part >= 0 && part <= 255) && parts[0] === 127;
}
