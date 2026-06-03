import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export const AGENTOS_API_TOKEN_ENV = "AGENTOS_API_TOKEN";
export const AGENTOS_API_TOKEN_COOKIE = "agentos_api_token";
export const AGENTOS_API_TOKEN_FRAGMENT_KEY = "agentos_token";

export type ApiAuthDecision =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: 401 | 403;
      code: "api-auth-required" | "unsafe-local-api";
      message: string;
    };

export function evaluateAgentOsApiRequest(input: {
  method: string;
  url: string;
  headers: Headers;
  env?: Record<string, string | undefined>;
}): ApiAuthDecision {
  const env = input.env ?? process.env;
  const configuredToken = env[AGENTOS_API_TOKEN_ENV]?.trim();

  if (configuredToken) {
    const providedToken = readBearerToken(input.headers) ?? readApiTokenCookie(input.headers);

    if (providedToken && constantTimeStringEqual(providedToken, configuredToken)) {
      return { ok: true };
    }

    return {
      ok: false,
      status: 401,
      code: "api-auth-required",
      message: "AgentOS API authentication is required."
    };
  }

  if (env.NODE_ENV === "development") {
    const localDecision = evaluateLocalOperatorRequest({
      method: input.method,
      url: input.url,
      headers: input.headers,
      allowSafeMethods: false
    });

    return localDecision.ok
      ? { ok: true }
      : {
          ok: false,
          status: localDecision.status,
          code: "unsafe-local-api",
          message: localDecision.message
        };
  }

  return {
    ok: false,
    status: 401,
    code: "api-auth-required",
    message: `Set ${AGENTOS_API_TOKEN_ENV} before exposing AgentOS API routes.`
  };
}

function readBearerToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);

  if (bearerMatch?.[1]?.trim()) {
    return bearerMatch[1].trim();
  }

  const headerToken = headers.get("x-agentos-api-token")?.trim();
  return headerToken || null;
}

function readApiTokenCookie(headers: Headers) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const [name, ...valueParts] = entry.trim().split("=");
    if (name === AGENTOS_API_TOKEN_COOKIE) {
      const value = valueParts.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

function constantTimeStringEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}
