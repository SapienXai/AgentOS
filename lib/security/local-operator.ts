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
export const AGENTOS_TRUSTED_OPERATOR_ORIGINS_ENV = "AGENTOS_TRUSTED_OPERATOR_ORIGINS";
export const RAILWAY_PUBLIC_DOMAIN_ENV = "RAILWAY_PUBLIC_DOMAIN";
type LocalOperatorBlockCode = Extract<LocalOperatorGuardDecision, { ok: false }>["code"];

export function evaluateLocalOperatorRequest(input: {
  method: string;
  url: string;
  headers: Headers;
  allowSafeMethods?: boolean;
  allowTrustedRemote?: boolean;
  requireTrustedRemoteOnReads?: boolean;
  managedOrigins?: readonly string[];
  env?: Record<string, string | undefined>;
}): LocalOperatorGuardDecision {
  const method = input.method.toUpperCase();
  const safeMethod = input.allowSafeMethods !== false && SAFE_API_METHODS.has(method);
  if (safeMethod && !input.requireTrustedRemoteOnReads) {
    return { ok: true };
  }

  const requestUrl = new URL(input.url);
  const observedHosts = readObservedHosts(input.headers, requestUrl.host);
  const unsafeHost = observedHosts.find((host) => !isLoopbackHost(host));

  if (unsafeHost) {
    if (input.allowTrustedRemote !== false && isTrustedRemoteOperatorRequest({
      requestUrl,
      headers: input.headers,
      observedHosts,
      requireOrigin: !safeMethod,
      managedOrigins: input.managedOrigins ?? [],
      env: input.env ?? process.env
    })) {
      return { ok: true };
    }

    return blocked(
      "unsafe-host",
      `Remote access requires an approved HTTPS address. Use localhost to manage Access settings or configure ${AGENTOS_TRUSTED_OPERATOR_ORIGINS_ENV}.`
    );
  }

  if (safeMethod) return { ok: true };

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

function isTrustedRemoteOperatorRequest(input: {
  requestUrl: URL;
  headers: Headers;
  observedHosts: string[];
  requireOrigin: boolean;
  managedOrigins: readonly string[];
  env: Record<string, string | undefined>;
}) {
  const trustedOrigins = readTrustedOperatorOrigins(input.env);
  for (const value of input.managedOrigins) {
    const parsed = parseHttpsOrigin(value);
    if (parsed) trustedOrigins.add(parsed.origin);
  }
  if (trustedOrigins.size === 0) {
    return false;
  }

  const originHeader = input.headers.get("origin");
  const hosts = input.observedHosts.filter((host) => !isLoopbackHost(host));
  const origin = originHeader || input.requireOrigin
    ? parseHttpsOrigin(originHeader)
    : parseHttpsOrigin(`https://${hosts[0]}`);
  if (!origin || !trustedOrigins.has(origin.origin)) {
    return false;
  }

  if (
    hosts.length === 0 ||
    hosts.some((host) => normalizeHost(host) !== origin.host.toLowerCase())
  ) {
    return false;
  }

  return buildTargetOrigins(input.headers, input.requestUrl).has(origin.origin);
}

export function readTrustedOperatorOrigins(env: Record<string, string | undefined> = process.env) {
  const origins = new Set<string>();

  for (const value of (env[AGENTOS_TRUSTED_OPERATOR_ORIGINS_ENV] ?? "").split(",")) {
    const parsed = parseHttpsOrigin(value);
    if (parsed) origins.add(parsed.origin);
  }

  const railwayDomain = env[RAILWAY_PUBLIC_DOMAIN_ENV]?.trim();
  const railwayOrigin = railwayDomain ? parseHttpsOrigin(`https://${railwayDomain}`) : null;
  if (railwayOrigin) {
    origins.add(railwayOrigin.origin);
  }

  return origins;
}

export function parseHttpsOrigin(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || !/^https:\/\/[^/?#\\*]+\/?$/i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isLoopbackHost(host: string) {
  const hostname = parseHostName(host);

  return Boolean(hostname && isLoopbackAddress(hostname));
}

export function isLocalOperatorHostRequest(request: { url: string; headers: Headers }) {
  return readObservedHosts(request.headers, new URL(request.url).host).every(isLoopbackHost);
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

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/\.$/, "");
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
