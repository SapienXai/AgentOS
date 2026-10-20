# OpenClaw 2026.10.5 Upgrade Plan

## Scope and verified target

Upgrade AgentOS' recommended and native Gateway contract from OpenClaw `2026.9.7` to the official stable `2026.10.5`, while keeping the supported minimum at `2026.9.1`. Work is isolated on `codex/openclaw-2026-10-5-compatibility`, based on the requested starting commit `7dcb7fc8f9dfe32af21b9379f4caceb43f4f81b7`.

The official `v2026.10.5` tag and published package agree on source commit `1b58cb9a1b4f4353e1add63c8506db4d890962e8`. The package reports build ID `2026.10.5-release-1b58cb9a1b4f-2026-10-18T17-23-40.943Z`, protocol 4, state schema 20, and agent schema 25. npm integrity is `sha512-9rCuXMweqVKZIK3KBtGcLzesz9G6+FmQ30lvwomRhmcNWDcOtlBoqdLbPditoJMuTP55jPqXpt1AA0L8tSzFHg==`. The official multi-architecture image index is `sha256:f40d1e66fd14d8c5b49c832f4100f83b53fdc01f5108f7db11de38fd0ee6dbe5`.

## Ownership decision

- OpenClaw owns Gateway methods and events, schemas, agent/session/task runtime, plugins/tools, model catalogs, update/Doctor/restart/migration, and runtime truth.
- AgentOS owns the operator UI, normalized projections, bounded compatibility analysis, secure-browser task binding sidecar, and operator confirmation flow.
- Compatibility work stays in the existing Gateway/client/adapter/application-service boundaries. Static analysis remains bounded and non-executing. No parallel updater or runtime lifecycle is introduced.

## Findings and priorities

- **P0 — Release discovery parser gap (resolved).** A clean baseline release-watch found all seven stable releases after 9.7 through 10.5. The descriptor parser now handles shared policy identifiers and structured metadata without evaluating upstream code; the full transition chain was regenerated. Five policy changes remain classified as runtime-review/unknown by the bounded static analyzer and are recorded as such.
- **P0 — Runtime and contract pins (updated in this branch; certification pending).** The Gateway packages, exact identity contract, browser-policy package metadata, and Railway image now target official 10.5. The default recommendation remains 9.7 and the fallback compatibility manifest marks 10.5 as a candidate requiring explicit opt-in. The supported minimum remains 9.1; no compatibility policy promotion was performed.
- **P0 — Schema migration (migration passes; native updater has a blocker).** The disposable 9.7→10.5 schema migration and fresh-install paths passed. The actual 9.7 native `update.run` swapped the package and recovered the 10.5 Gateway, but its post-install verifier then failed because the old 9.7 verifier could not read the migrated schema 20 state. A separate native `update repair` completed and restored health. The original update run remains failed, so update lifecycle certification does not pass.
- **P1 — Gateway contracts changed across the release chain.** The release chain adds nine methods and removes none. AgentOS now compiles against the exact 10.5 client/protocol packages. Policy changes and remaining static unknowns stay visible in the report.
- **P1 — Tool approval semantics.** The AgentOS browser policy hook preserves managed target/profile binding, domain allowlisting, and fail-closed behavior. The 10.5 policy contract is covered by focused tests and source review; unknown static transition classifications are not treated as proven compatible.
- **P1 — Plugin and deployment artifacts.** Railway's exact official image pin and standalone dependency tracing were updated. The local container starts and reports healthy with a temporary isolated configuration. ClawHub build/tests and 10.5 validation are run separately below.
- **P2 — Documentation and regression checks.** User-facing version claims, release watcher expectations, runtime guidance, and assertions were refreshed. Historical 9.4/9.7 evidence remains unchanged.

## Implementation sequence

1. Extend the static descriptor parser for the exact 10.5 table grammar, including safe local constant resolution, policy metadata, and structured session-access data; unknown executable expressions must remain rejected. Add fixtures from official tags and parser/security tests.
2. Re-run release discovery and produce a complete `2026.9.7 → 2026.10.5` transition report. Keep discovery, static compatibility, and certification statuses distinct.
3. Upgrade root Gateway dependencies and the plugin/browser-policy validation targets; use typecheck and focused contract tests to identify concrete API changes.
4. Verify session/task streaming and restart behavior, Human Control approvals, model/provider discovery, config, plugin/skill/memory operations, and native update/Doctor behavior against exact disposable 10.5 runtime state. Treat unavailable live integrations and skipped observations as such.
5. Verify fresh install, 9.7→10.5 migration, restart persistence, native update recovery, Railway image build/smoke, and plugin packaging. Record exact package/image identities and separate simulated from real-runtime evidence.
6. Promote version constants and the compatibility manifest only after required gates pass; regenerate certification artifacts and user-facing version claims, then commit reviewable phases.

## Validation and delivery gates

Run focused parser/watcher/compatibility tests first, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check:certification-freshness`, and `pnpm check:release` where applicable. Run existing exact-runtime certification scripts only with isolated temporary HOME, state, config, workspaces, credentials, and loopback ports. Run plugin build/validation and a pinned Railway Docker build. Do not use production Gateway state, publish packages, push, deploy, or perform destructive migrations.

For review, retain a local recovery path to the prior AgentOS commit and 9.7 image digest. Use OpenClaw's documented native migration/update recovery and preserve disposable pre-migration state during certification; production rollback readiness remains unproven until that exact path passes. Promotion and production rollout are separate decisions.

## Execution results — 2026-10-20

- **Release discovery:** the complete stable chain is `2026.9.7 → 2026.9.8 → 2026.9.9 → 2026.10.1 → 2026.10.2 → 2026.10.3 → 2026.10.4 → 2026.10.5`. Exact tag, package, client, protocol, and multi-architecture image identities were independently verified. Static analysis found no method removals; nine methods were added. Five policy changes remain runtime-review/unknown, with no static blockers.
- **Exact runtime:** fresh install, 9.7→10.5 migration, Gateway contracts, identity/authorization, multi-user flows, official lifecycle checks, secure-browser persistence/restart/revoke, and local container health passed in isolated disposable environments. Live provider/channel credentials were not used; associated runtime scenarios remain skipped or unverified.
- **Native updater:** one real local `update.run` request was made from isolated 9.7 state. It performed the 10.5 package swap, then the 9.7 post-install verifier rejected the new schema 20 state and left the run failed with `state-migrated-no-rollback`. A separate `update repair` completed Doctor/plugin/config convergence and restored a healthy, ready 10.5 Gateway. This is recovery evidence, not a successful `update.run`; no second update attempt was made.
- **Repository validation:** `pnpm lint` passed without warnings; `pnpm typecheck`, `pnpm test` (2,201/2,201), `pnpm build`, and `pnpm check:release` passed. The isolated container smoke returned HTTP 200 and OpenClaw 10.5 health; the secure-browser smoke passed persistence, crash restart, and revoke. ClawHub validation and final evidence freshness are tracked separately.
- **Status:** `DISCOVERY_COMPLETE`, `CERTIFICATION_PENDING`. The default recommendation remains 9.7; 10.5 is a candidate in the local compatibility manifest and the native/identity contract target. Do not claim production readiness, successful native updater certification, compatibility policy promotion, or Definition of Done. The final certification must remain failed until the updater's post-install verification failure is resolved upstream and required channel/browser acceptance is supplied.
- **Scope:** no production Gateway was used, no production state was written, and no deploy, publish, push, merge, or tag was performed. The isolated temporary OpenClaw service is removed after evidence collection.
