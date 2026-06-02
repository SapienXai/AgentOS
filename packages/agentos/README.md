# @sapienx/agentos

License: MIT

Install:

```bash
pnpm add -g @sapienx/agentos
```

Run:

```bash
agentos
```

The `agentos` command starts the local AgentOS server and prints the local URL.

If you pass `--open` and AgentOS is already listening on the selected port, the CLI opens the existing instance instead of failing.

Press `Ctrl+C` to stop a foreground AgentOS process. If shutdown hangs, press `Ctrl+C` again to force quit.

Optional flags:

```bash
agentos start --port 3000 --host 127.0.0.1
agentos start --port 3000 --host 127.0.0.1 --open
agentos update
agentos update --check
agentos stop
agentos stop --port 3000 --force
agentos status
agentos doctor
agentos uninstall
```

Optional environment variables:

```bash
AGENTOS_HOST=127.0.0.1
AGENTOS_PORT=3000
AGENTOS_OPEN=1
```

`agentos status` prints a concise local dashboard for Gateway, runtime, model, channel, and server readiness.

`agentos doctor` prints deeper install diagnostics: effective URL, bundle status, Node.js compatibility, OpenClaw detection, Gateway reachability, and browser auto-open support.

`agentos doctor --deep` adds read-only OpenClaw compatibility probes for Gateway protocol, native auth, scopes, required methods, config access, config schema/patch support, channel status, model readiness, fallback count, and the last native failure when AgentOS is running.

`agentos stop` sends `SIGTERM` to the AgentOS server listening on the selected port. If the runtime state is stale and no process is listening there, the CLI clears that stale state automatically.

`agentos update` refreshes a release installation in place. `agentos update --check` only checks whether a newer version exists.

If AgentOS was installed with `pnpm` or `npm`, update commands only print the matching package manager command instead of changing files in place.

`agentos uninstall` removes a release-installer copy. If the package was installed with `pnpm` or `npm`, remove it with your package manager instead.

AgentOS is designed to work with a local OpenClaw installation. If OpenClaw is missing, AgentOS still starts and guides onboarding in the UI.

Compatibility:

- Requires Node.js 24 or newer.
- Expects the current stable OpenClaw release (`2026.5.28` or newer stable builds with compatible Gateway protocol support).
- Uses OpenClaw Gateway-first transport by default, with explicit CLI fallback for install, recovery, Gateway process control, older or unsupported Gateway methods, malformed responses, scope limits, and unavailable native auth.
- Run `agentos doctor --deep` and check in-app diagnostics to verify OpenClaw version, Gateway protocol compatibility, native auth, scopes, fallback activity, and model readiness before the first mission.
- Account-target browser-profile dispatch is an MVP bridge until OpenClaw exposes typed browser-profile dispatch. AgentOS enforces access rules before task launch and passes selected profile/session context; `requires_approval` rules remain blocked until approval dispatch exists.
