---
name: agentos
description: Use AgentOS as the operator control plane above OpenClaw for starting, inspecting, and diagnosing a digital workforce.
user-invocable: true
metadata: { "openclaw": { "emoji": "🧭" } }
---

# AgentOS operator guide

AgentOS is the operator-facing control plane above OpenClaw. OpenClaw remains authoritative for the Gateway, agents, sessions, tasks, models, channels, plugins, runtime skills, and native lifecycle.

## Start here

Use the native OpenClaw plugin command when it is installed:

```bash
openclaw agentos
```

The command opens AgentOS in the default browser. For explicit operations:

```bash
openclaw agentos start --open
openclaw agentos status
openclaw agentos doctor --deep
openclaw agentos doctor --deep --json
openclaw agentos version
```

## Recovery

If the command reports that AgentOS is unavailable:

1. Check that `@sapienx/agentos` is installed separately.
2. Confirm the `agentos` executable is on `PATH`, or set `AGENTOS_BIN` to an absolute executable path.
3. Run `openclaw agentos doctor --deep` after AgentOS is available.
4. Treat missing, degraded, or unknown OpenClaw state as a real diagnostic state; do not infer that a process is authenticated or healthy from liveness alone.

If the plugin itself is missing, inspect the native OpenClaw plugin inventory and install the ClawHub package:

```bash
openclaw plugins list
openclaw plugins install clawhub:@sapienx/openclaw-agentos
```

Do not create a second AgentOS runtime, a parallel skill engine, or a local substitute for OpenClaw Gateway state. Use the native OpenClaw capability when available and report unsupported or degraded behavior clearly.
