# OpenClaw 2026.11.5 candidate and ChatGPT onboarding

## Release policy

OpenClaw 2026.11.5 is the exact candidate for new installations, both Gateway SDKs, the packaged plugin build, and the Railway image. GitHub marked it stable and npm published it under `latest`. The source commit is `e13cf15ece9bbd969b7362927c315362c90c97ff`. Gateway protocol stays at 4. The upstream runtime declares state schema 36 and agent schema 38. The Railway multi-platform index is `sha256:9c74476e3e79b5a1595fd5cf904286eaba3471c10c640aaa9a361a89b41d0882`.

AgentOS 0.8.0 continues to recommend certified OpenClaw 2026.9.7 and supports the 2026.9.1 floor. The former 2026.10.6 candidate is historical. AgentOS keeps its existing patched Node.js floors, which meet the OpenClaw 2026.11.5 package engine requirement.

## Ownership and flow

- An authenticated local AgentOS owner can start setup for the default agent advertised by OpenClaw. The flow does not create a workspace or link a personal OpenClaw account. The provider grant belongs to the default agent's shared credentials.
- AgentOS tries OpenClaw's native `openclaw.setup.activate` with `existing-model` before requesting a new grant. A verified existing route remains selected. New sign-in uses `openclaw.setup.auth.start` with the manifest choice `openai-token-sharing`, the native equivalent of `models auth login --provider openai --method siwc`. The existing OpenClaw wizard lifecycle owns progress, cancellation, and connection identity. AgentOS associates the flow with the initiating authenticated session and rechecks that session while the wizard runs.
- The only accepted SIWC authorization destination is the OpenAI endpoint with a localhost callback, a single state and nonce, and PKCE. The browser receives a same-origin launch link, or Tauri requests the validated destination for its native opener. Port, OAuth state, callback, token exchange, and refresh are OpenClaw-owned. Codex browser OAuth, device codes, and other sign-in methods continue through their existing paths. AgentOS stores no provider credentials and never accepts callback codes.
- The exact 2026.11.5 build emits `http://localhost:8080/auth/callback`. Later documentation describes dynamically selected ports. AgentOS validates the one emitted by the runtime and does not construct or rewrite it. Remote and Railway installations surface alternative provider setup from AgentOS. The local onboarding flow does not publish the callback or tunnel it.
- The welcome screen requires a Gateway `modelActivation` result or a successful existing-model activation. The OpenClaw setup path stages the credential, verifies a bounded model reply with that credential, and promotes the route on success. AgentOS does not choose a static model ID. 2026.11.5's setup wizard uses the upstream provider candidate. Full SIWC account catalog and alternative model selection through the eligible catalog still need a version-specific live check. An identity-only authorization, a failed reply, or pending Gateway changes cannot enter the verified ready state.

## Compatibility and recovery

The 2026.11.5 release changes third-party harness run registration, removes direct plugin RPC access to internal chat controllers/queues, and changes the startup ownership deadline field. AgentOS's bundled browser policy and CLI plugin do not reference the removed objects or the old startup deadline. Gateway-managed model fallback, session restart, and update recovery are still subject to live certification.

Client credential tables moved from the shared state database to OpenClaw's `client/credentials.sqlite`. AgentOS uses that store only after OpenClaw records the migration as complete. The existing token write fences and older store layouts remain supported. OpenClaw owns the migration.

The migration rehearsal verifies a backup of disposable source state before replacing the binary and then waits for target session admission. Existing installations require a verified backup of config, sessions, credentials and workspace data, and a restore rehearsal on disposable state before an upgrade. Restoring the older package alone is not a state rollback. Follow OpenClaw's backup and recovery procedures, with the Gateway stopped for any offline restore. Hosted volume recovery must include the persistent volume snapshot and must be exercised independently.

## Evidence and release gate

- Official package and Docker index identity were checked. The 2026.11.5 package ran on a disposable macOS state root with Node.js 24.22.1.
- The exact-release official transport test passed its required RPCs and verified a scope denial. `tasks.list` was optional. It used a test token.
- The regular AgentOS device-identity handshake and native onboarding wizard hit OpenClaw's `Shared-state worker policy changed while its actor is in use; close its leases first` error in the disposable runtime. The wizard rejected the attempt before returning the authorization URL. Build and simulated onboarding evidence cannot confirm real authorization or a live provider reply.
- Rehearsals from 2026.9.1 and 2026.9.7 both verified the source backup and retained the representative post-Doctor state. Both failed target session admission after the bounded readiness wait. Neither rehearsal reached the final recovery check.
- AgentOS unit tests, lint, typecheck, production build, release consistency, CLI package smoke, and desktop shell checks passed. Chrome exercised the actual welcome screen at desktop, tablet, and mobile widths in both themes using mocked authorization responses. The primary action measured 5.12:1 text contrast. The pinned Railway image built, reported the target version, and returned HTTP 200 from the local disposable container. Hosted Railway and live external provider acceptance remain pending.
- The local final certification and freshness gates lack passing target runtime, channel acceptance, and final provenance evidence. No final certification artifact was generated in the repository. This candidate is not approved for advancing the recommendation or deploying to production.

Sources: [2026.11.5 release](https://github.com/openclaw/openclaw/releases/tag/v2026.11.5), [tagged SIWC implementation](https://github.com/openclaw/openclaw/blob/v2026.11.5/extensions/openai/token-sharing-oauth.runtime.ts), [OpenAI setup](https://docs.openclaw.ai/providers/openai/setup), [OpenClaw rollback and recovery](https://docs.openclaw.ai/install/updating/rollback).
