# Deploy AgentOS on Railway

The Railway deployment runs AgentOS and OpenClaw `2026.6.11` in one service. OpenClaw remains the runtime and source of truth; AgentOS connects to its native Gateway over `ws://127.0.0.1:18789`. Only AgentOS is exposed through Railway's HTTPS domain.

## What the template creates

- One GitHub-backed service built with `Dockerfile.railway`.
- One public Railway HTTPS domain for AgentOS.
- One persistent volume mounted at `/data`.
- One generated AgentOS machine API token.
- One generated OpenClaw Gateway token.
- One initial administrator username and user-supplied password.
- A `/api/health` deployment healthcheck.

The single-service design is intentional. It keeps the Gateway private, avoids cross-service credential and state synchronization, and matches AgentOS's current local-Gateway architecture. Railway services with volumes should use one replica; horizontal replicas would not share a single writable OpenClaw runtime safely.

The entrypoint explicitly starts AgentOS on port `3000`, matching the generated Railway domain target. Do not override the service `PORT` value or change the generated domain target port unless both values change together; a mismatch produces Railway `502` responses even when the container is healthy.

## Template composer specification

Create the template from the `https://github.com/SapienXai/AgentOS` repository and use the default branch. Configure the service as follows.

### Service

- Name: `AgentOS`
- Source: `https://github.com/SapienXai/AgentOS`
- Builder: Dockerfile (the repository's `railway.json` selects `Dockerfile.railway`)
- Public networking: enabled, generate a domain
- Public domain target port: `3000`
- Healthcheck path: `/api/health`
- Healthcheck timeout: `300` seconds
- Restart policy: `ON_FAILURE`, maximum `10` retries
- Replicas: `1`

### Volume

Attach one volume to the AgentOS service with mount path:

```text
/data
```

The volume contains:

- `/data/agentos`: Instance Protection and AgentOS operator state;
- `/data/browser-profiles`: isolated persistent Chromium profiles used by Secure Browser Accounts;
- `/data/openclaw` and `/data/openclaw-config`: OpenClaw configuration, device identity, credentials, sessions, and logs;
- `/data/workspaces`: AgentOS-created workspaces.

Do not use a pre-deploy command for initialization. Railway mounts volumes only when the service starts, and the container entrypoint performs first-run initialization safely at runtime.

### Variables

| Variable | Template value | User-facing | Purpose |
| --- | --- | --- | --- |
| `AGENTOS_INITIAL_ADMIN_USERNAME` | `admin` | Editable | Initial Instance Protection username. |
| `AGENTOS_INITIAL_ADMIN_PASSWORD` | No default; required input | Required | Initial Instance Protection password. Use at least 12 characters. |
| `AGENTOS_API_TOKEN` | `${{secret(64)}}` | Hidden/generated | Internal machine API authentication and recovery boundary. |
| `OPENCLAW_GATEWAY_TOKEN` | `${{secret(64)}}` | Hidden/generated | Authentication for the loopback OpenClaw Gateway. |
| `RAILWAY_RUN_UID` | `0` | Hidden | Lets the entrypoint repair volume ownership before dropping to the non-root `node` user. |
| `RAILWAY_SHM_SIZE_BYTES` | `268435456` | Hidden | Provides Chromium with a larger shared-memory area. |

Do not add `AGENTOS_TRUSTED_OPERATOR_ORIGINS` for the generated Railway domain. AgentOS derives the exact HTTPS origin from `RAILWAY_PUBLIC_DOMAIN`. If a custom domain is added later, set `AGENTOS_TRUSTED_OPERATOR_ORIGINS=https://agentos.example.com` as an additional exact origin.

## First deployment

1. Enter the initial administrator username and password in the template form.
2. Deploy the template.
3. Wait until `/api/health` passes. The startup supervisor starts OpenClaw first and starts AgentOS only after the Gateway liveness endpoint responds. AgentOS reports stricter runtime, channel, and plugin readiness separately in diagnostics.
4. Open the generated HTTPS domain and sign in.
5. Remove `AGENTOS_INITIAL_ADMIN_PASSWORD` from the Railway service variables after confirming the first sign-in. The account remains on the persistent volume.
6. Connect a real model/provider in Setup Center, then explicitly choose its default model.
7. Create a workspace and run the compatibility diagnostics before assigning production work.

The bootstrap password is used only when `/data/agentos/instance-protection.json` does not exist. It is removed from the long-running AgentOS process after bootstrap and is never passed to OpenClaw, but Railway retains the service variable until the operator removes it. Redeploying or changing the variable does not replace the account. Change credentials from AgentOS. If recovery is required, use a Railway shell to run the documented Instance Protection reset deliberately; deleting the volume is not an account-reset mechanism because it also destroys OpenClaw and workspace state.

On a new volume, AgentOS creates only the durable OpenClaw Gateway baseline (`gateway.mode=local` with token auth). It intentionally creates no provider, auth profile, model catalog entry, default model, agent, or demo task. Until the operator connects a provider and chooses a default model, AgentOS blocks chat, mission dispatch, and runtime smoke tests before any provider request is sent.

## Runtime and security behavior

- The container starts as root only long enough to prepare the root-owned Railway volume, then runs both AgentOS and OpenClaw as the non-root `node` user.
- The initial admin password is removed from the long-running AgentOS process after bootstrap and is never passed to the OpenClaw process.
- OpenClaw listens only on container loopback. It has no Railway public port or domain.
- The Railway supervisor owns the OpenClaw Gateway process lifecycle. AgentOS onboarding only verifies that managed Gateway and configures providers, authentication, and models; it never invokes the host-service `gateway install`, `gateway start`, or `gateway restart` CLI lifecycle inside Railway.
- An authenticated operator can request **Restart managed gateway** from AgentOS. AgentOS sends the fixed restart request over a container-private, owner-only supervisor socket; the supervisor restarts only the Gateway and waits for `/healthz` liveness before reporting success.
- The supervisor checks Gateway liveness continuously in addition to watching the process. If the managed Gateway exits or repeatedly fails liveness probes, the supervisor restarts it while keeping AgentOS available. Stricter `/readyz` channel/plugin readiness remains an AgentOS diagnostic instead of blocking the deployment. After three failed Gateway restart attempts, the container exits so Railway can apply its service restart policy.
- Browser sessions authenticate with the same username and password on every trusted browser; session cookies remain browser-specific.
- Login is rate-limited. Mutation requests require an authenticated session and an exact same-origin HTTPS request.
- Chromium is included both for OpenClaw headless automation and for AgentOS Secure Browser Accounts. The supervisor runs a private browser worker using headed Chromium, Xvfb, openbox, and x11vnc. AgentOS exposes only an authenticated same-origin noVNC Live View; raw VNC and CDP remain loopback-only.
- Secure Browser profiles persist under `/data/browser-profiles`. A user can complete password, 2FA, or CAPTCHA input directly in Live View and reuse the resulting profile after the process stops. AgentOS stores only hashed, short-lived Live View credentials and never requests the website password.
- Secure Browser Account dispatch is enabled only when the AgentOS Browser Policy plugin has started inside OpenClaw, its supervisor-generated loopback heartbeat token is available, and native Gateway mission dispatch is advertised. The adapter binds the trusted task session key, forces the temporary `attachOnly` profile, renews the durable lease through the private AgentOS policy endpoint, enforces domain/action policy, and releases the browser session on terminal paths. CLI fallback and prompt-only profile selection remain blocked.
- A browser worker crash is reported through the same authenticated loopback policy channel. AgentOS immediately fences active profile leases, expires task bindings, revokes Live View credentials, and shows `recovery_required` instead of waiting for TTL expiry.
- Stable provider authentication rules are conservative. GitHub currently supports independent marker verification; other websites remain explicitly user-confirmed until a reviewed rule exists.
- The health endpoint intentionally reveals no version, token, path, account, or Gateway detail.

## Persistence and operations

Back up the Railway volume before risky upgrades. A service with an attached volume has brief redeploy downtime, and Railway cannot run multiple replicas against this single-runtime layout. Monitor volume capacity because a full volume can prevent OpenClaw and AgentOS from writing state.

Secure Browser Account metadata uses the existing AgentOS mission-control state
on `/data/agentos`; the self-hosted worker keeps authenticated Chromium profile
state under `/data/browser-profiles`. AgentOS does not export cookies,
localStorage, raw CDP URLs, or raw Live View credentials. No VNC or CDP port is
public. See
[Secure Browser Accounts](./secure-browser-accounts.md) for storage, trust
boundaries, backup, revoke, recovery, and upgrade procedures.

The browser policy heartbeat secret is generated in memory on every supervisor
start and passed only to the loopback AgentOS and OpenClaw processes. Do not
configure or expose it as a Railway template variable. Stale task bindings are
fenced after their rolling TTL and can be retried from **Accounts → Retry
cleanup**. The current single-service topology remains a single-operator
deployment; hostile multi-tenant workloads require separate private browser
worker services or equivalent tenant-level process/container isolation.

After building the Railway image, run the credential-free browser lifecycle
smoke in a disposable container:

```bash
docker run --rm --shm-size=256m --user node:node --entrypoint node agentos-railway \
  /agentos/scripts/secure-browser-integration-smoke.mjs
```

This verifies real Chromium cookie/localStorage persistence, worker
process-group crash recovery, profile reuse, and revoke cleanup. It does not
prove compatibility with a third-party website and does not use real login
credentials.

OpenClaw is pinned in `Dockerfile.railway`. Upgrade it only together with AgentOS compatibility checks and update the pin, recommended version, and deployment documentation in the same change.

## Published one-click template

The official AgentOS template is published in the Railway marketplace:

- Template page: [railway.com/deploy/agentos-1](https://railway.com/deploy/agentos-1)
- Direct deployment: [railway.com/new/template/agentos-1](https://railway.com/new/template/agentos-1)

The README uses Railway's official button:

```md
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/agentos-1?utm_medium=integration&utm_source=button&utm_campaign=agentos)
```

When the runtime contract changes, update the Railway template and this guide together. Verify the public template page, deploy form, required password field, generated secrets, `/data` volume, and healthcheck before publishing an update.
