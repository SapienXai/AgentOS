# AgentOS 0.9.0

## Highlights

- Setup keeps OpenClaw diagnostics and model settings available on demand so the next action stays visible.
- The setup guide leads from a verified model connection to creating the first workspace and starting a conversation with its agent.
- Agent chat reports a model context overflow as a failed turn and explains how to retry.
- CLI release installs and updates require valid SHA-256 checksums before replacing the installed application.

## OpenClaw compatibility

The candidate targets OpenClaw 2026.11.5 for fresh setups. Run `agentos doctor --deep` to confirm the local Gateway, authentication, scopes, and model readiness after an update.

## Upgrading from 0.8.0

Back up your AgentOS and OpenClaw state before upgrading. Use the desktop updater for a packaged desktop installation or the same package manager that installed the CLI. Keep the existing AgentOS application data directory and OpenClaw workspace when replacing an installation.

## Platform downloads

Desktop bundles target macOS Apple Silicon, Windows x64, and Linux x64. The CLI also targets Intel macOS. Use the release assets and updater feed for the version you are installing.
