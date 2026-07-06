# AgentOS 0.7.4 Release Notes

AgentOS 0.7.4 is a release cut for the next npm publish and GitHub release cycle.

## Highlights

- Refreshes the published package version to `0.7.4`.
- Keeps the release tag, npm package, and install examples aligned with the new version.
- Revalidates the release packaging path before publish.

## OpenClaw Compatibility Impact

- OpenClaw required baseline: unchanged, still OpenClaw 2026.6.8 or newer.
- Native Gateway/API impact: unchanged.
- CLI fallback impact: unchanged.

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

- Mission Control browser smoke: passed.
- Runtime golden-path smoke: not run.

## Known Limitations

- None.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading.
