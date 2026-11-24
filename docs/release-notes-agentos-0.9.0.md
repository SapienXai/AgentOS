# AgentOS 0.9.0

## Highlights

- Setup keeps OpenClaw diagnostics and model settings available on demand so the next action stays visible.
- The setup guide leads from a verified model connection to creating the first workspace and starting a conversation with its agent.
- Agent chat reports a model context overflow as a failed turn and explains how to retry.
- CLI release installs and updates require valid SHA-256 checksums before replacing the installed application.

## OpenClaw compatibility

AgentOS 0.9.0 starts with OpenClaw 2026.11.5. Run `agentos doctor --deep` to verify Gateway connectivity, authentication, scopes, and model readiness.

## Install and get started

Start with a clean AgentOS 0.9.0 installation. Open AgentOS, choose **Connect ChatGPT**, complete authorization in your browser, create a workspace, and send your first message. Existing OpenClaw files and workspaces remain on disk.

From 0.9.0 forward, Desktop verifies updater signatures before installation. Debian and RPM users update through their package manager.

## Platform downloads

Desktop bundles target macOS Apple Silicon, Windows x64, and Linux x64. The CLI also targets Intel macOS. Use the release assets and updater feed for the version you are installing.
