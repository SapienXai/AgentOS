# AgentOS 0.7.6 Release Notes

AgentOS 0.7.6 packages the latest operator authentication, channel connection, and responsive control-plane improvements for the next npm and GitHub release cycle.

## Highlights

- Adds local instance protection, protected login, logout, and operator profile controls.
- Adds Gateway-backed channel connection flows, including mobile pairing and Slack app-token support.
- Improves sidebar pinning, workspace controls, agent chat, and responsive Mission Control and Operations layouts.

## OpenClaw Compatibility Impact

- OpenClaw required baseline: unchanged, still OpenClaw 2026.6.8 or newer.
- Native Gateway/API impact: channel connection, mobile pairing, and Gateway authentication flows use the existing OpenClaw adapter/client boundary.
- CLI fallback impact: unchanged and remains explicit for unsupported or recovery operations.
- Contract coverage: OpenClaw channel, pairing, Gateway client, workspace, and boundary safety tests were updated or added in this release range.

## Security Impact

- Sensitive surfaces touched: local instance protection, protected login, logout, operator profile controls, and channel authentication inputs.
- Auth/token/credential handling: local API-token protections remain in place; credentials are not bundled or logged.

## Validation

- `pnpm lint`
- `pnpm typegen`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check:release`
- `pnpm smoke:mission-control`

## Smoke Status

- Mission Control browser smoke: pending release workflow execution.
- Runtime golden-path smoke: not run.

## Known Limitations

- Account-target browser-profile dispatch remains an MVP bridge until OpenClaw exposes typed browser-profile dispatch.
- Runtime golden-path smoke requires local OpenClaw auth, model credentials, and writable runtime state.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading.
