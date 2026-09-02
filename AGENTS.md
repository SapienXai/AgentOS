# AGENTS.md

## Project Identity

AgentOS is the human operating layer above OpenClaw.

OpenClaw is the backend, runtime, orchestration, agent, tool, model, session, and gateway layer. AgentOS must not clone or replace OpenClaw. AgentOS should provide the operator-facing workspace, control, visibility, policy, and coordination layer on top of OpenClaw.

When in doubt:
- Use OpenClaw as the source of truth.
- Keep AgentOS as the control/UI/application layer.
- Do not duplicate OpenClaw backend functionality inside AgentOS.

## Required Project Skill

Before making AgentOS code, UX, OpenClaw integration, security, release, or publishing changes, read:

`docs/agentos-codex-skill.md`

Keep all changes aligned with that skill.

If the task touches OpenClaw, releases, npm publishing, GitHub releases, auth, accounts, model credentials, API routes, local operator access, browser profiles, or security-sensitive behavior, the skill file is mandatory context, not optional background.

## Project Language

- The project’s default language is English.
- Do not add Turkish content to the project unless the user explicitly asks for it.
- Keep user-facing copy in English, including UI text, placeholders, examples, documentation, seeded content, errors, empty states, release notes, and CLI output.
- Internal comments should also be English unless there is a strong reason otherwise.

## Git

- All git commit messages must be written in English.
- Use concise, imperative commit subjects.
- Prefer Conventional Commits format, for example: `feat(auth): add session refresh`.
- Keep the subject line short, ideally under 72 characters.
- Default to a single-line commit message.
- Only add a commit body when extra context is genuinely necessary.
- If a body is needed, keep it brief and focused on why the change was made.
- Do not generate long commit messages or file-by-file summaries by default.
- Do not write commit messages in Turkish unless the user explicitly asks for it.

## OpenClaw Integration Rules

- Before adding or changing a feature that touches or may overlap with OpenClaw, inspect the current upstream OpenClaw capability and ownership model first. Do not derive a new backend abstraction directly from a UI or product requirement.
- Prefer OpenClaw's current primitives, Gateway/API surfaces, config/schema, and lifecycle over AgentOS-owned runtime concepts. Implement only the smallest AgentOS-specific gap.
- Classify the work as OpenClaw-owned, an explicit fallback, an AgentOS projection, an AgentOS sidecar, or higher-level composition before coding. If ownership is unclear, stop and resolve the architecture question first.
- The mandatory discovery workflow, ownership matrix, source-of-truth hierarchy, and feature decision record are defined in `docs/agentos-codex-skill.md`.
- Prefer native OpenClaw Gateway/API integration whenever a stable path exists.
- Use CLI fallback only when no stable native Gateway/API path exists.
- CLI fallback must be explicit, observable, and recoverable. Do not hide it.
- Do not make CLI fallback the default path if a native Gateway/API path exists.
- Do not duplicate OpenClaw runtime concepts or build a parallel runtime, orchestrator, skill engine, tool engine, model layer, or task engine inside AgentOS.
- Do not call OpenClaw directly from random React components.
- Route OpenClaw access through the existing adapter/client/application-service boundaries.
- Do not depend on raw OpenClaw response shapes in UI when an AgentOS-normalized domain model is appropriate.
- If an OpenClaw capability is unavailable, unstable, unsupported, or unknown, show an honest degraded/unsupported/unknown state.
- Do not fake OpenClaw-backed functionality with mock/local/demo behavior.
- When touching OpenClaw behavior, update or add compatibility/contract checks when practical.

## UI / UX Rules

- For AgentOS UI, UX, responsive layout, modal, card, form, or theme work, read and follow `skills/agentos-ui-ux/SKILL.md` before editing.
- Inspect the existing product surface, interaction patterns, primitives, and semantic tokens before creating a new UI pattern; reuse or extend the closest canonical pattern first.
- A new feature does not justify a new visual language. Keep foundations, primitives, patterns, product surfaces, and feature flows aligned with the existing hierarchy.
- Do not build fake working UI.
- Every button, action, link, filter, sort, metric, and status should either:
  - work against real data,
  - be disabled with a clear reason,
  - or be clearly marked as coming soon.
- Keep current scope, state, next action, failure detail, and recovery path visible near the affected operation.
- Make mobile behavior, safe areas, keyboard access, focus, contrast, motion, and touch reachability intentional for every meaningful flow.
- Prefer clear operator visibility over decorative UI and use semantic tokens before recurring local colors.
- AgentOS UI should help users understand what agents are doing, what OpenClaw is doing, what failed, what needs approval, and what can be recovered.
- Do not add visual complexity that hides runtime state or broken behavior.
- Detailed UI architecture, state vocabulary, canonical patterns, and decision-record guidance live in `skills/agentos-ui-ux/SKILL.md`.

## Security Rules

- Do not treat CSRF checks, Origin checks, Referer checks, Host checks, loopback checks, or local network assumptions as authentication.
- Do not expose sensitive read or write API routes without intentional access control.
- Never log secrets, tokens, cookies, API keys, npm tokens, auth profiles, browser session data, model credentials, or private environment values.
- Never commit `.env`, `.env.local`, `.env.production`, credential files, browser profile data, tokens, cookies, or generated secret files.
- Do not trust client-controlled headers as proof of identity.
- If a secret is missing, fail safely without printing the secret value.
- Sensitive API responses should return only the minimum fields needed by the UI.

## Release / Publish Rules

- Do not publish, tag, push, or create a GitHub release unless the user explicitly asks.
- When the user explicitly asks for a release, follow the repo’s release workflow and `docs/agentos-codex-skill.md`.
- Keep package versions, npm package versions, installer versions, release notes, tags, and GitHub release assets consistent.
- Never print npm tokens, GitHub tokens, or any publish credentials.
- Never commit `.env*` files.
- Run release consistency checks when available.
- Verify npm publish and GitHub release results after publishing.

## Validation

Before reporting completion, run the relevant validation commands when available:
- lint
- typecheck
- tests
- build
- release consistency checks
- OpenClaw compatibility checks when OpenClaw behavior is touched

If a command cannot be run, say so clearly and explain why.
Do not claim validation passed unless it actually ran and passed.

## Final Response Expectations

At the end of each task, report:
- what changed,
- which files changed,
- what validation ran,
- whether OpenClaw compatibility was affected,
- whether security-sensitive surfaces were touched,
- any remaining risks or follow-ups.

Do not hide failed steps. Do not claim production readiness unless validation proves it.
