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

## Template composer specification

Create the template from the `https://github.com/SapienXai/AgentOS` repository and use the default branch. Configure the service as follows.

### Service

- Name: `AgentOS`
- Source: `https://github.com/SapienXai/AgentOS`
- Builder: Dockerfile (the repository's `railway.json` selects `Dockerfile.railway`)
- Public networking: enabled, generate a domain
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
3. Wait until `/api/health` passes. The startup supervisor starts OpenClaw first and starts AgentOS only after the Gateway readiness endpoint responds.
4. Open the generated HTTPS domain and sign in.
5. Remove `AGENTOS_INITIAL_ADMIN_PASSWORD` from the Railway service variables after confirming the first sign-in. The account remains on the persistent volume.
6. Connect a real model/provider in Setup Center.
7. Create a workspace and run the compatibility diagnostics before assigning production work.

The bootstrap password is used only when `/data/agentos/instance-protection.json` does not exist. It is removed from the long-running AgentOS process after bootstrap and is never passed to OpenClaw, but Railway retains the service variable until the operator removes it. Redeploying or changing the variable does not replace the account. Change credentials from AgentOS. If recovery is required, use a Railway shell to run the documented Instance Protection reset deliberately; deleting the volume is not an account-reset mechanism because it also destroys OpenClaw and workspace state.

## Runtime and security behavior

- The container starts as root only long enough to prepare the root-owned Railway volume, then runs both AgentOS and OpenClaw as the non-root `node` user.
- The initial admin password is removed from the long-running AgentOS process after bootstrap and is never passed to the OpenClaw process.
- OpenClaw listens only on container loopback. It has no Railway public port or domain.
- Browser sessions authenticate with the same username and password on every trusted browser; session cookies remain browser-specific.
- Login is rate-limited. Mutation requests require an authenticated session and an exact same-origin HTTPS request.
- Chromium is included for OpenClaw browser automation. Interactive desktop actions and host Finder/Terminal integration are not available in a headless Railway container.
- The health endpoint intentionally reveals no version, token, path, account, or Gateway detail.

## Persistence and operations

Back up the Railway volume before risky upgrades. A service with an attached volume has brief redeploy downtime, and Railway cannot run multiple replicas against this single-runtime layout. Monitor volume capacity because a full volume can prevent OpenClaw and AgentOS from writing state.

OpenClaw is pinned in `Dockerfile.railway`. Upgrade it only together with AgentOS compatibility checks and update the pin, recommended version, and deployment documentation in the same change.

## Publishing the one-click button

Railway assigns the template code only after the template is created in the Railway workspace. Once created and test-deployed:

1. Publish the template.
2. Copy its template code from Railway.
3. Add Railway's official button to the README, replacing `<TEMPLATE_CODE>`:

```md
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/<TEMPLATE_CODE>?utm_medium=integration&utm_source=template&utm_campaign=agentos)
```

Do not merge a placeholder template code. Verify the button in a signed-out browser and complete a clean deployment before calling the one-click flow available.
