export type SiwcOnboardingState =
  | { phase: "checking" | "preparing" | "verifying" }
  | { phase: "authorize"; flowId: string }
  | { phase: "choose-account"; options: string[] }
  | { phase: "ready"; model: string; reused: boolean }
  | { phase: "failed"; reason: SiwcFailure }
  | { phase: "cancelled" };

export type SiwcFailure =
  | "owner" | "local-required" | "gateway" | "version" | "unsupported"
  | "busy" | "declined" | "timeout" | "callback" | "sharing"
  | "policy" | "quota" | "no-models" | "unavailable" | "verification" | "restart";

export const SIWC_ENDPOINT = "/api/onboarding/siwc";

export function validateOpenClawSiwcAuthorizationUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.origin !== "https://auth.openai.com" || url.pathname !== "/api/accounts/authorize" ||
        url.username || url.password || url.hash) return null;
    const param = (key: string) => {
      const values = url.searchParams.getAll(key);
      return values.length === 1 ? values[0] : undefined;
    };
    if (param("response_type") !== "code" || param("code_challenge_method") !== "S256" ||
        !param("state") || !param("nonce") || !param("client_id") || !param("code_challenge")) return null;
    const redirect = new URL(param("redirect_uri") ?? "");
    if (redirect.protocol !== "http:" || redirect.hostname !== "localhost" || !redirect.port ||
        redirect.pathname !== "/auth/callback" || redirect.username || redirect.password ||
        redirect.search || redirect.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}
