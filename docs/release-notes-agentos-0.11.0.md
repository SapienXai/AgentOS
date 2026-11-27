# AgentOS 0.11.0

## Highlights

- Mission Control distinguishes confirmed OpenClaw activity, missing execution evidence, and terminal results.
- Follow-up instructions use the task's native session. Completed tasks preserve the original outcome and files while the conversation continues.
- Setup and workforce views bring workspace activity, model readiness, and operator actions into the same console.

## Install

The supported CLI archives and SHA-256 checksums are attached to the GitHub release. Use the [installation instructions](https://github.com/SapienXai/AgentOS#install) for your platform, run `agentos start`, and connect a model through Setup Center. This release is distributed through GitHub. The npm channel is unchanged.

The local OpenClaw minimum and recommendation are 2026.11.5. The candidate passed native certification on OpenClaw 2026.11.10, including upgrade and rollback from 2026.11.5 in disposable state. Run `agentos doctor --deep` to check your installation and model readiness.

## Desktop, mobile, and hosting

- Any new Desktop Public Preview assets are released separately after the exact installers pass packaged launch checks. Preview uses manual installation. Stable desktop auto-updates require their own acceptance.
- Android standalone installation and authenticated relaunch passed. Authenticated iPhone-sized WebKit browsing passed. Native iOS Home Screen installation remains unverified.
- The Railway image pins OpenClaw 2026.11.10. Provider-backed cloud acceptance remains pending.

See the [candidate workflow](https://github.com/SapienXai/AgentOS/actions/runs/46001081875) and the [platform acceptance record](https://github.com/SapienXai/AgentOS/blob/main/docs/evidence/agentos-0.11.0-production-acceptance.json).
