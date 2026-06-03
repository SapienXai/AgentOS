# Security Policy

## Reporting A Vulnerability

Please do not open public issues for suspected vulnerabilities.

Email private reports to security@sapienx.ai with:

- Affected AgentOS version or commit
- Reproduction steps and impact
- Any relevant logs, screenshots, or proof-of-concept details
- Whether the issue affects source checkouts, packaged installs, or both

We aim to acknowledge reports within 3 business days and coordinate remediation details privately before public disclosure.

## Supported Versions

AgentOS is pre-1.0. Security fixes are prepared against the current main branch and the latest published `@sapienx/agentos` release when applicable.

## Operational Guidance

AgentOS is intended to run as the local operator interface for OpenClaw. Keep it bound to `127.0.0.1` unless you have added your own network controls, and use the authenticated URL printed by the `agentos` launcher for packaged installs.
