# AgentOS 0.6.9 Release Notes

AgentOS 0.6.9 is a patch release that refreshes the published package version and confirms the packaged CLI still ships cleanly.

## Highlights

- Bumps the published npm package version for the next GitHub release and npm publish cycle.
- Keeps the README install examples and release tag examples aligned with the new version.
- Re-runs the release gates, package smoke, and install smoke to confirm the bundled tarball still installs and runs cleanly.
- Preserves the scoped public npm package metadata, executable CLI entrypoint, bundled server, package README, and constrained package `files` list.

## OpenClaw Integration Notes

- OpenClaw remains the runtime source of truth.
- Native OpenClaw Gateway remains the preferred transport for supported operations.
- CLI fallback remains explicit and visible for install, recovery, Gateway process control, older or unsupported Gateway methods, malformed responses, scope limits, and unavailable native auth.
- No OpenClaw API assumptions changed in this release.

## Breaking Changes

None.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading to confirm Gateway protocol compatibility, native auth, scopes, model readiness, fallback activity, and the last native failure.

## Known Limitations

- Clean-install smoke remains a manual physical-machine step because it depends on local OpenClaw Gateway auth, operator scopes, model credentials, browser profile state, and provider state.
- Account-target browser-profile dispatch remains an MVP bridge until OpenClaw exposes typed browser-profile dispatch.
- `requires_approval` account rules are saved as policy state but cannot dispatch account-target tasks until approval dispatch exists.
- Surface repair remains preview-first; review audit, backup, affected paths, and restore instructions before applying.
