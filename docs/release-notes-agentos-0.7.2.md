# AgentOS 0.7.2 Release Notes

AgentOS 0.7.2 is a patch stabilization release for the OpenClaw control-plane path.

## Highlights

- Adds an environment-gated runtime golden-path smoke script for real mission dispatch, task visibility, runtime output, continuation, and event-stream or polling fallback visibility.
- Persists pending Gateway config pacing mutations in an AgentOS-owned sidecar queue so rate-limited updates can resume after server restart.
- Keeps Gateway config rate-limit recovery on the native Gateway path; CLI fallback remains disabled for config cooldown recovery.
- Makes Settings show config queue durability, pending age, retry timing, last update, and last issue.
- Clarifies Context Engine state by separating OpenClaw runtime-reported files from AgentOS saved sidecar preferences.
- Writes `.openclaw/context-engine.json` atomically with owner-only permissions and surfaces corrupt preference recovery instead of silently treating it as saved.
- Adds server-side task continuation confidence policy: high confidence can continue, medium confidence returns a warning, and none confidence is rejected.
- Adds real proxy route protection tests for production-like API token enforcement and local-development remote-client blocking.
- Bumps the published npm package version to `0.7.2`.

## OpenClaw Integration Notes

- OpenClaw remains the runtime source of truth for task, session, model, Gateway, and runtime execution state.
- AgentOS sidecar state is limited to operator-facing preferences and recovery metadata.
- Native OpenClaw Gateway remains the preferred transport for supported operations.
- No fake runtime or demo task behavior was added.

## Breaking Changes

None.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading to confirm Gateway protocol compatibility, native auth, scopes, model readiness, fallback activity, and the last native failure.
- Run `AGENTOS_RUNTIME_SMOKE=1 pnpm smoke:runtime-golden` only on a local operator machine that is ready to dispatch a real OpenClaw task.

## Known Limitations

- Runtime golden-path smoke can be blocked by missing local OpenClaw auth, model credentials, or writable runtime state.
- Context Engine include/exclude preferences remain AgentOS sidecar state until OpenClaw exposes native file toggle APIs.
- Account-target browser-profile dispatch remains an MVP bridge until OpenClaw exposes typed browser-profile dispatch.
- `requires_approval` account rules are saved as policy state but cannot dispatch account-target tasks until approval dispatch exists.
