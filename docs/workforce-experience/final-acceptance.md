# AgentOS 0.11.0 Final Experience & Acceptance

PR #51 merged as `64697ffbdcbdfbc57bb2616977e61479d0ea432f`. Its parents are the approved original main `49cf6362` and the reviewed Workforce commit `9cf5a866`. The merge tree matches the reviewed tree, includes the certified code and evidence commits, and passed certification freshness and the [main CI run](https://github.com/SapienXai/AgentOS/actions/runs/45776504790). GitHub recorded no deployment for the merge. This acceptance uses local, disposable OpenClaw 2026.11.10 state.

## Product changes

- Hiring uses the existing character portraits and a live identity preview. Knowledge, abilities, and model setup remain optional. The completion action opens the employee profile, where Chat and Assign task are available. Document assignment feedback follows the native result.
- The live capability library groups OpenClaw’s reported tools and skills during hiring and in the employee editor. The guided selection keeps its six approved tools. The employee profile distinguishes conversation access from configured identifiers, permissions and prerequisites. Connection management opens separately so the hiring draft stays open.
- Select multiple Knowledge sources and assign them directly to one employee through the existing revision-checked native update. The review lists the format beside each name. Source details show available file timestamps and provenance. Concurrent edits to a managed source report a conflict and preserve the current file. The managed-file service exposes list, read and save, so removal of a whole source remains unavailable in this interface.
- Light Workforce dialogs follow the portal’s theme. Assignment controls stay near the bottom safe area, and keyboard dismissal returns focus to the opener. The Settings menu shadow appears only while the menu is open. The Chat composer fits short landscape viewports.
- Workspace launch shows native progress without a synthetic percentage. The native visibility check refreshes the snapshot, replacing a redundant refresh after first setup. The SSE stream bounds coalescing from the first event and uses the already-redacted control-plane projection. Actor reauthorization still applies before and after the read.

## Native MCP invocation

The earlier fixture called `proof__workspace_fact` directly. OpenClaw listed the capability in the effective inventory and deferred its model-facing schema. The direct call returned dispatcher guidance and the repeated-call guard ended the turn. The acceptance fixture now calls the advertised `dispatch_action` with a unique request ID. The fixture’s final reply uses the latest correlated native tool result. The test compares both native Gateway Chat and AgentOS Chat with stdio and Streamable HTTP, then repeats calls after restart and verifies that disabled servers receive zero callbacks. [OpenClaw Tool Search](https://docs.openclaw.ai/tools/tool-search).

## Owner walkthrough

Use a clean AgentOS 0.11.0 checkout with dependencies installed and a completed `pnpm build`. From that checkout, run the protected launcher in an interactive terminal.

```sh
node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/agentos-owner-acceptance.cjs --candidate-version 0.11.0 \
  "$PWD/node_modules/.pnpm/node_modules/openclaw" "$PWD"
```

1. Choose the local password in the terminal. Open the printed loopback URL and sign in as `acceptance-owner`.
2. Select **Connect your AI** and complete consent in the native ChatGPT browser flow, or choose another supported provider. Select an executable model that the account exposes.
3. Add a company brief and a document. Review the team, launch into Mission Control, and send a message to the first employee. Hire a second employee, assign knowledge and one allowed tool, and confirm access in their profile.
4. Stop the launcher with Ctrl+C. Append its printed state directory to the same command, reopen the printed URL, and check that the account, company, assignments and conversation return. Test disconnect and reconnect in this isolated environment.

The launcher verifies the requested AgentOS version and exact OpenClaw and Gateway SDK versions. The password stays in the terminal. Protected sign-in passed before and after restarting the launcher with the same state directory. Fixture-provider runs exercise the application with a disposable provider. Live ChatGPT consent and account-specific model entitlement require the owner’s browser session.

For a populated fixture preview, run the following from the built checkout. It opens an authenticated browser window with two disposable companies.

```sh
WORKFORCE_OPENCLAW_PACKAGE="$PWD/node_modules/.pnpm/node_modules/openclaw" \
  node -r ./tests/register-paths.cjs -r jiti/register.js scripts/workforce-experience-preview.cjs --serve
```

## Mission Control preservation

The source guard returned zero diff against the approved original main and the reviewed merge for the protected canvas, nodes, edges, colors, persistence, motion, global CSS, and canvas tests. The matched desktop and phone runs passed 14 browser checks for each revision. The canvas region is 1440 × 900 on desktop and 390 × 788 on phone. The original main phone capture uses a shorter browser viewport to match the newer mobile dock’s canvas area. The graph geometry matches in all four comparisons. The desktop dark capture has a sub-pixel camera difference of 0.021 px horizontally and 0.0073 px vertically. Raw screenshot differences include animated portraits and task timestamps.

## Visual review

- Knowledge assignment [before](evidence/iteration-iv/after/light-360-knowledge-source-assignments.jpg) and [after](evidence/final/after/light-360-knowledge-assignment-contrast.jpg). See also the [batch review](evidence/final/after/light-360-knowledge-multi-source-review.jpg).
- Settings [before](evidence/iteration-iv/before/light-390-settings.jpg) and [after](evidence/final/after/light-390-settings.jpg).
- Employee capabilities [before](evidence/iteration-iv/after/dark-1440-capabilities.jpg) and [after](evidence/final/after/dark-1440-capabilities.jpg). See [hiring](evidence/final/after/dark-1440-add-employee.jpg) and the [native capability library](evidence/final/after/dark-390-hiring-capability-library.jpg).
- [Team](evidence/final/after/light-1440-team.jpg), [employee profile](evidence/final/after/light-820-employee-overview.jpg), [landscape Chat](evidence/final/after/light-844-chat-landscape-composer.jpg), [Tasks](evidence/final/after/light-1440-tasks.jpg), and [Integrations](evidence/final/after/dark-820-integrations.jpg).

The first review used a real populated production build, confirmed the theme repair and removed a persistent shadow on Settings. The next review caught identical source titles with different formats and a cramped composer in landscape. The final Chromium replay covered 1440 × 900, 1280 × 800, 820 × 1180, 844 × 390, 390 × 844 and 360 × 800 in both themes. It passed 283 of 284 checks, including the sampled 4.5:1 Knowledge dialog contrast, keyboard focus restoration and the focused landscape composer. [Full replay](evidence/final/populated-browser.json) · [Canvas comparison](evidence/final/canvas/comparison.json).

## Native results and limits

- Native memory returned distinct facts from the assigned PDF and DOCX before a selective assignment change. Native Chat also returned the PDF fact using the effective Read tool. Removing the PDF kept the DOCX binding in native config and prevented the PDF’s fact from appearing in search. Search stopped returning the DOCX fact after that change and a plain restart. The supported per-employee OpenClaw reindex restored the DOCX after restarting the disposable Gateway, while the removed PDF stayed absent. The app reports configured assignments separately from indexing and has no automatic reindex action. [Native knowledge checks](evidence/final/native-knowledge.json) · [Restart-only observation](evidence/final/selective-native-search-recovery.json) · [Native reindex verification](evidence/final/native-reindex-recovery.json) · [OpenClaw memory commands](https://docs.openclaw.ai/cli/memory).
- Stdio and Streamable HTTP both passed the native MCP invocation, result and revocation checks. [MCP run](evidence/final/native-mcp.json).
- The exact-runtime evaluator passed all 18 artifacts against code `91d5359b` and evidence `5213f839`. Certification freshness passed after binding. There were 91 skips and 69 expected authorization denials, versus 92 and 69 in the reviewed merge. The two native suspend checks passed in the doctor run. An optional live config-apply receipt was unclaimed in the production certification fixture. [Bound certificate](../evidence/openclaw-2026.11.10-pre-merge-final-certification.json).
- The channel suite passed six Chromium fixtures, including all 26 Telegram steps. Live channel pairing, external OAuth, physical-device coverage and Safari/WebView remain separate acceptance checks. [Channel results](evidence/final/channel-acceptance.json).

## First-use timings

The exact-runtime loopback fixtures ran against the traced standalone build. The manual path included an XLSX and note. The proposed path included a DOCX and a saved edit to the lead employee’s role, responsibility, and tool selection. The timing stops when the test has verified the canvas and employee, then when it receives the first completed reply.

| Launch path | Iteration IV to canvas | Final to canvas | Iteration IV to reply | Final to reply |
| --- | ---: | ---: | ---: | ---: |
| Manual team | 12.90 s | 9.85 s | 18.98 s | 14.35 s |
| Reviewed proposal | 29.24 s | 21.26 s | 31.40 s | 22.88 s |

The proposed flow improved by 7.98 s to canvas in this replay. It remains 1.26 s above the 20-second target. These are separate fixture runs on the same host, so they include ordinary run-to-run variation. Real provider response time and entitlement depend on the connected account. [Manual replay](evidence/final/manual-onboarding-browser.json) · [Proposed team replay](evidence/final/proposed-onboarding-browser.json) · [Separate provider setup](evidence/final/provider-browser.json).

A separate Chromium probe measured 2.6 ms from click to the first visible native provisioning status for the manual launch and 2.0 ms for the proposal launch. Both were below the 200 ms acknowledgement target. [DOM feedback observations](evidence/final/onboarding-feedback.json).

## Dashboard benchmark

The same benchmark ran against original main `49cf6362`, merged Workforce `64697ffb`, and frozen final code `91d5359b`. Each run used a clean OpenClaw 2026.11.10 sidecar, ten cold restart pairs, 20 timed native updates, two browser contexts and two SSE consumers. The 50/500 runs were repeated in reverse order. Other local build, browser acceptance, and certification jobs were stopped during these runs.

| Employees / sessions | Build | Cold actionable p95 / worst | Warm useful worst | Post-RPC actionable p95 |
| --- | --- | ---: | ---: | ---: |
| 1 / 1 | Original main | 660 / 678 ms | 327 ms | 1.36 s |
| 1 / 1 | Reviewed merge | 671 / 688 ms | 212 ms | 1.47 s |
| 1 / 1 | Final | 609 / 614 ms | 305 ms | 1.39 s |
| 10 / 100 | Original main | 672 / 675 ms | 256 ms | 1.53 s |
| 10 / 100 | Reviewed merge | 647 / 652 ms | 242 ms | 1.48 s |
| 10 / 100 | Final | 670 / 677 ms | 228 ms | 1.34 s |
| 50 / 500 | Original main | 658 / 681 ms | 256 ms | 1.24 s |
| 50 / 500 | Reviewed merge | 639 / 654 ms | 250 ms | 1.33 s |
| 50 / 500 | Final | 639 / 647 ms | 231 ms | 1.03 s |
| 50 / 500 reverse | Original main | 640 / 641 ms | 239 ms | 1.25 s |
| 50 / 500 reverse | Reviewed merge | 585 / 591 ms | 219 ms | 1.25 s |
| 50 / 500 reverse | Final | 575 / 591 ms | 239 ms | 1.06 s |

The final 50/500 build improved post-RPC p95 by about 200 ms versus original main in both directions. The 500 ms target remains open. Approximate delta SSE event-to-wire p95 was 933–935 ms in the two final runs. At 50/500, the final forward run published seven delta snapshots versus six on both references, with 28 `tasks.list` and 14 `sessions.list` calls versus 24 and 12 on both references. This tradeoff is consistent with a bound on how long a burst can delay publication. Repeated native reads and the snapshot-to-wire interval remain the measured area for further work. Event-to-actionable p95 at that scale was 1.88–1.89 s on final and 1.87–1.94 s on original main.

The raw report also contains the earlier text-locator timings, separate RPC and DOM times, payload sizes, sampled CPU and RSS, and available browser long-task observations. The actionable marker had no missed observations. [Raw runs and distributions](evidence/final/performance.json).

## Quality and packaging

`pnpm lint`, `pnpm typegen`, `pnpm typecheck`, `pnpm test` (2,282 passing), `pnpm build`, `pnpm check:release`, and `git diff --check` passed. The traced production bundle contained the PDF worker, both official Gateway SDKs at 2026.11.10 and their WebSocket dependency. The browser matrix ran from that packaged application. Stable and beta contract simulations ran separately from the exact native certificate. [Main CI history](https://github.com/SapienXai/AgentOS/actions?query=branch%3Amain).
