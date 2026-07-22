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

- Prefer native OpenClaw Gateway/API integration whenever a stable path exists.
- Use CLI fallback only when no stable native Gateway/API path exists.
- CLI fallback must be explicit, observable, and recoverable. Do not hide it.
- Do not make CLI fallback the default path if a native Gateway/API path exists.
- Do not call OpenClaw directly from random React components.
- Route OpenClaw access through the existing adapter/client/application-service boundaries.
- Do not depend on raw OpenClaw response shapes in UI when an AgentOS-normalized domain model is appropriate.
- If an OpenClaw capability is unavailable, unstable, unsupported, or unknown, show an honest degraded/unsupported/unknown state.
- Do not fake OpenClaw-backed functionality with mock/local/demo behavior.
- When touching OpenClaw behavior, update or add compatibility/contract checks when practical.

## UI / UX Rules

- For AgentOS UI, UX, responsive layout, modal, card, form, or theme work, read and follow `skills/agentos-ui-ux/SKILL.md` before editing.
- Do not build fake working UI.
- Every button, action, link, filter, sort, metric, and status should either:
  - work against real data,
  - be disabled with a clear reason,
  - or be clearly marked as coming soon.
- Prefer clear operator visibility over decorative UI.
- AgentOS UI should help users understand what agents are doing, what OpenClaw is doing, what failed, what needs approval, and what can be recovered.
- Do not add visual complexity that hides runtime state or broken behavior.

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
