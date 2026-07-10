# Worker Profiles

Worker Profiles are the operator-facing representation of an OpenClaw agent in AgentOS. They make a digital employee understandable without exposing raw OpenClaw configuration.

## Ownership

- **OpenClaw owns runtime execution:** agent id, model, workspace, agent state directory, skills allowlist, tools policy, sandbox policy, memory search, sessions, auth profiles, channel routing, and browser runtime.
- **AgentOS owns operator metadata:** worker role, mission, behavior instructions, and labels. This versioned sidecar lives in the workspace `.openclaw/project.json` agent entry.
- **AgentOS compiles behavior guidance:** the Worker Profile behavior text is rendered into the worker's generated `agent-policy-*` skill. It is guidance, never an authorization boundary.

## Supported runtime mapping

| Worker Profile field | OpenClaw mapping |
| --- | --- |
| Display name / emoji / theme / avatar | `agents.list[].name` and `identity` |
| Mission | `agents.list[].description` |
| Model | `agents.list[].model` |
| Skills | `agents.list[].skills` |
| Tool profile and allow/deny | `agents.list[].tools.profile`, `allow`, `deny` |
| Workspace-only files | `agents.list[].tools.fs.workspaceOnly` |
| Sandbox | `agents.list[].sandbox.mode`, `scope`, `workspaceAccess` |
| Memory access | `agents.list[].memorySearch.enabled`, `sources` |

AgentOS limits its profile editor to these schema-verified fields. It does not store or transmit credentials, OAuth tokens, browser cookies, sandbox environment variables, host mounts, extra memory paths, or provider configuration.

## Account and browser boundaries

Connected accounts are AgentOS access-rule references. Browser profiles are visible through OpenClaw, but OpenClaw does not provide a typed browser-profile selection parameter for agent mission dispatch. The Worker Profile UI therefore reports this state honestly and never claims to assign a browser session to an agent.

## Write behavior

AgentOS updates OpenClaw through its existing config adapter. Existing unknown OpenClaw fields are preserved when the supported profile fields are changed. Configuration writes continue to use the Gateway-first config patch/apply path with the existing CLI fallback and diagnostics behavior.
