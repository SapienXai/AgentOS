# AgentOS OpenClaw plugin release

AgentOS publishes an official, thin OpenClaw code plugin as `@sapienx/openclaw-agentos` under the `sapienx` ClawHub publisher. The plugin id is `agentos` and its bundled skill is `skills/agentos`.

## Ownership decision

- User outcome: open, start, inspect, and diagnose AgentOS from the native OpenClaw CLI.
- OpenClaw ownership: plugin discovery, plugin loading, CLI registration, Gateway/runtime state, and skill execution.
- AgentOS ownership: the canonical `agentos` CLI and the operator control plane it starts and diagnoses.
- AgentOS responsibility: a small compatibility bridge only.
- Source of truth: OpenClaw owns plugin/runtime state; AgentOS owns its own CLI and application state.
- Fallback: the bridge resolves a separately installed AgentOS executable from `AGENTOS_BIN`, the installed package, or `PATH`. Missing AgentOS is an explicit exit-127 diagnostic.
- Compatibility target: OpenClaw `2026.9.4`, the repository's recommended/native certified contract.

The plugin intentionally has no runtime dependency on `@sapienx/agentos`; it must not embed a second copy of the AgentOS application. OpenClaw is not called from React or API routes, and the bridge does not create a parallel runtime, Gateway, task engine, or skill engine.

## Local release flow

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build:openclaw-agentos
pnpm validate:openclaw-agentos
pnpm test:openclaw-agentos
pnpm pack:openclaw-agentos
```

The ClawPack artifact is created in `/tmp/agentos-openclaw-artifacts` by default. Set `OPENCLAW_AGENTOS_PACK_DESTINATION` to use another disposable output directory.

Validate the exact artifact and install it into a disposable OpenClaw profile before publishing:

```bash
clawhub package validate packages/openclaw-agentos --openclaw-version 2026.9.4 --json
openclaw plugins install npm-pack:/absolute/path/to/openclaw-agentos-0.1.0.tgz --force
openclaw plugins inspect agentos --runtime --json
```

After installation, verify the command surface with `openclaw agentos version`, `openclaw agentos status`, and `openclaw agentos doctor --deep` against a separately installed AgentOS CLI.

## ClawHub publication

Use the authenticated `sapienx` publisher and the exact ClawPack artifact:

```bash
clawhub package publish /absolute/path/to/openclaw-agentos-0.1.0.tgz \
  --family code-plugin \
  --owner sapienx \
  --wait
```

Run a dry-run immediately before the real publish and stop if validation or security scanning is blocked:

```bash
clawhub package publish /absolute/path/to/openclaw-agentos-0.1.0.tgz \
  --family code-plugin \
  --owner sapienx \
  --dry-run
```

The manifest declares one active category, `other`. The certified OpenClaw `2026.9.4` manifest taxonomy and the current ClawHub taxonomy do not share a more specific control-plane category, so this is the honest compatibility intersection; do not pass `--categories` for plugin publication. After the first normal token-authenticated publish, configure trusted publishing against `SapienXai/AgentOS` and this workflow filename:

```bash
clawhub package trusted-publisher set @sapienx/openclaw-agentos \
  --repository SapienXai/AgentOS \
  --workflow-filename openclaw-agentos-package-publish.yml
```

The workflow keeps pull requests dry-run-only and limits real publication to a manual dispatch or an `openclaw-agentos-v*` tag. The standalone skill uses the official `skill-publish.yml` workflow and is published manually under the same `sapienx` publisher.

## Security contract

- `CLAWHUB_TOKEN` is read only by the local release command or the GitHub Actions secret store; it must never be committed or printed.
- The plugin uses `spawn(..., { shell: false })` and forwards only known AgentOS options.
- Missing AgentOS fails closed with an actionable nonzero result.
- No OpenClaw credentials, browser profiles, cookies, Gateway tokens, or AgentOS runtime state are stored by the plugin.
