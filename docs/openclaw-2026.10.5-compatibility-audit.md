# OpenClaw 2026.10.5 Compatibility Audit

**Status: NOT CERTIFIED.** AgentOS recommends OpenClaw 2026.9.7, supports a 2026.9.1 minimum, and targets the 2026.10.5 native contract as an explicit candidate. The compatibility manifest still requires opt-in and preflight for 10.5.

## Architecture and ownership

OpenClaw remains the source of truth for Gateway methods, schemas, agent/session/task runtime, plugins, tools, models, Doctor, updates, and lifecycle. AgentOS keeps its operator UI and normalized domain projections above the existing Gateway client, adapters, and application services. This upgrade adds no parallel updater, runtime, or Gateway transport.

The confirmed parser defect was in bounded static analysis: OpenClaw 10.5 descriptors referenced shared policy constants and structured metadata that the old parser rejected at row 39. The parser now resolves supported local constants and metadata without evaluating upstream source. Unknown expressions remain fail-closed. The full transition chain now emits review artifacts, but the last intake and runtime policy gates remain open.

## Cumulative release comparison

The report combines the seven adjacent transitions from 2026.9.7 through 2026.10.5. The table counts changed server-method and protocol files per transition; paths can repeat across transitions.

| Transition | Methods added | Methods removed | Warnings | Unknowns | Server files | Protocol files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026.9.7 → 2026.9.8 | 0 | 0 | 2 | 0 | 13 | 1 |
| 2026.9.8 → 2026.9.9 | 0 | 0 | 2 | 0 | 7 | 1 |
| 2026.9.9 → 2026.10.1 | 23 | 0 | 4 | 0 | 757 | 89 |
| 2026.10.1 → 2026.10.2 | 0 | 0 | 2 | 0 | 16 | 1 |
| 2026.10.2 → 2026.10.3 | 0 | 0 | 2 | 0 | 3 | 1 |
| 2026.10.3 → 2026.10.4 | 0 | 0 | 1 | 0 | 0 | 1 |
| 2026.10.4 → 2026.10.5 | 9 | 0 | 2 | 5 | 714 | 63 |
| **Total** | **32** | **0** | **15** | **5** | **1,510** | **157** |

The analyzer found no static blockers and no evidence gaps in these transition records. Its schema, event, scope, and configuration-key change arrays are empty. Protocol files still changed, so runtime payload checks remain relevant. The complete machine-readable chain is [openclaw-2026.9.7-to-2026.10.5-contract-diff.json](/Users/kazimakgul/.codex/worktrees/openclaw-2026-10-5/AgentOS/docs/evidence/openclaw-2026.9.7-to-2026.10.5-contract-diff.json), with each source intake and diff in [the release-watch evidence directory](/Users/kazimakgul/.codex/worktrees/openclaw-2026-10-5/AgentOS/docs/evidence/openclaw-release-watch-2026.10.5).

### Added Gateway methods

OpenClaw 2026.10.1 adds 23 methods: `backup.status`; the 12 `mcp.app.*` methods `discover`, `formResource`, `launch`, `mention`, `modelContext`, `onboard`, `openFile`, `removeModelContext`, `settings`, `subscribeResource`, `unsubscribeResource`, and `writeResource`; `memory.get`, `memory.status`; `session.reactions.list`, `session.reactions.set`; `sessions.catalog.import`, `sessions.files.assets`; `storage.locations.list`, `storage.locations.probe`; and `worktrees.recoverRemoval`, `worktrees.retireSnapshot`.

OpenClaw 2026.10.5 adds `catalog.browse`, `catalog.searchKeywords`, `claws.removalJournal`, `sessions.processes.list`, `sessions.processes.stop`, and `skills.workshop.archive`, `skills.workshop.changes`, `skills.workshop.list`, `skills.workshop.restore`. Method availability alone does not add an AgentOS UI or change ownership.

### Lifetime and shared-read policy changes

In 2026.10.1, `sessions.describe` and `sessions.get` change to observation lifetime. OpenClaw can cancel these observations when the requester disconnects or restart drain begins. AgentOS callers must handle cancellation as an ordinary lifecycle result.

In 2026.10.5, five shared-read policies require runtime review. The descriptor specifies a 1,000 ms sharing window for each:

| Method | Share key | Invalidation events |
| --- | --- | --- |
| `chat.metadata` | `operatorReadShareKey` | `chat.metadata.changed`, `sessions.changed` |
| `cron.list` | `cronListShareKey` | `cron`, `sessions.changed` |
| `cron.status` | `operatorReadShareKey` | `cron` |
| `models.list` | `modelsListShareKey` | `chat.metadata.changed`, `sessions.changed` |
| `sessions.list` | `operatorReadShareKey` | `sessions.changed`, `chat.metadata.changed` |

Static evidence cannot establish caller isolation or invalidation timing for these policies. They remain `UNKNOWN`; certification needs live cross-caller and invalidation probes.

## Exact release identity and deployment pin

The official `v2026.10.5` tag object is `9171d0a427738902efd811c648325cf54116743c`. Its peeled commit is `1b58cb9a1b4f4353e1add63c8506db4d890962e8`, matching the runtime build identity prefix `1b58cb9a1b4f`. The release watcher intake still says `Git tag commit` is missing; a later targeted refresh returned `fetch failed`. The tag ref is recorded at [openclaw-2026.10.5-tag-ref.txt](/Users/kazimakgul/.codex/worktrees/openclaw-2026-10-5/AgentOS/docs/evidence/openclaw-release-watch-2026.10.5/openclaw-2026.10.5-tag-ref.txt).

The OpenClaw package integrity is `sha512-9rCuXMweqVKZIK3KBtGcLzesz9G6+FmQ30lvwomRhmcNWDcOtlBoqdLbPditoJMuTP55jPqXpt1AA0L8tSzFHg==`; the Gateway client and protocol packages are also pinned to 2026.10.5 with their exact integrity values in the committed intake. The target uses Gateway protocol 4, state schema 20, and agent schema 25.

`Dockerfile.railway` pins `ghcr.io/openclaw/openclaw:2026.10.5@sha256:f40d1e66fd14d8c5b49c832f4100f83b53fdc01f5108f7db11de38fd0ee6dbe5`. The multi-architecture manifests are amd64 `sha256:0be6e07c5c99cdd4466dc9186dc89ebbf68ca8e045c44b4cc496c441a9af1a9e` and arm64 `sha256:31a4b7eb2bb9574527a1e46b2208e1b653f060753dd36fe3da444f79a7d03f0c`. The image was built and smoke-tested locally; Railway production was not inspected or changed.

## AgentOS changes and validation

The implementation pins the official Gateway client/protocol and runtime build to 10.5, updates the native identity and compatibility contracts, extends descriptor parsing and fixtures, refreshes the browser-policy plugin contract, and updates the Railway image digest. Candidate policy keeps 10.5 opt-in and retains the 9.7 recommendation. The freshness checker now selects the native-contract version explicitly while reporting the recommendation separately.

The ClawHub plugin built, passed six tests, and passed local validation/packaging. No package was published. Repository validation passed `pnpm lint`, `pnpm typecheck`, `pnpm test` (2,202/2,202), `pnpm build`, and `pnpm check:release`. The freshness unit tests passed 10/10. The final certification-freshness command reaches the 10.5 artifact and fails because the final artifact reports `success: false`.

Previous isolated fresh-baseline, migration, identity, multi-user, and lifecycle outputs are archived under [openclaw-2026.10.5-prior-runtime](/Users/kazimakgul/.codex/worktrees/openclaw-2026-10-5/AgentOS/docs/evidence/openclaw-2026.10.5-prior-runtime). Artifacts with a declared AgentOS code HEAD were generated at `9c330b76eaa10cfbf3961c19d4b9f69c86132c05`; they are historical inputs, not current-code certification passes.

## Blocking runtime evidence and next requirements

A real local OpenClaw Gateway API `update.run` was invoked once from 2026.9.7 against exact 2026.10.5. The package swap completed, then `post-install-verify` failed with `state-migrated-no-rollback` because the old verifier could not open the migrated state schema 20. A separate native `update repair` converged Doctor, plugins, and config; the Gateway reconnected healthy on 10.5. The original API update record remains failed, and no second update attempt was made. Evidence: [openclaw-2026.10.5-native-update-lifecycle.json](/Users/kazimakgul/.codex/worktrees/openclaw-2026-10-5/AgentOS/docs/evidence/openclaw-2026.10.5-native-update-lifecycle.json).

The pre-merge aggregate currently reports `FAIL`, with 0 of 21 required artifacts passing. It records the failed native update, 19 missing current-code evidence files, five unresolved read-sharing policies, incomplete watcher identity metadata, missing exact package tarballs, and absent channel/browser acceptance. Live providers and channel credentials were not used.

Production readiness is unproven. No production Gateway or state was touched; no deploy, publish, push, merge, or tag was performed. OpenClaw 2026.10.5 must remain a candidate until the native update completes successfully, read-sharing policies receive live isolation and invalidation tests, the watcher identity intake is complete, and the required current-code certification artifacts pass.

Official references: [OpenClaw v2026.10.5 release](https://github.com/openclaw/openclaw/releases/tag/v2026.10.5), [10.5 changelog](https://raw.githubusercontent.com/openclaw/openclaw/v2026.10.5/CHANGELOG/2026.10.5.md), [tool policy hook documentation](https://docs.openclaw.ai/plugins/hooks/tool-policy).
