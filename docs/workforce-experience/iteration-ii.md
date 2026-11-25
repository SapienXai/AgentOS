# Workforce Experience Iteration II

The design baseline is the reviewed branch commit `e63791dce1b5a2a3951581ae8a1b5c011eb0b254`. The frozen delivery code is `2d12152b4e82788431e06d5246428fe50367fb7d`. The performance baseline is main `49cf636241e2d00df79245d07a56a29b339687b1`. Browser and native runtime verification used the npm OpenClaw `2026.11.10` Gateway and its matching SDK at protocol 4. AgentOS remains at the unpublished `0.11.0` version.

## Workflow changes

| Surface | What to try |
| --- | --- |
| Setup | Connect AI, enter the company name and brief, then review a proposal or build the team manually. Reload the workspace form in the same tab to check draft recovery. A saved team revision keeps its employee IDs and uses the workspace creation run's existing authorization, lease and composition checks. |
| Team | Open a portrait and role, inspect the current assignment, start a chat or use Assign task. Add an employee using a role baseline, then review Overview, Knowledge, Capabilities, Activity and Settings. |
| Knowledge | Read the company brief, guidelines and shared documents. Upload a Markdown or JSON document into the selected workspace, save a reference, and open an employee's knowledge. Advanced file access holds the native system files. |
| Integrations | Browse application identities, review status and use the provided setup action. Open details for permissions and configuration, or review an employee's effective access from their profile. Native capabilities remain available under the advanced disclosure. |
| Settings | Use General for preferences, AI & Models for provider setup, and Runtime for freshness and recovery. Workspace, Security and Advanced keep the existing routes and actions. |

The manual onboarding path keeps the previous product decisions. After AI is configured, Create workspace, Build team manually and Launch workspace reach the populated canvas. Chat and Send reach the first reply. The suggested path adds a review where operator edits can be saved before launch. Draft recovery retains only the local company fields and manual roster in the current tab, with known credential formats redacted. Staged sources and reviewed proposals use server-side workspace creation records. The native provider flow retains credential entry, connection and recovery.

## Full-resolution comparisons

Each link opens an individual application screenshot. The tests used 1440 × 900, 820 × 1180 and 390 × 844 with light and dark themes. Fixtures use a disposable company and employee records.

| Surface | Before | After |
| --- | --- | --- |
| Connect AI, phone | [Welcome](evidence/iteration-ii/before/light-390-connect-ai.jpg) | [Welcome](evidence/iteration-ii/after/light-390-connect-ai.jpg) |
| Provider choice, phone | [Provider choice](evidence/iteration-ii/before/light-390-provider-choice.jpg) | [Provider choice](evidence/iteration-ii/after/light-390-provider-choice.jpg) |
| Workspace, desktop | [Company setup](evidence/iteration-ii/before/dark-1440-create-workspace.jpg) | [Company setup](evidence/iteration-ii/after/dark-1440-create-workspace.jpg) |
| Team setup, phone | [Manual team](evidence/iteration-ii/before/light-390-build-team.jpg) | [Manual team](evidence/iteration-ii/after/light-390-build-team.jpg) |
| Team, desktop | [Employee cards](evidence/iteration-ii/before/dark-1440-team.jpg) | [Employee cards](evidence/iteration-ii/after/dark-1440-team.jpg) |
| Employee profile, desktop | [Identity](evidence/iteration-ii/before/light-1440-identity.jpg), [Intelligence](evidence/iteration-ii/before/dark-1440-intelligence.jpg) | [Overview](evidence/iteration-ii/after/light-1440-employee-overview.jpg), [Settings](evidence/iteration-ii/after/dark-1440-intelligence.jpg) |
| Chat, desktop | [Conversation](evidence/iteration-ii/before/dark-1440-chat.jpg) | [Conversation](evidence/iteration-ii/after/dark-1440-chat.jpg) |
| Knowledge, phone | [Workspace files](evidence/iteration-ii/before/light-390-knowledge.jpg) | [Company knowledge](evidence/iteration-ii/after/light-390-knowledge.jpg) |
| Integrations, phone | [Technical directory](evidence/iteration-ii/before/dark-390-integrations.jpg) | [Application directory](evidence/iteration-ii/after/dark-390-integrations.jpg) |
| Settings, phone | [General](evidence/iteration-ii/before/light-390-settings.jpg) | [General](evidence/iteration-ii/after/light-390-settings.jpg) |

The first browser review led to a shorter mobile path to integrations, clearer employee cards, and a consistent setup surface. The next review added recognizable application marks, kept Knowledge controls stable while refreshing, and moved Settings onto the workforce background. The workspace selection fix avoids writing a system-workspace default over a valid stored company selection during startup.

## Canvas preservation

**PASS.** Protected global styles, canvas components, graph nodes, edges, status tones and existing canvas tests have zero diff versus the reviewed branch. Graph geometry and saved positions matched in the four viewport/theme comparisons after normalizing fixture task IDs. The mean absolute channel delta in the raw captures ranged from 0.0551 to 0.1001 out of 255. Three of four viewport transforms matched exactly. Desktop dark differed by 4.35 px horizontally, 1.50 px vertically and 0.00099 in scale at capture. Fixture task IDs, clocks and live visual state vary between runs. Zoom, node menus, mobile inspector and persisted drag passed 14 of 14 on each build. [Graph comparisons](evidence/iteration-ii/canvas-comparison.json), [desktop light before](evidence/iteration-ii/canvas/light-1440-before.png), [desktop light after](evidence/iteration-ii/canvas/light-1440-after.png), [phone dark before](evidence/iteration-ii/canvas/dark-390-before.png), [phone dark after](evidence/iteration-ii/canvas/dark-390-after.png).

The normal-motion fixture passed four checks for task filtering and tether movement. The connection fixture passed eight checks covering the Telegram route, login target, pan and task inspector. Both fixtures reuse the established canvas regression workflows. [Motion results](evidence/iteration-ii/canvas-motion.json), [connected-canvas results](evidence/iteration-ii/canvas-tether.json).

Compare the reviewed and candidate applications using the same Gateway package, seeded employees, graph dimensions and viewport. Launch the harness with `WORKFORCE_VIEWPORTS=1440,390` and `--matched-canvas` against both production builds. That uses the same mobile canvas height on both branch revisions. The original branch-to-main evidence remains in the [first acceptance report](acceptance.md#canvas-preservation).

Additional full-size captures cover [suggested team](evidence/iteration-ii/after/dark-390-suggested-team.jpg), [saved team edits](evidence/iteration-ii/after/light-390-reviewed-team-edits.jpg), [manual workspace launch](evidence/iteration-ii/after/light-390-launch-workspace.jpg), [workspace switcher](evidence/iteration-ii/after/dark-390-workspace-switcher.jpg), [Add employee](evidence/iteration-ii/after/light-390-add-employee.jpg), [employee Activity](evidence/iteration-ii/after/dark-820-employee-activity.jpg), [constrained-height Chat](evidence/iteration-ii/after/light-390-chat-focused-470.jpg), [task detail](evidence/iteration-ii/after/light-1440-task-detail.jpg), and [Runtime settings](evidence/iteration-ii/after/dark-820-runtime.jpg).

## Quality and native verification

- The populated browser matrix passed 131 of 131 checks. The expanded replay against the frozen build passed 140 of 143. A light desktop drag persistence predicate and two related workspace picker pointer assertions timed out. Focused checks exercised persisted drag and repeated the desktop workspace switch by keyboard. The populated suite created an employee, saved and reopened a Markdown document, saved and reopened a reference, and received a native Chat reply. Guest and member checks denied direct protected access. Revoking owner access closed an active SSE connection and prevented reconnect. [Browser matrix](evidence/iteration-ii/populated-browser.json), [expanded replay](evidence/iteration-ii/expanded-browser-replay.json), [focused Knowledge and keyboard checks](evidence/iteration-ii/knowledge-and-keyboard-browser.json).
- Provider choice passed 12 of 12, the manual first-workspace flow passed 21 of 21, and suggested review passed 30 of 30 across three viewport sizes and both themes. The suggestion fixture exercises the existing safe proposal fallback, saving the role and instructions, and Start over. A separate phone run passed 10 of 10, including launch, canvas read-back and verification of the edited employee role and instructions in the native snapshot. Mobile button bounds were checked inside the dialog. [Provider checks](evidence/iteration-ii/provider-onboarding.json), [manual setup](evidence/iteration-ii/manual-onboarding.json), [suggested review](evidence/iteration-ii/suggested-team.json), [suggested launch checks](evidence/iteration-ii/suggested-launch.json), [launched workspace](evidence/iteration-ii/after/light-390-launch-reviewed-team.jpg).
- Lint, Next route type generation, TypeScript, 2,275 repository tests, the production build, release consistency, simulated stable compatibility, six channel scenarios and the authenticated Mission Control smoke passed. Telegram completed all 26 browser acceptance steps in the channel fixture. [Channel checks](evidence/iteration-ii/channels-browser.json), [authenticated Mission Control smoke](evidence/iteration-ii/mission-control-smoke.json).
- Exact OpenClaw final certification passed all 18 required artifacts. The evaluation reports 90 skipped checks and 69 expected authorization denials. The certified code is `2d12152b` and the evidence input commit is `e2cd91a7`. The official transport check has an optional unsupported native task-list probe. Live provider OAuth, real Telegram account pairing, physical devices, public release and deployment remain outside the fixture coverage. The recommended OpenClaw version remains `2026.11.5`. [Final certified evidence](../evidence/openclaw-2026.11.10-pre-merge-final-certification.json).

## Performance replay

Main, the reviewed revision and Iteration II were replayed with isolated Gateway and AgentOS state, identical native sessions, two Chromium browser contexts and two raw SSE subscribers. The workload used ten native session updates and five browser event-to-DOM samples per scale. The runs were sequential with browser QA and native certification stopped. The instrumented runs compare the production main build and a late Iteration II production build using the same dashboard test. The final mobile onboarding fit follow-up changed the setup modal and its test.

| Employees / native sessions | Main cold visible name | Iteration II cold visible name | Main → Iteration II warm | Main → Iteration II event-to-DOM p95 |
| --- | --- | --- | --- | --- |
| 1 / 1 | 1,106–1,108 ms | 1,097–13,160 ms | 235–318 → 190–192 ms | 2,101 → 2,120 ms |
| 10 / 100 | 1,075–10,626 ms | 1,064–1,087 ms | 222–236 → 202 ms | 2,272 → 2,289 ms |
| 50 / 500 | 1,100 ms | 591–1,091 ms | 248–254 → 229–230 ms | 2,671 → 2,653 ms |

The branch's original 8.15-second cold result at 10 employees did not recur in the isolated candidate runs. The 50-employee candidate measured 2,789 ms and 2,653 ms event-to-DOM p95 in successive instrumented replays. Main measured 2,671 ms on the instrumented run and 3,071 ms on the earlier replay. All update samples arrived. The latest candidate p95 reached main parity at this workload. Five samples per scale leave limited confidence about the tail.

Initial HTML contained the roster. In the 10.63-second main and 13.16-second candidate outliers, the observer saw the canvas and first agent DOM node at 596 and 610 ms respectively. Navigation TTFB was 228 and 254 ms. The buffered observer recorded no long task at startup on those pages. Both outliers made 38 cold runtime calls against the usual 17. This shows that canvas insertion, visible-name readiness and native refresh work have distinct timings. The cause of the intermittent visible-name delay remains open, so the under-three-second target is still unproven across all cold runs. The post-hydration warm path stayed below 500 ms in every replay. Iteration II defers settings, onboarding and the workspace creation wizard out of the initial canvas path and preserves unchanged model list references when handling stream status. [Raw workload and timings](evidence/iteration-ii/performance.json).

## Launch an isolated preview

From a checkout of the branch at the tested commit:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
WORKFORCE_OPENCLAW_PACKAGE="$PWD/node_modules/.pnpm/node_modules/openclaw" \
  node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/workforce-experience-preview.cjs --serve
```

The launcher opens a dedicated authenticated Chromium window and prints its loopback URL. It creates Fieldwork Studio and Northline Press with a real OpenClaw Gateway and a disposable loopback provider. Use `--serve --fresh` to test workspace setup from an empty company or `--serve --connect` to review setup with no configured AI provider. Close the window or press Ctrl+C to stop the preview.

For screenshot and browser checks, omit `--serve` and set `WORKFORCE_VIEWPORTS=1440,820,390` and `WORKFORCE_EVIDENCE=/path/to/output`. Repeat with `--connect`, `--fresh` and `--suggested` into separate output directories.
