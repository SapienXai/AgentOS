# Workforce Experience

AgentOS should feel like running a company. Mission Control remains the starting point and retains its existing graph, styling, persistence and node actions.

## Design and ownership

The shell, workspace selector and destinations are AgentOS presentation. The existing snapshot stream remains the source for current workspace and workforce activity. OpenClaw owns execution, employee identity, conversations, files, tools and approvals. New destinations compose the current authenticated routes and use the existing settings, editors and dialogs. Runtime discovery and CLI recovery keep their current contracts.

The sidebar provides a persistent desktop rail with an expandable workspace selector. Mobile moves the four most frequent destinations into a bottom bar and opens secondary destinations through More. The canvas gets its own available viewport. Navigation links retain browser history and expose their current destination to assistive technology. Native page and dialog focus, touch targets and scrolling are handled near each surface.

## Routes

| Destination | Existing routes |
| --- | --- |
| Mission Control | `/`, `/mission-control`, and legacy `/dashboard` |
| Chat | Native conversations with existing contextual chat still available from the canvas |
| Team | `/team`, legacy `/agents` and employee detail at `/agents/[agentId]` |
| Tasks | `/missions`, task details, `/human-control` and `/tasks` for native task runs |
| Knowledge | `/knowledge` and the existing advanced `/files` view |
| Integrations | `/integrations`, `/channels` and `/accounts` |
| Settings | `/settings`, `/models`, `/operations` and `/updates` |

## Run an isolated preview

Use Node.js 24.22.1+ or 26.12.1+. From this branch, install locked dependencies, ensure Playwright Chromium is installed, and build the actual application.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build

workforce_runtime="$(find "$PWD/node_modules/.pnpm" -maxdepth 3 -path '*/node_modules/openclaw' -print | head -1)"
WORKFORCE_OPENCLAW_PACKAGE="$workforce_runtime" \
  node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/workforce-experience-preview.cjs --serve
```

The launcher opens a dedicated Chromium window already signed in to a disposable AgentOS instance. It creates Fieldwork Studio and Northline Press through AgentOS using the real OpenClaw 2026.11.10 Gateway. The model answers come from a loopback fixture. Close Chromium or press Ctrl+C to stop the app and Gateway and remove the disposable state.

Use `--serve --fresh` to start with a configured fixture provider and no company. Use `--serve --connect` to start without a provider. The connect preview stops at the point where real provider authorization is needed.

To reproduce screenshots and route checks, omit `--serve` and set `WORKFORCE_EVIDENCE` to a local output directory. Use `WORKFORCE_VIEWPORTS=1440,1280,820,844,390,360` to include tablet and landscape. The default suite covers 1440, 1280, 390 and 360 pixels. To reproduce the canvas interaction comparison, set `WORKFORCE_VIEWPORTS=1440,390` and pass `--matched-canvas`. Build the baseline at `49cf6362` in another checkout, then invoke this branch’s copy of the script with that checkout as the working directory and append `--baseline`.

## Owner walkthrough

1. Switch between Fieldwork Studio and Northline Press in Mission Control. Use a node menu, zoom, fit the canvas, and open the mobile inspector.
2. In Team, add an employee with a name, role and responsibility. Open their profile and review context, capability evidence and AI model.
3. Send a message from Chat, refresh, and reopen the employee to see the native conversation. For real inference, connect an authorized provider outside the disposable fixture.
4. In Tasks, open a result, check Needs you, and review schedules. Use a disposable employee before testing a new run or a schedule.
5. Open a managed document in Knowledge and follow its source and scope. In Integrations, use Channels or Accounts when the action requires native connection setup.
6. In Settings, review AI & Models, Runtime and Advanced. The developer branch is a candidate and follows the existing runtime recommendation policy.

## Evidence

See [acceptance evidence](acceptance.md) for the screen index, canvas comparison, verification results and known limitations.

See [Iteration II](iteration-ii.md) for its updated workflows, full-resolution captures, measurements and preview instructions.
