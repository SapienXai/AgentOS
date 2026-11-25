# AgentOS 0.10.0 engineering closure

The frozen code is `45647bbe5858f919d9db2f399a32d3fad7974322`. The certification suites use the official OpenClaw `2026.11.10` package and both `2026.11.10` Gateway SDK packages. Each suite runs with a separate home and AgentOS sidecar. Suite output digests and the tested code revision are recorded in the execution manifest. [Execution manifest](final-closure-evidence.json)

## Supported access boundary

Deploy AgentOS as a trusted-operator console. The authenticated instance owner, the desktop operator, and an explicitly configured API service in token mode can read shared Gateway projections through `runtime.inspect`. A signed-in product member cannot read those projections. Keep AgentOS authentication and OpenClaw’s own authentication enabled for the respective runtime surfaces. The Gateway credential represents shared operator authority. Per-member Gateway delegation is outside this deployment model.

The protected HTTP fixture exercises service and owner reads, member denial on snapshot and SSE, safe server-rendered redirects on Mission Control and Settings, an owner delta, and revocation of an established stream.

```sh
node -r ./tests/register-paths.cjs -r jiti/register.js \
  scripts/agentos-dashboard-access-e2e.cjs /path/to/openclaw /path/to/clean/agentos-build
```

## Benchmark protocol

Start with a clean production build. Each run creates new OpenClaw state and a new AgentOS sidecar. The extended sample records cold and warm browser DOM timings, method counts during both cold loading and the mutation window, Gateway CPU, and RSS before and after seeding native sessions. The 20 DOM samples each cover a native rename, its accompanying session change, and the visible update in both browser contexts. Use `AGENTOS_BENCH_NO_RAW_SSE=1` to remove the two additional raw SSE subscribers.

```sh
AGENTOS_BENCH_OPENCLAW_PACKAGE=/path/to/openclaw \
AGENTOS_BENCH_APP_ROOT=/path/to/clean/agentos-build \
AGENTOS_BENCH_MUTATIONS=24 AGENTOS_BENCH_DOM_SAMPLES=20 AGENTOS_BENCH_SETTLE_MS=12000 \
  node -r ./tests/register-paths.cjs -r jiti/register.js scripts/agentos-dashboard-benchmark.cjs
```

The prior workload reused build-local Mission Control sidecars and could read stale dispatches from earlier fixtures. The corrected workload separates those records from each run. Readiness now probes the configured loopback Gateway endpoint. Session-change events still invalidate the shared runtime snapshot and preserve the existing bounded cache for the global provider inventory.

## Release boundaries

The certification assessment covers the exact runtime and fixture-backed product paths. The isolated owner acceptance launcher covers protected sign-in and process restart. ChatGPT account authorization, actual inference, saved account reuse and provider reconnect, and native MCP OAuth still need owner acceptance against approved accounts and services. The native workforce fixture verified a Mission-linked Human Control question and its resolution through AgentOS. Delegation, waiting worker, cancellation, and child failure still require correlated native task rows. Deterministic workforce projection tests cover their state handling.

Desktop CI builds unsigned packages. Railway acceptance requires an isolated candidate rollout and persisted-state restart and recreation proof. Public release requires the separate candidate production acceptance record, including package and target platform evidence.

Advanced session controls, workspace relocation, reviewed ClawHub installation, MCP health and resource browsing remain open. [Iteration IV scope and evidence](iteration-iv.md)
