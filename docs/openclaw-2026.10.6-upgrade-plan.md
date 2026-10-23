# OpenClaw 2026.10.6 Upgrade and Runtime Hardening

## Status

**CANDIDATE — not certified.** AgentOS keeps OpenClaw `2026.9.7` as its
certified recommendation and `2026.9.1` as its supported baseline. OpenClaw
`2026.10.6` is the current native contract target and remains behind the
existing explicit candidate/preflight path until the required compatibility
and lifecycle evidence passes. No release, push, or deployment is part of this
work.

Work is being performed on the existing `main` checkout from base commit
`cd85342d53e444b904db367cbacb19999a6e232d`.

## Verified upstream identity

The official stable release is [OpenClaw v2026.10.6](https://github.com/openclaw/openclaw/releases/tag/v2026.10.6).
Its tag object is `3494baecba2366a89fa703158a2c2b5c9edcd6ba`, peeled source
commit `fe06181dc5ecc01cf8904abbfc26925925efefbc`, and runtime build ID
`2026.10.6-release-fe06181dc5ec-2026-10-22T08-54-27.830Z`. The published
OpenClaw npm package integrity is
`sha512-jSpQPa2Jw5rG0J2GC07j9+qHtVYIuoHjgccU88JeS+p7188sBCnvIJeuaiNPHj1zsWkuHcBv443QiEUh7qrxwA==`.
The official Gateway packages are `@openclaw/gateway-client@2026.10.6`
(`sha512-9CEcDipfyMelNnCeviiIzHpZqi78zI0IhOsgwlml040ev5j2FxtfhCOisrRzlsK3jfLKWtD5i9IZ5p11Qz8ZHg==`)
and `@openclaw/gateway-protocol@2026.10.6`
(`sha512-U7/rN80eVEAEkJIFjRCwntfSHrxE9mRH+zy9Bira9nkdbNsklq3C0SfN+WaDM8wPeh9GqYKKWksxGC1AljWy2w==`).
The package reports Gateway protocol 4, state schema 20, and agent schema 25.

The official OpenClaw image is pinned to multi-architecture index
`ghcr.io/openclaw/openclaw:2026.10.6@sha256:7dbff0fe5f5359b1badefe90a23efa9f203cd0d3c36bee095f4896c7a1d3864b`;
its runtime reports Node.js `24.22.1`. The AgentOS build and browser-worker
images use the official `node:26.12.1-bookworm` index
`sha256:5c4012d11d9857c42713ba511fbc19645cac1706bb710d51d42b0d301dff7f88`.

## Compatibility review

An exact local comparison of the official `v2026.10.5` and `v2026.10.6` tag
checkouts used AgentOS's existing descriptor parser/comparator and is recorded
in [`openclaw-2026.10.5-to-2026.10.6-static-contract-review.json`](evidence/openclaw-2026.10.5-to-2026.10.6-static-contract-review.json): both expose
519 registered core methods and no descriptor changes. The exact tag diff
contains 15 Gateway server-method files and two protocol files. Update and
session implementation changed, including system-agent approval and
session-abort recovery. The last cached release-chain analysis reported 0
static blockers, 2 warnings, and 0 unknown classifications. GitHub release
metadata refresh returned HTTP 403, so no current machine-readable release
intake or contract-diff artifact was regenerated; the cached classification
is context only and is not final-certification evidence. Static comparison is
not runtime certification.

OpenClaw remains the owner of the Gateway, update lifecycle, migrations,
sessions, task recovery, plugins, and provider/channel execution. AgentOS keeps
the existing official Gateway client and normalized adapter/service boundary;
this change adds no parallel runtime or updater.

## Node.js policy

OpenClaw 2026.10.6 documents Node.js `24.22.1+` on the Node 24 line and
`26.12.1+` on the Node 26 line, with Node 26 recommended. AgentOS package
engines now allow `>=24.22.1 <25 || >=26.12.1`; AgentOS-owned CI, desktop,
Railway build, and browser-worker paths use Node `26.12.1`. Railway's official
OpenClaw runtime container supplies its own Node `24.22.1`. The OpenClaw
source-build pnpm toolchain remains separate from AgentOS's `pnpm@10.30.3`.

Node `26.12.1` was obtained from the official Node.js distribution and its
macOS ARM64 archive was checked against the official SHA-256 manifest. A
`node:sqlite` round-trip containing embedded NUL text passed on Node 26.12.1.
The installer, CLI, compatibility smoke, and desktop runtime checks now
enforce patched floors rather than checking only major/minor versions.

## Previous native updater failure

The 2026.10.5 record documents one isolated native `update.run` from 9.7:
OpenClaw swapped packages and migrated state, then the old 9.7 post-install
verifier rejected schema 20 with `state-migrated-no-rollback`. A separate
native `update repair` restored Doctor/plugin/config convergence and a healthy
10.5 Gateway, but did not change the failed API run to success. Package
rollback does not reverse database migrations.

On exact disposable state, both native API upgrade paths now pass the existing
AgentOS checks: 9.7→10.6 in
[`openclaw-2026.10.6-native-update-lifecycle.json`](evidence/openclaw-2026.10.6-native-update-lifecycle.json)
and 10.5→10.6 in
[`openclaw-2026.10.6-native-update-from-2026.10.5.json`](evidence/openclaw-2026.10.6-native-update-from-2026.10.5.json).
Each run recorded the exact 10.6 target, a fresh healthy Gateway, and
`serviceRestartSafe: true`. This resolves the reproduced successful-upgrade
path in these fixtures; an intentionally failed native update followed by
recovery is still unverified. The successful-path runs do not imply that a
database migration can be undone by restoring package files.

All upgrade checks must use a separate disposable HOME, state, config,
workspace, package prefix, credentials, and loopback ports. No production or
user Gateway may be used.

## Validation record

Repository checks were run with Node.js `26.12.1` and pnpm `10.30.3`, except
the official OpenClaw container smoke, which reported Node.js `24.22.1`.

Passed:

- `pnpm install --frozen-lockfile`, `pnpm check:release`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test` (2,205 passed, 0 failed), and `pnpm build`.
- Direct 10.6 install and 9.7→10.6 plus 10.5→10.6 native migrations; see
  [`openclaw-2026.10.6-fresh-baseline.json`](evidence/openclaw-2026.10.6-fresh-baseline.json),
  [`openclaw-2026.9.7-to-2026.10.6-migration.json`](evidence/openclaw-2026.9.7-to-2026.10.6-migration.json),
  and [`openclaw-2026.10.5-to-2026.10.6-migration.json`](evidence/openclaw-2026.10.5-to-2026.10.6-migration.json).
  State schemas migrated 19→20 and agent schemas 24→25; representative state,
  security policy, and reconnect checks passed.
- Both native `update.run` paths, plus managed/external Gateway start, stop,
  restart, reconnect, session continuity, crash recovery, and crash-loop
  protection. Lifecycle cleanup confirmed all disposable Gateway processes
  stopped and fixtures removed.
- Official transport and Gateway lifecycle, session/task alignment, identity
  and authorization, multi-user isolation/collaboration, workforce fixture,
  Human Control, native work, skills/capabilities, memory, automation/cron,
  and standard plus hardening Doctor certifications. These results are
  simulated or exact disposable runtime evidence as recorded in each JSON;
  provider fixture coverage is not live provider proof.
- AgentOS package validation/smoke, desktop runtime preparation/check/smoke,
  browser-worker and Railway Docker builds, Railway container `/api/health`
  smoke on OpenClaw 10.6, browser-worker health, and secure-browser
  persistence/restart/revoke smoke. No package was published and no image was
  deployed.
- Node.js `26.12.1` archive checksum and SQLite embedded-NUL round-trip;
  Node.js `24.22.1` SQLite behavior inside the official OpenClaw image.

Remaining blockers and limits:

- `pnpm check:certification-freshness` fails because the required
  `openclaw-2026.10.6-pre-merge-final-certification.json` is absent. The full
  final aggregate is not being reported as passed.
- The current release-watch refresh returned HTTP 403 from GitHub metadata;
  no refreshed 10.6 release-intake or machine-readable contract-diff artifact
  was produced. The cached 10.5→10.6 analyzer result is only a prior static
  review and is not current final-certification evidence.
- Fresh-install/runtime artifacts pass their direct 10.6 runtime checks, but
  their nested 9.1→10.6 static-contract section remains `unknown` because the
  GitHub release comparison could not be fetched. Do not interpret the
  runtime artifact's `success: true` as clearing that separate static gate.
- Live OpenAI/OpenRouter credentials and Telegram, Discord, and WhatsApp
  accounts were not available, so those external provider/channel flows and
  human browser acceptance remain unverified. No production Gateway or
  Railway evidence was collected.
- No comparative latency, memory, or load benchmark was run. No intentionally
  injected native updater failure/recovery run was completed; migration Doctor
  recovery and successful native update recovery were exercised.
- The existing local Gateway still runs Node.js `24.21.0` on loopback port
  `18789`, below the new Node 24 floor. It was left untouched; this source
  change did not update that active service.

Build completed with 12 existing Turbopack dynamic-path warnings. The initial
full test run found four stale 10.5/runtime expectations and three workspace
provisioning races; these were corrected at their source, and the final full
suite passed 2,205/2,205 tests.

The active local Gateway process was observed using its managed Node.js
`24.21.0` executable on loopback port `18789`. It was left running and
untouched. This is below the patched Node 24 floor; updating that live service
is an operational action outside this source-only change and must be handled
separately with a verified backup/recovery path.

## Promotion gates

Keep 2026.10.6 a candidate until the existing compatibility/final
certification infrastructure has passing current-code evidence for the exact
artifact identity, fresh install and migration, both native update paths,
restart/reconnect, task/session continuity, approvals and authorization,
multi-user isolation, channels/providers where credentials permit, plugin and
browser-policy recovery, and Railway container build/smoke. Keep each result
classified as static, simulated, actual disposable runtime, or production
evidence. No production readiness claim follows from local build/test success.
