# AgentOS 0.7.3 Release Notes

AgentOS 0.7.3 is a patch release focused on onboarding polish, operator workflow clarity, and release-safe control-plane cleanup.

## Highlights

- Refreshes the OpenClaw onboarding flow with clearer terminal command details and reset behavior.
- Improves Mission Control and Settings layout polish, including runtime issue visibility, overview placement, and model-linked agent context.
- Tightens workspace and agent operator flows with recency sorting, controlled dialog state, and clearer adapter boundaries.
- Keeps the published package version aligned for the next npm and GitHub release cycle.

## OpenClaw Compatibility Impact

- OpenClaw required baseline: unchanged, still OpenClaw 2026.6.8 or newer.
- Native Gateway/API impact: unchanged.
- CLI fallback impact: unchanged, with the existing chat-reply fallback still explicit.

## Security Impact

- Sensitive surfaces touched: none.
- Auth/token/credential handling: unchanged.

## Validation

- `pnpm lint`
- `pnpm typegen`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check:release`
- `pnpm smoke:mission-control`

## Smoke Status

- Mission Control browser smoke: not run yet.
- Runtime golden-path smoke: not run.

## Known Limitations

- None.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading.
