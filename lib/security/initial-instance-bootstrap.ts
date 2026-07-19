import {
  enableInstanceProtection,
  readInstanceProtectionState
} from "@/lib/security/instance-protection";

export const AGENTOS_INITIAL_ADMIN_USERNAME_ENV = "AGENTOS_INITIAL_ADMIN_USERNAME";
export const AGENTOS_INITIAL_ADMIN_PASSWORD_ENV = "AGENTOS_INITIAL_ADMIN_PASSWORD";

export type InitialInstanceBootstrapResult =
  | { status: "not-configured" }
  | { status: "already-configured" }
  | { status: "created" };

export async function bootstrapInitialInstanceProtection(
  env: NodeJS.ProcessEnv = process.env
): Promise<InitialInstanceBootstrapResult> {
  const password = env[AGENTOS_INITIAL_ADMIN_PASSWORD_ENV];

  if (!password) {
    return { status: "not-configured" };
  }

  try {
    if (await readInstanceProtectionState(env)) {
      return { status: "already-configured" };
    }

    const username = env[AGENTOS_INITIAL_ADMIN_USERNAME_ENV]?.trim() || "admin";
    await enableInstanceProtection({ username, password }, env);
    return { status: "created" };
  } finally {
    // Keep the bootstrap credential out of the long-running Next.js process.
    delete env[AGENTOS_INITIAL_ADMIN_PASSWORD_ENV];
  }
}
