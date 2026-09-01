# AgentOS 0.7.7 Release Notes

AgentOS 0.7.7 completes the OpenClaw 2026.8.1 first-stable integration and packages the certified lifecycle, identity, trusted-team, session/task, and automation alignment work.

## Highlights

- Completes the OpenClaw 2026.8.1 migration with unified Gateway lifecycle ownership, external supervision, canonical runtime discovery, restart/reconnect continuity, and crash recovery.
- Establishes server-derived AgentOS actor identity, Instance Protection v2 migration, owner/member product authorization, and auditable human attribution.
- Aligns AgentOS sessions and tasks with OpenClaw runtime authority, including explicit cancellation timing and sharing limitations.
- Aligns automation and cron behavior with the native OpenClaw 2026.8.1 contract and documents unsupported or runtime-dependent operations honestly.
- Closes the final five pre-existing UI/source-shape regression contracts without identifying an implementation regression.

## OpenClaw Compatibility Impact

- OpenClaw required baseline: 2026.8.1, source commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`, certified build `2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z`.
- Native Gateway/API impact: lifecycle, identity capability inspection, session/task alignment, and automation/cron integration are certified against the exact 2026.8.1 Gateway contract.
- CLI fallback impact: unchanged and remains explicit for installation, recovery, Gateway process control, and operations without a stable native Gateway method.
- Compatibility coverage: stable and beta CI compatibility checks passed, and the final isolated certification gate passed.

## Security Impact

- Sensitive surfaces touched: instance protection, actor/session authentication, product authorization, lifecycle/control-plane routes, user/profile boundaries, and shared privileged Gateway transport.
- Auth/token/credential handling: actor IDs and effective roles are derived server-side; product authorization runs before shared privileged transport; no fake per-human OpenClaw credentials are created; certification evidence contains no secrets.
- Trusted-team limitation: OpenClaw attribution remains shared-service because AgentOS uses one trusted backend Gateway connection. Mutually untrusted tenants require isolated AgentOS/OpenClaw security domains.

## Validation

- `pnpm lint`
- `pnpm typegen`
- `pnpm typecheck`
- `pnpm test` — 1063 passed, 0 failed
- `pnpm build`
- `pnpm check:release`
- `pnpm openclaw:final-certification` — final certification gate passed
- `pnpm smoke:mission-control` — passed in CI
- OpenClaw stable and beta compatibility checks — passed in CI

## Smoke Status

- Mission Control browser smoke: passed in CI.
- Runtime golden-path smoke: passed through the final isolated OpenClaw 2026.8.1 certification matrix.
- Package smoke: release-prep package/tarball smoke is required before publishing each platform artifact.

## Known Limitations

- Task cancellation timing may be classified as `SKIPPED-runtime-timing` when a disposable task is already terminal before a safe cancellation window.
- OpenClaw runtime attribution remains shared-service; AgentOS audit records preserve the human actor independently.
- AgentOS does not persist or manufacture per-human OpenClaw Gateway credentials in this release.
- OpenClaw 2026.8.1 does not expose a general cron-run cancellation RPC through the certified contract.
- Recurring runs are not automatically one continuous conversation unless explicit OpenClaw target/session semantics select that behavior.

## Upgrade Notes

- Requires Node.js 24 or newer and OpenClaw 2026.8.1 or newer.
- Stop an existing local AgentOS process before replacing a release installation when needed, then run `agentos doctor --deep` after upgrading.
- Verify Gateway reachability, native authentication, granted scopes, model readiness, and any degraded fallback in `agentos doctor --deep` before assigning real work.
- Preserve the existing OpenClaw state and credentials during upgrade; remove runtime state only as an intentional recovery action.
