# Security Policy

## Reporting A Vulnerability

Please do not open public issues for suspected vulnerabilities.

Email private reports to info@sapienx.app with:

- Affected AgentOS version or commit
- Reproduction steps and impact
- Any relevant logs, screenshots, or proof-of-concept details
- Whether the issue affects source checkouts, packaged installs, or both

We aim to acknowledge reports within 3 business days and coordinate remediation details privately before public disclosure.

## Supported Versions

AgentOS is pre-1.0. Security fixes are prepared against the current main branch and the latest published `@sapienx/agentos` release when applicable.

## Operational Guidance

AgentOS defaults to a local operator interface for OpenClaw. Keep it bound to `127.0.0.1` for source and package installs unless you have added intentional hosted access controls, and use the authenticated URL printed by the `agentos` launcher for packaged installs.

Packaged AgentOS generates a local API token, protects API routes centrally, and stores sensitive runtime auth/config files with owner-only permissions where applicable. Remote OpenClaw Gateway URLs are blocked by default unless explicitly allowed with `AGENTOS_ALLOW_REMOTE_GATEWAY_URL=1`. Do not expose AgentOS publicly without your own network access controls, authentication policy, and monitoring.

Remote mutation access is disabled by default. An operator may explicitly allow exact HTTPS origins with the comma-separated `AGENTOS_TRUSTED_OPERATOR_ORIGINS` environment variable. This opt-in still requires AgentOS API authentication; it rejects wildcards, HTTP origins, paths, queries, fragments, missing Origin headers, and mismatched forwarded hosts. Deploy remote access only behind HTTPS and an authenticated reverse proxy that preserves trustworthy public host and protocol headers.

When Instance Protection is enabled, its signed, HttpOnly, SameSite session cookie is accepted as API authentication for that browser. Public Instance Protection status, login, and logout endpoints do not require the machine API token; login remains password-protected, rate-limited, and subject to the localhost or trusted-origin mutation guard. This lets a new trusted browser authenticate with operator credentials without distributing the machine API token. When Instance Protection is disabled, the API token remains required for protected API access.

The documented Railway deployment is an intentional hosted mode. It requires generated internal API and Gateway tokens, initializes Instance Protection before serving operator traffic, accepts only the exact Railway HTTPS domain automatically, keeps OpenClaw Gateway bound to container loopback, and stores AgentOS, OpenClaw, and workspace state on a persistent volume. The public `/api/health` endpoint returns only `ok` or `starting` and no runtime details. Additional custom domains require an explicit `AGENTOS_TRUSTED_OPERATOR_ORIGINS` entry.
