<div align="center">

  <h1>Run AgentOS from OpenClaw.</h1>

  <p>
    <strong>The human operating layer for your AI workforce.</strong><br />
    Build, inspect, and steer digital workers without leaving your OpenClaw workflow.
  </p>

  <p>
    <a href="https://clawhub.ai/plugins/@sapienx/openclaw-agentos">
      <img src="https://img.shields.io/badge/ClawHub-install-ff2056?style=for-the-badge&labelColor=111827" alt="Install from ClawHub" />
    </a>
    <a href="https://github.com/SapienXai/AgentOS">
      <img src="https://img.shields.io/badge/Open%20source-SapienXai-16c7a3?style=for-the-badge&labelColor=111827" alt="Open source by SapienXai" />
    </a>
  </p>

  <a href="https://youtu.be/ribFHZuKRos">
    <img src="https://raw.githubusercontent.com/SapienXai/AgentOS/main/public/assets/screenshots/hero.jpeg" alt="AgentOS Mission Control product preview" width="100%" />
  </a>

  <sub>Click the preview to watch AgentOS in action.</sub>

</div>

<br />

> **OpenClaw runs the workforce. AgentOS gives humans the control room.**

<p align="center">
  <img src="https://raw.githubusercontent.com/SapienXai/AgentOS/main/public/readme/agentos-core.webp" alt="AgentOS Mission Control operator surface" width="100%" />
</p>

## What this plugin unlocks

The official AgentOS plugin adds a native <code>agentos</code> command to OpenClaw. From there, operators can open the AgentOS control plane, inspect runtime readiness, and run diagnostics against the canonical AgentOS CLI.

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Build</h3>
      Create workspaces and digital workers with identity, context, policies, tools, and model access.
    </td>
    <td width="33%" valign="top">
      <h3>Operate</h3>
      Inspect Gateway health, tasks, sessions, transcripts, outputs, models, channels, and failures.
    </td>
    <td width="33%" valign="top">
      <h3>Control</h3>
      Keep degraded states, fallback paths, approvals, and recovery actions visible to the operator.
    </td>
  </tr>
</table>

## Install

Install the package from ClawHub:

~~~bash
openclaw plugins install clawhub:@sapienx/openclaw-agentos
~~~

Then launch the native command:

~~~bash
openclaw agentos
~~~

AgentOS is installed separately because this plugin is deliberately a bridge, not a second AgentOS runtime:

~~~bash
pnpm add -g @sapienx/agentos
# or
npm install -g @sapienx/agentos
~~~

## The operator command set

~~~bash
# Open AgentOS
openclaw agentos
openclaw agentos open

# Start with explicit options
openclaw agentos start --open
openclaw agentos start --port 3000 --host 127.0.0.1

# Inspect readiness
openclaw agentos status
openclaw agentos doctor --deep
openclaw agentos doctor --deep --json
openclaw agentos version
~~~

The bridge returns the AgentOS CLI exit status. If AgentOS cannot be found, it exits with <code>127</code> and prints an actionable installation message.

## OpenClaw stays authoritative

This plugin does not embed or replace OpenClaw. Ownership remains clear:

| OpenClaw owns | AgentOS provides |
| --- | --- |
| Gateway, runtime, agents, sessions, tasks, tools, models, channels, plugins, and skill lifecycle | Human-facing workspaces, Mission Control, diagnostics, operator visibility, and control UX |

The plugin only registers the native OpenClaw CLI surface and delegates to the canonical <code>@sapienx/agentos</code> executable. It does not create a parallel runtime, Gateway, scheduler, skill engine, or task system.

## Requirements and recovery

- OpenClaw <code>2026.9.4</code> or a later compatible <code>2026.x</code> release
- Node.js <code>24.16+</code> or <code>26.1+</code>
- AgentOS installed separately as <code>@sapienx/agentos</code>

If AgentOS is installed in a non-standard location, set <code>AGENTOS_BIN</code> to its absolute executable path:

~~~bash
export AGENTOS_BIN=/absolute/path/to/agentos
openclaw agentos doctor --deep
~~~

If the command reports that AgentOS is unavailable:

1. Confirm that the AgentOS package and executable are installed.
2. Check that the executable is on <code>PATH</code>, or set <code>AGENTOS_BIN</code>.
3. Run <code>openclaw agentos doctor --deep</code>.
4. Treat missing, degraded, or unknown Gateway state as a real diagnostic state.

The bridge never invokes a shell and never forwards arbitrary command arguments.

## Bundled skill

This package includes the AgentOS operator skill at [skills/agentos/SKILL.md](skills/agentos/SKILL.md). The same skill is available as a standalone ClawHub release:

- [Install <code>@sapienx/agentos</code> on ClawHub](https://clawhub.ai/sapienx/skills/agentos)
- [Visit the AgentOS website](https://agentos.sapienx.app/)
- [Watch the product demo](https://youtu.be/ribFHZuKRos)

## Development

~~~bash
pnpm install
pnpm --filter @sapienx/openclaw-agentos build
pnpm --filter @sapienx/openclaw-agentos validate
pnpm --filter @sapienx/openclaw-agentos test
pnpm --filter @sapienx/openclaw-agentos pack:clawhub
~~~

The package targets the AgentOS repository's certified OpenClaw contract, <code>2026.9.4</code>. Compatibility metadata is explicit in both <code>package.json</code> and <code>openclaw.plugin.json</code>.

<div align="center">
  <br />
  <sub>Built by <a href="https://github.com/SapienXai">SapienXai</a> on <a href="https://github.com/openclaw/openclaw">OpenClaw</a>.</sub>
</div>
