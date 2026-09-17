# @sapienx/openclaw-agentos

The official OpenClaw plugin for AgentOS.

This package is intentionally a thin CLI bridge. It registers the native OpenClaw `agentos` command and delegates to the canonical `@sapienx/agentos` CLI. It does not embed AgentOS, implement a second runtime, own Gateway state, or replace OpenClaw's skill and plugin lifecycle.

## Requirements

- OpenClaw `2026.9.4` or a later compatible `2026.x` release.
- Node.js `24.16+` or `26.1+`.
- AgentOS installed separately as `@sapienx/agentos`, with its `agentos` executable available on `PATH`.

If AgentOS is installed in a non-standard location, set `AGENTOS_BIN` to its absolute executable path. The bridge never invokes a shell and never forwards arbitrary command arguments.

## Install from ClawHub

```bash
openclaw plugins install clawhub:@sapienx/openclaw-agentos
openclaw agentos
```

The `agentos` root command opens AgentOS. Explicit subcommands are available for operators and automation:

```bash
openclaw agentos open
openclaw agentos start --port 3000 --host 127.0.0.1
openclaw agentos status
openclaw agentos doctor --deep --json
openclaw agentos version
```

The plugin returns the AgentOS CLI exit status. If AgentOS is unavailable, it exits with `127` and prints an actionable installation message. OpenClaw remains authoritative for runtime, Gateway, plugin, and skill state.

## Development

```bash
pnpm install
pnpm --filter @sapienx/openclaw-agentos build
pnpm --filter @sapienx/openclaw-agentos validate
pnpm --filter @sapienx/openclaw-agentos test
pnpm --filter @sapienx/openclaw-agentos pack:clawhub
```

The package targets the AgentOS repository's certified OpenClaw contract, `2026.9.4`. Compatibility metadata is intentionally explicit in both `package.json` and `openclaw.plugin.json`.

## Bundled skill

The package includes the AgentOS guidance skill at [`skills/agentos/SKILL.md`](skills/agentos/SKILL.md). The same folder is published as the standalone `agentos` skill under the `sapienx` ClawHub publisher.
