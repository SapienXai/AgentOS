## Git
- All git commit messages must be written in English.
- Use concise, imperative commit subjects.
- Prefer Conventional Commits format, e.g. `feat(auth): add session refresh`.
- Keep the subject line short, ideally under 72 characters.
- Default to a single-line commit message.
- Only add a commit body when extra context is genuinely necessary.
- If a body is needed, keep it brief and focused on why the change was made.
- Do not generate long commit messages or file-by-file summaries by default.
- Do not write commit messages in Turkish unless the user explicitly asks for it.

## Project Language
- The project's default language is English.
- Do not add Turkish content to the project unless the user explicitly asks for it.
- Keep all user-facing copy in English, including UI text, placeholders, examples, documentation, and seeded content.

## AgentOS Codex Skill
- Before making AgentOS code, UX, OpenClaw integration, or release changes, read `docs/agentos-codex-skill.md`.
- Keep future changes aligned with that skill: AgentOS is the human operating layer above OpenClaw, Gateway/API integration comes first, CLI fallback must be explicit, and release/version changes must stay consistent.
