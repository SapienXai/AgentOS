const INHERITED_RUNTIME_ENVIRONMENT_KEYS = [
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "TERM"
] as const;

/**
 * Build a disposable OpenClaw subprocess environment without inheriting user
 * profiles, provider credentials, auth tokens, or unrelated application state.
 * Explicit overrides are owned by the caller and should contain fixture-only
 * values such as the generated Gateway token and temporary state paths.
 */
export function createDisposableOpenClawEnvironment(input: {
  homeDir: string;
  overrides?: Record<string, string | undefined>;
}): NodeJS.ProcessEnv {
  const environment = {} as NodeJS.ProcessEnv;
  for (const key of INHERITED_RUNTIME_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  environment.HOME = input.homeDir;
  environment.USERPROFILE = input.homeDir;
  environment.TMPDIR = input.overrides?.TMPDIR || process.env.TMPDIR || "/tmp";
  environment.TEMP = input.overrides?.TEMP || input.overrides?.TMPDIR || process.env.TMPDIR || "/tmp";
  for (const [key, value] of Object.entries(input.overrides ?? {})) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}
