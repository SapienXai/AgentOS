# OpenClaw 2026.10.5 Upgrade Plan

## Scope and verified target

Upgrade AgentOS' recommended and native Gateway contract from OpenClaw `2026.9.7` to the official stable `2026.10.5`, while keeping the supported minimum at `2026.9.1`. Work is isolated on `codex/openclaw-2026-10-5-compatibility`, based on the requested starting commit `7dcb7fc8f9dfe32af21b9379f4caceb43f4f81b7`.

The official `v2026.10.5` tag and published package agree on source commit `1b58cb9a1b4f4353e1add63c8506db4d890962e8`. The package reports build ID `2026.10.5-release-1b58cb9a1b4f-2026-10-18T17-23-40.943Z`, protocol 4, state schema 20, and agent schema 25. npm integrity is `sha512-9rCuXMweqVKZIK3KBtGcLzesz9G6+FmQ30lvwomRhmcNWDcOtlBoqdLbPditoJMuTP55jPqXpt1AA0L8tSzFHg==`. The official multi-architecture image index is `sha256:f40d1e66fd14d8c5b49c832f4100f83b53fdc01f5108f7db11de38fd0ee6dbe5`.

## Ownership decision

- OpenClaw owns Gateway methods and events, schemas, agent/session/task runtime, plugins/tools, model catalogs, update/Doctor/restart/migration, and runtime truth.
- AgentOS owns the operator UI, normalized projections, bounded compatibility analysis, secure-browser task binding sidecar, and operator confirmation flow.
- Compatibility work stays in the existing Gateway/client/adapter/application-service boundaries. Static analysis remains bounded and non-executing. No parallel updater or runtime lifecycle is introduced.

## Findings and priorities

- **P0 — Release discovery is incomplete.** The clean baseline release-watch found all seven stable releases after 9.7 through 10.5. Five transition analyses fail on a shared `OBSERVATION` policy identifier at descriptor row 39; 9.8 and 9.9 produce evidence but still require compatibility review. Repair descriptor parsing and regenerate the complete transition chain.
- **P0 — Runtime and contract pins are stale.** Root Gateway packages and the Railway image are 9.7; the exact identity contract is 9.7; the OpenClaw AgentOS package and browser policy plugin build metadata are 9.4. Promote only after exact 10.5 type, protocol, plugin, lifecycle, and disposable runtime evidence passes. Preserve baseline 9.1 unless evidence proves it incompatible.
- **P0 — Schema migration must be certified.** The exact target advances state schema 19→20 and agent schema 24→25 while retaining protocol 4. Test fresh setup, 9.7→10.5 migration, restart persistence, update recovery, and rollback/recovery in disposable state before promotion.
- **P1 — Gateway contracts changed across the release chain.** Compare registered methods, permissions, events, and protocol schemas from the official 9.7–10.5 tags. Compile against the 10.5 client/protocol packages and repair only demonstrated AgentOS boundary gaps.
- **P1 — Tool approval semantics need a focused review.** The AgentOS browser policy hook rewrites managed `target`/`profile` parameters and requests approval for interactive actions. Verify those transformations against 10.5's final-argument approval rules; keep the browser binding, domain allowlist, and fail-closed behavior intact.
- **P1 — Plugin and deployment artifacts drift.** Rebuild and validate the ClawHub package and browser-policy plugin against 10.5. Update Railway's pinned official image only after the same runtime certification passes.
- **P2 — Current docs and checks must match promoted policy.** Refresh live compatibility, release-watcher, and package metadata assertions; retain historical 9.4/9.7 certification evidence unchanged.

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
