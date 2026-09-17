---
name: agentos
description: Use AgentOS as the operator control plane above OpenClaw for starting, inspecting, and diagnosing a digital workforce.
user-invocable: true
metadata: { "openclaw": { "emoji": "🧭" } }
---

<div align="center">

  <a href="https://agentos.sapienx.app/">
    <img src="https://raw.githubusercontent.com/SapienXai/AgentOS/main/public/assets/logo.webp" alt="AgentOS logo" width="72" />
  </a>

  <h1>AgentOS</h1>

  <p>
    <strong>Run AI agents like a company.</strong><br />
    The human operating layer above OpenClaw.
  </p>

  <a href="https://youtu.be/ribFHZuKRos">
    <img src="https://raw.githubusercontent.com/SapienXai/AgentOS/main/public/assets/screenshots/hero.jpeg" alt="AgentOS Mission Control product preview" width="100%" />
  </a>

  <sub>Operator guide · OpenClaw-native · Human-controlled</sub>

</div>

# AgentOS operator guide

AgentOS is the operator-facing control plane above OpenClaw. OpenClaw remains authoritative for the Gateway, agents, sessions, tasks, models, channels, plugins, runtime skills, and native lifecycle.

## Start here

Use the native OpenClaw plugin command when it is installed:

~~~bash
openclaw agentos
~~~

The command opens AgentOS in the default browser. For explicit operations:

~~~bash
openclaw agentos start --open
openclaw agentos status
openclaw agentos doctor --deep
openclaw agentos doctor --deep --json
openclaw agentos version
~~~

## What this gives the operator

- A visual Mission Control surface for workspaces and digital workers.
- A direct path from OpenClaw runtime state to operator-facing diagnostics.
- Clear visibility into ready, degraded, unavailable, and unknown states.
- A safe place to inspect work before assigning more missions.

## Recovery

If the command reports that AgentOS is unavailable:

1. Check that <code>@sapienx/agentos</code> is installed separately.
2. Confirm the <code>agentos</code> executable is on <code>PATH</code>, or set <code>AGENTOS_BIN</code> to an absolute executable path.
3. Run <code>openclaw agentos doctor --deep</code> after AgentOS is available.
4. Treat missing, degraded, or unknown OpenClaw state as a real diagnostic state; do not infer that a process is authenticated or healthy from liveness alone.

If the plugin itself is missing, inspect the native OpenClaw plugin inventory and install the ClawHub package:

~~~bash
openclaw plugins list
openclaw plugins install clawhub:@sapienx/openclaw-agentos
~~~

Do not create a second AgentOS runtime, a parallel skill engine, or a local substitute for OpenClaw Gateway state. Use the native OpenClaw capability when available and report unsupported or degraded behavior clearly.

## Learn more

- [AgentOS website](https://agentos.sapienx.app/)
- [OpenClaw plugin on ClawHub](https://clawhub.ai/plugins/@sapienx/openclaw-agentos)
- [AgentOS source repository](https://github.com/SapienXai/AgentOS)
