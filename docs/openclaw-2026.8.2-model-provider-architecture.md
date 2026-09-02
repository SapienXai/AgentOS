# AgentOS model and provider architecture on OpenClaw 2026.8.2

Status: active post-onboarding architecture

AgentOS must not reimplement provider/model capabilities already available in
OpenClaw. New model/provider work must first inspect the current OpenClaw
architecture and reuse it wherever possible.

## Provenance

- AgentOS hardening review starting HEAD: `ca0add4083a0493446b88b58622de9eea8e9708d`
- OpenClaw source: `2026.8.2`
- OpenClaw source commit: `0965053fe6b9341776df147a6934b7485c60b5ca`
- OpenClaw build: `2026.8.2-0965053fe6b9-2026-09-01T09-44-31.342Z`
- Runtime evidence: [`docs/evidence/openclaw-2026.8.2-runtime-certification.json`](evidence/openclaw-2026.8.2-runtime-certification.json)
- Fresh-baseline evidence: [`docs/evidence/openclaw-2026.8.2-fresh-baseline.json`](evidence/openclaw-2026.8.2-fresh-baseline.json)

The comparison and implementation were made against the stable 2026.8.2
source, not OpenClaw `main` or an unreleased build. The upstream release notes
are available at [OpenClaw 2026.8.2](https://docs.openclaw.ai/releases/2026.8.2).

## 2026.8.1 to 2026.8.2 audit conclusions

The relevant 8.2 source contract was inspected in the exact package used for
the runtime certification. The changes that affect AgentOS are:

- `models.list` has explicit `default`, `configured`, `provider-config`, and
  `all` views. The default view is the prepared/fast view; full discovery is an
  explicit choice. It can return provider outcomes and rich model metadata.
- `models.authStatus` is a secret-free provider projection. It reports provider
  status, API-key source, profile IDs/types/status/expiry, logout support, and
  provider capabilities. It is not a credential store owned by AgentOS.
- `models.authLogout` accepts a provider and optional profile IDs. It removes
  OpenClaw-owned stored profiles where supported and refuses config-bound
  credentials rather than pretending they were deleted.
- Setup is Gateway-native through `openclaw.setup.detect`,
  `openclaw.setup.activate`, `openclaw.setup.activate.start`,
  `openclaw.setup.auth.start`, `openclaw.setup.prepare.start`, and the
  `wizard.*` methods. Provider setup choices and authentication methods are
  advertised by OpenClaw/plugin metadata.
- Plugin manifests can contribute setup providers, `authMethods`, safe local
  credential evidence, provider catalog metadata, and model catalog metadata.
  Unknown providers therefore remain valid OpenClaw data and must render with
  generic AgentOS presentation.
- Model rows expose native availability reasons such as missing auth, auth
  failure, and cooldown, alongside context-window, reasoning, tools, alias,
  runtime, and tag metadata.

The 8.2 Gateway was certified with protocol 4, an authenticated operator, the
advertised method/event inventory, config read/write, models, auth status,
sessions, agents, tasks, and AgentOS lifecycle probes. No production Gateway or
user state was used.

## Ownership boundary

| Concern | Owner | AgentOS responsibility |
| --- | --- | --- |
| Provider identity and existence | OpenClaw/plugins | Present the returned provider and degrade generically for unknown IDs |
| Supported auth methods | OpenClaw setup/plugin metadata | Render the advertised choices only |
| Auth profiles, expiry, ordering, logout | OpenClaw | Show secret-free profile status and invoke native methods |
| Model catalog and availability | OpenClaw `models.list` | Normalize into product labels and roles |
| Primary model and fallbacks | OpenClaw `agents.defaults.model.*` | Provide simple selectors that write those exact fields |
| Model access policy | OpenClaw `agents.defaults.modelPolicy.allow` | Expose only under Advanced |
| Aliases and per-model settings | OpenClaw `agents.defaults.models` | Preserve; never use as an AgentOS model allowlist |
| Custom provider definitions | OpenClaw `models.providers.*` | Provide an Advanced form and retain safe compatibility flows |
| Logos, friendly labels, accent colors, copy | AgentOS | Presentation only; never capability or auth truth |
| Models page, recovery, progressive disclosure | AgentOS | Product experience over the native state |

## Post-onboarding API and domain

`GET /api/models/management` reads the native prepared catalog, auth status,
defaults, configured provider IDs, agents, and optionally setup metadata. The
endpoint returns a secret-free `ModelManagementSnapshot` from
`lib/openclaw/application/model-management-service.ts`.

The primary request uses `models.list` view `default` and does not force a full
catalog scan. The explicit legacy/full-catalog path remains available to the
onboarding compatibility surface through `view=all`. Provider detail and
manual refresh can request a more expensive view when needed.

Mutations use native OpenClaw state:

- default: `agents.defaults.model.primary`
- fallback order: `agents.defaults.model.fallbacks`
- policy: `agents.defaults.modelPolicy.allow`
- profile logout: `models.authLogout`
- API-key setup: `openclaw.setup.activate.start` with the selected `authChoice`
- interactive setup: `openclaw.setup.auth.start` followed by the shared
  `wizard.next` runner
- provider-owned/local preparation: `openclaw.setup.prepare.start`, followed by
  `openclaw.setup.activate.start` for the returned `preparedModelRef`
- wizard lifecycle: `wizard.next`, `wizard.cancel`, and `wizard.status`, with
  terminal success accepted only for `{ done: true, status: "done" }`
- custom providers: `models.providers.<providerId>` through the existing
  Gateway-backed config service

AgentOS never returns submitted credentials. API-key fields are password
inputs, requests are permission-gated, and responses pass through secret
redaction.

### Wizard contract

The post-onboarding connection dialog consumes the released 8.2 Gateway wizard
contract through `lib/openclaw/application/model-setup-wizard-service.ts` and
`lib/openclaw/domains/model-setup-wizard.ts`. It models `note`, `select`,
`multiselect`, `text`, `confirm`, `progress`, and `action` steps, preserves
opaque option values, masks sensitive text, renders provider URLs/device codes,
and submits confirmation as a boolean. Gateway-owned progress steps are
advanced automatically with a bounded, cancellable loop; client-owned steps
remain user actions.

The start response is interpreted before any `wizard.next` call. A terminal
error or cancellation is never rendered as a connected provider. Preparation
does not imply readiness: a `preparedModelRef` starts a separate activation
wizard, and only `modelActivation` establishes readiness. If activation reports
`gatewayRestartRequired`, AgentOS reports that OpenClaw must restart and does
not claim the model is ready prematurely.

The server-owned lifecycle retains each generated start promise past the
30-second client deadline for a bounded transport window. If the client aborts
or the start response arrives late, the exact session ID is cancelled after
admission rather than being dropped. Active sessions retain their captured
Gateway adapter and reject answers after a Gateway identity change. Follow-up
advancement is single-lane; a `running` result without a step is reconciled
through `wizard.status` plus bounded `wizard.next` retries before the UI shows a
recoverable timeout.

Native auth profiles remain OpenClaw-owned. Profile-level logout is offered only
when `logoutSupported` is true; config-bound credentials remain managed by
OpenClaw and are not presented with a fake disconnect action.

Model reads require `runtime.use`. Model configuration mutations (default,
fallback order, and `modelPolicy.allow`) require `models.manage`. Provider
authentication, API keys, custom-provider credentials, wizard cancellation, and
profile logout require `secrets.manage`. The browser receives the resulting
permission projection and renders the surface read-only when the actor cannot
perform a mutation, while the route remains the enforcement boundary.

## Models and providers UX

The normal Models surface is organized by user intent:

1. Default model, with a direct Change action.
2. Native fallback order, with add/remove/reorder/edit.
3. Searchable available model catalog with friendly names and status.
4. Connected/provider setup cards.
5. Collapsed Advanced details for policy, raw refs, catalog source, and setup
   diagnostics.

The primary action is **Connect Provider**. Models are not manually copied
into an AgentOS library just because they exist in an authenticated OpenClaw
catalog. `agents.defaults.models` remains available only for native aliases
and per-model configuration.

Provider connection is generated from OpenClaw setup metadata. API-key,
OAuth, device-code, and other interactive choices are not inferred from a
hardcoded provider registry. Providers without a setup method are shown as
unavailable or remain visible as configured state with a recovery path.

Custom OpenAI-compatible endpoints live under Advanced and keep a distinct
provider ID. They are written to `models.providers.*`; they are not relabeled
as canonical `openai`, and they do not create `codex/*` or `openai-codex/*`
model namespaces.

Session model overrides are not deleted. They remain in the session inspector
and use the shared model-catalog hook. Agent model selection and session model
selection now consume the same OpenClaw-backed default catalog projection.

## Compatibility and remaining limitations

- Existing OpenClaw config credentials, SecretRefs, explicit providers,
  aliases, defaults, fallbacks, and configured models are read without a
  destructive migration. Legacy AgentOS provider-file flows remain only for
  onboarding/backwards-compatible integration surfaces until their callers are
  retired.
- The old presentation registry remains as a compatibility/presentation map
  for first-run and legacy flows. It is not used to decide post-onboarding
  provider existence, auth methods, model inventory, or readiness.
- OpenClaw's native `models.authLogout` cannot remove config-bound credentials;
  the UI keeps those credentials under OpenClaw config/SecretRef ownership and
  reports the native limitation.
- Interactive provider login is Gateway-first. If a provider exposes a
  native wizard/device flow, AgentOS drives it through `openclaw.setup.auth`
  and `wizard.*`. A provider that exposes no remote setup method is not
  replaced with a hidden terminal command.
- The runtime certification intentionally skips destructive logout and
  physical-node operations. The isolated target also reports the experimental
  `node.runnerInventory.update` method as absent; it is not an AgentOS core
  dependency. The runtime gate itself has no FAIL or UNKNOWN results.
- Historical 2026.8.1 certification documents and evidence remain in the
  repository for provenance and regression comparison. They are not the active
  baseline; the active baseline and fresh-install policy are 2026.8.2.
