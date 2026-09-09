# AgentOS Phase 3 Native Knowledge Integration

## Scope

Phase 3 connects the Phase 2 canonical corpus at
`<workspace>/knowledge/sources/**` to OpenClaw's native memory search. AgentOS
does not own a memory index, embeddings, vector store, retrieval engine,
watcher, or SQLite database.

The application boundary is
`lib/agentos/application/workspace-native-knowledge-service.ts`:

- `planWorkspaceKnowledgeBinding` reads the supported Phase 2 snapshot and
  plans an idempotent binding without mutation.
- `ensureWorkspaceNativeKnowledge` reconciles only each active agent's
  `agents.entries[agentId].memory.search.extraPaths` through the existing
  Gateway-backed adapter.
- `getWorkspaceNativeKnowledgeStatus` projects binding state, Phase 2 corpus
  coverage, and OpenClaw's native `doctor.memory.status` facts.

The stable AgentOS-owned entry is the workspace-relative OpenClaw extra path
`knowledge/sources`. It is stored per agent, never under global
`memory.search.extraPaths`. OpenClaw combines global and per-agent entries, so
existing user paths remain untouched. The exact canonical path with no pattern
is the deterministic ownership identity used for removal.

## OpenClaw ownership

The implementation was designed against OpenClaw `v2026.9.3`, source commit
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.

OpenClaw owns:

- extra-path normalization and workspace-relative resolution;
- Markdown and supported extra-path file discovery;
- per-agent SQLite index storage;
- FTS, vector, hybrid ranking, cache, watcher, and sync lifecycle;
- native memory provenance and automatic-injection eligibility;
- index compatibility, dirty state, rebuild, and failure recovery.

AgentOS only owns the product-level declaration that its stable corpus should
be included in each active workspace agent's native memory scope.

For the pinned `v2026.9.3` CLI, `memory status` and `memory index` resolve
local runtime state from OpenClaw's state/config environment (`OPENCLAW_STATE_DIR`,
`OPENCLAW_CONFIG_PATH`, and `OPENCLAW_PROFILE` where configured). The Gateway
URL selects a Gateway connection; it is not a redirect for the CLI's local
memory store. AgentOS therefore pins only the proven local runtime values for
this fallback and never treats `OPENCLAW_GATEWAY_URL` as memory-store identity.

OpenClaw's stable native Gateway exposes `memory.search` and
`doctor.memory.status`. It does not expose the CLI memory index counters or a
memory synchronization method as native Gateway methods in this release.

## Memory index lifecycle capability

Gateway-native memory search is independent from index maintenance. The
adapter prefers a future native Gateway index-status/rebuild capability when
OpenClaw exposes one. On `v2026.9.3`, the narrow fallback uses OpenClaw's
structured `memory status --json --agent` command for status and
`memory index --force --agent` for an OpenClaw-owned rebuild. Both results are
normalized at the adapter boundary; AgentOS never receives the full CLI JSON.

## Runtime locality

The CLI fallback is enabled only when the connected client carries trusted
runtime evidence from the existing lifecycle discovery boundary and that
evidence matches the local CLI runtime after canonical path resolution. The
proof requires a loopback Gateway, trusted AgentOS-managed lifecycle
ownership (or the existing AgentOS Railway supervisor), matching Gateway URL,
profile, state directory, and config path. The CLI process is explicitly
pinned to the proven `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, and
`OPENCLAW_PROFILE` values. A loopback URL, port, process user, version, or
agent ID alone is never proof. The identity is server-side configuration and
lifecycle evidence, not request data.

## Remote Gateway

Remote Gateway native `memory.search` remains usable. Local CLI index status and
rebuild are reported as unavailable because a local process cannot be assumed
to address that Gateway's state. An externally managed local Gateway is also
unavailable unless its runtime identity is proven by the supported lifecycle
boundary. Unknown locality returns unknown freshness and never runs
`memory index --force`.

No filesystem scan, SQLite access, remote shell, custom watcher, or AgentOS
indexing implementation is used. The absence of a remote native index
maintenance method remains an OpenClaw capability limitation; a future native
Gateway method supersedes this fallback.

After a successful config mutation, OpenClaw's authoritative mutation metadata
is surfaced. If it reports `restartRequired`, AgentOS reports that the Gateway
must be restarted; it does not restart the Gateway or force a memory rebuild.

The exact stable source includes a persistent native manager watcher and tests
for root replacement. The public `memory.search` Gateway handler in this
release deliberately uses a transient search manager, however. In a disposable
live Gateway check, the initial Phase 2 corpus was searchable, but a subsequent
Phase 2 directory replacement was not observed through repeated
`memory.search` calls without an explicit native rebuild. There is no supported
Gateway `memory.sync` method to invoke for that case. `ensureWorkspaceNativeKnowledge`
now closes this gap by asking OpenClaw for its structured index status after a
binding is active and delegating a rebuild only for the reported dirty or
incompatible state when runtime locality is proven. A clean index causes no
OpenClaw config rewrite and no rebuild. If locality is remote/unproven, status
is unavailable, freshness is unknown, and no rebuild process is started. If
config pacing or a required Gateway restart is pending, refresh is deferred
and the result remains explicitly observable.

## Trust and isolation

The corpus is an OpenClaw `extraPaths` source, not a curated `MEMORY.md`,
`USER.md`, or `memory/` root. OpenClaw classifies it as `untrusted`, so search
results remain reference material and are not eligible for trusted automatic
memory injection. AgentOS does not copy the corpus into bootstrap files or
trusted memory files.

Each workspace gets its own filesystem root behind its stable
`knowledge/sources` path, and the path is reconciled independently for each
workspace agent. Multiple agents intentionally sharing one workspace receive
the same binding. Global memory config and other workspace paths are not
modified. Removed agents are left to the existing AgentOS/OpenClaw lifecycle;
Phase 3 does not add a garbage collector.

## Corpus coverage

Coverage is calculated only from the supported `readKnowledgeSnapshot` reader
boundary. It reports total final documents, final `.md` document count,
non-Markdown count, percentage, and metadata format counts. It does not claim
that those files are indexed until OpenClaw reports that fact through a native
surface.

Phase 2 normalizes HTML output to Markdown paths, while JSON, YAML, TOML, CSV,
plain text, and other supported formats can retain their native output
extension. The report therefore measures final output paths and preserves the
format breakdown instead of claiming 100% Markdown coverage.

## Phase 4 entry point

After Phase 4 promotes a corpus generation into the workspace, it should call:

```ts
await ensureWorkspaceNativeKnowledge({
  workspacePath,
  agentIds
});
```

Use `planWorkspaceKnowledgeBinding` for a dry-run preview and
`getWorkspaceNativeKnowledgeStatus` for a status projection, including the
normalized OpenClaw index facts and whether a refresh is required. Phase 4
must not rebuild this binding logic, add a watcher, or access OpenClaw's
internal SQLite.
