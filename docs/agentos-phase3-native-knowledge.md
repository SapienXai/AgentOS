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

OpenClaw's stable native Gateway exposes `memory.search` and
`doctor.memory.status`. It does not expose the CLI memory index counters or a
memory synchronization method as native Gateway methods in this release. The
adapter therefore uses OpenClaw's structured `memory status --json --agent`
command as an explicit, normalized CLI fallback for those facts. It invokes
OpenClaw's own `memory index --force --agent` command only when that status
reports a dirty or incompatible index. No filesystem scan, SQLite access, or
AgentOS indexing implementation is used.

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
incompatible state. A clean index causes no OpenClaw config rewrite and no
rebuild. If config pacing or a required Gateway restart is pending, refresh is
deferred and the result remains explicitly observable.

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
