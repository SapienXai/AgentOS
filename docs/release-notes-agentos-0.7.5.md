# AgentOS 0.7.5 Release Notes

AgentOS 0.7.5 packages the latest Gateway authentication settings and operator-control improvements for the next npm and GitHub release cycle.

## Highlights

- Improves Gateway authentication settings defaults and recovery guidance.
- Surfaces more operation history, recovery controls, scheduling, and requested model metadata in Mission Control.
- Tightens OpenClaw adapter boundaries and compatibility checks across Gateway-backed flows.

## OpenClaw Compatibility Impact

- OpenClaw required baseline: unchanged, still OpenClaw 2026.6.8 or newer.
- Native Gateway/API impact: improved authentication settings and compatibility handling.
- CLI fallback impact: unchanged and remains explicit for unsupported or recovery operations.

## Security Impact

- Sensitive surfaces touched: Gateway authentication settings and local operator controls.
- Auth/token/credential handling: existing local token protections remain in place; no credentials are bundled or logged.

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

- None.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading.
