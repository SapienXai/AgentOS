# Living Workforce baseline

- Main and origin/main matched at `3b655e38aa5ddbaff973aab9e8905d4cad44d972` before validation. AgentOS product version 0.11.0. Exact native acceptance target OpenClaw 2026.11.10.
- `pnpm test` passed 2,287 tests. `pnpm build` passed. The build regenerated the Next.js type reference file.
- Disposable OpenClaw workforce acceptance passed 15 checks, skipped 4, failed 0. It verified concurrent admission, idempotency, native file writes, a same-session human question, approval denial, and restart reconciliation. The fixture did not expose a child task, so delegation, waiting, cancellation, and child failure remain unverified.
- Existing main CI run 45886038924 passed stable and beta compatibility. Quality failed on certification freshness. Browser smoke was skipped. The local certification freshness check also reported stale evidence.
- The benchmark attempt stopped on disposable Gateway /healthz readiness. No latency or resource figures were collected.

## Ownership and gaps

| Journey | Existing owner and implementation | Baseline gap |
| --- | --- | --- |
| Hire and readiness | OpenClaw configuration and effective tool inventory. AgentOS presets and capability projection. | Role-declared tool metadata can diverge from effective native permissions. Compare manual, prepared workspace, guided team and import paths without overriding explicit restrictions. |
| Direct work | OpenClaw native mission admission and execution. AgentOS adds workspace goal, output instructions and correlation. | Routine work needs a clearer operating brief. Equal task titles assigned in the same second can share an output folder. |
| Deliverable | OpenClaw run outputs and actual workspace files. AgentOS Task Integrity and Mission projections. | Mission artifacts are listed by reported path without revalidating presence, workspace confinement and file type at access. Completion and evidence need separate presentation. |
| Human intervention | OpenClaw questions and approvals. AgentOS Human Control resolves the native item. | Keep the same native task/session identity visible in work and recovery. |
| Delegation | Native session tools and task ledger. AgentOS native lineage projection. | No child task appeared in the baseline turn. Verify the tool exposure and invocation in the pinned runtime before claiming coverage. |
| Schedules and connections | Native cron and account/channel authorization. Existing AgentOS operations and capability surfaces. | Verify result history and distinguish assigned, workspace-connected and observed use. |

## Exact-runtime delegation diagnosis

OpenClaw 2026.11.10 (source `6ea542fd97e2876aa4c871ccc494ed5419a03c5c`) was tested in a fresh disposable state directory with the pinned loopback model fixture and tree session visibility. The original fixture called `sessions_spawn` directly while the model was offered `dispatch_action`. When the probe routed the same input through the exposed dispatcher, OpenClaw returned `accepted` with a native child key and run ID, and `sessions.list` exposed one child. The probe Gateway returned `unknown method: tasks.list`. This proves native spawn in the fixture and a session-based observation path. AgentOS projection, waiting, cancellation and child failure still require product acceptance against the actual checkout.

A second adapted run verified that the child exposed by native `sessions.list` had the exact parent in `spawnedBy`, the requested label, and `status: done`.

The pinned AgentOS session normalizer derives state from the session key and age. It does not carry native `parentSessionKey`, `spawnedBy`, or `subagentRunState` into runtime metadata. Workforce reads task parent IDs and requester session keys. The native parent evidence should be preserved at the session normalization boundary and bound to the authorized mission session before it is presented on the work tree or Canvas.
