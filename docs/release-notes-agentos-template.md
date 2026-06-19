# AgentOS <version> Release Notes

## Highlights

- <Operator-visible change>

## OpenClaw Compatibility Impact

- OpenClaw required baseline: <version or unchanged>.
- Native Gateway/API impact: <none, improved, degraded, or changed>.
- CLI fallback impact: <none or explicit fallback change>.

## Security Impact

- Sensitive surfaces touched: <none or list>.
- Auth/token/credential handling: <unchanged or summary>.

## Validation

- `pnpm lint`
- `pnpm typegen`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check:release`
- `pnpm smoke:mission-control`

## Smoke Status

- Mission Control browser smoke: <passed, failed, or blocked with reason>.
- Runtime golden-path smoke: <not run, passed, failed, or blocked with reason>.

## Known Limitations

- <Known limitation or `None.`>

## Upgrade Notes

- Requires Node.js 24 or newer.
- Run `agentos doctor --deep` after upgrading.
