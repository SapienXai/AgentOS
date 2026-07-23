import "server-only";

import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

const policyTokenHeader = "x-agentos-browser-policy-token";

export function requireBrowserPolicyChannel(request: Request) {
  const configuredToken = process.env.AGENTOS_BROWSER_POLICY_TOKEN?.trim() ?? "";
  const presentedToken = request.headers.get(policyTokenHeader)?.trim() ?? "";
  if (!isValidPolicyToken(configuredToken)) {
    return NextResponse.json(
      {
        error: "The internal browser policy channel is unavailable.",
        code: "browser-policy-channel-unavailable"
      },
      { status: 503, headers: browserPolicyResponseHeaders() }
    );
  }
  if (!constantTimeEqual(configuredToken, presentedToken)) {
    return NextResponse.json(
      {
        error: "Browser policy channel access is denied.",
        code: "browser-policy-channel-denied"
      },
      { status: 401, headers: browserPolicyResponseHeaders() }
    );
  }
  return null;
}

export function browserPolicyResponseHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function isValidPolicyToken(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}
