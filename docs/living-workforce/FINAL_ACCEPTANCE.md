# Living Workforce acceptance

The tested code is `3c2be27082586372b52162d27d2a89d5b9a22c9c` on `main`, using AgentOS 0.11.0 and the exact OpenClaw 2026.11.10 runtime, source `6ea542fd97e2876aa4c871ccc494ed5419a03c5c`. Living Workforce is the working 0.12 milestone.

## From assignment to result

A default employee can take a plain-language assignment, read the approved workspace source, and return a Markdown report and CSV. The operator can open the result from the mission, agent or relevant conversation, download the scoped files and review the work. File availability, runtime outcome and acceptance are presented separately. The open work and result remain accessible after navigation or reload. Scheduled work shows a current result and previous runs on desktop and phone.

- Assignment and employee setup previously risked applying defaults that the selected model or native policy could not satisfy. AgentOS now keeps explicit native restrictions, checks the scoped model inventory during dispatch and starts ordinary work with the compatible thinking default. Managed instructions encourage action, verification and consolidated questions.
- Native child sessions had parent evidence that was dropped during normalization. Workforce now binds the observed parent session and native run to the mission and displays actual waiting, failure and cancellation.
- A completed run or suggested path could appear as proof of a deliverable. The result uses observed evidence and bounded, authorized files. Downloads fail closed on the wrong workspace or mission and unsafe paths.
- Schedule creation held the operations registry lock while refreshing the same registry through Mission Control. Workspace lookup now runs outside that lock. Native scheduler IDs and outputs are exposed through the existing Operations history.

## Browser and Canvas

A production browser suite exercised desktop (1440 × 900), tablet (820 × 1180), landscape phone (844 × 390) and narrow phone (390 × 844), each in light and dark. It covered Canvas, workspace selection, Team, Chat, Tasks, Knowledge, Integrations, Settings, download and acceptance. Canvas checks covered graph dimensions, node position and size, drag persistence, zoom, fit and the inspector. The five captured nodes retained the same type, position, width and height in all eight viewport and theme pairs. The screenshots include the observed activity and result changes. Automatic fit produced slightly different transforms in the desktop captures.

| Surface | Before | After |
| --- | --- | --- |
| Canvas and finished work | [Desktop, dark](evidence/before/dark-1440-canvas.jpg) · [Phone, light](evidence/before/light-390-canvas.jpg) | [Desktop, dark](evidence/after/dark-1440-canvas.jpg) · [Phone, light](evidence/after/light-390-canvas.jpg) |
| Team | [Desktop](evidence/before/dark-1440-team.jpg) · [Tablet](evidence/before/light-820-team.jpg) | [Desktop](evidence/after/dark-1440-team.jpg) · [Tablet](evidence/after/light-820-team.jpg) |
| Task result | [Desktop](evidence/before/dark-1440-task-detail.jpg) · [Landscape](evidence/before/dark-844-task-detail.jpg) | [Desktop](evidence/after/dark-1440-task-detail.jpg) · [Landscape](evidence/after/dark-844-task-detail.jpg) |
| Download and review | | [Download](evidence/after/dark-1440-deliverable-download.jpg) · [Reviewed on phone](evidence/after/light-390-deliverable-review.jpg) |
| Live work and delegation | | [Active Canvas mission](evidence/after/dark-1440-active-mission.jpg) · [Delegated child failure](evidence/after/dark-1440-delegated-child-failed.jpg) |
| Human intervention and model blocker | [Model setup blocker](evidence/before/light-390-task-detail.jpg) | [Native question](evidence/after/light-390-awaiting-human.jpg) |
| Connected resource and schedules | | [Native MCP read](evidence/after/dark-1440-connected-mcp-read.jpg) · [Desktop run history](evidence/after/dark-1440-recurring-history.jpg) · [Phone run history](evidence/after/light-390-recurring-history.jpg) |

The benchmark and browser reproduction use a real disposable Gateway and a controlled model endpoint. The baseline browser run used the baseline's existing fixture and captured a blocked model setup. The candidate run used an authenticated deterministic provider fixture and actual filesystem work. The screenshot pairs illustrate the product states, and the matched graph data supports the geometry comparison. [Before browser report](evidence/browser-before.json) · [After browser report](evidence/browser-after.json) · [Canvas comparison](evidence/canvas-comparison.json)

## Reference scenarios

| Scenario | Evidence and result |
| --- | --- |
| Default hire and ordinary work | A newly created employee read the controlled source and produced Markdown and CSV. Both files reported a verified total of 20. The production browser opened the download and persisted review acceptance. |
| Workspace file work | Native read and write completed in the disposable workspace. The app refused an unrelated mission's download and rejected unsafe filesystem cases in contract tests. |
| Connected resource | Native MCP read ran over stdio and Streamable HTTP via both the Gateway and AgentOS Chat. Calls worked after restart and were denied after revocation. Telegram and Discord browser fixtures tested visible, assigned channel routes. External account authorization remains unverified. |
| Missing capability | The before capture shows a model-setup blocker. With the same alternate fixture configuration, the candidate received native model evidence and completed the turn. Scoped readiness and denial paths are covered by contract tests. A live external credential repair was outside the test scope. |
| Human intervention | The exact native mission/session question appeared in Needs You and resolved through the application. Native approval denial was honored. |
| Collaboration | OpenClaw spawned an actual child. AgentOS observed the parent waiting, child return, exact-session cancellation and child failure. |
| Recurring work | The production browser created one native cron schedule and ran it twice. Both results had distinct native IDs, completed and appeared in the same history on desktop and phone. The next schedule remains active. |
| Interrupted work | Native reconnect and repeated application reads retained the same mission and results. Duplicate submissions converged under the existing admission key. |
| Partial or failed work | Failed child state is visible beside its parent. Missing or out-of-scope files are omitted as deliverables and rejected at access. |

[Native Workforce acceptance](../evidence/openclaw-2026.11.10-workforce-acceptance.json) · [Schedule certification](../evidence/openclaw-2026.11.10-automation-cron-alignment.json) · [Human Control certification](../evidence/openclaw-2026.11.10-human-control-inbox.json) · [MCP acceptance](evidence/native-mcp.json)

## Performance and quality gates

Baseline `3b655e38` and the candidate were measured in isolation with fresh Gateway sidecars, two browser clients, two raw SSE consumers, six cold launches, two warm samples and ten native mutations at each workload. Each cell shows baseline → final candidate. Times are milliseconds.

| Agents / sessions | Cold median | Cold p95 | Warm max | Native event to DOM p95 | First actionable canvas node max | AgentOS RSS (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 / 100 | 1,060 → 1,050 | 3,046 → 3,038 | 221 → 234 | 1,805 → 1,795 | 619 → 635 | 374 → 385 |
| 50 / 500 | 1,075 → 1,067 | 1,089 → 3,079 | 328 → 236 | 2,153 → 2,123 | 625 → 630 | 424 → 432 |

The warm budget was 500 ms. Candidate useful-node timings stayed below 650 ms and cold medians below 1.1 seconds. The selector-based 3-second cold target missed in one of six samples at each scale on the final run. In the 50-agent outlier the actionable node was marked at 574 ms and a full snapshot arrived at 2,849 ms, with zero recorded long tasks. The earlier candidate run measured cold p95 at 1,112/1,079 ms. The 50-agent p95 tail remains intermittent and has no confirmed root cause at this sample size. This affects the benchmark's stable visibility check.

The final run recorded 16 → 37 cold and 133 → 147 mutation RPCs at 10 agents, and 16 → 16 cold and 123 → 123 mutation RPCs at 50 agents. The 10-agent initial candidate instead recorded 19 cold and 133 mutation RPCs. Gateway RSS moved from 1,699 → 1,646 MiB and 2,365 → 2,414 MiB. The browser and SSE consumer counts were fixed. [10-agent baseline](evidence/benchmark-before-10.json) · [10-agent final](evidence/benchmark-after-10.json) · [10-agent initial candidate](evidence/benchmark-after-initial-10.json) · [50-agent baseline](evidence/benchmark-before-50.json) · [50-agent final](evidence/benchmark-after-50.json) · [50-agent initial candidate](evidence/benchmark-after-initial-50.json)

Native identity, runtime, authorization, task, cron, memory, skills, transport, lifecycle and recovery are consolidated in the [exact-revision certificate](../evidence/openclaw-2026.11.10-pre-merge-final-certification.json). The direct Workforce suite passed 20 checks with zero skips. The pinned Gateway reported `unknown method: tasks.list`. Supported native session evidence supplies lineage. The general runtime probe recorded 59 passes, 13 optional skips and 13 expected denials, with zero failures.

| Check | Result |
| --- | --- |
| Lint, TypeScript, Next production build, release consistency | Pass |
| Unit and integration | 2,290 passed, 0 failed, 0 skipped |
| Production browser | 207 passed, including artifact bytes, review persistence, workspace switching, narrow and landscape phones, two native schedule runs and access revocation |
| Channel browser fixtures | 6 passed, including all 26 Telegram acceptance steps and Discord route inheritance |
| Mission Control smoke | Passed. Follow-up confidence and polling fallback were skipped because the corresponding states were absent. |
| OpenClaw stable and beta compatibility fixtures | Pass |
| OpenClaw native Workforce with a deterministic local model | 20 passed, 0 failed, 0 skipped |
| OpenClaw aggregate and provenance freshness | 18 artifacts passed. The freshness gate reports documentation-only changes after the certified code revision. |
| GitHub Actions | [CI on main](https://github.com/SapienXai/AgentOS/actions/workflows/ci.yml?query=branch%3Amain) |

Evidence was first bound at `a9d7a3c1`. The Git code history is `beb1e3ba` for Workforce and native dispatch, `6c278fb3` and `58bcc976` for scheduled work, `e59ad260` for browser coverage and `3c2be270` for fixture reliability. The production browser build was made from `58bcc976`. Later code commits only change test scripts and fixtures. Certificate artifacts are committed after the tested code so the freshness gate can bind both revisions.

## Local reproduction

Use the existing workspace and configured OpenClaw installation. From the existing checkout:

```sh
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. Hire a default employee in Team, add a small source file to that workspace and assign a task such as “Read the studio source data, calculate the total, and deliver a Markdown brief plus a CSV summary.” Open **Tasks → Deliverable** to download the files or review the result. In **Tasks → Scheduled**, create a recurring source check, run it twice and expand its history.

To reproduce the controlled acceptance with a local copy of the exact npm runtime.

```sh
pnpm build
pnpm exec playwright install chromium
WORKFORCE_OPENCLAW_PACKAGE=/absolute/path/to/node_modules/openclaw \
WORKFORCE_VIEWPORTS=1440,820,844,390 \
WORKFORCE_EVIDENCE=/tmp/agentos-workforce-browser \
node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/workforce-experience-preview.cjs --living-workforce
```

## Verdict

**Milestone GO for the tested native scope.** The supported hire → assign → deliver → review workflow was exercised with the pinned native runtime, as were live delegation and recurring work. The intermittent selector-based cold tail and external-account test limits are documented above.

**Public release NO-GO.** Platform package acceptance for this candidate and external production verification remain outside this milestone. `pnpm check:production-release` reports missing `docs/evidence/agentos-0.11.0-production-acceptance.json`. The last upstream release-watcher dry run stopped at HTTP 403 fetching official metadata. The committed intake and freshly generated runtime certificate retain the exact pinned package provenance. No release or production deployment was performed.
