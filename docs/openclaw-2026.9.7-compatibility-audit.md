# OpenClaw 2026.9.7 Compatibility and Certification

Status: certified for AgentOS `main` code HEAD
`d4cdfb1ec6c0c3894119b57c2fba0929aa1a2185`, as of 2026-10-01.

AgentOS recommends OpenClaw `2026.9.7` and pins its native contract to that
release. The supported baseline remains `2026.9.1`. Certification means this
exact release was tested; it is not an allowlist for installation. An authorized
user may still install a newer stable target through OpenClaw's native updater
after informed confirmation when AgentOS has no known compatibility or safety
blocker.

## Verified upstream identity

The official [OpenClaw release index](https://github.com/openclaw/openclaw/blob/main/docs/releases/index.md)
and npm's `latest` dist-tag identified `2026.9.7` as the stable release on
2026-10-01. The exact package identity was checked against the published npm
metadata and the official release/tag:

| Identity | Verified value |
| --- | --- |
| Version / tag | `2026.9.7` / [`v2026.9.7`](https://github.com/openclaw/openclaw/releases/tag/v2026.9.7) |
| Release published | `2026-09-30` |
| Source commit | [`c074824a27c96d3983043f9eeb33823cd1772d8c`](https://github.com/openclaw/openclaw/commit/c074824a27c96d3983043f9eeb33823cd1772d8c) |
| Build ID | `2026.9.7-release-c074824a27c9-2026-09-29T23-33-45.013Z` |
| OpenClaw package integrity | `sha512-/8N2LnfTFQPvnZizi8qKSFfnLQaPvSG3Cb4xo1YV7b4JhYiUc43ZNRpXJ01bWghLK0Ezk3HVeo/DGHcIRQwRWA==` |
| Gateway client | [`@openclaw/gateway-client@2026.9.7`](https://www.npmjs.com/package/%40openclaw/gateway-client), integrity `sha512-/3ghRJlZDOgkBxsS+i31+kqZHrref/0+N2UbOigcHPbHIR1bCh7HmHOZS6gC3bURC8EDhgZVSzm1UtN2f/RA1g==` |
| Gateway protocol package | [`@openclaw/gateway-protocol@2026.9.7`](https://www.npmjs.com/package/%40openclaw/gateway-protocol), integrity `sha512-0g/B9YzeCCNOYBrF/BDwGax5rm/t4UjqTSYUU87yZUlnsTpzEFla8PGMAINhRgMIxVFpnY/XZsxV5PDBQo37/g==` |
| Gateway protocol / schemas | protocol `4`, state schema `19`, agent schema `24` |

The release tag object is `a05c851cc522fb5e6bc347f1eb0ff10d8f378fcc` and is
not GitHub signature-verified. Certification therefore binds the exact source
commit and published npm package integrity; it does not claim a signed tag.

## Cumulative 2026.9.4 → 2026.9.7 contract review

| Release transition | Upstream changes relevant to AgentOS | AgentOS disposition |
| --- | --- | --- |
| `2026.9.4 → 2026.9.5` | Gateway descriptor added 20 methods; no methods were removed and no scopes changed. Release changes also improved retained-history handling, repeated repair, startup Doctor behavior, and managed-service environment refresh. | No AgentOS-required method or authorization change was found. OpenClaw continues to own update, restart, repair, and recovery. |
| `2026.9.5 → 2026.9.6` | Removed `sessions.compaction.branch`, `.list`, and `.restore`; changed `sessions.github.publish` from `operator.write` to `operator.sessions.write`. Managed upgrade and restart recovery behavior also changed. | AgentOS does not call the removed compaction methods. Session GitHub capability and native scope remain Gateway-derived and optional. No permissions were widened. |
| `2026.9.6 → 2026.9.7` | Added 11 Gateway methods and removed optional `tasks.cancel`, `tasks.dismiss`, `tasks.get`, `tasks.history`, `tasks.list`, and `tasks.retry`. Session-message subscriptions gained an optional stable `subscriptionId` for separately addressed observers. Update recovery preserves state across migration and rollback. The core descriptor added `lifetime: "observation"`. | AgentOS sends observer IDs to 2026.9.7+ Gateways and omits them for older Gateways, whose closed subscribe/unsubscribe schemas accept only the session key. Session inventory stays required; task inventory degrades only where removed optional methods are used. The descriptor parser preserves the supported `observation` value and fails visibly on unknown values or shapes. New upstream capabilities are not exposed as AgentOS features by this work. |

The release-watch evidence includes exact tag identity, complete recursive-tree
evidence, descriptor evidence, contract diffs, and the refreshed 2026.9.5,
2026.9.6, and 2026.9.7 intake records. The authenticated
[`OpenClaw Release Watch` workflow run](https://github.com/SapienXai/AgentOS/actions/runs/36852077822)
updated the existing intake issues instead of creating duplicates. The earlier
local HTTP 403 did not count as upstream evidence and required no watcher code
change. Archived watcher output is in
[`docs/evidence/openclaw-release-watch-2026.9.7/`](./evidence/openclaw-release-watch-2026.9.7/).

## Runtime and security evidence

Certification used exact disposable OpenClaw packages, temporary HOME/state,
isolated configuration and workspaces, and loopback ports. The `2026.9.4` to
`2026.9.7` migration ran through OpenClaw's native Doctor/runtime path and
verified migrated configuration, agent/session state, schemas, workspace
markers, and reconnect. Production Gateway, production state/configuration,
Railway, and real credentials were not touched.
Host-specific workspace and temporary-directory roots were redacted from
archived summaries; test outcomes and relevant relative evidence remain intact.

The disposable native update lifecycle reached `2026.9.7` through OpenClaw's
own CLI updater and verified terminal update status, restart/reconnect, runtime
health, installed version, interpretable configuration, and recovery state. The
AgentOS Gateway `update.run` handoff in that particular live run was skipped
because a managed-service handoff owner was unavailable; the recorded result is
not represented as a live AgentOS Gateway mutation. AgentOS's native update
authorization, stale-confirmation, replay, concurrency, target, channel,
generation, and known-blocker protections remain covered by the policy and
security suites.

The final generated certification artifact reports 21 matrix entries passed,
0 failed, 102 skipped observations, and 0 environment-limited. It records 67
expected native authorization denials separately. The channel browser
acceptance covers its disposable provider fixtures; real Telegram credentials
were unavailable and no live Telegram account was used. The skipped observations
and the native Gateway `update.run` limitation above remain visible in the
underlying evidence rather than being described as live passes.

## Promotion and evidence

The promoted values are:

- `OPENCLAW_SUPPORTED_BASELINE_VERSION = "2026.9.1"`
- `OPENCLAW_RECOMMENDED_VERSION = "2026.9.7"`
- `OPENCLAW_NATIVE_CONTRACT_VERSION = "2026.9.7"`
- `@openclaw/gateway-client = 2026.9.7`
- `@openclaw/gateway-protocol = 2026.9.7`

The exact identity contract and compatibility manifest carry the 2026.9.7
identity as verified. A future stable target without an exact certification
record remains *not yet verified*, not denied, when the native Gateway exposes
the exact target and all authorization, channel, runtime, safety, and informed
confirmation checks pass. Explicitly incompatible targets and unmet AgentOS
minimum-version requirements remain server-side blocked.

The generated final artifact is
[`openclaw-2026.9.7-pre-merge-final-certification.json`](./evidence/openclaw-2026.9.7-pre-merge-final-certification.json).
It binds the promoted implementation HEAD
`d4cdfb1ec6c0c3894119b57c2fba0929aa1a2185`, the separate evidence commit
recorded in its provenance, exact upstream/package identity,
static contract evidence, disposable runtime and migration evidence, security
evidence, and the full certification matrix. The freshness check derives this
artifact from current OpenClaw policy and passes on documentation/evidence-only
commits after the certified code HEAD.
