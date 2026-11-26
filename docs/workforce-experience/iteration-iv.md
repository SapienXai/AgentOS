# Iteration IV · Workforce Intelligence & Experience

## Ownership and product decisions

OpenClaw 2026.11.10 owns employee identity, tools, effective access, and memory retrieval. The recommended compatibility floor remains 2026.11.5. AgentOS uses the existing Gateway, config revision guard, managed-file policy and workspace architect. Guided equipment and the library are projections over those contracts.

The current native config supports replacing one employee’s extra search paths atomically. AgentOS can compose a reviewed batch into that one mutation. The editor submits only changed selections, checks workspace membership and resolves each added source locally. Asset access, retained memory, and transcripts remain subject to their existing policies. Capability discovery and an actual employee’s effective tools remain separate states.

Document conversion remains bounded in the existing parser. Multiple selected files use independent requests. Public page material can use the existing pinned-address fetch and extraction path, with the operator reviewing the preview before committing a document. There is no change to the OpenClaw index or storage ownership.

For the UI, the team is a directory, the company library is a reading and teaching surface, and hiring is a profile preview with optional preparation. Reuse the current dialog shell, native form controls, rose identity, semantic status colors, and reduced-motion conventions. The mobile dock and Mission Control canvas are protected.

## Workflows

- **Company Knowledge** supports batches of up to 12 files, per-file results, stable import identity and retries. Plain text, Markdown, JSON, CSV, and text extracted from PDF, DOCX and XLSX remain managed workspace files. A scanned PDF with no selectable text reports the limitation and never claims to be indexed. A source can retain shared workspace access while specific employees have its path included in native memory search. Batch reconfiguration only changes the listed exact paths.
- **Website material** uses a single reviewed public page. Links remain a separate reference format. The import honors the existing robots and destination checks and is bounded to public IPv4, default ports, no query parameters and no rendered-browser fallback. Saving re-reads the page and rejects a change since review. A refresh saves a changed copy separately so previously reviewed material and assignments remain intact. Private sites, authentication, browser-rendered pages, crawling and IPv6-only destinations are outside this import surface.
- **Hire and equip** shows identity and role before optional preparation. It uses one native employee creation and a revision-checked document assignment. The ability catalogue presents defaults, selected tools and read-only availability. The allowlist also admits session status and the native memory tools where live discovery confirms them. Employee capabilities reuse the existing editor and effective capability checks. Tool configuration does not grant execution approval. Skill, integration, plugin and MCP authorizations remain with their native services.
- **First run** retains the native provider handoff and model selection. The architect prepares supported binary formats through the same parsers as the workspace library. Manual launch preserves setup notes in the company brief and adds reviewed documents through managed files after native readiness. Session recovery stores redacted brief, note, supported URL and attachment names. Attachments themselves need to be reselected after a browser reload. Workspace Knowledge surfaces unfinished imports. A proposed roster remains tied to its authoritative review revision. Roles, responsibilities, knowledge and abilities can be revised before launch. Add another employee after launch if the roster needs to grow.
- **Daily work** keeps Chat drafts in the current browser session by workspace, employee and conversation. Recognized credentials and file bytes are excluded. Tasks navigate to the accepted work without a second full-page load. Settings describes personal, company and instance scope. Integration discovery keeps setup, connection proof and effective employee access distinct.

## Browser review passes

The first product review examined the reviewed build and an initial candidate in both themes. It identified the single-file hiring bottleneck, duplicate hiring actions, defaults that disappeared from the live ability picker, and internal model status copy competing with the main action. The next build grouped identity fields, used one Team hiring action and showed inherited abilities as included with their scope explained.

The second craft review used six viewport sizes. On small screens, the closed mobile rail shadow extended into the library, and same-named documents in different formats produced ambiguous assignment buttons. On tablet, the layout selector occupied an entire row in Integrations. The final pass removes the off-screen shadow during closed state, identifies the file format in visible rows and accessible actions, and places the layout selector with the destination tabs. Extracted prose is presented as readable text while the underlying managed file retains its original form and provenance.

## Before and after

| Workflow | Reviewed build | Iteration IV |
| --- | --- | --- |
| Hiring | [Desktop](evidence/iteration-iv/before/dark-1440-add-employee.jpg) | [Desktop](evidence/iteration-iv/after/dark-1440-add-employee.jpg) |
| Team | [Desktop](evidence/iteration-iv/before/dark-1440-team.jpg) | [Desktop](evidence/iteration-iv/after/dark-1440-team.jpg) |
| Company library | [Phone](evidence/iteration-iv/before/light-390-knowledge.jpg) | [Phone](evidence/iteration-iv/after/light-390-knowledge.jpg) |
| Capabilities | [Desktop](evidence/iteration-iv/before/dark-1440-capabilities.jpg) | [Desktop](evidence/iteration-iv/after/dark-1440-capabilities.jpg) |
| Integrations | [Phone](evidence/iteration-iv/before/dark-390-integrations.jpg) | [Phone](evidence/iteration-iv/after/dark-390-integrations.jpg) · [Tablet](evidence/iteration-iv/after/dark-820-integrations.jpg) |
| Chat | [Phone](evidence/iteration-iv/before/light-390-chat.jpg) | [Phone](evidence/iteration-iv/after/light-390-chat.jpg) · [Short keyboard viewport](evidence/iteration-iv/after/light-390-chat-focused-470.jpg) |
| Tasks | [Phone](evidence/iteration-iv/before/light-390-tasks.jpg) | [Phone](evidence/iteration-iv/after/light-390-tasks.jpg) |
| Settings | [Phone](evidence/iteration-iv/before/light-390-settings.jpg) | [Phone](evidence/iteration-iv/after/light-390-settings.jpg) |

The production browser replay covered 1440×900, 1280×800, 820×1180, 844×390, 390×844 and 360×800 in light and dark. The checked bundle was copied outside the repo and served using the traced standalone entry. An initially missing SDK WebSocket dependency showed up only in this smoke, so the trace now includes the installed Gateway SDK dependencies and the PDF worker for both upload entry points. [Standalone browser checks](evidence/iteration-iv/standalone-browser.json) · [Next.js output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

- [Partial batch recovery](evidence/iteration-iv/after/light-360-knowledge-batch-partial.jpg), [public page review](evidence/iteration-iv/after/light-360-knowledge-public-webpage.jpg), [document-to-employee selection](evidence/iteration-iv/after/light-360-knowledge-source-assignments.jpg), and [actual employee tool reply](evidence/iteration-iv/after/light-360-native-employee-document-reply.jpg).
- The packaged replay verified PDF and DOCX assignments together, XLSX extraction, scanned-PDF partial recovery, an outside employee denial, the native Read tool and memory search, persistence after both services restarted, and selective removal without discarding the other document. It also checked ongoing Chat draft recovery, real task submission and SSE revocation. [Native knowledge evidence](evidence/iteration-iv/native-knowledge.json).
- The existing Radix dialog shell preserves focus containment and keyboard dismissal (`dialog`). The uploader uses the guidance “always associate `<label>` with its input using `for` and `id`” (`forms`). The work also uses responsive layouts and a reduced-motion option (`css-layout`).

## Mission Control preservation

The canvas modules, nodes, edges, node status and motion styles, global CSS and canvas regression tests have no diff against either `cd420f85` or `49cf6362`. The matched browser replay passed 14 checks on each ref and the candidate. A separate motion replay passed eight checks, and the connected-module geometry replay passed eight checks on both the reviewed branch and the candidate.

The four matched active canvases have identical node geometry and camera transforms against the reviewed revision. Normalizing only disposable task IDs is enough for those four graph captures to match. Main also has identical node geometry. The matched mobile main capture uses a shorter outer viewport to account for the branch’s existing mobile dock. The connected-module review sample showed a sub-tenth-pixel desktop camera difference with identical tethers and node geometry. Raw PNG pixels vary with animated portraits, task timestamps and independent browser samples. The comparison records those differences alongside the geometry. [Matched captures and reports](evidence/iteration-iv/canvas/) · [Raw comparison](evidence/iteration-iv/canvas/comparison.json).

## Try the isolated preview

```sh
git clone --branch codex/agentos-0.11.0-workforce-experience https://github.com/SapienXai/AgentOS.git AgentOS-workforce
cd AgentOS-workforce
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
export WORKFORCE_OPENCLAW_PACKAGE="$PWD/node_modules/.pnpm/node_modules/openclaw"
node -r ./tests/register-paths.cjs -r jiti/register.js scripts/workforce-experience-preview.cjs --serve
```

The launcher prints the loopback address and starts a signed-in browser. The default opens the disposable Fieldwork Studio and Northline Press workspaces, using a fixture model through the pinned native Gateway. Append `--fresh` for an empty workspace with the fixture provider configured. Append `--connect` for owner testing with an unconfigured provider. Each launch gets its own disposable profile and state. Close its browser or press Ctrl+C to stop it.

In the unconfigured preview, the owner can connect an authorized provider, select a model, create a company, add usable documents and a role, and start a real conversation. Live authorization, saved-account reuse with a real provider, provider disconnect/reconnect, physical-device acceptance, and Safari or WebView acceptance require a separate live walkthrough. Chromium phone and tablet emulation covers the viewport matrix above.

## Onboarding evidence

The unconfigured provider screens passed 24 browser checks. The configured manual flow passed 40 checks across the full viewport matrix, including recovery after refresh. It restored a setup note, prompted for the original file again, confirmed the note in the company brief and the XLSX in the new library, and opened the same employee’s first conversation. The proposal flow passed 60 checks. It staged a DOCX, saved a revision-checked edit and a native ability selection, launched the reviewed employee and received the first reply through the real Gateway with the disposable provider. Fast setup uses the confirmed extraction for optional project context to give the native Architect time for the actual team proposal.

| Fixture journey | Launch to actionable canvas | Launch to first reply |
| --- | ---: | ---: |
| Manual setup with an XLSX and note | 12.90 s | 18.98 s |
| Reviewed proposal with a DOCX | 29.24 s | 31.40 s |

These disposable-provider timings include native provisioning. The real provider path depends on owner authorization and model response time. [Provider selection](evidence/iteration-iv/provider-browser.json) · [Manual flow](evidence/iteration-iv/manual-onboarding-browser.json) · [Proposed team](evidence/iteration-iv/proposed-onboarding-browser.json) · [Verified canvas handoff](evidence/iteration-iv/after/light-360-launch-reviewed-canvas.jpg).

## Performance

Both main comparisons used an exact OpenClaw 2026.11.10 sidecar and the same benchmark script, workload, hardware and two browser clients. Each scale used ten cold restart pairs and 20 timed updates. The large scale was then run candidate-first. No other build or browser QA ran during these benchmark trials. The complete report retains both historical selectors and independent actionable node markers, the native RPC intervals, event delivery, initial HTML, server process samples and browser long tasks.

The actionable marker waits for the correct named employee node in the viewport and its enabled message action. The older visible-name locator remains in the benchmark. The 10/100 candidate contained the roster in all 20 initial responses. Its 11.64-second historical outlier had a ready action at 643 ms and first live snapshot at 11.16 seconds. The candidate's slowest 1/1 historical sample took 13.12 seconds while the node was ready at 597 ms. Those samples identify a difference between the two observation points and do not indicate a blocked canvas.

The shared stream still applies a 300 ms event debounce, native snapshot reconciliation and actor reauthorization. The benchmark separates native request acknowledgement from the subsequent DOM update. The extended canvas run made zero `tools.catalog` or `skills.status` calls while rendering the cold pairs. The new document listing waits for workspace scope to settle, and hiring and editing request their catalogues when opened. No canvas logic or snapshot-stream policy was adjusted to improve measurements.

| Build | Employees/sessions | Cold actionable p95 / worst | Cold legacy p95 / worst | Warm legacy worst | Native RPC p95 | Post-RPC actionable p95 | Legacy event p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| main | 1/1 | 0.676 s / 0.692 s | 4.075 s / 10.632 s | 0.238 s | 0.352 s | 1.507 s | 2.133 s |
| main | 10/100 | 0.669 s / 0.672 s | 4.088 s / 10.154 s | 0.330 s | 0.447 s | 1.456 s | 2.240 s |
| main | 50/500 | 0.682 s / 0.686 s | 4.111 s / 10.685 s | 0.259 s | 1.104 s | 1.309 s | 2.647 s |
| candidate | 1/1 | 0.659 s / 0.661 s | 4.092 s / 13.117 s | 0.241 s | 0.437 s | 1.580 s | 2.176 s |
| candidate | 10/100 | 0.660 s / 0.669 s | 4.072 s / 11.636 s | 0.228 s | 0.586 s | 1.441 s | 2.256 s |
| candidate | 50/500 | 0.681 s / 0.691 s | 4.112 s / 11.169 s | 0.246 s | 1.136 s | 1.419 s | 2.774 s |
| candidate-reverse | 50/500 | 0.649 s / 0.659 s | 9.616 s / 9.617 s | 0.249 s | 1.143 s | 1.444 s | 2.755 s |
| main-reverse | 50/500 | 0.734 s / 0.740 s | 1.186 s / 10.642 s | 0.262 s | 1.485 s | 1.276 s | 2.321 s |
| reviewed | 50/500 | 0.673 s / 0.676 s | 1.124 s / 10.580 s | 0.343 s | 1.875 s | 3.131 s | 5.174 s |

The candidate's cold actionable worst sample was 691 ms and its warm observations were below 250 ms. At 50/500, the independently observed event-to-actionable p95 was 2.35 s on the candidate and 2.17 s on main. The reverse comparison returned 2.39 s and 2.31 s. Candidate post-RPC p95 remained 1.42–1.44 s, above the 500 ms target and 110–168 ms above main in the two trials. The reviewed build has a larger tail. Its first attempt timed out at the `agents.update` RPC and its clean retry measured 3.13 s post-RPC p95 with one missed observation. Smaller samples and variance across independent native runs limit causal attribution. The measured data supports fast cold and warm rendering and leaves the large live-update tail open. [Distributions, raw samples, RPC counts, bytes, process and browser traces](evidence/iteration-iv/performance.json).

## Quality and native certification

Lint, type generation, typecheck, 2,281 tests, production build, release consistency, `git diff --check` and the canvas source guard passed. The outside-repo standalone browser replay passed 281 checks. Channel browser smoke passed six tests including all 26 Telegram steps. The simulated stable and beta shape runs completed and retain their expected limited-scope degradation. The exact stable candidate was certified separately through the real Gateway.

The installed OpenClaw 2026.11.10 package, official Gateway SDK and protocol identities passed all 18 exact evidence gates for `b6b47f72`. The final evaluator retained 92 upstream or environment-qualified skips and 69 expected authorization denials. Certified evidence includes native Chat sessions, queue and stop behavior, task state, skills attach and detach, memory, automation, human control, transport and update recovery. Production, a personal Gateway and live credentials were kept out of these runs. The recommended compatibility floor remains 2026.11.5. [Exact final certification](../evidence/openclaw-2026.11.10-pre-merge-final-certification.json) · [Channel browser results](evidence/iteration-iv/channels-browser.json).

A focused workflow run waited for a real employee in Team and the actual starter document in Knowledge. Across three visits, Team took 47–267 ms and Knowledge 127–266 ms. The live ability picker was ready in 244 ms. A 414,000-byte text import appeared in the library after 85 ms, and two document paths were confirmed through one native mutation in 1.30 s. The smaller PDF/DOCX/XLSX workflow and partial failure remain in the browser report. [Settled workflow timings](evidence/iteration-iv/settled-workflows.json) · [Settled Tasks screen](evidence/iteration-iv/after/dark-1440-settled-tasks.jpg).

## Owner walkthrough and restart

1. Open an isolated unconfigured preview and authorize a real provider through its own sign-in flow. Choose an executable model and send the first message after setup.
2. Create a company with a text-bearing document. Review one employee’s role, responsibility and abilities, then launch into Mission Control. Hire another employee and assign two sources. Ask a concrete question with an answer that can be checked against one of the documents.
3. Assign a task. Open its result or its recovery action. Review scheduled work and any real approval request separately. Switch companies and inspect the same flows on a phone.
4. Use the protected owner launcher for a walkthrough that needs to survive closing the preview. It prompts for an isolated owner password and prints the state directory. Stop it with Ctrl+C and pass that directory as its third argument when starting it again. The disposable visual preview above is designed to reset when closed.

The checked-in protected launcher is pinned to the previous AgentOS version. To run the same isolated procedure on this candidate, make a compatible scratch copy from the candidate checkout after the build above. Keep the printed state directory private and use it only with the protected launcher.

```sh
agentos_owner_dir="$(mktemp -d -t agentos-iv-owner-launcher)"
agentos_owner_launcher="$agentos_owner_dir/owner-acceptance.cjs"
node - "$agentos_owner_launcher" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const source = readFileSync("scripts/agentos-owner-acceptance.cjs", "utf8");
writeFileSync(process.argv[2], source.replaceAll("0.10.0", "0.11.0")
  .replace('"./lib/disposable-openclaw-env.ts"', 'path.resolve(process.cwd(), "scripts/lib/disposable-openclaw-env.ts")')
  .replace('"../lib/security/instance-protection.ts"', 'path.resolve(process.cwd(), "lib/security/instance-protection.ts")'));
NODE
node -r ./tests/register-paths.cjs -r jiti/register.js "$agentos_owner_launcher" "$WORKFORCE_OPENCLAW_PACKAGE" "$PWD"
```

For the restart, run the final `node` command again with the printed state directory appended in quotes. Sign in again if the browser session requires it. The protected run keeps the same isolated state while allocating new loopback ports.

## Review decision and limits

- **Engineering and fixture acceptance** are ready for review. The proposal and manual entry points use real Gateway state. Single-employee hiring uses the tested role starters, and the saved proposal retains its revision-bound roster. Existing native profile management remains available for later hiring and changes.
- **Visual review** is ready in Chromium across the documented matrix. Each populated folder has full-resolution source screenshots. Physical-phone interaction, Safari and native desktop WebView still need an owner walkthrough.
- **Live owner acceptance** remains pending. The native skills suite verified selecting an installed skill revision for the next turn and detaching it. A supplemental stdio MCP probe found its tool in the real session’s effective inventory, but the fixture conversation failed to invoke its callback. General model behavior, live MCP execution, ChatGPT account reuse and live channel authorization still need a real authorized provider or connection. [Skills evidence](../evidence/openclaw-2026.11.10-skills-effective-capabilities.json) · [Supplemental MCP result](evidence/iteration-iv/native-mcp-supplemental.json) · [OpenClaw MCP policy](https://docs.openclaw.ai/tools/mcp).
- **Public release** remains pending. The candidate stays in [draft PR #51](https://github.com/SapienXai/AgentOS/pull/51) on `codex/agentos-0.11.0-workforce-experience`. Iteration IV starts from `cd420f855304c5ecd9afd1d59e7235aa68e389bc`. The protected main reference is `49cf636241e2d00df79245d07a56a29b339687b1`.
