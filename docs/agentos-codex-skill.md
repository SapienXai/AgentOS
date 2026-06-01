---
name: agentos
description: Use before and during AgentOS code, UX, integration, or release work so changes stay OpenClaw-first, observable, and release-safe.
---

# AgentOS Codex Skill

Use this skill for AgentOS changes. Keep it practical: inspect the current code first, use the existing OpenClaw boundary, and make the smallest change that improves real operator control.

## Product North Star

AgentOS is the human operating layer above OpenClaw. OpenClaw remains the backend, orchestration, runtime, agent/session/task/model/device/integration layer.

AgentOS must not become a replacement orchestrator or an OpenClaw clone. It should expose, visualize, manage, and improve UX around OpenClaw-backed workspaces, agents, tasks, files, models, integrations, policies, approvals, cost visibility, and runtime state.

Success question: did this system take a real workload from the owner today?

## Start Here

Before implementing, inspect the relevant local surfaces:

- Product and architecture: `README.md`, `docs/openclaw-sync-audit.md`, `docs/openclaw-gateway-first-migration.md`
- OpenClaw boundary: `lib/openclaw/client/`, `lib/openclaw/adapter/`, `lib/openclaw/application/`, `lib/openclaw/domains/`
- AgentOS state/contracts: `lib/agentos/`, `hooks/use-mission-control-data.ts`, `hooks/use-task-feed.ts`
- UI: `components/mission-control/`, `components/operations/`, `app/*/page.tsx`
- API routes: `app/api/`
- Release/install: `packages/agentos/package.json`, `packages/agentos/scripts/check-release-consistency.mjs`, `install.sh`, `install.ps1`, `.github/workflows/release-agentos.yml`
- Tests: `tests/`, especially OpenClaw boundary, gateway-first, release consistency, and CLI smoke tests

## OpenClaw-First Rules

- Check whether OpenClaw already provides the capability through Gateway RPC, SDK/config, CLI, session/task APIs, model APIs, integration APIs, or device APIs.
- Prefer native Gateway/API integration over CLI.
- Use CLI only when no stable native Gateway/API path exists, or for existing install, recovery, gateway process control, and unsupported Gateway operations.
- Any CLI fallback must be explicit, observable, and surfaced through diagnostics, logs, UI state, or returned metadata with reason and recovery path.
- Do not duplicate OpenClaw concepts unless AgentOS needs a UI projection, cache, adapter, or workspace-local sidecar.
- Keep AgentOS-specific state separate from OpenClaw runtime state.

Decision gate for new behavior:

- If OpenClaw owns it, add or reuse a typed Gateway/client/adapter path and cover fallback behavior.
- If OpenClaw supports it only through CLI today, isolate the CLI call in the existing OpenClaw service layer and expose fallback diagnostics.
- If AgentOS owns it, name the sidecar state explicitly and keep it out of OpenClaw runtime truth.
- If neither layer clearly owns it, stop and explain the product/architecture decision before coding.

## Gateway And Sync Rules

Respect the existing boundary:

`UI -> API routes -> application services -> OpenClaw adapter/client -> OpenClaw Gateway or CLI fallback`

- Centralize OpenClaw communication in typed clients, adapters, hooks, or services. Do not scatter ad hoc Gateway calls across components.
- Keep AgentOS and OpenClaw concepts synchronized for sessions, tasks, models, integrations, devices, approvals, and workspace agents.
- Validate lifecycle behavior against real OpenClaw behavior when touching sessions, tasks, models, integrations, or device approvals.
- Preserve capability detection and fallback diagnostics. If Gateway support is uncertain, make the degraded path visible.
- Never build fake "working" UI. Connect to real data, block the action, or mark it as placeholder/demo/sample.

## UI And UX Standards

AgentOS should feel like a premium operator console: dense, readable, operational, and calm.

- Every button works, is disabled with a reason, or is clearly marked coming soon.
- Every data-heavy page has loading, empty, error, and success states.
- Important state should be visible where relevant: Gateway status, OpenClaw version, native vs CLI usage, fallback reason, model/provider state, active sessions, running tasks, approval requirements, and integration health.
- Avoid mock analytics unless clearly labeled as demo/sample data.
- Keep fallback/demo snapshots explicit; never let sample data look like a healthy production runtime.
- Reuse existing components, layout patterns, design tokens, icons, and mission-control conventions before adding new UI primitives.
- Keep workflows ergonomic for repeated operator use; prefer clear status and actions over marketing copy.

## Code Quality Rules

- Keep TypeScript strict and typed. Avoid broad `any`; justify it locally if unavoidable.
- Reuse existing components, hooks, services, utilities, and domain helpers.
- Keep changes small, reviewable, and aligned with the current architecture.
- Avoid unnecessary abstractions, duplicated logic, dead buttons, silent failures, and hardcoded fake production data.
- Surface failures with actionable messages and recovery paths.
- Add or update focused tests when changing shared behavior, OpenClaw contracts, lifecycle logic, release tooling, or user-visible workflows.
- For OpenClaw boundary changes, prefer tests near `tests/openclaw-*-test.ts`, `tests/openclaw-gateway-first-contract.test.ts`, or the matching service test.
- Run the repo's relevant validation before finalizing: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm check:release` when release files are touched.

## Default Task Workflow

1. Understand the requested task and the user-visible outcome.
2. Inspect relevant codebase areas before editing.
3. Inspect existing OpenClaw integration, docs, and tests before inventing a new path.
4. Choose the correct source of truth: native Gateway/API, SDK/config, CLI fallback, or AgentOS-only state.
5. Make the smallest correct implementation.
6. Add or update tests where practical.
7. Run available validation commands.
8. Summarize what changed, what OpenClaw capability was used, whether CLI fallback remains, what validation passed or failed, and what still needs manual verification.

## Release Mode Checklist

Enter release mode only when the user asks for release preparation. Check and align:

- `packages/agentos/package.json` version, the published package source of truth
- Root `package.json` scripts and private workspace version expectations
- npm package metadata and lockfile consistency
- Before npm publish, load local publish credentials from `.env.local` without printing secret values; verify `NPM_TOKEN`/`NODE_AUTH_TOKEN` is present, then use a temporary npm userconfig that maps `//registry.npmjs.org/:_authToken` to that token before running `pnpm publish:agentos`
- GitHub release tag format: `agentos-v<version>`
- README and package README install commands and version examples
- `install.sh` and `install.ps1`
- `packages/agentos/scripts/check-release-consistency.mjs`
- `.github/workflows/release-agentos.yml`
- OpenClaw minimum/supported version notes and diagnostics copy
- Changelog or release notes, when present
- Website/download links if present in the repo
- Build output, lint/typecheck/test status, and npm dry-run or pack output when applicable

Do not publish, tag, push, or create a release unless the user explicitly asks. Prepare the changes and instructions instead.

## Anti-Drift Rules

Do not:

- Turn AgentOS into a separate OpenClaw clone.
- Create fake backend behavior just to make UI look complete.
- Hide CLI fallback or degraded Gateway behavior.
- Add concepts that do not support AgentOS' operator-control product goals.
- Rewrite large areas before proving the current structure is wrong.
- Create version or release mismatches between GitHub, npm, docs, installers, and workflows.
- Add Turkish project content or user-facing copy unless explicitly requested.
