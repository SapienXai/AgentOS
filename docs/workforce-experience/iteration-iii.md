# Iteration III · Signature Experience

## Design and ownership decisions

Give each destination one recognizable composition. Team is an employee directory, Knowledge is a source library, and Integrations is a place to find and manage abilities. Use a quieter rose accent, compact headings, restrained elevation and clear row hierarchy. Retain the existing Button, Dialog, Input, native disclosure and mobile dock patterns. Use the native workflow’s real pending, ready, blocked and error states. Ordinary desktop routes keep a readable navigation rail. Phone layouts keep the dock, safe areas and short inline prompts.

OpenClaw remains the authority for employee configuration, tool permissions, memory search and runtime status. AgentOS may convert imported files into readable documents, organize reference material and compose existing authorized operations. A saved reference does not imply its destination was fetched. Employee guidance does not create file privacy in a shared workspace. Use existing file locality checks and server-side permissions for content and existing capability contracts for assignment.

## Browser review

The reviewed build is `c16f2033`. The initial comparison used the production build with two disposable companies, native employees and a native task. Each route was replayed at 1440×900, 1280×800, 820×1180, 844×390, 390×844 and 360×800 in both themes. Chat also ran at 470 pixels in height with its composer focused. The launchers use Chromium viewport emulation.

The first review found an overlapping workspace label and runtime status in the compact rail, difficult-to-discover mobile collections and repeated ChatGPT setup inside the alternative provider picker. It also caught an extraction error that reproduced only in the built app. The next pass simplified the rail and provider picker, made the collections directly reachable and corrected the standalone PDF worker resolution.

The second review caught a detail sheet that hid its content on phones and a document preview that opened an editor with the stored filename prominently displayed. The revised sheet shows employee access and accessible connection actions at phone widths. The preview has a readable document title, formatted text, provenance and deliberate editing. Phone checks also identified long lines in imported text and repeated connection diagnostics. Converted text now wraps and secondary connection diagnostics are available under Advanced.

| Surface | Previous | Iteration III |
| --- | --- | --- |
| Team desktop | [Dark](evidence/iteration-iii/before/dark-1440-team.jpg) | [Dark](evidence/iteration-iii/after/dark-1440-team.jpg) · [Light, 1280](evidence/iteration-iii/after/light-1280-team.jpg) |
| Team phone | [Light](evidence/iteration-iii/before/light-390-team.jpg) | [Light](evidence/iteration-iii/after/light-390-team.jpg) · [No matching employees](evidence/iteration-iii/after/light-390-team-no-matches.jpg) |
| Integrations | [Dark](evidence/iteration-iii/before/dark-1440-integrations.jpg) | [Dark](evidence/iteration-iii/after/dark-1440-integrations.jpg) · [Phone detail](evidence/iteration-iii/after/light-390-integration-detail.jpg) |
| Settings | [Light phone](evidence/iteration-iii/before/light-390-settings.jpg) | [Light phone](evidence/iteration-iii/after/light-390-settings.jpg) |
| First run | [Iteration II](iteration-ii.md#full-resolution-comparisons) | [Connect AI](evidence/iteration-iii/after/dark-1440-connect-ai.jpg) · [Other providers](evidence/iteration-iii/after/light-390-provider-choice.jpg) · [Workspace](evidence/iteration-iii/after/dark-1440-create-workspace.jpg) · [Edited proposal](evidence/iteration-iii/after/light-390-reviewed-team-edits.jpg) · [Draft recovery](evidence/iteration-iii/after/light-360-resume-workspace-draft.jpg) |
| Hiring and profiles | [Iteration II](iteration-ii.md#full-resolution-comparisons) | [Hire](evidence/iteration-iii/after/light-390-hire-preparation.jpg) · [Tablet overview](evidence/iteration-iii/after/dark-820-employee-overview.jpg) · [Knowledge](evidence/iteration-iii/after/light-390-employee-knowledge.jpg) · [Capabilities](evidence/iteration-iii/after/dark-390-capabilities.jpg) · [Activity](evidence/iteration-iii/after/dark-1440-employee-activity.jpg) |
| Knowledge | [Iteration II](iteration-ii.md#full-resolution-comparisons) | [Desktop library](evidence/iteration-iii/after/dark-1440-knowledge.jpg) · [Phone library](evidence/iteration-iii/after/dark-390-knowledge.jpg) · [Import](evidence/iteration-iii/after/light-390-knowledge-import-dialog.jpg) · [PDF preview](evidence/iteration-iii/after/light-390-knowledge-upload.jpg) · [Scanned PDF error](evidence/iteration-iii/after/dark-390-scanned-pdf-error.jpg) |
| Daily work | [Iteration II](iteration-ii.md#full-resolution-comparisons) | [Short Chat](evidence/iteration-iii/after/dark-390-chat-focused-470.jpg) · [Landscape Tasks](evidence/iteration-iii/after/light-844-tasks.jpg) · [Needs you](evidence/iteration-iii/after/light-1440-needs-you.jpg) · [Workspace switcher](evidence/iteration-iii/after/light-390-workspace-switcher.jpg) |

## Documents and native access

Uploads use the existing local managed-file contract. The original 512 KiB stored-text limit applies. Uploads have a 4 MiB input limit. Original binaries are discarded after parsing. References are saved as links and can be opened in a browser. Shared files follow the existing workspace file policy. An employee assignment changes their native memory search sources. The ability to read shared files is controlled separately by OpenClaw. Employee-specific native memory continues to use the employee’s own existing memory and workspace settings. Image-only PDFs and text with unsupported font encodings may need conversion before import.

| Source | Storage and extraction | Native use |
| --- | --- | --- |
| Markdown and plain text | UTF-8. Markdown stays Markdown. Plain text is stored with a source name and a text block. | Assignable as a workspace Markdown source. |
| PDF | Local PDF.js text extraction in a bounded worker. Up to 100 pages, a 10-second deadline, and two concurrent imports. Image-only PDFs need OCR before import. Locked or unreadable documents return an error. | The converted Markdown can be assigned. The browser fixture imports a PDF with a unique benign fact and checks native retrieval and a Chat tool result. |
| Word | Text paragraphs from DOCX. XML external declarations and active content are rejected. | The converted text can be assigned. |
| CSV and Excel | CSV allows up to 1,000 lines. XLSX allows up to 12 sheets and 1,000 rows. Formulas are skipped. Office archives are limited to 2,500 entries and 8 MiB expanded. | The table text can be assigned. |
| JSON | Validated UTF-8 JSON is retained as a managed source and shown in a text preview. | Available through supported native file tools with appropriate access. The assignment control is for Markdown memory search sources. |
| Written note | Markdown with the entered title. | Assignable. |
| Website reference | An HTTP(S) link saved with its name. Credential-bearing URLs are blocked. | Opens the external website. Saving a link does not fetch it. |

The authorized import route handles validation and writes via the existing file service. The assignment route resolves the employee and workspace through the native snapshot and config, limits operations to a local Gateway and uses the native config revision hash. Array removal explicitly replaces only the verified employee’s canonical `memory.search.extraPaths`. Import retries return the stored path for identical content. Write and assignment APIs reject unauthenticated and member access in the fixture, including direct API calls. Stale references can be unassigned. The UI reports saved configuration and leaves live retrieval status unverified during ordinary use.

## Abilities and onboarding

| Path | Evidence and constraints |
| --- | --- |
| Suggested team | Extra guided choices come from live `tools.catalog` reads and are limited to verified core reading and search tools. The server rechecks source and tool IDs when the existing blueprint revision is saved. A changed roster or stale revision uses the existing recovery flow. |
| Hire | Optional Knowledge, Abilities and Intelligence show workspace documents, verified tool choices and supported model selection. Creation uses the existing native provisioning service. The file assignment runs after identity exists and has an explicit recovery link if it is pending. |
| Profile | Overview explains the role and work. Knowledge shows shared and assigned files plus existing native memory. Capabilities uses the existing effective-tool and configuration surfaces. Activity and Settings retain access to native details and legacy links. |
| Directory | Discover, Connected and Needs attention use native integration state. OpenClaw Channels, Accounts, model, skill, plugin and MCP surfaces keep their existing authorization and connection actions. Schedules live under Tasks. |
| Setup alternatives | Connect AI still uses the native ChatGPT account flow, supported API-key providers and local Ollama. Real account consent, provider entitlements, external pairing and physical-device acceptance require an owner walkthrough. |
| Current boundaries | The team generator revises supported fields in the saved proposal. New employees can be added from Team after launch. Single-employee hiring starts from existing role guidance or manual details. Existing managed-file APIs support editing and assignment removal. File deletion and assignment-based privacy require different native contracts. |

A fresh native workspace retains its built-in system assistant. The repeatable empty Team state shown here uses a search with no matches.

The onboarding draft uses the existing scoped recovery store for name, brief and manual roster. The server-owned plan handles source references and reviews. Credentials, provider consent and model verification continue through the existing provider flows. The optional onboarding source picker uses the architect’s existing text formats, including Markdown, TXT, JSON, YAML, HTML and CSV. Selecting Build manually leaves attached documents for import after launch. PDF, Word and Excel import in the company library uses the separate managed-document path described above.

## Try the isolated production preview

```sh
git clone --branch codex/agentos-0.11.0-workforce-experience https://github.com/SapienXai/AgentOS.git AgentOS-workforce
cd AgentOS-workforce
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
export WORKFORCE_OPENCLAW_PACKAGE="$PWD/node_modules/.pnpm/node_modules/openclaw"
node -r ./tests/register-paths.cjs -r jiti/register.js scripts/workforce-experience-preview.cjs --serve
```

Use Node.js 24.22.1 or 26.12.1 and the repository’s pinned pnpm. The launcher prints a loopback URL and opens a signed-in Chromium window. The default mode creates Fieldwork Studio and Northline Press. Append `--fresh` for a workspace-free preview with a configured fixture model, or `--connect` to start without a provider. The fixture uses a real isolated Gateway and a disposable local model response server. Close Chromium or press Ctrl+C to stop it. Use a dedicated disposable provider account if completing real provider authorization in the connection preview.

For a headless replay, omit `--serve` and set `WORKFORCE_VIEWPORTS=1440,1280,820,844,390,360` and `WORKFORCE_EVIDENCE=/path/to/output`. Run the default, `--connect`, `--fresh`, and `--suggested` modes in separate disposable runs. Add `--native-knowledge` to the populated replay to exercise actual PDF retrieval, the native read tool, restart and authorization. Use `--matched-canvas` at widths 1440 and 390 in both worktrees. See the [existing canvas replay steps](README.md#run-an-isolated-preview).

For owner acceptance, connect a real provider in an isolated profile, create a workspace, review the proposal and follow the first conversation. Hire an employee, give them a document and a permitted capability, then ask them a question about the document. Review task approval or recovery and test switching companies on a phone. Live authorization should be entered directly into the provider’s own flow.

## Native workflow proof

The exact-package browser replay created Morgan as Researcher, added the assigned PDF and confirmed the selected core read tool in Morgan’s actual Chat session. The PDF held the unique fact “Fieldwork 903.” OpenClaw memory search returned it for Morgan and did not return it for an employee in the second company. Morgan’s conversation also read the file through the effective native tool and returned the fact from the tool result. The assignment and memory retrieval survived restarting AgentOS and the Gateway. Removing the assignment removed the fact from that employee’s memory search. The shared file retained its own access rules. The fixture verified denied cross-workspace assignment and rejected a missing source.

- [Structured retrieval, restart and removal evidence](evidence/iteration-iii/native-knowledge.json) and [native Chat result](evidence/iteration-iii/after/light-390-native-employee-document-reply.jpg).
- [Manual launch and first reply](evidence/iteration-iii/manual-onboarding-browser.json) and [proposal review and launch](evidence/iteration-iii/proposed-launch-browser.json). The observed manual fixture took 13.89 s from Launch to canvas and 19.28 s to first reply. The full viewport replay of the edited proposal took 22.50 s to canvas and 24.12 s to first reply. A focused phone replay measured 30.43 s and 32.61 s respectively. These include native provisioning. Live provider authorization timing requires owner consent.
- [Unauthenticated-provider UI](evidence/iteration-iii/provider-browser.json) and [keyboard workspace selection](evidence/iteration-iii/workspace-keyboard.json). The proposal fixture uses OpenClaw Doctor against its disposable credential migration input before first run.

## Mission Control preservation

The protected canvas source, node and edge modules, canvas regression tests and global CSS have zero diff against both the reviewed branch and `main`. The workspace switcher CSS change applies to ordinary Workforce routes only. Native replay returned identical viewport transforms, node dimensions and saved positions in all four matched desktop and phone captures after allowing for independently generated task IDs. Connected-module tests also returned the same node and tether geometry against both refs. Browser checks exercised real workspace switching, fit, zoom, drag persistence and the inspector, with supplemental connected-module, pan, filter and normal-motion cases.

| Canvas crops | Reviewed | Candidate |
| --- | --- | --- |
| Desktop dark | [Before](evidence/iteration-iii/canvas/dark-1440-reviewed.png) | [After](evidence/iteration-iii/canvas/dark-1440-candidate.png) |
| Desktop light | [Before](evidence/iteration-iii/canvas/light-1440-reviewed.png) | [After](evidence/iteration-iii/canvas/light-1440-candidate.png) |
| Phone dark | [Before](evidence/iteration-iii/canvas/dark-390-reviewed.png) | [After](evidence/iteration-iii/canvas/dark-390-candidate.png) |
| Phone light | [Before](evidence/iteration-iii/canvas/light-390-reviewed.png) | [After](evidence/iteration-iii/canvas/light-390-candidate.png) |

Raw screenshot pixels vary because the retained animated portraits and native task timestamps are captured in separate runs. The report includes the raw channel deltas, the component geometry comparison, and a repeated run of the same reviewed build for comparison. Connected-module captures use controlled projected route and account fixtures. Native workspace and task interactions are checked separately. [Canvas comparison](evidence/iteration-iii/canvas/comparison.json) · [Native browser interactions](evidence/iteration-iii/canvas/candidate-browser.json) · [Motion and filters](evidence/iteration-iii/canvas/motion-browser.json).

## Quality checks

- Lint, Next.js route type generation, TypeScript, 2,279 unit checks, the standalone production build, and release consistency passed against `228912e2`. A direct test of the packaged PDF worker extracted the fixture fact.
- The browser recorded 276/276 populated checks including permissions and the native document flow, 60/60 proposal checks, 39/39 manual-onboarding checks, and 24/24 provider-picker checks. [Populated replay](evidence/iteration-iii/populated-browser.json) · [Proposal replay](evidence/iteration-iii/proposed-review-all-sizes.json).
- The channel browser suite passed all six cases, including the 26-step Telegram flow and Discord routing. Real external Telegram and provider authorization remain owner acceptance steps. [Channel checks](evidence/iteration-iii/channels-browser.json).
- The stable and beta-shape compatibility simulations preserve their existing degraded-surface reports. The actual Gateway certification uses OpenClaw 2026.11.10 and its matching SDK and protocol packages. The recommended OpenClaw version remains 2026.11.5. [Compatibility outputs](evidence/iteration-iii/compatibility.json).
- The existing final evaluator passed 18/18 exact-runtime artifacts for product code `228912e297fba6f465965e6231475d56589b7694` and evidence commit `eb8d21dbc0bdf4f85de1490ae509e97082b15c13`. It reports 92 skipped checks and 69 expected authorization denials. The report lists the reason and source for each skip and keeps the existing compatibility gates intact. [OpenClaw certification](../evidence/openclaw-2026.11.10-pre-merge-final-certification.json).

## Performance

The comparison uses the production builds of current `main` at `49cf6362` and the certified candidate. Both ran sequentially with task-owned QA stopped, pinned OpenClaw 2026.11.10, Node.js 24.22.1 and Chrome 158 at 1440×900. At each scale, the harness restarted AgentOS ten times with new sidecars and two fresh browser contexts per restart. Each build also received 20 timed native agent and session updates per scale. Values are milliseconds.

The historical text marker uses the first matching visible text locator. The actionable canvas marker independently verifies the named native node, the node’s viewport intersection, a visible accessible name, and an enabled native action. The raw evidence records initial HTML, TTFB, long tasks, SSE phases, RPC calls, process CPU and RSS, distributions and misses.

| Employees / sessions | Build | Cold text median / p95 / worst | Actionable node median / p95 / worst | Warm range | Event to DOM median / p95 / worst | Updates observed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 / 1 | Main | 1052 / 8087 / 8104 | 588 / 818 / 821 | 229–230 | 1570 / 1714 / 2088 | 20/20 |
| 10 / 100 | Main | 1061 / 3576 / 10626 | 605 / 642 / 644 | 229–233 | 1645 / 2208 / 2296 | 20/20 |
| 50 / 500 | Main | 1075 / 3587 / 10110 | 607 / 656 / 658 | 248–267 | 1590 / 2116 / 2794 | 20/20 |
| 1 / 1 | Candidate | 1038 / 1064 / 1068 | 568 / 585 / 598 | 216–219 | 1602 / 1665 / 2103 | 20/20 |
| 10 / 100 | Candidate | 1043 / 1078 / 1086 | 569 / 622 / 630 | 215–222 | 1682 / 2203 / 2332 | 20/20 |
| 50 / 500 | Candidate | 1061 / 1092 / 9109 | 584 / 620 / 627 | 239–337 | 1616 / 2562 / 3308 | 20/20 |

The candidate’s slowest text sample at 50/500 took 9.11 s. The server response began at 213 ms, the initial HTML included the roster, the actionable node was present at 577 ms, and the first live snapshot arrived at 8.95 s. Main reproduced the same separation between canvas availability and the legacy text marker. Those samples reported no long tasks. The timing points narrow the unresolved delay to the legacy text observation and live reconciliation. They do not establish why the first text match waited.

At 50/500, the end-to-end p95 was higher on the candidate in the initial run. A reverse-order run with 30 updates per build measured 3.25 s on main and 3.96 s on the candidate, with all 30 observed on each. A separate 24-update trace compared the legacy locator with the actual updated canvas name and timed both native mutation RPCs. It measured 3.24 s end-to-end on main and 3.52 s on the candidate. Up to the completion of `agents.update` and `sessions.patch`, p95 was 0.95 s on main and 1.22 s on the candidate. From RPC completion to the changed canvas node, p95 was 2.289 s and 2.293 s. This trace attributes the observed gap to the native mutation interval. The reason for that service-time variation remains open. The 500 ms end-to-end p95 target remains open. [Reverse-order replay](evidence/iteration-iii/performance-50-repeat.json) · [Native RPC and DOM timing trace](evidence/iteration-iii/performance-50-trace.json).

```sh
export AGENTOS_BENCH_OPENCLAW_PACKAGE="$PWD/node_modules/.pnpm/node_modules/openclaw"
export AGENTOS_BENCH_COLD_PAIRS=10 AGENTOS_BENCH_DOM_SAMPLES=20
AGENTOS_BENCH_APP_ROOT=/path/to/production-build-of-main \
  node -r ./tests/register-paths.cjs -r jiti/register.js scripts/agentos-dashboard-benchmark.cjs
node -r ./tests/register-paths.cjs -r jiti/register.js scripts/agentos-dashboard-benchmark.cjs
```

[Raw performance samples and diagnostic instrumentation](evidence/iteration-iii/performance.json).
