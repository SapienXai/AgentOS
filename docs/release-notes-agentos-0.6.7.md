# AgentOS 0.6.7 Release Notes

AgentOS 0.6.7 focuses on task continuity, model/provider reliability, and safer runtime dispatch for the packaged local control plane.

## Highlights

- Adds follow-up task card continuity so review and next-step task context remains available across refreshes.
- Refines task UI surfaces and Codex app-server handling for clearer task state and runtime output.
- Normalizes Codex model aliases and improves model/provider onboarding, catalog, and registry behavior.
- Merges Ollama catalog data into registered provider models so locally available models are easier to select.
- Blocks dispatch through unusable account/browser auth profiles before a task starts.
- Fixes package prepack compatibility for follow-up task grouping by avoiding Node-only crypto in browser-reachable code.
- Splits large Operations account/task/model/file/integration surfaces into focused components for more maintainable release behavior.
- Keeps release packaging aligned with the pnpm workspace lockfile and excludes generated deliverables from source control.

## Verification

Run before publishing:

```bash
pnpm lint
pnpm typegen
pnpm typecheck
pnpm test
pnpm build
pnpm check:release
pnpm smoke:agentos-package
```

Run on a real local OpenClaw stable install before announcing the release:

```bash
agentos doctor --deep
```

## Known Limitations

- Clean-install smoke remains a manual physical-machine step because it depends on local OpenClaw Gateway auth, operator scopes, model credentials, browser profile state, and provider state.
- Account-target browser-profile dispatch remains an MVP bridge until OpenClaw exposes typed browser-profile dispatch.
- `requires_approval` account rules are saved as policy state but cannot dispatch account-target tasks until approval dispatch exists.
- Surface repair remains preview-first; review audit, backup, affected paths, and restore instructions before applying.

If AgentOS is useful in your workflow, please star the repository and share feedback or issues so the open source release can keep improving.
