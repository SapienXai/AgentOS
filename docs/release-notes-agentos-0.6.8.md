# AgentOS 0.6.8 Release Notes

AgentOS 0.6.8 is a patch release focused on release safety for the packaged local control plane.

## Highlights

- Keeps the published npm package aligned with the current Gateway-first AgentOS bundle.
- Stabilizes the OpenClaw adapter contract test so local operator config-pacing settings cannot hide native `unsetConfig` forwarding.
- Removes an unused README banner asset that could block standalone build trace copying in local release environments.
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
