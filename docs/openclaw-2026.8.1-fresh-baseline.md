# OpenClaw 2026.8.1 Fresh Baseline

> Historical 2026.8.1 artifact. The active fresh-install baseline is OpenClaw 2026.8.2; see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

This document records the historical 8.1 fresh-baseline gate at commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`. The active AgentOS recommended and supported baseline is now OpenClaw `2026.8.2`; the current fresh-install evidence is [`docs/evidence/openclaw-2026.8.2-fresh-baseline.json`](evidence/openclaw-2026.8.2-fresh-baseline.json). A clean AgentOS install provisions the active baseline directly and does not require the historical 6.11 migration engine.

## Certification command

The real gate requires a disposable exact package root. It never uses the user’s OpenClaw state or Gateway:

```bash
OPENCLAW_FRESH_BASELINE_PACKAGE=/absolute/path/to/openclaw-2026.8.1/package \
  pnpm openclaw:fresh-baseline-e2e
```

The package must contain `package.json`, `openclaw.mjs`, and `dist/build-info.json` identifying version `2026.8.1` and the exact target commit. If dependencies are absent, the harness installs production dependencies into the disposable managed package only.

## Fresh sequence

The harness records and verifies this sequence:

1. Create empty disposable state, config, workspace, and home roots.
2. Copy the exact 8.1 package into the managed install root and verify its identity again.
3. Create a fresh loopback Gateway config and start the real OpenClaw Gateway on a random loopback port.
4. Run the native AgentOS WebSocket runtime certification with a disposable loopback model provider.
5. Verify authenticated handshake/version, health, agent and session lifecycle, model execution, streaming, history, config mutation, cron execution, restart/reconnect, SQLite integrity, and `openclaw doctor --json`.
6. Verify that no migration engine or migration journal was involved, stop the Gateway, remove the disposable root, and write the sanitized evidence artifact.

The certification child uses AgentOS’s native Gateway client and application-side probe harness. CLI use is limited to the explicitly recorded `doctor --json` health check and exact package dependency provisioning; it is not used as proof of native Gateway behavior.

## Gate

The successful run prints exactly:

```text
OPENCLAW 8.1 FRESH BASELINE: PASS
```

The generated artifact is [`docs/evidence/openclaw-2026.8.1-fresh-baseline.json`](evidence/openclaw-2026.8.1-fresh-baseline.json). It contains no tokens, credentials, response bodies, or private local paths. Its static comparison is historical context only; the fresh gate itself has no source state, migration engine, or historical migration fixture.

## Historical migration coverage

The Phase 2B `2026.6.11` to `2026.8.1` migration engine, fixture, journal, rollback checks, and evidence remain available for historical compatibility regression. They are not part of fresh provisioning and are not the normal supported runtime path.
