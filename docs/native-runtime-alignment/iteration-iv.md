# AgentOS 0.10.0 Iteration IV

**Release decision — NO-GO.** The frozen code commit is `0f9bd1a04dbea4d25fd78a63ffcb6b3d2b793078`. The reviewed baseline is `5ffd895d53503dd947d54fa6bc3fe2ef3c219898`. The candidate uses the OpenClaw, Gateway client, and Gateway protocol packages at `2026.11.10`, source `6ea542fd97e2876aa4c871ccc494ed5419a03c5c`, protocol 4. [Draft pull request](https://github.com/SapienXai/AgentOS/pull/49) · [Machine-readable measurements](iteration-iv-results.json)

## Trusted operator boundary

A protected HTTP fixture reproduced a data disclosure at the reviewed baseline. Direct chat and workspace-file reads returned 403 for a signed-in member. The same member received a private workspace marker in the snapshot, initial SSE frame, incremental SSE frame, and Settings hydration. The first Mission Control document returned 200 without the marker in that sample.

The candidate requires the `runtime.inspect` permission for shared runtime projections, including the dashboard snapshot, SSE, and task and approval views. Server rendering checks the actor before reading the roster. Snapshot and stream publication recheck authorization. Instance owners, desktop operators, and the explicit API service in token mode share the trusted OpenClaw operator boundary. The AgentOS member role cannot consume that shared data.

Against the frozen candidate, owner and API service snapshot reads returned 200 in their respective protection modes. The owner received native full and delta updates. Member snapshot, diagnostics, and stream requests returned 403. Settings and Mission Control redirected to operator access without serializing private data. Revoking the owner session returned 401 on the next read and closed the existing SSE subscription.

## Controls and fixture validation

- Named chats use OpenClaw's native archive and restore operations with an expected physical session ID. The fixture verified stale-target rejection, blocked admission while archived, preserved the session ID and transcript across Gateway restart, and restored the same conversation. This path passed on OpenClaw `2026.11.10` and the `2026.11.5` compatibility floor. The target-dependent ClawHub and MCP features do not change the existing update recommendation. [Native session contract](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/gateway/protocol/rpc-session-control.md)
- OpenClaw Control UI MCP handoff follows the configured local base path and carries no credential. The authorized fixture reached the native page. A separate exact-runtime fixture executed an MCP tool after adding the server from AgentOS, confirmed its session-effective availability, then disabled and removed the server. Remote handoff uses the configured OpenClaw Control UI location. Live OAuth, account state, shared sign-out acceptance, health display, and resource browsing remain open.
- Lint, typecheck, clean production build, release consistency, and 2,275 tests passed. The fully parallel test run under build load failed one timing-sensitive transport test. The full suite passed from the clean checkout at concurrency four. All six channel browser fixtures passed, including all 26 Telegram steps. Exact-runtime session and task, memory retrieval, and skill activation checks passed. Skill invocation by a real model and live channel delivery remain open.
- The workforce suite recorded 14 passes and five skips. Delegation, waiting worker, the Mission-linked human control path, cancellation and child failure require real correlated native task rows that the fixture did not emit. Restart during delegation remains open. Other open engineering covers native reset, artifact browsing, per-conversation model and reasoning, compaction, queued-run restart and long-tool steering, workspace relocation, and native ClawHub plan approval and installation in the architect. The existing ClawHub catalog remains a read-only path. [Official template contract](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/cli/templates.md)

## Dashboard measurements

Chrome on macOS arm64, Node `24.22.1`, a disposable exact Gateway, and two concurrent browser contexts at each scale. Useful DOM time is navigation to the visible first agent. Event-to-DOM starts before the native rename, includes the wake-up session patch, and waits for the new name in both browser contexts. Each scale attempted five DOM updates. The baseline missed one response at 10 agents. CPU is average process utilization across ten native session mutations. RSS was sampled at the end of that window.

| Agents / sessions | Cold DOM before → candidate | Warm DOM before → candidate | Event-to-DOM p95 before → candidate | Cold RPCs before → candidate | Initial SSE before → candidate |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / 1 | 11.41–11.43 s → 1.13–3.63 s | 1.02–1.07 s → 0.26–0.26 s | 2.56 → 2.22 s | 72 → 38 | 86,269 → 92,077 B |
| 10 / 100 | 11.38–11.40 s → 1.11–3.63 s | 0.24–0.30 s → 0.25–0.26 s | 4.32 → 2.36 s | 71 → 38 | 195,455 → 195,459 B |
| 50 / 500 | 11.41–11.41 s → 1.13–3.63 s | 1.12–11.33 s → 0.24–0.27 s | 3.05 → 2.63 s | 89 → 38 | 678,659 → 585,300 B |

Baseline TTFB was about 0.97–1.00 s. The candidate rendered the native roster in the initial HTML at every scale and deferred readiness, diagnostics, and activity behind the existing stream. Warm rendering met the 500 ms target. Cold rendering still had samples over 3 s. Event-to-DOM remains above the 500 ms p95 target. Cold native RPC counts fell. HTML grew because it now carries the roster, and the initial full SSE payload remained large. At 50 agents, Gateway CPU rose from 9.3% to 55.8% during the mutation window and RSS rose from 1.79 to 2.42 million KiB. The JSON includes process utilization, RSS, initial payload sizes, RPC detail and captured samples.

The separate warm chat adapter fixture measured 38.4 ms p95 versus 64.7 ms for the older comparison path, across 50 turns. That measurement covers setup and history through native admission. The candidate queue scenario verified distinct runs, ordered delivery and two provider executions. Browser-to-admission and live provider latency remain open.

## Certification

The raw evidence is bound to the frozen code and committed separately. The remaining required exact-runtime artifacts and live owner acceptance are pending. Certification freshness and the production release gate fail because there is no accepted final artifact. [Reviewed quality and Gateway compatibility CI](https://github.com/SapienXai/AgentOS/actions/runs/45614722846) · [Reviewed desktop CI](https://github.com/SapienXai/AgentOS/actions/runs/45614722830) · [Reviewed ClawHub dry run](https://github.com/SapienXai/AgentOS/actions/runs/45614723383)

## Owner acceptance

The launcher was verified through protected sign-in, the ChatGPT onboarding entry and protected sign-in after restart. It requires a clean production build and the exact installed OpenClaw package. It prints the loopback URL and isolated state directory, and prompts privately for a local `acceptance-owner` password. Resume with the same state directory as the third argument.

```sh
node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/agentos-owner-acceptance.cjs /path/to/openclaw /path/to/clean/agentos-build
```

1. Open the printed URL and choose **Continue with ChatGPT**. Complete authorization in the provider's browser. Add two authorized test accounts when available. Select each saved account, choose an executable model, and obtain a completed reply. Exercise any approved API-key and local model through **Models**.
2. Stop and relaunch with the printed state directory. Verify saved account reuse, the selected model and a new reply. Refresh the account, then disconnect and reconnect it. Verify that the disconnected account cannot run a new turn.
3. For the approved MCP OAuth fixture, use **Agent details → Capabilities → MCP integrations → Open OpenClaw MCP settings**. Sign in, run a known tool and read a test resource through OpenClaw. Clear the shared sign-in, verify the authorization requirement, and reconnect.
4. Link only authorized test channel accounts. Verify inbound routing, one reply to each approved destination, and disconnect/reconnect. Use the isolated candidate environment for platform or deployment checks.

Keep passwords, provider codes, callback URLs, and tokens in the terminal and the relevant browser windows.
